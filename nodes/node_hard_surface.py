"""Hard Surface Pixaroma - make an AI 3D model hard-surface again: flat panels flat, rounded bevels crisp.

The backend. The face (the viewer with Before / After, the Sharpen switch, Keep round, the gear) lives
in js/hard_surface/. The settings live on node.properties in the browser and arrive in the hidden
HardSurfaceState input (Vue Compat #9); only settings that change the result are sent, so looking
around the model never re-runs it. The result goes back in ui.pixaroma_hardsurface, stamped, because a
cached node replays its executed event (free-vram.md #5).

A run: read the input through _mesh3d_io (an OBJ keeps its quads, groups and colours; a MESH, GLB or STL
keeps its uvs and textures), sharpen it with _hardsurface.sharpen_poly (vertices move, nothing else),
then hand it on three ways: `mesh` (triangles, colours, uvs and textures kept; normals and tangents left
out because the surface moved), `model_3d` (an OBJ with the polygons as they came in, one group per
panel and the colours, for Quad Remesh Pixaroma or Save 3D Pixaroma) and `report` (text). The viewer
gets two OBJ files in temp: the model as it came in and as it went out.

Pure parts + harness: _hardsurface.py, _hardsurface_helpers.py, D:\\Claude Tests\\_hard_surface_test.py.
"""
from __future__ import annotations

import os
import re
import time
from dataclasses import replace

import folder_paths

from . import _hardsurface as hs
from . import _mesh3d as m3
from . import _mesh3d_io as mio
from ._hardsurface_helpers import parse_state, report_lines

CLASS = "PixaromaHardSurface"
HIDDEN_INPUT = "HardSurfaceState"
UI_KEY = "pixaroma_hardsurface"
TEMP_SUBFOLDER = "pixaroma_hardsurface"
WHO = "Hard Surface Pixaroma"
# What the face shows from a run; everything else is in the report text.
FACE_STATS = ("round_panels", "bent_before", "bent_after", "moved_mean_mm", "moved_max_mm", "folded_before",
              "folded_after", "fold_undone", "cap_units", "seconds")

NOTHING_WIRED = (
    "Hard Surface Pixaroma has nothing to sharpen. Wire a mesh, or a model_3d from Load 3D Pixaroma "
    "or another 3D node, into it."
)


def _safe_id(uid):
    return re.sub(r"[^A-Za-z0-9_-]", "_", str(uid if uid is not None else "node"))[:40] or "node"


def _check_cancel():
    """Stops the run between steps when the user cancels it (outside ComfyUI there is nothing to ask)."""
    try:
        import comfy.model_management as mm
    except Exception:
        return
    mm.throw_exception_if_processing_interrupted()


def _write_temp(data, name):
    """Into temp/pixaroma_hardsurface, written over on every run."""
    folder = os.path.join(folder_paths.get_temp_directory(), TEMP_SUBFOLDER)
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, name), "wb") as handle:
        handle.write(data)
    return {"filename": name, "subfolder": TEMP_SUBFOLDER, "type": "temp"}


class PixaromaHardSurface:
    DESCRIPTION = (
        "Makes an AI 3D model hard-surface again before you remesh it: flat panels come out flat and the "
        "rounded bevels between them become crisp edges, while round parts such as grips and barrels are "
        "left alone. It only moves vertices, by a fraction of a millimetre measured as if the model were "
        "printed 100 mm long, so the model keeps its polygons, colours and textures. Sharpen sets how far "
        "it may move: Light, Medium or Strong. Wire in a mesh, or a model_3d from Load 3D Pixaroma or another "
        "3D node. The model_3d output is an OBJ with one group per flat panel, ready for Quad Remesh "
        "Pixaroma or Save 3D Pixaroma; the mesh output goes to any mesh node; report says what changed."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "mesh": ("MESH", {
                    "tooltip": "A mesh from any mesh node, for example the Pixal3D or Trellis 2 nodes or Mesh "
                               "Repair Pixaroma. When a model_3d is wired in as well, the mesh is used.",
                }),
                "model_3d": (mio.FILE_TYPES, {
                    "tooltip": "A 3D model file, for example from Load 3D Pixaroma. GLB, GLTF, OBJ and STL can be "
                               "read. An OBJ keeps its quads, groups and colours.",
                }),
            },
            # Hidden, not required: a required STRING shows as a widget AND a convertible input dot in
            # the Vue frontend (Vue Compat #9).
            "hidden": {
                HIDDEN_INPUT: ("STRING", {"default": "{}"}),
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("MESH", "FILE_3D", "STRING")
    RETURN_NAMES = ("mesh", "model_3d", "report")
    OUTPUT_TOOLTIPS = (
        "The sharpened model as a mesh of triangles, with its colours, uvs and textures. Normals are left out "
        "because the surface moved; nodes that need them work them out again.",
        "The sharpened model as an OBJ file: the polygons as they came in, one group per flat panel (panel_0, "
        "panel_1 and so on, the rest in rest) and the vertex colours. Wire it into Quad Remesh Pixaroma or "
        "Save 3D Pixaroma.",
        "What the run did, as text: the flat panels found, the round parts left alone, how much crisper the "
        "edges are, how far vertices moved and how many folded faces were repaired.",
    )
    FUNCTION = "run"
    # Runs with nothing downstream, so the viewer on the node always has a result to show.
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma/🖼️ Image"

    def run(self, mesh=None, model_3d=None, unique_id=None, **kwargs):
        state = parse_state(kwargs.get(HIDDEN_INPUT))
        started = time.perf_counter()

        model, notes = mio.read_input(mesh, model_3d, WHO)
        if model is None:
            report = {"ok": True, "skipped": True, "message": "nothing is wired in", "stamp": time.perf_counter()}
            return {"ui": {UI_KEY: [report]},
                    "result": (mio.blocked(NOTHING_WIRED), mio.blocked(NOTHING_WIRED), NOTHING_WIRED)}

        bad = m3.count_non_finite(model.poly.vertices)
        if bad:
            notes.append("{} vertices have a position that is not a number; they were left where they are.".format(bad))
        if state["symmetry"] != "off":
            notes.append("Symmetry is not built yet, so the model was not mirrored.")
        params = hs.preset_params(state["strength"], state["keepRound"])
        out = hs.sharpen_poly(model.poly, params, state["panelsAsGroups"], state["keepColours"], _check_cancel)
        sharp = replace(model, poly=out["poly"], normals=None, tangents=None)
        if model.images:
            notes.append("The model_3d file is an OBJ, which keeps no texture here; the mesh output still carries it.")

        after = m3.write_obj(sharp.poly, header=WHO)
        uid = _safe_id(unique_id)
        before_ref = _write_temp(m3.write_obj(model.poly, header=WHO), "hsurf_{}_before.obj".format(uid))
        after_ref = _write_temp(after, "hsurf_{}_after.obj".format(uid))
        census = m3.edge_census(sharp.poly)
        stats = dict(out["stats"], panels=out["panels"])
        lines = report_lines(stats, census, notes)
        report = {
            "ok": True, "skipped": False, "before": before_ref, "after": after_ref, "panels": out["panels"],
            "stats": {k: stats[k] for k in FACE_STATS}, "census": census, "faces": m3.face_summary(sharp.poly),
            "source": model.source, "colours": sharp.poly.colours is not None, "texture": "texture" in sharp.images,
            # What this run was asked for, from its own state: the face compares it with the settings it
            # shows now, so it can say when the model on the node no longer matches them.
            "request": dict(state), "lines": lines, "notes": notes,
            "seconds": round(time.perf_counter() - started, 2), "stamp": time.perf_counter(),
        }
        return {"ui": {UI_KEY: [report]},
                "result": (mio.to_mesh(sharp), mio.file3d(after, "obj"), "\n".join(lines))}


NODE_CLASS_MAPPINGS = {CLASS: PixaromaHardSurface}
NODE_DISPLAY_NAME_MAPPINGS = {CLASS: "Hard Surface Pixaroma"}
