// Number Pick Pixaroma - state.
//
// Vue Compat #9: everything lives on node.properties.numberPickState and is
// injected into the hidden NumberPickState input at graphToPrompt time, so the
// node has no visible widgets and no stray input dot.

export const CLASS = "PixaromaNumberPick";
export const HIDDEN_INPUT = "NumberPickState";
export const STATE_PROP = "numberPickState";

// The face is ONE row of buttons sitting in Classic's output-slot band, so the
// node is barely taller than its own title. 280 is Duration's width for the
// same reason: at anything narrower a sixth chip wraps, and the row must never
// wrap (see ui.mjs).
export const MIN_W = 280;
export const DEFAULT_W = 320;
export const ROW_H = 26;
export const BODY_PAD = 6;

// Mirrors LIMIT in nodes/_number_pick_helpers.py.
const LIMIT = 1e12;

export const OUT_AUTO = "auto";
export const OUT_INT = "int";
export const OUT_FLOAT = "float";

export const DEFAULT_STATE = {
  // --- what Python reads (these, and ONLY these, reach the prompt) ----------
  value: 4,
  out: OUT_AUTO,           // set by adopt.mjs from whatever it is wired to
  // --- how the face looks (never sent; see injectedState) ------------------
  values: [1, 2, 4, 8, 16, 32],
};

// The keys Python reads. Anything else is presentation, and sending it would
// change the node's cache signature - so editing the button list, or picking a
// chip you then change your mind about, would silently re-run the whole
// workflow (duration.md #7, and [[reference_cosmetic_key_in_injected_state_recaches]]).
const PROMPT_KEYS = ["value", "out"];

function clampNum(value, fallback) {
  const out = typeof value === "number" ? value : parseFloat(value);
  if (!Number.isFinite(out)) return fallback;
  return Math.max(-LIMIT, Math.min(LIMIT, out));
}

export function readState(node) {
  const raw = node?.properties?.[STATE_PROP];
  const st = { ...DEFAULT_STATE, ...(raw && typeof raw === "object" ? raw : {}) };
  st.value = clampNum(st.value, DEFAULT_STATE.value);
  if (![OUT_AUTO, OUT_INT, OUT_FLOAT].includes(st.out)) st.out = OUT_AUTO;
  if (!Array.isArray(st.values)) st.values = [...DEFAULT_STATE.values];
  // A button list is a set of numbers, sorted, deduped and capped: it is drawn
  // as ONE row that never wraps, so an accidental 200-entry paste must not make
  // the node unusable.
  st.values = [...new Set(st.values
    .map((v) => clampNum(v, NaN))
    .filter((v) => Number.isFinite(v)))].sort((a, b) => a - b).slice(0, 12);
  if (!st.values.length) st.values = [...DEFAULT_STATE.values];
  return st;
}

export function writeState(node, patch) {
  if (!node) return DEFAULT_STATE;
  const next = { ...readState(node), ...(patch || {}) };
  node.properties = node.properties || {};
  node.properties[STATE_PROP] = next;
  return next;
}

/** Only the keys Python reads (see PROMPT_KEYS). */
export function injectedState(node) {
  const st = readState(node);
  const out = {};
  for (const key of PROMPT_KEYS) out[key] = st[key];
  return out;
}

/**
 * Trim float dust for display, and keep a whole number whole: 4 -> "4",
 * 4.5 -> "4.5", 0.30000000000000004 -> "0.3".
 */
export function fmt(value) {
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(rounded);
}

/**
 * What the node will actually send, mirroring coerce() in the Python. Only the
 * int branch can change the number; auto and float pass it through, and auto
 * differs from float only in the TYPE Python emits, which is not visible here.
 */
export function previewValue(st) {
  return st.out === OUT_INT ? Math.round(st.value) : st.value;
}
