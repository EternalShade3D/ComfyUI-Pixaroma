// Save 3D Pixaroma - the node face.
//
// Conventions: #13 hover = accent border, #14 our own dark popup, #17 the view
// takes the wheel only after a click in Nodes 2.0, #20 drags with pointer capture
// AND the buttons-up guard, #27 the popup follows the canvas zoom, #28 a masked
// gear, #31 a drag or a typed commit calls notifyGraphChanged, #35 every fixed row
// declares flex-shrink 0, #37 the canvas never sizes its own box, #38 a prefix no
// other node uses (pix-s3d-).

import { app } from "/scripts/app.js";
import { pixAsset } from "../shared/api_url.mjs";
import { ACC, applyAccent } from "../shared/node_settings.mjs";
import { placeZoomedPopup } from "../shared/popup_zoom.mjs";
import { notifyGraphChanged } from "../shared/graph_changed.mjs";
import { isVueNodes } from "../shared/nodes2.mjs";
import { statusOf, requestDraw, animateView, panScale, drawBlocked } from "../load_3d/engine.mjs";
import {
  FORMATS, LOOKS, MODES, VIEWS, facesText, fileKey, formatText, inputsUnwired, readLastRun, readState,
  runInfo, turnsAfter, writeState,
} from "./core.mjs";
import { checkLine } from "./fix.mjs";

const ROOT = "pix-s3d-root";
export const VP_MIN = 160;

// The Save now + gear band floats up into the slot band, between the two input
// labels on the left and the output label on the right (CLAUDE.md #39). The
// offsets are PER RENDERER, read live, and are MEASURED against the dots: the
// band's middle sits on the middle of the two input rows. Classic, measured
// 2026-09-15: the root starts 56 below the node top and the rows are at 14 and
// 34, so the 34 tall band starts at 56 - 49 = 7 and its middle is at 24. Nodes
// 2.0, measured the same day against the DOM rows: -34 put the band 7 px low
// (middle 59 against the rows' 52), so -41.
const BAND_TOP = -49;
const BAND_TOP_VUE = -41;
const BAND_SIDE = 84;

const AXIS_COLOR = { x: "#f0605a", y: "#7fcf3a", z: "#4d9bff" };
const ICON_SAVE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M12 14.5l-4.2-4.2h3.2V4h2v6.3h3.2L12 14.5z" fill="currentColor"/><path d="M5 14.5V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_TURN = '<svg viewBox="0 0 16 16" width="11" height="11" fill="none"><path d="M13 8a5 5 0 1 1-1.5-3.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M13.4 2.2v3.4H10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

let _cssDone = false;

// This CSS lives in a JS template literal: a backtick anywhere inside it, even in
// a comment, ends the literal and blanks every node on the page (#35).
export function injectCSS() {
  if (_cssDone) return;
  _cssDone = true;
  const F = "ui-sans-serif,system-ui,sans-serif";
  const css = `
.${ROOT}{position:relative;box-sizing:border-box;width:100%;flex:1 1 0;min-height:0;color:#ddd;font:11px ${F};}
.${ROOT} .pix-s3d-inner{position:absolute;inset:0;box-sizing:border-box;display:flex;flex-direction:column;gap:6px;padding:2px 8px 8px;overflow:hidden;}
.${ROOT} .pix-s3d-inner > *{flex-shrink:0;}
.${ROOT} .pix-s3d-band{position:absolute;display:flex;gap:6px;align-items:stretch;z-index:3;}
.${ROOT} .pix-s3d-save{flex:1 1 auto;min-width:0;height:34px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:8px;padding:0 10px;margin:0;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:7px;color:${ACC};font:600 12px ${F};cursor:pointer;white-space:nowrap;overflow:hidden;transition:background .1s,border-color .1s,color .1s;}
.${ROOT} .pix-s3d-save .t{color:#dcdce0;transition:color .1s;overflow:hidden;text-overflow:ellipsis;}
.${ROOT} .pix-s3d-save:hover{background:${ACC};border-color:${ACC};color:#fff;}
.${ROOT} .pix-s3d-save:hover .t{color:#fff;}
.${ROOT} .pix-s3d-save.off{opacity:.5;}
.${ROOT} .pix-s3d-save.off:hover{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.14);color:${ACC};}
.${ROOT} .pix-s3d-save.off:hover .t{color:#dcdce0;}
.${ROOT} .pix-s3d-save.busy{opacity:.55;pointer-events:none;}
.${ROOT} .pix-s3d-save svg{display:block;flex:none;pointer-events:none;}
.${ROOT} .pix-s3d-gear{width:34px;height:34px;flex:0 0 auto;box-sizing:border-box;display:flex;align-items:center;justify-content:center;padding:0;margin:0;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:7px;cursor:pointer;color:#c2c2c8;transition:background .1s,border-color .1s;}
.${ROOT} .pix-s3d-gear::before{content:"";display:block;width:16px;height:16px;background:currentColor;-webkit-mask:url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat;mask:url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat;}
.${ROOT} .pix-s3d-gear:hover{background:${ACC};border-color:${ACC};color:#fff;}
.${ROOT} .pix-s3d-seg{display:flex;gap:3px;height:28px;box-sizing:border-box;background:rgba(0,0,0,.25);border-radius:6px;padding:3px;}
.${ROOT} .pix-s3d-seg button{flex:1 1 0;min-width:0;border:0;border-radius:4px;background:transparent;color:rgba(255,255,255,.72);font:600 12px ${F};cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 6px;}
.${ROOT} .pix-s3d-seg button:hover{background:rgba(255,255,255,.08);color:#eee;}
.${ROOT} .pix-s3d-seg button.on,.${ROOT} .pix-s3d-seg button.on:hover{background:${ACC};color:#fff;}
.${ROOT} .pix-s3d-vp{position:relative;flex:1 1 0;min-height:${VP_MIN}px;box-sizing:border-box;border:1px solid #444;border-radius:4px;overflow:hidden;background:#262626;cursor:grab;touch-action:none;}
.${ROOT} .pix-s3d-vp.dragging{cursor:grabbing;}
.${ROOT} .pix-s3d-vp canvas{position:absolute;inset:0;width:100%;height:100%;display:block;}
.${ROOT} .pix-s3d-msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:14px;box-sizing:border-box;color:#b0b0b0;font-size:11px;line-height:1.5;white-space:pre-line;pointer-events:none;}
.${ROOT} .pix-s3d-msg.bad{color:#e8826f;}
.${ROOT} .pix-s3d-chip{position:absolute;top:6px;right:6px;padding:2px 7px;border-radius:4px;background:rgba(0,0,0,.55);color:#ddd;font-size:10.5px;white-space:nowrap;pointer-events:none;}
.${ROOT} .pix-s3d-views{display:flex;gap:3px;height:24px;}
.${ROOT} .pix-s3d-views button{flex:1 1 0;min-width:0;box-sizing:border-box;margin:0;padding:0 2px;background:#1d1d1d;border:1px solid #444;border-radius:4px;color:#aaa;font:11px ${F};cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.${ROOT} .pix-s3d-views button:hover{border-color:${ACC};color:#ddd;}
.${ROOT} .pix-s3d-views button.on{background:${ACC};border-color:${ACC};color:#fff;}
.${ROOT} .pix-s3d-looks{display:flex;height:24px;box-sizing:border-box;background:#1d1d1d;border:1px solid #444;border-radius:4px;overflow:hidden;}
.${ROOT} .pix-s3d-looks button{flex:1 1 0;min-width:0;margin:0;border:0;padding:0 2px;background:transparent;color:#aaa;font:11px ${F};cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.${ROOT} .pix-s3d-looks button:hover{background:rgba(255,255,255,.08);color:#ddd;}
.${ROOT} .pix-s3d-looks button.on{background:${ACC};color:#fff;}
.${ROOT} .pix-s3d-fix{display:flex;gap:4px;height:26px;align-items:stretch;}
.${ROOT} .pix-s3d-turn{flex:0 0 38px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:3px;margin:0;padding:0;background:#1d1d1d;border:1px solid #444;border-radius:4px;color:#aaa;font:700 12px ${F};cursor:pointer;}
.${ROOT} .pix-s3d-turn svg{display:block;flex:none;pointer-events:none;}
.${ROOT} .pix-s3d-turn:hover{border-color:${ACC};color:#ddd;}
.${ROOT} .pix-s3d-sw{display:flex;align-items:center;gap:5px;flex:0 0 auto;background:none;border:0;margin:0;padding:0 3px;color:#cfcfcf;font:11px ${F};cursor:pointer;white-space:nowrap;}
.${ROOT} .pix-s3d-sw i{width:24px;height:13px;border-radius:8px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.18);position:relative;flex:none;box-sizing:border-box;}
.${ROOT} .pix-s3d-sw i::after{content:"";position:absolute;top:2px;left:2px;width:7px;height:7px;border-radius:50%;background:#bbb;transition:left .12s;}
.${ROOT} .pix-s3d-sw.on i{background:${ACC};border-color:${ACC};}
.${ROOT} .pix-s3d-sw.on i::after{left:13px;background:#fff;}
.${ROOT} .pix-s3d-sw:hover span{color:#fff;}
.${ROOT} .pix-s3d-reset{flex:0 0 auto;margin:0 0 0 auto;box-sizing:border-box;padding:0 8px;background:#1d1d1d;border:1px solid #444;border-radius:4px;color:#aaa;font:11px ${F};cursor:pointer;}
.${ROOT} .pix-s3d-reset:hover{border-color:${ACC};color:#ddd;}
.${ROOT} .pix-s3d-check{height:22px;box-sizing:border-box;display:flex;align-items:center;gap:7px;padding:0 9px;border-radius:5px;font:600 11px ${F};background:rgba(255,255,255,.04);color:#9a9a9a;border:1px solid rgba(255,255,255,.1);white-space:nowrap;overflow:hidden;}
.${ROOT} .pix-s3d-check::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor;flex:none;}
.${ROOT} .pix-s3d-check span{overflow:hidden;text-overflow:ellipsis;}
.${ROOT} .pix-s3d-check.good{background:rgba(62,195,113,.12);color:#3ec371;border-color:rgba(62,195,113,.35);}
.${ROOT} .pix-s3d-check.warn{background:rgba(230,178,58,.12);color:#e6b23a;border-color:rgba(230,178,58,.35);}
.${ROOT} .pix-s3d-out{display:flex;gap:5px;height:26px;}
.${ROOT} .pix-s3d-fld{flex:0 0 auto;min-width:132px;box-sizing:border-box;display:flex;align-items:center;gap:6px;background:#1d1d1d;border:1px solid #444;border-radius:4px;padding:0 8px;cursor:pointer;overflow:hidden;}
.${ROOT} .pix-s3d-fld:hover{border-color:${ACC};}
.${ROOT} .pix-s3d-k{color:${ACC};font-weight:700;font-size:10px;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap;}
.${ROOT} .pix-s3d-dd{margin-left:auto;color:#ddd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;}
.${ROOT} .pix-s3d-tri{color:${ACC};font-size:9px;flex:none;}
.${ROOT} .pix-s3d-name{flex:1 1 auto;min-width:0;box-sizing:border-box;display:flex;align-items:center;gap:6px;background:#1d1d1d;border:1px solid #444;border-radius:4px;padding:0 3px 0 8px;cursor:text;}
.${ROOT} .pix-s3d-name:focus-within{border-color:${ACC};}
.${ROOT} .pix-s3d-name input{flex:1 1 auto;min-width:0;width:40px;margin:0;padding:0;background:none;border:none;outline:none;color:#ddd;font:12px ${F};}
.${ROOT} .pix-s3d-info{min-height:22px;box-sizing:border-box;display:flex;align-items:center;background:rgba(0,0,0,.25);border-radius:4px;padding:4px 8px;font-size:11px;line-height:14px;color:#aaa;overflow:hidden;}
.${ROOT} .pix-s3d-info span{overflow:hidden;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;}
.${ROOT} .pix-s3d-info.bad{color:#e8826f;}
.pix-s3d-pop{position:fixed;z-index:10030;background:#1d1d1d;border:1px solid #444;border-radius:.4em;box-shadow:0 .6em 1.6em rgba(0,0,0,.55);padding:.25em;overflow-y:auto;font-family:${F};}
.pix-s3d-popitem{padding:.42em .75em;border-radius:.3em;color:#ddd;cursor:pointer;white-space:nowrap;font-size:1em;}
.pix-s3d-popitem small{margin-left:.9em;color:#8a8a8a;font-size:.85em;}
.pix-s3d-popitem:hover{background:#2a2a2a;}
.pix-s3d-popitem.on{color:var(--pix-acc,#f66744);font-weight:600;}
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

// ── the format popup ────────────────────────────────────────────────────────
let _pop = null;
let _popAnchor = null;

function popOutside(e) {
  if (!_pop || _pop.contains(e.target)) return;
  // A press on the field that opened it is left to that field's click, which closes it.
  if (_popAnchor && _popAnchor.contains(e.target)) return;
  closeFormatPopup();
}
function popKey(e) {
  if (e.key === "Escape" && _pop) {
    e.stopPropagation();
    closeFormatPopup();
  }
}
function popWheel(e) {
  // Zooming the canvas is a wheel event; a wheel INSIDE the list only scrolls it.
  if (_pop && !_pop.contains(e.target)) closeFormatPopup();
}

export function closeFormatPopup() {
  try { _pop?.remove(); } catch (_e) { /* already gone */ }
  _pop = null;
  _popAnchor = null;
  document.removeEventListener("pointerdown", popOutside, true);
  document.removeEventListener("keydown", popKey, true);
  document.removeEventListener("wheel", popWheel, true);
}

function openFormatPopup(node, anchor) {
  if (_pop && _popAnchor === anchor) {
    closeFormatPopup();
    return;
  }
  closeFormatPopup();
  const current = readState(node).format;
  const pop = el("div", "pix-s3d-pop");
  for (const f of FORMATS) {
    const item = el("div", "pix-s3d-popitem" + (f.value === current ? " on" : ""));
    item.append(el("span", null, f.label), el("small", null, f.title));
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      closeFormatPopup();
      writeState(node, { format: f.value });
      renderFace(node);
    });
    pop.appendChild(item);
  }
  document.body.appendChild(pop);
  applyAccent(pop, node);
  placeZoomedPopup(pop, anchor, { baseFontPx: 12, baseMaxHeightPx: 300 });
  _pop = pop;
  _popAnchor = anchor;
  setTimeout(() => {
    if (_pop !== pop) return;
    document.addEventListener("pointerdown", popOutside, true);
    document.addEventListener("keydown", popKey, true);
    document.addEventListener("wheel", popWheel, true);
  }, 0);
}

// ── the face ────────────────────────────────────────────────────────────────
export function buildFace(node, handlers) {
  injectCSS();
  const root = el("div", ROOT);

  const band = el("div", "pix-s3d-band");
  const save = btn("pix-s3d-save", null, "Copy the last preview file into the output folder now");
  save.innerHTML = ICON_SAVE + '<span class="t">Save now</span>';
  const gear = btn("pix-s3d-gear", null, "Save 3D settings");
  band.append(save, gear);
  root.appendChild(band);

  const inner = el("div", "pix-s3d-inner");
  root.appendChild(inner);

  const seg = el("div", "pix-s3d-seg");
  const modeBtns = {};
  for (const m of MODES) {
    const b = btn(null, m.label, m.tip);
    modeBtns[m.id] = b;
    seg.appendChild(b);
  }

  const vp = el("div", "pix-s3d-vp");
  const canvas = document.createElement("canvas");
  const msg = el("div", "pix-s3d-msg");
  const chip = el("div", "pix-s3d-chip");
  vp.append(canvas, msg, chip);

  const views = el("div", "pix-s3d-views");
  const viewBtns = {};
  for (const v of VIEWS) {
    const b = btn(null, v.label, v.tip);
    viewBtns[v.key] = b;
    views.appendChild(b);
  }
  const fit = btn(null, "Fit", "Frame the whole model again and keep the angle (double-clicking the view does the same)");
  views.appendChild(fit);

  const looks = el("div", "pix-s3d-looks");
  const lookBtns = {};
  for (const l of LOOKS) {
    const b = btn(null, l.label, l.tip);
    lookBtns[l.key] = b;
    looks.appendChild(b);
  }

  const fix = el("div", "pix-s3d-fix");
  const turnBtns = {};
  const TURN_TIPS = {
    x: "Turn X: tip the model forward a quarter turn (for a model lying on its back). Changes the saved file.",
    y: "Turn Y: spin the model a quarter turn, to choose which side faces the FRONT arrow. Changes the saved file.",
    z: "Turn Z: tip the model onto its side a quarter turn. Changes the saved file.",
  };
  for (const axis of ["x", "y", "z"]) {
    const b = btn("pix-s3d-turn", null, TURN_TIPS[axis]);
    b.innerHTML = ICON_TURN;
    const letter = el("span", null, axis.toUpperCase());
    letter.style.color = AXIS_COLOR[axis];
    b.appendChild(letter);
    turnBtns[axis] = b;
    fix.appendChild(b);
  }
  const center = switchBtn("Center", "Put the middle of the model over the middle of the floor. Changes the saved file.");
  const ground = switchBtn("On ground", "Stand the lowest point of the model on the floor. Changes the saved file.");
  const reset = btn("pix-s3d-reset", "Reset", "Undo the turns and switch Center and On ground back on");
  fix.append(center, ground, reset);

  const check = el("div", "pix-s3d-check");
  const checkText = el("span", null, "");
  check.appendChild(checkText);

  const out = el("div", "pix-s3d-out");
  const fmt = el("div", "pix-s3d-fld");
  fmt.title = "The file format. Auto keeps quads as OBJ and writes a model made of triangles as GLB.";
  const fmtValue = el("span", "pix-s3d-dd", "Auto");
  fmt.append(el("span", "pix-s3d-k", "Format"), fmtValue, el("span", "pix-s3d-tri", "▼"));
  const name = el("label", "pix-s3d-name");
  name.title = "The folder and file name inside the save folder (the output folder unless the gear names another), "
    + "for example 3d/gun. A counter is added, and date tokens such as %date:yyyy-MM-dd% work.";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.spellcheck = false;
  nameInput.autocomplete = "off";
  name.append(el("span", "pix-s3d-k", "Name"), nameInput);
  out.append(fmt, name);

  const info = el("div", "pix-s3d-info");
  const infoSpan = el("span", null, "");
  info.appendChild(infoSpan);

  inner.append(seg, vp, views, looks, fix, check, out, info);

  const els = {
    root, band, save, gear, modeBtns, vp, canvas, msg, chip, viewBtns, fit, lookBtns, turnBtns,
    center, ground, reset, check, checkText, fmt, fmtValue, nameInput, info, infoSpan,
  };
  node._pixS3dEls = els;
  wireFace(node, els, handlers || {});
  return root;
}

function switchBtn(label, title) {
  const sw = btn("pix-s3d-sw", null, title);
  sw.setAttribute("role", "switch");
  sw.append(el("i"), el("span", null, label));
  return sw;
}

/** Close the Format popup only when THIS node opened it; another node's popup stays open. */
export function closeFormatPopupFor(node) {
  if (_pop && _popAnchor && _popAnchor === node?._pixS3dEls?.fmt) closeFormatPopup();
}

export function destroyFace(node) {
  closeFormatPopupFor(node);
  clearTimeout(node._pixS3dFlashT);
  clearTimeout(node._pixS3dWheelT);
  node._pixS3dEls = null;
}

/** Float the band into the slot band. DOM style only, so it can never dirty a workflow. */
export function placeBand(node) {
  const band = node?._pixS3dEls?.band;
  if (!band) return;
  band.style.top = (isVueNodes() ? BAND_TOP_VUE : BAND_TOP) + "px";
  band.style.left = BAND_SIDE + "px";
  band.style.right = BAND_SIDE + "px";
}

/** The line under the Fix row, from where the preview puts the model. */
export function setCheckLine(node, flags) {
  const els = node?._pixS3dEls;
  if (!els) return;
  const line = flags ? checkLine(flags) : null;
  const text = line ? line.text : readLastRun(node) ? "Loading ..." : "Run the workflow to see where the model stands";
  if (els.checkText.textContent !== text) els.checkText.textContent = text;
  els.check.classList.toggle("good", line?.level === "good");
  els.check.classList.toggle("warn", line?.level === "warn");
  els.check.title = !line ? ""
    : line.level === "good" ? "The saved file will stand on the ground, centered."
      : "Where the model will sit in the saved file. Center and On ground fix it.";
}

export function renderFace(node) {
  const els = node?._pixS3dEls;
  if (!els) return;
  const st = readState(node);
  const run = readLastRun(node);

  for (const [id, b] of Object.entries(els.modeBtns)) b.classList.toggle("on", st.mode === id);
  for (const [k, b] of Object.entries(els.viewBtns)) b.classList.toggle("on", st.view === k);
  for (const [k, b] of Object.entries(els.lookBtns)) b.classList.toggle("on", st.look === k);
  for (const [sw, on] of [[els.center, st.center], [els.ground, st.ground]]) {
    sw.classList.toggle("on", on);
    sw.setAttribute("aria-checked", String(on));
  }
  els.fmtValue.textContent = formatText(st, run);
  if (document.activeElement !== els.nameInput) els.nameInput.value = st.name;

  const temp = run?.file?.type === "temp";
  const same = !!run && run.sent === fileKey(st);
  const canSave = !!run && temp && same;
  els.save.classList.toggle("off", !canSave);
  els.save.title = !run ? "Run the workflow first; Save now then copies its file into the save folder"
    : !temp ? `This run already saved ${run.file?.filename || "its file"}`
      : !same ? "The Fix or the format changed since the last run: run again, then Save now"
        : "Copy the last preview file into the save folder now (the output folder unless the gear names another)";

  const s = statusOf(node);
  let msg = "";
  let bad = false;
  if (!run) {
    msg = inputsUnwired(node) ? "Wire in a mesh or a model_3d,\nthen run the workflow." : "Run the workflow to see the model here.";
  } else if (s.status === "error") {
    msg = `Could not open the file:\n${s.error}`;
    bad = true;
  } else if (s.status !== "ready") {
    msg = "Loading ...";
  } else if (drawBlocked(node)) {
    // Loaded, but the browser would not draw it (engine.mjs markBlocked): it retries on its own.
    msg = "The browser stopped drawing 3D views.\nRefresh the page (F5) if the model does not come back.";
    bad = true;
  }
  els.msg.textContent = msg;
  els.msg.classList.toggle("bad", bad);
  els.msg.style.display = msg ? "" : "none";
  els.chip.textContent = run ? facesText(run.faces) : "";
  els.chip.style.display = run && s.status === "ready" ? "" : "none";
  // Until the file has loaded nothing has drawn, and the line would sit empty: say Loading.
  if (!run || (s.status !== "ready" && s.status !== "error")) setCheckLine(node, null);

  let line = run ? runInfo(run) : "No run yet";
  let lineBad = false;
  if (node._pixS3dFlash) {
    line = node._pixS3dFlash;
    lineBad = !!node._pixS3dFlashBad;
  }
  els.infoSpan.textContent = line;
  els.info.classList.toggle("bad", lineBad);
  els.info.title = [line, ...(run?.notes || [])].join("\n");
  requestDraw(node);
}

/** A temporary message on the bottom line. */
export function flash(node, text, bad = false, ms = 5000) {
  clearTimeout(node._pixS3dFlashT);
  node._pixS3dFlash = text || "";
  node._pixS3dFlashBad = !!bad;
  renderFace(node);
  if (text && ms > 0) {
    node._pixS3dFlashT = setTimeout(() => {
      node._pixS3dFlash = "";
      node._pixS3dFlashBad = false;
      renderFace(node);
    }, ms);
  }
}

function changeFix(node, patch) {
  writeState(node, patch);
  renderFace(node);
}

function wireFace(node, els, handlers) {
  els.save.addEventListener("click", () => handlers.saveNow?.(node));
  els.gear.addEventListener("click", () => handlers.openSettings?.(node));
  for (const m of MODES) {
    els.modeBtns[m.id].addEventListener("click", () => {
      if (readState(node).mode === m.id) return;
      writeState(node, { mode: m.id });
      renderFace(node);
    });
  }
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
  for (const axis of ["x", "y", "z"]) {
    els.turnBtns[axis].addEventListener("click", () => changeFix(node, { turns: turnsAfter(readState(node).turns, axis) }));
  }
  els.center.addEventListener("click", () => changeFix(node, { center: !readState(node).center }));
  els.ground.addEventListener("click", () => changeFix(node, { ground: !readState(node).ground }));
  els.reset.addEventListener("click", () => changeFix(node, { turns: [], center: true, ground: true }));
  els.fmt.addEventListener("click", (e) => {
    e.stopPropagation();
    openFormatPopup(node, els.fmt);
  });

  const commitName = () => {
    const v = String(els.nameInput.value || "").trim();
    if (v !== readState(node).name) {
      writeState(node, { name: v });
      renderFace(node);
    }
  };
  els.nameInput.addEventListener("change", commitName);
  els.nameInput.addEventListener("keydown", (e) => {
    // Keep ComfyUI's own shortcuts (Delete removes the node!) out of the field.
    e.stopPropagation();
    if (e.key === "Enter" || e.keyCode === 13) {
      e.preventDefault();
      commitName();
      els.nameInput.blur();
      notifyGraphChanged();
    }
  });

  wireViewport(node, els);
}

export function fitView(node) {
  writeState(node, { zoom: 1, panX: 0, panY: 0 });
  renderFace(node);
}

function canvasZoom() {
  const s = app.canvas?.ds?.scale;
  return Number.isFinite(s) && s > 0 ? s : 1;
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

  // Nodes 2.0 forwards every wheel over node content to the canvas unless the
  // target sits inside data-capture-wheel="true" AND focus is inside it, the same
  // as core's own 3D view: click the view, then the wheel zooms the model.
  vp.tabIndex = -1;
  vp.dataset.captureWheel = "true";
  vp.style.outline = "none";

  vp.addEventListener("pointerdown", (e) => {
    if (e.button > 2) return;
    e.preventDefault();
    e.stopPropagation();
    try { vp.focus({ preventScroll: true }); } catch (_e) { /* not focusable */ }
    if (statusOf(node).status !== "ready") return;
    const pan = e.button !== 0 || e.shiftKey;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, pan, moved: false };
    try { vp.setPointerCapture(e.pointerId); } catch (_e) { /* old browser */ }
    vp.classList.add("dragging");
  });

  vp.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    // The release can go missing (off the window, another capture): stop, or the
    // view keeps following the cursor with no button held (#20).
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
      writeState(node, { panX: st.panX - (dx * unitsPerPx) / radius, panY: st.panY + (dy * unitsPerPx) / radius });
    } else {
      writeState(node, { az: st.az - dx * 0.5, el: Math.max(-89.9, Math.min(89.9, st.el + dy * 0.5)), view: null });
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
  // Over the view the wheel zooms the MODEL. It stops here, before the root's
  // canvas-zoom passthrough sees it; elsewhere on the node it zooms the canvas.
  vp.addEventListener("wheel", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (statusOf(node).status !== "ready") return;
    const st = readState(node);
    writeState(node, { zoom: st.zoom * Math.exp(-e.deltaY * 0.0015) });
    renderFace(node);
    clearTimeout(node._pixS3dWheelT);
    node._pixS3dWheelT = setTimeout(() => notifyGraphChanged(), 400);
  }, { passive: false });
}
