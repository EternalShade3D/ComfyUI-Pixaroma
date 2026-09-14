"""Mesh Repair Pixaroma - Tidy only: clean a mesh while keeping its triangles.

For a model whose shape is fine and whose UV textures must survive. It removes
faces with no area and exact duplicates that wind the same way (a reversed copy
is the other side of a thin part and stays), drops loose pieces, turns faces so
each piece agrees with itself and points outward, and closes small holes with a
fan.
It does NOT fill a hollow model - that needs the rebuild in _mesh_repair_solid.

Pure numpy + scipy.
"""
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import breadth_first_order, connected_components

from ._mesh_repair_census import degenerate_faces, edge_groups, face_components, weld_ids

MAX_HOLE_EDGES = 16


def _orient(W, M_real):
    """Flip flags so every piece winds consistently.

    Across a manifold edge two faces agree when they walk it in opposite
    directions. A breadth-first tree from a virtual root joined to one face of
    every piece gives each face a path; the XOR of the disagreements along it is
    whether that face must flip. The XOR is gathered by pointer jumping, so no
    Python loop runs per face.
    """
    nw = int(W.max()) + 1 if len(W) else 1
    d, order, starts, counts = edge_groups(W, nw)
    M = len(W)
    two = counts == 2
    r0 = order[starts[two]]
    r1 = order[starts[two] + 1]
    f0 = r0 % M
    f1 = r1 % M
    disagree = (d[r0, 0] == d[r1, 0]).astype(np.int8)
    keep = f0 != f1
    f0, f1, disagree = f0[keep], f1[keep], disagree[keep]

    labels, n_pieces = face_components(W, nw)
    reps = np.full(n_pieces, -1, np.int64)
    seen = np.zeros(n_pieces, bool)
    for face, lab in enumerate(labels.tolist()):
        if not seen[lab]:
            seen[lab] = True
            reps[lab] = face
            if seen.all():
                break

    root = M
    src = np.concatenate([f0, np.full(n_pieces, root)])
    dst = np.concatenate([f1, reps])
    graph = coo_matrix((np.ones(len(src), np.float32), (src, dst)), shape=(M + 1, M + 1)).tocsr()
    _, pred = breadth_first_order(graph, root, directed=False, return_predecessors=True)

    n1 = np.int64(M + 1)
    edge_key = np.minimum(np.concatenate([f0, np.full(n_pieces, root)]),
                          np.concatenate([f1, reps])) * n1 + \
        np.maximum(np.concatenate([f0, np.full(n_pieces, root)]), np.concatenate([f1, reps]))
    edge_val = np.concatenate([disagree, np.zeros(n_pieces, np.int8)])
    sort = np.argsort(edge_key)
    edge_key = edge_key[sort]
    edge_val = edge_val[sort]

    parent = pred.astype(np.int64)
    parent[root] = root
    parent[parent < 0] = root
    faces = np.arange(M + 1, dtype=np.int64)
    k = np.minimum(faces, parent) * n1 + np.maximum(faces, parent)
    pos = np.clip(np.searchsorted(edge_key, k), 0, len(edge_key) - 1)
    bit = np.where(edge_key[pos] == k, edge_val[pos], 0).astype(np.int8)
    bit[root] = 0
    for _ in range(64):
        if np.all(parent == root):
            break
        bit = bit ^ bit[parent]
        parent = parent[parent]
    return bit[:M_real].astype(bool), labels


def _signed_volumes(V, F, labels, n_pieces):
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    vol = (a * np.cross(b, c)).sum(1) / 6.0
    return np.bincount(labels, weights=vol, minlength=n_pieces)


def _fill_small_holes(V, F, W, max_edges, colours, uvs):
    """Close boundary loops of up to max_edges edges with a centroid fan."""
    M = len(W)
    if M == 0:
        return V, F, colours, uvs, 0
    nw = int(W.max()) + 1
    d, order, starts, counts = edge_groups(W, nw)
    rows = order[starts[counts == 1]]
    if len(rows) == 0:
        return V, F, colours, uvs, 0
    face = rows % M
    slot = rows // M
    start_orig = F[face, slot]
    end_orig = F[face, (slot + 1) % 3]
    start_w = d[rows, 0]
    end_w = d[rows, 1]

    row_of = {}
    tangled = set()
    for i, s in enumerate(start_w.tolist()):
        if s in row_of:
            tangled.add(s)
        row_of[s] = i

    visited = np.zeros(len(rows), bool)
    new_points, new_colours, new_uvs, new_faces = [], [], [], []
    filled = 0
    base = len(V)
    for i in range(len(rows)):
        if visited[i]:
            continue
        visited[i] = True
        loop = [i]
        ok = True
        cur = i
        while True:
            nxt_vertex = int(end_w[cur])
            if nxt_vertex in tangled or nxt_vertex not in row_of:
                ok = False
                break
            nxt = row_of[nxt_vertex]
            if nxt == i:
                break
            if visited[nxt]:
                ok = False
                break
            visited[nxt] = True
            loop.append(nxt)
            cur = nxt
            if len(loop) > 100000:
                ok = False
                break
        if not ok or len(loop) < 3 or len(loop) > max_edges:
            continue
        ring = start_orig[loop]
        centre_index = base + len(new_points)
        new_points.append(V[ring].mean(0))
        if colours is not None:
            new_colours.append(colours[ring].mean(0))
        if uvs is not None:
            new_uvs.append(uvs[ring].mean(0))
        for j in loop:
            # The existing face walks this edge start -> end, so the patch on the
            # other side must walk it end -> start.
            new_faces.append((int(end_orig[j]), int(start_orig[j]), centre_index))
        filled += 1

    if not filled:
        return V, F, colours, uvs, 0
    V = np.concatenate([V, np.asarray(new_points, V.dtype)])
    F = np.concatenate([F, np.asarray(new_faces, np.int64)])
    if colours is not None:
        colours = np.concatenate([colours, np.asarray(new_colours, colours.dtype)])
    if uvs is not None:
        uvs = np.concatenate([uvs, np.asarray(new_uvs, uvs.dtype)])
    return V, F, colours, uvs, filled


def _unique_faces(W, idx):
    """idx without exact duplicate faces, keeping the first copy.

    Only copies that wind the SAME way are duplicates. A face and its reversed
    copy are the two sides of a paper-thin part, and removing either one opens a
    hole: on the Ep34 radio all 26 duplicate pairs were reversed copies, and
    removing one of each turned 5 holes into 24 (measured 2026-09-14).
    Degenerate faces are gone by now, so each row's smallest id is unique.
    """
    if len(idx) == 0:
        return idx
    w = W[idx]
    r = np.argmin(w, axis=1)
    rows = np.arange(len(w))
    canon = np.stack([w[rows, r], w[rows, (r + 1) % 3], w[rows, (r + 2) % 3]], axis=1)
    _, first = np.unique(canon, axis=0, return_index=True)
    return idx[np.sort(first)]


def tidy(V, F, loose=1.0, max_hole_edges=MAX_HOLE_EDGES, colours=None, uvs=None):
    """Clean (V, F) in place of a rebuild. Returns the cleaned arrays and counts."""
    V = np.asarray(V, np.float64).reshape(-1, 3)
    F = np.asarray(F, np.int64).reshape(-1, 3)
    colours = None if colours is None else np.asarray(colours, np.float32)
    uvs = None if uvs is None else np.asarray(uvs, np.float32)
    report = {"removedFaces": 0, "piecesRemoved": 0, "facesTurned": 0, "holesFilled": 0}
    if len(F) == 0:
        return {"vertices": V.astype(np.float32), "faces": F, "colours": colours, "uvs": uvs, **report}

    wid, _ = weld_ids(V)
    W = wid[F]
    good = ~degenerate_faces(V, F, W)
    idx = _unique_faces(W, np.nonzero(good)[0])
    report["removedFaces"] = int(len(F) - len(idx))
    F = F[idx]
    W = W[idx]

    if len(F) and loose > 0:
        labels, n_pieces = face_components(W, int(W.max()) + 1)
        if n_pieces > 1:
            sizes = np.bincount(labels, minlength=n_pieces)
            keep_piece = sizes >= (float(loose) / 100.0) * sizes.max()
            report["piecesRemoved"] = int((~keep_piece).sum())
            keep = keep_piece[labels]
            F = F[keep]
            W = W[keep]

    if len(F):
        flip, labels = _orient(W, len(W))
        F = np.where(flip[:, None], F[:, ::-1], F)
        W = np.where(flip[:, None], W[:, ::-1], W)
        n_pieces = int(labels.max()) + 1 if len(labels) else 0
        outward = _signed_volumes(V, F, labels, n_pieces) >= 0
        turn = ~outward[labels]
        F = np.where(turn[:, None], F[:, ::-1], F)
        W = np.where(turn[:, None], W[:, ::-1], W)
        report["facesTurned"] = int((flip ^ turn).sum())

    V, F, colours, uvs, filled = _fill_small_holes(V, F, W, int(max_hole_edges), colours, uvs)
    report["holesFilled"] = int(filled)

    used = np.unique(F.reshape(-1))
    remap = np.full(len(V), -1, np.int64)
    remap[used] = np.arange(len(used))
    V = V[used]
    F = remap[F]
    if colours is not None:
        colours = colours[used]
    if uvs is not None:
        uvs = uvs[used]
    return {"vertices": V.astype(np.float32), "faces": F, "colours": colours, "uvs": uvs, **report}
