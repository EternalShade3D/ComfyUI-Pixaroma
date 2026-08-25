// Video Sizes ETERNAL - a labelled video-resolution picker (360p..1080p) with a
// Portrait / Landscape flip and a snap setting. One DOM widget (chips + orient
// pills + gear + readout), two outputs (width, height). Works in BOTH renderers.
//
// Architecture mirrors Sizes / Resolution Pixaroma: state on
// node.properties.videoSizesState, injected into the hidden VideoSizesState input
// by the graphToPrompt hook below (Vue Compat #9). The settings panel (gear /
// right-click) lives in settings.mjs.

import { app } from "/scripts/app.js";
import { hideJsonWidget } from "../shared/index.mjs";
import { applyAdaptiveCanvasOnly } from "../shared/nodes2.mjs";
import { isVueNodes } from "../shared/nodes2.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { pixAsset } from "../shared/api_url.mjs";
import {
  BRAND, STATE_PROP, HIDDEN_INPUT,
  readState, writeState, accentOf, fmtReadout, VIDEO_PRESETS,
} from "./core.mjs";
import { openVideoSizesPanel, closeVideoSizesPanelFor } from "./settings.mjs";

const CLASS = "ETERNALVideoSizes";

const NODE_W = 260;
const PAD = 9;
const CHIP_H = 26;
const CHIP_GAP = 5;
const ORIENT_H = 26;
const READOUT_H = 18;
const ROW_GAP = 8;
const CHROME = 46;
const VUE_CHROME = 52;

function contentH(node) {
  const st = readState(node);
  const chips = VIDEO_PRESETS.length;
  const chipRows = Math.ceil(chips / 4); // 4 per row
  const chipsH = chipRows * CHIP_H + (chipRows - 1) * CHIP_GAP;
  return PAD + chipsH + ROW_GAP + ORIENT_H + ROW_GAP + READOUT_H + PAD;
}
function fitNodeH(node) {
  try {
    const cs = node.computeSize?.();
    if (cs && cs[1] > 0) return Math.round(cs[1]);
  } catch (_e) { /* fall through */ }
  return contentH(node) + (isVueNodes() ? VUE_CHROME : CHROME);
}

function injectCSS() {
  if (document.getElementById("pix-vs-css")) return;
  const css = `
    .pix-vs-root { width:100%; box-sizing:border-box;
      background:#1d1d1d; border-radius:4px; color:#ddd;
      font-family: ui-sans-serif, system-ui, sans-serif; font-size:11px; }
    .pix-vs-inner { box-sizing:border-box; padding:${PAD}px; }
    .pix-vs-chips { display:flex; flex-wrap:wrap; gap:${CHIP_GAP}px; margin-bottom:${ROW_GAP}px; }
    .pix-vs-chip { flex:1 1 calc(25% - ${CHIP_GAP}px); min-width:0; text-align:center;
      padding:6px 4px; border-radius:5px; box-sizing:border-box;
      background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.14);
      color:#a8a8a8; font-size:11px; cursor:pointer; user-select:none;
      transition:background .08s, border-color .08s, color .08s; }
    .pix-vs-chip:hover { border-color:var(--acc,${BRAND}); color:#ddd; }
    .pix-vs-chip.on { background:var(--acc,${BRAND}); border-color:var(--acc,${BRAND}); color:#fff; font-weight:600; }
    .pix-vs-orient { display:flex; align-items:center; gap:6px; margin-bottom:${ROW_GAP}px; }
    .pix-vs-ratio { flex:0 0 auto; display:flex; align-items:center; gap:3px; color:#8a8a8a; font-size:12px; }
    .pix-vs-ratio .glyph { font-size:13px; line-height:1; color:var(--acc,${BRAND}); }
    .pix-vs-pills { display:flex; gap:5px; flex:1; min-width:0; }
    .pix-vs-pill { flex:1; text-align:center; padding:6px 4px; border-radius:5px;
      background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.14);
      color:#a8a8a8; font-size:11px; cursor:pointer; user-select:none;
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .pix-vs-pill:hover { border-color:var(--acc,${BRAND}); color:#ddd; }
    .pix-vs-pill.on { background:var(--acc,${BRAND}); border-color:var(--acc,${BRAND}); color:#fff; }
    .pix-vs-gear { flex:0 0 auto; width:28px; display:flex; align-items:center; justify-content:center;
      background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.14); border-radius:5px;
      cursor:pointer; user-select:none; line-height:0; }
    .pix-vs-gear::before { content:""; display:block; width:14px; height:14px; background:#bbb;
      -webkit-mask:url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat;
      mask:url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat; }
    .pix-vs-gear:hover { border-color:var(--acc,${BRAND}); }
    .pix-vs-gear:hover::before { background:#fff; }
    .pix-vs-readout { display:flex; align-items:center; gap:6px; height:${READOUT_H}px;
      font-size:12px; color:#cfcfcf; font-variant-numeric:tabular-nums; }
    .pix-vs-readout .lead { color:var(--acc,${BRAND}); }
    .pix-vs-readout .dim { color:#7a7a7a; }
  `;
  const s = document.createElement("style");
  s.id = "pix-vs-css";
  s.textContent = css;
  document.head.appendChild(s);
}

function ensureRoot(node) {
  const held = node._pixVsRoot;
  if (held && held.isConnected) return held;
  const w = (node.widgets || []).find((x) => x.name === "video_sizes_ui");
  const el = w?.element;
  const elRoot = el?.classList?.contains?.("pix-vs-root")
    ? el
    : el?.querySelector?.(".pix-vs-root");
  if (elRoot) { node._pixVsRoot = elRoot; return elRoot; }
  return held || null;
}

function render(node) {
  const root = ensureRoot(node);
  if (!root) return;
  let inner = root.querySelector(".pix-vs-inner");
  if (!inner) {
    inner = document.createElement("div");
    inner.className = "pix-vs-inner";
    root.appendChild(inner);
  }
  node._pixVsInner = inner;

  const st = readState(node);
  inner.style.setProperty("--acc", accentOf(node));
  inner.innerHTML = "";

  // ── chip row (p-labels) ───────────────────────────────────────────────
  const chips = document.createElement("div");
  chips.className = "pix-vs-chips";
  VIDEO_PRESETS.forEach(([label], i) => {
    const c = document.createElement("div");
    c.className = "pix-vs-chip" + (i === st.selected ? " on" : "");
    c.dataset.idx = String(i);
    c.textContent = label;
    c.title = `${label} — ${VIDEO_PRESETS[i][1]} × ${VIDEO_PRESETS[i][2]} (16:9)`;
    chips.appendChild(c);
  });

  // ── orient row: ⛶ 16:9 + Portrait / Landscape + gear ──────────────────
  const orient = document.createElement("div");
  orient.className = "pix-vs-orient";
  const ratio = document.createElement("div");
  ratio.className = "pix-vs-ratio";
  ratio.innerHTML = `<span class="glyph">⛶</span><span>16:9</span>`;
  const pills = document.createElement("div");
  pills.className = "pix-vs-pills";
  for (const [o, label] of [["portrait", "Portrait"], ["landscape", "Landscape"]]) {
    const p = document.createElement("div");
    p.className = "pix-vs-pill" + (st.orientation === o ? " on" : "");
    p.dataset.o = o;
    p.textContent = label;
    p.title = o === "portrait" ? "Taller than wide" : "Wider than tall";
    pills.appendChild(p);
  }
  const gear = document.createElement("div");
  gear.className = "pix-vs-gear";
  gear.title = "Video Sizes settings — snap, colour";
  orient.append(ratio, pills, gear);

  // ── readout (Duration style) ──────────────────────────────────────────
  const ro = document.createElement("div");
  ro.className = "pix-vs-readout";
  const r = fmtReadout(st);
  ro.innerHTML = `<span class="lead">▸ ${r.label}</span><span class="dim">${r.w} × ${r.h}</span>`;

  inner.append(chips, orient, ro);
}

function fitToContent(node) {
  if (isGraphLoading()) return;
  const w = Math.max(node.size?.[0] || NODE_W, NODE_W);
  const h = fitNodeH(node);
  if (node.setSize) node.setSize([w, h]);
  else node.size = [w, h];
}

function applyAndRefresh(node, patch) {
  writeState(node, { ...readState(node), ...patch });
  render(node);
  node.setDirtyCanvas?.(true, true);
}

function onClick(node, e) {
  const chip = e.target.closest(".pix-vs-chip");
  if (chip) {
    applyAndRefresh(node, { selected: Number(chip.dataset.idx) });
    return;
  }
  const pill = e.target.closest(".pix-vs-pill");
  if (pill) {
    applyAndRefresh(node, { orientation: pill.dataset.o });
    return;
  }
  if (e.target.closest(".pix-vs-gear")) {
    openVideoSizesPanel(node, (info) => {
      render(node);
      node.setDirtyCanvas?.(true, true);
    });
    return;
  }
}

// graphToPrompt state injection (Vue Compat #9) — patch app.graphToPrompt.
function installPromptHook() {
  if (app._eternalVsHooked) return;
  app._eternalVsHooked = true;
  const orig = app.graphToPrompt.bind(app);
  app.graphToPrompt = function (...args) {
    const prompt = orig.apply(this, args);
    try {
      const nodes = (app.graph?._nodes || app.graph?.nodes || []);
      for (const n of nodes) {
        if (n.comfyClass !== CLASS) continue;
        const st = readState(n);
        const inputs = prompt?.[n.id]?.inputs || prompt?.[String(n.id)]?.inputs;
        if (inputs) inputs[HIDDEN_INPUT] = JSON.stringify(st);
      }
    } catch (_e) { /* never break the prompt */ }
    return prompt;
  };
}

function boot() {
  injectCSS();
  installPromptHook();
  // registerExtension needs to run after app ready; ComfyUI calls our file.
  app.registerExtension({
    name: "ETERNAL.VideoSizes.Boot",
    beforeRegisterNodeDef(nodeType, nodeData) {
      if (nodeData.name !== CLASS) return;

      const _origConfigure = nodeType.prototype.onConfigure;
      nodeType.prototype.onConfigure = function () {
        const r = _origConfigure?.apply(this, arguments);
        render(this);
        queueMicrotask(() => render(this));
        return r;
      };

      const _origOnResize = nodeType.prototype.onResize;
      nodeType.prototype.onResize = function (size) {
        if (!isVueNodes() && !isGraphLoading()) {
          size[0] = Math.max(size[0], NODE_W);
          this.size[0] = Math.max(this.size[0], NODE_W);
          size[1] = fitNodeH(this);
          this.size[1] = size[1];
        }
        if (_origOnResize) return _origOnResize.apply(this, arguments);
      };

      const _origOnNodeCreated = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function () {
        const r = _origOnNodeCreated?.apply(this, arguments);
        injectCSS();
        const root = document.createElement("div");
        root.className = "pix-vs-root";
        this._pixVsRoot = root;
        const w = this.addDOMWidget("video_sizes_ui", "video_sizes", root, {
          onMouse: (e) => { onClick(this, e); },
          serialize: false,
        });
        if (w?.element) w.element.classList.add("pix-vs-root");
        hideJsonWidget(this.widgets, HIDDEN_INPUT);
        applyAdaptiveCanvasOnly(this);
        render(this);
        return r;
      };
    },
  });
}

// ComfyUI loads ES modules after app exists; register immediately.
boot();

export default {};
