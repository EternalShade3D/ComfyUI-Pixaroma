"""Quad Remesh Pixaroma - lay clean quads over a 3D model: crisp edges, closed holes, true symmetry.

The backend. The face (Before / Quads, the Quads and Symmetry rows, Follow crisp edges, the gear) lives in
js/quad_remesh/. The settings live on node.properties in the browser and arrive in the hidden
QuadRemeshState input (Vue Compat #9); only settings that change the result are sent, so looking around the
model never re-runs it. The result goes back in ui.pixaroma_quadremesh, stamped, because a cached node
replays its executed event (free-vram.md #5).

A run: read the input through _mesh3d_io (an OBJ keeps its groups and colours; a MESH, GLB or STL keeps its
uvs and texture), lay the quads with _quadremesh.quad_remesh, then hand them on three ways: `mesh` (each
quad split in two, colours carried over), `model_3d` (an OBJ that keeps the quads, groups and colours, for
Save 3D Pixaroma or Blender) and `report` (text). The viewer gets two OBJ files in temp: the model as it
came in and the quads.

The Instant Meshes engine runs in this process and holds Python's lock while it lays the quads, so
ComfyUI's page pauses for those seconds. A separate process would avoid that, but it is a subprocess, which
this pack does not add for new nodes (.claude/patterns/registry-compliance.md 4e).

Pure parts + harness: _quadremesh.py, _quadremesh_helpers.py, D:\\Claude Tests\\_quad_remesh_test.py.
"""
from __future__ import annotations

import os
import re
import threading
import time

import folder_paths

from . import _mesh3d as m3
from . import _mesh3d_io as mio
from . import _quadremesh as qr
from ._quadremesh_helpers import parse_state, report_lines

CLASS = "PixaromaQuadRemesh"
HIDDEN_INPUT = "QuadRemeshState"
UI_KEY = "pixaroma_quadremesh"
TEMP_SUBFOLDER = "pixaroma_quadremesh"
WHO = "Quad Remesh Pixaroma"
# What the face shows from a run; everything else is in the report text.
FACE_STATS = ("quads", "faces", "quads_pct", "mean_mm", "p95_mm", "symmetry_axis", "mirror_median_mm",
              "holes_filled", "holes_kept_open", "slivers_flipped", "seconds")

NOTHING_WIRED = (
    "Quad Remesh Pixaroma has nothing to remesh. Wire a mesh, or a model_3d from Load 3D Pixaroma, "
    "Hard Surface Pixaroma or another 3D node, into it."
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


def _temp_folder():
    folder = os.path.join(folder_paths.get_temp_directory(), TEMP_SUBFOLDER)
    os.makedirs(folder, exist_ok=True)
    return folder


def _write_temp(data, name):
    """Into temp/pixaroma_quadremesh, written over on every run."""
    with open(os.path.join(_temp_folder(), name), "wb") as handle:
        handle.write(data)
    return {"filename": name, "subfolder": TEMP_SUBFOLDER, "type": "temp"}


class PixaromaQuadRemesh:
    DESCRIPTION = (
        "Lays clean quads over a 3D model, for example one made by AI: crisp edges where the model has them, "
        "the holes the quads would leave closed, and a true mirror when the model is symmetric. Quads sets how "
        "many; Symmetry finds the mirror or takes the axis you pick; Follow crisp edges keeps edge loops on the "
        "sharp edges. Wire in a mesh, or a model_3d from Load 3D Pixaroma or Hard Surface Pixaroma. The model_3d "
        "output is an OBJ that keeps the quads, its groups and colours, for Save 3D Pixaroma or Blender; the mesh "
        "output goes to any mesh node; report says what came out. ComfyUI's page pauses while the quads are laid."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "mesh": ("MESH", {
                    "tooltip": "A mesh from any mesh node, for example Mesh Repair Pixaroma. When a model_3d is wired "
                               "in as well, the mesh is used.",
                }),
                "model_3d": (mio.FILE_TYPES, {
                    "tooltip": "A 3D model file, for example from Load 3D Pixaroma or Hard Surface Pixaroma. GLB, "
                               "GLTF, OBJ and STL can be read; an OBJ brings its groups and colours.",
                }),
            },
            # Hidden, not required: a required STRING shows as a widget AND a convertible input dot in the Vue
            # frontend (Vue Compat #9).
            "hidden": {
                HIDDEN_INPUT: ("STRING", {"default": "{}"}),
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("MESH", "FILE_3D", "STRING")
    RETURN_NAMES = ("mesh", "model_3d", "report")
    OUTPUT_TOOLTIPS = (
        "The quads as a mesh of triangles (each quad split in two), with the colours carried over. Wire it into "
        "any mesh node, for example ComfyUI's Unwrap Mesh to bake a new texture.",
        "The quads as an OBJ file: real quads, the groups of the model that came in (Hard Surface's panels) and the "
        "colours. Wire it into Save 3D Pixaroma.",
        "What came out, as text: how many quads, how clean the grid is, how far it sits from the model, the mirror, "
        "the holes closed and the open edges.",
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
        # Before any file is written: without the engine there is nothing this node can do.
        if not qr.engine_available():
            raise RuntimeError(qr.ENGINE_MESSAGE)

        bad = m3.count_non_finite(model.poly.vertices)
        if bad:
            notes.append("{} points of the model are not numbers; the faces using them were left out.".format(bad))
        uid = _safe_id(unique_id)
        # This run's own folder: the process id alone collides when two runs share a process.
        work = os.path.join(_temp_folder(), "work_{}_{}_{}".format(uid, os.getpid(), threading.get_ident()))
        texture = model.images.get("texture")
        texture_np = texture[0].detach().cpu().numpy() if texture is not None else None
        out = qr.quad_remesh(model.poly, dict(state), work, _check_cancel, uvs=model.uvs, texture=texture_np)
        if texture_np is not None and state["keepColours"]:
            notes.append("The texture was carried over as colours on the new points. For a new texture, unwrap and "
                         "bake the mesh output with ComfyUI's own nodes.")

        quad_model = mio.Model3D(poly=out["poly"], source=model.source)
        after = m3.write_obj(quad_model.poly, header=WHO)
        before_ref = _write_temp(m3.write_obj(model.poly, header=WHO), "qremesh_{}_before.obj".format(uid))
        after_ref = _write_temp(after, "qremesh_{}_after.obj".format(uid))
        census = m3.edge_census(quad_model.poly)
        stats = out["stats"]
        lines = report_lines(stats, census, notes, state["symmetry"])
        report = {
            "ok": True, "skipped": False, "before": before_ref, "after": after_ref,
            "stats": {k: stats[k] for k in FACE_STATS if k in stats}, "census": census,
            "faces": m3.face_summary(quad_model.poly), "source": model.source,
            "colours": quad_model.poly.colours is not None,
            # What this run was asked for, from its own state: the face compares it with the settings it shows
            # now, so it can say when the quads on the node no longer match them.
            "request": dict(state), "lines": lines, "notes": notes,
            "seconds": round(time.perf_counter() - started, 2), "stamp": time.perf_counter(),
        }
        return {"ui": {UI_KEY: [report]},
                "result": (mio.to_mesh(quad_model), mio.file3d(after, "obj"), "\n".join(lines))}


NODE_CLASS_MAPPINGS = {CLASS: PixaromaQuadRemesh}
NODE_DISPLAY_NAME_MAPPINGS = {CLASS: "Quad Remesh Pixaroma"}
