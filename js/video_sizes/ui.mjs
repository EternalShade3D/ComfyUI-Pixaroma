// Video Sizes ETERNAL - the node face.
//
// Ported faithfully from Longest Side Pixaroma: one single non-wrapping row of
// p-label chips (360p..1080p), a Portrait / Landscape row, a band carrying the
// gear + the chosen size readout that parks in the output-slot dead-space (so
// there is no empty gap above the body), and a fixed widget height that is never
// measured live (measuring rewrites node.size and flags a clean workflow
// "modified" - Vue Compat #18).

import { pixAsset } from "../shared/api_url.mjs";
import { ACC } from "../shared/node_settings.mjs";
import { readState, writeState, fmtReadout, VIDEO_PRESETS } from "./core.mjs";

const PAD = 6;
const GAP = 4;
const TAB_H = 24;     // p-label rows (two rows: sizes, orient)
const CHIP_H = 26;

// Fixed widget height. The band is OUT OF FLOW, so it is not counted here.
export const WIDGET_H = PAD * 2 + TAB_H * 2 + GAP;

export const DEFAULT_W = 320;
export const MIN_W = 285;

// Band covers the two slot rows below the first. Measured on the drawn node:
// output dots sit at node-local y 14 / 34 / 54 with 20px rows, so rows two and
// three span y=24 to y=64, and the widget root starts at y=70. 24 - 70 = -46.
const SLOT_BAND_H = 40;
const CLASSIC_BAND_TOP = -46;
const BAND_INSET = 7;
const LABEL_RESERVE = 58;

let _cssDone = false;

export function injectCSS() {
  if (_cssDone) return;
  _cssDone = true;
  const style = document.createElement("style");
  style.id = "pix-vs-css";
  style.textContent = `
    .pix-vs-root {
      position: relative;
      display: flex; flex-direction: column; gap: ${GAP}px;
      padding: ${PAD}px; box-sizing: border-box; width: 100%;
      font-family: inherit; user-select: none;
    }
    .pix-vs-band {
      display: flex; align-items: center; justify-content: flex-start; gap: 6px;
      box-sizing: border-box; height: ${SLOT_BAND_H}px;
      padding-left: ${BAND_INSET}px; padding-right: ${LABEL_RESERVE}px;
      background: transparent; pointer-events: none;
    }
    .pix-vs-band > * { pointer-events: auto; }
    .pix-vs-band.classic {
      position: absolute; left: 0; right: 0; top: ${CLASSIC_BAND_TOP}px;
    }
    .pix-vs-band.parked {
      position: absolute; inset: 0; height: auto;
    }
    .pix-vs-gear {
      flex: none; width: 20px; height: 20px; padding: 0; margin: 0;
      display: flex; align-items: center; justify-content: center;
      background: none; border: none; cursor: pointer;
    }
    .pix-vs-gear::before {
      content: ""; display: block; width: 14px; height: 14px; background: #bbb;
      -webkit-mask: url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat;
      mask: url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat;
    }
    .pix-vs-gear:hover::before { background: ${ACC}; }
    .pix-vs-preview {
      flex: 0 1 auto; min-width: 0; height: 20px; line-height: 20px;
      font-size: 12px; color: ${ACC}; white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis;
    }
    .pix-vs-preview.dim { color: rgba(255,255,255,0.45); font-style: italic; }

    .pix-vs-row { display: flex; gap: ${GAP}px; flex: none; }
    .pix-vs-chip, .pix-vs-pill {
      flex: 1 1 0; min-width: 0; box-sizing: border-box;
      display: flex; align-items: center; justify-content: center;
      background: #1d1d1d; border: 1px solid #444; border-radius: 4px;
      color: #bbb; font-family: inherit; cursor: pointer; padding: 0 2px;
      white-space: nowrap; overflow: hidden;
    }
    .pix-vs-chip { height: ${TAB_H}px; font-size: 11px; }
    .pix-vs-pill { height: ${TAB_H}px; font-size: 11px; }
    .pix-vs-chip:hover, .pix-vs-pill:hover { border-color: ${ACC}; color: #ddd; }
    .pix-vs-chip.on, .pix-vs-chip.on:hover,
    .pix-vs-pill.on, .pix-vs-pill.on:hover {
      background: ${ACC}; border-color: ${ACC}; color: #fff;
    }
    .pix-vs-label { overflow: hidden; text-overflow: ellipsis; }
  `;
  document.head.appendChild(style);
}

function buildRows(node, root) {
  const st = readState(node);

  const sizeRow = root.querySelector(".pix-vs-row.pix-vs-sizes");
  sizeRow.textContent = "";
  VIDEO_PRESETS.forEach(([label], i) => {
    const b = document.createElement("button");
    b.className = "pix-vs-chip" + (i === st.selected ? " on" : "");
    b.dataset.idx = String(i);
    b.title = `${label} — ${VIDEO_PRESETS[i][1]} × ${VIDEO_PRESETS[i][2]} (16:9)`;
    const lab = document.createElement("span");
    lab.className = "pix-vs-label";
    lab.textContent = label;
    b.append(lab);
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      writeState(node, { ...readState(node), selected: i });
      refresh();
      node.graph?.setDirtyCanvas?.(true, true);
    });
    sizeRow.appendChild(b);
  });

  const orientRow = root.querySelector(".pix-vs-row.pix-vs-orient");
  orientRow.textContent = "";
  for (const [o, label] of [["portrait", "Portrait"], ["landscape", "Landscape"]]) {
    const b = document.createElement("button");
    b.className = "pix-vs-pill" + (st.orientation === o ? " on" : "");
    b.dataset.o = o;
    b.title = o === "portrait" ? "Taller than wide" : "Wider than tall";
    const lab = document.createElement("span");
    lab.className = "pix-vs-label";
    lab.textContent = label;
    b.append(lab);
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      writeState(node, { ...readState(node), orientation: o });
      refresh();
      node.graph?.setDirtyCanvas?.(true, true);
    });
    orientRow.appendChild(b);
  }
}

export function buildFace(node, { onGear }) {
  injectCSS();

  const root = document.createElement("div");
  root.className = "pix-vs-root";

  const band = document.createElement("div");
  band.className = "pix-vs-band";

  const gear = document.createElement("button");
  gear.className = "pix-vs-gear";
  gear.title = "Video Sizes settings";
  gear.addEventListener("click", (e) => { e.stopPropagation(); onGear?.(node); });

  const prev = document.createElement("span");
  prev.className = "pix-vs-preview";

  band.append(gear, prev);

  const sizeRow = document.createElement("div");
  sizeRow.className = "pix-vs-row pix-vs-sizes";
  const orientRow = document.createElement("div");
  orientRow.className = "pix-vs-row pix-vs-orient";

  root.append(band, sizeRow, orientRow);

  function refresh() {
    const st = readState(node);
    const r = fmtReadout(st);
    prev.textContent = `${r.label} · ${r.w} × ${r.h}`;
    buildRows(node, root);
  }

  refresh();
  return { root, band, refresh };
}
