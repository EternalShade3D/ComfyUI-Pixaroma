// Hard Surface Pixaroma - the node face.
//
// Built from Save 3D's face (js/save_3d/ui.mjs, .claude/patterns/save-3d.md). Conventions: #13 hover =
// accent border, #17 the view takes the wheel only after a click in Nodes 2.0, #20 drags with pointer
// capture AND the buttons-up guard, #28 a masked gear, #31 a drag calls notifyGraphChanged, #35 every
// fixed row declares flex-shrink 0, #37 the canvas never sizes its own box, #38 a prefix no other node
// uses (pix-hsurf-).

import { app } from "/scripts/app.js";
import { pixAsset } from "../shared/api_url.mjs";
import { ACC } from "../shared/node_settings.mjs";
import { notifyGraphChanged } from "../shared/graph_changed.mjs";
import { isVueNodes } from "../shared/nodes2.mjs";
import { statusOf, requestDraw, animateView, panScale } from "../load_3d/engine.mjs";
import {
  LOOKS, SHOWS, STRENGTHS, VIEWS, facesText, inputsUnwired, readLastRun, readState, runInfo, runIsStale,
  writeState,
} from "./core.mjs";

const ROOT = "pix-hsurf-root";
export const VP_MIN = 160;

// The Before / After switch and the gear float up into the slot band, between the two input labels on
// the left and the three output labels on the right (CLAUDE.md #39). The offsets are PER RENDERER, read
// live, and MEASURED against the dots at 2x zoom (2026-09-15): the band's middle sits on the middle
// output row. Classic: the root starts 76 below the node top and the rows are at 14, 34 and 54, so the
// 34 tall band starts at 76 - 59 = 17 and its middle is at 34 (0 px off), 94 in from each side with the
// 53 px labels ending about 23 px short of it. Nodes 2.0: 0 px off the model_3d rows, about 10 px clear
// of the labels on both sides.
const BAND_TOP = -59;
const BAND_TOP_VUE = -51;
const BAND_SIDE = 84;

let _cssDone = false;

// This CSS lives in a JS template literal: a backtick anywhere inside it, even in a comment, ends the
// literal and blanks every node on the page (#35).
export function injectCSS() {
  if (_cssDone) return;
  _cssDone = true;
  const F = "ui-sans-serif,system-ui,sans-serif";
  const css = `
.${ROOT}{position:relative;box-sizing:border-box;width:100%;flex:1 1 0;min-height:0;color:#ddd;font:11px ${F};}
.${ROOT} .pix-hsurf-inner{position:absolute;inset:0;box-sizing:border-box;display:flex;flex-direction:column;gap:6px;padding:2px 8px 8px;overflow:hidden;}
.${ROOT} .pix-hsurf-inner > *{flex-shrink:0;}
.${ROOT} .pix-hsurf-band{position:absolute;display:flex;gap:6px;align-items:stretch;z-index:3;}
.${ROOT} .pix-hsurf-show{flex:1 1 auto;min-width:0;display:flex;gap:3px;height:34px;box-sizing:border-box;background:rgba(0,0,0,.25);border-radius:7px;padding:3px;}
.${ROOT} .pix-hsurf-show button{flex:1 1 0;min-width:0;border:0;border-radius:5px;background:transparent;color:rgba(255,255,255,.72);font:600 12px ${F};cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 6px;}
.${ROOT} .pix-hsurf-show button:hover{background:rgba(255,255,255,.08);color:#eee;}
.${ROOT} .pix-hsurf-show button.on,.${ROOT} .pix-hsurf-show button.on:hover{background:${ACC};color:#fff;}
.${ROOT} .pix-hsurf-gear{width:34px;height:34px;flex:0 0 auto;box-sizing:border-box;display:flex;align-items:center;justify-content:center;padding:0;margin:0;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:7px;cursor:pointer;color:#c2c2c8;transition:background .1s,border-color .1s;}
.${ROOT} .pix-hsurf-gear::before{content:"";display:block;width:16px;height:16px;background:currentColor;-webkit-mask:url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat;mask:url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat;}
.${ROOT} .pix-hsurf-gear:hover{background:${ACC};border-color:${ACC};color:#fff;}
.${ROOT} .pix-hsurf-row{display:flex;align-items:center;gap:8px;height:28px;}
.${ROOT} .pix-hsurf-k{flex:0 0 auto;color:${ACC};font-weight:700;font-size:10px;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap;}
.${ROOT} .pix-hsurf-seg{flex:1 1 auto;min-width:0;display:flex;gap:3px;height:28px;box-sizing:border-box;background:rgba(0,0,0,.25);border-radius:6px;padding:3px;}
.${ROOT} .pix-hsurf-seg button{flex:1 1 0;min-width:0;border:0;border-radius:4px;background:transparent;color:rgba(255,255,255,.72);font:600 12px ${F};cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 6px;}
.${ROOT} .pix-hsurf-seg button:hover{background:rgba(255,255,255,.08);color:#eee;}
.${ROOT} .pix-hsurf-seg button.on,.${ROOT} .pix-hsurf-seg button.on:hover{background:${ACC};color:#fff;}
.${ROOT} .pix-hsurf-vp{position:relative;flex:1 1 0;min-height:${VP_MIN}px;box-sizing:border-box;border:1px solid #444;border-radius:4px;overflow:hidden;background:#262626;cursor:grab;touch-action:none;}
.${ROOT} .pix-hsurf-vp.dragging{cursor:grabbing;}
.${ROOT} .pix-hsurf-vp canvas{position:absolute;inset:0;width:100%;height:100%;display:block;}
.${ROOT} .pix-hsurf-msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:14px;box-sizing:border-box;color:#b0b0b0;font-size:11px;line-height:1.5;white-space:pre-line;pointer-events:none;}
.${ROOT} .pix-hsurf-msg.bad{color:#e8826f;}
.${ROOT} .pix-hsurf-chip{position:absolute;top:6px;right:6px;padding:2px 7px;border-radius:4px;background:rgba(0,0,0,.55);color:#ddd;font-size:10.5px;white-space:nowrap;pointer-events:none;}
.${ROOT} .pix-hsurf-views{display:flex;gap:3px;height:24px;}
.${ROOT} .pix-hsurf-views button{flex:1 1 0;min-width:0;box-sizing:border-box;margin:0;padding:0 2px;background:#1d1d1d;border:1px solid #444;border-radius:4px;color:#aaa;font:11px ${F};cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.${ROOT} .pix-hsurf-views button:hover{border-color:${ACC};color:#ddd;}
.${ROOT} .pix-hsurf-views button.on{background:${ACC};border-color:${ACC};color:#fff;}
.${ROOT} .pix-hsurf-looks{display:flex;height:24px;box-sizing:border-box;background:#1d1d1d;border:1px solid #444;border-radius:4px;overflow:hidden;}
.${ROOT} .pix-hsurf-looks button{flex:1 1 0;min-width:0;margin:0;border:0;padding:0 2px;background:transparent;color:#aaa;font:11px ${F};cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.${ROOT} .pix-hsurf-looks button:hover{background:rgba(255,255,255,.08);color:#ddd;}
.${ROOT} .pix-hsurf-looks button.on{background:${ACC};color:#fff;}
.${ROOT} .pix-hsurf-opts{display:flex;align-items:center;gap:10px;height:26px;min-width:0;}
.${ROOT} .pix-hsurf-sw{display:flex;align-items:center;gap:6px;flex:0 0 auto;background:none;border:0;margin:0;padding:0 3px;color:#cfcfcf;font:11px ${F};cursor:pointer;white-space:nowrap;}
.${ROOT} .pix-hsurf-sw i{width:24px;height:13px;border-radius:8px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.18);position:relative;flex:none;box-sizing:border-box;}
.${ROOT} .pix-hsurf-sw i::after{content:"";position:absolute;top:2px;left:2px;width:7px;height:7px;border-radius:50%;background:#bbb;transition:left .12s;}
.${ROOT} .pix-hsurf-sw.on i{background:${ACC};border-color:${ACC};}
.${ROOT} .pix-hsurf-sw.on i::after{left:13px;background:#fff;}
.${ROOT} .pix-hsurf-sw:hover span{color:#fff;}
.${ROOT} .pix-hsurf-stale{margin-left:auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e6b23a;font:600 11px ${F};}
.${ROOT} .pix-hsurf-info{height:22px;box-sizing:border-box;display:flex;align-items:center;background:rgba(0,0,0,.25);border-radius:4px;padding:0 8px;font-size:11px;color:#aaa;white-space:nowrap;overflow:hidden;}
.${ROOT} .pix-hsurf-info span{overflow:hidden;text-overflow:ellipsis;}
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

function switchBtn(label, title) {
  const sw = btn("pix-hsurf-sw", null, title);
  sw.setAttribute("role", "switch");
  sw.append(el("i"), el("span", null, label));
  return sw;
}

// ── the face ────────────────────────────────────────────────────────────────
export function buildFace(node, handlers) {
  injectCSS();
  const root = el("div", ROOT);

  const band = el("div", "pix-hsurf-band");
  const show = el("div", "pix-hsurf-show");
  const showBtns = {};
  for (const s of SHOWS) {
    const b = btn(null, s.label, s.tip);
    showBtns[s.id] = b;
    show.appendChild(b);
  }
  const gear = btn("pix-hsurf-gear", null, "Hard Surface settings");
  band.append(show, gear);
  root.appendChild(band);

  const inner = el("div", "pix-hsurf-inner");
  root.appendChild(inner);

  const sharpen = el("div", "pix-hsurf-row");
  const seg = el("div", "pix-hsurf-seg");
  const strengthBtns = {};
  for (const s of STRENGTHS) {
    const b = btn(null, s.label, s.tip);
    strengthBtns[s.id] = b;
    seg.appendChild(b);
  }
  const sharpenLabel = el("span", "pix-hsurf-k", "Sharpen");
  sharpenLabel.title = "How far a vertex may move to make the edges crisp and the flat panels flat. Changes the result.";
  sharpen.append(sharpenLabel, seg);

  const vp = el("div", "pix-hsurf-vp");
  const canvas = document.createElement("canvas");
  const msg = el("div", "pix-hsurf-msg");
  const chip = el("div", "pix-hsurf-chip");
  vp.append(canvas, msg, chip);

  const views = el("div", "pix-hsurf-views");
  const viewBtns = {};
  for (const v of VIEWS) {
    const b = btn(null, v.label, v.tip);
    viewBtns[v.key] = b;
    views.appendChild(b);
  }
  const fit = btn(null, "Fit", "Frame the whole model again and keep the angle (double-clicking the view does the same)");
  views.appendChild(fit);

  const looks = el("div", "pix-hsurf-looks");
  const lookBtns = {};
  for (const l of LOOKS) {
    const b = btn(null, l.label, l.tip);
    lookBtns[l.key] = b;
    looks.appendChild(b);
  }

  const opts = el("div", "pix-hsurf-opts");
  const keepRound = switchBtn("Keep round", "Leave curved parts (grips, barrels, knobs) round. Off flattens them into facets. "
    + "Changes the result.");
  const stale = el("span", "pix-hsurf-stale", "");
  opts.append(keepRound, stale);

  const info = el("div", "pix-hsurf-info");
  const infoSpan = el("span", null, "");
  info.appendChild(infoSpan);

  inner.append(sharpen, vp, views, looks, opts, info);

  const els = {
    root, band, gear, showBtns, strengthBtns, vp, canvas, msg, chip, viewBtns, fit, lookBtns, keepRound, stale,
    info, infoSpan,
  };
  node._pixHsEls = els;
  wireFace(node, els, handlers || {});
  return root;
}

export function destroyFace(node) {
  clearTimeout(node._pixHsWheelT);
  node._pixHsEls = null;
}

/** Float the band into the slot band. DOM style only, so it can never dirty a workflow. */
export function placeBand(node) {
  const band = node?._pixHsEls?.band;
  if (!band) return;
  band.style.top = (isVueNodes() ? BAND_TOP_VUE : BAND_TOP) + "px";
  band.style.left = BAND_SIDE + "px";
  band.style.right = BAND_SIDE + "px";
}

export function renderFace(node) {
  const els = node?._pixHsEls;
  if (!els) return;
  const st = readState(node);
  const run = readLastRun(node);

  for (const [id, b] of Object.entries(els.showBtns)) b.classList.toggle("on", st.show === id);
  for (const [id, b] of Object.entries(els.strengthBtns)) b.classList.toggle("on", st.strength === id);
  for (const [k, b] of Object.entries(els.viewBtns)) b.classList.toggle("on", st.view === k);
  for (const [k, b] of Object.entries(els.lookBtns)) b.classList.toggle("on", st.look === k);
  els.keepRound.classList.toggle("on", st.keepRound);
  els.keepRound.setAttribute("aria-checked", String(st.keepRound));

  const stale = runIsStale(node);
  els.stale.textContent = stale ? "Settings changed: run again" : "";
  els.stale.title = stale ? "The model on the node was made with other settings. Run the workflow to see these." : "";

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
  }
  els.msg.textContent = msg;
  els.msg.classList.toggle("bad", bad);
  els.msg.style.display = msg ? "" : "none";
  const which = SHOWS.find((x) => x.id === st.show)?.label || "";
  els.chip.textContent = run ? [which, facesText(run.faces)].filter(Boolean).join(" · ") : "";
  els.chip.style.display = run && s.status === "ready" ? "" : "none";

  const line = run ? runInfo(run) : "No run yet";
  els.infoSpan.textContent = line;
  els.info.title = run?.lines?.length ? run.lines.join("\n") : line;
  requestDraw(node);
}

function wireFace(node, els, handlers) {
  els.gear.addEventListener("click", () => handlers.openSettings?.(node));
  for (const s of SHOWS) {
    els.showBtns[s.id].addEventListener("click", () => {
      if (readState(node).show === s.id) return;
      writeState(node, { show: s.id });
      handlers.showChanged?.(node);
    });
  }
  for (const s of STRENGTHS) {
    els.strengthBtns[s.id].addEventListener("click", () => {
      if (readState(node).strength === s.id) return;
      writeState(node, { strength: s.id });
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
  els.keepRound.addEventListener("click", () => {
    writeState(node, { keepRound: !readState(node).keepRound });
    renderFace(node);
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

  // Nodes 2.0 forwards every wheel over node content to the canvas unless the target sits inside
  // data-capture-wheel="true" AND focus is inside it, the same as core's own 3D view: click the view,
  // then the wheel zooms the model.
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
    // The release can go missing (off the window, another capture): stop, or the view keeps
    // following the cursor with no button held (#20).
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
  // Over the view the wheel zooms the MODEL. It stops here, before the root's canvas-zoom passthrough
  // sees it; elsewhere on the node it zooms the canvas.
  vp.addEventListener("wheel", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (statusOf(node).status !== "ready") return;
    const st = readState(node);
    writeState(node, { zoom: st.zoom * Math.exp(-e.deltaY * 0.0015) });
    renderFace(node);
    clearTimeout(node._pixHsWheelT);
    node._pixHsWheelT = setTimeout(() => notifyGraphChanged(), 400);
  }, { passive: false });
}
