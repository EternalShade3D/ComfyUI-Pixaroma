// Quad Remesh Pixaroma - state, constants and small pure helpers.
//
// The node's own state lives on node.properties (Vue Compat #9). Only the keys that change the result
// travel to Python (promptState), so turning the view, picking a look or switching Before and Quads
// never re-runs the node. Adapted from js/hard_surface/core.mjs.

import { VIEWS, LIGHTS, fmtInt } from "../load_3d/core.mjs";

export { VIEWS, LIGHTS };

export const CLASS = "PixaromaQuadRemesh";
export const HIDDEN_INPUT = "QuadRemeshState";
export const STATE_KEY = "pixQuadRemeshState";
export const LAST_RUN_KEY = "pixQuadRemeshLastRun";
export const UI_WIDGET = "pixaroma_quadremesh_ui";
// Namespaced, so a registered Vue widget type can never claim it (the Show Text bug).
export const WIDGET_TYPE = "pixaroma_quadremesh";

export const DENSITIES = [
  { id: 5000, label: "5K", tip: "5,000 quads: big quads for a quick low-poly model" },
  { id: 10000, label: "10K", tip: "10,000 quads" },
  { id: 25000, label: "25K", tip: "25,000 quads: lighter, and small details come out rough" },
  { id: 50000, label: "50K", tip: "50,000 quads" },
  { id: 100000, label: "100K", tip: "100,000 quads, the default: crisp slots, buttons and panel lines on hard-surface models" },
  { id: 200000, label: "200K", tip: "200,000 quads: for characters and small round details such as fingers and rings, about twice as long as 100K" },
];

export const SYMMETRIES = [
  { id: "off", label: "Off", tip: "No mirror: the whole model is remeshed as it is" },
  { id: "auto", label: "Auto", tip: "Mirror the model when it is symmetric, and leave it whole when it is not" },
  { id: "x", label: "X", tip: "Mirror across X (left and right on the node's marker)" },
  { id: "y", label: "Y", tip: "Mirror across Y (top and bottom)" },
  { id: "z", label: "Z", tip: "Mirror across Z (front and back)" },
];

export const SHOWS = [
  { id: "before", label: "Before", tip: "Show the model as it came in" },
  { id: "after", label: "Quads", tip: "Show the new quads" },
];

export const LOOKS = [
  { key: "wire", label: "Wire", tip: "The quads' real edges" },
  { key: "clay", label: "Clay", tip: "Plain grey: the best look for judging crisp edges and flat panels" },
  { key: "panels", label: "Panels", tip: "One colour for each group: Hard Surface's panels carried onto the quads, or the model's own groups" },
  { key: "color", label: "Color", tip: "The colours carried over from the model" },
  { key: "normal", label: "Normal", tip: "Surface directions as colours, to spot faces pointing the wrong way" },
];

export const DEFAULT_STATE = Object.freeze({
  quads: 100000, symmetry: "auto", crisp: true, keepColours: true, keepGroups: true,
  show: "after", look: "wire", view: "Q", az: 40, el: 20, zoom: 1, panX: 0, panY: 0,
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
    quads: DENSITIES.some((d) => d.id === s.quads) ? s.quads : D.quads,
    symmetry: SYMMETRIES.some((x) => x.id === s.symmetry) ? s.symmetry : D.symmetry,
    crisp: bool(s.crisp, D.crisp),
    keepColours: bool(s.keepColours, D.keepColours),
    keepGroups: bool(s.keepGroups, D.keepGroups),
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
    quads: st.quads, symmetry: st.symmetry, crisp: st.crisp, keepColours: st.keepColours, keepGroups: st.keepGroups,
  };
}

/** The result's settings as one comparable string (a run's own `request` or the settings on the node). */
export function requestKey(st) {
  const p = promptState(sanitizeState(st));
  return JSON.stringify([p.quads, p.symmetry, p.crisp, p.keepColours, p.keepGroups]);
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
    before: report.before, after: report.after,
    stats: report.stats && typeof report.stats === "object" ? report.stats : {},
    census: report.census || null, faces: report.faces || null, source: report.source || "",
    colours: !!report.colours,
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
  const st = run.stats || {};
  const parts = [`${fmtInt(st.quads || 0)} quads`];
  if (run.census && Number.isFinite(run.census.poles_pct)) parts.push(`${run.census.poles_pct.toFixed(1)}% poles`);
  parts.push(st.symmetry_axis ? `mirrored across ${String(st.symmetry_axis).toUpperCase()}` : "no mirror");
  if (st.holes_filled) parts.push(`${fmtInt(st.holes_filled)} holes closed`);
  return parts.join(" · ");
}

export function inputsUnwired(node) {
  const find = (name) => node?.inputs?.find((i) => i?.name === name);
  const mesh = find("mesh");
  const file = find("model_3d");
  if (!mesh && !file) return false;
  return mesh?.link == null && file?.link == null;
}
