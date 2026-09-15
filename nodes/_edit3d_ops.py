"""Edit 3D Pixaroma - the editor's four heavy buttons: Quads, Make solid, Mirror and Reduce polygons.

They run in Python because they need what the browser does not have: the Instant Meshes engine, the solid
rebuild and ComfyUI's own decimation. The editor queues them as a hidden one-node job (PixaromaEdit3DOp in
node_edit_3d.py) on a work file it uploaded to temp/pixaroma_edit3d.

Every result is a PolyMesh with vertex colours. A texture is baked into colours first, because each button
builds new faces that the old texture coordinates do not fit.

numpy + scipy and the pack's own mesh modules; torch and ComfyUI only inside `decimate`.
Harness: D:\\Claude Tests\\_edit3d_test.py (section B).
"""
from __future__ import annotations

import numpy as np
from scipy.spatial import cKDTree

from . import _mesh3d as m3
from . import _quadremesh as qr
from ._mesh_repair_solid import solid_rebuild

# Core's decimation is not the same twice on the GPU, so a solid that comes back open gets a second try before
# the full-detail rebuild is kept (mesh-repair.md #2, step 7).
DECIMATE_TRIES = 2
# Only for a harness mutation: the kept half must be turned inside out back when the - side is mirrored.
_REVERSE_NEGATIVE = True


def check_cancel():
    """Stops a job between steps when ComfyUI is interrupted (outside ComfyUI there is nothing to ask)."""
    try:
        import comfy.model_management as mm
    except Exception:
        return
    mm.throw_exception_if_processing_interrupted()


def texture_array(model):
    """The model's base colour texture as an (H, W, 3) float array in 0..1, or None."""
    images = getattr(model, "images", None) or {}
    tex = images.get("texture")
    if tex is None:
        return None
    try:
        arr = tex[0].detach().to("cpu").float().numpy()
    except AttributeError:
        arr = np.asarray(tex, np.float32)
        if arr.ndim == 4:
            arr = arr[0]
    if arr.size and float(arr.max()) > 1.5:
        arr = arr / 255.0
    return arr


def sample_texture(uv, texture):
    """Bilinear samples of `texture` at `uv`, turned from sRGB to linear with a 2.2 power. The same sampling as
    _mesh_repair_solid.transfer_colours, so a baked colour matches what Make solid and Quads bake."""
    img = np.asarray(texture, np.float32)
    if img.ndim == 2:
        img = img[..., None]
    H, W = img.shape[:2]
    uv = np.asarray(uv, np.float64).reshape(-1, 2)
    x = np.clip(uv[:, 0], 0.0, 1.0) * (W - 1)
    y = np.clip(uv[:, 1], 0.0, 1.0) * (H - 1)
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    x1 = np.minimum(x0 + 1, W - 1)
    y1 = np.minimum(y0 + 1, H - 1)
    fx = (x - x0)[:, None]
    fy = (y - y0)[:, None]
    top = img[y0, x0] * (1 - fx) + img[y0, x1] * fx
    bottom = img[y1, x0] * (1 - fx) + img[y1, x1] * fx
    rgb = top * (1 - fy) + bottom * fy
    rgb = rgb[:, :3] if rgb.shape[1] >= 3 else np.repeat(rgb[:, :1], 3, axis=1)
    return np.power(np.clip(rgb, 0.0, 1.0), 2.2).astype(np.float32)


def vertex_colours(model):
    """Linear colours per vertex: the model's own, or its texture sampled at each vertex's uv, or None."""
    poly = model.poly
    if poly.colours is not None:
        return np.asarray(poly.colours, np.float32)[:, :3]
    tex = texture_array(model)
    uvs = getattr(model, "uvs", None)
    if tex is None or uvs is None or len(uvs) != len(poly.vertices):
        return None
    return sample_texture(uvs, tex)


def welded(poly, colours):
    """One point per place (numbered by first appearance), a corner repeated inside a polygon kept once,
    polygons left with under three corners and points no polygon uses dropped. A GLB splits points along its
    texture seams, and a seam left split reads as an open border to the decimation and the mirror.
    -> (PolyMesh, colours or None)"""
    V = np.asarray(poly.vertices, np.float64).reshape(-1, 3)
    if not len(V):
        return poly, colours
    ids, count = m3.weld_ids(V)
    _u, first = np.unique(ids, return_index=True)
    rank = np.empty(count, np.int64)
    rank[np.argsort(first, kind="stable")] = np.arange(count)
    ids = rank[ids]
    order = np.sort(first)
    merged = m3.PolyMesh(vertices=V[order], counts=np.asarray(poly.counts, np.int32),
                         indices=ids[np.asarray(poly.indices, np.int64)])
    merged, _changed, _dropped = qr.clean_faces(merged)
    C = None if colours is None else np.asarray(colours, np.float32)[order]
    idx = np.asarray(merged.indices, np.int64)
    used = np.unique(idx)
    remap = np.full(len(merged.vertices), -1, np.int64)
    remap[used] = np.arange(len(used))
    out = m3.PolyMesh(vertices=np.asarray(merged.vertices)[used], counts=np.asarray(merged.counts, np.int32),
                      indices=remap[idx])
    return out, (None if C is None else C[used])


def _triangles(poly):
    V, F, _c = m3.triangulate(poly)
    return np.asarray(V, np.float64), np.asarray(F, np.int64).reshape(-1, 3)


def decimate(V, F, C, target):
    """Core's own QEM decimation (the Decimate Mesh node) -> (V, F, C) or None when this ComfyUI lacks it.

    The sliver drop is switched OFF: with core's settings a closed solid came back with broken edges in 2 of
    3 runs, and 13 of 13 closed with it off (mesh-repair.md #2, step 7). A copy of Mesh Repair's helper, so
    this module does not import a node file.
    """
    try:
        import dataclasses

        import torch
        import comfy.model_management as mm
        from comfy_extras.mesh3d.postprocess.qem_decimate import QEMConfig, qem_decimate_simplify
    except Exception:
        return None
    config = QEMConfig()
    if dataclasses.is_dataclass(config):
        names = {f.name for f in dataclasses.fields(config)}
        keep_slivers = (("postclean_min_angle_deg", 0.0), ("postclean_max_aspect_ratio", 1e12))
        config = dataclasses.replace(config, **{key: value for key, value in keep_slivers if key in names})
    vt = torch.from_numpy(np.ascontiguousarray(V, np.float32))
    ft = torch.from_numpy(np.ascontiguousarray(F, np.int64))
    ct = torch.from_numpy(np.ascontiguousarray(C, np.float32)) if C is not None else None

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


def op_quads(model, params, work_dir):
    """Clean quads over the model with the Instant Meshes engine (quad-remesh.md): crisp edges followed, the
    holes the quads leave closed, a true mirror when Auto finds one. The colours (or the texture) carry over."""
    out = qr.quad_remesh(
        model.poly,
        {"quads": int(params["quads"]), "symmetry": params["symmetry"], "crisp": True,
         "keepColours": True, "keepGroups": False},
        work_dir, check_cancel, uvs=getattr(model, "uvs", None), texture=texture_array(model))
    stats = out["stats"]
    keep = ("quads", "triangles", "faces", "quads_pct", "mean_mm", "p95_mm", "symmetry_axis", "holes_filled",
            "fragment_faces_dropped")
    return out["poly"], {k: stats[k] for k in keep if k in stats}


def op_solid(model, params):
    """Rebuild the model as one closed solid (mesh-repair.md #2), then bring it back down to the triangle count
    it came with. The full-detail rebuild is kept when decimation would open it."""
    colours = vertex_colours(model)
    poly, colours = welded(model.poly, colours)
    V, F = _triangles(poly)
    if not len(F):
        raise ValueError("Edit 3D Pixaroma: the model has no faces to rebuild.")
    result = solid_rebuild(V, F, detail=int(params["detail"]), seal="auto", loose=1.0, keep_detail=True,
                           colours=colours, check_cancel=check_cancel)
    ov = np.asarray(result["vertices"], np.float64)
    of = np.asarray(result["faces"], np.int64)
    oc = result["colours"]
    stats = {"detail": int(params["detail"]), "seal_percent": round(float(result["seal_percent"]), 2),
             "full_triangles": int(len(of)), "reduced": False}
    target = int(len(F))
    if len(of) > target:
        for _try in range(DECIMATE_TRIES):
            check_cancel()
            got = decimate(ov, of, oc, target)
            if got is None:
                stats["note"] = "This ComfyUI has no Decimate Mesh, so the solid keeps every triangle of the rebuild."
                break
            census = m3.edge_census(m3.from_triangles(got[0], got[1]))
            if census["open"] == 0 and census["broken"] == 0:
                ov, of = np.asarray(got[0], np.float64), np.asarray(got[1], np.int64)
                oc = got[2] if oc is not None else None
                stats["reduced"] = True
                break
        else:
            stats["note"] = "Bringing the triangles back down opened the solid, so the full-detail rebuild was kept."
    return m3.from_triangles(ov, of, oc), stats


def op_mirror(model, params):
    """Keep one side of the model and mirror it onto the other (quad-remesh.md #3: clip exactly at the plane,
    mirror with the corner order reversed, weld the points on the plane). The plane is searched along the axis
    the user picked; a model with no mirror anywhere uses the middle of its box."""
    colours = vertex_colours(model)
    poly, colours = welded(model.poly, colours)
    V = np.asarray(poly.vertices, np.float64)
    counts = np.asarray(poly.counts, np.int64)
    idx = np.asarray(poly.indices, np.int64)
    finite = np.isfinite(V).all(1)
    if not len(counts) or not finite.any():
        raise ValueError("Edit 3D Pixaroma: the model has no faces to mirror.")
    ax = "xyz".index(params["axis"])
    lo, hi = V[finite].min(0), V[finite].max(0)
    diag = float(np.linalg.norm(hi - lo)) or 1.0
    _v, F = _triangles(poly)
    try:
        found = qr.find_mirror(V, F, params["axis"])
    except Exception:
        found = None
    plane = float(found[1]) if found is not None else float((lo[ax] + hi[ax]) / 2.0)
    if params["side"] == "negative":
        # Reflect the model so the - side becomes the + side the clip keeps. A reflection turns every face
        # inside out, so each polygon's corner order is reversed to face outward again.
        V = qr.reflect(V, ax, plane)
        if _REVERSE_NEGATIVE:
            _c, starts, face_of = qr.face_layout(counts)
            local = np.arange(len(idx)) - starts[face_of]
            idx = idx[starts[face_of] + (counts[face_of] - 1 - local)]
    E, _cnt = qr.unique_edges(counts, idx)
    edge = float(np.linalg.norm(V[E[:, 0]] - V[E[:, 1]], axis=1).mean()) if len(E) else 0.0
    eps = 1e-7 * diag
    cV, cC, cI, cut = qr.clip_polygons(V, counts, idx, ax, plane, eps, qr.SEAM_SNAP * edge)
    if not len(cC):
        raise ValueError("Edit 3D Pixaroma: nothing of the model lies on that side of the mirror, so there is "
                         "nothing to copy. Try the other side.")
    on = np.abs(cV[:, ax] - plane) <= eps
    out, seam_open, seam = qr.mirror_join(cV, cC, cI, on, ax, plane, diag)
    new_colours = None
    if colours is not None:
        P = np.asarray(out.vertices, np.float64).copy()
        P[:, ax] = plane + np.abs(P[:, ax] - plane)
        src = np.nonzero((V[:, ax] >= plane - eps) & np.isfinite(V).all(1))[0]
        if len(src):
            _d, j = cKDTree(V[src]).query(P)
            new_colours = np.asarray(colours, np.float32)[src[j]]
    result = m3.PolyMesh(vertices=np.asarray(out.vertices, np.float64), counts=np.asarray(out.counts, np.int32),
                         indices=np.asarray(out.indices, np.int64), colours=new_colours)
    return result, {"axis": params["axis"], "side": params["side"], "plane": round(plane, 6),
                    "found": found is not None, "cut": int(cut), "seam_points": int(seam),
                    "seam_open": int(seam_open)}


def op_reduce(model, params):
    """Fewer triangles with ComfyUI's own decimation. A quad model comes back as triangles."""
    colours = vertex_colours(model)
    poly, colours = welded(model.poly, colours)
    V, F = _triangles(poly)
    if len(F) < 8:
        raise ValueError("Edit 3D Pixaroma: the model has too few faces to reduce.")
    percent = int(params["percent"])
    target = max(4, int(round(len(F) * (100 - percent) / 100.0)))
    got = decimate(V, F, colours, target)
    if got is None:
        raise ValueError("Edit 3D Pixaroma: this ComfyUI has no Decimate Mesh yet, so Reduce polygons cannot run. "
                         "Update ComfyUI.")
    out = m3.from_triangles(got[0], got[1], got[2] if colours is not None else None)
    return out, {"percent": percent, "triangles_before": int(len(F)), "triangles_after": int(len(got[1]))}


def _plain(value):
    """numpy scalars -> Python numbers, so the job's answer is plain JSON."""
    if isinstance(value, dict):
        return {str(k): _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    if isinstance(value, np.bool_):
        return bool(value)
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        return float(value)
    return value


def run_op(op, params, model, work_dir):
    """One heavy button on a Model3D -> (PolyMesh, stats)."""
    if op == "quads":
        poly, stats = op_quads(model, params, work_dir)
    elif op == "solid":
        poly, stats = op_solid(model, params)
    elif op == "mirror":
        poly, stats = op_mirror(model, params)
    elif op == "reduce":
        poly, stats = op_reduce(model, params)
    else:
        raise ValueError("Edit 3D Pixaroma: unknown operation {!r}.".format(op))
    if not len(poly.counts):
        raise ValueError("Edit 3D Pixaroma: nothing was left of the model after that button.")
    return poly, _plain(stats)
