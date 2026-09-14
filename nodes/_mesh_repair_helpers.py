"""Mesh Repair Pixaroma - the option lists, the state blob and the written report.

Pure: no torch and no ComfyUI imports, so the harness can load it anywhere
(D:\\Claude Tests\\_mesh_repair_test.py).
"""
import json
import math

MODES = ("solid", "tidy")
# Grid cells across the model's longest side. 384 is the default the user chose
# after the research; on the Ep34 radio (700k triangles) the whole repair took
# about 23 s in the node, including bringing the triangles back down.
DETAILS = (256, 384, 512, 768)
# How wide a gap gets sealed before the inside is filled, as a percent of the
# longest side. "auto" searches for it (see _mesh_repair_solid.search_seal_percent).
SEALS = ("auto", 0.5, 1.0, 2.0, 3.0, 5.0)
# Pieces smaller than this percent of the biggest piece are removed. 0 keeps all.
LOOSE = (0.0, 0.5, 1.0, 2.0, 5.0)
# "input" = no more triangles than came in, "all" = never reduce.
TRIANGLE_TARGETS = ("input", "all", 100000, 250000, 500000, 1000000, 2000000)
# The longest side of the stl output in millimetres. "model" keeps the model's
# own units, and an AI model is usually about one unit across - one millimetre.
PRINT_SIZES = ("model", 50, 100, 150, 200, 300)

DEFAULT_STATE = {
    "mode": "solid",
    "detail": 384,
    "seal": "auto",
    "loose": 1.0,
    "keepDetail": True,
    "keepColours": True,
    "triangles": "input",
    "printSize": 100,
}


def _number(value):
    """A finite float from a number or a numeric string, else None. Booleans are
    not numbers here: json turns true into True, and True == 1 would otherwise
    silently pick an option."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        out = float(value)
    elif isinstance(value, str):
        try:
            out = float(value.strip())
        except ValueError:
            return None
    else:
        return None
    return out if math.isfinite(out) else None


def _pick(value, allowed, default):
    """The allowed entry that equals `value` (numbers compared by value), else default."""
    if isinstance(value, str) and value in allowed:
        return value
    num = _number(value)
    if num is not None:
        for option in allowed:
            if not isinstance(option, str) and abs(float(option) - num) < 1e-9:
                return option
    return default


def parse_state(raw):
    """The hidden MeshRepairState -> a clean dict. Never raises.

    /prompt is unauthenticated, so the blob can be anything at all: broken JSON,
    a list, a bare number, bytes, nested junk. Each key falls back to its own
    default, so one bad value never throws away the others.
    """
    data = raw
    if isinstance(raw, (bytes, bytearray)):
        data = bytes(raw).decode("utf-8", "replace")
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except Exception:
            data = None
    if not isinstance(data, dict):
        data = {}

    state = dict(DEFAULT_STATE)
    mode = data.get("mode")
    state["mode"] = mode if isinstance(mode, str) and mode in MODES else DEFAULT_STATE["mode"]
    state["detail"] = int(_pick(data.get("detail"), DETAILS, DEFAULT_STATE["detail"]))
    seal = _pick(data.get("seal"), SEALS, DEFAULT_STATE["seal"])
    state["seal"] = seal if seal == "auto" else float(seal)
    state["loose"] = float(_pick(data.get("loose"), LOOSE, DEFAULT_STATE["loose"]))
    for key in ("keepDetail", "keepColours"):
        value = data.get(key)
        state[key] = value if isinstance(value, bool) else DEFAULT_STATE[key]
    target = _pick(data.get("triangles"), TRIANGLE_TARGETS, DEFAULT_STATE["triangles"])
    state["triangles"] = target if isinstance(target, str) else int(target)
    size = _pick(data.get("printSize"), PRINT_SIZES, DEFAULT_STATE["printSize"])
    state["printSize"] = size if isinstance(size, str) else int(size)
    return state


def triangle_target(state, input_triangles):
    """How many triangles the result may have, or None for no limit."""
    target = state.get("triangles", "input")
    if target == "all":
        return None
    if target == "input":
        return max(1, int(input_triangles))
    return max(1, int(target))


def print_size_mm(state):
    """The stl output's longest side in millimetres, or None for the model's own units."""
    size = (state or {}).get("printSize", DEFAULT_STATE["printSize"])
    return None if size == "model" else float(size)


def _count(value):
    try:
        return "{:,}".format(int(value))
    except (TypeError, ValueError):
        return "-"


def _yes(value):
    return "yes" if value else "no"


def report_text(report):
    """The plain-English report for the STRING output."""
    if not isinstance(report, dict):
        return "Mesh Repair Pixaroma: no report"
    if not report.get("ok", False):
        return "Mesh Repair Pixaroma: " + str(report.get("message") or "the repair failed")
    if report.get("skipped"):
        return "Mesh Repair Pixaroma: " + str(report.get("message") or "nothing to do")

    before = report.get("before") or {}
    after = report.get("after") or {}
    solid = report.get("mode") == "solid"
    title = "Make solid, detail {}".format(report.get("detail")) if solid else "Tidy only"
    lines = ["Mesh Repair Pixaroma - " + title]

    def row(label, key):
        if key in before and key in after:
            lines.append("{}: {} -> {}".format(label, _count(before[key]), _count(after[key])))

    row("Real holes", "holes")
    row("Broken edges", "broken")
    row("Loose bits", "loose")
    row("Faces turned the wrong way", "flipped")
    inside = report.get("inside") or {}
    if inside.get("before") is not None and inside.get("after") is not None:
        lines.append("Inside, cut through the middle: {:.0f}% solid -> {:.0f}% solid".format(
            inside["before"], inside["after"]))
    lines.append("Watertight: {} -> {}".format(_yes(before.get("watertight")), _yes(after.get("watertight"))))
    row("Triangles", "triangles")
    if solid and report.get("sealPercent") is not None:
        lines.append("Gaps sealed up to {:.1f}% of the model size{}".format(
            float(report["sealPercent"]), " (Auto)" if report.get("sealAuto") else ""))
    size = report.get("printSize")
    if size is not None:
        lines.append("STL file: in the model's own units, standing on Z" if size == "model"
                     else "STL file: longest side {} mm, standing on Z".format(size))
    for note in report.get("notes") or []:
        lines.append(str(note))
    if report.get("seconds") is not None:
        lines.append("Took {:.1f} s".format(float(report["seconds"])))
    return "\n".join(lines)
