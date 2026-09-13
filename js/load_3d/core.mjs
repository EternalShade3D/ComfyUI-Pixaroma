// Load 3D Pixaroma - state, constants and small pure helpers.
//
// The node's own state lives on node.properties (Vue Compat #9). Only what the
// picture needs travels to Python, and only as part of the injected
// Load3DState (see index.js), so a purely cosmetic change such as the grid or
// the accent never invalidates the cache.

export const CLASS = "PixaromaLoad3D";
export const HIDDEN_INPUT = "Load3DState";
export const STATE_KEY = "pixLoad3DState";
export const MODEL_WIDGET = "model_file";
export const UI_WIDGET = "pixaroma_load3d_ui";
export const NONE = "none";
export const CAPTURE_SUBFOLDER = "pixaroma_load3d";
export const MODEL_EXTS = ["glb", "gltf", "obj", "fbx", "stl", "ply"];
export const UPLOAD_ACCEPT = ".glb,.gltf,.obj,.fbx,.stl,.ply,.mtl,.bin,.png,.jpg,.jpeg,.webp,.bmp,.tga";
export const MIN_SIDE = 64;
export const MAX_SIDE = 4096;

// Bump when the way a picture is drawn changes, so a stale upload is not reused.
export const ENGINE_VERSION = 1;

export const LOOKS = [
  { key: "color", label: "Color", tip: "The model's own colours and textures" },
  { key: "clay", label: "Clay", tip: "Plain grey, only the shape: no colours or textures" },
  { key: "normal", label: "Normal", tip: "Surface directions as colours, for a normal ControlNet" },
  { key: "depth", label: "Depth", tip: "Near is white, far is black, for a depth ControlNet" },
  { key: "wire", label: "Wire", tip: "Shows the edges of the mesh" },
];

// Where the CAMERA stands. Left is the model's own left side, so the model
// looks towards the LEFT edge of the picture - the convention multi-view 3D
// models use (Pixal3DMultiViewConditioning's own azimuths).
export const VIEWS = [
  { key: "F", label: "Front", az: 0, el: 0, tip: "Front: the model looks at you" },
  { key: "B", label: "Back", az: 180, el: 0, tip: "Back" },
  { key: "L", label: "Left", az: 90, el: 0, tip: "Left: the model's own left side, looking to the left edge" },
  { key: "R", label: "Right", az: -90, el: 0, tip: "Right: the model's own right side, looking to the right edge" },
  { key: "T", label: "Top", az: 0, el: 90, tip: "Top: seen from above, front at the bottom" },
  { key: "Q", label: "3/4", az: 40, el: 20, tip: "Three-quarter: a front corner, a little from above" },
];

export const LIGHTS = ["studio", "soft", "flat"];

export const DEFAULT_STATE = Object.freeze({
  w: 1024, h: 1024, look: "color", view: "F", az: 0, el: 0, zoom: 1, panX: 0, panY: 0,
  light: "studio", bright: 1, bg: "#262626", proj: "persp", fov: 35, up: "Y", turn: 0, grid: true,
});

const HEX = /^#[0-9a-f]{6}$/i;
const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function sanitizeState(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const D = DEFAULT_STATE;
  const side = (v, d) => clamp(Math.round(num(v, d)), MIN_SIDE, MAX_SIDE);
  let az = num(s.az, D.az) % 360;
  if (az > 180) az -= 360;
  if (az < -180) az += 360;
  let view = D.view;
  if (s.view === null) view = null;
  else if (s.view !== undefined) view = VIEWS.some((v) => v.key === s.view) ? s.view : null;
  return {
    w: side(s.w, D.w),
    h: side(s.h, D.h),
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
    proj: s.proj === "ortho" ? "ortho" : "persp",
    fov: clamp(num(s.fov, D.fov), 10, 100),
    up: s.up === "Z" ? "Z" : "Y",
    turn: ((Math.round(num(s.turn, D.turn)) % 4) + 4) % 4,
    grid: s.grid !== false,
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

function fnv1a(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function hashHex(str) {
  const a = fnv1a(str, 2166136261).toString(16).padStart(8, "0");
  const b = fnv1a(str, 0x5bd1e995).toString(16).padStart(8, "0");
  return a + b;
}

/** Everything that changes the PICTURE, and nothing that does not. */
export function renderKey(model, st) {
  const r = (v, p) => Math.round(v * p) / p;
  return hashHex(JSON.stringify([
    ENGINE_VERSION, String(model || ""), st.w, st.h, st.look, r(st.az, 100), r(st.el, 100),
    r(st.zoom, 1e4), r(st.panX, 1e4), r(st.panY, 1e4), st.light, r(st.bright, 100), st.bg,
    st.proj, r(st.fov, 100), st.up, st.turn,
  ]));
}

/** "3d/sub/a.glb [output]" -> its folder type, subfolder, filename and extension. */
export function splitModelName(value) {
  let bare = String(value || "");
  let type = "input";
  const m = bare.match(/ \[(input|output|temp)\]$/);
  if (m) {
    type = m[1];
    bare = bare.slice(0, -m[0].length);
  }
  bare = bare.replace(/\\/g, "/");
  const cut = bare.lastIndexOf("/");
  const filename = cut >= 0 ? bare.slice(cut + 1) : bare;
  const subfolder = cut >= 0 ? bare.slice(0, cut) : "";
  const dot = filename.lastIndexOf(".");
  const ext = dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
  return { value: String(value || ""), bare, type, subfolder, filename, ext };
}

export function isModelFile(name) {
  return MODEL_EXTS.includes(splitModelName(name).ext);
}

export function fmtBytes(n) {
  if (!(n > 0)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  const mb = n / 1048576;
  return mb >= 10 ? `${mb.toFixed(1)} MB` : `${mb.toFixed(2)} MB`;
}

export function fmtInt(n) {
  return Math.round(n || 0).toLocaleString("en-US");
}
