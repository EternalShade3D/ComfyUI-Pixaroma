// Edit 3D Pixaroma - the node face: Upload and the gear beside the dots, the model list, Open Edit 3D, the
// picture of the last saved edit, and the bottom line. DOM only: the state lives in core.mjs, the editor in
// editor.mjs.
//
// Conventions: #13 hover = the accent border, #14 our own dark popup (never a native <select>), #27 the popup
// follows the canvas zoom, #31 a commit that is not a click on our own UI calls notifyGraphChanged, #35 every
// fixed row declares flex-shrink 0, #39 the band offsets are measured against the dots.

import { api } from "/scripts/api.js";
import { pixApiUrl } from "../shared/api_url.mjs";
import { ACC, applyAccent } from "../shared/node_settings.mjs";
import { placeZoomedPopup } from "../shared/popup_zoom.mjs";
import { notifyGraphChanged } from "../shared/graph_changed.mjs";
import { isVueNodes } from "../shared/nodes2.mjs";
import { UPLOAD_ACCEPT, isModelFile } from "../load_3d/core.mjs";
import {
  CLASS, NONE, SUBFOLDER, MODEL_WIDGET, readState, readLastRun, wiredInput, modelWidget, modelValues,
  pickedValue, snapName, splitModelName, fmtInt, facesText,
} from "./core.mjs";

const ROOT = "pix-e3d-root";
export const SNAP_MIN = 120;

// The Upload + gear band floats up beside the dots, between the input labels on the left and the output labels on
// the right (CLAUDE.md #39). The same two-input / three-output slot layout as the Quad Remesh face these offsets
// were first measured on; read LIVE because the renderer can flip under a live node.
const BAND_TOP = -59;
const BAND_TOP_VUE = -51;
const BAND_SIDE = 84;

const ICON_UPLOAD = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M12 3l4.2 4.2h-3.2V13h-2V7.2H7.8L12 3z" fill="currentColor"/><path d="M5 14.5V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

let _cssDone = false;

// This CSS lives in a JS template literal: a backtick anywhere inside it, even in a comment, ends the literal and
// blanks every node on the page (#35). Use "double quotes" in comments here.
function injectCSS() {
  if (_cssDone) return;
  _cssDone = true;
  const F = "ui-sans-serif,system-ui,sans-serif";
  const css = `
.${ROOT}{position:relative;box-sizing:border-box;width:100%;flex:1 1 0;min-height:0;color:#ddd;font:11px ${F};}
.${ROOT} .pix-e3d-inner{position:absolute;inset:0;box-sizing:border-box;display:flex;flex-direction:column;gap:6px;padding:2px 8px 8px;overflow:hidden;}
.${ROOT} .pix-e3d-band{position:absolute;display:flex;gap:6px;align-items:stretch;justify-content:center;z-index:3;pointer-events:none;}
.${ROOT} .pix-e3d-band > *{pointer-events:auto;}
.${ROOT} .pix-e3d-up{flex:1 1 auto;min-width:86px;max-width:130px;height:34px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:7px;padding:0 10px;margin:0;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:7px;color:${ACC};font:600 12px ${F};cursor:pointer;transition:background .1s,border-color .1s,color .1s;}
.${ROOT} .pix-e3d-up .t{color:#dcdce0;transition:color .1s;}
.${ROOT} .pix-e3d-up:hover{background:${ACC};border-color:${ACC};color:#fff;}
.${ROOT} .pix-e3d-up:hover .t{color:#fff;}
.${ROOT} .pix-e3d-up.busy{opacity:.55;pointer-events:none;}
.${ROOT} .pix-e3d-up:disabled{opacity:.35;pointer-events:none;}
.${ROOT} .pix-e3d-gear{width:34px;height:34px;flex:0 0 auto;box-sizing:border-box;display:flex;align-items:center;justify-content:center;padding:0;margin:0;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:7px;color:#c2c2c8;cursor:pointer;transition:background .1s,border-color .1s,color .1s;}
.${ROOT} .pix-e3d-gear::before{content:"";display:block;width:16px;height:16px;background:currentColor;-webkit-mask:url("${pixApiUrl("/pixaroma/api/asset?path=icons/note/gear.svg")}") center/contain no-repeat;mask:url("${pixApiUrl("/pixaroma/api/asset?path=icons/note/gear.svg")}") center/contain no-repeat;}
.${ROOT} .pix-e3d-gear:hover{background:${ACC};border-color:${ACC};color:#fff;}
.${ROOT} .pix-e3d-band svg{display:block;pointer-events:none;}
.${ROOT} .pix-e3d-file{display:flex;gap:6px;align-items:stretch;flex:0 0 auto;height:28px;}
.${ROOT} .pix-e3d-nav{flex:0 0 auto;width:30px;box-sizing:border-box;padding:0;margin:0;background:#1d1d1d;border:1px solid #444;border-radius:4px;color:${ACC};font:700 11px ${F};cursor:pointer;display:flex;align-items:center;justify-content:center;user-select:none;transition:border-color .08s;}
.${ROOT} .pix-e3d-nav:hover:not(:disabled){border-color:${ACC};}
.${ROOT} .pix-e3d-nav:disabled{opacity:.3;cursor:default;}
.${ROOT} .pix-e3d-dd{flex:1;min-width:0;box-sizing:border-box;margin:0;padding:0 10px;background:#1d1d1d;border:1px solid #444;border-radius:4px;color:#ccc;font:11px ${F};cursor:pointer;display:flex;justify-content:space-between;align-items:center;user-select:none;text-align:left;}
.${ROOT} .pix-e3d-dd:hover:not(:disabled){border-color:${ACC};}
.${ROOT} .pix-e3d-dd:disabled{cursor:default;color:#9a9a9a;}
.${ROOT} .pix-e3d-dd .name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.${ROOT} .pix-e3d-dd .right{display:flex;align-items:center;flex-shrink:0;}
.${ROOT} .pix-e3d-dd .counter{color:#777;font-size:9px;margin-left:6px;font-family:ui-monospace,monospace;}
.${ROOT} .pix-e3d-dd .arrow{color:${ACC};font-size:13px;margin-left:6px;line-height:1;}
.${ROOT} .pix-e3d-dd:disabled .arrow{display:none;}
.${ROOT} .pix-e3d-open{flex:0 0 auto;height:34px;box-sizing:border-box;margin:0;border:1px solid ${ACC};border-radius:6px;background:${ACC};color:#fff;font:600 13px ${F};cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:filter .1s;}
.${ROOT} .pix-e3d-open:hover{filter:brightness(1.1);}
.${ROOT} .pix-e3d-snap{position:relative;flex:1 1 0;min-height:${SNAP_MIN}px;box-sizing:border-box;border:1px solid #444;border-radius:4px;overflow:hidden;background:#1b1c1e;cursor:pointer;}
.${ROOT} .pix-e3d-snap:hover{border-color:${ACC};}
.${ROOT} .pix-e3d-snap img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block;}
.${ROOT} .pix-e3d-msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:14px;box-sizing:border-box;color:#b0b0b0;font-size:11px;line-height:1.5;white-space:pre-line;pointer-events:none;}
.${ROOT} .pix-e3d-msg.over{inset:auto 0 0 0;padding:8px 10px;background:rgba(20,21,22,.88);}
.${ROOT} .pix-e3d-msg.bad{color:#e8826f;}
.${ROOT} .pix-e3d-info{flex:0 0 auto;height:22px;box-sizing:border-box;display:flex;align-items:center;background:rgba(0,0,0,.25);border-radius:4px;padding:0 8px;font-size:11px;color:#aaa;white-space:nowrap;overflow:hidden;}
.${ROOT} .pix-e3d-info span{overflow:hidden;text-overflow:ellipsis;}
.${ROOT} .pix-e3d-info.bad{color:#e8826f;}
.pix-e3d-pop{position:fixed;z-index:10900;background:#232323;border:1px solid #555;border-radius:6px;box-shadow:0 10px 30px rgba(0,0,0,.5);max-height:320px;overflow:auto;font-family:${F};padding:.25em 0;}
.pix-e3d-pop .sec{padding:.5em .8em .2em;color:#8a8a8a;font-size:.85em;letter-spacing:.3px;}
.pix-e3d-pop .it{padding:.35em .9em .35em 1.3em;cursor:pointer;font-size:1em;color:#ddd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pix-e3d-pop .it:hover{background:#2f2f2f;}
.pix-e3d-pop .it.on{color:${ACC};}
.pix-e3d-pop .em{padding:.5em .8em;font-size:.92em;color:#888;}
`;
  const s = document.createElement("style");
  s.textContent = css;
  document.head.appendChild(s);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function btn(cls, text, title) {
  const b = el("button", cls, text);
  b.type = "button";
  if (title) b.title = title;
  return b;
}

/** The native combo stays (it serialises and validates) but is never shown. */
export function hideModelWidget(node) {
  const w = modelWidget(node);
  if (!w) return null;
  w.hidden = true;
  w.computeSize = () => [0, -4];
  w.options = w.options || {};
  w.options.canvasOnly = true;
  const hide = () => {
    const e = w.element || w.inputEl;
    if (e) e.style.display = "none";
  };
  hide();
  requestAnimationFrame(hide);
  return w;
}

export function buildFace(node, handlers) {
  injectCSS();
  const root = el("div", ROOT);

  const band = el("div", "pix-e3d-band");
  const up = btn("pix-e3d-up", null, "Upload a 3D model from your computer into input/3d (GLB, GLTF, OBJ, FBX, STL or PLY). For an OBJ, pick its .mtl and textures too.");
  up.innerHTML = ICON_UPLOAD + '<span class="t">Upload</span>';
  const gear = btn("pix-e3d-gear", null, "Edit 3D settings (the button colour)");
  band.append(up, gear);
  root.appendChild(band);

  const inner = el("div", "pix-e3d-inner");
  root.appendChild(inner);

  const fileRow = el("div", "pix-e3d-file");
  const prev = btn("pix-e3d-nav", "◀", "Previous model");
  const next = btn("pix-e3d-nav", "▶", "Next model");
  const dd = btn("pix-e3d-dd", null, "Choose a model to edit");
  const name = el("span", "name", "");
  const right = el("span", "right");
  const counter = el("span", "counter", "");
  right.append(counter, el("span", "arrow", "▼"));
  dd.append(name, right);
  fileRow.append(prev, dd, next);

  const open = btn("pix-e3d-open", "Open Edit 3D", "Open the model in the fullscreen editor");
  const snap = el("div", "pix-e3d-snap");
  snap.title = "The model as it was last saved in the editor. Click to open Edit 3D.";
  const img = document.createElement("img");
  img.alt = "";
  img.draggable = false;
  const msg = el("div", "pix-e3d-msg");
  snap.append(img, msg);
  const info = el("div", "pix-e3d-info");
  const infoSpan = el("span", null, "");
  info.appendChild(infoSpan);

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.multiple = true;
  fileInput.accept = UPLOAD_ACCEPT;
  fileInput.style.display = "none";

  inner.append(fileRow, open, snap, info);
  root.appendChild(fileInput);

  const els = { root, band, up, gear, prev, next, dd, name, counter, open, snap, img, msg, info, infoSpan, fileInput };
  node._pixE3dEls = els;

  up.addEventListener("click", () => { fileInput.value = ""; fileInput.click(); });
  fileInput.addEventListener("change", () => {
    // The dialog is native chrome, outside any pix- element, so the pack-wide change net never sees this commit.
    if (fileInput.files?.length) uploadFiles(node, fileInput.files);
  });
  gear.addEventListener("click", () => handlers.openSettings?.(node));
  prev.addEventListener("click", () => pickByOffset(node, -1));
  next.addEventListener("click", () => pickByOffset(node, 1));
  dd.addEventListener("click", () => openPicker(node));
  open.addEventListener("click", () => handlers.openEditor?.(node));
  snap.addEventListener("click", () => handlers.openEditor?.(node));
  img.addEventListener("error", () => { img.style.display = "none"; });

  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  root.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  });
  root.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    // Stop it here, or ComfyUI tries to open the dropped file as a workflow.
    e.preventDefault();
    e.stopPropagation();
    uploadFiles(node, e.dataTransfer.files);
  });
  return root;
}

export function destroyFace(node) {
  closePopupFor(node);
  clearTimeout(node._pixE3dFlashT);
  node._pixE3dEls = null;
}

/** Float the band beside the dots. DOM style only, so it can never dirty a workflow. */
export function placeBand(node) {
  const band = node?._pixE3dEls?.band;
  if (!band) return;
  band.style.top = (isVueNodes() ? BAND_TOP_VUE : BAND_TOP) + "px";
  band.style.left = BAND_SIDE + "px";
  band.style.right = BAND_SIDE + "px";
}

function snapUrl(fileId, stamp) {
  return pixApiUrl(`/view?filename=${encodeURIComponent(snapName(fileId))}&type=input&subfolder=${SUBFOLDER}&t=${encodeURIComponent(stamp)}`);
}

export function renderFace(node) {
  const els = node?._pixE3dEls;
  if (!els) return;
  const st = readState(node);
  const run = readLastRun(node);
  const wired = wiredInput(node);
  const value = pickedValue(node);
  const values = modelValues(node);
  const picked = !!value && value !== NONE;

  if (wired) {
    els.name.textContent = `Wired in: ${wired}`;
    els.dd.title = "The model comes from the " + wired + " wire. Unplug it to pick a file here.";
    els.counter.textContent = "";
  } else {
    els.name.textContent = picked ? splitModelName(value).filename : values.length ? "Choose a model" : "No models yet";
    els.dd.title = picked ? value : "Choose a model to edit";
    const idx = values.indexOf(value);
    els.counter.textContent = values.length ? `${idx >= 0 ? idx + 1 : 0} / ${values.length}` : "";
  }
  els.dd.disabled = !!wired;
  els.up.disabled = !!wired;
  const navOff = !!wired || values.length < (picked && values.includes(value) ? 2 : 1);
  els.prev.disabled = navOff;
  els.next.disabled = navOff;

  const hasEdit = !!(st.edited && st.fileId && st.stamp);
  // A throwaway copy (Ctrl+C, Alt-drag, Clone) is configured but never added to a graph: it loads no picture.
  if (hasEdit && node.graph) {
    const url = snapUrl(st.fileId, st.stamp);
    if (els.img.dataset.src !== url) {
      els.img.dataset.src = url;
      els.img.src = url;
    }
    els.img.style.display = "";
  } else {
    els.img.removeAttribute("src");
    els.img.dataset.src = "";
    els.img.style.display = "none";
  }

  let msg = "";
  let bad = false;
  let over = false;
  if (!wired && !picked) {
    msg = values.length ? "Pick a model above, or wire a mesh\nor a model_3d into this node." : "Upload a 3D model, or wire a mesh\nor a model_3d into this node.";
  } else if (wired && !run?.input) {
    msg = "Run the workflow once so the model\nwired in reaches this node,\nthen press Open Edit 3D.";
  } else if (!hasEdit) {
    msg = "No edits yet.\nPress Open Edit 3D to clean the model up.";
  }
  const notes = Array.isArray(run?.notes) ? run.notes : [];
  const stale = hasEdit && run?.used === "source" && notes.some((n) => /changed since it was edited|saved edit is missing/.test(n));
  if (stale) {
    msg = notes.find((n) => /changed since it was edited|saved edit is missing/.test(n)) || "";
    bad = true;
    over = true;
  }
  els.msg.textContent = msg;
  els.msg.classList.toggle("bad", bad);
  els.msg.classList.toggle("over", over && hasEdit);
  els.msg.style.display = msg ? "" : "none";

  const parts = [];
  parts.push(hasEdit ? `${fmtInt(st.editCount)} edit${st.editCount === 1 ? "" : "s"}` : "No edits");
  if (run?.faces) parts.push(facesText(run.faces));
  if (run?.edges) parts.push(`${fmtInt(run.edges.open)} open edges`);
  let line = parts.join(" · ");
  let lineBad = stale;
  if (node._pixE3dFlash) {
    line = node._pixE3dFlash;
    lineBad = !!node._pixE3dFlashBad;
  }
  els.infoSpan.textContent = line;
  els.info.title = hasEdit && st.edits.length ? "Last edits: " + st.edits.join(", ") : line;
  els.info.classList.toggle("bad", lineBad);
}

/** A temporary message on the bottom line. */
export function flash(node, text, bad = false, ms = 6000) {
  clearTimeout(node._pixE3dFlashT);
  node._pixE3dFlash = text || "";
  node._pixE3dFlashBad = !!bad;
  renderFace(node);
  if (text && ms > 0) {
    node._pixE3dFlashT = setTimeout(() => {
      node._pixE3dFlash = "";
      node._pixE3dFlashBad = false;
      renderFace(node);
    }, ms);
  }
}

// ── picking a model ─────────────────────────────────────────────────────────
export function selectModel(node, value) {
  const w = modelWidget(node);
  if (!w) return;
  const v = String(value || NONE);
  const vals = w.options?.values;
  if (Array.isArray(vals) && !vals.includes(v)) vals.push(v);
  w.value = v;
  renderFace(node);
  notifyGraphChanged();
}

function pickByOffset(node, off) {
  const vals = modelValues(node);
  if (!vals.length) return;
  const cur = modelWidget(node)?.value;
  let i = vals.indexOf(cur);
  i = i < 0 ? (off > 0 ? 0 : vals.length - 1) : (i + off + vals.length) % vals.length;
  selectModel(node, vals[i]);
}

/** Re-read the model list from the server on every open (convention #18). */
export async function refreshModelList(node) {
  try {
    const res = await api.fetchApi(`/object_info/${encodeURIComponent(CLASS)}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    const spec = data?.[CLASS]?.input?.required?.[MODEL_WIDGET];
    let vals = null;
    if (Array.isArray(spec?.[0])) vals = spec[0];
    else if (spec?.[0] === "COMBO" && Array.isArray(spec?.[1]?.options)) vals = spec[1].options;
    if (!Array.isArray(vals)) return null;
    const w = modelWidget(node);
    if (w?.options) {
      const nextVals = vals.slice();
      const cur = w.value;
      if (cur && cur !== NONE && !nextVals.includes(cur)) nextVals.push(cur);
      w.options.values = nextVals;
    }
    return vals;
  } catch (_e) {
    return null;
  }
}

let _popup = null;

function closePopup() {
  try { _popup?.remove(); } catch (_e) { /* already gone */ }
  _popup = null;
  document.removeEventListener("pointerdown", onOutside, true);
  document.removeEventListener("wheel", onWheelOutside, true);
  document.removeEventListener("keydown", onEsc, true);
}

export function closePopupFor(node) {
  if (_popup && (!node || _popup._pixNode === node)) closePopup();
}

function onOutside(e) {
  if (!_popup || _popup.contains(e.target)) return;
  if (_popup._pixNode?._pixE3dEls?.dd?.contains(e.target)) return;
  closePopup();
}
function onWheelOutside(e) {
  // Gate on containment, or scrolling a long list closes it (Load Image #14).
  if (_popup && !_popup.contains(e.target)) closePopup();
}
function onEsc(e) {
  if (e.key === "Escape" && _popup) {
    e.stopPropagation();
    closePopup();
  }
}

async function openPicker(node) {
  const els = node._pixE3dEls;
  if (!els || els.dd.disabled) return;
  if (_popup && _popup._pixNode === node) {
    closePopup();
    return;
  }
  closePopup();
  const pop = el("div", "pix-e3d-pop");
  pop._pixNode = node;
  applyAccent(pop, node);
  pop.appendChild(el("div", "em", "reading the model folders ..."));
  document.body.appendChild(pop);
  _popup = pop;
  placeZoomedPopup(pop, els.dd, { baseFontPx: 12, minWidthPx: 200, baseMaxHeightPx: 320 });
  setTimeout(() => {
    if (_popup !== pop) return;
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("wheel", onWheelOutside, true);
    document.addEventListener("keydown", onEsc, true);
  }, 0);

  const fresh = await refreshModelList(node);
  if (_popup !== pop) return;
  pop.textContent = "";
  const values = modelValues(node);
  let onEl = null;
  if (!values.length) {
    pop.appendChild(el("div", "em", fresh === null ? "could not read the model folders" : "no models in input/3d or output/3d yet"));
  } else {
    const cur = modelWidget(node)?.value;
    let lastSec = null;
    for (const v of values) {
      const p = splitModelName(v);
      const sec = `${p.type}/${p.subfolder}`;
      if (sec !== lastSec) {
        pop.appendChild(el("div", "sec", sec));
        lastSec = sec;
      }
      const it = el("div", "it" + (v === cur ? " on" : ""), p.filename);
      it.title = v;
      it.addEventListener("click", () => {
        closePopup();
        selectModel(node, v);
      });
      pop.appendChild(it);
      if (v === cur) onEl = it;
    }
  }
  placeZoomedPopup(pop, els.dd, { baseFontPx: 12, minWidthPx: 200, baseMaxHeightPx: 320 });
  renderFace(node);
  try { onEl?.scrollIntoView({ block: "nearest" }); } catch (_e) { /* old browser */ }
}

// ── uploading ───────────────────────────────────────────────────────────────
async function uploadTo3d(file, overwrite) {
  const body = new FormData();
  body.append("image", file, file.name);
  body.append("type", "input");
  body.append("subfolder", "3d");
  if (overwrite) body.append("overwrite", "true");
  const res = await api.fetchApi("/upload/image", { method: "POST", body });
  if (res.status !== 200) {
    throw new Error(res.status === 413 ? "it is bigger than ComfyUI's upload limit" : `the server answered ${res.status}`);
  }
  const data = await res.json();
  return `${data?.subfolder || "3d"}/${data?.name || file.name}`;
}

export async function uploadFiles(node, fileList) {
  const files = [...(fileList || [])].filter(Boolean);
  if (!files.length) return;
  if (!files.some((f) => isModelFile(f.name))) {
    flash(node, "Choose a model file: GLB, GLTF, OBJ, FBX, STL or PLY.", true);
    return;
  }
  const els = node._pixE3dEls;
  const many = files.length > 1;
  els?.up.classList.add("busy");
  flash(node, many ? `Uploading ${files.length} files ...` : `Uploading ${files[0].name} ...`, false, 0);
  let chosen = null;
  let failed = "";
  for (const f of files) {
    try {
      const saved = await uploadTo3d(f, many);
      if (!chosen && isModelFile(f.name)) chosen = saved;
    } catch (e) {
      failed = `${f.name}: ${e.message || e}`;
    }
  }
  node._pixE3dEls?.up.classList.remove("busy");
  if (!chosen) {
    flash(node, `Upload failed (${failed || "unknown error"})`, true);
    return;
  }
  await refreshModelList(node);
  flash(node, "", false, 0);
  selectModel(node, chosen);
  if (failed) flash(node, `Some files did not upload (${failed})`, true);
}
