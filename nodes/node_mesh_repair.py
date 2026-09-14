"""Mesh Repair Pixaroma - turn a broken 3D model into one clean, closed solid.

Built for what Pixal3D and Trellis 2 actually produce (measured 2026-09-14): a
HOLLOW DOUBLE SKIN two grid cells thick, broken edges where the skins touch,
loose bits and a few small holes. A slicer reads that as a paper-thin shell.

Two modes, chosen on the node face:
* Make solid rebuilds the model as a solid (_mesh_repair_solid.py), then brings
  the triangle count back down with core's own Decimate Mesh when asked.
* Tidy only keeps the triangles and textures and just cleans them
  (_mesh_repair_tidy.py). It cannot fill a hollow model, and the face says so.

Inputs: the core MESH wire, or a model file (Load 3D Pixaroma's model_3d), which
is read by core's own Get 3D Components so every format core reads works here.

Outputs: the repaired MESH; the same model as an STL file, because core writes a
MESH only as GLB and a slicer wants STL (_mesh_repair_export.py); the report.

Frontend-driven (Vue Compat #9): the settings live on node.properties in the
browser and arrive in the hidden MeshRepairState input. The report goes back to
the face in ui.pixaroma_mesh_repair, stamped, because a cached node replays its
executed event and the face must not claim a fresh repair (free-vram.md #5).

Pure helpers + harness: _mesh_repair_*.py, D:\\Claude Tests\\_mesh_repair_test.py.
"""
from __future__ import annotations

import os
import re
import time
from io import BytesIO

import numpy as np
import torch
from PIL import Image

import folder_paths

from ._mesh_repair_census import census, crop_pair, cut_mask, pick_cut_axes, solid_share
from ._mesh_repair_export import stl_bytes
from ._mesh_repair_helpers import parse_state, print_size_mm, report_text, triangle_target
from ._mesh_repair_solid import solid_rebuild
from ._mesh_repair_tidy import tidy

CLASS = "PixaromaMeshRepair"
HIDDEN_INPUT = "MeshRepairState"
UI_KEY = "pixaroma_mesh_repair"
PREVIEW_SUBFOLDER = "pixaroma_mesh_repair"
# Load 3D Pixaroma sends FILE_3D; core's own 3D nodes send the per-format types.
FILE_TYPES = "FILE_3D,FILE_3D_GLB,FILE_3D_GLTF,FILE_3D_OBJ,FILE_3D_STL"
# Core's decimation is not the same twice on the GPU, so a result that comes back
# open gets this many tries in all before the full-detail model is kept.
DECIMATE_TRIES = 2

NOTHING_WIRED = (
    "Mesh Repair Pixaroma has nothing to repair. Wire a mesh from the Pixal3D or Trellis 2 "
    "nodes, or a model_3d from Load 3D Pixaroma, into it."
)


def _blocked(message):
    """ComfyUI's own "this output cannot be used" marker, or None on an old build."""
    try:
        from comfy_execution.graph_utils import ExecutionBlocker
    except Exception:
        return None
    return ExecutionBlocker(message)


def _check_cancel():
    import comfy.model_management as mm
    mm.throw_exception_if_processing_interrupted()


def _mesh_from_file(model_3d):
    """A 3D model file -> core's MESH, parsed by core's own Get 3D Components.

    Only a File3D object is accepted. A bare path string would be a string turned
    into a file read, which this node has no reason to do (path-containment.md).
    """
    if not hasattr(model_3d, "get_bytes"):
        raise ValueError(
            "Mesh Repair Pixaroma: model_3d has to come from a 3D node such as Load 3D Pixaroma.")
    try:
        from comfy_extras.nodes_mesh_io import Get3DComponents
    except Exception:
        raise ValueError(
            "Mesh Repair Pixaroma: this ComfyUI cannot read 3D files yet (it has no Get 3D "
            "Components node). Update ComfyUI, or wire a mesh in instead.")
    out = Get3DComponents.execute(model_3d)
    result = getattr(out, "result", None) or getattr(out, "args", None)
    if not result:
        raise ValueError("Mesh Repair Pixaroma: the model file could not be read.")
    return result[0]


def _float_np(t):
    if t is None:
        return None
    if torch.is_tensor(t):
        return t.detach().to("cpu").float().numpy()
    return np.asarray(t, np.float32)


def _int_np(t):
    if torch.is_tensor(t):
        return t.detach().to("cpu").long().numpy()
    return np.asarray(t, np.int64)


def _texture_np(t):
    arr = _float_np(t)
    if arr is None:
        return None
    if arr.size and float(arr.max()) > 1.5:
        arr = arr / 255.0
    return arr


def _pick(value, i):
    if value is None:
        return None
    if isinstance(value, (list, tuple)):
        return value[i] if i < len(value) else None
    return value


def _items(mesh):
    """Split a MESH into per-item numpy dicts, cutting a padded batch to its real
    lengths (the same slicing core's get_mesh_batch_item does)."""
    verts = mesh.vertices
    colours = getattr(mesh, "vertex_colors", None)
    uvs = getattr(mesh, "uvs", None)
    texture = getattr(mesh, "texture", None)
    items = []
    if isinstance(verts, (list, tuple)):
        for i in range(len(verts)):
            items.append((verts[i], mesh.faces[i], _pick(colours, i), _pick(uvs, i)))
    elif verts.ndim == 2:
        items.append((verts, mesh.faces, colours, uvs))
    else:
        counts_v = getattr(mesh, "vertex_counts", None)
        counts_f = getattr(mesh, "face_counts", None)
        for i in range(int(verts.shape[0])):
            if counts_v is not None and counts_f is not None:
                nv, nf = int(counts_v[i]), int(counts_f[i])
            else:
                nv, nf = int(verts.shape[1]), int(mesh.faces.shape[1])
            items.append((
                verts[i, :nv], mesh.faces[i, :nf],
                colours[i, :nv] if torch.is_tensor(colours) and colours.ndim == 3 else None,
                uvs[i, :nv] if torch.is_tensor(uvs) and uvs.ndim == 3 else None,
            ))
    out = []
    for i, (v, f, c, uv) in enumerate(items):
        tex = None
        if torch.is_tensor(texture):
            tex = texture[min(i, texture.shape[0] - 1)] if texture.ndim == 4 else texture
        out.append({
            "V": _float_np(v).astype(np.float64).reshape(-1, 3),
            "F": _int_np(f).reshape(-1, 3),
            "colours": _float_np(c),
            "uvs": _float_np(uv),
            "texture": _texture_np(tex),
        })
    return out


def _decimate(v, f, c, target):
    """Core's own QEM decimation (the Decimate Mesh node). None when core lacks it.

    Core's post-clean drops sliver triangles after collapsing (under 0.5 degrees
    or longer than 100:1), and on a closed solid that leaves broken edges behind:
    on the rebuilt radio 2 of 3 runs with core's settings came back with 1 to 3
    broken edges, and every run with the sliver drop off came back closed
    (measured 2026-09-14). A sliver is harmless to a slicer; a broken edge is not.
    """
    try:
        import dataclasses

        import comfy.model_management as mm
        from comfy_extras.mesh3d.postprocess.qem_decimate import QEMConfig, qem_decimate_simplify
    except Exception:
        return None
    config = QEMConfig()
    if dataclasses.is_dataclass(config):
        names = {field.name for field in dataclasses.fields(config)}
        keep_slivers = (("postclean_min_angle_deg", 0.0), ("postclean_max_aspect_ratio", 1e12))
        config = dataclasses.replace(config, **{key: value for key, value in keep_slivers if key in names})
    vt = torch.from_numpy(np.ascontiguousarray(v, np.float32))
    ft = torch.from_numpy(np.ascontiguousarray(f, np.int64))
    ct = torch.from_numpy(np.ascontiguousarray(c, np.float32)) if c is not None else None

    def run(device):
        rv, rf, rc, _normals, _src = qem_decimate_simplify(
            vt.to(device), ft.to(device), int(target),
            colors=ct.to(device) if ct is not None else None, config=config)
        return (rv.detach().to("cpu").float().numpy(), rf.detach().to("cpu").long().numpy(),
                rc.detach().to("cpu").float().numpy() if rc is not None else None)

    try:
        return run(mm.get_torch_device())
    except Exception as exc:
        raise_non_oom = getattr(mm, "raise_non_oom", None)
        if raise_non_oom is not None:
            raise_non_oom(exc)
        return run(torch.device("cpu"))


def _make_mesh(outs, template, keep_textures):
    from comfy_api.latest import Types

    extra = {}
    if keep_textures:
        for key in ("texture", "metallic_roughness", "normal_map", "emissive", "material"):
            value = getattr(template, key, None)
            if value is not None:
                extra[key] = value
        extra["occlusion_in_mr"] = bool(getattr(template, "occlusion_in_mr", False))
    extra["unlit"] = bool(getattr(template, "unlit", False))

    if len(outs) == 1:
        o = outs[0]
        kw = {
            "vertices": torch.from_numpy(np.ascontiguousarray(o["V"], np.float32))[None],
            "faces": torch.from_numpy(np.ascontiguousarray(o["F"], np.int64))[None],
        }
        if o.get("colours") is not None:
            kw["vertex_colors"] = torch.from_numpy(np.ascontiguousarray(o["colours"], np.float32))[None]
        if keep_textures and o.get("uvs") is not None:
            kw["uvs"] = torch.from_numpy(np.ascontiguousarray(o["uvs"], np.float32))[None]
        return Types.MESH(**kw, **extra)

    from comfy_extras.nodes_save_3d import pack_variable_mesh_batch
    verts = [torch.from_numpy(np.ascontiguousarray(o["V"], np.float32)) for o in outs]
    faces = [torch.from_numpy(np.ascontiguousarray(o["F"], np.int64)) for o in outs]
    colours = None
    if all(o.get("colours") is not None for o in outs):
        colours = [torch.from_numpy(np.ascontiguousarray(o["colours"], np.float32)) for o in outs]
    uvs = None
    if keep_textures and all(o.get("uvs") is not None for o in outs):
        uvs = [torch.from_numpy(np.ascontiguousarray(o["uvs"], np.float32)) for o in outs]
    return pack_variable_mesh_batch(verts, faces, colours, uvs=uvs, **extra)


def _stl_file(out, state):
    """The repaired model as an in-memory STL. Save 3D Model writes a File3D in
    the file's own format, so wiring this into it gives a .stl."""
    from comfy_api.latest import Types

    return Types.File3D(BytesIO(stl_bytes(out["V"], out["F"], print_size_mm(state))), file_format="stl")


def _safe_id(uid):
    return re.sub(r"[^A-Za-z0-9_-]", "_", str(uid if uid is not None else "node"))[:40] or "node"


def _save_cut(mask, uid, side):
    """The cut as a white-on-transparent PNG. The face paints it through a CSS
    mask in the node's accent colour, so it recolours with the node."""
    folder = os.path.join(folder_paths.get_temp_directory(), PREVIEW_SUBFOLDER)
    os.makedirs(folder, exist_ok=True)
    name = "mesh_repair_{}_{}.png".format(_safe_id(uid), side)
    rgba = np.zeros(mask.shape + (4,), np.uint8)
    rgba[..., :3] = 255
    rgba[..., 3] = mask
    Image.fromarray(rgba, "RGBA").save(os.path.join(folder, name), compress_level=4)
    return {"filename": name, "subfolder": PREVIEW_SUBFOLDER, "type": "temp"}


class PixaromaMeshRepair:
    DESCRIPTION = (
        "Repairs a 3D model so it comes out as one clean, closed solid, ready for 3D printing or "
        "for the mesh nodes that follow. Models from Pixal3D and Trellis 2 come out as a hollow "
        "double skin with broken edges, loose bits and small holes, so a slicer sees a paper-thin "
        "shell. Make solid rebuilds the model as a real solid: it seals small gaps, fills the "
        "inside, builds a new closed surface and snaps it back onto the original shape, so the "
        "detail and the colours stay. Tidy only keeps the original triangles and textures and just "
        "removes loose bits, turns wrong-way faces around and closes small holes, which cannot fill "
        "a hollow model. Wire in a mesh from the Pixal3D or Trellis 2 nodes, or a model_3d from "
        "Load 3D Pixaroma. To print it, wire the stl output into Save 3D Model: it writes a .stl "
        "that stands upright with its longest side 100 mm, which the gear can change. After a run "
        "the node shows a cut through the middle of the model before and after, and a list of what "
        "it fixed. In the Pixal3D workflows, put it right after the step that rebuilds the mesh and "
        "before the step that reduces the triangles."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "mesh": ("MESH", {
                    "tooltip": "A mesh from the Pixal3D or Trellis 2 nodes, or any other mesh node. In "
                               "those workflows the best place is right after Rebuild the mesh cleanly "
                               "and before Reduce to N triangles.",
                }),
                "model_3d": (FILE_TYPES, {
                    "tooltip": "A 3D model file, for example from Load 3D Pixaroma. GLB, GLTF, OBJ and STL "
                               "can be read. When a mesh is wired in as well, the mesh is used.",
                }),
            },
            # Hidden, not required: a required STRING shows as a widget AND a
            # convertible input dot in the Vue frontend (Vue Compat #9).
            "hidden": {
                HIDDEN_INPUT: ("STRING", {"default": "{}"}),
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("MESH", "FILE_3D_STL", "STRING")
    RETURN_NAMES = ("mesh", "stl", "report")
    OUTPUT_TOOLTIPS = (
        "The repaired model as a mesh, with its colours. Save it with Save 3D Model (a .glb you can "
        "open again), or pass it on to Decimate Mesh, UV unwrap or Paint Mesh.",
        "The repaired model as an STL file for a 3D printer's slicer. Wire it into Save 3D Model to "
        "write a .stl into output/3d. It stands upright the way slicers expect and its longest side "
        "is 100 mm, which the gear can change. STL keeps no colours. If Save 3D Model's preview looks "
        "empty, press its Fit to Viewer button; the model lies on its back there but stands up in a slicer.",
        "What was wrong and what was fixed, in words: holes, broken edges, loose bits, how solid the "
        "inside is, and the triangle count before and after.",
    )
    FUNCTION = "repair"
    # Runs with nothing downstream, so dropping it after a generator is enough to
    # see the report. Safe: with nothing wired in it does nothing at all.
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma/🖼️ Image"

    def repair(self, mesh=None, model_3d=None, unique_id=None, **kwargs):
        import comfy.utils

        state = parse_state(kwargs.get(HIDDEN_INPUT))
        started = time.perf_counter()

        if mesh is None and model_3d is None:
            report = {"ok": True, "skipped": True, "unwired": True, "mode": state["mode"],
                      "message": "nothing is wired in", "stamp": time.perf_counter()}
            return {"ui": {UI_KEY: [report]},
                    "result": (_blocked(NOTHING_WIRED), _blocked(NOTHING_WIRED), report_text(report))}

        notes = []
        if mesh is not None and model_3d is not None:
            notes.append("Both inputs were wired: the mesh wire was used and model_3d was ignored.")
        source = mesh if mesh is not None else _mesh_from_file(model_3d)
        items = _items(source)
        if not items:
            raise ValueError("Mesh Repair Pixaroma: the mesh is empty.")

        solid = state["mode"] == "solid"
        total = 100 * len(items)
        bar = comfy.utils.ProgressBar(total)
        outs, befores, afters = [], [], []
        seal_info = None
        cut = None

        for i, item in enumerate(items):
            V, F = item["V"], item["F"]
            if len(F) == 0 or len(V) == 0:
                raise ValueError("Mesh Repair Pixaroma: model {} has no triangles.".format(i + 1))
            _check_cancel()
            before = census(V, F)
            after = None

            if solid:
                colours = item["colours"] if state["keepColours"] else None
                use_texture = state["keepColours"] and colours is None
                result = solid_rebuild(
                    V, F, detail=state["detail"], seal=state["seal"], loose=state["loose"],
                    keep_detail=state["keepDetail"], colours=colours,
                    uvs=item["uvs"] if use_texture else None,
                    texture=item["texture"] if use_texture else None,
                    check_cancel=_check_cancel,
                    progress=lambda fraction, _name, i=i: bar.update_absolute(int(100 * (i + fraction)), total),
                )
                ov, of, oc = result["vertices"], result["faces"], result["colours"]
                target = triangle_target(state, len(F))
                if target is not None and len(of) > target:
                    reduced, missing = None, False
                    for _try in range(DECIMATE_TRIES):
                        _check_cancel()
                        attempt = _decimate(ov, of, oc, target)
                        if attempt is None:
                            missing = True
                            break
                        check = census(attempt[0], attempt[1])
                        if check["watertight"]:
                            reduced, after = attempt, check
                            break
                    if missing:
                        notes.append("This ComfyUI has no Decimate Mesh, so the triangle count was not reduced.")
                    elif reduced is None:
                        notes.append("Reducing the triangles opened the model, so the full-detail result was kept.")
                    else:
                        ov, of = reduced[0], reduced[1]
                        oc = reduced[2] if oc is not None else None
                out = {"V": ov, "F": of, "colours": oc, "uvs": None}
                if seal_info is None:
                    seal_info = result
            else:
                result = tidy(V, F, loose=state["loose"],
                              colours=item["colours"] if state["keepColours"] else None, uvs=item["uvs"])
                out = {"V": result["vertices"], "F": result["faces"], "colours": result["colours"], "uvs": result["uvs"]}
                if i == 0 and result["holesFilled"]:
                    notes.append("Closed {} small hole{}.".format(result["holesFilled"], "" if result["holesFilled"] == 1 else "s"))

            if after is None:
                after = census(out["V"], out["F"])
            if i == 0:
                lo, hi = V.min(0), V.max(0)
                axes = pick_cut_axes(lo, hi)
                mask_before = cut_mask(V, F, lo, hi, axes)
                mask_after = cut_mask(out["V"], out["F"], lo, hi, axes)
                inside = {"before": solid_share(mask_before), "after": solid_share(mask_after)}
                shown_before, shown_after = crop_pair(mask_before, mask_after)
                cut = {
                    "before": _save_cut(shown_before, unique_id, "before"),
                    "after": _save_cut(shown_after, unique_id, "after"),
                    "inside": inside,
                }
            outs.append(out)
            befores.append(before)
            afters.append(after)
            bar.update_absolute(100 * (i + 1), total)

        if len(items) > 1:
            notes.append("{} models were repaired; the numbers and the stl file are for the first.".format(len(items)))
        if not solid and not afters[0]["watertight"]:
            notes.append("Still not closed: Tidy only cannot fill a hollow model. Use Make solid for printing.")

        report = {
            "ok": True, "skipped": False, "mode": state["mode"], "detail": state["detail"],
            "before": befores[0], "after": afters[0], "items": len(items),
            "inside": cut["inside"] if cut else None,
            "cut": {"before": cut["before"], "after": cut["after"]} if cut else None,
            "sealPercent": round(seal_info["seal_percent"], 2) if seal_info else None,
            "sealAuto": bool(seal_info["seal_auto"]) if seal_info else None,
            "printSize": state["printSize"],
            "seconds": round(time.perf_counter() - started, 2),
            "notes": notes,
            "stamp": time.perf_counter(),
        }
        result_mesh = _make_mesh(outs, source, keep_textures=not solid)
        return {"ui": {UI_KEY: [report]},
                "result": (result_mesh, _stl_file(outs[0], state), report_text(report))}


NODE_CLASS_MAPPINGS = {CLASS: PixaromaMeshRepair}
NODE_DISPLAY_NAME_MAPPINGS = {CLASS: "Mesh Repair Pixaroma"}
