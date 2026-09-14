// Load 3D Pixaroma - the size of the picture when width and height are wired in.
//
// The picture is drawn in the browser the moment Run is pressed, before any node
// has run, so a wired width or height can only shape it when its value is already
// known on the page. Sizes Pixaroma keeps its final width and height in its own
// state, so it is read here. A size worked out while the workflow runs (maths on
// numbers, the size of a photo) cannot be, and the node says so instead of
// guessing; Python then compares the picture with the numbers that arrive and
// stops the run when they differ (size_mismatch_message in _load3d_helpers.py).
//
// Pure: no ComfyUI imports, so the parity harness can load it in plain node.

import { readState, MIN_SIDE, MAX_SIDE } from "./core.mjs";

// The two optional inputs, named as in the Python def. The outputs of the same
// names follow mask (model_3d 0, image 1, mask 2, width 3, height 4).
export const SIZE_INPUTS = ["width", "height"];

const LABEL = { w: "Width", h: "Height" };
const MAX_REROUTE_HOPS = 16;

// ── Sizes Pixaroma ──────────────────────────────────────────────────────────
// A mirror of PixaromaSizes.get_size in nodes/node_sizes.py, fed the string its
// graphToPrompt hook injects (node.properties.sizesState, as it is). Keep the two
// in step: D:/Claude Tests/_load3d_size_parity.py runs both on the same states.

const SIZES_DEFAULT_OUT = [1024, 1024];

// Python's int(): a whole number passes, a float is truncated, a digits-only
// string is parsed, anything else raises (and get_size then falls back).
function pyInt(v) {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("not a finite number");
    return Math.trunc(v);
  }
  if (typeof v === "string" && /^\s*[+-]?\d+\s*$/.test(v)) return parseInt(v, 10);
  throw new Error("not an int");
}

// Python's round() sends an exact tie to the EVEN neighbour where Math.round
// sends it up, and a snap of 16 on a side of 1000 is exactly such a tie.
function pyRound(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

// Python truthiness, for the "value or default" reads in get_size.
function pyFalsy(v) {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

/** The [width, height] a Sizes Pixaroma node outputs for its stored state string. */
export function sizesNodeOutputs(raw) {
  // An empty property: the hook injects the default state, which is 1024 x 1024.
  if (raw === undefined || raw === null || raw === "") return SIZES_DEFAULT_OUT.slice();
  try {
    if (typeof raw !== "string") throw new Error("not a string");
    const state = JSON.parse(raw);
    if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("not an object");
    let w;
    let h;
    if ("w" in state && "h" in state) {
      w = pyInt(state.w);
      h = pyInt(state.h);
    } else {
      const sizes = pyFalsy(state.sizes) ? [[1024, 1024]] : state.sizes;
      if (!Array.isArray(sizes)) throw new Error("sizes is not a list");
      let idx = "selected" in state ? pyInt(state.selected) : 0;
      if (idx < 0 || idx >= sizes.length) idx = 0;
      const pair = sizes[idx];
      if (!Array.isArray(pair) || pair.length < 2) throw new Error("not a pair");
      const a = pyInt(pair[0]);
      const b = pyInt(pair[1]);
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const orientation = "orientation" in state ? state.orientation : "portrait";
      [w, h] = orientation === "landscape" ? [hi, lo] : [lo, hi];
      const step = pyFalsy(state.snap) ? 0 : pyInt(state.snap);
      if (step) {
        w = pyRound(w / step) * step;
        h = pyRound(h / step) * step;
      }
    }
    return [Math.max(64, Math.min(16384, pyInt(w))), Math.max(64, Math.min(16384, pyInt(h)))];
  } catch (_e) {
    return SIZES_DEFAULT_OUT.slice();
  }
}

// The nodes whose size output is already known on the page, and how to read it.
const READERS = {
  PixaromaSizes: (up, slot) => {
    const [w, h] = sizesNodeOutputs(up?.properties?.sizesState);
    return slot === 0 ? w : slot === 1 ? h : null;
  },
};

function linkOf(graph, id) {
  if (!graph || id === null || id === undefined) return null;
  const links = graph.links;
  let link = links ? links[id] : null;
  // graph.links is a Map on newer frontends (Vue Compat #3).
  if (!link && links && typeof links.get === "function") link = links.get(id);
  return link || null;
}

function nodeOf(graph, id) {
  return graph && typeof graph.getNodeById === "function" ? graph.getNodeById(id) || null : null;
}

function isReroute(n) {
  return n?.type === "Reroute" || n?.comfyClass === "Reroute";
}

/**
 * Where one size input gets its number:
 *   { state: "none" }                 nothing arrives, the node's own number is used
 *   { state: "value", value, title }  known before Run
 *   { state: "unknown", title }       wired, but only known once the workflow runs
 */
export function sideSource(node, name) {
  const inp = Array.isArray(node?.inputs) ? node.inputs.find((i) => i && i.name === name) : null;
  if (!inp || inp.link === null || inp.link === undefined) return { state: "none" };
  const graph = node.graph;
  let link = linkOf(graph, inp.link);
  let up = link ? nodeOf(graph, link.origin_id) : null;
  // A Reroute node only carries the wire along: follow it to the real source.
  for (let hop = 0; up && isReroute(up); hop++) {
    if (hop >= MAX_REROUTE_HOPS) return { state: "unknown", title: "Reroute" };
    const rin = Array.isArray(up.inputs) ? up.inputs[0] : null;
    if (!rin || rin.link === null || rin.link === undefined) return { state: "none" };
    link = linkOf(graph, rin.link);
    up = link ? nodeOf(graph, link.origin_id) : null;
  }
  if (!link || !up) return { state: "unknown", title: "" };
  const cls = String(up.comfyClass || up.type || "");
  const title = String(up.title || cls);
  const reader = READERS[cls];
  // A muted node sends nothing, and a bypassed Sizes node has no input to hand
  // on, so no number arrives and the node's own Width and Height are used.
  if (up.mode === 2 || (up.mode === 4 && reader)) return { state: "none", off: true, title };
  const value = reader ? reader(up, link.origin_slot) : null;
  return Number.isFinite(value) ? { state: "value", value, title } : { state: "unknown", title };
}

export function sizeSources(node) {
  return { w: sideSource(node, "width"), h: sideSource(node, "height") };
}

/** A side whose field is locked: something wired in delivers, or will deliver, the number. */
export function isLocked(src) {
  return src?.state === "value" || src?.state === "unknown";
}

function clampSide(v) {
  return Math.min(MAX_SIDE, Math.max(MIN_SIDE, Math.round(v)));
}

/** The node's state with the width and height the picture will actually be drawn at. */
export function effectiveState(node, sources = null) {
  const st = readState(node);
  const src = sources || sizeSources(node);
  if (src.w.state === "value") st.w = clampSide(src.w.value);
  if (src.h.state === "value") st.h = clampSide(src.h.value);
  return st;
}

/** Changes whenever what the size inputs deliver changes; the live-follow poll compares it. */
export function sizeSignature(sources) {
  const one = (s) => `${s.state}:${s.value ?? ""}:${s.title ?? ""}`;
  return `${one(sources.w)}|${one(sources.h)}`;
}

/** What the bottom line should warn about, or "" when the size is fine. */
export function sizeNote(sources) {
  const unknown = ["w", "h"].filter((k) => sources[k].state === "unknown");
  if (unknown.length) {
    const who = unknown.length === 2 ? "Width and height" : LABEL[unknown[0]];
    const titles = [...new Set(unknown.map((k) => sources[k].title).filter(Boolean))];
    const from = titles.length ? ` from "${titles.join('" and "')}"` : "";
    return `${who}${from} can't be read before Run. Wire Sizes Pixaroma, or unplug it to type a size.`;
  }
  for (const k of ["w", "h"]) {
    const s = sources[k];
    if (s.state === "value" && (s.value < MIN_SIDE || s.value > MAX_SIDE)) {
      return `${LABEL[k]} ${s.value} is outside ${MIN_SIDE} to ${MAX_SIDE}, so the picture can't be drawn that size.`;
    }
  }
  return "";
}

/**
 * Put the width and height input dots level with the width and height outputs.
 * Classic draws an input wherever its pos says. Nodes 2.0 draws the dots in the
 * page, where ui.mjs moves them down with CSS, and ends a wire at that dot
 * (getSlotPosition reads the dot's registered layout); it only falls back to pos
 * before the dot is registered, so the same pos serves both renderers. index.js
 * strips pos when the workflow is saved, so this can never make a saved workflow
 * look modified.
 */
export function placeSizeInputs(node, slotH = 20) {
  const outs = Array.isArray(node?.outputs) ? node.outputs : [];
  for (const name of SIZE_INPUTS) {
    const inp = Array.isArray(node?.inputs) ? node.inputs.find((i) => i && i.name === name) : null;
    if (!inp) continue;
    const row = outs.findIndex((o) => o && o.name === name);
    if (row < 0) {
      if (inp.pos) delete inp.pos;
      continue;
    }
    const x = slotH * 0.5;
    const y = (row + 0.7) * slotH;
    if (!Array.isArray(inp.pos) || inp.pos[0] !== x || inp.pos[1] !== y) inp.pos = [x, y];
  }
}
