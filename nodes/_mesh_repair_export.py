"""Mesh Repair Pixaroma - the repaired model as a file a 3D printer's slicer opens.

ComfyUI's own Save 3D Model writes a MESH only as GLB (so does Mesh to File 3D),
and slicers want STL. This builds a binary STL that Save 3D Model then writes
as it is, because it saves a File3D in the file's own format.

Pure numpy: no torch and no ComfyUI, so the harness can check the bytes.
"""
import struct

import numpy as np

HEADER = b"Mesh Repair Pixaroma"
RECORD = np.dtype([("normal", "<f4", (3,)), ("points", "<f4", (9,)), ("attr", "<u2")])


def printable_points(V, longest_mm):
    """Stand the model up the way a slicer expects and put it on the bed.

    glTF models (Pixal3D, Trellis 2, Load 3D) stand on Y; slicers stand on Z,
    so written as they are they lie on their back. (x, y, z) -> (x, -z, y) is a
    turn, not a mirror, so every face keeps pointing outward. The model is
    centred over the origin, sits on z = 0, and its longest side becomes
    `longest_mm` (None keeps the model's own units).
    """
    V = np.asarray(V, np.float64).reshape(-1, 3)
    P = np.stack([V[:, 0], -V[:, 2], V[:, 1]], axis=1)
    if len(P) == 0:
        return P
    lo, hi = P.min(0), P.max(0)
    if longest_mm:
        longest = float((hi - lo).max())
        if longest > 0:
            P = P * (float(longest_mm) / longest)
            lo, hi = P.min(0), P.max(0)
    centre = (lo + hi) / 2.0
    return P - np.array([centre[0], centre[1], lo[2]])


def stl_bytes(V, F, longest_mm=100.0):
    """A binary STL of (V, F): an 80-byte header, the triangle count, then 50
    bytes a triangle (normal, three corners, a zero attribute)."""
    F = np.asarray(F, np.int64).reshape(-1, 3)
    P = printable_points(V, longest_mm)
    tri = P[F]
    normal = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    length = np.linalg.norm(normal, axis=1, keepdims=True)
    normal = normal / np.where(length > 0, length, 1.0)
    records = np.zeros(len(F), RECORD)
    records["normal"] = normal
    records["points"] = tri.reshape(-1, 9)
    return HEADER.ljust(80, b" ") + struct.pack("<I", len(F)) + records.tobytes()
