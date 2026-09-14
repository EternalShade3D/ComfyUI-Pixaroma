// Mesh Repair Pixaroma - state and geometry.
//
// Vue Compat #9: everything lives on node.properties.meshRepairState and is
// injected into the hidden MeshRepairState input at graphToPrompt time, so the
// node has no visible widgets and no stray input dot. Every option list here
// MIRRORS nodes/_mesh_repair_helpers.py - add a value there too, or Python
// quietly falls back to its default.

export const CLASS = "PixaromaMeshRepair";
export const HIDDEN_INPUT = "MeshRepairState";
export const STATE_PROP = "meshRepairState";

export const MODES = [
  {
    id: "solid",
    label: "Make solid",
    title: "Rebuild the model as one closed solid - the one to use for 3D printing. It fills the " +
           "hollow inside, closes every hole and removes broken edges and loose bits.",
  },
  {
    id: "tidy",
    label: "Tidy only",
    title: "Keep the original triangles and textures and only clean them: remove loose bits, turn " +
           "wrong-way faces around and close small holes. It cannot fill a hollow model.",
  },
];

// Cells across the model's longest side. The `mm` figure is the size of one
// cell on a model printed 100 mm long, which is what "smallest detail" means.
export const DETAILS = [
  { value: 256, label: "Low", title: "Quick. Smallest detail about 0.4 mm on a 100 mm print." },
  { value: 384, label: "Medium", title: "The default. Smallest detail about 0.26 mm on a 100 mm print." },
  { value: 512, label: "High", title: "Finer detail, about 0.2 mm on a 100 mm print, for about twice the time." },
  { value: 768, label: "Max", title: "Finest detail, about 0.13 mm on a 100 mm print. Much slower and needs several GB of memory." },
];

export const SEALS = [
  { value: "auto", label: "Auto", title: "Finds the smallest seal that makes the inside solid." },
  { value: 0.5, label: "0.5%", title: "Close gaps up to 0.5% of the model's longest side." },
  { value: 1, label: "1%", title: "Close gaps up to 1% of the model's longest side." },
  { value: 2, label: "2%", title: "Close gaps up to 2% of the model's longest side." },
  { value: 3, label: "3%", title: "Close gaps up to 3% of the model's longest side." },
  { value: 5, label: "5%", title: "Close gaps up to 5% of the model's longest side. Also closes real slots and gaps that narrow." },
];

export const LOOSE = [
  { value: 0, label: "Off", title: "Keep every piece, however small." },
  { value: 0.5, label: "0.5%", title: "Remove pieces smaller than 0.5% of the biggest piece." },
  { value: 1, label: "1%", title: "Remove pieces smaller than 1% of the biggest piece." },
  { value: 2, label: "2%", title: "Remove pieces smaller than 2% of the biggest piece." },
  { value: 5, label: "5%", title: "Remove pieces smaller than 5% of the biggest piece." },
];

export const TRIANGLES = [
  { value: "input", label: "Same as the input", title: "No more triangles than came in. A rebuild usually makes more, so they are reduced back down." },
  { value: "all", label: "Keep them all", title: "Never reduce. The rebuild can have up to four times the triangles." },
  { value: 100000, label: "100k", title: "At most 100,000 triangles." },
  { value: 250000, label: "250k", title: "At most 250,000 triangles." },
  { value: 500000, label: "500k", title: "At most 500,000 triangles." },
  { value: 1000000, label: "1M", title: "At most 1,000,000 triangles." },
  { value: 2000000, label: "2M", title: "At most 2,000,000 triangles." },
];

// The longest side of the stl output. "model" keeps the model's own units, and
// an AI model is usually about one unit across, which a slicer reads as 1 mm.
export const PRINT_SIZES = [
  { value: 50, label: "50 mm", title: "The model in the stl file is 50 mm along its longest side." },
  { value: 100, label: "100 mm", title: "The default. The model in the stl file is 100 mm along its longest side." },
  { value: 150, label: "150 mm", title: "The model in the stl file is 150 mm along its longest side." },
  { value: 200, label: "200 mm", title: "The model in the stl file is 200 mm along its longest side." },
  { value: 300, label: "300 mm", title: "The model in the stl file is 300 mm along its longest side." },
  { value: "model", label: "Model units", title: "No scaling. An AI model is usually about one unit across, which a slicer reads as about 1 mm." },
];

export const DEFAULT_STATE = {
  mode: "solid",
  detail: 384,
  seal: "auto",
  loose: 1,
  keepDetail: true,
  keepColours: true,
  triangles: "input",
  printSize: 100,
};

// Every key reaches Python: each one changes the result. Nothing cosmetic is
// stored here - the Before/After view of the cut is runtime only - so there is
// nothing that could change the cache key without changing the model.
const PROMPT_KEYS = ["mode", "detail", "seal", "loose", "keepDetail", "keepColours", "triangles", "printSize"];

// ── geometry ───────────────────────────────────────────────────────────────
export const MIN_W = 300;
export const DEFAULT_W = 340;
export const PAD_X = 6;
export const PAD_Y = 2;
export const GAP = 5;
export const ROW_H = 26;       // the mode switch and the gear
export const LABEL_H = 12;     // "DETAIL"
export const CHIPS_H = 34;     // two-line detail chips
export const HINT_H = 14;
export const FIELD_H = 26;     // a dropdown row
export const SWITCH_H = 18;
export const PREVIEW_H = 150;  // the cut through the model
export const REPORT_ROW_H = 17;
export const REPORT_ROWS = 6;
export const REPORT_PAD = 8;
export const STATUS_H = 26;
// Nodes 2.0 puts a 4px gap between the slot block and the widget block; the
// face cancels it so the first row sits right under the dots (free-vram.md #9c).
export const VUE_GAP_CANCEL = 4;

/** The face's own content height. Make solid shows more rows than Tidy only. */
export function contentHeight(mode = "solid") {
  const solid = mode !== "tidy";
  const rows = [
    ROW_H,
    ...(solid ? [LABEL_H, CHIPS_H, HINT_H, FIELD_H] : []),
    FIELD_H,
    SWITCH_H,
    PREVIEW_H,
    REPORT_ROWS * REPORT_ROW_H + REPORT_PAD,
    STATUS_H,
  ];
  return PAD_Y * 2 + rows.reduce((a, b) => a + b, 0) + GAP * (rows.length - 1);
}

function pick(value, options, fallback) {
  for (const o of options) {
    if (o.value === value) return o.value;
    if (typeof o.value === "number" && typeof value !== "boolean" && value !== "" && value !== null
        && Number(value) === o.value) return o.value;
  }
  return fallback;
}

export function readState(node) {
  const raw = node?.properties?.[STATE_PROP];
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    mode: MODES.some((m) => m.id === src.mode) ? src.mode : DEFAULT_STATE.mode,
    detail: pick(src.detail, DETAILS, DEFAULT_STATE.detail),
    seal: pick(src.seal, SEALS, DEFAULT_STATE.seal),
    loose: pick(src.loose, LOOSE, DEFAULT_STATE.loose),
    keepDetail: typeof src.keepDetail === "boolean" ? src.keepDetail : DEFAULT_STATE.keepDetail,
    keepColours: typeof src.keepColours === "boolean" ? src.keepColours : DEFAULT_STATE.keepColours,
    triangles: pick(src.triangles, TRIANGLES, DEFAULT_STATE.triangles),
    printSize: pick(src.printSize, PRINT_SIZES, DEFAULT_STATE.printSize),
  };
}

export function writeState(node, patch) {
  if (!node) return { ...DEFAULT_STATE };
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

/** The print size the detail hint measures against: model units read as 100 mm. */
export function hintPrintMm(st) {
  return typeof st?.printSize === "number" ? st.printSize : 100;
}

/**
 * The last run's report, RUNTIME ONLY - deliberately never serialized, for the
 * same reason as Free VRAM's (free-vram.md #6): writing it into node.properties
 * on every run would flag an untouched workflow modified. The accepted cost is a
 * blank report again after a workflow tab switch.
 */
export function readReport(node) {
  return node?._pixMrReport || null;
}

export function writeReport(node, report) {
  if (node) node._pixMrReport = report || null;
  return report;
}

export function optionLabel(options, value) {
  return options.find((o) => o.value === value)?.label ?? String(value);
}

export function formatCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "-";
}
