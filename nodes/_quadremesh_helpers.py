"""Quad Remesh Pixaroma - pure helpers: the state blob and the report text.

The node was replaced by Edit 3D on 2026-09-15; Edit 3D still reads SYMMETRY from here.

No torch and no ComfyUI imports, so D:\\Claude Tests\\_quad_remesh_test.py (section B) checks them directly.
"""
import json

# 200,000 for characters and small round details (a robot's emblem rings and fingers were blocky at 100,000:
# quad_remesh_proto/README.txt step11_models). Keep core.mjs in step.
DENSITIES = (5000, 10000, 25000, 50000, 100000, 200000)
SYMMETRY = ("off", "auto", "x", "y", "z")
# Every key here changes the output, so all of them go into the prompt; the viewer's settings (Before or
# Quads, looks, views, light) stay on the node and never reach Python, so looking around never re-runs it.
# 200,000 quads by default since 2026-09-15 (output/claude_output/improve_chain): the gun rendered crisper at
# 200,000 than at 100,000, and 100,000 left a robot's emblem rings and fingers blocky (README step11_models);
# 25,000 left small slots and teeth rough (step9_quality). Keep core.mjs in step.
DEFAULT_STATE = {"quads": 200000, "symmetry": "auto", "crisp": True, "keepColours": True, "keepGroups": True}


def parse_state(raw):
    """The hidden QuadRemeshState -> a clean dict. Never raises; every key falls back to its own default, so
    one bad value never throws the others away."""
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
    try:
        quads = int(data.get("quads"))
    except Exception:
        quads = None
    if quads in DENSITIES:
        state["quads"] = quads
    symmetry = str(data.get("symmetry", "")).lower()
    if symmetry in SYMMETRY:
        state["symmetry"] = symmetry
    for key in ("crisp", "keepColours", "keepGroups"):
        value = data.get(key)
        state[key] = value if isinstance(value, bool) else DEFAULT_STATE[key]
    return state


def _n(value):
    return "{:,}".format(int(value))


def report_lines(stats, census, notes, requested_symmetry):
    """What a run did, one line each: the report output and the node's info line.
    `stats` is _quadremesh.quad_remesh's stats; `census` is _mesh3d.edge_census of the result."""
    stats, census = stats or {}, census or {}
    lines = ["Quads: {} of {} faces ({:.1f}%)".format(_n(stats.get("quads", 0)), _n(stats.get("faces", 0)),
                                                     float(stats.get("quads_pct", 0.0)))]
    if census.get("poles_pct") is not None:
        lines.append("Poles: {:.1f}% of the inner points".format(float(census["poles_pct"])))
    lines.append("Off the input: {:.2f} mm on average, 95% within {:.2f} mm (on a 100 mm print)".format(
        float(stats.get("mean_mm", 0.0)), float(stats.get("p95_mm", 0.0))))
    axis = stats.get("symmetry_axis")
    if requested_symmetry == "off":
        lines.append("Symmetry: off")
    elif axis:
        lines.append("Symmetry: mirrored across {}".format(str(axis).upper()))
    else:
        lines.append("Symmetry: no mirror found, so the model was remeshed whole")
    filled, kept = int(stats.get("holes_filled", 0)), int(stats.get("holes_kept_open", 0))
    if filled or kept:
        text = "Holes closed: {}".format(_n(filled))
        if kept:
            text += " ({} left open where the model itself is open)".format(_n(kept))
        lines.append(text)
    lines.append("Open edges: {}, broken: {}".format(int(census.get("open", 0)), int(census.get("broken", 0))))
    lines.extend(str(note) for note in notes or [])
    return lines
