// Load 3D Pixaroma - the node face.
//
// Conventions: #12 labelled number fields, #13 interaction states (hover = the
// accent border), #14 our own dark popup (never a native <select>), #20 drags
// with pointer capture AND the buttons-up guard, #27 the popup follows the
// canvas zoom, #31 a drag or an async commit calls notifyGraphChanged, #35
// every fixed row declares flex-shrink 0, #37 the canvas never sizes its own box.

import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { ACC, applyAccent } from "../shared/node_settings.mjs";
import { placeZoomedPopup } from "../shared/popup_zoom.mjs";
import { notifyGraphChanged } from "../shared/graph_changed.mjs";
import { isVueNodes } from "../shared/nodes2.mjs";
import {
  CLASS, NONE, MODEL_WIDGET, LOOKS, VIEWS, UPLOAD_ACCEPT, MIN_SIDE, MAX_SIDE,
  readState, writeState, splitModelName, isModelFile,
} from "./core.mjs";
import {
  attachCanvas, setModel, statusOf, requestDraw, animateView, infoText, invalidateModel, panScale, drawBlocked,
} from "./engine.mjs";
import { sizeSources, sizeNote, isLocked } from "./size.mjs";

const ROOT = "pix-l3d-root";
export const VP_MIN = 140;

// The Upload + gear band floats up beside the model_3d, image and mask dots, so
// the node spends no extra row on it (CLAUDE.md node UI convention #39). The
// offset is PER RENDERER and was measured against the dots, not the node frame,
// with those three outputs only: each slot row after them (width, height) moves
// the body down one pitch, so the band climbs back by the same amount. Read live,
// because the renderer can flip under a live node.
const BAND_TOP = -59;
const BAND_TOP_VUE = -51;
const BAND_ROWS_MEASURED = 3;
const SLOT_PITCH = 20;
const BAND_LEFT = 8;
const BAND_RSV_R = 92; // keep clear of the output labels

const ICON_UPLOAD = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M12 3l4.2 4.2h-3.2V13h-2V7.2H7.8L12 3z" fill="currentColor"/><path d="M5 14.5V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_GEAR = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19.4 13a7.8 7.8 0 0 0 .05-1 7.8 7.8 0 0 0-.05-1l2-1.55a.5.5 0 0 0 .12-.62l-1.9-3.28a.5.5 0 0 0-.6-.22l-2.36 1a7 7 0 0 0-1.72-1l-.36-2.5a.5.5 0 0 0-.5-.42h-3.8a.5.5 0 0 0-.5.42l-.36 2.5a7 7 0 0 0-1.72 1l-2.36-1a.5.5 0 0 0-.6.22L2.48 8.2a.5.5 0 0 0 .12.62L4.6 11a7.8 7.8 0 0 0 0 2l-2 1.56a.5.5 0 0 0-.12.62l1.9 3.28a.5.5 0 0 0 .6.22l2.36-1a7 7 0 0 0 1.72 1l.36 2.5a.5.5 0 0 0 .5.42h3.8a.5.5 0 0 0 .5-.42l.36-2.5a7 7 0 0 0 1.72-1l2.36 1a.5.5 0 0 0 .6-.22l1.9-3.28a.5.5 0 0 0-.12-.62L19.4 13zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"/></svg>';

let _cssDone = false;

// This CSS lives in a JS template literal: a backtick anywhere inside it, even
// in a comment, ends the literal and blanks every node on the page (#35).
export function injectCSS() {
  if (_cssDone) return;
  _cssDone = true;
  const F = "ui-sans-serif,system-ui,sans-serif";
  const css = `
.${ROOT}{position:relative;box-sizing:border-box;width:100%;flex:1 1 0;min-height:0;color:#ddd;font:11px ${F};}
.${ROOT} .pix-l3d-inner{position:absolute;inset:0;box-sizing:border-box;display:flex;flex-direction:column;gap:6px;padding:2px 8px 8px;overflow:hidden;}
.${ROOT} .pix-l3d-band{position:absolute;display:flex;gap:6px;align-items:stretch;z-index:3;}
.${ROOT} .pix-l3d-up{flex:1 1 auto;min-width:96px;height:34px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:8px;padding:0 10px;margin:0;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:7px;color:${ACC};font:600 12px ${F};cursor:pointer;transition:background .1s,border-color .1s,color .1s;}
.${ROOT} .pix-l3d-up .t{color:#dcdce0;transition:color .1s;}
.${ROOT} .pix-l3d-up:hover{background:${ACC};border-color:${ACC};color:#fff;}
.${ROOT} .pix-l3d-up:hover .t{color:#fff;}
.${ROOT} .pix-l3d-up.busy{opacity:.55;pointer-events:none;}
.${ROOT} .pix-l3d-ib{width:34px;height:34px;flex:0 0 auto;box-sizing:border-box;display:flex;align-items:center;justify-content:center;padding:0;margin:0;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:7px;color:#c2c2c8;cursor:pointer;transition:background .1s,border-color .1s,color .1s;}
.${ROOT} .pix-l3d-ib:hover{background:${ACC};border-color:${ACC};color:#fff;}
.${ROOT} .pix-l3d-band svg{display:block;pointer-events:none;}
.${ROOT} .pix-l3d-file{display:flex;gap:6px;align-items:stretch;flex:0 0 auto;height:28px;}
.${ROOT} .pix-l3d-nav{flex:0 0 auto;width:30px;box-sizing:border-box;padding:0;margin:0;background:#1d1d1d;border:1px solid #444;border-radius:4px;color:${ACC};font:700 11px ${F};cursor:pointer;display:flex;align-items:center;justify-content:center;user-select:none;transition:border-color .08s;}
.${ROOT} .pix-l3d-nav:hover:not(:disabled){border-color:${ACC};}
.${ROOT} .pix-l3d-nav:disabled{opacity:.3;cursor:default;}
.${ROOT} .pix-l3d-dd{flex:1;min-width:0;box-sizing:border-box;margin:0;padding:0 10px;background:#1d1d1d;border:1px solid #444;border-radius:4px;color:#ccc;font:11px ${F};cursor:pointer;display:flex;justify-content:space-between;align-items:center;user-select:none;text-align:left;}
.${ROOT} .pix-l3d-dd:hover{border-color:${ACC};}
.${ROOT} .pix-l3d-dd .name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.${ROOT} .pix-l3d-dd .right{display:flex;align-items:center;flex-shrink:0;}
.${ROOT} .pix-l3d-dd .counter{color:#777;font-size:9px;margin-left:6px;font-family:ui-monospace,monospace;}
.${ROOT} .pix-l3d-dd .arrow{color:${ACC};font-size:13px;margin-left:6px;line-height:1;}
.${ROOT} .pix-l3d-vp{position:relative;flex:1 1 0;min-height:${VP_MIN}px;box-sizing:border-box;border:1px solid #444;border-radius:4px;overflow:hidden;background:#262626;cursor:grab;touch-action:none;}
.${ROOT} .pix-l3d-vp.dragging{cursor:grabbing;}
.${ROOT} .pix-l3d-vp.drop{border-color:${ACC};}
.${ROOT} .pix-l3d-vp canvas{position:absolute;inset:0;width:100%;height:100%;display:block;}
.${ROOT} .pix-l3d-msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:14px;box-sizing:border-box;color:#b0b0b0;font-size:11px;line-height:1.5;white-space:pre-line;pointer-events:none;}
.${ROOT} .pix-l3d-msg.bad{color:#e8826f;}
.${ROOT} .pix-l3d-views{display:flex;gap:3px;flex:0 0 auto;height:24px;}
.${ROOT} .pix-l3d-views button{flex:1 1 0;min-width:0;box-sizing:border-box;margin:0;padding:0 2px;background:#1d1d1d;border:1px solid #444;border-radius:4px;color:#aaa;font:11px ${F};cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.${ROOT} .pix-l3d-views button:hover{border-color:${ACC};color:#ddd;}
.${ROOT} .pix-l3d-views button.on{background:${ACC};border-color:${ACC};color:#fff;}
.${ROOT} .pix-l3d-looks{display:flex;flex:0 0 auto;height:24px;box-sizing:border-box;background:#1d1d1d;border:1px solid #444;border-radius:4px;overflow:hidden;}
.${ROOT} .pix-l3d-looks button{flex:1 1 0;min-width:0;margin:0;border:0;padding:0 2px;background:transparent;color:#aaa;font:11px ${F};cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.${ROOT} .pix-l3d-looks button:hover{background:rgba(255,255,255,.08);color:#ddd;}
.${ROOT} .pix-l3d-looks button.on{background:${ACC};color:#fff;}
.${ROOT} .pix-l3d-size{display:flex;gap:5px;flex:0 0 auto;height:26px;}
.${ROOT} .pix-l3d-num{flex:1 1 0;min-width:0;box-sizing:border-box;display:flex;align-items:center;gap:6px;background:#1d1d1d;border:1px solid #444;border-radius:4px;padding:0 3px 0 8px;cursor:text;}
.${ROOT} .pix-l3d-num:focus-within{border-color:${ACC};}
.${ROOT} .pix-l3d-num .lb{flex:0 0 auto;font-size:11px;letter-spacing:.3px;color:${ACC};}
.${ROOT} .pix-l3d-num input{flex:1 1 auto;min-width:0;width:40px;margin:0;padding:0;background:none;border:none;outline:none;text-align:right;color:${ACC};font:12px ${F};line-height:1.2;}
.${ROOT} .pix-l3d-spin{flex:0 0 auto;display:flex;flex-direction:column;align-self:stretch;justify-content:center;line-height:.9;}
.${ROOT} .pix-l3d-spin b{font-size:8px;color:${ACC};cursor:pointer;font-weight:400;padding:0 3px;user-select:none;}
.${ROOT} .pix-l3d-spin b:hover{filter:brightness(1.4);}
.${ROOT} .pix-l3d-swap{flex:0 0 auto;width:28px;box-sizing:border-box;margin:0;padding:0;background:#1d1d1d;border:1px solid #444;border-radius:4px;color:#ccc;font:13px ${F};cursor:pointer;}
.${ROOT} .pix-l3d-swap:hover{border-color:${ACC};color:#fff;}
.${ROOT} .pix-l3d-swap:disabled,.${ROOT} .pix-l3d-swap:disabled:hover{opacity:.35;cursor:default;border-color:#444;color:#ccc;}
.${ROOT} .pix-l3d-num.wired{cursor:default;opacity:.55;filter:grayscale(.9);}
.${ROOT} .pix-l3d-num.wired:focus-within{border-color:#444;}
.${ROOT} .pix-l3d-num.wired input,.${ROOT} .pix-l3d-num.wired .pix-l3d-spin{pointer-events:none;}
/* Nodes 2.0 lays the input dots out itself: move width and height down three slot rows, beside their outputs */
.lg-node:has(.${ROOT}) .lg-slot--input:first-child{margin-top:${BAND_ROWS_MEASURED * SLOT_PITCH}px !important;}
.${ROOT} .pix-l3d-info{flex:0 0 auto;height:22px;box-sizing:border-box;display:flex;align-items:center;background:rgba(0,0,0,.25);border-radius:4px;padding:0 8px;font-size:11px;color:#aaa;white-space:nowrap;overflow:hidden;}
.${ROOT} .pix-l3d-info span{overflow:hidden;text-overflow:ellipsis;}
.${ROOT} .pix-l3d-info.bad{color:#e8826f;}
.pix-l3d-pop{position:fixed;z-index:10900;background:#232323;border:1px solid #555;border-radius:6px;box-shadow:0 10px 30px rgba(0,0,0,.5);max-height:320px;overflow:auto;font-family:${F};padding:.25em 0;}
.pix-l3d-pop .sec{padding:.5em .8em .2em;color:#8a8a8a;font-size:.85em;letter-spacing:.3px;}
.pix-l3d-pop .it{padding:.35em .9em .35em 1.3em;cursor:pointer;font-size:1em;color:#ddd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pix-l3d-pop .it:hover{background:#2f2f2f;}
.pix-l3d-pop .it.on{color:${ACC};}
.pix-l3d-pop .em{padding:.5em .8em;font-size:.92em;color:#888;}
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

export function modelWidget(node) {
  return node?.widgets?.find((w) => w && w.name === MODEL_WIDGET) || null;
}

export function modelValues(node) {
  const vals = modelWidget(node)?.options?.values;
  return Array.isArray(vals) ? vals.filter((v) => v && v !== NONE) : [];
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

// ── the face ────────────────────────────────────────────────────────────────
export function buildFace(node, handlers) {
  injectCSS();
  const root = el("div", ROOT);

  const band = el("div", "pix-l3d-band");
  const up = btn("pix-l3d-up", null, "Upload models from your computer into input/3d. For an OBJ, pick its .mtl and textures too.");
  up.innerHTML = ICON_UPLOAD + '<span class="t">Upload</span>';
  const gear = btn("pix-l3d-ib", null, "Load 3D settings");
  gear.innerHTML = ICON_GEAR;
  band.append(up, gear);
  root.appendChild(band);

  const inner = el("div", "pix-l3d-inner");
  root.appendChild(inner);

  const fileRow = el("div", "pix-l3d-file");
  const prev = btn("pix-l3d-nav", "◀", "Previous model");
  const next = btn("pix-l3d-nav", "▶", "Next model");
  const dd = btn("pix-l3d-dd", null, "Choose a model");
  const name = el("span", "name", "");
  const right = el("span", "right");
  const counter = el("span", "counter", "");
  right.append(counter, el("span", "arrow", "▼"));
  dd.append(name, right);
  fileRow.append(prev, dd, next);

  const vp = el("div", "pix-l3d-vp");
  const canvas = document.createElement("canvas");
  const msg = el("div", "pix-l3d-msg");
  vp.append(canvas, msg);

  const views = el("div", "pix-l3d-views");
  const viewBtns = {};
  for (const v of VIEWS) {
    const b = btn(null, v.label, v.tip);
    viewBtns[v.key] = b;
    views.appendChild(b);
  }
  const fit = btn(null, "Fit", "Frame the whole model again and keep the angle (double-clicking the view does the same)");
  views.appendChild(fit);

  const looks = el("div", "pix-l3d-looks");
  const lookBtns = {};
  for (const l of LOOKS) {
    const b = btn(null, l.label, l.tip);
    lookBtns[l.key] = b;
    looks.appendChild(b);
  }

  const size = el("div", "pix-l3d-size");
  const wField = numField("Width", "Picture width in pixels, 64 to 4096. The arrows step by 8 (Shift: 64).");
  const swap = btn("pix-l3d-swap", "⇄", "Swap width and height");
  const hField = numField("Height", "Picture height in pixels, 64 to 4096. The arrows step by 8 (Shift: 64).");
  size.append(wField.wrap, swap, hField.wrap);

  const info = el("div", "pix-l3d-info");
  const infoSpan = el("span", null, "");
  info.appendChild(infoSpan);

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.multiple = true;
  fileInput.accept = UPLOAD_ACCEPT;
  fileInput.style.display = "none";

  inner.append(fileRow, vp, views, looks, size, info);
  root.appendChild(fileInput);

  const els = {
    root, band, up, gear, prev, next, dd, name, counter, vp, canvas, msg,
    viewBtns, fit, lookBtns, w: wField, h: hField, swap, info, infoSpan, fileInput,
  };
  node._pixL3dEls = els;
  wireFace(node, els, handlers || {});
  attachCanvas(node, canvas, () => renderFace(node));
  return root;
}

function numField(label, tip) {
  const wrap = el("label", "pix-l3d-num");
  wrap.title = tip;
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "numeric";
  input.spellcheck = false;
  input.autocomplete = "off";
  const spin = el("span", "pix-l3d-spin");
  const upB = el("b", null, "▲");
  const dnB = el("b", null, "▼");
  spin.append(upB, dnB);
  wrap.append(el("span", "lb", label), input, spin);
  return { wrap, input, upB, dnB, tip, label };
}

export function destroyFace(node) {
  closePopup();
  clearTimeout(node._pixL3dFlashT);
  clearTimeout(node._pixL3dWheelT);
  node._pixL3dEls = null;
}

/** Float the band beside the model_3d, image and mask dots. DOM style only, so it can never dirty a workflow. */
export function placeBand(node) {
  const band = node?._pixL3dEls?.band;
  if (!band) return;
  const rows = Math.max(BAND_ROWS_MEASURED, Array.isArray(node.outputs) ? node.outputs.length : 0);
  const top = (isVueNodes() ? BAND_TOP_VUE : BAND_TOP) - (rows - BAND_ROWS_MEASURED) * SLOT_PITCH;
  band.style.top = top + "px";
  band.style.left = BAND_LEFT + "px";
  band.style.right = BAND_RSV_R + "px";
}

// Width and Height: the node's own numbers, or locked to what a wire delivers.
function renderSizeFields(node, els, st, sources) {
  for (const [key, f] of [["w", els.w], ["h", els.h]]) {
    const src = sources[key];
    const locked = isLocked(src);
    const word = f.label.toLowerCase();
    f.wrap.classList.toggle("wired", locked);
    f.input.readOnly = locked;
    f.input.tabIndex = locked ? -1 : 0;
    if (!locked) {
      if (document.activeElement !== f.input) f.input.value = String(st[key]);
      f.wrap.title = f.tip;
      continue;
    }
    if (document.activeElement === f.input) f.input.blur();
    if (src.state === "value") {
      f.input.value = String(src.value);
      f.wrap.title = `${f.label} comes from "${src.title}". Unplug the wire to type a ${word} here.`;
    } else {
      const from = src.title ? `"${src.title}"` : "a node";
      f.input.value = "?";
      f.wrap.title = `${f.label} is wired in from ${from}, whose number only exists once the workflow `
        + `runs, so the picture cannot follow it. Wire Sizes Pixaroma, or unplug the wire to type a ${word} here.`;
    }
  }
  els.swap.disabled = isLocked(sources.w) || isLocked(sources.h);
}

export function renderFace(node) {
  const els = node?._pixL3dEls;
  if (!els) return;
  const st = readState(node);
  const value = String(modelWidget(node)?.value ?? NONE);
  const values = modelValues(node);
  const has = !!value && value !== NONE;
  const p = splitModelName(value);

  els.name.textContent = has ? p.filename : values.length ? "Choose a model" : "No models yet";
  els.dd.title = has ? value : "Choose a model";
  const idx = values.indexOf(value);
  els.counter.textContent = values.length ? `${idx >= 0 ? idx + 1 : 0} / ${values.length}` : "";
  const navOff = values.length < (has && idx >= 0 ? 2 : 1);
  els.prev.disabled = navOff;
  els.next.disabled = navOff;

  for (const [k, b] of Object.entries(els.viewBtns)) b.classList.toggle("on", st.view === k);
  for (const [k, b] of Object.entries(els.lookBtns)) b.classList.toggle("on", st.look === k);
  const sources = sizeSources(node);
  renderSizeFields(node, els, st, sources);

  const s = statusOf(node);
  let msg = "";
  let line = "";
  let bad = false;
  if (!has) {
    msg = values.length
      ? "Pick a model from the list above,\nor drop model files here."
      : "Upload a 3D model, or drop one here.\nGLB, GLTF, OBJ, FBX, STL or PLY";
    line = "No model";
  } else if (s.status === "error" && s.value === value) {
    msg = `Could not open ${p.filename}:\n${s.error}`;
    line = `Could not open this file: ${s.error}`;
    bad = true;
  } else if (s.status !== "ready" || s.value !== value) {
    msg = `Loading ${p.filename} ...`;
    line = "Loading ...";
  } else {
    line = infoText(s.info);
    if (drawBlocked(node)) {
      // Loaded, but the browser would not draw it (engine.mjs markBlocked): it retries on its own.
      msg = "The browser stopped drawing 3D views.\nRefresh the page (F5) if the model does not come back.";
    }
  }
  // A wired size that cannot be used outranks the file line, but not a file that
  // failed to open.
  const note = sizeNote(sources);
  if (note && !bad) {
    line = note;
    bad = true;
  }
  if (node._pixL3dFlash) {
    line = node._pixL3dFlash;
    bad = !!node._pixL3dFlashBad;
  }
  els.msg.textContent = msg;
  els.msg.classList.toggle("bad", bad && !!msg);
  els.msg.style.display = msg ? "" : "none";
  els.infoSpan.textContent = line;
  els.info.title = line;
  els.info.classList.toggle("bad", bad);
  requestDraw(node);
}

/** A temporary message on the bottom line (upload progress, a failed picture). */
export function flash(node, text, bad = false, ms = 5000) {
  clearTimeout(node._pixL3dFlashT);
  node._pixL3dFlash = text || "";
  node._pixL3dFlashBad = !!bad;
  renderFace(node);
  if (text && ms > 0) {
    node._pixL3dFlashT = setTimeout(() => {
      node._pixL3dFlash = "";
      node._pixL3dFlashBad = false;
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
  // A different model has its own size: frame it whole, keep the angle.
  writeState(node, { zoom: 1, panX: 0, panY: 0 });
  setModel(node, v);
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

/** Re-read the model list from the server (convention #18: on every open). */
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
      // A model that has gone missing stays listed, so the node can say so.
      if (cur && cur !== NONE && !nextVals.includes(cur)) nextVals.push(cur);
      w.options.values = nextVals;
    }
    return vals;
  } catch (_e) {
    return null;
  }
}

let _popup = null;

export function closePopup() {
  try { _popup?.remove(); } catch (_e) { /* already gone */ }
  _popup = null;
  document.removeEventListener("pointerdown", onOutside, true);
  document.removeEventListener("wheel", onWheelOutside, true);
  document.removeEventListener("keydown", onEsc, true);
}

function onOutside(e) {
  if (!_popup || _popup.contains(e.target)) return;
  // A press on the node's own model field is left to that field's click, which
  // closes the open list. Closing here as well let that click reopen it.
  if (_popup._pixNode?._pixL3dEls?.dd?.contains(e.target)) return;
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
  const els = node._pixL3dEls;
  if (!els) return;
  if (_popup && _popup._pixNode === node) {
    closePopup();
    return;
  }
  closePopup();
  const pop = el("div", "pix-l3d-pop");
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
  const nameOut = data?.name || file.name;
  const sub = data?.subfolder || "3d";
  return `${sub}/${nameOut}`;
}

export async function uploadFiles(node, fileList) {
  const files = [...(fileList || [])].filter(Boolean);
  if (!files.length) return;
  if (!files.some((f) => isModelFile(f.name))) {
    flash(node, "Choose a model file: GLB, GLTF, OBJ, FBX, STL or PLY.", true);
    return;
  }
  const els = node._pixL3dEls;
  // Several files at once are a model with its side files (an OBJ, its .mtl and
  // textures): overwrite so the names the model refers to stay exactly right.
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
  node._pixL3dEls?.up.classList.remove("busy");
  if (!chosen) {
    flash(node, `Upload failed (${failed || "unknown error"})`, true);
    return;
  }
  invalidateModel(chosen);
  await refreshModelList(node);
  flash(node, "", false, 0);
  selectModel(node, chosen);
  if (failed) flash(node, `Some files did not upload (${failed})`, true);
}

// ── wiring ──────────────────────────────────────────────────────────────────
function canvasZoom() {
  const s = app.canvas?.ds?.scale;
  return Number.isFinite(s) && s > 0 ? s : 1;
}

// A side locked to a wire keeps the node's own number untouched: the arrows, the
// keyboard and a change event that arrives late all stop here. (The swap button
// needs no check: it is disabled while either side is locked.)
function sideLocked(node, key) {
  return isLocked(sizeSources(node)[key]);
}

function stepSide(node, key, delta, input) {
  if (sideLocked(node, key)) return;
  const st = readState(node);
  writeState(node, { [key]: Math.min(MAX_SIDE, Math.max(MIN_SIDE, st[key] + delta)) });
  // renderFace leaves a FOCUSED field alone (so typing is never overwritten),
  // which is exactly the field the arrow keys are stepping: write it here.
  if (input) input.value = String(readState(node)[key]);
  renderFace(node);
}

function commitSide(node, key, input) {
  if (sideLocked(node, key)) {
    renderFace(node);
    return;
  }
  const st = readState(node);
  const n = parseInt(String(input.value).replace(/[^0-9]/g, ""), 10);
  const v = Number.isFinite(n) ? Math.min(MAX_SIDE, Math.max(MIN_SIDE, n)) : st[key];
  if (v !== st[key]) writeState(node, { [key]: v });
  input.value = String(v);
  renderFace(node);
}

export function fitView(node) {
  writeState(node, { zoom: 1, panX: 0, panY: 0 });
  renderFace(node);
}

function wireFace(node, els, handlers) {
  els.up.addEventListener("click", () => {
    els.fileInput.value = "";
    els.fileInput.click();
  });
  els.fileInput.addEventListener("change", () => {
    const files = els.fileInput.files;
    // The dialog is native chrome, outside any pix- element, so the pack-wide
    // change net never sees this commit: uploadFiles notifies by itself.
    if (files?.length) uploadFiles(node, files);
  });
  els.gear.addEventListener("click", () => handlers.openSettings?.(node));
  els.prev.addEventListener("click", () => pickByOffset(node, -1));
  els.next.addEventListener("click", () => pickByOffset(node, 1));
  els.dd.addEventListener("click", () => openPicker(node));

  for (const v of VIEWS) {
    els.viewBtns[v.key].addEventListener("click", () => {
      const st = readState(node);
      writeState(node, { az: v.az, el: v.el, view: v.key, zoom: 1, panX: 0, panY: 0 });
      animateView(node, st.az, st.el);
      renderFace(node);
    });
  }
  els.fit.addEventListener("click", () => fitView(node));
  for (const l of LOOKS) {
    els.lookBtns[l.key].addEventListener("click", () => {
      writeState(node, { look: l.key });
      renderFace(node);
    });
  }

  for (const [key, f] of [["w", els.w], ["h", els.h]]) {
    f.input.addEventListener("change", () => commitSide(node, key, f.input));
    f.input.addEventListener("keydown", (e) => {
      // Keep ComfyUI's own shortcuts (Delete removes the node!) out of the field.
      e.stopPropagation();
      if (e.key === "Enter" || e.keyCode === 13) {
        e.preventDefault();
        commitSide(node, key, f.input);
        f.input.blur();
        notifyGraphChanged();
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        stepSide(node, key, (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 64 : 8), f.input);
        notifyGraphChanged();
      }
    });
    f.upB.addEventListener("click", (e) => {
      e.preventDefault();
      stepSide(node, key, e.shiftKey ? 64 : 8, f.input);
    });
    f.dnB.addEventListener("click", (e) => {
      e.preventDefault();
      stepSide(node, key, e.shiftKey ? -64 : -8, f.input);
    });
  }
  els.swap.addEventListener("click", () => {
    const st = readState(node);
    writeState(node, { w: st.h, h: st.w });
    renderFace(node);
  });

  wireViewport(node, els);

  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  els.root.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    els.vp.classList.add("drop");
  });
  els.root.addEventListener("dragleave", (e) => {
    if (!els.root.contains(e.relatedTarget)) els.vp.classList.remove("drop");
  });
  els.root.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    // Stop it here, or ComfyUI tries to open the dropped file as a workflow.
    e.preventDefault();
    e.stopPropagation();
    els.vp.classList.remove("drop");
    uploadFiles(node, e.dataTransfer.files);
  });
}

function wireViewport(node, els) {
  const vp = els.vp;
  let drag = null;

  const end = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    try { vp.releasePointerCapture(d.id); } catch (_e) { /* not captured */ }
    vp.classList.remove("dragging");
    // A drag ends on pointerup, which the pack-wide change net does not watch.
    if (d.moved) notifyGraphChanged();
  };

  // Nodes 2.0 forwards EVERY wheel over node content to the canvas unless the
  // target sits inside data-capture-wheel="true" AND focus is inside it
  // (useCanvasInteractions.ts), so a trackpad pan is not grabbed by a widget the
  // pointer merely crosses. Core's own Load 3D view does exactly this: click the
  // view, then the wheel zooms the model. Classic never reads the attribute and
  // keeps hover-zoom. The preventDefault below also cancels the focus a press
  // would give, hence the explicit focus().
  vp.tabIndex = -1;
  vp.dataset.captureWheel = "true";
  vp.style.outline = "none";

  vp.addEventListener("pointerdown", (e) => {
    if (e.button > 2) return;
    e.preventDefault();
    e.stopPropagation();
    try { vp.focus({ preventScroll: true }); } catch (_e) { /* not focusable */ }
    if (!(statusOf(node).status === "ready")) return;
    const pan = e.button !== 0 || e.shiftKey;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, pan, moved: false };
    try { vp.setPointerCapture(e.pointerId); } catch (_e) { /* old browser */ }
    vp.classList.add("dragging");
  });

  vp.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    // The release can go missing (off the window, another capture): stop, or
    // the model keeps following the cursor with no button held (#20).
    if (!(e.buttons & 7)) {
      end();
      return;
    }
    const z = canvasZoom();
    const dx = (e.clientX - drag.x) / z;
    const dy = (e.clientY - drag.y) / z;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (!dx && !dy) return;
    drag.moved = true;
    const st = readState(node);
    if (drag.pan) {
      const { unitsPerPx, radius } = panScale(node, vp.clientWidth, vp.clientHeight);
      writeState(node, {
        panX: st.panX - (dx * unitsPerPx) / radius,
        panY: st.panY + (dy * unitsPerPx) / radius,
      });
    } else {
      writeState(node, {
        az: st.az - dx * 0.5,
        el: Math.max(-89.9, Math.min(89.9, st.el + dy * 0.5)),
        view: null,
      });
    }
    renderFace(node);
  });

  vp.addEventListener("pointerup", (e) => {
    if (drag && e.pointerId === drag.id) end();
  });
  vp.addEventListener("pointercancel", end);
  vp.addEventListener("lostpointercapture", end);
  vp.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  vp.addEventListener("dblclick", (e) => {
    e.preventDefault();
    e.stopPropagation();
    fitView(node);
    notifyGraphChanged();
  });
  // Over the view the wheel zooms the MODEL. It must stop here, before the
  // canvas-zoom passthrough on the root sees it; everywhere else on the node
  // the wheel still zooms the canvas (convention #17).
  vp.addEventListener("wheel", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (statusOf(node).status !== "ready") return;
    const st = readState(node);
    writeState(node, { zoom: st.zoom * Math.exp(-e.deltaY * 0.0015) });
    renderFace(node);
    clearTimeout(node._pixL3dWheelT);
    node._pixL3dWheelT = setTimeout(() => notifyGraphChanged(), 400);
  }, { passive: false });
}
