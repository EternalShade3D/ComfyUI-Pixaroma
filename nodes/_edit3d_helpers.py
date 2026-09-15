"""Edit 3D Pixaroma - pure helpers: the state blob, the file names, the source keys, the heavy-button request
and the report text.

No torch and no ComfyUI imports, so D:\\Claude Tests\\_edit3d_test.py (section A) checks them directly.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import zlib

import numpy as np

from ._quadremesh_helpers import SYMMETRY

# input/pixaroma_edit3d holds the saved edits and their snapshot pictures; temp/pixaroma_edit3d holds the copy
# of a wired model the editor opens and the work files of the heavy buttons.
SUBFOLDER = "pixaroma_edit3d"
# The ONLY names the node reads back. /prompt is unauthenticated, so a name is matched here BEFORE any path is
# built (path-containment.md #0). The lookahead keeps a work file from ever being taken for an edit: the id
# allows "_", so without it "edit3d_1_work.obj" would match.
EDITED_NAME = re.compile(r"^edit3d_(?![A-Za-z0-9_-]*_work(?:_out)?\.)[A-Za-z0-9_-]{1,40}\.(obj|glb)$")
WORK_NAME = re.compile(r"^edit3d_[A-Za-z0-9_-]{1,40}_work\.(obj|glb)$")
KEY_MAX = 200
EDIT_COUNT_MAX = 1000000
# How many vertices the fingerprint reads in full; the bounding box and the counts cover the rest.
_FINGERPRINT_POINTS = 4096
# The head and the tail of a picked file that go into its key (the SAME number as js/edit3d/filekey.mjs).
SAMPLE_BYTES = 65536

OPS = ("quads", "solid", "mirror", "reduce")
QUAD_COUNTS = (50000, 100000, 200000)
SOLID_DETAILS = (256, 384, 512)
MIRROR_AXES = ("x", "y", "z")
MIRROR_SIDES = ("positive", "negative")
# How much of the model Reduce polygons takes AWAY: 75 keeps a quarter of the triangles.
REDUCE_PERCENTS = (25, 50, 75)
OP_DEFAULTS = {
    "quads": {"quads": 200000, "symmetry": "auto"},
    "solid": {"detail": 384},
    "mirror": {"axis": "x", "side": "positive"},
    "reduce": {"percent": 50},
}
DEFAULT_STATE = {"edited": "", "sourceKey": "", "editCount": 0}


def safe_id(uid):
    """A node id -> the piece of a file name it becomes. The SAME rule as js/edit3d/core.mjs safeId."""
    return re.sub(r"[^A-Za-z0-9_-]", "_", str(uid if uid is not None else "node"))[:40] or "node"


def _load_json(raw):
    data = raw
    if isinstance(data, (bytes, bytearray)):
        data = bytes(data).decode("utf-8", "replace")
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except Exception:
            data = None
    return data if isinstance(data, dict) else {}


def parse_state(raw):
    """The hidden Edit3DState -> {edited, sourceKey, editCount}. Never raises; a bad value takes its default."""
    data = _load_json(raw)
    state = dict(DEFAULT_STATE)
    edited = data.get("edited")
    if isinstance(edited, str) and EDITED_NAME.match(edited):
        state["edited"] = edited
    key = data.get("sourceKey")
    if isinstance(key, str):
        state["sourceKey"] = key[:KEY_MAX]
    count = data.get("editCount")
    if isinstance(count, int) and not isinstance(count, bool) and 0 <= count <= EDIT_COUNT_MAX:
        state["editCount"] = count
    return state


def _pick(value, allowed, default):
    if isinstance(value, bool):
        return default
    if isinstance(value, str):
        return value if value in allowed else default
    try:
        num = float(value)
    except (TypeError, ValueError):
        return default
    for a in allowed:
        if not isinstance(a, str) and float(a) == num:
            return a
    return default


def parse_op(raw):
    """A request -> (op, params), every param one of its allowed values. Raises ValueError on an unknown op."""
    data = raw if isinstance(raw, dict) else {}
    op = data.get("op")
    if op not in OPS:
        raise ValueError("Edit 3D Pixaroma: unknown operation {!r}.".format(op))
    given = data.get("params") if isinstance(data.get("params"), dict) else {}
    params = dict(OP_DEFAULTS[op])
    if op == "quads":
        params["quads"] = _pick(given.get("quads"), QUAD_COUNTS, params["quads"])
        sym = str(given.get("symmetry", "")).lower()
        params["symmetry"] = sym if sym in SYMMETRY else params["symmetry"]
    elif op == "solid":
        params["detail"] = _pick(given.get("detail"), SOLID_DETAILS, params["detail"])
    elif op == "mirror":
        axis = str(given.get("axis", "")).lower()
        params["axis"] = axis if axis in MIRROR_AXES else params["axis"]
        side = str(given.get("side", "")).lower()
        params["side"] = side if side in MIRROR_SIDES else params["side"]
    elif op == "reduce":
        params["percent"] = _pick(given.get("percent"), REDUCE_PERCENTS, params["percent"])
    return op, params


def parse_request(raw):
    """The hidden Edit3DOp string -> (work file name, op, params). The name is matched against WORK_NAME here,
    before anything builds a path from it. Raises ValueError with a plain message."""
    data = _load_json(raw)
    name = data.get("file")
    if not isinstance(name, str) or not WORK_NAME.match(name):
        raise ValueError("Edit 3D Pixaroma: that is not a work file the editor writes.")
    op, params = parse_op(data)
    return name, op, params


def fingerprint(vertices, counts):
    """A short key for a mesh: sha1 of its vertex and face counts, its box (rounded to a millionth of the
    diagonal) and the first _FINGERPRINT_POINTS vertices as float32. The same model always gives the same key;
    a model that changed anywhere changes it (a vertex past the sample still moves the box, or the counts)."""
    V = np.asarray(vertices, np.float64).reshape(-1, 3)
    counts = np.asarray(counts, np.int64).reshape(-1)
    h = hashlib.sha1()
    h.update("{}:{}:{}".format(len(V), len(counts), int(counts.sum()) if len(counts) else 0).encode("ascii"))
    if len(V):
        finite = V[np.isfinite(V).all(axis=1)]
        if len(finite):
            lo, hi = finite.min(0), finite.max(0)
            diag = float(np.linalg.norm(hi - lo)) or 1.0
            box = np.round(np.concatenate([lo, hi]) / (diag * 1e-6)).astype(np.int64)
            h.update(box.tobytes())
        h.update(np.ascontiguousarray(V[:_FINGERPRINT_POINTS], np.float32).tobytes())
    return "m:" + h.hexdigest()[:32]


def file_sample(path):
    """The first and last SAMPLE_BYTES of a file (the whole file when it is smaller): a picked model's key
    follows its header and its last bytes without reading a 100 MB file on every run. -> (size, bytes)"""
    size = os.path.getsize(path)
    with open(path, "rb") as fh:
        if size <= 2 * SAMPLE_BYTES:
            return size, fh.read()
        head = fh.read(SAMPLE_BYTES)
        fh.seek(size - SAMPLE_BYTES)
        return size, head + fh.read(SAMPLE_BYTES)


def file_key(name, size, sample):
    """The source key of a picked file: its BARE name, its size and the crc32 of its head and tail. The SAME
    rule as js/edit3d/filekey.mjs fileKey, which the editor computes from the bytes it opened, so the two
    sides agree without a route (a file's modification time is not visible to the browser)."""
    return "f:{}:{}:{:08x}".format(name, int(size), zlib.crc32(bytes(sample)) & 0xFFFFFFFF)


def _n(value):
    return "{:,}".format(int(value or 0))


def faces_text(faces):
    faces = faces or {}
    parts = []
    if faces.get("quads"):
        parts.append("{} quads".format(_n(faces["quads"])))
    if faces.get("triangles"):
        parts.append("{} triangles".format(_n(faces["triangles"])))
    if faces.get("ngons"):
        parts.append("{} larger polygons".format(_n(faces["ngons"])))
    return " + ".join(parts) or "no faces"


def report_lines(report):
    """The report output, one line each: what was handed on, its edges, then the notes."""
    report = report or {}
    count = int(report.get("editCount") or 0)
    if report.get("used") == "edited":
        head = "Edited model ({} edit{}): {}".format(count, "" if count == 1 else "s", faces_text(report.get("faces")))
    else:
        head = "The model as it came (no edits): {}".format(faces_text(report.get("faces")))
    edges = report.get("edges") or {}
    lines = [head, "Open edges: {}, broken: {}, pieces: {}".format(
        int(edges.get("open", 0)), int(edges.get("broken", 0)), int(edges.get("pieces", 0)))]
    lines.extend(str(note) for note in report.get("notes") or [])
    return lines
