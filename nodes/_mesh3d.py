"""The shared polygon mesh of the Pixaroma 3D nodes (Save 3D, Hard Surface, Quad Remesh).

It keeps what the triangle-only paths lose: quads and other polygons, face groups
(panels or materials) and vertex colours, so the three nodes can hand a model to
each other through a model_3d OBJ without losing any of it. Core's OBJ reader
fan-triangulates polygons and so does trimesh, so neither may touch a quad model.

Conventions: Y up, front is +Z (glTF). STL is Z up. Colours are LINEAR 0..1 in
memory and sRGB on an OBJ `v` line, the same as core's reader.

numpy + scipy only (both come with ComfyUI), no torch and no ComfyUI imports, so
D:\\Claude Tests\\_save3d_test.py checks it directly.
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace

import numpy as np


@dataclass
class PolyMesh:
    vertices: np.ndarray                 # (N, 3) float64
    counts: np.ndarray                   # (F,) int32, vertices per face, 3 or more
    indices: np.ndarray                  # (counts.sum(),) int64, flat vertex indices
    colours: np.ndarray | None = None    # (N, 3) float32, linear 0..1
    groups: np.ndarray | None = None     # (F,) int32, group id per face
    group_names: list = field(default_factory=list)


def with_vertices(mesh, vertices):
    """The same mesh with new vertex positions (after a turn or a move)."""
    return replace(mesh, vertices=np.asarray(vertices, np.float64).reshape(-1, 3))


def _srgb_to_linear(c):
    c = np.clip(np.asarray(c, np.float64), 0.0, 1.0)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _linear_to_srgb(c):
    c = np.clip(np.asarray(c, np.float64), 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1.0 / 2.4) - 0.055)


def _group_ids(face_ids, names):
    """Faces that came before any group line get a 'default' group of their own."""
    ids = np.asarray(face_ids, np.int32)
    names = list(names)
    if len(ids) and (ids < 0).any():
        names.append("default")
        ids = np.where(ids < 0, len(names) - 1, ids).astype(np.int32)
    return ids, names


def read_obj(data):
    """OBJ bytes -> PolyMesh, keeping every polygon as it is.

    `usemtl` names the face groups (a `g` line is used when there is no usemtl);
    `v x y z r g b` colours are read as sRGB and kept linear. Texture coordinates,
    normals and the .mtl file are not read.
    """
    text = bytes(data).decode("utf-8", "replace") if isinstance(data, (bytes, bytearray)) else str(data)
    positions, colours = [], []
    has_colour = False
    counts, flat = [], []
    face_m, face_g = [], []
    m_names, m_ids, g_names, g_ids = [], {}, [], {}
    current_m = current_g = -1

    for raw in text.splitlines():
        parts = raw.split()
        if not parts or parts[0].startswith("#"):
            continue
        tag = parts[0]
        if tag == "v":
            positions.append((float(parts[1]), float(parts[2]), float(parts[3])))
            if len(parts) >= 7:
                colours.append((float(parts[4]), float(parts[5]), float(parts[6])))
                has_colour = True
            else:
                colours.append((1.0, 1.0, 1.0))
        elif tag == "f":
            count = len(positions)
            face = []
            for token in parts[1:]:
                head = token.split("/", 1)[0]
                if not head:
                    continue
                i = int(head)
                resolved = i - 1 if i > 0 else count + i
                if i == 0 or not 0 <= resolved < count:
                    raise ValueError("OBJ index {} is out of range for {} vertices".format(i, count))
                face.append(resolved)
            if len(face) < 3:
                continue
            counts.append(len(face))
            flat.extend(face)
            face_m.append(current_m)
            face_g.append(current_g)
        elif tag == "usemtl":
            key = " ".join(parts[1:]) or "default"
            if key not in m_ids:
                m_ids[key] = len(m_names)
                m_names.append(key)
            current_m = m_ids[key]
        elif tag == "g":
            key = " ".join(parts[1:]) or "default"
            if key not in g_ids:
                g_ids[key] = len(g_names)
                g_names.append(key)
            current_g = g_ids[key]

    if not counts:
        raise ValueError("OBJ contains no faces")
    groups, names = None, []
    if m_names:
        groups, names = _group_ids(face_m, m_names)
    elif g_names:
        groups, names = _group_ids(face_g, g_names)
    return PolyMesh(
        vertices=np.asarray(positions, np.float64).reshape(-1, 3),
        counts=np.asarray(counts, np.int32),
        indices=np.asarray(flat, np.int64),
        colours=_srgb_to_linear(colours).astype(np.float32) if has_colour else None,
        groups=groups,
        group_names=names,
    )


def write_obj(mesh, header="Pixaroma"):
    """PolyMesh -> OBJ bytes: polygons as they are, `g` + `usemtl` for each group,
    and colours as sRGB on the `v` lines (Blender, MeshLab and ZBrush read them)."""
    V = np.asarray(mesh.vertices, np.float64).reshape(-1, 3)
    lines = ["# " + header, "o model"]
    if mesh.colours is not None:
        C = _linear_to_srgb(np.asarray(mesh.colours)[:, :3])
        lines.extend("v %.6f %.6f %.6f %.4f %.4f %.4f" % (p[0], p[1], p[2], c[0], c[1], c[2])
                     for p, c in zip(V, C))
    else:
        lines.extend("v %.6f %.6f %.6f" % (p[0], p[1], p[2]) for p in V)

    counts = np.asarray(mesh.counts, np.int64)
    starts = np.concatenate([[0], np.cumsum(counts)])
    order = np.arange(len(counts))
    groups = None if mesh.groups is None else np.asarray(mesh.groups)
    if groups is not None:
        order = np.argsort(groups, kind="stable")
    names = list(mesh.group_names or [])
    current = None
    for f in order:
        if groups is not None and groups[f] != current:
            current = groups[f]
            name = names[current] if 0 <= current < len(names) else "group_{}".format(current)
            lines.append("g " + name)
            lines.append("usemtl " + name)
        lines.append("f " + " ".join(str(int(i) + 1) for i in mesh.indices[starts[f]:starts[f + 1]]))
    return ("\n".join(lines) + "\n").encode("utf-8")


def from_triangles(vertices, faces, colours=None):
    F = np.asarray(faces, np.int64).reshape(-1, 3)
    return PolyMesh(
        vertices=np.asarray(vertices, np.float64).reshape(-1, 3),
        counts=np.full(len(F), 3, np.int32),
        indices=F.reshape(-1).copy(),
        colours=None if colours is None else np.asarray(colours, np.float32).reshape(len(np.asarray(vertices).reshape(-1, 3)), -1)[:, :3],
    )


def triangulate(mesh):
    """Fan-triangulate every polygon: -> (vertices, (M, 3) faces, colours)."""
    counts = np.asarray(mesh.counts, np.int64)
    starts = np.concatenate([[0], np.cumsum(counts)[:-1]])
    per_face = counts - 2
    face_of = np.repeat(np.arange(len(counts)), per_face)
    step = np.arange(int(per_face.sum())) - np.repeat(np.cumsum(per_face) - per_face, per_face)
    first = starts[face_of]
    idx = np.asarray(mesh.indices, np.int64)
    F = np.stack([idx[first], idx[first + step + 1], idx[first + step + 2]], axis=1)
    return mesh.vertices, F, mesh.colours


def face_summary(mesh):
    counts = np.asarray(mesh.counts)
    return {"triangles": int((counts == 3).sum()), "quads": int((counts == 4).sum()),
            "ngons": int((counts > 4).sum()), "faces": int(len(counts))}


def edge_census(mesh):
    """Open edges (used by one face), broken edges (more than two), separate pieces,
    and poles: the share of inner vertices where more or fewer than 4 edges meet,
    reported only for a mostly-quad model (on triangles it means nothing)."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components

    nv = len(mesh.vertices)
    counts = np.asarray(mesh.counts, np.int64)
    idx = np.asarray(mesh.indices, np.int64)
    if nv == 0 or len(counts) == 0:
        return {"open": 0, "broken": 0, "pieces": 0, "poles_pct": None}
    starts = np.repeat(np.concatenate([[0], np.cumsum(counts)[:-1]]), counts)
    corner = np.arange(len(idx))
    last = corner - starts + 1 == np.repeat(counts, counts)
    nxt = np.where(last, starts, corner + 1)
    a, b = idx, idx[nxt]
    keep = a != b
    lo, hi = np.minimum(a, b)[keep], np.maximum(a, b)[keep]
    keys, used_by = np.unique(lo * nv + hi, return_counts=True)
    ea, eb = keys // nv, keys % nv

    used = np.zeros(nv, bool)
    used[idx] = True
    _n, labels = connected_components(coo_matrix((np.ones(len(ea)), (ea, eb)), shape=(nv, nv)), directed=False)
    pieces = int(len(np.unique(labels[used])))

    poles = None
    if int((counts == 4).sum()) * 2 > len(counts):
        valence = np.bincount(np.concatenate([ea, eb]), minlength=nv)
        boundary = np.zeros(nv, bool)
        boundary[ea[used_by == 1]] = True
        boundary[eb[used_by == 1]] = True
        inner = used & ~boundary
        if inner.any():
            poles = round(float((valence[inner] != 4).mean()) * 100, 2)
    return {"open": int((used_by == 1).sum()), "broken": int((used_by > 2).sum()),
            "pieces": pieces, "poles_pct": poles}


# 90 degree turns, right-handed, Y up: x tips the model forward, y spins it,
# z tips it onto its side.
TURNS = {
    "x": np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], np.float64),
    "y": np.array([[0, 0, 1], [0, 1, 0], [-1, 0, 0]], np.float64),
    "z": np.array([[0, -1, 0], [1, 0, 0], [0, 0, 1]], np.float64),
}


def apply_fix(vertices, turns, center, ground):
    """Turn in the given order, then put the middle of X and Z on the centre and
    the lowest point on the ground (Y = 0), each only when asked."""
    P = np.asarray(vertices, np.float64).reshape(-1, 3)
    M = np.eye(3)
    for t in turns or []:
        if t in TURNS:
            M = TURNS[t] @ M
    P = P @ M.T
    if len(P) and (center or ground):
        lo, hi = P.min(0), P.max(0)
        shift = np.zeros(3)
        if center:
            shift[0] = -(lo[0] + hi[0]) / 2.0
            shift[2] = -(lo[2] + hi[2]) / 2.0
        if ground:
            shift[1] = -lo[1]
        P = P + shift
    return P


def placement_check(vertices, tolerance=0.005):
    """What can be measured about where the model sits: above the ground, into
    it, or away from the centre, each beyond 0.5% of its longest side."""
    P = np.asarray(vertices, np.float64).reshape(-1, 3)
    if not len(P):
        return {"floating": False, "sunk": False, "off_center": False}
    lo, hi = P.min(0), P.max(0)
    limit = (float((hi - lo).max()) or 1.0) * tolerance
    mid = (lo + hi) / 2.0
    return {"floating": bool(lo[1] > limit), "sunk": bool(lo[1] < -limit),
            "off_center": bool(abs(mid[0]) > limit or abs(mid[2]) > limit)}


def y_up_to_z_up(vertices):
    """(x, y, z) -> (x, -z, y): the turn Mesh Repair's stl uses. A turn, not a
    mirror, so every face keeps pointing outward."""
    P = np.asarray(vertices, np.float64).reshape(-1, 3)
    return np.stack([P[:, 0], -P[:, 2], P[:, 1]], axis=1)


def stl_to_y_up(vertices):
    """(X, Y, Z) -> (X, Z, -Y): reads a Z-up STL standing up, the exact inverse
    of y_up_to_z_up."""
    P = np.asarray(vertices, np.float64).reshape(-1, 3)
    return np.stack([P[:, 0], P[:, 2], -P[:, 1]], axis=1)
