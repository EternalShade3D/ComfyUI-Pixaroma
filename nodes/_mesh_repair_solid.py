"""Mesh Repair Pixaroma - rebuild a broken mesh as one closed solid.

Why this exists (measured 2026-09-14, output/claude_output/mesh_repair_research):
Pixal3D and Trellis 2 models come out of core Remesh Mesh (udf mode) as a HOLLOW
DOUBLE SKIN two grid cells thick, with broken edges where the skins touch and a
skin full of pinholes. Patching the surface cannot fill a hollow model, so:

  1. mark every grid cell a triangle passes through (the skin)
  2. seal gaps: grow the skin by r cells, fill everything the outside cannot
     reach, shrink back by r. r decides everything - at 384 the radio stayed
     hollow at a 1.1% seal and filled at 1.7% - so Auto searches for it
  3. drop solid islands smaller than a share of the biggest
  4. smooth the occupancy slightly and extract its surface with marching
     TETRAHEDRA, which is closed and manifold by construction
  5. snap each new point ALONG ITS OWN NORMAL onto the original surface and undo
     any triangle that would fold - snapping straight to the closest point
     collapsed neighbours into broken edges in the research test
  6. copy colours from the nearest point of the original

Pure numpy + scipy: no torch, no ComfyUI, nothing a user's install may lack.
"""
import math
import os
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import scipy.ndimage as ndi
from scipy.spatial import cKDTree

PAD = 3                  # empty cells kept around the model, beyond the seal
SEAL_MAX_PERCENT = 5.0   # Auto never seals wider than this share of the longest side
COARSE_DETAIL = 192      # the grid the seal is searched on
JUMP = 1.5               # a fill this much bigger than the previous one = the inside filled
SETTLED = 1.3            # at the working grid, one more cell must add less than this
SIGMA = 0.6              # Gaussian smoothing of the occupancy, in cells
ISO = 0.5
SNAP_MAX = 1.5           # cells a point may move onto the original surface
T_CLAMP = 0.02           # keeps interpolated points off the grid corners


# ── the grid ─────────────────────────────────────────────────────────────────

def make_grid(lo0, hi0, detail, pad_cells):
    """Origin, cell size and shape for `detail` cells across the longest side."""
    ext = np.asarray(hi0, np.float64) - np.asarray(lo0, np.float64)
    longest = float(ext.max())
    if not longest > 0:
        raise ValueError("the model has no size")
    h = longest / float(detail)
    shape = tuple(int(math.ceil(e / h)) + 1 + 2 * int(pad_cells) for e in ext)
    lo = np.asarray(lo0, np.float64) - pad_cells * h
    return lo, h, shape


def seal_cells(percent, h, longest):
    """Cells to grow the skin by so gaps up to `percent` of the longest side close."""
    return max(1, int(math.ceil(float(percent) / 100.0 * longest / (2.0 * h) - 1e-9)))


def voxelize_skin(V, F, lo, h, shape, check_cancel=None):
    """Every cell a triangle passes through. Triangles are sampled no more than
    half a cell apart, so the marked cells form an unbroken layer."""
    grid = np.zeros(shape, dtype=bool)
    flat = grid.reshape(-1)
    yz = shape[1] * shape[2]
    z = shape[2]
    top = np.array(shape, np.int64) - 1
    for s in range(0, len(F), 1_000_000):
        if check_cancel:
            check_cancel()
        tri = V[F[s:s + 1_000_000]]
        edge = np.maximum.reduce([
            np.linalg.norm(tri[:, 1] - tri[:, 0], axis=1),
            np.linalg.norm(tri[:, 2] - tri[:, 1], axis=1),
            np.linalg.norm(tri[:, 0] - tri[:, 2], axis=1)])
        splits = np.clip(np.ceil(edge / (0.5 * h)).astype(np.int64), 1, 512)
        for k in np.unique(splits):
            idx = np.nonzero(splits == k)[0]
            ii, jj = np.meshgrid(np.arange(k + 1), np.arange(k + 1), indexing="ij")
            keep = (ii + jj) <= k
            wa = ii[keep] / float(k)
            wb = jj[keep] / float(k)
            wc = 1.0 - wa - wb
            per = max(1, 2_000_000 // len(wa))
            for t in range(0, len(idx), per):
                part = tri[idx[t:t + per]]
                pts = (part[:, None, 0] * wc[None, :, None]
                       + part[:, None, 1] * wa[None, :, None]
                       + part[:, None, 2] * wb[None, :, None]).reshape(-1, 3)
                cell = np.floor((pts - lo) / h).astype(np.int64)
                np.clip(cell, 0, top, out=cell)
                flat[cell[:, 0] * yz + cell[:, 1] * z + cell[:, 2]] = True
    return grid


def fill_with_seal(skin, r):
    """Grow by r cells, fill whatever the outside cannot reach, shrink back."""
    grown = ndi.binary_dilation(skin, iterations=r) if r > 0 else skin
    solid = ndi.binary_fill_holes(grown)
    if r > 0:
        solid = ndi.binary_erosion(solid, iterations=r, border_value=0)
        solid |= skin
    return solid


def search_seal_percent(V, F, lo0, hi0, check_cancel=None):
    """Auto: the seal, as a percent of the longest side, at which the inside fills.

    Searched on a coarse grid because it takes one fill per candidate. The fill
    volume JUMPS when the last leak closes (8.8x on the radio) and then stays
    flat, so the last jump is the answer. None means it never jumped: nothing
    hollow is hiding behind a gap, so a one-cell seal will do.
    """
    longest = float((np.asarray(hi0) - np.asarray(lo0)).max())
    hc = longest / COARSE_DETAIL
    rmax = max(1, int(SEAL_MAX_PERCENT / 100.0 * longest / (2.0 * hc)))
    lo, h, shape = make_grid(lo0, hi0, COARSE_DETAIL, PAD + rmax + 1)
    skin = voxelize_skin(V, F, lo, h, shape, check_cancel)
    counts = []
    grown = skin
    for r in range(rmax + 1):
        if check_cancel:
            check_cancel()
        if r > 0:
            grown = ndi.binary_dilation(grown)
        solid = ndi.binary_fill_holes(grown)
        if r > 0:
            solid = ndi.binary_erosion(solid, iterations=r, border_value=0) | skin
        counts.append(int(solid.sum()))
    jump = None
    for r in range(1, len(counts)):
        if counts[r] >= JUMP * max(1, counts[r - 1]):
            jump = r
    if jump is None:
        return None, counts
    return 100.0 * 2.0 * jump * h / longest, counts


def fill_at_working_grid(skin, r_start, r_limit, check_cancel=None):
    """Fill at r_start, then check one cell more. If that still makes the solid
    much bigger, the inside was leaking at THIS grid (a coarse grid closes finer
    gaps by itself), so step up - at most three times."""
    r = r_start
    solid = fill_with_seal(skin, r)
    count = int(solid.sum())
    for _ in range(3):
        if r + 1 > r_limit:
            break
        if check_cancel:
            check_cancel()
        wider = fill_with_seal(skin, r + 1)
        wider_count = int(wider.sum())
        if wider_count < SETTLED * max(1, count):
            break
        r, solid, count = r + 1, wider, wider_count
    return solid, r


def drop_islands(solid, keep_fraction):
    """Remove solid pieces smaller than keep_fraction of the biggest."""
    if keep_fraction <= 0:
        return solid, 0
    labels, n = ndi.label(solid)
    if n <= 1:
        return solid, 0
    sizes = np.bincount(labels.reshape(-1))[1:]
    keep = sizes >= keep_fraction * sizes.max()
    dropped = int((~keep).sum())
    if dropped == 0:
        return solid, 0
    lut = np.concatenate([[False], keep])
    return lut[labels], dropped


# ── marching tetrahedra ──────────────────────────────────────────────────────

_CUBE = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
                  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]], dtype=np.int64)
# Six tetrahedra around the main diagonal (Freudenthal). Every cube is split the
# same way, so neighbouring cubes agree on their shared faces and the surface
# has no cracks.
_TETS = np.array([[0, 1, 3, 7], [0, 1, 5, 7], [0, 2, 3, 7],
                  [0, 2, 6, 7], [0, 4, 5, 7], [0, 4, 6, 7]], dtype=np.int64)


def _case_table():
    """For each inside/outside pattern of a tet's 4 corners: its triangles, each
    as three (corner, corner) edges, and which corners are inside."""
    table = {}
    for code in range(1, 15):
        ins = [c for c in range(4) if code >> c & 1]
        outs = [c for c in range(4) if not code >> c & 1]
        if len(ins) == 1:
            i = ins[0]
            tris = [[(i, outs[0]), (i, outs[1]), (i, outs[2])]]
        elif len(ins) == 3:
            o = outs[0]
            tris = [[(o, ins[0]), (o, ins[1]), (o, ins[2])]]
        else:
            i1, i2 = ins
            o1, o2 = outs
            # (i1,o1) (i1,o2) (i2,o2) (i2,o1) walk the quad in order; split it
            # across the (i1,o1)-(i2,o2) diagonal.
            tris = [[(i1, o1), (i1, o2), (i2, o2)], [(i1, o1), (i2, o2), (i2, o1)]]
        table[code] = (tris, ins, outs)
    return table


_TABLE = _case_table()


def marching_tetrahedra(field, iso=ISO, slab=48, check_cancel=None):
    """The iso-surface of a 3D field as (vertices in cell units, faces).

    Closed and manifold for any field whose border is below iso. Faces point
    from the inside (field > iso) out. Interpolation is clamped to [0.02, 0.98]
    of each edge so no two points can land on the same grid corner, which a
    slicer (which merges points by position) would read as a broken edge.
    """
    f = np.asarray(field, dtype=np.float32)
    X, Y, Z = f.shape
    ntot = np.int64(X) * np.int64(Y) * np.int64(Z)
    yz = np.int64(Y * Z)
    corner_off = _CUBE[:, 0] * yz + _CUBE[:, 1] * Z + _CUBE[:, 2]
    tet_off = corner_off[_TETS]
    keys, dirs = [], []
    for x0 in range(0, X - 1, slab):
        if check_cancel:
            check_cancel()
        x1 = min(X - 1, x0 + slab)
        inside = f[x0:x1 + 1] > iso
        nx = x1 - x0
        code = np.zeros((nx, Y - 1, Z - 1), np.uint8)
        for k, (dx, dy, dz) in enumerate(_CUBE):
            code |= inside[dx:dx + nx, dy:dy + Y - 1, dz:dz + Z - 1].astype(np.uint8) << k
        cx, cy, cz = np.nonzero((code != 0) & (code != 255))
        if len(cx) == 0:
            continue
        cellcode = code[cx, cy, cz]
        base = (cx.astype(np.int64) + x0) * yz + cy.astype(np.int64) * Z + cz.astype(np.int64)
        del code, inside
        for t in range(6):
            corners = _TETS[t]
            tcode = np.zeros(len(base), np.uint8)
            for j in range(4):
                tcode |= ((cellcode >> corners[j]) & 1) << j
            for c in range(1, 15):
                sel = np.nonzero(tcode == c)[0]
                if len(sel) == 0:
                    continue
                g = base[sel][:, None] + tet_off[t][None, :]
                tris, ins, outs = _TABLE[c]
                outward = (_CUBE[corners[outs]].mean(0) - _CUBE[corners[ins]].mean(0)).astype(np.float32)
                for tri in tris:
                    k3 = np.empty((len(sel), 3), np.int64)
                    for e, (p, q) in enumerate(tri):
                        a = g[:, p]
                        b = g[:, q]
                        k3[:, e] = np.minimum(a, b) * ntot + np.maximum(a, b)
                    keys.append(k3)
                    dirs.append((outward, len(sel)))
    if not keys:
        return np.zeros((0, 3), np.float64), np.zeros((0, 3), np.int64)

    K = np.concatenate(keys)
    D = np.repeat(np.stack([d for d, _ in dirs]), [n for _, n in dirs], axis=0)
    del keys
    uniq, inv = np.unique(K.reshape(-1), return_inverse=True)
    faces = inv.reshape(-1, 3).astype(np.int64)
    a = uniq // ntot
    b = uniq % ntot

    def coords(idx):
        x = idx // yz
        rest = idx % yz
        return np.stack([x, rest // Z, rest % Z], axis=1).astype(np.float64)

    fa = f.reshape(-1)[a].astype(np.float64)
    fb = f.reshape(-1)[b].astype(np.float64)
    with np.errstate(divide="ignore", invalid="ignore"):
        t = np.where(fb != fa, (iso - fa) / (fb - fa), 0.5)
    t = np.clip(t, T_CLAMP, 1.0 - T_CLAMP)
    pa = coords(a)
    verts = pa + (coords(b) - pa) * t[:, None]

    normals = np.cross(verts[faces[:, 1]] - verts[faces[:, 0]], verts[faces[:, 2]] - verts[faces[:, 0]])
    flip = (normals * D).sum(1) < 0
    faces[flip] = faces[flip][:, ::-1]
    return verts, faces


# ── closest points, snapping and colours ─────────────────────────────────────

def closest_point_tri(p, a, b, c):
    """Ericson's closest point on a triangle, vectorised; regions applied
    lowest priority first so the vertex regions win ties."""
    ab, ac = b - a, c - a
    ap, bp, cp = p - a, p - b, p - c
    d1, d2 = (ab * ap).sum(-1), (ac * ap).sum(-1)
    d3, d4 = (ab * bp).sum(-1), (ac * bp).sum(-1)
    d5, d6 = (ab * cp).sum(-1), (ac * cp).sum(-1)
    va, vb, vc = d3 * d6 - d5 * d4, d5 * d2 - d1 * d6, d1 * d4 - d3 * d2

    def safe(x):
        return np.where(np.abs(x) < 1e-30, 1e-30, x)

    den = safe(va + vb + vc)
    res = a + ab * (vb / den)[..., None] + ac * (vc / den)[..., None]
    m = (va <= 0) & ((d4 - d3) >= 0) & ((d5 - d6) >= 0)
    w = (d4 - d3) / safe((d4 - d3) + (d5 - d6))
    res = np.where(m[..., None], b + (c - b) * w[..., None], res)
    m = (vb <= 0) & (d2 >= 0) & (d6 <= 0)
    w = d2 / safe(d2 - d6)
    res = np.where(m[..., None], a + ac * w[..., None], res)
    m = (d6 >= 0) & (d5 <= d6)
    res = np.where(m[..., None], c, res)
    m = (vc <= 0) & (d1 >= 0) & (d3 <= 0)
    w = d1 / safe(d1 - d3)
    res = np.where(m[..., None], a + ab * w[..., None], res)
    m = (d3 >= 0) & (d4 <= d3)
    res = np.where(m[..., None], b, res)
    m = (d1 <= 0) & (d2 <= 0)
    res = np.where(m[..., None], a, res)
    return res


def closest_points(Q, V, F, k=8, chunk=8192, check_cancel=None):
    """Closest point on the mesh for each query, searched among the k triangles
    with the nearest centres. Returns (points, triangle index, distance).

    The chunks run on threads. numpy and the tree search release the GIL and
    every chunk writes only its own slice, so the answer is the same point for
    point as one thread - measured on the Ep34 radio (1.39M points): 6.5 s on
    one thread, 1.5 s on 32, identical points, distances and triangles.
    """
    Q = np.asarray(Q, np.float64)
    V = np.asarray(V, np.float64)
    F = np.asarray(F, np.int64)
    k = int(max(1, min(k, len(F))))
    A, B, C = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    tree = cKDTree((A + B + C) / 3.0, balanced_tree=False, compact_nodes=False)
    n = len(Q)
    points = np.empty((n, 3))
    tri_index = np.empty(n, np.int64)
    dist = np.empty(n)

    def work(s):
        q = Q[s:s + chunk]
        _, ti = tree.query(q, k=k)
        ti = np.asarray(ti).reshape(len(q), k)
        cp = closest_point_tri(q[:, None, :], A[ti], B[ti], C[ti])
        d2 = ((cp - q[:, None, :]) ** 2).sum(-1)
        j = d2.argmin(1)
        rows = np.arange(len(q))
        points[s:s + len(q)] = cp[rows, j]
        tri_index[s:s + len(q)] = ti[rows, j]
        dist[s:s + len(q)] = np.sqrt(d2[rows, j])

    starts = range(0, n, chunk)
    workers = max(1, min(32, os.cpu_count() or 1, len(starts)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(work, s) for s in starts]
        try:
            for fut in futures:
                if check_cancel:
                    check_cancel()
                fut.result()
        except BaseException:
            # A cancelled run stops here; chunks already running just finish.
            for fut in futures:
                fut.cancel()
            raise
    return points, tri_index, dist


def face_normals(V, F):
    return np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])


def vertex_normals(V, F):
    """Area-weighted, unit length."""
    fn = face_normals(V, F)
    vn = np.zeros((len(V), 3))
    for corner in range(3):
        for axis in range(3):
            vn[:, axis] += np.bincount(F[:, corner], weights=fn[:, axis], minlength=len(V))
    length = np.linalg.norm(vn, axis=1, keepdims=True)
    return vn / np.where(length < 1e-30, 1.0, length)


def revert_folds(new, old, faces, iters=4):
    """Put back every point of a triangle that snapping turned over."""
    n0 = face_normals(old, faces)
    valid = np.linalg.norm(n0, axis=1) > 1e-20
    left = 0
    for _ in range(iters):
        bad = valid & ((n0 * face_normals(new, faces)).sum(1) <= 0)
        left = int(bad.sum())
        if not left:
            break
        idx = np.unique(faces[bad].reshape(-1))
        new[idx] = old[idx]
    return new, left


def snap_to_surface(verts, faces, V, F, max_move, check_cancel=None):
    """Move each point along its own normal toward the original surface.

    Along the normal only: the sideways part of the move is dropped, so two
    neighbouring points can never be pulled onto the same spot. A point further
    than max_move from the original stays where it is (it sits on a sealed gap).
    """
    normals = vertex_normals(verts, faces)
    points, tri_index, dist = closest_points(verts, V, F, check_cancel=check_cancel)
    along = np.clip(((points - verts) * normals).sum(1), -max_move, max_move)
    ok = dist <= max_move
    new = verts.copy()
    new[ok] += normals[ok] * along[ok, None]
    new, folds = revert_folds(new, verts, faces)
    return new, points, tri_index, folds


def barycentric(P, a, b, c):
    v0, v1, v2 = b - a, c - a, P - a
    d00, d01, d11 = (v0 * v0).sum(1), (v0 * v1).sum(1), (v1 * v1).sum(1)
    d20, d21 = (v2 * v0).sum(1), (v2 * v1).sum(1)
    den = d00 * d11 - d01 * d01
    den = np.where(np.abs(den) < 1e-30, 1e-30, den)
    v = (d11 * d20 - d01 * d21) / den
    w = (d00 * d21 - d01 * d20) / den
    bc = np.clip(np.stack([1.0 - v - w, v, w], axis=1), 0.0, 1.0)
    return bc / np.clip(bc.sum(1, keepdims=True), 1e-12, None)


def transfer_colours(points, tri_index, V, F, colours=None, uvs=None, texture=None):
    """Colours for new points, from the original at the given closest points.

    Vertex colours are blended as they are (core keeps them linear). A texture is
    sampled through the UVs and converted from sRGB to linear with a 2.2 power,
    the same curve core's Paint Mesh uses, so the result looks like the original
    when core saves it.
    """
    tri = np.asarray(F, np.int64)[tri_index]
    V = np.asarray(V, np.float64)
    bc = barycentric(points, V[tri[:, 0]], V[tri[:, 1]], V[tri[:, 2]])
    if colours is not None:
        C = np.asarray(colours, np.float32)
        C = C[:, :3] if C.ndim == 2 and C.shape[1] >= 3 else np.repeat(C.reshape(-1, 1), 3, axis=1)
        return (C[tri] * bc[:, :, None]).sum(1).astype(np.float32)
    if uvs is not None and texture is not None:
        UV = np.asarray(uvs, np.float64)
        uv = (UV[tri] * bc[:, :, None]).sum(1)
        img = np.asarray(texture, np.float32)
        if img.ndim == 2:
            img = img[..., None]
        H, W = img.shape[:2]
        x = np.clip(uv[:, 0], 0.0, 1.0) * (W - 1)
        y = np.clip(uv[:, 1], 0.0, 1.0) * (H - 1)
        x0 = np.floor(x).astype(np.int64)
        y0 = np.floor(y).astype(np.int64)
        x1 = np.minimum(x0 + 1, W - 1)
        y1 = np.minimum(y0 + 1, H - 1)
        fx = (x - x0)[:, None]
        fy = (y - y0)[:, None]
        top = img[y0, x0] * (1 - fx) + img[y0, x1] * fx
        bottom = img[y1, x0] * (1 - fx) + img[y1, x1] * fx
        rgb = top * (1 - fy) + bottom * fy
        rgb = rgb[:, :3] if rgb.shape[1] >= 3 else np.repeat(rgb[:, :1], 3, axis=1)
        return np.power(np.clip(rgb, 0.0, 1.0), 2.2).astype(np.float32)
    return None


# ── the whole rebuild ────────────────────────────────────────────────────────

def solid_rebuild(V, F, detail=384, seal="auto", loose=1.0, keep_detail=True,
                  colours=None, uvs=None, texture=None, check_cancel=None, progress=None):
    """Rebuild (V, F) as closed solid geometry. See the module docstring.

    Returns vertices (float32, model units), faces (int64), colours (float32 or
    None), the seal used (percent and cells), islands dropped and timings.
    `progress(fraction, label)` is called between stages when given.
    """
    started = time.perf_counter()
    timings = {}
    clock = [started]

    def mark(name, fraction):
        now = time.perf_counter()
        timings[name] = round(now - clock[0], 3)
        clock[0] = now
        if progress:
            progress(fraction, name)

    V = np.asarray(V, np.float64).reshape(-1, 3)
    F = np.asarray(F, np.int64).reshape(-1, 3)
    if len(F) == 0 or len(V) == 0:
        raise ValueError("the mesh has no triangles")
    lo0, hi0 = V.min(0), V.max(0)
    longest = float((hi0 - lo0).max())
    if not longest > 0:
        raise ValueError("the mesh has no size")
    detail = int(detail)
    h = longest / detail
    auto = seal == "auto"

    if auto:
        percent, _ = search_seal_percent(V, F, lo0, hi0, check_cancel)
        r_start = 1 if percent is None else seal_cells(percent, h, longest)
    else:
        r_start = seal_cells(float(seal), h, longest)
    r_limit = max(r_start, seal_cells(SEAL_MAX_PERCENT, h, longest))
    mark("find the seal", 0.15)

    lo, h, shape = make_grid(lo0, hi0, detail, PAD + r_limit + 1)
    skin = voxelize_skin(V, F, lo, h, shape, check_cancel)
    mark("voxelise the skin", 0.3)

    if auto:
        solid, r = fill_at_working_grid(skin, r_start, r_limit, check_cancel)
    else:
        solid, r = fill_with_seal(skin, r_start), r_start
    del skin
    solid, dropped = drop_islands(solid, float(loose) / 100.0)
    mark("fill the inside", 0.5)

    field = ndi.gaussian_filter(solid.astype(np.float32), SIGMA)
    del solid
    grid_verts, faces = marching_tetrahedra(field, ISO, check_cancel=check_cancel)
    del field
    if len(faces) == 0:
        raise ValueError("nothing solid was left after the rebuild")
    verts = lo + (grid_verts + 0.5) * h
    mark("build the surface", 0.7)

    points = tri_index = None
    folds = 0
    if keep_detail:
        verts, points, tri_index, folds = snap_to_surface(verts, faces, V, F, SNAP_MAX * h, check_cancel)
        mark("snap onto the original", 0.85)

    out_colours = None
    if colours is not None or (uvs is not None and texture is not None):
        if points is None:
            points, tri_index, _ = closest_points(verts, V, F, check_cancel=check_cancel)
        out_colours = transfer_colours(points, tri_index, V, F, colours, uvs, texture)
        mark("copy colours", 0.95)

    return {
        "vertices": verts.astype(np.float32),
        "faces": faces,
        "colours": out_colours,
        "seal_cells": int(r),
        "seal_percent": 100.0 * 2.0 * r * h / longest,
        "seal_auto": bool(auto),
        "islands_dropped": int(dropped),
        "folds_left": int(folds),
        "timings": timings,
        "seconds": round(time.perf_counter() - started, 3),
    }
