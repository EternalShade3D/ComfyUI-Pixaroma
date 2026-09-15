"""Save 3D Pixaroma - pure helpers: the state blob, the format choice, the check line.

No torch and no ComfyUI imports, so D:\\Claude Tests\\_save3d_test.py checks them directly.
"""
import json
import re

FORMATS = ("auto", "obj", "glb", "stl")
MODES = ("preview", "save")
UPS = ("auto", "y", "z")
# The same choices as Mesh Repair's stl output ("model" keeps the model's own units).
STL_SIZES = ("model", 50, 100, 150, 200, 300)
MAX_TURNS = 64
DEFAULT_NAME = "3d/pixaroma"

DEFAULT_STATE = {
    "mode": "preview", "turns": [], "center": True, "ground": True, "format": "auto",
    "name": DEFAULT_NAME, "up": "auto", "stlSize": 100,
}

_BAD_CHARS = re.compile(r'[<>:"|?*\x00-\x1f]')


def clean_name(raw):
    """A subfolder/prefix typed on the node -> a relative name with no way out.

    /prompt is unauthenticated, so anything can arrive here. Core's
    get_save_image_path refuses a folder outside output/ on its own; this keeps
    the name tidy before it gets there: no drive letter, no leading slash, no
    '..' step and none of the characters Windows refuses in a file name.
    """
    if not isinstance(raw, str):
        return DEFAULT_NAME
    text = re.sub(r"^[A-Za-z]:", "", raw.replace("\\", "/").strip())
    parts = []
    for part in text.split("/"):
        part = _BAD_CHARS.sub("", part).strip()
        if part in ("", ".", ".."):
            continue
        parts.append(part)
    return "/".join(parts) or DEFAULT_NAME


def _as_bool(value, default):
    return value if isinstance(value, bool) else default


def parse_state(raw):
    """The hidden Save3DState -> a clean dict. Never raises; every key falls back
    to its own default, so one bad value never throws the others away."""
    data = raw
    if isinstance(data, (bytes, bytearray)):
        data = bytes(data).decode("utf-8", "replace")
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except Exception:
            data = None
    if not isinstance(data, dict):
        data = {}

    state = dict(DEFAULT_STATE)
    state["turns"] = []
    mode = str(data.get("mode", "")).lower()
    if mode in MODES:
        state["mode"] = mode
    turns = data.get("turns")
    if isinstance(turns, list):
        state["turns"] = [t.lower() for t in turns
                          if isinstance(t, str) and t.lower() in ("x", "y", "z")][:MAX_TURNS]
    state["center"] = _as_bool(data.get("center"), True)
    state["ground"] = _as_bool(data.get("ground"), True)
    fmt = str(data.get("format", "")).lower()
    if fmt in FORMATS:
        state["format"] = fmt
    up = str(data.get("up", "")).lower()
    if up in UPS:
        state["up"] = up
    size = data.get("stlSize")
    if not isinstance(size, bool) and size in STL_SIZES:
        state["stlSize"] = size
    if "name" in data:
        state["name"] = clean_name(data.get("name"))
    return state


def pick_format(state_format, mesh):
    """Auto keeps polygons as OBJ, because GLB and STL hold triangles only, and
    writes a triangle model as GLB, which keeps its colours."""
    if state_format in ("obj", "glb", "stl"):
        return state_format
    counts = getattr(mesh, "counts", None)
    if counts is not None and len(counts):
        biggest = int(counts.max()) if hasattr(counts, "max") else max(counts)
        if biggest > 3:
            return "obj"
    return "glb"


def check_line(flags):
    """The line under the Fix row. It says only what can be measured: whether the
    model floats, sinks or sits off center. What its front should be, nobody can
    measure, which is what the FRONT arrow on the node is for."""
    parts = []
    if flags.get("floating"):
        parts.append("Floating above the ground")
    if flags.get("sunk"):
        parts.append("Sunk into the ground")
    if flags.get("off_center"):
        parts.append("Off center")
    if not parts:
        return {"level": "good", "text": "On the ground · centered"}
    return {"level": "warn", "text": " · ".join(parts)}
