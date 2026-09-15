"""Hard Surface Pixaroma - make an AI 3D model's flat panels flat and its rounded bevels crisp.

Pure numpy + scipy (both come with ComfyUI): no torch and no ComfyUI, so
D:\\Claude Tests\\_hard_surface_test.py checks it directly. Ported from the prototype in
D:\\Claude Tests\\_hard_surface_proto (hs_filter_segment.py, hs_sharpen.py, hs_foldfix.py); the
harness holds this port to that prototype vertex for vertex, so change both together or neither.
The study and its renders: output/claude_output/hard_surface_proto/README.txt.

What happens to one welded triangle mesh:
  1. The face normals are filtered (bilateral, mild) and faces facing the same way are grown into
     regions. The filtered normals only FIND regions: the surface keeps its own positions, because
     filtering the surface itself softened small details away.
  2. Panels: regions that fit a plane closely and are wide enough in it. With Keep round, a panel
     whose own surface bends across it is a strip of a curved part, and it is dropped, so round
     parts are left alone.
  3. A vertex whose faces all lie in one panel goes onto that panel's plane. A bevel vertex goes
     onto the line where two panel planes cross, or the point where three do, and only when every
     panel it uses really reaches that place. Bevel vertices left behind follow their neighbours.
  4. Every move fades out past its limit instead of stopping dead, and a face the moves turned
     over has its vertices' moves halved, round after round, until nothing is folded.
All limits are in mm for the model printed with its longest side 100 mm.
"""
from __future__ import annotations

import time
from collections import deque
from dataclasses import replace

import numpy as np
from scipy.sparse import coo_matrix, csr_matrix
from scipy.spatial import cKDTree

from . import _mesh3d as m3

PRINT_MM = 100.0

# The prototype's best run (step2_c + the fold repair) is Medium.
BASE = {
    "iters": 6, "sigma_r": 0.3, "panel_min": 0.0002, "panel_rms": 0.35, "min_width": 1.2,
    "hops": 4, "near": 0.6, "fill": 1, "soft": 1, "relax": 3, "fold_rounds": 12, "fold_keep": 0.5,
    "fold_undo": True, "keep_round": True, "round_bend": 9.0, "round_fit": 0.5,
}
# Undoing moves spreads one ring of faces per pass and always ends (every pass puts at least one
# vertex back where it was); a cascade over a whole model would cost a face pass each time.
UNDO_PASSES = 100
PRESETS = {
    "light": {"cap": 0.3, "flat_cap": 0.12, "dihedral": 35.0, "angle": 10.0},
    "medium": {"cap": 0.5, "flat_cap": 0.2, "dihedral": 30.0, "angle": 12.0},
    "strong": {"cap": 0.8, "flat_cap": 0.3, "dihedral": 25.0, "angle": 14.0},
}


def preset_params(strength, keep_round=True):
    """The full settings for a Sharpen level: Light, Medium or Strong."""
    params = dict(BASE)
    params.update(PRESETS.get(strength, PRESETS["medium"]))
    params["keep_round"] = bool(keep_round)
    return params


# ---------- geometry and adjacency (hs_filter_segment.py) ----------

def face_geo(V, F):
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    cr = np.cross(b - a, c - a)
    ln = np.linalg.norm(cr, axis=1)
    return cr / np.maximum(ln, 1e-30)[:, None], ln / 2, (a + b + c) / 3


def edge_pairs(F, nv):
    """Faces meeting at a two-face edge, and that edge's two vertices."""
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    fid = np.tile(np.arange(len(F)), 3)
    key = np.minimum(e[:, 0], e[:, 1]) * nv + np.maximum(e[:, 0], e[:, 1])
    order = np.argsort(key, kind="stable")
    key, fid = key[order], fid[order]
    uk, start, cnt = np.unique(key, return_index=True, return_counts=True)
    two = cnt == 2
    pairs = np.stack([fid[start[two]], fid[start[two] + 1]], 1)
    return pairs, (uk // nv)[two], (uk % nv)[two], {
        "edges": int(len(uk)), "open": int((cnt == 1).sum()), "broken": int((cnt > 2).sum())}


def bent_pct(V, pairs, ea, eb, N, threshold=45.0):
    """The share of edge length (in %) where the two faces bend more than `threshold` degrees."""
    if not len(pairs):
        return 0.0
    dot = np.clip((N[pairs[:, 0]] * N[pairs[:, 1]]).sum(1), -1, 1)
    ang = np.degrees(np.arccos(dot))
    L = np.linalg.norm(V[ea] - V[eb], axis=1)
    tot = max(float(L.sum()), 1e-30)
    return float(L[ang > threshold].sum()) / tot * 100


def face_ring(F, nv):
    """Every pair of faces that share at least one vertex (the filter's neighbourhood)."""
    nf = len(F)
    A = csr_matrix((np.ones(nf * 3), (np.repeat(np.arange(nf), 3), F.ravel())), shape=(nf, nv))
    FF = (A @ A.T).tocoo()
    keep = FF.row != FF.col
    return FF.row[keep].astype(np.int64), FF.col[keep].astype(np.int64)


def bilateral(N0, C, A, I, J, iters, sigma_r, sigma_s):
    nf = len(N0)
    ws = A[J] * np.exp(-((C[I] - C[J]) ** 2).sum(1) / (2 * sigma_s ** 2))
    # Build the sparse structure once; each pass only replaces the weights.
    W = coo_matrix((np.arange(1, len(I) + 1, dtype=np.float64), (I, J)), shape=(nf, nf)).tocsr()
    perm = W.data.astype(np.int64) - 1
    N = N0.copy()
    for _ in range(iters):
        w = ws * np.exp(-((N[I] - N[J]) ** 2).sum(1) / (2 * sigma_r ** 2))
        W.data = w[perm]
        S = W @ N + N * A[:, None]
        N = S / np.maximum(np.linalg.norm(S, axis=1), 1e-30)[:, None]
    return N


def grow(N, A, pairs, nf, angle_deg):
    cos_t = float(np.cos(np.radians(angle_deg)))
    r = np.concatenate([pairs[:, 0], pairs[:, 1]])
    c = np.concatenate([pairs[:, 1], pairs[:, 0]])
    adj = csr_matrix((np.ones(len(r)), (r, c)), shape=(nf, nf))
    indptr, indices = adj.indptr, adj.indices
    # Seeds: the faces that agree best with their neighbours go first.
    agree = np.bincount(r, weights=(N[r] * N[c]).sum(1), minlength=nf) / np.maximum(np.bincount(r, minlength=nf), 1)
    label = np.full(nf, -1, np.int64)
    reg = 0
    for seed in np.argsort(-agree, kind="stable"):
        if label[seed] >= 0:
            continue
        label[seed] = reg
        s = N[seed] * A[seed]
        q = deque([seed])
        while q:
            f = q.popleft()
            mean = s / max(np.linalg.norm(s), 1e-30)
            for g in indices[indptr[f]:indptr[f + 1]]:
                if label[g] < 0 and float(N[g] @ mean) > cos_t:
                    label[g] = reg
                    s = s + N[g] * A[g]
                    q.append(g)
        reg += 1
    return label, reg


# ---------- panels and moves (hs_sharpen.py) ----------

def fade(length, limit, soft):
    """1 up to the limit; with `soft`, a smooth fade to 0 at twice the limit, else a hard stop."""
    length = np.asarray(length, dtype=np.float64)
    if not soft:
        return (length <= limit).astype(np.float64)
    t = np.clip((length - limit) / max(limit, 1e-30), 0.0, 1.0)
    return 1.0 - t * t * (3.0 - 2.0 * t)


def fit_plane(P):
    """Least-squares plane, fitted twice: the second time without the worst 10% of the points."""
    ctr = P.mean(0)
    _, s, vt = np.linalg.svd(P - ctr, full_matrices=False)
    n = vt[-1]
    d = np.abs((P - ctr) @ n)
    keep = d <= np.percentile(d, 90)
    if keep.sum() >= 10:
        Q = P[keep]
        ctr = Q.mean(0)
        _, s, vt = np.linalg.svd(Q - ctr, full_matrices=False)
        n = vt[-1]
        d = np.abs((Q - ctr) @ n)
        count = len(Q)
    else:
        count = len(P)
    rms = float(np.sqrt((d ** 2).mean()))
    # Singular values are sqrt(count) x the spread along each axis; a flat strip of width w
    # has a spread of w / sqrt(12) across it.
    width = float(s[1] / np.sqrt(count) * np.sqrt(12.0))
    return n, ctr, rms, width


def panels(V, F, label, nreg, A, N, mm, s):
    total = float(A.sum())
    area = np.bincount(label, weights=A, minlength=nreg)
    faces = np.bincount(label, minlength=nreg)
    perm = np.argsort(label, kind="stable")
    ends = np.cumsum(faces)
    starts = ends - faces
    normals, offsets, regions = [], [], []
    rejected = {"rms": 0, "width": 0}
    for rg in np.nonzero((area / total >= s["panel_min"]) & (faces >= 20))[0]:
        idx = perm[starts[rg]:ends[rg]]
        n, ctr, rms, width = fit_plane(V[np.unique(F[idx].ravel())])
        if float(n @ (N[idx] * A[idx][:, None]).sum(0)) < 0:
            n = -n
        if rms * mm > s["panel_rms"]:
            rejected["rms"] += 1
            continue
        if width * mm < s["min_width"]:
            rejected["width"] += 1
            continue
        normals.append(n)
        offsets.append(float(n @ ctr))
        regions.append(int(rg))
    lookup = np.full(nreg, -1, np.int64)
    lookup[regions] = np.arange(len(regions))
    return np.asarray(normals).reshape(-1, 3), np.asarray(offsets), lookup[label], regions, rejected


def bend_fit(Q):
    """How far a set of points turns across itself -> (bend in degrees, rms off the best plane,
    rms off the best quadratic). A quadratic height field is fitted in the points' own plane; the bend
    is its largest principal curvature times the extent of the points in that direction."""
    X = Q - Q.mean(0)
    _u, _sv, vt = np.linalg.svd(X, full_matrices=False)
    u, w, h = X @ vt[0], X @ vt[1], X @ vt[2]
    A = np.stack([np.ones_like(u), u, w, u * u, u * w, w * w], 1)
    c, *_rest = np.linalg.lstsq(A, h, rcond=None)
    vals, vecs = np.linalg.eigh(np.array([[2 * c[3], c[4]], [c[4], 2 * c[5]]]))
    best = 0.0
    for k in range(2):
        t = u * vecs[0, k] + w * vecs[1, k]
        extent = float(np.percentile(t, 95) - np.percentile(t, 5)) / 0.9
        best = max(best, abs(float(vals[k])) * extent)
    return float(np.degrees(best)), float(np.sqrt((h ** 2).mean())), float(np.sqrt(((A @ c - h) ** 2).mean()))


def round_panels(V, F, face_panel, npanel, s):
    """Panels whose own surface bends -> bool (P,).

    Keep round, which the prototype did not have: a curved part (a grip, a rim, a barrel) is cut by the
    region growing into strips that each fit a plane well enough to pass as panels, and flattening them
    turns the part into facets (the prototype's crumpled grip; harness A5a). A panel is round when its
    points turn by `round_bend` degrees or more across it AND a quadratic explains that turn (its rms is
    at most `round_fit` times the plane's), so the noise on a narrow strip cannot pass for a curve.

    The first cut counted NEIGHBOURS instead (two or more panels meeting it at 3 to `dihedral` degrees)
    and dropped the gun's big flat sides, because a flat side between two shallow chamfers looks exactly
    like a strip of a cylinder that way (harness A5c). Measured on the gun (hs_round_probe.py): flat
    sides bend 0.7 to 7.4 degrees, curved strips 8 to 37, rounded bevel strips 38 to 40; rendered, this
    rule leaves the muzzle, the back of the grip, the trigger guard's inner curve and the rounded rear
    corner alone and keeps every flat side a panel."""
    out = np.zeros(npanel, bool)
    has = face_panel >= 0
    order = np.argsort(face_panel, kind="stable")
    counts = np.bincount(face_panel[has], minlength=npanel)
    start = int((~has).sum())
    for p in range(npanel):
        idx = order[start:start + counts[p]]
        start += counts[p]
        bend, plane_rms, quad_rms = bend_fit(V[np.unique(F[idx].ravel())])
        out[p] = bend >= s["round_bend"] and quad_rms <= s["round_fit"] * plane_rms
    return out


def drop_panels(PN, PD, face_panel, keep):
    """Only the panels marked `keep`, numbered again in order; the faces of the others get -1."""
    new_id = np.cumsum(keep) - 1
    safe = np.where(face_panel >= 0, face_panel, 0)
    face_panel = np.where((face_panel >= 0) & keep[safe], new_id[safe], -1)
    return PN[keep], PD[keep], face_panel


def reach_and_touch(F, nv, face_panel, npanel, hops):
    """Panels within `hops` edges of every vertex, the vertices each panel really touches,
    the panel a vertex lies inside (-1 when its faces are not all one panel), and adjacency."""
    rows = F.ravel()
    fp = np.repeat(face_panel, 3)
    ok = fp >= 0
    touch = csr_matrix((np.ones(int(ok.sum())), (rows[ok], fp[ok])), shape=(nv, npanel))
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    adj = csr_matrix((np.ones(len(e) * 2), (np.r_[e[:, 0], e[:, 1]], np.r_[e[:, 1], e[:, 0]])), shape=(nv, nv))
    adj.data[:] = 1
    reach = touch.copy()
    reach.data[:] = 1
    for _ in range(hops):
        nxt = adj @ reach
        nxt.data[:] = 1
        new = nxt - nxt.multiply(reach)
        new.eliminate_zeros()
        if new.nnz == 0:
            break
        reach = reach + new
        reach.data[:] = 1
    deg = np.bincount(rows, minlength=nv)
    top = np.asarray(touch.max(1).todense()).ravel()
    arg_top = np.asarray(touch.argmax(1)).ravel()
    inside = np.full(nv, -1, np.int64)
    full = (top == deg) & (deg > 0)
    inside[full] = arg_top[full]
    return reach.tocsr(), touch.tocoo(), inside, adj.tocsr()


def near_ok(tree, owner, targets, needed, radius):
    if not len(targets):
        return np.zeros(0, bool)
    hits = tree.query_ball_point(targets, radius, workers=-1)
    out = np.zeros(len(targets), bool)
    for i, h in enumerate(hits):
        if h:
            have = set(owner[h].tolist())
            out[i] = all(p in have for p in needed[i] if p >= 0)
    return out


def move_vertices(V, F, PN, PD, reach, inside, tree, owner, mm, s):
    """Panel vertices onto their plane; bevel vertices onto a crease line or corner (the
    prototype's `sharpen`). -> (moved vertices, kind per vertex, counts)."""
    V2 = V.copy()
    kind = np.zeros(len(V), np.int8)
    soft = bool(s["soft"])
    cap, flat_cap, near = s["cap"] / mm, s["flat_cap"] / mm, s["near"] / mm
    reach_limit = cap * (2.0 if soft else 1.0)
    cos_d = float(np.cos(np.radians(s["dihedral"])))
    counts = {"beyond_reach": 0, "not_near_both_panels": 0, "faded_moves": 0}

    ins = np.nonzero(inside >= 0)[0]
    if len(ins):
        n = PN[inside[ins]]
        d = (V[ins] * n).sum(1) - PD[inside[ins]]
        w = fade(np.abs(d), flat_cap, soft)
        moved = w > 0
        V2[ins[moved]] = V[ins[moved]] - n[moved] * (d[moved] * w[moved])[:, None]
        kind[ins[moved]] = 1
        counts["faded_moves"] += int(((w > 0) & (w < 1)).sum())

    verts, targets, needed, what = [], [], [], []
    indptr, indices = reach.indptr, reach.indices
    for v in np.nonzero(inside < 0)[0]:
        cand = indices[indptr[v]:indptr[v + 1]]
        if len(cand) < 2:
            continue
        x = V[v]
        pd = np.abs(PN[cand] @ x - PD[cand])
        order = np.argsort(pd)
        near_c = cand[order][pd[order] < reach_limit]
        if len(near_c) < 2:
            continue
        p1 = near_c[0]
        p2 = next((p for p in near_c[1:] if abs(float(PN[p1] @ PN[p])) < cos_d), None)
        if p2 is None:
            continue
        p3 = next((p for p in near_c[1:] if p != p2 and abs(float(PN[p1] @ PN[p])) < cos_d
                   and abs(float(PN[p2] @ PN[p])) < cos_d), None)
        target, k, need = None, 2, (p1, p2, -1)
        if p3 is not None:
            M = np.stack([PN[p1], PN[p2], PN[p3]])
            if abs(np.linalg.det(M)) > 1e-6:
                t3 = np.linalg.solve(M, np.array([PD[p1], PD[p2], PD[p3]]))
                if np.linalg.norm(t3 - x) < reach_limit:
                    target, k, need = t3, 3, (p1, p2, p3)
        if target is None:
            u = np.cross(PN[p1], PN[p2])
            u /= np.linalg.norm(u)
            target = np.linalg.solve(np.stack([PN[p1], PN[p2], u]), np.array([PD[p1], PD[p2], float(u @ x)]))
        if np.linalg.norm(target - x) >= reach_limit:
            counts["beyond_reach"] += 1
            continue
        verts.append(v)
        targets.append(target)
        needed.append(need)
        what.append(k)
    if verts:
        verts = np.asarray(verts)
        targets = np.asarray(targets)
        ok = near_ok(tree, owner, targets, needed, near)
        counts["not_near_both_panels"] = int((~ok).sum())
        verts, targets, what = verts[ok], targets[ok], np.asarray(what)[ok]
        delta = targets - V[verts]
        w = fade(np.linalg.norm(delta, axis=1), cap, soft)
        V2[verts] = V[verts] + delta * w[:, None]
        kind[verts] = what
        counts["faded_moves"] += int(((w > 0) & (w < 1)).sum())
    return V2, kind, counts


def fill(V, V2, kind, PN, PD, reach, inside, adj, tree, owner, mm, s):
    """Strip vertices beside a moved crease vertex go onto their nearest panel's plane."""
    soft = bool(s["soft"])
    cap, near = s["cap"] / mm, s["near"] / mm
    reach_limit = cap * (2.0 if soft else 1.0)
    creased = ((kind == 2) | (kind == 3)).astype(np.float64)
    beside = (adj @ creased) > 0
    todo = np.nonzero(beside & (kind == 0) & (inside < 0))[0]
    verts, targets, needed = [], [], []
    indptr, indices = reach.indptr, reach.indices
    for v in todo:
        cand = indices[indptr[v]:indptr[v + 1]]
        if not len(cand):
            continue
        pd = PN[cand] @ V[v] - PD[cand]
        j = int(np.argmin(np.abs(pd)))
        if abs(pd[j]) >= reach_limit:
            continue
        p = cand[j]
        verts.append(v)
        targets.append(V[v] - PN[p] * pd[j])
        needed.append((p, -1, -1))
    if not verts:
        return 0
    verts = np.asarray(verts)
    targets = np.asarray(targets)
    ok = near_ok(tree, owner, targets, needed, near)
    verts, targets = verts[ok], targets[ok]
    delta = targets - V[verts]
    w = fade(np.linalg.norm(delta, axis=1), cap, soft)
    V2[verts] = V[verts] + delta * w[:, None]
    kind[verts] = 4
    return int(len(verts))


def relax(V, V2, kind, inside, adj, mm, s):
    """Untouched strip vertices take the average move of their neighbours, a few times."""
    if s["relax"] <= 0:
        return V2, 0
    cap = s["cap"] / mm
    D = V2 - V
    free = (kind == 0) & (inside < 0)
    deg = np.maximum(np.asarray(adj.sum(1)).ravel(), 1.0)
    for _ in range(int(s["relax"])):
        avg = (adj @ D) / deg[:, None]
        length = np.linalg.norm(avg, axis=1)
        avg *= np.minimum(1.0, cap / np.maximum(length, 1e-30))[:, None]
        D[free] = avg[free]
    moved = free & (np.linalg.norm(D, axis=1) * mm > 1e-4)
    kind[moved] = 5
    return V + D, int(moved.sum())


# ---------- the fold repair (hs_foldfix.py) ----------

def repair_folds(V0, V2, F, N0, A0, rounds, keep, undo=True):
    """Faces whose normal now points against the original's get the moves of their three
    vertices shrunk to `keep`, round after round, until none is folded or the rounds run out.
    Faces collapsed to nothing (a bevel squeezed onto its crease on purpose) do not count.

    With `undo` (not in the prototype), a face still folded after the rounds gets its vertices put
    back where they were, again until nothing is folded. The rounds alone do not always converge:
    with hard stops they ended with MORE folds than they started with (12 -> 24 on the harness box,
    check A6b), because halving one vertex's move can turn over the next face. A face whose
    vertices are all back in place is the original face, so this always ends.
    -> (vertices, folded faces per round, vertices whose move shrank, vertices put back,
        folded faces at the end)."""
    tiny = float(A0.mean()) * 1e-4
    real = A0 > tiny
    D = V2 - V0
    shrunk = np.zeros(len(V0), bool)
    history = []

    def folded_now():
        N, A, _ = face_geo(V0 + D, F)
        return real & (A > tiny) & ((N0 * N).sum(1) < 0)

    folded = None
    for r in range(rounds + 1):
        folded = folded_now()
        history.append(int(folded.sum()))
        if not folded.any() or r == rounds:
            break
        verts = np.unique(F[folded].ravel())
        D[verts] *= keep
        shrunk[verts] = True
    undone = np.zeros(len(V0), bool)
    if undo and folded.any():
        for _ in range(UNDO_PASSES):
            verts = np.unique(F[folded].ravel())
            verts = verts[(D[verts] != 0).any(axis=1)]
            if not len(verts):
                break
            D[verts] = 0.0
            undone[verts] = True
            folded = folded_now()
            if not folded.any():
                break
    return V0 + D, history, int(shrunk.sum()), int(undone.sum()), int(folded.sum())


# ---------- the whole step ----------

def _stats(**values):
    stats = {
        "regions": 0, "panels_rejected_rms": 0, "panels_rejected_width": 0, "round_panels": 0,
        "onto_plane": 0, "onto_line": 0, "onto_corner": 0, "filled": 0, "relaxed": 0,
        "beyond_reach": 0, "not_near": 0, "faded_moves": 0,
        "folded_before": 0, "folded_after": 0, "fold_rounds_used": 0, "fold_shrunk": 0, "fold_undone": 0,
        "bent_before": 0.0, "bent_after": 0.0, "moved_mean_mm": 0.0, "moved_max_mm": 0.0,
        "mm_per_unit": 0.0, "cap_units": 0.0, "open": 0, "broken": 0, "left_out_faces": 0,
        "seconds": 0.0,
    }
    stats.update(values)
    return stats


def _cancel(cancel):
    if cancel is not None:
        cancel()


def sharpen_triangles(vertices, faces, params, cancel=None):
    """(N, 3) positions and (M, 3) triangles of ONE welded mesh -> {
         "vertices": (N, 3) float64, sharpened; rows that are not real numbers come back as they were,
         "face_panel": (M,) int64, the panel of each triangle, -1 for none,
         "panels": int, "stats": dict}.
    Triangles that use a non-finite vertex, repeat a vertex or have no area are left out of every
    step. `cancel` is called between the steps and may raise to stop."""
    started = time.perf_counter()
    s = dict(params)
    V_in = np.asarray(vertices, np.float64).reshape(-1, 3)
    F_in = np.asarray(faces, np.int64).reshape(-1, 3)
    out = V_in.copy()
    face_panel_all = np.full(len(F_in), -1, np.int64)
    finite = np.isfinite(V_in).all(axis=1)
    keep_v = np.nonzero(finite)[0]
    good = np.zeros(len(F_in), bool)
    if len(F_in) and len(keep_v):
        good = finite[F_in].all(axis=1) & (F_in[:, 0] != F_in[:, 1]) & (F_in[:, 1] != F_in[:, 2]) \
            & (F_in[:, 0] != F_in[:, 2])

    def result(panels_count=0, **values):
        values["left_out_faces"] = int((~good).sum())
        values["seconds"] = round(time.perf_counter() - started, 2)
        return {"vertices": out, "face_panel": face_panel_all, "panels": int(panels_count), "stats": _stats(**values)}

    if len(keep_v) < 3 or not good.any():
        return result()
    remap = np.full(len(V_in), -1, np.int64)
    remap[keep_v] = np.arange(len(keep_v))
    V = V_in[keep_v]
    longest = float((V.max(0) - V.min(0)).max())
    if not longest > 0:
        return result()
    # The prototype's weld also dropped faces with no area (hs_filter_segment.weld).
    good_idx = np.nonzero(good)[0]
    F = remap[F_in[good_idx]]
    diag = float(np.linalg.norm(V.max(0) - V.min(0)))
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    has_area = np.linalg.norm(np.cross(b - a, c - a), axis=1) > (diag * 1e-9) ** 2
    good[good_idx[~has_area]] = False
    good_idx, F = good_idx[has_area], F[has_area]
    if not len(F):
        return result()

    mm = PRINT_MM / longest
    nv, nf = len(V), len(F)
    N0, A0, C0 = face_geo(V, F)
    pairs, ea, eb, topo = edge_pairs(F, nv)
    base = {"mm_per_unit": mm, "cap_units": s["cap"] / mm, "open": topo["open"], "broken": topo["broken"]}
    if not len(pairs):
        return result(**base)
    I, J = face_ring(F, nv)
    sigma_s = float(np.linalg.norm(C0[pairs[:, 0]] - C0[pairs[:, 1]], axis=1).mean())
    _cancel(cancel)
    Nf = bilateral(N0, C0, A0, I, J, int(s["iters"]), s["sigma_r"], sigma_s)
    _cancel(cancel)
    label, nreg = grow(Nf, A0, pairs, nf, s["angle"])
    _cancel(cancel)
    PN, PD, face_panel, _regions, rejected = panels(V, F, label, nreg, A0, N0, mm, s)
    round_count = 0
    if s.get("keep_round") and len(PN):
        is_round = round_panels(V, F, face_panel, len(PN), s)
        round_count = int(is_round.sum())
        if round_count:
            PN, PD, face_panel = drop_panels(PN, PD, face_panel, ~is_round)
    base.update(regions=int(nreg), panels_rejected_rms=rejected["rms"], panels_rejected_width=rejected["width"],
                round_panels=round_count, bent_before=bent_pct(V, pairs, ea, eb, N0))
    face_panel_all[good_idx] = face_panel
    if not len(PN):
        base["bent_after"] = base["bent_before"]
        return result(**base)

    reach, touch, inside, adj = reach_and_touch(F, nv, face_panel, len(PN), int(s["hops"]))
    tree, owner = cKDTree(V[touch.row]), touch.col.astype(np.int64)
    _cancel(cancel)
    V2, kind, counts = move_vertices(V, F, PN, PD, reach, inside, tree, owner, mm, s)
    filled = fill(V, V2, kind, PN, PD, reach, inside, adj, tree, owner, mm, s) if s["fill"] else 0
    V2, relaxed = relax(V, V2, kind, inside, adj, mm, s)
    _cancel(cancel)
    V3, history, shrunk, undone, folded_after = repair_folds(
        V, V2, F, N0, A0, int(s["fold_rounds"]), s["fold_keep"], bool(s.get("fold_undo", True)))

    N3, A3, _ = face_geo(V3, F)
    tiny = float(A0.mean()) * 1e-4
    live = (A3 > tiny)[pairs[:, 0]] & (A3 > tiny)[pairs[:, 1]]
    moved = np.linalg.norm(V3 - V, axis=1) * mm
    mv = moved[moved > 1e-6]
    out[keep_v] = V3
    return result(
        len(PN), **base,
        onto_plane=int((kind == 1).sum()), onto_line=int((kind == 2).sum()), onto_corner=int((kind == 3).sum()),
        filled=int(filled), relaxed=int(relaxed), beyond_reach=counts["beyond_reach"],
        not_near=counts["not_near_both_panels"], faded_moves=counts["faded_moves"],
        folded_before=history[0], folded_after=folded_after, fold_rounds_used=len(history) - 1, fold_shrunk=shrunk,
        fold_undone=undone,
        bent_after=bent_pct(V3, pairs[live], ea[live], eb[live], N3),
        moved_mean_mm=float(mv.mean()) if len(mv) else 0.0, moved_max_mm=float(mv.max()) if len(mv) else 0.0,
    )


def sharpen_poly(poly, params, panels_as_groups=True, keep_colours=True, cancel=None):
    """A _mesh3d.PolyMesh -> {"poly": PolyMesh, "panels": int, "stats": dict}.

    The sharpen step works on triangles with one vertex per place, so vertices at the same position (a
    UV seam, an STL's separate corners) are welded for it and all move together. The polygons come
    back exactly as they came in (same faces, same order, same vertex count), so uvs and anything else
    kept per vertex stay valid. With `panels_as_groups` each polygon's group is the panel of its first
    triangle, named `panel_N`, and polygons in no panel share the last group, `rest`; otherwise the
    model keeps its own groups. With `keep_colours` off the vertex colours are left out."""
    V = np.asarray(poly.vertices, np.float64).reshape(-1, 3)
    counts = np.asarray(poly.counts, np.int64)
    ids, count = m3.weld_ids(V)
    first = np.zeros(0, np.int64)
    if count:
        _u, first = np.unique(ids, return_index=True)
        # weld_ids numbers places in the order of their quantised positions. Number them in the order
        # they first appear instead, so a model that is already welded goes through with its vertices
        # in their own order and gives exactly what the triangle path gives (harness A11).
        rank = np.empty(count, np.int64)
        rank[np.argsort(first, kind="stable")] = np.arange(count)
        ids = rank[ids]
        first = np.sort(first)
    _V, T, _C = m3.triangulate(poly)
    res = sharpen_triangles(V[first], ids[T], params, cancel)

    groups, names = poly.groups, list(poly.group_names or [])
    if panels_as_groups:
        first_tri = np.concatenate([[0], np.cumsum(counts - 2)[:-1]]).astype(np.int64)
        poly_panel = res["face_panel"][first_tri] if len(counts) else np.zeros(0, np.int64)
        P = int(res["panels"])
        groups = np.where(poly_panel >= 0, poly_panel, P).astype(np.int32)
        names = ["panel_{}".format(i) for i in range(P)] + ["rest"]
    out = replace(poly, vertices=res["vertices"][ids], groups=groups, group_names=names,
                  colours=poly.colours if keep_colours else None)
    return {"poly": out, "panels": int(res["panels"]), "stats": res["stats"]}
