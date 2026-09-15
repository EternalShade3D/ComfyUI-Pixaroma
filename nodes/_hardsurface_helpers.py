"""Hard Surface Pixaroma - pure helpers: the state blob and the report text.

No torch and no ComfyUI imports, so D:\\Claude Tests\\_hard_surface_test.py (section B) checks them directly.
"""
import json

STRENGTHS = ("light", "medium", "strong")
SYMMETRY = ("off", "auto")
# Every key here changes the output, so all of them go into the prompt; the viewer's settings
# (looks, views, light) stay on the node and never reach Python, so they never re-run it.
DEFAULT_STATE = {
    "strength": "medium", "keepRound": True, "symmetry": "off", "panelsAsGroups": True, "keepColours": True,
}


def _as_bool(value, default):
    return value if isinstance(value, bool) else default


def parse_state(raw):
    """The hidden HardSurfaceState -> a clean dict. Never raises; every key falls back to its own
    default, so one bad value never throws the others away."""
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
    strength = str(data.get("strength", "")).lower()
    if strength in STRENGTHS:
        state["strength"] = strength
    symmetry = str(data.get("symmetry", "")).lower()
    if symmetry in SYMMETRY:
        state["symmetry"] = symmetry
    for key in ("keepRound", "panelsAsGroups", "keepColours"):
        state[key] = _as_bool(data.get(key), DEFAULT_STATE[key])
    return state


def report_lines(stats, census, notes):
    """What a run did, one line each: the report output and the node's info line.
    `stats` is _hardsurface's stats with `panels` added; `census` is _mesh3d.edge_census."""
    stats, census = stats or {}, census or {}
    panels = int(stats.get("panels", 0))
    lines = []
    if panels <= 0:
        lines.append("No flat panels were found, so the model was not changed.")
    else:
        head = "Flat panels found: {}".format(panels)
        if int(stats.get("round_panels", 0)):
            head += " ({} round parts left alone)".format(int(stats["round_panels"]))
        lines.append(head)
        lines.append("Crisp edges: {:.1f}% -> {:.1f}%".format(float(stats.get("bent_before", 0.0)),
                                                             float(stats.get("bent_after", 0.0))))
        lines.append("Moved at most: {:.2f} mm (average {:.2f} mm) on a 100 mm print".format(
            float(stats.get("moved_max_mm", 0.0)), float(stats.get("moved_mean_mm", 0.0))))
        left = int(stats.get("folded_after", 0))
        folds = "Folded faces repaired: {}".format(max(int(stats.get("folded_before", 0)) - left, 0))
        if int(stats.get("fold_undone", 0)):
            folds += " ({} vertices put back where they were)".format(int(stats["fold_undone"]))
        lines.append(folds)
        if left:
            lines.append("Folded faces left: {}".format(left))
        if int(stats.get("collapsed_faces", 0)):
            lines.append("Bevel faces squeezed onto their creases: {}".format(int(stats["collapsed_faces"])))
    lines.append("Open edges: {}, broken: {}".format(int(census.get("open", 0)), int(census.get("broken", 0))))
    lines.extend(str(note) for note in notes or [])
    return lines
