// Mesh Repair Pixaroma - the node face.
//
// One DOM widget serves both renderers. The layout lives on an INNER in-flow
// flex column, never on the addDOMWidget root: ComfyUI rewrites the root's
// display on rebuild and collapse (nodes2-preview-fill.md), and an in-flow inner
// keeps the root's content height real, which the fixed-height face needs.
//
// Rows, top to bottom: the mode switch + gear, Detail (Make solid only), the
// seal and loose-bit dropdowns, two switches, the cut through the model, the
// before/after report and a status line.

import { pixApiUrl, pixAsset } from "../shared/api_url.mjs";
import { applyAdaptiveCanvasOnly, isVueNodes } from "../shared/nodes2.mjs";
import { installCanvasZoomPassthrough } from "../shared/canvas_zoom.mjs";
import { ACC, applyAccent, installNodeAccent } from "../shared/node_settings.mjs";
import { installResizeFloor } from "../shared/resize_floor.mjs";
import { placeZoomedPopup } from "../shared/popup_zoom.mjs";
import {
  CHIPS_H, DETAILS, FIELD_H, GAP, HINT_H, LABEL_H, LOOSE, MODES, PAD_X, PAD_Y, PREVIEW_H,
  REPORT_PAD, REPORT_ROW_H, ROW_H, SEALS, STATUS_H, SWITCH_H, VUE_GAP_CANCEL,
  contentHeight, formatCount, hintPrintMm, optionLabel, readReport, readState, writeState,
} from "./core.mjs";

const ROOT_CLASS = "pix-mrep-root";
const WIDGET_NAME = "mesh_repair_ui";
// Namespaced, so a registered Vue widget type can never claim it (the Show Text bug).
const WIDGET_TYPE = "pixaroma_mesh_repair";

let _cssDone = false;

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

export function injectCSS() {
  if (_cssDone) return;
  _cssDone = true;
  const css = `
  .${ROOT_CLASS}{ position:relative; box-sizing:border-box; background:transparent; user-select:none; }
  .${ROOT_CLASS}.is-vue{ margin-top:-${VUE_GAP_CANCEL}px; }
  .pix-mrep-inner{
    display:flex; flex-direction:column; gap:${GAP}px; padding:${PAD_Y}px ${PAD_X}px;
    box-sizing:border-box; font:12px 'Segoe UI',sans-serif; color:#ddd;
  }
  .pix-mrep-inner > *{ flex:0 0 auto; box-sizing:border-box; }

  .pix-mrep-row{ display:flex; align-items:center; gap:6px; height:${ROW_H}px; }
  .pix-mrep-seg{ display:flex; gap:3px; flex:1 1 auto; min-width:0; background:rgba(0,0,0,.25); border-radius:6px; padding:3px; height:100%; box-sizing:border-box; }
  .pix-mrep-seg button{
    flex:1 1 0; min-width:0; border:0; border-radius:4px; background:transparent; color:rgba(255,255,255,.72);
    font:600 12px 'Segoe UI',sans-serif; cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; padding:0 6px;
  }
  .pix-mrep-seg button:hover{ background:rgba(255,255,255,.08); color:#eee; }
  .pix-mrep-seg button.on, .pix-mrep-seg button.on:hover{ background:${ACC}; color:#fff; }

  .pix-mrep-gear{ flex:none; width:18px; height:18px; padding:0; margin:0; line-height:0; background:none; border:none; cursor:pointer; }
  .pix-mrep-gear::before{
    content:""; display:block; width:15px; height:15px; background:#bbb;
    -webkit-mask:url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat;
    mask:url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat;
  }
  .pix-mrep-gear:hover::before{ background:${ACC}; }

  .pix-mrep-lbl{ height:${LABEL_H}px; line-height:${LABEL_H}px; color:${ACC}; font-weight:700; font-size:10.5px; letter-spacing:.05em; text-transform:uppercase; }
  .pix-mrep-chips{ display:flex; gap:5px; height:${CHIPS_H}px; }
  .pix-mrep-chip{
    flex:1 1 0; min-width:0; border:1px solid #444; background:#1d1d1d; color:#ccc; border-radius:5px;
    font:600 12px 'Segoe UI',sans-serif; cursor:pointer; line-height:1.15; padding:2px 2px; overflow:hidden;
  }
  .pix-mrep-chip small{ display:block; font-weight:400; font-size:10.5px; color:#8a8a8a; }
  .pix-mrep-chip:hover{ border-color:${ACC}; color:#ddd; }
  .pix-mrep-chip.on, .pix-mrep-chip.on:hover{ background:${ACC}; border-color:${ACC}; color:#fff; }
  .pix-mrep-chip.on small{ color:rgba(255,255,255,.8); }
  .pix-mrep-hint{ height:${HINT_H}px; line-height:${HINT_H}px; color:#9a9a9a; font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

  .pix-mrep-fld{
    display:flex; align-items:center; gap:8px; height:${FIELD_H}px; background:#1d1d1d; border:1px solid #444;
    border-radius:4px; padding-left:9px; cursor:pointer; overflow:hidden;
  }
  .pix-mrep-fld:hover{ border-color:${ACC}; }
  .pix-mrep-k{ color:${ACC}; font-weight:700; font-size:10.5px; letter-spacing:.04em; text-transform:uppercase; white-space:nowrap; }
  .pix-mrep-dd{ margin-left:auto; color:#ddd; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
  .pix-mrep-tri{ color:${ACC}; font-size:9px; }
  .pix-mrep-arr{
    align-self:stretch; width:22px; flex:none; border:0; border-left:1px solid #3a3a3a; background:transparent;
    color:${ACC}; font-size:9px; cursor:pointer; padding:0;
  }
  .pix-mrep-arr:hover{ background:rgba(255,255,255,.07); }

  .pix-mrep-sws{ display:flex; gap:14px; height:${SWITCH_H}px; align-items:center; }
  .pix-mrep-sw{
    display:flex; align-items:center; gap:7px; background:none; border:0; padding:0; color:#cfcfcf;
    font:12px 'Segoe UI',sans-serif; cursor:pointer; white-space:nowrap;
  }
  .pix-mrep-sw i{ width:26px; height:14px; border-radius:8px; background:rgba(255,255,255,.14); border:1px solid rgba(255,255,255,.18); position:relative; flex:none; box-sizing:border-box; }
  .pix-mrep-sw i::after{ content:""; position:absolute; top:2px; left:2px; width:8px; height:8px; border-radius:50%; background:#bbb; transition:left .12s; }
  .pix-mrep-sw.on i{ background:${ACC}; border-color:${ACC}; }
  .pix-mrep-sw.on i::after{ left:14px; background:#fff; }
  .pix-mrep-sw:hover span{ color:#fff; }

  .pix-mrep-cut{ position:relative; height:${PREVIEW_H}px; background:#1b1b1b; border:1px solid #3a3a3a; border-radius:6px; overflow:hidden; }
  .pix-mrep-cutimg{
    position:absolute; left:10px; right:10px; top:30px; bottom:22px; background:${ACC};
    -webkit-mask-repeat:no-repeat; mask-repeat:no-repeat; -webkit-mask-position:center; mask-position:center;
    -webkit-mask-size:contain; mask-size:contain;
  }
  .pix-mrep-cutempty{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center; text-align:center; padding:0 18px; color:#8f8f8f; font-size:11.5px; line-height:1.45; }
  .pix-mrep-cutcap{ position:absolute; left:8px; bottom:4px; font-size:10.5px; color:#9a9a9a; white-space:nowrap; }
  .pix-mrep-cutseg{ position:absolute; top:5px; right:5px; display:flex; gap:2px; background:rgba(0,0,0,.6); border-radius:5px; padding:2px; }
  .pix-mrep-cutseg button{ border:0; border-radius:3px; background:transparent; color:#aaa; font:600 11px 'Segoe UI',sans-serif; padding:2px 7px; cursor:pointer; }
  .pix-mrep-cutseg button:hover{ color:#fff; }
  .pix-mrep-cutseg button.on{ background:${ACC}; color:#fff; }

  .pix-mrep-rep{ background:#2d2d2d; border:1px solid #3a3a3a; border-radius:6px; padding:${REPORT_PAD / 2 - 1}px 9px; font-size:12px; }
  .pix-mrep-r{ display:flex; align-items:center; gap:6px; height:${REPORT_ROW_H}px; }
  .pix-mrep-rk{ flex:1 1 auto; color:#bdbdbd; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
  .pix-mrep-rb{ color:#9a9a9a; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .pix-mrep-rb.bad{ color:#e98a84; }
  .pix-mrep-ra{ color:#777; }
  .pix-mrep-rv{ min-width:64px; text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; color:#ccc; }
  .pix-mrep-rv.good{ color:#3ec371; }
  .pix-mrep-rv.bad{ color:#e6b23a; }

  .pix-mrep-stat{
    display:flex; align-items:center; gap:8px; height:${STATUS_H}px; padding:0 10px; border-radius:6px;
    font-weight:700; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    background:rgba(255,255,255,.04); color:#9a9a9a; border:1px solid rgba(255,255,255,.1);
  }
  .pix-mrep-stat::before{ content:""; width:8px; height:8px; border-radius:50%; background:currentColor; flex:none; }
  .pix-mrep-stat span{ overflow:hidden; text-overflow:ellipsis; }
  .pix-mrep-stat.good{ background:rgba(62,195,113,.12); color:#3ec371; border-color:rgba(62,195,113,.35); }
  .pix-mrep-stat.warn{ background:rgba(230,178,58,.12); color:#e6b23a; border-color:rgba(230,178,58,.35); }
  .pix-mrep-stat.dim{ opacity:.65; }

  .pix-mrep-pop{
    position:fixed; z-index:10030; background:#1d1d1d; border:1px solid #444; border-radius:.4em;
    box-shadow:0 .6em 1.6em rgba(0,0,0,.55); padding:.25em; overflow-y:auto; font-family:'Segoe UI',sans-serif;
  }
  .pix-mrep-popitem{ padding:.42em .75em; border-radius:.3em; color:#ddd; cursor:pointer; white-space:nowrap; }
  .pix-mrep-popitem:hover{ background:#2a2a2a; }
  .pix-mrep-popitem.on{ color:var(--pix-acc,#f66744); font-weight:600; }
  `;
  const style = document.createElement("style");
  style.id = "pix-mrep-css";
  style.textContent = css;
  document.head.appendChild(style);
}

// ── the option popup (shared with the settings panel) ──────────────────────
let _pop = null;
let _popAnchor = null;

function popOutside(e) {
  if (!_pop) return;
  if (_pop.contains(e.target)) return;
  if (_popAnchor && _popAnchor.contains(e.target)) return;
  closeOptionPopup();
}
function popKey(e) {
  if (e.key === "Escape" && _pop) {
    e.stopPropagation();
    closeOptionPopup();
  }
}
function popWheel(e) {
  // Zooming the canvas is a wheel event, and a list left behind in mid-air
  // points at nothing. A wheel INSIDE the list only scrolls it.
  if (_pop && !_pop.contains(e.target)) closeOptionPopup();
}

export function closeOptionPopup() {
  if (_pop) {
    try { _pop.remove(); } catch {}
  }
  _pop = null;
  _popAnchor = null;
  document.removeEventListener("pointerdown", popOutside, true);
  document.removeEventListener("keydown", popKey, true);
  document.removeEventListener("wheel", popWheel, true);
}

export function isOptionPopupOpenFor(anchor) {
  return !!_pop && _popAnchor === anchor;
}

export function openOptionPopup(node, anchor, options, current, onPick) {
  if (isOptionPopupOpenFor(anchor)) {
    closeOptionPopup();
    return;
  }
  closeOptionPopup();
  const pop = el("div", "pix-mrep-pop");
  for (const opt of options) {
    const item = el("div", "pix-mrep-popitem" + (opt.value === current ? " on" : ""), opt.label);
    if (opt.title) item.title = opt.title;
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      closeOptionPopup();
      onPick(opt.value);
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

// ── building the face ──────────────────────────────────────────────────────

export function buildFace(node, { openPanel, onChange }) {
  const root = el("div", ROOT_CLASS);
  const inner = el("div", "pix-mrep-inner");
  root.appendChild(inner);
  node._pixMrRoot = root;
  node._pixMrInner = inner;
  node._pixMrOpenPanel = openPanel;
  node._pixMrOnChange = onChange;

  const widget = node.addDOMWidget(WIDGET_NAME, WIDGET_TYPE, root, {
    serialize: false,
    getMinHeight: () => contentHeight(readState(node).mode),
  });
  // Two different flags: options.serialize keeps it out of the PROMPT, the
  // top-level one keeps it out of the saved WORKFLOW (widgets_values).
  widget.serialize = false;
  applyAdaptiveCanvasOnly(widget);
  installCanvasZoomPassthrough(root);
  installNodeAccent(node, root);
  node._pixMrFloorOff = installResizeFloor(root, () => contentHeight(readState(node).mode));
  node._pixMrWidget = widget;
  return widget;
}

function changed(node, patch) {
  writeState(node, patch);
  if (typeof node._pixMrOnChange === "function") node._pixMrOnChange(node);
  else renderFace(node);
}

function modeRow(node, st) {
  const row = el("div", "pix-mrep-row");
  const seg = el("div", "pix-mrep-seg");
  for (const mode of MODES) {
    const b = el("button", st.mode === mode.id ? "on" : "", mode.label);
    b.type = "button";
    b.title = mode.title;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      if (readState(node).mode !== mode.id) changed(node, { mode: mode.id });
    });
    seg.appendChild(b);
  }
  row.appendChild(seg);
  const gear = el("button", "pix-mrep-gear");
  gear.type = "button";
  gear.title = "Mesh Repair settings";
  gear.addEventListener("click", (e) => {
    e.stopPropagation();
    node._pixMrOpenPanel?.(node);
  });
  row.appendChild(gear);
  return row;
}

function detailChips(node, st) {
  const chips = el("div", "pix-mrep-chips");
  for (const d of DETAILS) {
    const b = el("button", "pix-mrep-chip" + (st.detail === d.value ? " on" : ""));
    b.type = "button";
    b.title = d.title;
    b.append(el("span", null, d.label), el("small", null, String(d.value)));
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      if (readState(node).detail !== d.value) changed(node, { detail: d.value });
    });
    chips.appendChild(b);
  }
  return chips;
}

function detailHint(st, report) {
  const size = hintPrintMm(st);
  const mm = (size / st.detail).toFixed(2);
  let text = `Smallest detail ${mm} mm on a ${size} mm print`;
  if (report?.ok && !report.skipped && report.mode === "solid" && report.detail === st.detail
      && report.seconds != null) {
    text += ` · last run ${Number(report.seconds).toFixed(1)} s`;
  }
  const hint = el("div", "pix-mrep-hint", text);
  hint.title = `The size of one cell of the rebuild on a print whose longest side is ${size} mm ` +
               "(the stl size, set in the gear). Detail finer than this softens.";
  return hint;
}

function dropdown(node, { label, options, value, display, title, key }) {
  const fld = el("div", "pix-mrep-fld");
  fld.title = title;
  const k = el("span", "pix-mrep-k", label);
  const v = el("span", "pix-mrep-dd", display ?? optionLabel(options, value));
  const tri = el("span", "pix-mrep-tri", "▼");
  const step = (dir) => {
    const at = Math.max(0, options.findIndex((o) => o.value === readState(node)[key]));
    const next = options[(at + dir + options.length) % options.length];
    changed(node, { [key]: next.value });
  };
  const prev = el("button", "pix-mrep-arr", "◀");
  prev.type = "button";
  prev.title = "Previous";
  const next = el("button", "pix-mrep-arr", "▶");
  next.type = "button";
  next.title = "Next";
  prev.addEventListener("click", (e) => { e.stopPropagation(); closeOptionPopup(); step(-1); });
  next.addEventListener("click", (e) => { e.stopPropagation(); closeOptionPopup(); step(1); });
  fld.append(k, v, tri, prev, next);
  fld.addEventListener("click", (e) => {
    if (e.target === prev || e.target === next) return;
    e.stopPropagation();
    openOptionPopup(node, fld, options, readState(node)[key], (picked) => changed(node, { [key]: picked }));
  });
  return fld;
}

function toggle(node, st, key, label, title) {
  const sw = el("button", "pix-mrep-sw" + (st[key] ? " on" : ""));
  sw.type = "button";
  sw.title = title;
  sw.setAttribute("role", "switch");
  sw.setAttribute("aria-checked", String(!!st[key]));
  sw.append(el("i"), el("span", null, label));
  sw.addEventListener("click", (e) => {
    e.stopPropagation();
    changed(node, { [key]: !readState(node)[key] });
  });
  return sw;
}

function viewUrl(file, stamp) {
  const q = `filename=${encodeURIComponent(file.filename)}&subfolder=${encodeURIComponent(file.subfolder || "")}`
          + `&type=${encodeURIComponent(file.type || "temp")}&rand=${encodeURIComponent(String(stamp ?? ""))}`;
  return pixApiUrl(`/view?${q}`);
}

function cutPreview(node, report) {
  const box = el("div", "pix-mrep-cut");
  const cut = report?.ok && !report.skipped ? report.cut : null;
  if (!cut?.before || !cut?.after) {
    box.appendChild(el("div", "pix-mrep-cutempty",
      "Run the workflow to see a cut through the middle of the model, before and after the repair."));
    return box;
  }
  const view = node._pixMrCutView === "before" ? "before" : "after";
  const url = viewUrl(cut[view], report.stamp);
  const img = el("div", "pix-mrep-cutimg");
  img.style.webkitMaskImage = `url("${url}")`;
  img.style.maskImage = `url("${url}")`;
  box.appendChild(img);

  const seg = el("div", "pix-mrep-cutseg");
  for (const side of ["before", "after"]) {
    const b = el("button", view === side ? "on" : "", side === "before" ? "Before" : "After");
    b.type = "button";
    b.title = side === "before" ? "The model as it came in" : "The repaired model";
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      node._pixMrCutView = side;
      renderFace(node);
    });
    seg.appendChild(b);
  }
  box.appendChild(seg);
  const cap = el("span", "pix-mrep-cutcap", "Cut through the middle · coloured = solid");
  cap.title = "A hollow model shows only a thin outline here, which is how a 3D printer's slicer sees it.";
  box.appendChild(cap);
  return box;
}

function percent(v) {
  return v == null || !Number.isFinite(Number(v)) ? "-" : `${Math.round(Number(v))}% solid`;
}

function reportBox(report) {
  const box = el("div", "pix-mrep-rep");
  const ok = report?.ok && !report.skipped;
  const b = ok ? report.before || {} : {};
  const a = ok ? report.after || {} : {};
  const inside = ok ? report.inside || {} : {};
  const rows = [
    ["Real holes", "Openings in the surface, after merging points that sit in the same place.",
      ok ? formatCount(b.holes) : "-", ok ? formatCount(a.holes) : "-", !ok || b.holes > 0, a.holes === 0],
    ["Broken edges", "Edges shared by three or more faces. A slicer cannot tell inside from outside there.",
      ok ? formatCount(b.broken) : "-", ok ? formatCount(a.broken) : "-", !ok || b.broken > 0, a.broken === 0],
    ["Loose bits", "Small separate pieces floating around the model.",
      ok ? formatCount(b.loose) : "-", ok ? formatCount(a.loose) : "-", !ok || b.loose > 0, a.loose === 0],
    ["Inside", "How much of the cut through the middle is solid material.",
      ok ? percent(inside.before) : "-", ok ? percent(inside.after) : "-",
      !ok || (inside.before ?? 100) < 90, (inside.after ?? 0) >= 90],
    ["Watertight", "Closed all round, with no holes and no broken edges.",
      ok ? (b.watertight ? "yes" : "no") : "-", ok ? (a.watertight ? "yes" : "no") : "-", !ok || !b.watertight, !!a.watertight],
    ["Triangles", "How many triangles the model has.",
      ok ? formatCount(b.triangles) : "-", ok ? formatCount(a.triangles) : "-", false, true],
  ];
  for (const [label, title, before, after, beforeBad, afterGood] of rows) {
    const r = el("div", "pix-mrep-r");
    r.title = title;
    r.append(
      el("span", "pix-mrep-rk", label),
      el("span", "pix-mrep-rb" + (ok && beforeBad ? " bad" : ""), before),
      el("span", "pix-mrep-ra", "→"),
      el("span", "pix-mrep-rv" + (ok ? (afterGood ? " good" : " bad") : ""), after),
    );
    box.appendChild(r);
  }
  return box;
}

function inputsUnwired(node) {
  const find = (name) => node?.inputs?.find((i) => i?.name === name);
  const mesh = find("mesh");
  const file = find("model_3d");
  if (!mesh && !file) return false;
  return (mesh?.link == null) && (file?.link == null);
}

function statusLine(node, st, report) {
  const line = el("div", "pix-mrep-stat");
  const text = el("span");
  line.appendChild(text);
  const say = (cls, words, title) => {
    if (cls) line.classList.add(cls);
    text.textContent = words;
    line.title = title || words;
  };

  if (inputsUnwired(node)) {
    say("warn", "Wire in a mesh or a model_3d", "Take a mesh from the Pixal3D or Trellis 2 nodes, or a model_3d from Load 3D Pixaroma.");
    return line;
  }
  if (!report) {
    say(null, "Waiting for a run");
    return line;
  }
  if (report.skipped) {
    say("warn", "Nothing is wired in");
    return line;
  }
  if (!report.ok) {
    say("warn", report.message || "The repair failed");
    return line;
  }
  const a = report.after || {};
  const insideAfter = report.inside?.after;
  const closed = a.watertight && a.broken === 0;
  if (report.mode === "solid") {
    if (closed) {
      say("good", a.pieces > 1 ? `Ready to print: ${a.pieces} closed solids` : "Ready to print: one closed solid",
          "Watertight, with no broken edges.");
    } else {
      say("warn", "Not closed yet: try a larger seal or more detail");
    }
  } else if (!closed) {
    say("warn", "Still not closed: use Make solid for printing");
  } else if (insideAfter != null && insideAfter < 90) {
    say("warn", "Closed, but hollow inside: use Make solid to print");
  } else {
    say("good", "Tidied: closed all round");
  }
  if (report.cached) {
    line.classList.add("dim");
    text.textContent += " (last run)";
    line.title = "Nothing above this node changed, so ComfyUI reused the last repair.";
  }
  if (report.notes?.length) line.title += "\n" + report.notes.join("\n");
  return line;
}

export function renderFace(node) {
  const inner = node?._pixMrInner;
  if (!inner) return;
  const st = readState(node);
  const report = readReport(node);
  const solid = st.mode !== "tidy";
  node._pixMrRoot?.classList.toggle("is-vue", isVueNodes());

  inner.textContent = "";
  inner.appendChild(modeRow(node, st));
  if (solid) {
    inner.appendChild(el("div", "pix-mrep-lbl", "Detail"));
    inner.appendChild(detailChips(node, st));
    inner.appendChild(detailHint(st, report));
    const foundAuto = st.seal === "auto" && report?.ok && !report.skipped && report.mode === "solid"
      && report.sealAuto && report.sealPercent != null;
    inner.appendChild(dropdown(node, {
      label: "Seal gaps", key: "seal", options: SEALS, value: st.seal,
      display: foundAuto ? `Auto (found ${Number(report.sealPercent).toFixed(1)}%)` : undefined,
      title: "How wide a gap or slit is closed before the inside is filled. Auto finds the smallest " +
             "seal that makes the inside solid.",
    }));
  }
  inner.appendChild(dropdown(node, {
    label: "Remove loose bits under", key: "loose", options: LOOSE, value: st.loose,
    title: "Separate pieces smaller than this share of the biggest piece are removed.",
  }));
  const sws = el("div", "pix-mrep-sws");
  if (solid) {
    sws.appendChild(toggle(node, st, "keepDetail", "Keep surface detail",
      "Snap the rebuilt surface back onto the original shape, so small details survive."));
  }
  sws.appendChild(toggle(node, st, "keepColours", "Keep colours",
    "Copy the model's colours (or its base colour texture) onto the result."));
  inner.appendChild(sws);
  inner.appendChild(cutPreview(node, report));
  inner.appendChild(reportBox(report));
  inner.appendChild(statusLine(node, st, report));
  node.setDirtyCanvas?.(true, false);
}

export function destroyFace(node) {
  closeOptionPopup();
  try { node._pixMrFloorOff?.(); } catch {}
  node._pixMrFloorOff = null;
  node._pixMrRoot = null;
  node._pixMrInner = null;
  node._pixMrWidget = null;
}
