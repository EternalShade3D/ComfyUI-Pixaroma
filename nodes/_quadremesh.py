"""Quads for Edit 3D Pixaroma - pure geometry around the Instant Meshes engine.

Built for the Quad Remesh node, which Edit 3D replaced on 2026-09-15; its Quads button calls quad_remesh here
(.claude/patterns/quad-remesh.md #1 to #6 still hold for this file).

No torch and no ComfyUI imports: D:\\Claude Tests\\_quad_remesh_test.py (section A) runs it directly.
Every step here was measured on the Ep34 gun first, with renders
(output/claude_output/quad_remesh_proto/README.txt, prototype D:\\Claude Tests\\_quad_remesh_proto\\qr_proto.py):

- The engine is pyinstantmeshes.remesh_file, crease 30 + extrinsic: its default settings melt the details.
- It often WRITES its result and then raises reading that file back ("Invalid vertex data"), and the file
  holds faces with a repeated corner: read it here and clean them.
- It holds Python's lock for its whole run, and is not repeatable even with its deterministic option.
- Input: weld by position, drop faces that collapse onto an edge, KEEP flat slivers (deleting them opens
  cracks), flip them into real triangles.
- Symmetry: remesh a half that reaches past the mirror plane, snap points very near the plane onto it,
  clip exactly at the plane, mirror, weld. Cutting first and snapping afterwards pulled points 4-5 mm.
- Holes the engine leaves (it will not fill loops of 7 or more edges) are closed with fans, loops through a
  point twice split first; holes the model itself has stay open.
"""
from __future__ import annotations

import os
import shutil
import time

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

from . import _mesh3d as m3
from ._mesh_repair_solid import closest_points, transfer_colours

PRINT_MM = 100.0
CREASE_ANGLE = 30.0       # crisp edges: crease 30 + extrinsic (renders/crops_three_quarter.png)
EXTEND_EDGES = 3.0        # symmetry: remesh this many edge lengths past the plane
SEAM_SNAP = 0.3           # points this close to the plane (in edge lengths) go onto it before the clip
MIRROR_MEDIAN_MM = 0.3    # Auto mirrors only when the median is below this ...
MIRROR_FAR_MM = 1.0       # ... and no more than MIRROR_FAR_SHARE of the surface is farther than this
MIRROR_FAR_SHARE = 0.001  # (the gun: median 0.13 mm, nothing beyond 1 mm; a 0.8% plateau is refused)
FLAT = 0.01               # a triangle this flat (height / longest edge) is a sliver
FILL_MAX = 600            # the longest hole loop that is walked
FLIP_SLIVERS = True       # step7: never worse, and better on a model Hard Surface sharpened
OFF_SAMPLES = 60000       # points spread over the new faces to measure how far they sit off the input
MIN_PIECE_FACES = 8       # a separate piece with fewer faces is an engine leftover, not a part (step11)


class EngineMissing(RuntimeError):
    """pyinstantmeshes is not installed, or does not load in this Python."""


ENGINE_MESSAGE = (
    "[Pixaroma] Edit 3D Pixaroma: the Instant Meshes engine (the pyinstantmeshes package) is not installed, "
    "and it is needed to lay the quads.\n"
    "   Updating the Pixaroma pack with ComfyUI Manager installs it. Or install it yourself:\n"
    "     Portable ComfyUI (Windows) - run this in your ComfyUI folder\n"
    "       (the one that holds the python_embeded folder):\n"
    "         python_embeded\\python.exe -m pip install pyinstantmeshes==1.0.0\n"
    "     Or in ComfyUI Manager, use its pip install option and enter: pyinstantmeshes==1.0.0\n"
    "     Your own Python (venv/conda): pip install pyinstantmeshes==1.0.0\n"
    "   It has ready packages for Windows, Linux on Intel or AMD, and Macs with Apple chips.\n")


# ── polygon bookkeeping ──────────────────────────────────────────────────────

def face_layout(counts):
    counts = np.asarray(counts, np.int64)
    starts = np.concatenate([[0], np.cumsum(counts)[:-1]]).astype(np.int64)
    face_of = np.repeat(np.arange(len(counts)), counts)
    return counts, starts, face_of


def unique_edges(counts, idx):
    """-> (undirected edges, how many faces use each)."""
    counts, starts, face_of = face_layout(counts)
    idx = np.asarray(idx, np.int64)
    nxt = np.arange(len(idx)) + 1
    ends = starts[face_of] + counts[face_of]
    nxt = np.where(nxt == ends, starts[face_of], nxt)
    E = np.sort(np.stack([idx, idx[nxt]], 1), 1)
    E = E[E[:, 0] != E[:, 1]]
    if not len(E):
        return np.zeros((0, 2), np.int64), np.zeros(0, np.int64)
    return np.unique(E, axis=0, return_counts=True)


def clean_faces(poly):
    """A corner repeated in a face is kept once (a quad with a doubled corner becomes a triangle); faces left
    with fewer than three corners go. -> (PolyMesh, faces changed, faces dropped)"""
    counts, starts, face_of = face_layout(poly.counts)
    idx = np.asarray(poly.indices, np.int64)
    key = face_of * (len(poly.vertices) + 1) + idx
    distinct = np.bincount(face_of[np.unique(key, return_index=True)[1]], minlength=len(counts))
    fix = np.nonzero(distinct < counts)[0]
    if not len(fix):
        return poly, 0, 0
    keep = np.ones(len(counts), bool)
    rings = {}
    for f in fix.tolist():
        ring = []
        for v in idx[starts[f]:starts[f] + counts[f]].tolist():
            if v not in ring:
                ring.append(v)
        if len(ring) >= 3:
            rings[f] = ring
        else:
            keep[f] = False
    new_counts, new_idx = [], []
    for f in range(len(counts)):
        if not keep[f]:
            continue
        ring = rings.get(f)
        if ring is None:
            ring = idx[starts[f]:starts[f] + counts[f]].tolist()
        new_counts.append(len(ring))
        new_idx.extend(ring)
    groups = None if poly.groups is None else np.asarray(poly.groups)[keep]
    out = m3.PolyMesh(vertices=np.asarray(poly.vertices, np.float64), counts=np.asarray(new_counts, np.int32),
                      indices=np.asarray(new_idx, np.int64), colours=poly.colours, groups=groups,
                      group_names=list(poly.group_names or []))
    return out, int(len(fix) - (~keep).sum()), int((~keep).sum())


# ── the input ────────────────────────────────────────────────────────────────

def prepare_triangles(V, T, drop_flat=False):
    """One vertex per place (numbered by first appearance); faces that collapse onto an edge left out. Flat
    slivers stay unless `drop_flat`: deleting one opens a crack beside it (step2: 544-758 open edges kept,
    1,035-2,759 deleted). -> (vertices faces use, faces, faces dropped)"""
    V = np.asarray(V, np.float64)
    T = np.asarray(T, np.int64)
    ids, count = m3.weld_ids(V)
    _u, first = np.unique(ids, return_index=True)
    rank = np.empty(count, np.int64)
    rank[np.argsort(first, kind="stable")] = np.arange(count)
    ids = rank[ids]
    W = V[np.sort(first)]
    G = ids[T]
    ok = (G[:, 0] != G[:, 1]) & (G[:, 1] != G[:, 2]) & (G[:, 0] != G[:, 2])
    if drop_flat:
        diag = float(np.linalg.norm(W.max(0) - W.min(0)))
        a, b, c = W[G[:, 0]], W[G[:, 1]], W[G[:, 2]]
        ok &= np.linalg.norm(np.cross(b - a, c - a), axis=1) > (diag * 1e-9) ** 2
    G = G[ok]
    used = np.unique(G)
    remap = np.full(len(W), -1, np.int64)
    remap[used] = np.arange(len(used))
    return W[used], remap[G], int((~ok).sum())


def flip_slivers(V, F, flat=FLAT, passes=10):
    """A triangle flattened into a line (a closed bevel leaves thousands) gets its longest edge flipped with
    the triangle across that edge: the pair becomes two real triangles, no point moves and none is added.
    -> (faces, flips made, flat triangles left)"""
    V = np.asarray(V, np.float64)
    F = np.array(F, np.int64, copy=True)
    nv, nf = len(V), len(F)
    flips = 0

    def flat_faces():
        P = V[F]
        edges = np.stack([P[:, 2] - P[:, 1], P[:, 0] - P[:, 2], P[:, 1] - P[:, 0]], 1)
        L = np.linalg.norm(edges, axis=2)
        k = L.argmax(1)
        longest = L[np.arange(nf), k]
        area2 = np.linalg.norm(np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]), axis=1)
        return np.nonzero((longest > 0) & (area2 < flat * longest * longest))[0], k

    if not nf:
        return F, 0, 0
    for _ in range(passes):
        bad, k = flat_faces()
        if not len(bad):
            break
        E = np.stack([F[:, [1, 2]], F[:, [2, 0]], F[:, [0, 1]]], 1)
        keys = (np.minimum(E[..., 0], E[..., 1]) * nv + np.maximum(E[..., 0], E[..., 1])).reshape(-1)
        order = np.argsort(keys, kind="stable")
        sk = keys[order]
        existing = set(sk.tolist())
        touched = np.zeros(nf, bool)
        done = 0
        for f in bad.tolist():
            if touched[f]:
                continue
            kk = int(k[f])
            key = int(keys[f * 3 + kk])
            lo = int(np.searchsorted(sk, key, "left"))
            if lo + 2 > len(sk) or sk[lo + 1] != key or (lo + 2 < len(sk) and sk[lo + 2] == key):
                continue
            e0, e1 = int(order[lo]) // 3, int(order[lo + 1]) // 3
            g = e1 if e0 == f else e0
            if g == f or touched[g]:
                continue
            m, a, b = int(F[f, kk]), int(F[f, (kk + 1) % 3]), int(F[f, (kk + 2) % 3])
            row = [int(v) for v in F[g]]
            if a not in row or b not in row:
                continue
            ib = row.index(b)
            if row[(ib + 1) % 3] != a:
                continue
            x = row[(ib + 2) % 3]
            if x == m:
                continue
            new_key = min(m, x) * nv + max(m, x)
            if new_key in existing:
                continue
            nu = np.cross(V[row[1]] - V[row[0]], V[row[2]] - V[row[0]])
            if (np.dot(np.cross(V[a] - V[m], V[x] - V[m]), nu) <= 0
                    or np.dot(np.cross(V[x] - V[m], V[b] - V[m]), nu) <= 0):
                continue
            F[f] = (m, a, x)
            F[g] = (m, x, b)
            existing.add(new_key)
            touched[f] = touched[g] = True
            done += 1
        flips += done
        if not done:
            break
    return F, flips, int(len(flat_faces()[0]))


# ── symmetry ─────────────────────────────────────────────────────────────────

def surface_samples(V, F, n, seed):
    rng = np.random.default_rng(seed)
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    area = np.linalg.norm(np.cross(b - a, c - a), axis=1) / 2
    tri = rng.choice(len(F), size=n, p=area / area.sum())
    r1 = np.sqrt(rng.random(n))
    r2 = rng.random(n)
    return (1 - r1)[:, None] * a[tri] + (r1 * (1 - r2))[:, None] * b[tri] + (r1 * r2)[:, None] * c[tri]


def reflect(P, ax, plane):
    R = np.array(P, np.float64, copy=True)
    R[:, ax] = 2 * plane - R[:, ax]
    return R


def find_plane(tree, q, lo, hi, diag, axes=(0, 1, 2)):
    """The axis and plane whose reflection lands the samples closest to the surface: a coarse search around
    the middle of the box on each axis, then a fine one around the best."""
    best = None
    for ax in axes:
        mid = (lo[ax] + hi[ax]) / 2
        for off in np.linspace(-0.03, 0.03, 25) * diag:
            d, _ = tree.query(reflect(q, ax, mid + off), workers=-1)
            med = float(np.median(d))
            if best is None or med < best[0]:
                best = (med, ax, mid + off)
    step = 0.06 * diag / 24
    _med, ax, c0 = best
    for c in c0 + np.linspace(-step, step, 41):
        d, _ = tree.query(reflect(q, ax, c), workers=-1)
        med = float(np.median(d))
        if med < best[0]:
            best = (med, ax, c)
    return best[1], best[2]


def find_mirror(V, F, axis="auto", seed=11):
    """-> (axis index, plane, median mm, share farther than MIRROR_FAR_MM) when the surface mirrors well
    enough, else None. `axis` "x" / "y" / "z" forces the axis; the plane is still searched along it."""
    V = np.asarray(V, np.float64)
    F = np.asarray(F, np.int64)
    if not len(F):
        return None
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    if not float(np.linalg.norm(np.cross(b - a, c - a), axis=1).sum()) > 0:
        return None
    used = V[np.unique(F)]
    lo, hi = used.min(0), used.max(0)
    diag = float(np.linalg.norm(hi - lo))
    scale = PRINT_MM / float(max((hi - lo).max(), 1e-12))
    pts = surface_samples(V, F, 400000, seed)
    tree = cKDTree(pts)
    rng = np.random.default_rng(seed + 1)
    q = pts[rng.choice(len(pts), 20000, replace=False)]
    axes = (0, 1, 2) if axis == "auto" else ("xyz".index(axis),)
    ax, plane = find_plane(tree, q, lo, hi, diag, axes)
    # 100,000 points, so a 0.1% share is 100 of them and not noise.
    tail = pts[rng.choice(len(pts), 100000, replace=False)]
    d, _ = tree.query(reflect(tail, ax, plane), workers=-1)
    d = d * scale
    median, far = float(np.median(d)), float((d > MIRROR_FAR_MM).mean())
    if axis == "auto" and (median > MIRROR_MEDIAN_MM or far > MIRROR_FAR_SHARE):
        return None
    return ax, plane, median, far


def clip_polygons(V, counts, idx, ax, plane, eps, snap_len=0.0):
    """Keep what lies on the positive side of the plane; polygons that cross it are cut exactly at it
    (Sutherland-Hodgman per polygon; a cut edge's new vertex is shared by both polygons on that edge).
    With `snap_len`, points within it of the plane go onto the plane first, so the cut runs through them
    instead of leaving slivers (step6: seam slivers about 400 -> 2-4).
    -> (vertices, counts, indices, polygons cut)"""
    V = np.array(V, np.float64, copy=True)
    if snap_len > 0:
        dist = np.abs(V[:, ax] - plane)
        V[(dist < snap_len) & (dist > eps), ax] = plane
    counts, starts, face_of = face_layout(counts)
    idx = np.asarray(idx, np.int64)
    s = V[:, ax] - plane
    on = np.abs(s) <= eps
    V[on, ax] = plane
    s[on] = 0.0
    S = s[idx]
    pos = np.bincount(face_of, weights=(S > 0).astype(np.float64), minlength=len(counts)) > 0
    neg = np.bincount(face_of, weights=(S < 0).astype(np.float64), minlength=len(counts)) > 0
    whole, cross = pos & ~neg, pos & neg
    new_v, key = [], {}

    def cut(i, j):
        k = (i, j) if i < j else (j, i)
        if k not in key:
            t = s[i] / (s[i] - s[j])
            p = V[i] + (V[j] - V[i]) * t
            p[ax] = plane
            key[k] = len(V) + len(new_v)
            new_v.append(p)
        return key[k]

    out_counts = counts[whole].tolist()
    out_idx = idx[whole[face_of]].tolist()
    for f in np.nonzero(cross)[0].tolist():
        ring = idx[starts[f]:starts[f] + counts[f]]
        pts = []
        n = len(ring)
        for m in range(n):
            i, j = int(ring[m]), int(ring[(m + 1) % n])
            if s[i] >= 0:
                pts.append(i)
            if (s[i] > 0 > s[j]) or (s[i] < 0 < s[j]):
                pts.append(cut(i, j))
        if len(pts) >= 3:
            out_counts.append(len(pts))
            out_idx.extend(pts)
    if new_v:
        V = np.vstack([V, np.asarray(new_v)])
    idx2 = np.asarray(out_idx, np.int64)
    used = np.unique(idx2)
    remap = np.full(len(V), -1, np.int64)
    remap[used] = np.arange(len(used))
    return V[used], np.asarray(out_counts, np.int64), remap[idx2], int(cross.sum())


def mirror_join(V, counts, idx, weld, ax, plane, diag, reverse=True):
    """V + its mirror image, each vertex in `weld` joined to its own image. The image's polygons are reversed,
    or the mirrored half would face inward (`reverse` is off only for a harness mutation).
    -> (PolyMesh, open edges lying on the plane, seam vertices)"""
    counts, starts, face_of = face_layout(counts)
    idx = np.asarray(idx, np.int64)
    V = np.asarray(V, np.float64)
    n = len(V)
    if reverse:
        local = np.arange(len(idx)) - starts[face_of]
        image = idx[starts[face_of] + (counts[face_of] - 1 - local)]
    else:
        image = idx
    mapping = np.arange(2 * n)
    seam_ids = np.nonzero(weld)[0]
    mapping[n + seam_ids] = seam_ids
    all_idx = mapping[np.concatenate([idx, image + n])]
    all_v = np.vstack([V, reflect(V, ax, plane)])
    used = np.unique(all_idx)
    remap = np.full(2 * n, -1, np.int64)
    remap[used] = np.arange(len(used))
    poly = m3.PolyMesh(vertices=all_v[used], counts=np.concatenate([counts, counts]).astype(np.int32),
                       indices=remap[all_idx])
    E2, cnt2 = unique_edges(poly.counts, poly.indices)
    P = np.asarray(poly.vertices, np.float64)
    open2 = E2[cnt2 == 1]
    on_plane = (np.abs(P[open2[:, 0], ax] - plane) <= 1e-9 * diag) & (np.abs(P[open2[:, 1], ax] - plane) <= 1e-9 * diag)
    return poly, int(on_plane.sum()), int(len(seam_ids))


# ── holes ────────────────────────────────────────────────────────────────────

def drop_fragments(poly, min_faces=MIN_PIECE_FACES):
    """Separate pieces with fewer than `min_faces` faces left out, with the points only they used. Pieces are
    found on points welded by position, like the edge census. The engine leaves such bits around a model's
    broken spots: they took the rifle from 10 pieces to 55 and the gun from 15 to 21, and dropping them just
    before the holes are filled gave 9 and 15 (README step11_models). -> (poly, faces dropped)"""
    counts = np.asarray(poly.counts, np.int64)
    if min_faces <= 0 or not len(counts):
        return poly, 0
    idx = np.asarray(poly.indices, np.int64)
    wid, nv = m3.weld_ids(poly.vertices)
    w = wid[idx]
    starts = np.concatenate([[0], np.cumsum(counts)[:-1]])
    first = np.repeat(starts, counts)
    corner = np.arange(len(w))
    nxt = np.where(corner - first + 1 == np.repeat(counts, counts), first, corner + 1)
    _n, label = connected_components(coo_matrix((np.ones(len(w)), (w, w[nxt])), shape=(nv, nv)), directed=False)
    face_label = label[w[starts]]
    keep = np.bincount(face_label)[face_label] >= min_faces
    if keep.all():
        return poly, 0
    kept_idx = idx[np.repeat(keep, counts)]
    used = np.unique(kept_idx)
    remap = np.full(len(poly.vertices), -1, np.int64)
    remap[used] = np.arange(len(used))
    return (m3.PolyMesh(vertices=np.asarray(poly.vertices, np.float64)[used], counts=counts[keep].astype(np.int32),
                        indices=remap[kept_idx],
                        colours=None if poly.colours is None else np.asarray(poly.colours)[used],
                        groups=None if poly.groups is None else np.asarray(poly.groups)[keep],
                        group_names=list(poly.group_names or [])),
            int((~keep).sum()))


def split_at_repeats(verts):
    """A vertex loop that passes a point more than once -> simple loops of 3 or more points. One fan over a
    loop through a point twice uses that point's edges twice (step8 added broken edges that way)."""
    loops, stack, pos = [], [], {}
    for vtx in verts:
        if vtx in pos:
            i = pos[vtx]
            sub = stack[i:]
            if len(sub) >= 3:
                loops.append(sub)
            for x in sub[1:]:
                pos.pop(x, None)
            del stack[i + 1:]
        else:
            pos[vtx] = len(stack)
            stack.append(vtx)
    if len(stack) >= 3:
        loops.append(stack)
    return loops


def boundary_loops(counts, idx, nv, max_len=FILL_MAX):
    """Open boundaries as simple vertex loops, walked half-edge by half-edge in the direction their faces run.
    An edge is open when exactly ONE face uses it (the census's rule). Where boundaries touch at a point, the
    walk turns through that point's faces to the open edge of the same fan. A walk that cannot close marks
    only its own start, so a loop reached later from inside still closes.
    -> (loops, open half-edges in no closed loop)"""
    counts, starts, face_of = face_layout(counts)
    idx = np.asarray(idx, np.int64)
    if not len(idx):
        return [], 0
    nxt = np.arange(len(idx)) + 1
    ends = starts[face_of] + counts[face_of]
    nxt = np.where(nxt == ends, starts[face_of], nxt)
    a, b, c = idx, idx[nxt], idx[nxt[nxt]]
    keep = a != b
    a, b, c = a[keep], b[keep], c[keep]
    und = np.minimum(a, b) * nv + np.maximum(a, b)
    _u, inv, cnt = np.unique(und, return_inverse=True, return_counts=True)
    single = cnt[inv.reshape(-1)] == 1
    # half-edge a->b -> the vertex after b in the same face (so its next half-edge is b->c)
    fwd = dict(zip((a * nv + b).tolist(), c.tolist()))
    open_half = (a[single] * nv + b[single]).tolist()
    is_open = set(open_half)
    visited, failed, loops = set(), set(), []
    for start in open_half:
        if start in visited or start in failed:
            continue
        walk, seen_here, h, closed = [], set(), start, False
        for _ in range(max_len + 1):
            walk.append(h)
            seen_here.add(h)
            v = h % nv
            w = fwd[h]
            found = None
            for _turn in range(64):
                cand = v * nv + w
                if cand in is_open:
                    found = cand
                    break
                twin_next = fwd.get(w * nv + v)
                if twin_next is None:
                    break
                w = twin_next
            if found is None:
                break
            if found == start:
                closed = True
                break
            if found in visited or found in seen_here:
                break
            h = found
        if not closed:
            failed.add(start)
            continue
        visited.update(walk)
        loops.extend(split_at_repeats([hh // nv for hh in walk]))
    return loops, len(is_open) - len(visited)


def fill_holes(poly, V_in, F_in, edge_len, max_len=FILL_MAX, keep_input_holes=True):
    """Close the holes the quads left where the input had none: a loop of up to 4 corners becomes one face,
    a longer one a fan of triangles around its middle, put back onto the input's surface. A loop that follows
    an open edge of the input stays open (`keep_input_holes` is off only for a harness mutation).
    -> (PolyMesh, stats)"""
    V = np.asarray(poly.vertices, np.float64)
    V_in = np.asarray(V_in, np.float64)
    F_in = np.asarray(F_in, np.int64)
    loops, stray = boundary_loops(poly.counts, poly.indices, len(V), max_len)
    tree = None
    if keep_input_holes and len(F_in):
        E, cnt = unique_edges(np.full(len(F_in), 3), F_in.reshape(-1))
        open_in = E[cnt == 1]
        if len(open_in):
            P0, P1 = V_in[open_in[:, 0]], V_in[open_in[:, 1]]
            L = np.linalg.norm(P1 - P0, axis=1)
            n = np.maximum(1, np.ceil(L / max(0.5 * edge_len, 1e-12))).astype(np.int64)
            seg = np.repeat(np.arange(len(L)), n)
            t = (np.arange(int(n.sum())) - np.repeat(np.cumsum(n) - n, n) + 0.5) / np.repeat(n, n)
            tree = cKDTree(P0[seg] + (P1[seg] - P0[seg]) * t[:, None])
    fill, kept = [], 0
    for loop in loops:
        Lv = np.asarray(loop, np.int64)
        if tree is not None:
            d, _ = tree.query(V[Lv])
            if (d < 2.0 * edge_len).mean() >= 0.5:
                kept += 1
                continue
        fill.append(Lv)
    stats = {"holes_filled": len(fill), "holes_kept_open": kept, "open_edges_not_in_loops": int(stray)}
    if not fill:
        return poly, stats
    fans = [Lv for Lv in fill if len(Lv) > 4]
    centres = np.zeros((0, 3))
    if fans:
        mids = np.stack([V[Lv].mean(0) for Lv in fans])
        centres, _ti, _d = closest_points(mids, V_in, F_in)
    new_counts, new_idx, j = [], [], 0
    for Lv in fill:
        n = len(Lv)
        if n <= 4:
            new_counts.append(n)
            new_idx.extend(Lv[::-1].tolist())
        else:
            c = len(V) + j
            j += 1
            for i in range(n):
                new_counts.append(3)
                new_idx.extend([int(Lv[(i + 1) % n]), int(Lv[i]), c])
    out = m3.PolyMesh(vertices=np.vstack([V, centres]) if len(centres) else V,
                      counts=np.concatenate([np.asarray(poly.counts, np.int32), np.asarray(new_counts, np.int32)]),
                      indices=np.concatenate([np.asarray(poly.indices, np.int64), np.asarray(new_idx, np.int64)]),
                      colours=None, groups=None, group_names=[])
    stats.update(fill_faces=len(new_counts), fill_largest=int(max(len(Lv) for Lv in fill)))
    return out, stats


# ── the engine ───────────────────────────────────────────────────────────────

def engine_available():
    try:
        import pyinstantmeshes  # noqa: F401
    except Exception:
        return False
    return True


def _engine():
    try:
        import pyinstantmeshes
    except Exception as exc:
        raise EngineMissing(ENGINE_MESSAGE) from exc
    return pyinstantmeshes


def write_triangles_obj(path, V, F):
    with open(path, "w", encoding="ascii") as fh:
        np.savetxt(fh, np.asarray(V, np.float64), fmt="v %.9g %.9g %.9g")
        np.savetxt(fh, np.asarray(F, np.int64) + 1, fmt="f %d %d %d")


def run_engine(pim, src, dst, **kw):
    """remesh_file, tolerating its read-back failure once the file is written.
    -> the engine's complaint, or None."""
    try:
        pim.remesh_file(src, dst, **kw)
        return None
    except RuntimeError as exc:
        if os.path.isfile(dst) and os.path.getsize(dst) > 0:
            return str(exc)
        raise


def remesh_triangles(V, F, target_faces, crisp, work_dir):
    """One engine run on a welded triangle mesh -> a cleaned PolyMesh of quads."""
    pim = _engine()
    os.makedirs(work_dir, exist_ok=True)
    src = os.path.join(work_dir, "in.obj")
    dst = os.path.join(work_dir, "out.obj")
    write_triangles_obj(src, V, F)
    run_engine(pim, src, dst, target_face_count=int(max(target_faces, 100)),
               crease_angle=CREASE_ANGLE if crisp else -1.0, extrinsic=True)
    with open(dst, "rb") as fh:
        poly = m3.read_obj(fh.read())
    return clean_faces(poly)[0]


# ── carrying the model over, and measuring ───────────────────────────────────

def transfer(out, V_in, F_in, colours=None, uvs=None, texture=None, tri_groups=None):
    """Colours for the new vertices and groups for the new faces, from the input surface under them.
    -> (colours or None, groups or None)"""
    V = np.asarray(out.vertices, np.float64)
    V_in = np.asarray(V_in, np.float64)
    F_in = np.asarray(F_in, np.int64)
    new_colours = None
    if colours is not None or (uvs is not None and texture is not None):
        pts, tri, _d = closest_points(V, V_in, F_in)
        ok = tri >= 0
        got = transfer_colours(pts[ok], tri[ok], V_in, F_in, colours=colours, uvs=uvs, texture=texture)
        if got is not None:
            new_colours = np.ones((len(V), 3), np.float32)
            new_colours[ok] = got
    groups = None
    if tri_groups is not None and len(out.counts):
        counts, starts, _face_of = face_layout(out.counts)
        centres = np.add.reduceat(V[np.asarray(out.indices, np.int64)], starts, axis=0) / counts[:, None]
        _p, tri, _d = closest_points(centres, V_in, F_in)
        tri_groups = np.asarray(tri_groups, np.int32)
        groups = np.where(tri >= 0, tri_groups[np.maximum(tri, 0)], 0).astype(np.int32)
    return new_colours, groups


def off_input(out, V_in, F_in, seed=3):
    """How far the new SURFACE sits from the input surface, in mm on a 100 mm print, measured at OFF_SAMPLES
    points spread over the new faces by area. Not at the corners: the engine puts those on the input, so a
    corner measure reads near zero while the faces between them cut across (harness A12). A mesh with no
    area to spread points over is measured at its corners."""
    V = np.asarray(out.vertices, np.float64)
    V_in = np.asarray(V_in, np.float64)
    F_in = np.asarray(F_in, np.int64)
    used = V_in[np.unique(F_in)]
    scale = PRINT_MM / float(max((used.max(0) - used.min(0)).max(), 1e-12))
    pts = V
    if OFF_SAMPLES > 0 and len(np.asarray(out.counts)):
        _v, T, _c = m3.triangulate(out)
        T = np.asarray(T, np.int64)
        area = np.linalg.norm(np.cross(V[T[:, 1]] - V[T[:, 0]], V[T[:, 2]] - V[T[:, 0]]), axis=1)
        T = T[np.isfinite(area) & (area > 0)]
        if len(T):
            pts = surface_samples(V, T, OFF_SAMPLES, seed)
    _p, _t, d = closest_points(pts, V_in, F_in)
    d = d[np.isfinite(d)] * scale
    return {"mean_mm": round(float(d.mean()), 4) if len(d) else 0.0,
            "p95_mm": round(float(np.percentile(d, 95)), 4) if len(d) else 0.0}


# ── the whole run ────────────────────────────────────────────────────────────

def quad_remesh(poly, params, work_dir, cancel=None, uvs=None, texture=None):
    """A PolyMesh -> {"poly": the quads (colours, groups), "stats": dict}.

    `params`: quads, symmetry ("off" / "auto" / "x" / "y" / "z"), crisp, keepColours, keepGroups.
    `work_dir` must be this run's own folder; it is removed once the engine is done. `uvs` + `texture`
    ((H, W, 3) floats) let a textured model's colours reach the new points; vertex colours come from `poly`.
    `cancel` is called between the steps and may raise to stop."""
    started = time.perf_counter()

    def step():
        if cancel:
            cancel()

    _engine()  # fail before any work when the engine is missing
    V0 = np.asarray(poly.vertices, np.float64)
    _v, T0, C0 = m3.triangulate(poly)
    T0 = np.asarray(T0, np.int64).reshape(-1, 3)
    good = np.isfinite(V0).all(1)[T0].all(1) if len(T0) else np.zeros(0, bool)
    T0f = T0[good]
    if not len(T0f):
        raise ValueError("Quads: the model has no faces with real positions, so there is nothing to remesh.")
    # Colours, uvs and groups are read from the UNWELDED triangles: welding merges a texture seam's two copies,
    # and a triangle across the seam would then blend uvs from two different charts.
    tri_groups = None
    if params.get("keepGroups", True) and poly.groups is not None:
        per_face = np.asarray(poly.counts, np.int64) - 2
        tri_groups = np.repeat(np.asarray(poly.groups, np.int32), per_face)[good]
    # The engine and the hole test need ONE point per place (a seam must not read as an open edge).
    V, F, collapsed = prepare_triangles(V0, T0f)
    if not len(F):
        # Every face collapsed into a line or a point once its points were welded (harness A14).
        raise ValueError("Quads: every face of the model has collapsed into a line or a point, "
                         "so there is nothing to remesh.")
    flips = 0
    if FLIP_SLIVERS:
        F, flips, _left = flip_slivers(V, F)
    step()
    lo, hi = V.min(0), V.max(0)
    diag = float(np.linalg.norm(hi - lo))
    eps = 1e-7 * diag
    area = float(np.linalg.norm(np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]), axis=1).sum() / 2)
    target = int(params.get("quads", 25000))
    crisp = bool(params.get("crisp", True))
    symmetry = str(params.get("symmetry", "auto"))
    mirror = find_mirror(V, F, symmetry) if symmetry != "off" else None
    step()
    stats = {"collapsed_faces": collapsed, "slivers_flipped": flips}
    try:
        if mirror is None:
            out = remesh_triangles(V, F, target, crisp, os.path.join(work_dir, "whole"))
        else:
            ax, plane, median, far = mirror
            margin = EXTEND_EDGES * np.sqrt(area / max(target, 1))
            keep = ((V[:, ax] - plane)[F] >= -margin).any(1)
            used = np.unique(F[keep])
            remap = np.full(len(V), -1, np.int64)
            remap[used] = np.arange(len(used))
            hV, hF = V[used], remap[F[keep]]
            h_area = float(np.linalg.norm(np.cross(hV[hF[:, 1]] - hV[hF[:, 0]], hV[hF[:, 2]] - hV[hF[:, 0]]), axis=1).sum() / 2)
            grown = remesh_triangles(hV, hF, int(target * h_area / max(area, 1e-30)), crisp, os.path.join(work_dir, "half"))
            GE, _gc = unique_edges(grown.counts, grown.indices)
            GV = np.asarray(grown.vertices, np.float64)
            edge = float(np.linalg.norm(GV[GE[:, 0]] - GV[GE[:, 1]], axis=1).mean()) if len(GE) else 0.0
            cV, cC, cI, _cut = clip_polygons(GV, grown.counts, grown.indices, ax, plane, eps, SEAM_SNAP * edge)
            on = np.abs(cV[:, ax] - plane) <= eps
            out, seam_open, _seam = mirror_join(cV, cC, cI, on, ax, plane, diag)
            stats.update(symmetry_axis="xyz"[ax], mirror_median_mm=round(median, 3), mirror_far_share=round(far, 5),
                         seam_open=seam_open)
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
    step()
    out, fragments = drop_fragments(out, MIN_PIECE_FACES)
    stats["fragment_faces_dropped"] = fragments
    OE, _oc = unique_edges(out.counts, out.indices)
    OV = np.asarray(out.vertices, np.float64)
    edge_len = float(np.linalg.norm(OV[OE[:, 0]] - OV[OE[:, 1]], axis=1).mean()) if len(OE) else 0.0
    out, fill = fill_holes(out, V, F, edge_len)
    stats.update(fill)
    step()
    keep_colours = bool(params.get("keepColours", True))
    new_colours, groups = transfer(out, V0, T0f,
                                   colours=C0 if keep_colours else None,
                                   uvs=uvs if keep_colours else None,
                                   texture=texture if keep_colours else None,
                                   tri_groups=tri_groups)
    out = m3.PolyMesh(vertices=np.asarray(out.vertices, np.float64), counts=np.asarray(out.counts, np.int32),
                      indices=np.asarray(out.indices, np.int64), colours=new_colours, groups=groups,
                      group_names=list(poly.group_names or []) if groups is not None else [])
    counts = np.asarray(out.counts)
    stats.update(off_input(out, V0, T0f))
    stats.update(quads=int((counts == 4).sum()), triangles=int((counts == 3).sum()), ngons=int((counts > 4).sum()),
                 faces=int(len(counts)), quads_pct=round(float((counts == 4).mean()) * 100, 2) if len(counts) else 0.0,
                 seconds=round(time.perf_counter() - started, 2))
    return {"poly": out, "stats": stats}
