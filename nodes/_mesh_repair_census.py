"""What is wrong with a mesh, and a cut through it (built for the Mesh Repair node, replaced by Edit 3D on
2026-09-15; _mesh_repair_solid.py still imports weld_ids from here).

Pure numpy + scipy, so the harness can run it on any file. Every count here is
taken AFTER merging points that sit in the same place: a GLB duplicates points
along texture seams and normal splits, and without the merge every closed seam
reads as a hole. (That exact mistake inflated the Ep33 "holes per 1000
triangles" figures by about a thousand times - research notes, 2026-09-14.)
"""
import numpy as np
import scipy.ndimage as ndi
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

# 1e-6 of the bounding diagonal. Quantised positions stay below 2**20 per axis,
# so the three fit in one int64 key and np.unique runs on a flat array.
WELD_REL = 1e-6
LOOSE_FRACTION = 0.01


def weld_ids(V, rel_eps=WELD_REL):
    """Per-vertex id after merging points in the same place, and the id count."""
    V = np.asarray(V, dtype=np.float64).reshape(-1, 3)
    if len(V) == 0:
        return np.zeros(0, np.int64), 0
    lo = V.min(0)
    diag = float(np.linalg.norm(V.max(0) - lo)) or 1.0
    q = np.floor((V - lo) / (diag * rel_eps) + 0.5).astype(np.int64)
    np.clip(q, 0, (1 << 20) - 1, out=q)
    key = (q[:, 0] << 40) | (q[:, 1] << 20) | q[:, 2]
    _, inv = np.unique(key, return_inverse=True)
    inv = inv.reshape(-1).astype(np.int64)
    return inv, int(inv.max()) + 1


def edge_groups(W, nw):
    """The three directed edges of every face, grouped by the edge they lie on.

    Row r of `d` is face r % M, slot r // M (0: v0->v1, 1: v1->v2, 2: v2->v0).
    `order` sorts the rows so each edge's copies are adjacent; `starts` and
    `counts` describe those groups.
    """
    W = np.asarray(W, np.int64).reshape(-1, 3)
    d = np.concatenate([W[:, [0, 1]], W[:, [1, 2]], W[:, [2, 0]]], axis=0)
    lo = np.minimum(d[:, 0], d[:, 1])
    hi = np.maximum(d[:, 0], d[:, 1])
    key = lo * np.int64(max(1, nw)) + hi
    order = np.argsort(key, kind="stable")
    ks = key[order]
    if len(ks) == 0:
        empty = np.zeros(0, np.int64)
        return d, order, empty, empty
    starts = np.concatenate([[0], np.nonzero(ks[1:] != ks[:-1])[0] + 1]).astype(np.int64)
    counts = np.diff(np.concatenate([starts, [len(ks)]])).astype(np.int64)
    return d, order, starts, counts


def face_components(W, nw):
    """Label faces joined through any shared edge. Returns (labels, count)."""
    W = np.asarray(W, np.int64).reshape(-1, 3)
    M = len(W)
    if M == 0:
        return np.zeros(0, np.int64), 0
    d, order, starts, counts = edge_groups(W, nw)
    first = np.repeat(order[starts], counts) % M
    other = order % M
    link = first != other
    graph = coo_matrix((np.ones(int(link.sum()), np.float32), (first[link], other[link])), shape=(M, M))
    n, labels = connected_components(graph, directed=False)
    return labels.astype(np.int64), int(n)


def degenerate_faces(V, F, W):
    """Faces that repeat a merged point or have no area."""
    V = np.asarray(V, np.float64)
    bad = (W[:, 0] == W[:, 1]) | (W[:, 1] == W[:, 2]) | (W[:, 0] == W[:, 2])
    if len(F):
        diag = float(np.linalg.norm(V.max(0) - V.min(0))) or 1.0
        area2 = np.linalg.norm(np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]), axis=1)
        bad |= area2 < 1e-12 * diag * diag
    return bad


def census(V, F):
    """Counts of the defects a slicer cares about.

    holes      boundary loops (edges used by one face), after merging
    broken     edges shared by three or more faces (non-manifold)
    loose      pieces smaller than 1% of the biggest piece
    flipped    faces whose winding disagrees with a neighbour across an edge
    watertight no holes and no broken edges
    """
    V = np.asarray(V, np.float64).reshape(-1, 3)
    F = np.asarray(F, np.int64).reshape(-1, 3)
    out = {"triangles": int(len(F)), "holes": 0, "holeEdges": 0, "largestHole": 0,
           "broken": 0, "pieces": 0, "loose": 0, "flipped": 0, "degenerate": 0,
           "watertight": False}
    if len(F) == 0 or len(V) == 0:
        return out
    wid, nw = weld_ids(V)
    W = wid[F]
    bad = degenerate_faces(V, F, W)
    out["degenerate"] = int(bad.sum())
    W = W[~bad]
    M = len(W)
    if M == 0:
        return out

    d, order, starts, counts = edge_groups(W, nw)
    out["broken"] = int((counts > 2).sum())

    boundary = order[starts[counts == 1]]
    if len(boundary):
        pairs = np.sort(d[boundary], axis=1)
        nodes, inv = np.unique(pairs.reshape(-1), return_inverse=True)
        inv = inv.reshape(-1, 2)
        graph = coo_matrix((np.ones(len(inv), np.float32), (inv[:, 0], inv[:, 1])),
                           shape=(len(nodes), len(nodes)))
        n_loops, labels = connected_components(graph, directed=False)
        sizes = np.bincount(labels[inv[:, 0]], minlength=n_loops)
        out["holes"] = int(n_loops)
        out["holeEdges"] = int(len(boundary))
        out["largestHole"] = int(sizes.max())

    two = counts == 2
    r0 = order[starts[two]]
    r1 = order[starts[two] + 1]
    same_way = d[r0, 0] == d[r1, 0]
    out["flipped"] = int(len(np.unique(np.concatenate([r0[same_way] % M, r1[same_way] % M]))))

    labels, n_pieces = face_components(W, nw)
    sizes = np.bincount(labels, minlength=n_pieces)
    out["pieces"] = int(n_pieces)
    out["loose"] = int((sizes < LOOSE_FRACTION * sizes.max()).sum())
    out["watertight"] = out["holes"] == 0 and out["broken"] == 0
    return out


def pick_cut_axes(lo, hi):
    """(normal, across, up): cut through the thinnest side of the box, with Y as
    the picture's vertical whenever Y is one of the two picture axes."""
    ext = np.asarray(hi, np.float64) - np.asarray(lo, np.float64)
    normal = int(np.argmin(ext))
    rest = [a for a in (0, 1, 2) if a != normal]
    if 1 in rest:
        up = 1
        across = rest[0] if rest[1] == 1 else rest[1]
    else:
        across, up = rest
    return normal, across, up


def _scan(a0, b0, a1, b1, steps, lines):
    """Sweep lines of constant b along a. Yields (line index, span starts, span
    ends) where the running winding says the sweep is inside the model."""
    for index, value in enumerate(lines):
        hit = (b0 - value) * (b1 - value) < 0
        if not hit.any():
            continue
        x = a0[hit] + (value - b0[hit]) * (a1[hit] - a0[hit]) / (b1[hit] - b0[hit])
        order = np.argsort(x)
        x = x[order]
        winding = np.cumsum(steps[hit][order])
        inside = winding[:-1] > 0
        yield index, x[:-1][inside], x[1:][inside]


def cut_mask(V, F, lo, hi, axes, px=320):
    """A cut through the middle of the model: 255 where it is solid, 0 elsewhere.

    Each sweep counts the surfaces it crosses, +1 going in and -1 coming out,
    read from the face's own winding, so a hollow double skin comes out as a thin
    ring - exactly how a slicer reads it. The picture is swept along its ROWS and
    along its COLUMNS: a row sweep alone misses walls that lie almost parallel to
    it once they are thinner than a pixel, which left the Ep34 radio's top and
    bottom walls out of the ring and made it look solid.
    """
    V = np.asarray(V, np.float64).reshape(-1, 3)
    F = np.asarray(F, np.int64).reshape(-1, 3)
    lo = np.asarray(lo, np.float64)
    hi = np.asarray(hi, np.float64)
    normal, u, v = axes
    ext = hi - lo
    span = float(max(ext[u], ext[v])) or 1.0
    margin = 4
    scale = (px - 2 * margin) / span
    width = max(2 * margin + 1, int(round(ext[u] * scale)) + 2 * margin)
    height = max(2 * margin + 1, int(round(ext[v] * scale)) + 2 * margin)
    mask = np.zeros((height, width), np.uint8)
    if len(F) == 0:
        return mask

    centre = lo[normal] + 0.5 * ext[normal]
    tri = V[F]
    side = tri[:, :, normal] - centre
    side = np.where(side == 0.0, 1e-12 * span, side)
    above = side > 0
    n_above = above.sum(1)
    crossing = (n_above == 1) | (n_above == 2)
    if not crossing.any():
        return mask
    tri = tri[crossing]
    side = side[crossing]
    above = above[crossing]

    a = tri
    b = tri[:, [1, 2, 0]]
    sa = side
    sb = side[:, [1, 2, 0]]
    changes = above != above[:, [1, 2, 0]]
    # Edges without a sign change divide by zero here; they are never picked below.
    with np.errstate(divide="ignore", invalid="ignore"):
        t = sa / (sa - sb)
        points = a + (b - a) * t[..., None]
    pick = np.argsort(~changes, axis=1, kind="stable")[:, :2]
    rows = np.arange(len(tri))
    p0 = points[rows, pick[:, 0]]
    p1 = points[rows, pick[:, 1]]
    normals = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])

    step_u = np.where(normals[:, u] < 0, 1, -1).astype(np.int32)
    row_v = hi[v] - (np.arange(height) + 0.5 - margin) / scale
    for row, starts, ends in _scan(p0[:, u], p0[:, v], p1[:, u], p1[:, v], step_u, row_v):
        for s, e in zip(starts, ends):
            c0 = max(0, int(np.floor((s - lo[u]) * scale + margin)))
            c1 = min(width, int(np.ceil((e - lo[u]) * scale + margin)))
            if c1 > c0:
                mask[row, c0:c1] = 255

    step_v = np.where(normals[:, v] < 0, 1, -1).astype(np.int32)
    col_u = lo[u] + (np.arange(width) + 0.5 - margin) / scale
    for col, starts, ends in _scan(p0[:, v], p0[:, u], p1[:, v], p1[:, u], step_v, col_u):
        for s, e in zip(starts, ends):
            # v runs up the model while picture rows run down.
            r0 = max(0, int(np.floor((hi[v] - e) * scale + margin)))
            r1 = min(height, int(np.ceil((hi[v] - s) * scale + margin)))
            if r1 > r0:
                mask[r0:r1, col] = 255
    return mask


def crop_pair(a, b, pad=4):
    """Crop two same-size cut pictures to the area EITHER one uses, plus pad.

    The picture frame is the model's whole box, but the cut through the middle
    can use a small part of it (the radio's antenna nearly doubles its height),
    and the face scales the picture to fit. Both pictures get the same crop, so
    Before and After still line up when the view is switched.
    """
    a = np.asarray(a)
    b = np.asarray(b)
    used = (a > 0) | (b > 0)
    if not used.any():
        return a, b
    rows = np.nonzero(used.any(1))[0]
    cols = np.nonzero(used.any(0))[0]
    r0, r1 = max(0, rows[0] - pad), min(used.shape[0], rows[-1] + 1 + pad)
    c0, c1 = max(0, cols[0] - pad), min(used.shape[1], cols[-1] + 1 + pad)
    return a[r0:r1, c0:c1], b[r0:r1, c0:c1]


def solid_share(mask):
    """Percent of the cut's outline that is actually solid.

    100 for a real solid; small for a hollow skin, whose ring covers a sliver of
    the shape it outlines. The outline is the mask with a one-pixel closing (so
    a pinhole in the ring does not let the fill leak out) and its holes filled.
    """
    solid = np.asarray(mask) > 0
    if not solid.any():
        return None
    outline = ndi.binary_fill_holes(ndi.binary_closing(solid, iterations=1))
    total = int(outline.sum())
    if total == 0:
        return None
    return min(100.0, 100.0 * float(solid.sum()) / total)
