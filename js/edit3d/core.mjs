// Edit 3D Pixaroma - constants, the node's state (node.properties, Vue Compat #9), the last run, and where the
// editor opens its model from. No DOM, no three.
import { splitModelName, fmtInt } from "../load_3d/core.mjs";
import { BRUSH_IDS } from "./brushes.mjs";

export { splitModelName, fmtInt };
export const CLASS = "PixaromaEdit3D";
export const OP_CLASS = "PixaromaEdit3DOp";
export const HIDDEN_INPUT = "Edit3DState";
export const OP_INPUT = "Edit3DOp";
export const UI_KEY = "pixaroma_edit3d";
export const OP_UI_KEY = "pixaroma_edit3d_op";
export const STATE_KEY = "pixEdit3DState";
export const LAST_RUN_KEY = "pixEdit3DLastRun";
export const MODEL_WIDGET = "model_file";
export const UI_WIDGET = "pixaroma_edit3d_ui";
// A UNIQUE widget type, or Nodes 2.0 renders its own widget for it and orphans ours.
export const WIDGET_TYPE = "pixaroma_edit3d";
export const SUBFOLDER = "pixaroma_edit3d";
export const NONE = "none";
export const MAX_EDITS = 12;
export const LOOKS = ["clay", "color", "wire", "normal"];
export const SYM_AXES = ["off", "x", "y", "z"];
// The editing modes, in the order of the switch at the top of the left column.
export const MODES = ["model", "sculpt", "polys"];
export const LOCKS = ["off", "protect", "only"];

// The SAME rule as nodes/_edit3d_helpers.py EDITED_NAME.
const EDITED_RE = /^edit3d_(?![A-Za-z0-9_-]*_work(?:_out)?\.)[A-Za-z0-9_-]{1,40}\.(obj|glb)$/;
const FILE_ID_RE = /^[a-z0-9]{12}$/;

export const DEFAULT_PREFS = Object.freeze({
  look: "clay", symmetry: "off", through: false, brush: 0.03, xray: false, holes: false, mode: "model",
  brushId: "smooth", strengths: {}, lock: "off",
});
export const DEFAULT_STATE = Object.freeze({
  edited: "", sourceKey: "", editCount: 0, edits: [], stamp: 0, fileId: "", prefs: DEFAULT_PREFS,
});

const num = (v, lo, hi, d) => (Number.isFinite(v) && v >= lo && v <= hi ? v : d);

/** Each brush remembers its own strength: Smooth wants half, Flatten less. Unknown ids are dropped. */
function sanitizeStrengths(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const out = {};
  for (const id of BRUSH_IDS) if (Number.isFinite(s[id])) out[id] = Math.min(1, Math.max(0.05, s[id]));
  return out;
}

export function sanitizePrefs(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const D = DEFAULT_PREFS;
  return {
    look: LOOKS.includes(s.look) ? s.look : D.look,
    // Symmetry was called mirror before the modes, which is also the name of a whole-model button: a node saved then
    // keeps its axis.
    symmetry: SYM_AXES.includes(s.symmetry) ? s.symmetry : SYM_AXES.includes(s.mirror) ? s.mirror : D.symmetry,
    mode: MODES.includes(s.mode) ? s.mode : D.mode,
    brushId: BRUSH_IDS.includes(s.brushId) ? s.brushId : D.brushId,
    lock: LOCKS.includes(s.lock) ? s.lock : D.lock,
    strengths: sanitizeStrengths(s.strengths),
    through: typeof s.through === "boolean" ? s.through : D.through,
    brush: num(s.brush, 0.002, 0.3, D.brush),
    xray: typeof s.xray === "boolean" ? s.xray : D.xray,
    holes: typeof s.holes === "boolean" ? s.holes : D.holes,
  };
}

export function sanitizeState(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  return {
    edited: typeof s.edited === "string" && EDITED_RE.test(s.edited) ? s.edited : "",
    sourceKey: typeof s.sourceKey === "string" ? s.sourceKey.slice(0, 200) : "",
    editCount: Number.isInteger(s.editCount) && s.editCount >= 0 ? s.editCount : 0,
    edits: Array.isArray(s.edits) ? s.edits.filter((e) => typeof e === "string").map((e) => e.slice(0, 160)).slice(-MAX_EDITS) : [],
    stamp: Number.isFinite(s.stamp) ? s.stamp : 0,
    fileId: typeof s.fileId === "string" && FILE_ID_RE.test(s.fileId) ? s.fileId : "",
    prefs: sanitizePrefs(s.prefs),
  };
}

export function readState(node) {
  return sanitizeState(node?.properties?.[STATE_KEY]);
}

/** ONLY from a real user action (Save, closing the editor with new preferences), never on the load path (Vue Compat #18). */
export function writeState(node, patch) {
  if (!node) return;
  node.properties = node.properties || {};
  node.properties[STATE_KEY] = sanitizeState({ ...readState(node), ...patch });
}

/** What Python reads. editCount only feeds the report text and changes exactly when the edit does. */
export function promptState(st) {
  return { edited: st.edited, sourceKey: st.sourceKey, editCount: st.editCount };
}

export function readLastRun(node) {
  const r = node?.properties?.[LAST_RUN_KEY];
  return r && typeof r === "object" && typeof r.stamp === "number" ? r : null;
}

/** From the executed event only. Small on purpose: the refs, the key, the counts and the notes. */
export function writeLastRun(node, report) {
  if (!node) return;
  node.properties = node.properties || {};
  node.properties[LAST_RUN_KEY] = {
    stamp: report.stamp, used: report.used || "", sourceKey: String(report.sourceKey || "").slice(0, 200),
    input: report.input && typeof report.input.filename === "string" ? report.input : null,
    faces: report.faces || null, edges: report.edges || null, colours: !!report.colours, texture: !!report.texture,
    format: String(report.format || ""), notes: Array.isArray(report.notes) ? report.notes.slice(0, 4).map(String) : [],
  };
}

/** A file reference -> "sub/file.obj [temp]", the shape splitModelName reads. */
export function refValue(ref) {
  if (!ref || typeof ref.filename !== "string") return "";
  const sub = String(ref.subfolder || "").replace(/\\/g, "/").replace(/\/+$/, "");
  return `${sub ? sub + "/" : ""}${ref.filename} [${ref.type || "temp"}]`;
}

export function wiredInput(node) {
  for (const name of ["mesh", "model_3d"]) {
    const inp = node?.inputs?.find((i) => i?.name === name);
    if (inp && inp.link != null) return name;
  }
  return "";
}
export const inputsWired = (node) => !!wiredInput(node);

export function modelWidget(node) {
  return node?.widgets?.find((w) => w && w.name === MODEL_WIDGET) || null;
}
export function modelValues(node) {
  const vals = modelWidget(node)?.options?.values;
  return Array.isArray(vals) ? vals.filter((v) => v && v !== NONE) : [];
}
export function pickedValue(node) {
  return String(modelWidget(node)?.value ?? NONE);
}

export const editedName = (fileId, ext) => `edit3d_${fileId}.${ext}`;
export const snapName = (fileId) => `edit3d_${fileId}_snap.png`;
export const workName = (fileId, ext) => `edit3d_${fileId}_work.${ext}`;

export function newFileId() {
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(12);
  (globalThis.crypto || window.crypto).getRandomValues(bytes);
  return Array.from(bytes, (b) => abc[b % abc.length]).join("");
}

/** The node's file id, or a new one when it has none or another Edit 3D node already uses it (a copied node
 *  carries its original's properties, and two nodes must never write the same file). */
export function fileIdFor(node, graph) {
  const own = readState(node).fileId;
  if (!own) return newFileId();
  const nodes = graph?._nodes || graph?.nodes || [];
  const clash = nodes.some((n) => n && n !== node && (n.comfyClass === CLASS || n.type === CLASS) && readState(n).fileId === own);
  return clash ? newFileId() : own;
}

/** Where the editor opens its model from: {value, kind, sourceKey} or {error}. */
export function sourceRef(node) {
  const wired = wiredInput(node);
  if (wired) {
    const run = readLastRun(node);
    if (!run?.input) {
      return { error: "Run the workflow once so the model wired into " + wired + " reaches this node, then press Open Edit 3D." };
    }
    return { value: refValue(run.input), kind: "wired", sourceKey: run.sourceKey };
  }
  const v = pickedValue(node);
  if (!v || v === NONE) return { error: "Pick a model on the node, use Upload, or wire a mesh or a model_3d in." };
  return { value: v, kind: "picked", sourceKey: "" };
}

export function facesText(faces) {
  if (!faces) return "";
  const parts = [];
  if (faces.quads) parts.push(`${fmtInt(faces.quads)} quads`);
  if (faces.triangles) parts.push(`${fmtInt(faces.triangles)} triangles`);
  if (faces.ngons) parts.push(`${fmtInt(faces.ngons)} larger polygons`);
  return parts.join(" + ") || "no faces";
}
