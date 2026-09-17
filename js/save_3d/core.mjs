// Save 3D Pixaroma - state, constants and small pure helpers.
//
// The node's own state lives on node.properties (Vue Compat #9). Only the keys
// that change the saved FILE travel to Python (promptState), so turning the
// view, picking a look or flipping a viewer switch never re-runs the node.

import { VIEWS, LIGHTS, fmtInt } from "../load_3d/core.mjs";
import { turnsMatrix } from "./fix.mjs";

export { VIEWS, LIGHTS };

export const CLASS = "PixaromaSave3D";
export const HIDDEN_INPUT = "Save3DState";
export const STATE_KEY = "pixSave3DState";
export const LAST_RUN_KEY = "pixSave3DLastRun";
export const UI_WIDGET = "pixaroma_save3d_ui";
// Namespaced, so a registered Vue widget type can never claim it (the Show Text bug).
export const WIDGET_TYPE = "pixaroma_save3d";
export const MAX_TURNS = 64;
export const NAME_MAX = 200;

export const MODES = [
  { id: "preview", label: "Preview", tip: "Write a temporary file only, to look at it" },
  { id: "save", label: "Save", tip: "Write the file into the save folder on every run" },
];

export const FORMATS = [
  { value: "auto", label: "Auto", title: "OBJ when the model has quads or panels, GLB when it is made of triangles" },
  { value: "obj", label: "OBJ", title: "Keeps quads, panel groups and vertex colours" },
  { value: "glb", label: "GLB", title: "Keeps colours and textures; holds triangles only" },
  { value: "stl", label: "STL", title: "For 3D printing: stands on Z and keeps no colours" },
];

export const UPS = [
  { value: "auto", label: "Auto", title: "Y up for OBJ and GLB, Z up for STL, the way each is normally read" },
  { value: "y", label: "Y up", title: "Every format stands on Y" },
  { value: "z", label: "Z up", title: "Every format stands on Z" },
];

export const STL_SIZES = ["model", 50, 100, 150, 200, 300];

export const LOOKS = [
  { key: "color", label: "Color", tip: "The model's own colours and textures" },
  { key: "clay", label: "Clay", tip: "Plain grey: only the shape" },
  { key: "wire", label: "Wire", tip: "The real edges of the model: quads stay quads" },
  { key: "panels", label: "Panels", tip: "One colour for each group in an OBJ" },
  { key: "normal", label: "Normal", tip: "Surface directions as colours, to spot faces pointing the wrong way" },
];

export const DEFAULT_STATE = Object.freeze({
  mode: "preview", turns: [], center: true, ground: true, format: "auto",
  name: "3d/pixaroma", up: "auto", stlSize: 100, folder: "",
  look: "color", view: "Q", az: 40, el: 20, zoom: 1, panX: 0, panY: 0,
  light: "studio", bright: 1, bg: "#262626",
  grid: true, arrow: true, marker: true, shadow: true,
});

const HEX = /^#[0-9a-f]{6}$/i;
const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const bool = (v, d) => (typeof v === "boolean" ? v : d);

export function sanitizeState(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const D = DEFAULT_STATE;
  let az = num(s.az, D.az) % 360;
  if (az > 180) az -= 360;
  if (az < -180) az += 360;
  let view = D.view;
  if (s.view === null) view = null;
  else if (s.view !== undefined) view = VIEWS.some((v) => v.key === s.view) ? s.view : null;
  const turns = Array.isArray(s.turns)
    ? s.turns.filter((t) => typeof t === "string" && /^[xyz]$/i.test(t)).map((t) => t.toLowerCase()).slice(0, MAX_TURNS)
    : [];
  return {
    mode: MODES.some((m) => m.id === s.mode) ? s.mode : D.mode,
    turns,
    center: bool(s.center, D.center),
    ground: bool(s.ground, D.ground),
    format: FORMATS.some((f) => f.value === s.format) ? s.format : D.format,
    name: typeof s.name === "string" ? s.name.slice(0, NAME_MAX) : D.name,
    up: UPS.some((u) => u.value === s.up) ? s.up : D.up,
    stlSize: STL_SIZES.includes(s.stlSize) ? s.stlSize : D.stlSize,
    folder: typeof s.folder === "string" ? s.folder.slice(0, 1024) : D.folder,
    look: LOOKS.some((l) => l.key === s.look) ? s.look : D.look,
    view,
    az,
    el: clamp(num(s.el, D.el), -90, 90),
    zoom: clamp(num(s.zoom, D.zoom), 0.05, 40),
    panX: clamp(num(s.panX, D.panX), -20, 20),
    panY: clamp(num(s.panY, D.panY), -20, 20),
    light: LIGHTS.includes(s.light) ? s.light : D.light,
    bright: clamp(num(s.bright, D.bright), 0.2, 3),
    bg: typeof s.bg === "string" && HEX.test(s.bg) ? s.bg.toLowerCase() : D.bg,
    grid: bool(s.grid, D.grid),
    arrow: bool(s.arrow, D.arrow),
    marker: bool(s.marker, D.marker),
    shadow: bool(s.shadow, D.shadow),
  };
}

export function readState(node) {
  return sanitizeState(node?.properties?.[STATE_KEY]);
}

/** ONLY from a real user action - never on the load path (Vue Compat #18). */
export function writeState(node, patch) {
  if (!node) return;
  node.properties = node.properties || {};
  node.properties[STATE_KEY] = sanitizeState({ ...readState(node), ...patch });
}

/** What Python reads. Nothing about the view, the looks or the switches. */
export function promptState(st) {
  return {
    mode: st.mode, turns: st.turns.slice(), center: st.center, ground: st.ground, format: st.format,
    name: st.name, up: st.up, stlSize: st.stlSize, folder: st.folder,
  };
}

/** Everything that changes the saved file's BYTES (not where it goes). */
export function fileKey(st) {
  return JSON.stringify([st.turns, st.center, st.ground, st.format, st.up, st.stlSize]);
}

/** The state the shared renderer draws a stage node with. */
export function engineState(st) {
  return { ...st, proj: "persp", fov: 35, w: 1024, h: 1024, up: "Y", turn: 0 };
}

// The 24 ways a model can stand, each with its shortest list of turns, so a
// run of clicks never grows the state (four Turn X clicks are no turn at all).
let _shortest = null;
function shortestTurns() {
  if (_shortest) return _shortest;
  const key = (m) => m.flat().join(",");
  const table = new Map([[key(turnsMatrix([])), []]]);
  const queue = [[]];
  while (queue.length && table.size < 24) {
    const seq = queue.shift();
    for (const axis of ["x", "y", "z"]) {
      const next = [...seq, axis];
      const k = key(turnsMatrix(next));
      if (!table.has(k)) {
        table.set(k, next);
        queue.push(next);
      }
    }
  }
  _shortest = { table, key };
  return _shortest;
}

/** The turns after one more quarter turn about `axis`, kept as short as possible. */
export function turnsAfter(turns, axis) {
  const next = [...(Array.isArray(turns) ? turns : []), axis];
  const { table, key } = shortestTurns();
  const found = table.get(key(turnsMatrix(next)));
  return found ? found.slice() : next.slice(-MAX_TURNS);
}

// ── the last run, kept on the node so a tab switch shows it again ──────────
export function readLastRun(node) {
  const r = node?.properties?.[LAST_RUN_KEY];
  return r && typeof r === "object" && r.view && typeof r.view.filename === "string" && r.fix ? r : null;
}

/** From the executed event only (a run's result may be kept, Vue Compat #11). Small on purpose. */
export function writeLastRun(node, report, sent) {
  if (!node) return;
  node.properties = node.properties || {};
  node.properties[LAST_RUN_KEY] = {
    file: report.file, view: report.view, fix: report.fix, faces: report.faces, edges: report.edges,
    format: report.format, up: report.up, source: report.source, colours: !!report.colours,
    texture: !!report.texture, groups: report.groups || 0, notes: Array.isArray(report.notes) ? report.notes : [],
    saved: !!report.saved, mode: report.mode, stamp: report.stamp, sent: typeof sent === "string" ? sent : "",
  };
}

/** A file reference from the report as the renderer's model value: "sub/file.obj [temp]". */
export function refValue(ref) {
  if (!ref || typeof ref.filename !== "string") return "";
  const sub = String(ref.subfolder || "").replace(/\\/g, "/").replace(/\/+$/, "");
  return `${sub ? sub + "/" : ""}${ref.filename} [${ref.type || "temp"}]`;
}

export function facesText(faces) {
  if (!faces) return "";
  const parts = [];
  if (faces.quads) parts.push(`${fmtInt(faces.quads)} quads`);
  if (faces.triangles) parts.push(`${fmtInt(faces.triangles)} triangles`);
  if (faces.ngons) parts.push(`${fmtInt(faces.ngons)} larger polygons`);
  return parts.join(" + ");
}

export function runInfo(run) {
  if (!run) return "";
  const parts = [run.saved ? `Saved ${run.file?.filename || ""}` : `Preview · ${String(run.format || "").toUpperCase()}`];
  parts.push(run.texture ? "texture" : run.colours ? "colours" : "no colours");
  const e = run.edges || {};
  if (e.pieces) parts.push(e.pieces === 1 ? "1 piece" : `${fmtInt(e.pieces)} pieces`);
  if (run.groups) parts.push(run.groups === 1 ? "1 panel" : `${fmtInt(run.groups)} panels`);
  if (e.open) parts.push(`${fmtInt(e.open)} open edges`);
  if (e.broken) parts.push(`${fmtInt(e.broken)} broken`);
  // Non-breaking spaces inside each part, so the two-line info row wraps only
  // between parts and never splits "20 open edges".
  return parts.map((p) => p.replace(/ /g, " ")).join(" · ");
}

export function formatText(st, run) {
  if (st.format === "auto" && run?.format) return `Auto: ${String(run.format).toUpperCase()}`;
  return FORMATS.find((f) => f.value === st.format)?.label || "Auto";
}

export function inputsUnwired(node) {
  const find = (name) => node?.inputs?.find((i) => i?.name === name);
  const mesh = find("mesh");
  const file = find("model_3d");
  if (!mesh && !file) return false;
  return mesh?.link == null && file?.link == null;
}
