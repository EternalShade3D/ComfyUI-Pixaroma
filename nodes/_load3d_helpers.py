"""Load 3D Pixaroma - pure helpers, no torch and no ComfyUI imports.

Kept apart from the node so the harness can drive them with plain Python
(D:\\Claude Tests\\_load3d_test.py).
"""
from __future__ import annotations

import json
import os
import re

MODEL_EXTS = (".glb", ".gltf", ".obj", ".fbx", ".stl", ".ply")
CAPTURE_SUBFOLDER = "pixaroma_load3d"
NONE = "none"
MIN_SIDE = 64
MAX_SIDE = 4096

# A deep or enormous 3d folder must not hang the model list.
MAX_DEPTH = 8
MAX_FILES = 5000

# A picture reference is EXACTLY what the browser's own upload produces and
# nothing else. /prompt is unauthenticated, so this string is attacker-reachable;
# a strict pattern refuses anything unexpected before a path is even built.
_CAPTURE_RE = re.compile(r"^pixaroma_load3d/[A-Za-z0-9_-]{8,80}\.png \[temp\]$")

_ANNOTATIONS = (" [input]", " [output]", " [temp]")


def strip_annotation(name):
    """("3d/a.glb", "output") for "3d/a.glb [output]"; the folder defaults to input."""
    if not isinstance(name, str):
        return "", "input"
    for tag in _ANNOTATIONS:
        if name.endswith(tag):
            return name[: -len(tag)], tag[2:-1]
    return name, "input"


def is_model_name(name):
    bare, _kind = strip_annotation(name)
    return os.path.splitext(bare)[1].lower() in MODEL_EXTS


def list_models(root_dir, suffix=""):
    """Model files under <root_dir>/3d, named relative to root_dir.

    Forward slashes plus the annotation `suffix` (" [output]" for the output
    folder), which is exactly the shape folder_paths.get_annotated_filepath
    reads. followlinks stays False so a link inside the folder cannot turn the
    list into a walk of some other drive.
    """
    out = []
    if not root_dir:
        return out
    base = os.path.join(root_dir, "3d")
    if not os.path.isdir(base):
        return out
    base_depth = os.path.normpath(base).count(os.sep)
    for cur, dirs, files in os.walk(base, followlinks=False):
        if os.path.normpath(cur).count(os.sep) - base_depth >= MAX_DEPTH:
            dirs[:] = []
        dirs.sort(key=str.lower)
        for name in sorted(files, key=str.lower):
            if os.path.splitext(name)[1].lower() not in MODEL_EXTS:
                continue
            rel = os.path.relpath(os.path.join(cur, name), root_dir).replace(os.sep, "/")
            out.append(rel + suffix)
            if len(out) >= MAX_FILES:
                return out
    return out


def _side(value, default):
    try:
        n = int(round(float(value)))
    except (TypeError, ValueError, OverflowError):
        return default
    return max(MIN_SIDE, min(MAX_SIDE, n))


def parse_state(raw):
    """The injected state, reduced to what Python may use, every field checked."""
    st = {}
    if isinstance(raw, str) and raw:
        try:
            st = json.loads(raw)
        except (ValueError, TypeError):
            st = {}
    if not isinstance(st, dict):
        st = {}
    out = {"w": _side(st.get("w"), 1024), "h": _side(st.get("h"), 1024)}
    for key in ("image", "mask"):
        value = st.get(key)
        out[key] = value if isinstance(value, str) and _CAPTURE_RE.match(value) else ""
    return out


def outputs_consumed(prompt, unique_id, indexes):
    """True when any node in the API prompt reads one of this node's `indexes` outputs.

    Used so a run that only wants model_3d (a script, the API) does not fail for
    lack of a picture it never needed. When it cannot tell, it says yes, which
    keeps the strict behaviour.
    """
    if not isinstance(prompt, dict) or unique_id is None:
        return True
    uid = str(unique_id)
    for entry in prompt.values():
        inputs = entry.get("inputs") if isinstance(entry, dict) else None
        if not isinstance(inputs, dict):
            continue
        for value in inputs.values():
            if (isinstance(value, (list, tuple)) and len(value) == 2
                    and str(value[0]) == uid and value[1] in indexes):
                return True
    return False
