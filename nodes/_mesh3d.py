"""The shared polygon mesh of the Pixaroma 3D nodes (Save 3D, Edit 3D).

It keeps what the triangle-only paths lose: quads and other polygons, face groups
(panels or materials) and vertex colours, so the nodes can hand a model to
each other through a model_3d OBJ without losing any of it. Core's OBJ reader
fan-triangulates polygons and so does trimesh, so neither may touch a quad model.

Conventions: Y up, front is +Z (glTF). STL is Z up. Colours are LINEAR 0..1 in
memory and sRGB on an OBJ `v` line, the same as core's reader.

Pure numpy + scipy (both come with ComfyUI): no torch, no ComfyUI and no other
node's code, so D:\\Claude Tests\\_save3d_test.py checks it directly. The ComfyUI
side (MESH and File3D in and out) is _mesh3d_io.py.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass, field, replace

import numpy as np

# Points closer than this share of the bounding-box diagonal are one point when
# edges are counted. The same rule as _mesh_repair_census.weld_ids, so every
# count reports the same open and broken edges for the same model.
WELD_REL = 1e-6
STL_RECORD = np.dtype([("normal", "<f4", (3,)), ("points", "<f4", (9,)), ("attr", "<u2")])


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
    # utf-8-sig drops a leading BOM: left in, it glues onto the first `v` and that vertex is
    # skipped, so every face after it points one vertex off (backend review 2026-09-15).
    text = bytes(data).decode("utf-8-sig", "replace") if isinstance(data, (bytes, bytearray)) else str(data)
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
    V = np.asarray(vertices, np.float64).reshape(-1, 3)
    F = np.asarray(faces, np.int64).reshape(-1, 3)
    return PolyMesh(
        vertices=V,
        counts=np.full(len(F), 3, np.int32),
        indices=F.reshape(-1).copy(),
        colours=None if colours is None else np.asarray(colours, np.float32).reshape(len(V), -1)[:, :3],
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


def weld_ids(vertices, rel_eps=WELD_REL):
    """One id per place: vertices at the same position (a UV seam, or an STL that
    stores every triangle's corners separately) share an id. -> (ids, id count).
    A vertex that is not a real number gets an id of its own after the others: left
    in, one NaN made the box NaN and every vertex landed on ONE id (found building
    Hard Surface, 2026-09-15; D:\\Claude Tests\\_hard_surface_test.py A8)."""
    V = np.asarray(vertices, np.float64).reshape(-1, 3)
    if len(V) == 0:
        return np.zeros(0, np.int64), 0
    finite = np.isfinite(V).all(axis=1)
    ids = np.empty(len(V), np.int64)
    count = 0
    if finite.any():
        P = V[finite]
        lo = P.min(0)
        diag = float(np.linalg.norm(P.max(0) - lo)) or 1.0
        q = np.floor((P - lo) / (diag * rel_eps) + 0.5).astype(np.int64)
        np.clip(q, 0, (1 << 20) - 1, out=q)
        key = (q[:, 0] << 40) | (q[:, 1] << 20) | q[:, 2]
        _, inv = np.unique(key, return_inverse=True)
        ids[finite] = inv.reshape(-1)
        count = int(inv.max()) + 1
    bad = np.nonzero(~finite)[0]
    ids[bad] = count + np.arange(len(bad))
    return ids, count + len(bad)


def edge_census(mesh, weld=True):
    """Open edges (used by one face), broken edges (more than two), separate pieces,
    and poles: the share of inner vertices where more or fewer than 4 edges meet,
    reported only for a mostly-quad model (on triangles it means nothing).
    Vertices in the same place are welded first, so seams do not count as open."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components

    counts = np.asarray(mesh.counts, np.int64)
    idx = np.asarray(mesh.indices, np.int64)
    if len(mesh.vertices) == 0 or len(counts) == 0:
        return {"open": 0, "broken": 0, "pieces": 0, "poles_pct": None}
    if weld:
        wid, nv = weld_ids(mesh.vertices)
        idx = wid[idx]
    else:
        nv = len(mesh.vertices)
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


def turns_matrix(turns):
    """The turns, applied in order, as one 3x3 matrix."""
    M = np.eye(3)
    for t in turns or []:
        if t in TURNS:
            M = TURNS[t] @ M
    return M


def fix_shift(turned, center, ground):
    """The move the Fix adds after the turns: the middle of X and Z to 0 and the
    lowest point to Y = 0, each only when asked. -> (3,) float64. Save 3D reports
    it, so its viewer can undo a saved Fix exactly: raw = R^T (F - shift)."""
    P = np.asarray(turned, np.float64).reshape(-1, 3)
    shift = np.zeros(3)
    # Only vertices that are real numbers count: a single NaN or inf would otherwise turn
    # the shift, and with it EVERY vertex, into NaN (backend review 2026-09-15).
    P = P[np.isfinite(P).all(axis=1)]
    if len(P) and (center or ground):
        lo, hi = P.min(0), P.max(0)
        if center:
            shift[0] = -(lo[0] + hi[0]) / 2.0
            shift[2] = -(lo[2] + hi[2]) / 2.0
        if ground:
            shift[1] = -lo[1]
    return shift


def apply_fix(vertices, turns, center, ground):
    """Turn in the given order, then move by fix_shift. With center and ground off
    it is a pure turn, so it also turns normals."""
    P = np.asarray(vertices, np.float64).reshape(-1, 3) @ turns_matrix(turns).T
    return P + fix_shift(P, center, ground)


def count_non_finite(vertices):
    """How many vertices have a coordinate that is not a real number (NaN or inf)."""
    P = np.asarray(vertices, np.float64).reshape(-1, 3)
    return int((~np.isfinite(P).all(axis=1)).sum())


def placement_check(vertices, tolerance=0.005):
    """What can be measured about where the model sits: above the ground, into
    it, or away from the centre, each beyond 0.5% of its longest side. Vertices
    that are not real numbers are left out, or one of them would hide the answer."""
    P = np.asarray(vertices, np.float64).reshape(-1, 3)
    P = P[np.isfinite(P).all(axis=1)]
    if not len(P):
        return {"floating": False, "sunk": False, "off_center": False}
    lo, hi = P.min(0), P.max(0)
    limit = (float((hi - lo).max()) or 1.0) * tolerance
    mid = (lo + hi) / 2.0
    return {"floating": bool(lo[1] > limit), "sunk": bool(lo[1] < -limit),
            "off_center": bool(abs(mid[0]) > limit or abs(mid[2]) > limit)}


def y_up_to_z_up(vertices):
    """(x, y, z) -> (x, -z, y): the turn every STL written here uses. A turn, not a
    mirror, so every face keeps pointing outward."""
    P = np.asarray(vertices, np.float64).reshape(-1, 3)
    return np.stack([P[:, 0], -P[:, 2], P[:, 1]], axis=1)


def stl_to_y_up(vertices):
    """(X, Y, Z) -> (X, Z, -Y): reads a Z-up STL standing up, the exact inverse
    of y_up_to_z_up."""
    P = np.asarray(vertices, np.float64).reshape(-1, 3)
    return np.stack([P[:, 0], P[:, 2], -P[:, 1]], axis=1)


def scale_longest(vertices, size):
    """Scale about the origin so the longest side is `size` (None keeps the units).
    About the origin, so a model that was centred and on the ground stays so."""
    P = np.asarray(vertices, np.float64).reshape(-1, 3)
    if not size or not len(P):
        return P
    longest = float((P.max(0) - P.min(0)).max())
    return P * (float(size) / longest) if longest > 0 else P


def stl_bytes(vertices, faces, header=b"Pixaroma"):
    """A binary STL of the triangles exactly where they are (no turn, no scale):
    an 80-byte header, the triangle count, then 50 bytes a triangle."""
    P = np.asarray(vertices, np.float64).reshape(-1, 3)
    F = np.asarray(faces, np.int64).reshape(-1, 3)
    tri = P[F]
    normal = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    length = np.linalg.norm(normal, axis=1, keepdims=True)
    normal = normal / np.where(length > 0, length, 1.0)
    records = np.zeros(len(F), STL_RECORD)
    records["normal"] = normal
    records["points"] = tri.reshape(-1, 9)
    return bytes(header)[:80].ljust(80, b" ") + struct.pack("<I", len(F)) + records.tobytes()
