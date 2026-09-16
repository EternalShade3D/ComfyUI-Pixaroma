import os
import uuid
from collections import deque

import folder_paths
import numpy as np
from PIL import Image

# _json_safe: strip NaN/Inf (PROMPT's is_changed:[NaN]) so the ui payload sent
# over the websocket is valid JSON - else the frontend JSON.parse drops the
# whole executed message (preview frames + save metadata both lost).
from ._save_helpers import (
    _build_pnginfo,
    _json_safe,
    _metadata_disabled,
    _safe_prefix,
)


def _tensor_to_pil(tensor):
    """Convert a HxWxC float [0,1] tensor frame to a PIL.Image."""
    arr = (tensor.cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
    return Image.fromarray(arr)


# Preview mode caching (2026-09-16). IS_CHANGED used to return NaN in both modes,
# and because a node's cache signature includes every ancestor's IS_CHANGED, that
# made EVERYTHING wired after an inline preview re-run on every Run (measured on
# the Ep34 multi-view 3D workflow: changing only the triangle count rebuilt the
# whole model). The NaN was there so a preview whose file was deleted comes back
# instead of pointing at a missing file. Preview mode now answers "unchanged"
# while every temp file this node wrote still exists, and moves to a new answer
# only when one has gone missing, so a cached Run shows the same frames (ComfyUI
# re-sends a cached node's ui) and a missing file still forces a re-save.
# Save mode keeps NaN: "every Run writes a file" is deliberate
# (.claude/patterns/preview-image.md, the NaN section).
_PREVIEW_RUNS = {}       # node id -> deque of tuples: the temp paths each run wrote
_PREVIEW_GENERATION = {}  # node id -> bumped whenever a written file is found missing
_PREVIEW_RUNS_KEPT = 32


def _preview_mode_token(unique_id):
    key = str(unique_id)
    runs = _PREVIEW_RUNS.get(key, ())
    if any(not os.path.exists(path) for run in runs for path in run):
        _PREVIEW_GENERATION[key] = _PREVIEW_GENERATION.get(key, 0) + 1
    return "pixaroma-preview-{}".format(_PREVIEW_GENERATION.get(key, 0))


def _remember_preview_run(unique_id, paths):
    key = str(unique_id)
    runs = _PREVIEW_RUNS.setdefault(key, deque(maxlen=_PREVIEW_RUNS_KEPT))
    # Forget runs whose files are gone (the Run that re-saves them is this one),
    # or one deleted file would keep every later Run from caching.
    kept = [run for run in runs if all(os.path.exists(path) for path in run)]
    runs.clear()
    runs.extend(kept)
    runs.append(tuple(paths))


class PixaromaPreview:
    """Preview an image (or batch) inline in the node body, with buttons for
    Save-to-Disk and Save-to-Output. The image is also exposed on the output
    edge.

    Modes:
      preview (default): all batch frames are written to ComfyUI's temp/
        directory and shown in the node strip; nothing is saved permanently.
        The temp PNGs embed the workflow (like native PreviewImage), so a
        preview can be dragged back onto the canvas to restore the workflow.
      save:              all batch frames are saved to output/ with embedded
        workflow metadata, exactly like the native SaveImage node, AND still
        shown in the strip preview.
    """

    DESCRIPTION = (
        "Preview Image Pixaroma - inline image preview with Save Disk, Save Output, Copy, and Open buttons, "
        "batch-aware. Wire any IMAGE source into the input. All batch frames render in the node body; click any "
        "thumbnail to expand it inline. Arrow keys flip through the batch, click anywhere on the open image to "
        "advance, Esc or X collapses. Toggle Grid / Strip layout via the small icon in the top-right corner of "
        "the preview area.\n\n"
        "Save Disk picks any folder on your computer; the suggested filename auto-increments per click. Save "
        "Output writes to ComfyUI's output/ folder. Copy puts the selected frame on your OS clipboard as PNG so "
        "you can paste straight into another node, paint app, message, etc. Open opens the selected frame in a "
        "new browser tab for full-screen viewing or comparing multiple side by side. All four buttons act on the "
        "currently selected frame; Save Disk and Save Output embed the workflow into the PNG so you can drag it "
        "back into ComfyUI later.\n\n"
        "Flip save_mode to 'save' and the node becomes a drop-in replacement for SaveImage: every batch frame is "
        "automatically written to output/ on each Run with embedded workflow metadata. The preview also survives "
        "workflow tab switching, so you can leave it on a specific frame and come back to it.\n\n"
        "The filename_prefix field supports subfolder syntax with '/' (e.g. 'SDXL/portrait'), date tokens "
        "(e.g. '%date:yyyy-MM-dd%/img' -> 'output/2026-05-10/img_00001_.png'), and native "
        "ComfyUI tokens (%year%, %month%, %day%, %hour%, %minute%, %second%, %width%, %height%). Date format codes "
        "are yyyy yy MM dd HH mm ss. It also supports node-reference tokens like %Seed Pixaroma.seed% (or "
        "%KSampler.seed%) that insert another node's field value into the name, just like the native Save Image "
        "node. See the project README for the full token reference.\n\n"
        "Right-click the node for Preview Image settings. Add Civitai generation info there also writes the "
        "settings in the format Civitai reads, so an image posted there shows the checkpoint, the LoRAs and "
        "their strengths, plus steps, seed, sampler and size. The values come from your workflow "
        "automatically, so nothing needs wiring in. It is off by default."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {"tooltip": "Image (or batch) to preview. Each frame appears as a thumbnail in the strip; click one to expand it inline. Wire any IMAGE source here."}),
                "filename_prefix": ("STRING", {"default": "img", "tooltip": (
                    "Filename stem written to output/. The node adds a 5-digit counter and .png. "
                    "Use '/' for subfolders (e.g. 'SDXL/portrait'). "
                    "Supports date tokens like %date:yyyy-MM-dd%, "
                    "native ComfyUI tokens like %year%, %month%, %day%, and node references like "
                    "%Seed Pixaroma.seed% that print another node's field value into the name. "
                    "See the node's Info panel (right sidebar) for the full token reference and examples."
                )}),
                "save_mode": (["preview", "save"], {"default": "preview", "tooltip": "preview: write each batch frame to ComfyUI's temp/ folder, auto-cleared on restart. Use this while iterating so you don't clutter output/. The temp PNGs embed the workflow, so you can drag a preview back onto the canvas to restore the graph (just like the native Preview node). save: write every batch frame to output/ with embedded workflow metadata, exactly like the native SaveImage node. The on-node preview strip works the same in both modes; the manual Save to Disk / Save to Output buttons are independent of save_mode."}),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
                "unique_id": "UNIQUE_ID",
                # Injected by js/preview/index.js from the global setting
                # Pixaroma.Preview.CivitaiMeta, which the right-click settings
                # panel writes. Kept OUT of the node body on purpose: an extra
                # widget would change how every existing Preview node looks for
                # a feature most people will not use.
                "CivitaiMeta": "STRING",
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    OUTPUT_TOOLTIPS = ("The image(s) passed through unchanged, so you can chain a preview inline without breaking the wire.",)
    FUNCTION = "preview"
    OUTPUT_NODE = True
    CATEGORY = "👑 Pixaroma/🖼️ Image"

    @classmethod
    def IS_CHANGED(cls, save_mode=None, unique_id=None, **kwargs):
        # Save mode (or a save_mode wired in, which reads as None here): always
        # re-execute, so every Run writes a file and a deleted one comes back.
        if save_mode != "preview":
            return float("nan")
        # Preview mode: unchanged while this node's temp files still exist, so
        # the nodes wired after it can come from the cache. See _preview_mode_token.
        return _preview_mode_token(unique_id)

    def preview(
        self,
        image,
        filename_prefix,
        save_mode,
        prompt=None,
        extra_pnginfo=None,
        unique_id=None,
        CivitaiMeta="",
    ):
        prefix = _safe_prefix(filename_prefix) or "Preview"

        # Civitai-readable generation settings, read from the graph (opt-in).
        # Built once for the whole batch. Wrapped because metadata must never
        # cost the user their image.
        #
        # Built in BOTH modes on purpose (review round-trip, 2026-07-30): the
        # Save to Disk / Save Output buttons re-encode whatever file the node
        # wrote through the /preview routes, which now pass the `parameters`
        # chunk through - and in the default preview mode the TEMP file is the
        # only source those buttons have, so gating this to save mode made the
        # toggle a no-op for exactly the default configuration. The fingerprint
        # cost only occurs when the user opted in, once per model.
        a1111 = None
        if (str(CivitaiMeta).strip().lower() in ("1", "true", "yes", "on")
                and not _metadata_disabled()):
            try:
                from ._civitai_meta import build_metadata
                a1111 = build_metadata(prompt, extra_pnginfo, unique_id,
                                       int(image.shape[2]), int(image.shape[1]))
            except Exception as e:
                print("[Preview Image Pixaroma] Civitai metadata skipped: %s" % e)

        results = []
        if save_mode == "save":
            output_dir = folder_paths.get_output_directory()
            full_folder, name, counter, subfolder, _ = folder_paths.get_save_image_path(
                prefix, output_dir, image.shape[2], image.shape[1]
            )
            os.makedirs(full_folder, exist_ok=True)
            for i, tensor in enumerate(image):
                pil = _tensor_to_pil(tensor)
                pnginfo = _build_pnginfo(prompt=prompt, extra_pnginfo=extra_pnginfo,
                                     parameters=a1111)
                fname = f"{name}_{counter + i:05}_.png"
                pil.save(os.path.join(full_folder, fname), "PNG", pnginfo=pnginfo)
                results.append({
                    "filename": fname,
                    "subfolder": subfolder,
                    "type": "output",
                })
        else:  # preview mode
            # Embed the workflow/prompt into the temp PNG too (same helper save
            # mode uses, and the same thing native PreviewImage does), so a temp
            # preview can be dragged back onto the canvas to restore the workflow
            # without having to switch to save mode and clean up output/ after.
            temp_dir = folder_paths.get_temp_directory()
            os.makedirs(temp_dir, exist_ok=True)
            pnginfo = _build_pnginfo(prompt=prompt, extra_pnginfo=extra_pnginfo,
                                         parameters=a1111)
            written = []
            for tensor in image:
                pil = _tensor_to_pil(tensor)
                fname = f"pixaroma_preview_{uuid.uuid4().hex}.png"
                path = os.path.join(temp_dir, fname)
                pil.save(path, "PNG", pnginfo=pnginfo)
                written.append(path)
                results.append({
                    "filename": fname,
                    "subfolder": "",
                    "type": "temp",
                })
            _remember_preview_run(unique_id, written)

        # Hand the EXECUTION-time prompt + workflow to the frontend so the
        # Save Disk / Save Output buttons embed the seed that ACTUALLY produced
        # this image. The buttons otherwise call app.graphToPrompt() at click
        # time, which - with "control after generate: randomize" - captures the
        # NEXT (already-randomized) seed, so dragging the saved PNG back into
        # ComfyUI reproduced a different image. This matches what save_mode=save
        # bakes in server-side.
        workflow = extra_pnginfo.get("workflow") if isinstance(extra_pnginfo, dict) else None
        # Sanitize: PROMPT contains is_changed:[NaN] (IS_CHANGED returns nan),
        # which is invalid JSON and would break the whole executed message.
        meta = _json_safe({"prompt": prompt, "workflow": workflow})

        # Embed the workflow/prompt metadata as an extra field on the FIRST
        # frame entry instead of in a separate `pixaroma_preview_meta` ui
        # key. ComfyUI's server-side get_outputs_summary (comfy_execution/
        # jobs.py) counts EVERY dict item across EVERY list-keyed ui array
        # as a separate "output" - which becomes the Assets panel's stack-
        # count badge. A separate meta key would add +1 to that count for
        # every save, surfacing as a confusing "2" or "3" badge on a single
        # PNG. Embedding meta as an extra field on the frame dict keeps the
        # count at 1 (server counts dicts, not nested fields). The frontend
        # safely ignores unknown fields like `_pixaroma_meta` per the
        # ResultItemImpl constructor in dialogService bundle - only known
        # fields (filename, subfolder, type, mediaType, nodeId) are copied.
        if results:
            results[0]["_pixaroma_meta"] = meta

        # Save mode emits the standard `ui.images` key so the Media Assets
        # panel refreshes (it uses that key as its "new output file" signal).
        # Preview mode uses our custom `pixaroma_preview_frames` key so
        # ComfyUI doesn't try to auto-populate node.imgs (defineProperty in
        # js/preview/index.js also blocks that as belt-and-braces). Either
        # way it's ONE ui key with ONE dict per frame, so the stack badge
        # never gets inflated.
        ui_key = "images" if save_mode == "save" else "pixaroma_preview_frames"
        return {
            "ui": {ui_key: results},
            "result": (image,),
        }


NODE_CLASS_MAPPINGS = {"PixaromaPreview": PixaromaPreview}
NODE_DISPLAY_NAME_MAPPINGS = {"PixaromaPreview": "Preview Image Pixaroma"}
