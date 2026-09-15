"""Edit 3D Pixaroma - open a 3D model, clean it up in a fullscreen editor, hand the edited model on.

The node is thin. The editor (js/edit3d/) saves the edited model through ComfyUI's own upload route into
input/pixaroma_edit3d/edit3d_<id>.obj (or .glb when it keeps a texture): ONE fixed name per node, written
over on every Save. The hidden Edit3DState carries that name and the key of the model it was made on. A run
hands the edit on while the model still has that key, and passes the model through unchanged otherwise, with
a note. A WIRED model is also copied to temp/pixaroma_edit3d for the editor to open, because the browser
cannot read a mesh wire.

The four heavy buttons (Quads, Make solid, Mirror, Reduce polygons) run in PixaromaEdit3DOp below, a hidden
one-node job the editor queues through ComfyUI's own /prompt. There is deliberately no route of our own: a
route that writes files is the shape .claude/patterns/registry-compliance.md section 2d measured on every
banned pack, and 4e #2 says to do the work in a node instead.

Pure helpers + harness: _edit3d_helpers.py, _edit3d_ops.py, D:\\Claude Tests\\_edit3d_test.py.
Design: output/claude_output/edit3d_idea/SPEC.md.
"""
from __future__ import annotations

import os
import threading
import time

import folder_paths

from . import _mesh3d as m3
from . import _mesh3d_io as mio
from ._edit3d_helpers import (
    EDITED_NAME, SUBFOLDER, WORK_NAME, file_key, file_sample, fingerprint, parse_request, parse_state,
    report_lines, safe_id,
)
from ._load3d_helpers import NONE, is_model_name, list_models, strip_annotation
from ._path_guard import is_path_under, rel_is_rooted, safe_join

CLASS = "PixaromaEdit3D"
OP_CLASS = "PixaromaEdit3DOp"
HIDDEN_INPUT = "Edit3DState"
OP_INPUT = "Edit3DOp"
UI_KEY = "pixaroma_edit3d"
OP_UI_KEY = "pixaroma_edit3d_op"
WHO = "Edit 3D Pixaroma"
# Python reads these; the editor also opens FBX and PLY (Load 3D's list).
PY_READABLE = ("obj", "glb", "gltf", "stl")
# Only for a harness mutation: the node MUST compare the source key.
_KEY_CHECK = True

NOTHING = (
    "Edit 3D Pixaroma has nothing to edit. Pick a model on the node, use its Upload button, or wire a mesh "
    "or a model_3d into it."
)


def _dir(getter):
    try:
        return getter()
    except Exception:
        return None


def _model_roots():
    return [d for d in (_dir(folder_paths.get_input_directory), _dir(folder_paths.get_output_directory)) if d]


def _resolve_model(name):
    """An untrusted combo value -> a real model file in input/ or output/, or None. Load 3D's rule: the lexical
    screen FIRST (resolving \\\\host\\share already leaks a credential), then the annotation and extension
    allowlists, then containment (path-containment.md)."""
    if not isinstance(name, str) or not name or name == NONE:
        return None
    bare, kind = strip_annotation(name)
    if kind not in ("input", "output") or rel_is_rooted(bare) or not is_model_name(bare):
        return None
    try:
        path = folder_paths.get_annotated_filepath(name)
    except Exception:
        return None
    roots = _model_roots()
    if not roots or not is_path_under(path, *roots):
        return None
    return path if os.path.isfile(path) else None


def _file3d(path):
    from comfy_api.latest import Types

    return Types.File3D(path)


def _edited_path(name):
    """A saved-edit name -> its file in input/pixaroma_edit3d, or None. The pattern is matched BEFORE any path
    is built, and safe_join keeps the result inside the folder."""
    if not isinstance(name, str) or not EDITED_NAME.match(name):
        return None
    base = _dir(folder_paths.get_input_directory)
    if not base:
        return None
    path = safe_join(os.path.join(base, SUBFOLDER), name)
    return path if path and os.path.isfile(path) else None


def _temp_folder():
    folder = os.path.join(folder_paths.get_temp_directory(), SUBFOLDER)
    os.makedirs(folder, exist_ok=True)
    return folder


def _work_path(name):
    """A work-file name the heavy-button job was given -> its file in temp/pixaroma_edit3d, or None."""
    if not isinstance(name, str) or not WORK_NAME.match(name):
        return None
    path = safe_join(_temp_folder(), name)
    return path if path and os.path.isfile(path) else None


def _stat_key(path):
    try:
        s = os.stat(path)
    except OSError:
        return ""
    return "{}:{}".format(s.st_mtime_ns, s.st_size)


def _read_file(path):
    """A model file -> Model3D. An OBJ keeps its polygons, groups and colours; GLB, GLTF and STL go through
    core's own reader and keep their uvs and texture."""
    ext = os.path.splitext(path)[1].lower().lstrip(".")
    if ext == "obj":
        with open(path, "rb") as fh:
            return mio.Model3D(poly=m3.read_obj(fh.read()), source="obj")
    return mio.from_file(_file3d(path), WHO)


def _write_input_copy(model, uid, key):
    """The wired model as a file the editor can open: an OBJ (polygons, groups, colours), or a GLB when it has
    a texture. Rewritten only when the model changed (its key sits beside it); ComfyUI empties temp when it
    starts, so after a restart the face asks for one run."""
    folder = _temp_folder()
    textured = "texture" in model.images and model.uvs is not None
    name = "edit3d_{}_in.{}".format(uid, "glb" if textured else "obj")
    path = os.path.join(folder, name)
    stamp_path = os.path.join(folder, "edit3d_{}_in.key".format(uid))
    stamp = key + "|" + name
    try:
        with open(stamp_path, "r", encoding="utf-8") as fh:
            same = os.path.isfile(path) and fh.read() == stamp
    except OSError:
        same = False
    if not same:
        data = mio.glb_bytes(model, WHO) if textured else m3.write_obj(model.poly, header=WHO)
        with open(path, "wb") as fh:
            fh.write(data)
        with open(stamp_path, "w", encoding="utf-8") as fh:
            fh.write(stamp)
    return {"filename": name, "subfolder": SUBFOLDER, "type": "temp"}


def _hand_on(model, path):
    """What goes out on model_3d, and its format: the file itself when there is one (the picked model, or the
    saved edit), else the wired model written as OBJ (polygons, groups, colours) or GLB (a texture)."""
    if path:
        return _file3d(path), os.path.splitext(path)[1].lower().lstrip(".")
    faces = m3.face_summary(model.poly)
    if faces["quads"] + faces["ngons"] or model.poly.group_names or not model.images:
        return mio.file3d(m3.write_obj(model.poly, header=WHO), "obj"), "obj"
    return mio.file3d(mio.glb_bytes(model, WHO), "glb"), "glb"


class PixaromaEdit3D:
    DESCRIPTION = (
        "Opens a 3D model in a fullscreen editor where you clean it up with your own tools and with buttons that "
        "do the big jobs. Tools: Select and Deselect brushes, Lasso, Panel, Piece, Move, Sharpen edge and Fill "
        "hole. Fixes for what you select: Flatten, Smooth, Straighten, Delete. Buttons for the whole model: "
        "Remove inside surfaces, Fill small holes, Remove loose bits, Close cracks, Quads, Reduce polygons, Make "
        "solid and Mirror. Pick a model on the node, or wire one in (a mesh from the Pixal3D or Trellis 2 nodes, "
        "or a model_3d from Load 3D Pixaroma), then press Open Edit 3D. Save keeps the edit on the node and the "
        "node hands the edited model on; Save to Disk writes OBJ, GLB or STL into output/3d. When the model "
        "wired in changes, the node says so and passes the unedited model on until you edit it again."
    )

    @classmethod
    def INPUT_TYPES(cls):
        files = (list_models(_dir(folder_paths.get_input_directory))
                 + list_models(_dir(folder_paths.get_output_directory), " [output]"))
        return {
            "required": {
                "model_file": ([NONE] + files, {
                    "tooltip": "The model to edit when nothing is wired in. Models in input/3d and output/3d are "
                               "listed; the Upload button on the node adds new ones.",
                }),
            },
            "optional": {
                "mesh": ("MESH", {
                    "tooltip": "A mesh from any mesh node, for example the Pixal3D or Trellis 2 nodes. Run the "
                               "workflow once, then open the editor. When a model_3d is wired in as well, the "
                               "mesh is used.",
                }),
                "model_3d": (mio.FILE_TYPES, {
                    "tooltip": "A 3D model file, for example from Load 3D Pixaroma. GLB, GLTF, OBJ and STL can be "
                               "read. Run the workflow once, then open the editor.",
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
        "The edited model as a mesh of triangles with its colours, and its texture when it kept one. Wire it into "
        "any mesh node.",
        "The edited model as a file: the OBJ the editor saved (it keeps quads and colours), a GLB when it kept a "
        "texture, or the model as it came when there is no edit. Wire it into Save 3D Pixaroma.",
        "What was handed on, as text: the number of edits, the faces, the open and broken edges, and any note.",
    )
    FUNCTION = "run"
    # Runs with nothing downstream, so the face always has the last run to show.
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma/🖼️ Image"

    @classmethod
    def VALIDATE_INPUTS(cls, model_file):
        # Taking model_file switches off core's "value not in list" check, so a model uploaded after the page
        # loaded validates. A missing file is judged at run time, because a wired input may replace it.
        return True

    @classmethod
    def IS_CHANGED(cls, model_file=NONE, **kwargs):
        """The picked file's stamp and the saved edit's stamp. The edit keeps ONE name per node and is written
        over on every Save, so this is what re-runs the node after a Save."""
        parts = []
        path = _resolve_model(model_file)
        if path:
            parts.append(_stat_key(path))
        st = parse_state(kwargs.get(HIDDEN_INPUT))
        edited = _edited_path(st["edited"]) if st["edited"] else None
        if edited:
            parts.append(_stat_key(edited))
        return "|".join(parts)

    def run(self, model_file=NONE, mesh=None, model_3d=None, unique_id=None, **kwargs):
        state = parse_state(kwargs.get(HIDDEN_INPUT))
        started = time.perf_counter()
        uid = safe_id(unique_id)
        model, notes = mio.read_input(mesh, model_3d, WHO)
        wired = model is not None
        src_path = None if wired else _resolve_model(model_file)
        if not wired and not src_path:
            if isinstance(model_file, str) and model_file and model_file != NONE:
                raise ValueError("[Pixaroma] Edit 3D: {!r} was not found in input/3d or output/3d. Pick another "
                                 "model on the node, or wire one in.".format(model_file))
            report = {"ok": True, "skipped": True, "message": "nothing is picked or wired", "stamp": time.perf_counter()}
            blocker = mio.blocked(NOTHING)
            return {"ui": {UI_KEY: [report]}, "result": (blocker, blocker, blocker)}

        if wired:
            key = fingerprint(model.poly.vertices, model.poly.counts)
        else:
            size, sample = file_sample(src_path)
            key = file_key(os.path.basename(src_path), size, sample)

        edited_path = _edited_path(state["edited"]) if state["edited"] else None
        use_edited = bool(edited_path) and (state["sourceKey"] == key or not _KEY_CHECK)
        if use_edited:
            out = _read_file(edited_path)
            handed = edited_path
            used = "edited"
        else:
            if edited_path:
                notes.append("The model changed since it was edited ({} edit{}): open Edit 3D to redo them on the "
                             "new model. The unedited model was passed on.".format(
                                 state["editCount"], "" if state["editCount"] == 1 else "s"))
            elif state["edited"]:
                notes.append("The saved edit is missing from input/pixaroma_edit3d, so the unedited model was "
                             "passed on. Open Edit 3D and save again.")
            if wired:
                out, handed = model, None
            else:
                ext = os.path.splitext(src_path)[1].lower().lstrip(".")
                if ext not in PY_READABLE:
                    raise ValueError("[Pixaroma] Edit 3D: .{} files open in the editor but cannot be passed on as "
                                     "they are. Open Edit 3D and press Save once, which writes the model as OBJ or "
                                     "GLB.".format(ext))
                out, handed = _read_file(src_path), src_path
            used = "source"

        input_ref = _write_input_copy(model, uid, key) if wired else None
        file_out, fmt = _hand_on(out, handed)
        report = {
            "ok": True, "skipped": False, "used": used, "sourceKey": key, "input": input_ref,
            "edited": ({"filename": state["edited"], "subfolder": SUBFOLDER, "type": "input"} if use_edited else None),
            "editCount": state["editCount"] if use_edited else 0,
            "faces": m3.face_summary(out.poly), "edges": m3.edge_census(out.poly),
            "colours": out.poly.colours is not None, "texture": "texture" in out.images, "source": out.source,
            "format": fmt, "notes": notes, "seconds": round(time.perf_counter() - started, 2),
            "stamp": time.perf_counter(),
        }
        return {"ui": {UI_KEY: [report]}, "result": (mio.to_mesh(out), file_out, "\n".join(report_lines(report)))}


class PixaromaEdit3DOp:
    """One heavy button of the Edit 3D editor, queued by the editor itself as a one-node prompt through core's
    own /prompt. Never placed by hand, so it is DEV_ONLY (the node library hides it). It never raises: an
    error comes back in its ui answer, so core's error dialog does not land on top of the editor."""

    DESCRIPTION = ("Internal: runs one of the Edit 3D Pixaroma editor's heavy buttons (Quads, Make solid, Mirror, "
                   "Reduce polygons). The editor adds it by itself; it is not placed by hand.")
    DEV_ONLY = True

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}, "hidden": {OP_INPUT: ("STRING", {"default": "{}"})}}

    RETURN_TYPES = ()
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma/🖼️ Image"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # Every press is a new job. Harmless: this node is alone in its prompt, so nothing downstream re-runs.
        return float("nan")

    def run(self, **kwargs):
        from ._edit3d_ops import run_op

        started = time.perf_counter()
        try:
            name, op, params = parse_request(kwargs.get(OP_INPUT))
            src = _work_path(name)
            if src is None:
                raise ValueError("Edit 3D Pixaroma: the work file was not found in temp/pixaroma_edit3d. Press the "
                                 "button again.")
            model = _read_file(src)
            work = os.path.join(_temp_folder(), "job_{}_{}".format(os.getpid(), threading.get_ident()))
            poly, stats = run_op(op, params, model, work)
            out_name = name.rsplit(".", 1)[0] + "_out.obj"
            with open(os.path.join(_temp_folder(), out_name), "wb") as fh:
                fh.write(m3.write_obj(poly, header=WHO))
            answer = {
                "ok": True, "op": op, "params": params,
                "file": {"filename": out_name, "subfolder": SUBFOLDER, "type": "temp"},
                "stats": stats, "faces": m3.face_summary(poly), "edges": m3.edge_census(poly),
                "colours": poly.colours is not None, "seconds": round(time.perf_counter() - started, 2),
            }
        except Exception as exc:
            answer = {"ok": False, "error": str(exc) or exc.__class__.__name__,
                      "seconds": round(time.perf_counter() - started, 2)}
        return {"ui": {OP_UI_KEY: [answer]}}


NODE_CLASS_MAPPINGS = {CLASS: PixaromaEdit3D, OP_CLASS: PixaromaEdit3DOp}
NODE_DISPLAY_NAME_MAPPINGS = {CLASS: "Edit 3D Pixaroma", OP_CLASS: "Edit 3D Pixaroma (editor job)"}
