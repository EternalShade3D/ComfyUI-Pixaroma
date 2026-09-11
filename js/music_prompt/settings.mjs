// Music Prompt Pixaroma - the gear panel.
//
// The skeleton (open, drag, follow, outsideClose, Escape, wheel) is COPIED from
// AI Prompt's, which is itself copied from Video Prompt's. Every line of it was
// earned by a real bug, and the three that bite hardest are:
//   - pointerdown, not mousedown: LiteGraph preventDefaults the canvas
//     pointerdown, which suppresses the compatibility mouse events, so a
//     mousedown guard never fires on the canvas while working fine elsewhere;
//   - the gear must be EXEMPT from outsideClose, because that runs on
//     pointerdown while the button acts on click - so without it the press
//     closes and the click reopens, and the toggle looks dead;
//   - USER_MOVED resets on CLOSE, never on open, or one dragged panel teaches
//     every later one to sit still where the node is not (house convention #29).
//
// The panel carries the model, what to do with it afterwards, the FORMULA SET,
// and the accent.
//
// The set section exists because a user asked what to do on a different model
// and the honest answer was NOTHING, which is a dead end rather than a
// safeguard. A SET is the two instructions plus the sampling that makes them
// work, under a name saying what it is for - so a second model becomes another
// entry rather than a rewrite.
//
// ⚠️ NOTHING IN HERE IS FOLDED. The fold was tried twice and removed twice, and
// the house rule behind that is worth stating because it is easy to get
// backwards: WE HIDE THINGS ON THE NODE, NOT IN A PANEL. A node shares a canvas
// with everything else, so it stays compact; a settings panel is its own window
// with room to spare, so folding there only buys an extra click. Fold in a panel
// only when it genuinely will not fit.
//
// The picker in particular is how you get BACK to what ships with the node, so
// hiding it hid the way out of a change.

import { fetchModels } from "../ai_prompt/api.mjs";
import { deletePreset, fetchPresets, savePreset } from "./api.mjs";
// Reused, not re-rolled. `openEditor` already carries installGraphUndoGuard,
// and it was the ONLY fullscreen editor in the pack without it until that was
// found and fixed (ai-prompt.md 19d) - a fresh copy would very likely repeat
// exactly that hole. There is no cycle: ai_prompt never imports music_prompt.
// If a third consumer turns up, that is when it moves to js/shared.
import { askConfirm, askName, openEditor, sayIt } from "../ai_prompt/settings.mjs";
import { followNode, getNodeScreenRect, makeDraggable, placeBeside } from "../shared/node_panel.mjs";
import { formatModelSize } from "../shared/utils.mjs";
import {
  ACC,
  createAccentSection,
  registerNodeSettings,
} from "../shared/node_settings.mjs";
import { CLASS, readState, slotConnected, writeState } from "./core.mjs";

const CSS_ID = "pixaroma-music-prompt-settings-css";

let PANEL = null;
let PANEL_NODE = null;
let ON_CHANGE = null;
let USER_MOVED = false;
let POP = null;
let CP_HANDLE = null;
let MODELS = { ok: false, models: [], sizes: {}, error: null };
// The formula sets, fetched once per panel open beside the model list. Empty
// until they land; the panel says so rather than offering a blank editor as
// though it were the measured instruction.
let SETS = { ok: false, shipped: [], user: [], userError: false, error: null };

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function injectCSS() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
    .pix-mps { position:fixed; z-index:1300; width:340px; max-height:76vh;
      display:flex; flex-direction:column;
      background:#232323; border:1px solid #3a3a3a; border-radius:8px;
      box-shadow:0 10px 34px rgba(0,0,0,.5);
      font:12px 'Segoe UI', sans-serif; color:#ddd; }
    .pix-mps-head { display:flex; align-items:center; gap:8px; flex:0 0 auto;
      padding:9px 11px; border-bottom:1px solid #333; cursor:move;
      user-select:none; font-size:12.5px; }
    .pix-mps-head b { font-weight:600; color:#eee; }
    .pix-mps-x { margin-left:auto; background:none; border:none; color:#888;
      font-size:13px; cursor:pointer; padding:0 2px; line-height:1; }
    .pix-mps-x:hover { color:${ACC}; }
    /* A scrolling body, so a long model list can never push the accent section
       off the bottom of the screen. */
    .pix-mps-body { flex:1 1 auto; overflow-y:auto; padding:11px; }
    .pix-mps-body::-webkit-scrollbar { width:9px; }
    .pix-mps-body::-webkit-scrollbar-thumb { background:#3a3a3a; border-radius:5px; }

    .pix-mps-lbl { font-size:10px; letter-spacing:.09em; text-transform:uppercase;
      color:${ACC}; margin:0 0 5px; }
    .pix-mps-note { font-size:10.5px; color:#7d7a76; line-height:1.45;
      margin:6px 0 0; }
    .pix-mps-note.is-warn { color:#e0a33a; }
    .pix-mps-rule { height:1px; background:#333; margin:13px 0; }

    /* The Pixaroma custom dark dropdown, NEVER a native <select>: the OS chrome
       (a blue highlight on the open list) clashes with the theme, and the user
       rejected it outright (node UI convention #14). */
    .pix-mps-pick { display:flex; align-items:center; gap:7px; cursor:pointer;
      background:#1d1d1d; border:1px solid #444; border-radius:4px;
      padding:6px 9px; }
    .pix-mps-pick:hover { border-color:${ACC}; }
    .pix-mps-pick .v { flex:1 1 auto; min-width:0; overflow:hidden;
      text-overflow:ellipsis; white-space:nowrap; color:#ddd; font-size:11.5px; }
    .pix-mps-pick .c { color:${ACC}; font-size:9px; flex:0 0 auto; }

    .pix-mps-pop { position:fixed; z-index:1400; max-height:340px; overflow-y:auto;
      background:#1d1d1d; border:1px solid #444; border-radius:4px;
      box-shadow:0 8px 26px rgba(0,0,0,.55); padding:4px; }
    .pix-mps-pop::-webkit-scrollbar { width:9px; }
    .pix-mps-pop::-webkit-scrollbar-thumb { background:#3a3a3a; border-radius:5px; }
    .pix-mps-filter { width:100%; box-sizing:border-box; background:#161616;
      border:1px solid #3a3a3a; border-radius:3px; color:#ddd;
      font:11.5px 'Segoe UI', sans-serif; padding:5px 7px; margin-bottom:4px;
      outline:none; }
    .pix-mps-filter:focus { border-color:${ACC}; }
    .pix-mps-item { display:flex; align-items:center; gap:7px;
      padding:5px 8px; border-radius:3px; cursor:pointer;
      font-size:11.5px; color:#ccc; }
    .pix-mps-item .lbl { flex:1 1 auto; min-width:0; overflow:hidden;
      text-overflow:ellipsis; white-space:nowrap; }
    /* The model's size. flex:0 0 auto so the NAME ellipsises and the size never
       does - a clipped size would defeat the point of showing it. */
    .pix-mps-item .pix-mps-sz { flex:0 0 auto; color:#7d7d7d; font-size:10px; }
    .pix-mps-item.on .pix-mps-sz { color:#ffd9cd; }
    .pix-mps-item:hover { background:#2a2a2a; color:#fff; }
    .pix-mps-item.on { background:${ACC}; color:#fff; }
    .pix-mps-empty { padding:7px 8px; font-size:11px; color:#7d7a76; }

    /* ORANGE ships with Pixaroma, GREY is yours. Orange is the pack's own
       accent, so the dot speaks the language the rest of the panel already
       speaks. Read from IDENTITY against the shipped array, never a name test,
       so a set of yours that shares a name cannot be mislabelled. */
    .pix-mps-dot { flex:0 0 auto; width:7px; height:7px; border-radius:50%; }
    .pix-mps-dot.is-shipped { background:${ACC}; }
    .pix-mps-dot.is-user { background:#7d7a76; }
    .pix-mps-item.on .pix-mps-dot.is-user { background:#fff; }

    .pix-mps-chips { display:flex; gap:4px; margin-bottom:4px; }
    .pix-mps-chip { flex:1 1 0; min-width:0; box-sizing:border-box;
      background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.14);
      border-radius:3px; color:rgba(255,255,255,.7);
      font:10.5px 'Segoe UI', sans-serif; padding:3px 4px; cursor:pointer;
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .pix-mps-chip:hover { border-color:${ACC}; color:#ddd; }
    .pix-mps-chip.on, .pix-mps-chip.on:hover { background:${ACC};
      border-color:${ACC}; color:#fff; }
    /* Dimmed AND inert, never hidden - see the note on openPop. */
    .pix-mps-chip.empty, .pix-mps-chip.empty:hover { opacity:.35;
      border-color:rgba(255,255,255,.14); color:rgba(255,255,255,.7);
      background:rgba(255,255,255,.05); cursor:default; }

    .pix-mps-row { display:flex; align-items:center; gap:9px; margin-top:9px; }
    .pix-mps-row .t { flex:1 1 auto; min-width:0; font-size:11.5px; color:#ccc; }
    .pix-mps-tog { flex:0 0 auto; width:34px; height:18px; border-radius:9px;
      background:#3a3a3a; position:relative; cursor:pointer;
      transition:background .12s; }
    .pix-mps-tog .knob { position:absolute; top:2px; left:2px; width:14px;
      height:14px; border-radius:50%; background:#999; transition:left .12s; }
    .pix-mps-tog.on { background:${ACC}; }
    .pix-mps-tog.on .knob { left:18px; background:#fff; }

    /* ---- instructions and sampling --------------------------------------- */
    /* A plain sub-heading, NOT a fold. It was folded twice and unfolded twice:
       a control nobody can see is a control nobody knows they have. */
    .pix-mps-subhead { display:flex; align-items:baseline; gap:6px;
      margin-top:13px; font-size:10px; letter-spacing:.09em;
      text-transform:uppercase; color:${ACC}; }
    .pix-mps-subhead .n { margin-left:auto; font:10.5px monospace; color:#7d7a76;
      letter-spacing:0; text-transform:none; }
    .pix-mps-advbody { padding-top:2px; }

    .pix-mps-frow { display:flex; align-items:center; gap:7px; margin-top:7px; }
    .pix-mps-frow .t { flex:1 1 auto; min-width:0; font-size:11.5px; color:#ccc;
      overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .pix-mps-mini { flex:0 0 auto; background:rgba(255,255,255,.05);
      border:1px solid rgba(255,255,255,.14); border-radius:4px;
      color:rgba(255,255,255,.72); font:11px 'Segoe UI', sans-serif;
      padding:3px 9px; cursor:pointer; }
    .pix-mps-mini:hover { background:${ACC}; border-color:${ACC}; color:#fff; }
    .pix-mps-mini:disabled, .pix-mps-mini:disabled:hover { opacity:.35;
      background:rgba(255,255,255,.05); border-color:rgba(255,255,255,.14);
      color:rgba(255,255,255,.72); cursor:default; }
    .pix-mps-mine { flex:0 0 auto; font:10px monospace; color:${ACC}; }

    .pix-mps-nums { display:flex; gap:7px; margin-top:9px; }
    /* flex items default to min-width:auto, so without this the two boxes
       refuse to shrink and overflow the panel (ai-prompt.md #10). */
    .pix-mps-num { flex:1 1 0; min-width:0; box-sizing:border-box;
      display:flex; align-items:center; gap:5px; background:#1d1d1d;
      border:1px solid #444; border-radius:4px; padding:4px 7px; }
    .pix-mps-num:focus-within { border-color:${ACC}; }
    .pix-mps-num em { flex:0 0 auto; font-style:normal; font-size:9.5px;
      letter-spacing:.06em; text-transform:uppercase; color:${ACC}; }
    .pix-mps-num input { flex:1 1 0; min-width:0; background:transparent;
      border:none; outline:none; color:#ddd; font:11px monospace;
      text-align:right; }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// The model popup
// ---------------------------------------------------------------------------
function closePop() {
  POP?.remove();
  POP = null;
}

/**
 * The dark dropdown, with an optional KIND filter.
 *
 * `values` are `{value, label, title?, kind?}`. When any row carries a `kind`,
 * the popup grows a dot per row and a row of kind chips with counts.
 *
 * ⚠️ The chips ALWAYS show once kinds are in play, even when one of them is
 * empty. Hiding a kind with nothing in it sounds right and is not: on a fresh
 * install the user has saved nothing, so the feature would appear completely
 * absent, and its meaning would then arrive unannounced on the day they saved
 * their first one. A zero count is DIMMED AND INERT instead - "Mine (0)"
 * answers "have I saved any yet", where a clickable chip that filters to an
 * empty list punishes you for using it (ai-prompt.md 19b).
 */
function openPop(anchor, values, current, onPick, opts = {}) {
  closePop();
  const pop = el("div", "pix-mps-pop");
  const r = anchor.getBoundingClientRect();
  pop.style.left = r.left + "px";
  pop.style.top = (r.bottom + 3) + "px";
  pop.style.minWidth = r.width + "px";

  const kinds = values.some((v) => v.kind)
    ? [
        { key: "all", label: "All" },
        { key: "shipped", label: "Pixaroma" },
        { key: "user", label: "Mine" },
      ]
    : [];
  let kindKey = "all";

  // A filter for one or two rows is noise; for 36 models it is the point. AI
  // Prompt shipped this gated at 9 and its preset picker was three rows short of
  // ever showing it, so a feature that existed was unreachable (ai-prompt.md 19b).
  const filter = el("input", "pix-mps-filter");
  filter.placeholder = "Type to narrow the list";
  const chipRow = el("div", "pix-mps-chips");
  const list = el("div");
  if (values.length >= (opts.filterFrom ?? 9)) pop.appendChild(filter);
  if (kinds.length) pop.appendChild(chipRow);
  pop.appendChild(list);

  const countOf = (key) =>
    key === "all" ? values.length : values.filter((v) => v.kind === key).length;

  let shown = [];
  const paint = () => {
    const q = filter.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    shown = values.filter((v) => {
      if (kindKey !== "all" && v.kind !== kindKey) return false;
      const hay = String(v.label || v.value).toLowerCase();
      return q.every((word) => hay.includes(word));
    });

    chipRow.textContent = "";
    for (const k of kinds) {
      const n = countOf(k.key);
      const chip = el("button", "pix-mps-chip" + (kindKey === k.key ? " on" : "")
                                + (n === 0 ? " empty" : ""), `${k.label} (${n})`);
      chip.disabled = n === 0;
      chip.title = n === 0
        ? (k.key === "user" ? "You have not saved any of your own yet"
                            : "Nothing of this kind")
        : "Show only these";
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        if (chip.disabled) return;
        kindKey = k.key;
        paint();
      });
      chipRow.appendChild(chip);
    }

    list.textContent = "";
    if (!shown.length) {
      list.appendChild(el("div", "pix-mps-empty", "Nothing matches"));
      return;
    }
    for (const v of shown) {
      const it = el("div", "pix-mps-item" + (v.value === current ? " on" : ""));
      if (v.kind) {
        it.appendChild(el("span", "pix-mps-dot is-" + v.kind));
      }
      it.appendChild(el("span", "lbl", v.label || v.value));
      const sizeText = formatModelSize(v.size);
      if (sizeText) it.appendChild(el("span", "pix-mps-sz", sizeText));
      it.title = v.title || v.label || v.value;
      it.addEventListener("click", (e) => { e.stopPropagation(); closePop(); onPick(v.value); });
      list.appendChild(it);
    }
  };
  paint();
  filter.addEventListener("input", paint);
  filter.addEventListener("keydown", (e) => {
    // ComfyUI binds keys on the document, including Ctrl+V to paste NODES, so a
    // field inside a floating panel has to keep its typing to itself.
    e.stopPropagation();
    // A filter you type into and then have to reach for the mouse is half a
    // control (ai-prompt.md 19b).
    if (e.key === "Enter" && shown.length === 1) {
      e.preventDefault();
      closePop();
      onPick(shown[0].value);
    }
    if (e.key === "Escape") { e.preventDefault(); closePop(); }
  });

  document.body.appendChild(pop);
  // Keep it on screen once it has a real size.
  const pr = pop.getBoundingClientRect();
  if (pr.bottom > window.innerHeight - 8) {
    pop.style.top = Math.max(8, r.top - pr.height - 3) + "px";
  }
  if (pr.right > window.innerWidth - 8) {
    pop.style.left = Math.max(8, window.innerWidth - pr.width - 8) + "px";
  }
  POP = pop;
  if (filter.isConnected) setTimeout(() => filter.focus(), 0);
}

// ---------------------------------------------------------------------------
// Advanced: the escape hatch for a different model
// ---------------------------------------------------------------------------
// The formulas are baked in on purpose (music-prompt.md #3): both were measured,
// the lyrics one took three rounds, and each is tuned to its own temperature. But
// somebody on a different model had NO recourse at all, which is a dead end
// rather than a safeguard - so this section exists and is collapsed by default.
//
// EMPTY MEANS THE MEASURED ONE. A blank box cannot be mistaken for a formula,
// Reset is just clearing it, and nothing has to store a copy of the built-in
// text to compare against.
// MUST match SETTING_KEYS in nodes/_music_prompt_presets.py, or a set saves
// numbers the server drops and loads numbers the panel ignores.
const SETTING_KEYS = [
  "caption_temperature", "caption_max_length",
  "lyrics_temperature", "lyrics_max_length",
];

function allSets() {
  return [...(SETS.shipped || []), ...(SETS.user || [])];
}

/** True when this set is one that ships with the node. */
function isShipped(set) {
  // IDENTITY against the shipped array, never a name test: the objects in
  // allSets() ARE those objects, so a user set that somehow shares a name
  // cannot be mislabelled (ai-prompt.md 19b).
  return (SETS.shipped || []).includes(set);
}

/** The two instructions the node is ACTUALLY using right now. */
function effective(node) {
  const st = readState(node);
  const ship = (SETS.shipped || [])[0] || { caption: "", lyrics: "" };
  return {
    caption: st.caption_formula.trim() || ship.caption,
    lyrics: st.lyrics_formula.trim() || ship.lyrics,
  };
}

/**
 * Which named set the node is on, or null when its wording matches none.
 *
 * Found by MATCHING rather than stored, exactly as AI Prompt does: a stored
 * name would go stale the moment somebody edited the wording, and this survives
 * a reload and a duplicate with nothing extra kept on the node.
 */
function loadedSet(node) {
  const now = effective(node);
  const hit = (list) => list.find(
    (s) => (s.caption || "").trim() === now.caption.trim()
        && (s.lyrics || "").trim() === now.lyrics.trim(),
  );
  // THEIRS WINS A TIE. Saving a copy without changing the wording leaves two
  // sets that are genuinely identical, and searching the shipped list first
  // made Save as look like it had done nothing - the row still named the
  // built-in one. If somebody went to the trouble of naming it, that is the
  // name they mean.
  // AN EXPLICIT PICK WINS OVER THE TIE-BREAK BELOW, while its wording still
  // matches. Saving a copy of the built-in without editing it leaves two sets
  // that are byte-identical, and then "theirs wins" made the shipped one
  // IMPOSSIBLE to show: selecting it applied correctly, the matcher re-ran,
  // found the copy first, and the row snapped straight back to the copy. The
  // user reported it as not being able to select the built-in at all
  // (2026-08-19).
  //
  // Runtime-only, never serialized: it is a display preference, and writing it
  // to node.properties would flag a clean workflow modified on load (Vue Compat
  // #18). After a reload the tie-break below takes over again, which is the
  // behaviour that was wanted in the first place.
  // EMPTY formulas mean the node is following the BUILT-IN wording, and that is
  // a DIFFERENT STATE from "a set of yours whose text happens to be identical".
  // applySet stores the shipped set as empty on purpose (so the node keeps
  // following it if it is ever re-measured), so empty can only mean the shipped
  // one - whatever byte-identical copies exist.
  //
  // Without this a FRESH node reported the user's copy: its formulas are empty,
  // `effective` resolves them to the shipped text, both sets then match, and
  // the "theirs wins" tie-break below picked the copy. Reported as "why is get
  // default new node to mine? even if i used minimax last" (2026-08-19) - and
  // the node was never on their set at all, it was on the built-in one.
  //
  // This also outranks the runtime `_pixMpPickedSet` for the shipped set, and
  // is better than it: matching on stored state SURVIVES a reload, where the
  // runtime marker does not.
  const st = readState(node);
  const followingBuiltIn = !(st.caption_formula || "").trim()
                        && !(st.lyrics_formula || "").trim();
  if (followingBuiltIn) return (SETS.shipped || [])[0] || null;

  const picked = node._pixMpPickedSet;
  if (picked) {
    const all = (SETS.user || []).concat(SETS.shipped || []);
    const p = all.find((s) => s.name === picked);
    // Only while it still matches - the moment the wording is edited the pick
    // is stale and the content match is the truth again.
    if (p && (p.caption || "").trim() === now.caption.trim()
          && (p.lyrics || "").trim() === now.lyrics.trim()) return p;
  }
  return hit(SETS.user || []) || hit(SETS.shipped || []) || null;
}

/** Copy a set's wording AND its numbers onto the node. */
function applySet(node, set, body) {
  const ship = (SETS.shipped || [])[0];
  const patch = {
    // The shipped set is stored as EMPTY, so the node keeps following the
    // built-in wording if that is ever re-measured.
    caption_formula: set === ship ? "" : (set.caption || ""),
    lyrics_formula: set === ship ? "" : (set.lyrics || ""),
  };
  for (const k of SETTING_KEYS) {
    if (set.settings && set.settings[k] != null) patch[k] = set.settings[k];
  }
  // A set IS a model choice here, so picking one picks its model too - which is
  // what the sibling has always done (ai-prompt.md, the same three guards) and
  // what this node was missing: choosing "MiniMax Music 3 (Qwen3.5 4B int8)"
  // left the model on whatever was there, so a fresh node stayed on "None" and
  // passed the idea straight through. Reported as "when I select a preset it
  // didn't load the model like the AI Prompt does".
  //
  // Applied ONLY when that file is really here, and NEVER over a wired clip: a
  // set shared from another machine must not silently point this node at a
  // model that does not exist, and a wire is an explicit choice that outranks a
  // recorded hint. When it cannot be applied the note under the picker says so
  // rather than popping a dialog.
  const hint = set.model_hint;
  if (hint && !slotConnected(node, "clip") && MODELS.models.includes(hint)) {
    patch.model = hint;
  }
  // Remember WHICH set was chosen, so an identical copy cannot shadow it in the
  // row (loadedSet). Runtime-only, so it cannot dirty a saved workflow.
  node._pixMpPickedSet = set.name;
  writeState(node, patch);
  ON_CHANGE?.();
  renderPanel(node, body);
}

function numberField(label, value, onCommit, opts = {}) {
  const wrap = el("div", "pix-mps-num");
  wrap.appendChild(el("em", null, label));
  const inp = el("input");
  inp.type = "text";
  inp.value = String(value);
  // Kill the <input>'s intrinsic ~20-character width, or two of these overflow
  // the panel however hard they are told to shrink (ai-prompt.md #10).
  inp.size = 1;
  inp.title = opts.title || "";
  const commit = () => {
    const raw = String(inp.value).replace(/[^0-9.]/g, "");
    const n = parseFloat(raw);
    onCommit(Number.isFinite(n) ? n : null);
  };
  inp.addEventListener("keydown", (e) => {
    // ComfyUI binds keys on the document, Ctrl+V to paste NODES included.
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); inp.blur(); }
  });
  // change AND blur: Chrome fires NEITHER when a focused element is removed
  // from the document, and the panel's outside-close runs on capture-phase
  // pointerdown - so a half-typed number was thrown away.
  inp.addEventListener("change", commit);
  inp.addEventListener("blur", commit);
  inp.addEventListener("pointerdown", (e) => e.stopPropagation());
  // ⚠️ The close path calls this DIRECTLY rather than relying on blur. Chrome
  // fires neither change nor blur when a focused element is removed from the
  // document, and the sibling's fix - blur the active element first - cannot be
  // verified in the in-app browser pane at all, because that pane never takes
  // system focus so NO blur or focusout event is ever dispatched
  // (reference_inapp_browser_no_blur_events). Calling the commit outright
  // depends on no event, so it works in both.
  inp._pixCommit = commit;
  wrap.appendChild(inp);
  return wrap;
}

function buildFormulaSet(node, body) {
  const wrap = el("div");
  const loaded = loadedSet(node);
  const ship = (SETS.shipped || [])[0];

  wrap.appendChild(el("div", "pix-mps-lbl", "Formula set"));

  // ---- the picker, ALWAYS VISIBLE -----------------------------------------
  // It was collapsed at first and that was wrong: this is how you go BACK to
  // the wording that ships with the node, so hiding it hides the way out of a
  // change. The fine detail below is what folds.
  const pick = el("div", "pix-mps-pick");
  if (loaded) pick.appendChild(el("span", "pix-mps-dot is-"
    + (isShipped(loaded) ? "shipped" : "user")));
  const val = el("span", "v", loaded ? loaded.name : "Your own wording");
  val.title = loaded ? (loaded.note || loaded.name)
                     : "Edited, and not saved under a name. Pick a set to go back.";
  pick.append(val, el("span", "c", "▼"));
  pick.addEventListener("click", (e) => {
    e.stopPropagation();
    // The size of the model the set was MEASURED on, not of the set itself.
    // A set's name already says which model it is for ("Qwen3.5 4B int8") but
    // not what that costs to load, and choosing a set IS choosing a model here.
    // With 2b / 4b / 9b sets side by side this is the number that answers "will
    // my card run this one", which is exactly why the user asked for it.
    // Blank when that model is not on disk - a size for a file you do not have
    // would be a lie.
    const values = allSets().map((s) => ({
      value: s.name,
      label: s.name,
      kind: isShipped(s) ? "shipped" : "user",
      // On-disk first so a re-quantised file shows the user's own number, then
      // the size RECORDED with the set - which is the one that matters when the
      // model is not downloaded yet, exactly when you want to know.
      size: (s.model_hint ? MODELS.sizes?.[s.model_hint] : undefined)
            ?? s.model_bytes,
      title: [s.note, s.model_hint && "Measured on " + s.model_hint]
        .filter(Boolean).join("\n"),
    }));
    if (!values.length) {
      openPop(pick, [{ value: "", label: "No sets could be read" }], "", () => {});
      return;
    }
    openPop(pick, values, loaded ? loaded.name : "", (name) => {
      const set = allSets().find((s) => s.name === name);
      if (set) applySet(node, set, body);
    }, { filterFrom: 2 });
  });
  wrap.appendChild(pick);

  if (SETS.userError) {
    // An unreadable file and an empty library must never look the same: in the
    // first case the user still HAS sets and saving would destroy them.
    wrap.appendChild(el("div", "pix-mps-note is-warn",
      "Your saved sets could not be read, so only the built-in one is listed "
      + "and saving is off until that file is fixed. Nothing has been lost."));
  } else if (!SETS.ok) {
    wrap.appendChild(el("div", "pix-mps-note is-warn",
      "The formula sets could not be fetched"
      + (SETS.error ? " (" + SETS.error + ")" : "") + "."));
  } else if (!loaded) {
    // The one state that needs explaining: they have changed the wording and
    // not saved it, so no name describes what the node is doing.
    wrap.appendChild(el("div", "pix-mps-note",
      "This wording is not one of the saved sets. Save as keeps it under a name "
      + "of your own, or pick a set above to go back to it."));
  } else {
    wrap.appendChild(el("div", "pix-mps-note",
      "An orange dot ships with Pixaroma, a grey one is yours. Each set is "
      + "measured on one language model, so on a different one pick the closest, "
      + "change it below, then Save as."));
    // ONE line about the model this set was measured on, and it goes amber only
    // when picking the set did NOT leave the node using that model - which is
    // the only case a person needs to act on. Picking a set applies its model
    // when it can (applySet), so the quiet case really is the common one.
    const hint = loaded.model_hint;
    const st = readState(node);
    if (hint) {
      let line = "";
      let warn = false;
      if (slotConnected(node, "clip")) {
        line = "Measured on " + hint + ". Your wired model is being used instead.";
      } else if (!MODELS.ok) {
        // "You do not have it" is a claim we have NO evidence for when the list
        // never arrived - and the picker directly above is already saying it
        // could not be read, so the old wording put two contradicting sentences
        // on one panel and sent people hunting for a file that is on disk.
        line = "Measured on " + hint + ", but the model list could not be read, "
             + "so your own model was left alone.";
        warn = true;
      } else if (!MODELS.models.includes(hint)) {
        line = "Measured on " + hint + ", which you do not have, so your own "
             + "model was left alone. Results may differ.";
        warn = true;
      } else if (st.model !== hint) {
        line = "Measured on " + hint + ", but this node is set to "
             + (st.model || "none") + ".";
        warn = true;
      } else {
        line = "Measured on " + hint + ", which is what this node is using.";
      }
      wrap.appendChild(el("div", "pix-mps-note" + (warn ? " is-warn" : ""), line));
    }
  }

  // ---- save / delete, ALWAYS VISIBLE --------------------------------------
  const acts = el("div", "pix-mps-frow");
  acts.appendChild(el("span", "t", ""));
  const saveAs = el("button", "pix-mps-mini", "Save as");
  saveAs.title = "Keep this wording and these numbers under a name of your own";
  saveAs.disabled = SETS.userError;
  saveAs.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (saveAs.disabled) return;
    // NEVER window.prompt: Electron does not implement it and refuses SILENTLY,
    // which has produced three false "the button does nothing" reports in this
    // pack (ai-prompt.md #19 / #19c).
    const suggested = loaded && isShipped(loaded) ? loaded.name + " (mine)"
                                                  : (loaded ? loaded.name : "My set");
    const name = await askName("Save formula set", "A name saying what it is for",
                               suggested);
    if (!name) return;
    const now = effective(node);
    const s = readState(node);
    const res = await savePreset({
      name,
      caption: now.caption,
      lyrics: now.lyrics,
      model_hint: s.model,
      // Recorded with the set so its row can show a size even on a machine
      // where that model is not downloaded yet.
      model_bytes: MODELS.sizes?.[s.model],
      settings: Object.fromEntries(SETTING_KEYS.map((k) => [k, s[k]])),
    });
    if (!res.ok) { await sayIt("Could not save", res.message); return; }
    // The set just saved is the one to show. Without this an earlier explicit
    // pick would shadow it when the wording is identical - which is exactly the
    // "Save as looks like it did nothing" case the tie-break in loadedSet was
    // added for, arriving through the new door.
    node._pixMpPickedSet = name;
    // Keep the LAST GOOD list if the refresh hiccups. Wiping it would report
    // "no sets could be read" straight after a SUCCESSFUL save, and blind the
    // name-collision guard with it - the same guard openMusicPromptPanel
    // already applies one function away.
    const fresh = await fetchPresets();
    if (fresh.ok || !SETS.ok) SETS = fresh;
    renderPanel(node, body);
  });

  const del = el("button", "pix-mps-mini", "Delete");
  const canDelete = !!loaded && !isShipped(loaded);
  del.disabled = !canDelete;
  del.title = canDelete
    ? "Remove this saved set"
    : (loaded ? "This one ships with the node and cannot be removed"
              : "Nothing to remove: this wording is not a saved set");
  del.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (del.disabled) return;
    if (!(await askConfirm("Delete this set?", loaded.name))) return;
    const res = await deletePreset(loaded.name);
    if (!res.ok) { await sayIt("Could not delete", res.message); return; }
    // Keep the LAST GOOD list if the refresh hiccups. Wiping it would report
    // "no sets could be read" straight after a SUCCESSFUL save, and blind the
    // name-collision guard with it - the same guard openMusicPromptPanel
    // already applies one function away.
    const fresh = await fetchPresets();
    if (fresh.ok || !SETS.ok) SETS = fresh;
    renderPanel(node, body);
  });
  acts.append(saveAs, del);
  wrap.appendChild(acts);

  // ---- the instructions and the numbers, ALWAYS VISIBLE -------------------
  // These were folded twice and unfolded twice. The user's line, and it is the
  // right one: a control nobody can see is a control nobody knows they have,
  // and hiding the wording reads as not wanting people to change it. The panel
  // body scrolls; that is what it is for.
  const st0 = readState(node);
  const drift = [
    st0.caption_formula.trim() && "caption wording",
    st0.lyrics_formula.trim() && "lyrics wording",
    st0.caption_temperature !== 0.3 && "caption temp",
    st0.caption_max_length !== 500 && "caption length",
    st0.lyrics_temperature !== 0.8 && "lyrics temp",
    st0.lyrics_max_length !== 900 && "lyrics length",
  ].filter(Boolean);

  const subhead = el("div", "pix-mps-subhead");
  subhead.append(
    el("span", null, "Instructions and sampling"),
    el("span", "n", drift.length ? `${drift.length} changed` : ""),
  );
  subhead.title = drift.length ? "Changed: " + drift.join(", ")
                               : "Everything is at the value this set carries.";
  wrap.appendChild(subhead);

  const inner = el("div", "pix-mps-advbody");
  wrap.appendChild(inner);

  for (const which of ["caption", "lyrics"]) {
    const key = which + "_formula";
    const row = el("div", "pix-mps-frow");
    row.appendChild(el("span", "t",
      which === "caption" ? "Caption instruction" : "Lyrics instruction"));
    const edit = el("button", "pix-mps-mini", "Edit");
    // Something true has to exist to start from. With no shipped set fetched
    // AND nothing of their own, the button is inert rather than opening a blank
    // box that reads as "there is no instruction".
    const own = readState(node)[key].trim();
    edit.disabled = !own && !ship;
    edit.title = edit.disabled
      ? "The built-in wording could not be read, so there is nothing to edit yet"
      : "Open it in a full-screen box";
    edit.addEventListener("click", (e) => {
      e.stopPropagation();
      if (edit.disabled) return;      // a disabled control must not fall through
      const builtin = (ship && ship[which]) || "";
      openEditor(
        which === "caption" ? "Caption instruction" : "Lyrics instruction",
        readState(node)[key] || builtin,
        (text) => {
          const next = String(text || "").trim();
          // Saved back unchanged stores NOTHING, so the node keeps following the
          // built-in and a future re-measurement still reaches them.
          writeState(node, { [key]: next === builtin.trim() ? "" : next });
          ON_CHANGE?.();
          renderPanel(node, body);
          return true;
        },
        { owner: node, spellcheck: false },
      );
    });
    row.appendChild(edit);
    inner.appendChild(row);
  }

  for (const which of ["caption", "lyrics"]) {
    const s = readState(node);
    const fallback = which === "caption" ? [0.3, 500] : [0.8, 900];
    const nums = el("div", "pix-mps-nums");
    nums.appendChild(numberField(
      which + " temp", s[which + "_temperature"],
      (v) => {
        writeState(node, { [which + "_temperature"]: v == null ? fallback[0] : v });
        ON_CHANGE?.();
        renderPanel(node, body);
      },
      { title: "Lower stays factual, higher takes more risks. The built-in set "
               + "measured " + fallback[0] + "." }));
    nums.appendChild(numberField(
      which + " max len", s[which + "_max_length"],
      (v) => {
        writeState(node, { [which + "_max_length"]: v == null ? fallback[1] : v });
        ON_CHANGE?.();
        renderPanel(node, body);
      },
      { title: "How much it may write. A model that reasons before answering "
               + "needs far more than the words alone." }));
    inner.appendChild(nums);
  }

  return wrap;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function renderPanel(node, body) {
  body.textContent = "";
  const st = readState(node);

  // ---- model ---------------------------------------------------------------
  body.appendChild(el("div", "pix-mps-lbl", "Model"));
  const pick = el("div", "pix-mps-pick");
  const val = el("span", "v", st.model || "None - your text passes through");
  val.title = st.model || "";
  pick.append(val, el("span", "c", "▼"));
  pick.addEventListener("click", (e) => {
    e.stopPropagation();
    const values = [{ value: "", label: "None - pass the text through" }];
    // `size` rides on the value rather than being folded into the label, so the
    // filter (which reads label || value) still matches the NAME only - typing
    // "9b" must not match a file size. It is what tells 2b / 4b / 9b of one
    // family apart now that several are installed.
    for (const m of MODELS.models) {
      values.push({ value: m, label: m, size: MODELS.sizes?.[m] });
    }
    // filterFrom 2, like the sets picker: the user asked for the model list
    // to be filterable too, and two names are already worth narrowing.
    openPop(pick, values, st.model, (v) => {
      writeState(node, { model: v });
      ON_CHANGE?.();
      renderPanel(node, body);
    }, { filterFrom: 2 });
  });
  body.appendChild(pick);

  if (!MODELS.ok) {
    // An empty folder and a failed scan must never look identical.
    body.appendChild(el("div", "pix-mps-note is-warn",
      "The list of models could not be read: " + (MODELS.error || "unknown error")));
  } else if (!MODELS.models.length) {
    body.appendChild(el("div", "pix-mps-note is-warn",
      "There is nothing in your ComfyUI/models/text_encoders folder yet."));
  } else {
    body.appendChild(el("div", "pix-mps-note",
      "This node only reads and writes words, so it does NOT need a vision "
      + "model. Both formulas were measured on qwen3.5_4b_int8_convrot."));
  }

  body.appendChild(el("div", "pix-mps-rule"));

  // ---- free vram -----------------------------------------------------------
  const row = el("div", "pix-mps-row");
  row.appendChild(el("span", "t", "Unload the model when this node finishes"));
  const tog = el("div", "pix-mps-tog" + (st.release_model ? " on" : ""));
  tog.appendChild(el("span", "knob"));
  tog.addEventListener("click", (e) => {
    e.stopPropagation();
    const next = !readState(node).release_model;
    writeState(node, { release_model: next });
    tog.classList.toggle("on", next);
    ON_CHANGE?.();
  });
  row.appendChild(tog);
  body.appendChild(row);
  body.appendChild(el("div", "pix-mps-note",
    "The same switch as Free VRAM on the node. In a chain it belongs only on "
    + "the last node using that model, and it is skipped entirely when the "
    + "model arrived on the clip wire - that one is not this node's to unload."));

  body.appendChild(el("div", "pix-mps-rule"));

  // ---- advanced ------------------------------------------------------------
  body.appendChild(buildFormulaSet(node, body));

  body.appendChild(el("div", "pix-mps-rule"));

  // ---- accent --------------------------------------------------------------
  body.appendChild(createAccentSection(node, {
    onPickerOpen: (h) => { CP_HANDLE = h; },
  }));
}

// ---------------------------------------------------------------------------
// Open / close
// ---------------------------------------------------------------------------
function outsideClose(e) {
  if (!PANEL) return;
  // The full-screen editor sits ON TOP, so a press inside it must not close the
  // panel underneath. This has to come FIRST - the popup check below would
  // otherwise take the list down with it.
  if (e.target?.closest?.(".pix-ape-back")) return;
  if (POP && !POP.contains(e.target) && !e.target?.closest?.(".pix-mps-pick")) {
    closePop();
  }
  if (PANEL.contains(e.target)) return;
  // These live on <body> too and this guard is capture-phase, so it runs before
  // their own handlers. Without the exemptions, picking a colour dismisses the
  // panel underneath (node-settings-accent invariant 3). `.pix-mp-gear` is
  // exempt for a different reason: it is what OPENS the panel, and this fires on
  // pointerdown while the button acts on click.
  if (e.target?.closest?.(
    ".pix-mps-pop, .pix-ape-back, .pix-mp-gear, .pix-cp-popup, .pix-cp-modal-backdrop, .pix-nset-pop"
  )) return;
  closeMusicPromptPanelFor(null);
}

function escClose(e) {
  if (e.key !== "Escape" || !PANEL) return;
  // The editor and the popup own Escape while they are up.
  if (document.querySelector(".pix-ape-back")) return;
  if (POP) { e.stopPropagation(); closePop(); return; }
  e.stopPropagation();
  closeMusicPromptPanelFor(null);
}

function wheelClose(e) {
  // ⚠️ Closes the POPUP only, never the panel. Scrolling the wheel over the
  // canvas is how you zoom, and it is the commonest thing anyone does while a
  // settings panel is open - closing the panel on it made the panel vanish for
  // no reason the user could see. The panel does not need closing on a zoom
  // anyway: followNode keeps it beside its node through any transform.
  if (!POP || POP.contains(e.target)) return;
  closePop();
}

export function closeMusicPromptPanelFor(node) {
  if (node && PANEL_NODE !== node) return;
  closePop();
  try { CP_HANDLE?.close?.(); } catch (_) { /* already gone */ }
  CP_HANDLE = null;
  try { PANEL?._pixCleanup?.(); } catch (_) { /* already gone */ }
  // COMMIT a half-typed number before the panel goes. The numeric fields commit
  // on change/blur, and Chrome fires NEITHER when a focused element is removed
  // from the document - and outsideClose runs on capture-phase pointerdown,
  // before the browser moves focus. So typing into "lyrics max len" and then
  // clicking the canvas silently threw the value away.
  try {
    const active = document.activeElement;
    if (active && PANEL && PANEL.contains(active)) {
      // Commit OUTRIGHT, not via blur. Chrome fires neither change nor blur
      // when a focused element is removed from the document, and blur cannot be
      // relied on here anyway - the in-app browser pane never takes system
      // focus, so it dispatches no blur or focusout at all. The direct call
      // needs no event; the blur after it is belt and braces for a real browser.
      if (typeof active._pixCommit === "function") active._pixCommit();
      if (typeof active.blur === "function") active.blur();
    }
  } catch (_) { /* not fatal */ }
  PANEL?.remove();
  PANEL = null;
  PANEL_NODE = null;
  ON_CHANGE = null;
  // Reset on CLOSE, never on open, or one dragged panel teaches every later one
  // to sit still where the node is not.
  USER_MOVED = false;
}

export async function openMusicPromptPanel(node, onChange) {
  injectCSS();
  // A second press on the gear TOGGLES rather than stacking.
  if (PANEL && PANEL_NODE === node) { closeMusicPromptPanelFor(node); return; }
  closeMusicPromptPanelFor(null);
  PANEL_NODE = node;
  ON_CHANGE = onChange;

  const panel = el("div", "pix-mps");
  const head = el("div", "pix-mps-head");
  head.appendChild(el("b", null, "Music Prompt settings"));
  const x = el("button", "pix-mps-x", "✕");
  x.addEventListener("click", () => closeMusicPromptPanelFor(null));
  head.appendChild(x);
  const body = el("div", "pix-mps-body");
  panel.append(head, body);
  document.body.appendChild(panel);
  PANEL = panel;

  placeBeside(panel, getNodeScreenRect(node));
  // ignoreSelector is NOT optional: makeDraggable preventDefaults and takes
  // pointer capture on pointerdown, so without it the ✕ inside the handle never
  // receives its click and the one control that closes the panel does nothing.
  makeDraggable(panel, head, {
    onUserMove: () => { USER_MOVED = true; },
    ignoreSelector: ".pix-mps-x",
  });
  followNode(panel, node, {
    isCurrent: () => PANEL === panel && PANEL_NODE === node,
    isUserMoved: () => USER_MOVED,
  });
  // Deferred, so the click that OPENED the panel does not immediately close it.
  setTimeout(() => {
    document.addEventListener("pointerdown", outsideClose, true);
    document.addEventListener("keydown", escClose, true);
    document.addEventListener("wheel", wheelClose, true);
  }, 0);
  panel._pixCleanup = () => {
    document.removeEventListener("pointerdown", outsideClose, true);
    document.removeEventListener("keydown", escClose, true);
    document.removeEventListener("wheel", wheelClose, true);
  };

  body.textContent = "Loading...";
  // Re-fetched on every open (house convention #18): a custom picker backed by
  // our own route gets NOTHING from ComfyUI's R refresh, so a session cache
  // would look permanently stale after somebody renames a file.
  //
  // Land it in a LOCAL and publish only after the staleness guard: writing the
  // module singleton first let a slow request for a CLOSED panel clobber the
  // list a newer panel had already rendered from.
  const [fetched, sets] = await Promise.all([fetchModels(), fetchPresets()]);
  if (PANEL !== panel) return;
  MODELS = fetched;
  // Keep the LAST GOOD list on a failed read. A failure that wiped it would
  // leave the picker saying "nothing saved" AND blind the name-collision guard,
  // which is the shape that destroys somebody's library (ai-prompt.md #13).
  if (sets.ok || !SETS.ok) SETS = sets;
  renderPanel(node, body);
  // Place it AGAIN now the content is in: the placement above ran while the
  // body still said "Loading..." and the panel was ~80px tall, so it was
  // clamped against the wrong height. followNode corrects it, but only on its
  // next frame, so without this the user sees the panel jump.
  if (!USER_MOVED) placeBeside(panel, getNodeScreenRect(node));
}

/** The Expand button: the idea in a full-screen box. */
export function openIdeaEditor(node, onSaved) {
  openEditor("Your idea", readState(node).idea, (text) => {
    writeState(node, { idea: text });
    onSaved?.();
    return true;
  }, { owner: node, spellcheck: true });
}

// One registration gives BOTH surfaces: the orange gear in the node selection
// toolbar and the central right-click entry.
//
// ⚠️ EXACTLY ONE registration per class. `_defs.set` REPLACES wholesale, so a
// second call silently discards the first. This used to call registerNodeAccent
// on the line above; that one lost the race (it is overwritten by this call), so
// the panel was right but its `title` was gone and the right-click entry read
// "⚙ Node settings" instead of naming the node. The colour block is unaffected -
// createAccentSection is already in this panel, which is the documented way.
//
// ownMenuItem is FALSE because this node adds no menu entry of its own, so the
// central one in js/help_toolbar/index.js is the only right-click route in.
registerNodeSettings(CLASS, {
  title: "Music Prompt",
  open: (node) => openMusicPromptPanel(node, () => node._pixMpRender?.()),
  ownMenuItem: false,
});
