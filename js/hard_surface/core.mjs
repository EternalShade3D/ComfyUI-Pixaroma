// Hard Surface Pixaroma - state, constants and small pure helpers.
//
// The node's own state lives on node.properties (Vue Compat #9). Only the keys that change the result
// travel to Python (promptState), so turning the view, picking a look or switching Before and After
// never re-runs the node.

import { VIEWS, LIGHTS, fmtInt } from "../load_3d/core.mjs";

export { VIEWS, LIGHTS };

export const CLASS = "PixaromaHardSurface";
export const HIDDEN_INPUT = "HardSurfaceState";
export const STATE_KEY = "pixHardSurfaceState";
export const LAST_RUN_KEY = "pixHardSurfaceLastRun";
export const UI_WIDGET = "pixaroma_hardsurface_ui";
// Namespaced, so a registered Vue widget type can never claim it (the Show Text bug).
export const WIDGET_TYPE = "pixaroma_hardsurface";

export const STRENGTHS = [
  { id: "light", label: "Light", tip: "Small moves only (0.3 mm on a 100 mm print): the smallest bevels become crisp" },
  { id: "medium", label: "Medium", tip: "Bevels up to about half a millimetre on a 100 mm print become crisp edges" },
  { id: "strong", label: "Strong", tip: "Larger moves (0.8 mm on a 100 mm print): wider bevels close too" },
];

export const SHOWS = [
  { id: "before", label: "Before", tip: "Show the model as it came in" },
  { id: "after", label: "After", tip: "Show the sharpened model" },
];

export const LOOKS = [
  { key: "clay", label: "Clay", tip: "Plain grey: the best look for judging crisp edges and flat panels" },
  { key: "color", label: "Color", tip: "The model's own colours and textures" },
  { key: "wire", label: "Wire", tip: "The real edges of the model" },
  { key: "panels", label: "Panels", tip: "After: one colour for each flat panel found. Before: the model's own groups" },
  { key: "normal", label: "Normal", tip: "Surface directions as colours, to spot faces pointing the wrong way" },
];

export const DEFAULT_STATE = Object.freeze({
  strength: "medium", keepRound: true, symmetry: "off", panelsAsGroups: true, keepColours: true,
  show: "after", look: "clay", view: "Q", az: 40, el: 20, zoom: 1, panX: 0, panY: 0,
  light: "studio", bright: 1, bg: "#262626",
  grid: true, arrow: false, marker: true, shadow: true,
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
  return {
    strength: STRENGTHS.some((x) => x.id === s.strength) ? s.strength : D.strength,
    keepRound: bool(s.keepRound, D.keepRound),
    symmetry: s.symmetry === "auto" ? "auto" : D.symmetry,
    panelsAsGroups: bool(s.panelsAsGroups, D.panelsAsGroups),
    keepColours: bool(s.keepColours, D.keepColours),
    show: SHOWS.some((x) => x.id === s.show) ? s.show : D.show,
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

/** What Python reads: only what changes the result. */
export function promptState(st) {
  return {
    strength: st.strength, keepRound: st.keepRound, symmetry: st.symmetry,
    panelsAsGroups: st.panelsAsGroups, keepColours: st.keepColours,
  };
}

/** The result's settings as one comparable string (a run's own `request` or the settings on the node). */
export function requestKey(st) {
  const p = promptState(sanitizeState(st));
  return JSON.stringify([p.strength, p.keepRound, p.symmetry, p.panelsAsGroups, p.keepColours]);
}

/** The state the shared renderer draws a stage node with. */
export function engineState(st) {
  return { ...st, proj: "persp", fov: 35, w: 1024, h: 1024, up: "Y", turn: 0 };
}

// ── the last run, kept on the node so a tab switch shows it again ──────────
export function readLastRun(node) {
  const r = node?.properties?.[LAST_RUN_KEY];
  const ok = (ref) => ref && typeof ref.filename === "string";
  return r && typeof r === "object" && ok(r.before) && ok(r.after) ? r : null;
}

/** From the executed event only (a run's result may be kept, Vue Compat #11). Small on purpose. */
export function writeLastRun(node, report) {
  if (!node) return;
  node.properties = node.properties || {};
  node.properties[LAST_RUN_KEY] = {
    before: report.before, after: report.after, panels: report.panels | 0,
    stats: report.stats && typeof report.stats === "object" ? report.stats : {},
    census: report.census || null, faces: report.faces || null, source: report.source || "",
    colours: !!report.colours, texture: !!report.texture,
    request: report.request && typeof report.request === "object" ? report.request : null,
    lines: Array.isArray(report.lines) ? report.lines.slice(0, 16) : [],
    notes: Array.isArray(report.notes) ? report.notes.slice(0, 16) : [],
    seconds: num(report.seconds, 0), stamp: report.stamp,
  };
}

/** A file reference from the report as the renderer's model value: "sub/file.obj [temp]". */
export function refValue(ref) {
  if (!ref || typeof ref.filename !== "string") return "";
  const sub = String(ref.subfolder || "").replace(/\\/g, "/").replace(/\/+$/, "");
  return `${sub ? sub + "/" : ""}${ref.filename} [${ref.type || "temp"}]`;
}

/** Did the settings that shape the result change since the last run? */
export function runIsStale(node) {
  const run = readLastRun(node);
  return !!run?.request && requestKey(run.request) !== requestKey(readState(node));
}

export function facesText(faces) {
  if (!faces) return "";
  const parts = [];
  if (faces.quads) parts.push(`${fmtInt(faces.quads)} quads`);
  if (faces.triangles) parts.push(`${fmtInt(faces.triangles)} triangles`);
  if (faces.ngons) parts.push(`${fmtInt(faces.ngons)} larger polygons`);
  return parts.join(" + ");
}

/** The info line under the view. */
export function runInfo(run) {
  if (!run) return "";
  if (!run.panels) return "No flat panels found: the model was not changed";
  const st = run.stats || {};
  const parts = [run.panels === 1 ? "1 flat panel" : `${fmtInt(run.panels)} flat panels`];
  if (st.round_panels) parts.push(st.round_panels === 1 ? "1 round part kept" : `${fmtInt(st.round_panels)} round parts kept`);
  if (Number.isFinite(st.bent_before) && Number.isFinite(st.bent_after)) {
    parts.push(`crisp edges ${st.bent_before.toFixed(1)}% -> ${st.bent_after.toFixed(1)}%`);
  }
  if (Number.isFinite(st.moved_max_mm)) parts.push(`moved at most ${st.moved_max_mm.toFixed(2)} mm`);
  return parts.join(" · ");
}

export function inputsUnwired(node) {
  const find = (name) => node?.inputs?.find((i) => i?.name === name);
  const mesh = find("mesh");
  const file = find("model_3d");
  if (!mesh && !file) return false;
  return mesh?.link == null && file?.link == null;
}
