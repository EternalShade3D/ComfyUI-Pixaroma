// Number Pick Pixaroma - the floating settings panel.
//
// Same shape as Free VRAM's and Save Video's: a draggable card that opens
// BESIDE the node and FOLLOWS it as the canvas is zoomed or panned (convention
// #29). The placement, follow loop and drag come from js/shared/node_panel.mjs,
// which carries the bug fixes they earned; this file owns only its singleton
// state and its rows.

import { createAccentSection } from "../shared/node_settings.mjs";
import { followNode, placeBeside, getNodeScreenRect, makeDraggable } from "../shared/node_panel.mjs";
import { installNativeTextMenu } from "../shared/native_text_menu.mjs";
import { readState, writeState, fmt, DEFAULT_STATE } from "./core.mjs";

let _panel = null;
let _panelNode = null;
let _onChange = null;
let _stopFollow = null;
let _userMoved = false; // has the user dragged the panel somewhere deliberately?
let _cpHandle = null;   // an open Pixaroma colour picker, so close can take it too
let _cssDone = false;

// One click each, for the lists people actually reach for. They are a starting
// point to edit, not a mode: picking one just writes those numbers into the
// field, so there is nothing to get out of sync with.
const QUICK_SETS = [
  { name: "Doubling", values: [1, 2, 4, 8, 16, 32], hint: "batch size, and most \"how many\" inputs" },
  { name: "Steps", values: [4, 8, 12, 20, 30, 40], hint: "a turbo model through to a slow one" },
  { name: "Tens", values: [10, 20, 30, 40, 50, 60] },
  { name: "Fine", values: [0.25, 0.5, 0.75, 1], hint: "decimals, for denoise or a strength" },
  { name: "Frame rates", values: [8, 12, 16, 24, 25, 30] },
];

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function injectPanelCSS() {
  if (_cssDone || document.getElementById("pix-npick-panel-css")) return;
  _cssDone = true;
  const style = document.createElement("style");
  style.id = "pix-npick-panel-css";
  style.textContent = [
    ".pix-npick-panel{position:fixed;z-index:10010;width:330px;max-width:94vw;background:#1a1a1a;border:1px solid #444;border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.6);font-family:'Segoe UI',system-ui,sans-serif;overflow:hidden;max-height:88vh;display:flex;flex-direction:column;}",
    ".pix-npick-phead{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #333;color:#ddd;font-size:13px;font-weight:600;cursor:move;}",
    ".pix-npick-px{border:0;background:transparent;color:#999;font-size:13px;cursor:pointer;padding:2px 7px;border-radius:4px;}",
    ".pix-npick-px:hover{color:#fff;}",
    ".pix-npick-pbody{padding:12px;display:flex;flex-direction:column;gap:12px;color:#ddd;overflow-y:auto;min-height:0;}",
    ".pix-npick-plab{font-size:12px;color:#ddd;}",
    ".pix-npick-psub{font-size:10px;color:#8f8f8f;margin-top:2px;line-height:1.4;}",
    // The house text field (convention #3): sunken dark = you may type.
    ".pix-npick-in{width:100%;box-sizing:border-box;margin-top:7px;background:#1d1d1d;color:#e0e0e0;border:1px solid #333;border-radius:4px;padding:6px 8px;font:12px monospace;outline:none;}",
    ".pix-npick-in:focus{border-color:var(--pix-acc,#f66744);}",
    ".pix-npick-quick{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px;}",
    ".pix-npick-qbtn{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.14);border-radius:4px;color:rgba(255,255,255,0.72);font:12px 'Segoe UI',sans-serif;padding:4px 8px;cursor:pointer;}",
    ".pix-npick-qbtn:hover{border-color:var(--pix-acc,#f66744);color:#ddd;}",
    ".pix-npick-prev{font-size:11px;color:var(--pix-acc,#f66744);margin-top:7px;min-height:15px;}",
    ".pix-npick-prev.bad{color:#e8694a;}",
  ].join("\n");
  document.head.appendChild(style);
}

function stopFollowing() {
  _stopFollow?.();
  _stopFollow = null;
}

function outsideClose(e) {
  if (!_panel) return;
  if (_panel.contains(e.target)) return;
  // The Pixaroma colour picker and the generic option popup both open on
  // document.body, and this guard is capture phase - so without exempting them,
  // picking a colour would dismiss the panel underneath.
  if (e.target.closest?.(".pix-cp-popup, .pix-cp-modal-backdrop, .pix-nset-pop")) return;
  // The face's own gear acts on `click`, which lands AFTER this pointerdown -
  // without this the panel would close and instantly reopen, so the gear could
  // never shut what it opened.
  if (e.target.closest?.(".pix-npick-gear")) return;
  closeSettingsPanel();
}

function escClose(e) {
  if (e.key === "Escape" && _panel) {
    e.stopPropagation();
    closeSettingsPanel();
  }
}

export function closeSettingsPanel() {
  stopFollowing();
  try { _cpHandle?.close?.(); } catch {}
  _cpHandle = null;
  if (_panel) {
    try { _panel.remove(); } catch {}
  }
  _panel = null;
  _panelNode = null;
  _onChange = null;
  // Reset on CLOSE, not on open: resetting on open would make one dragged panel
  // teach the next one to sit still where the node is not.
  _userMoved = false;
  document.removeEventListener("pointerdown", outsideClose, true);
  document.removeEventListener("keydown", escClose, true);
}

// onRemoved hook: only close the panel when it belongs to the deleted node.
export function closeSettingsPanelFor(node) {
  if (_panelNode === node) closeSettingsPanel();
}

/** "1, 2, 4" / "1 2 4" / "1;2;4" -> [1,2,4]. Anything unreadable is dropped. */
export function parseList(text) {
  return String(text || "")
    .split(/[^0-9.+-]+/)
    .map((piece) => parseFloat(piece))
    .filter((n) => Number.isFinite(n));
}

/** The closest button to a value, so an edited list keeps a sensible pick. */
function nearest(values, value) {
  let best = values[0];
  for (const v of values) if (Math.abs(v - value) < Math.abs(best - value)) best = v;
  return best;
}

function section(body, label, sub) {
  const wrap = el("div");
  wrap.appendChild(el("div", "pix-npick-plab", label));
  if (sub) wrap.appendChild(el("div", "pix-npick-psub", sub));
  body.appendChild(wrap);
  return wrap;
}

export function openSettingsPanel(node, onChange) {
  closeSettingsPanel();
  injectPanelCSS();
  _onChange = onChange || null;
  const panel = el("div", "pix-npick-panel");
  _panel = panel;
  _panelNode = node;

  const head = el("div", "pix-npick-phead");
  head.appendChild(el("span", null, "Number Pick settings"));
  const x = el("button", "pix-npick-px", "✕");
  x.type = "button";
  x.onclick = closeSettingsPanel;
  head.appendChild(x);
  panel.appendChild(head);
  // The ✕ sits INSIDE the drag handle, and makeDraggable calls preventDefault +
  // setPointerCapture on pointerdown - so without ignoreSelector the click never
  // lands and the button does nothing.
  makeDraggable(panel, head, {
    onUserMove: () => { _userMoved = true; },
    ignoreSelector: ".pix-npick-px",
  });

  const body = el("div", "pix-npick-pbody");

  // ── the buttons ──
  const wrap = section(body, "The buttons",
    "The numbers this node offers. Separate them however you like: commas, " +
    "spaces or new lines all work. Decimals are fine. They are sorted for you, " +
    "and up to 12 fit on the row.");

  const input = el("input", "pix-npick-in");
  input.type = "text";
  input.spellcheck = false;
  input.value = readState(node).values.map((v) => fmt(v)).join(", ");
  input.title = "Type the numbers you want on the node";
  // A text field in our own UI must keep the browser's right-click menu, or
  // there is no way to paste into it with the mouse (convention #33).
  installNativeTextMenu(wrap);
  wrap.appendChild(input);

  const preview = el("div", "pix-npick-prev", "");
  wrap.appendChild(preview);

  const apply = (raw, { keepText = false } = {}) => {
    const values = parseList(raw);
    if (!values.length) {
      // Refuse rather than silently resetting to the defaults: the user is
      // mid-edit, and wiping their line would be worse than saying nothing yet.
      preview.className = "pix-npick-prev bad";
      preview.textContent = "Type at least one number";
      return;
    }
    const st = writeState(node, { values });
    // readState sorts, dedupes and caps, so read it BACK rather than trusting
    // what was typed - otherwise the preview and the node disagree at 13 values.
    const after = readState(node);
    if (!after.values.some((v) => Math.abs(v - after.value) < 1e-9)) {
      writeState(node, { value: nearest(after.values, after.value) });
    }
    const final = readState(node);
    preview.className = "pix-npick-prev";
    preview.textContent = `${final.values.length} button${final.values.length === 1 ? "" : "s"}, `
      + `sending ${fmt(final.value)}`;
    if (!keepText) input.value = final.values.map((v) => fmt(v)).join(", ");
    _onChange?.();
  };

  // On `input`, not `change`: the node updates as you type, which is how you
  // see 12 buttons become 12 rather than finding out after you click away.
  // The text is left EXACTLY as typed while the field has focus (keepText), or
  // re-sorting would move the caret out from under the user mid-word.
  input.addEventListener("input", () => apply(input.value, { keepText: true }));
  input.addEventListener("change", () => apply(input.value));
  input.addEventListener("blur", () => apply(input.value));
  apply(input.value, { keepText: true });

  // ── quick sets ──
  const qWrap = section(body, "Or start from one of these",
    "Puts those numbers in the field above, ready to edit.");
  const quick = el("div", "pix-npick-quick");
  for (const set of QUICK_SETS) {
    const b = el("button", "pix-npick-qbtn", set.name);
    b.type = "button";
    b.title = set.values.map((v) => fmt(v)).join(", ") + (set.hint ? ` - ${set.hint}` : "");
    b.onclick = (e) => {
      e.stopPropagation();
      input.value = set.values.map((v) => fmt(v)).join(", ");
      apply(input.value);
    };
    quick.appendChild(b);
  }
  qWrap.appendChild(quick);

  // ── accent colour (convention #19) ──
  // Pass NO title: `title` is what the helper puts in the "New <X> nodes"
  // button, and it already reads "Number Pick" from the registry.
  body.appendChild(createAccentSection(node, {
    onChange: () => _onChange?.(),
    onPickerOpen: (h) => { _cpHandle = h; },
  }));

  panel.appendChild(body);
  document.body.appendChild(panel);
  placeBeside(panel, getNodeScreenRect(node));
  _stopFollow = followNode(panel, node, {
    isCurrent: () => _panel === panel,
    isUserMoved: () => _userMoved,
  });

  // Deferred so the click that OPENED the panel does not immediately close it.
  setTimeout(() => {
    document.addEventListener("pointerdown", outsideClose, true);
    document.addEventListener("keydown", escClose, true);
  }, 0);
  return panel;
}

export { DEFAULT_STATE };
