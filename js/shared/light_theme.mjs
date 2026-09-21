// ComfyUI's LIGHT colour palettes, for node faces that were designed dark.
//
// Reported on Discord 2026-09-10/13: with ComfyUI's light theme on, the buttons
// on the prompt-typing nodes were light text on a light node (measured 1.2:1 to
// 1.4:1 contrast, about invisible) and every text box stayed black.
//
// THE SIGNAL, rewritten 2026-09-21 after a user report. Every rule below now
// sits under :where(html.pix-light), a class THIS FILE puts on when it has
// POSITIVE evidence the palette is light. The default is therefore dark, which
// is what every node face in the pack is drawn for.
//
// The first version keyed on core's own class instead, as :root:not(.dark-theme),
// i.e. "go light unless the page proves it is dark". Core adds that class from
// GraphView.vue:
//     if (newTheme.light_theme) remove('dark-theme') else add('dark-theme')
// so it is driven by a palette's OPTIONAL `light_theme` boolean
// (colorPaletteSchema.ts: z.boolean().optional()). Anywhere that watcher does
// not run - an older frontend, a palette id that fails to resolve, a palette
// whose flag disagrees with its own colours - the class is simply absent, our
// rules all matched, and the prompt nodes turned WHITE on a dark canvas. That
// was reported on Discord 2026-09-19 by a user who ended up commenting this
// file out to get his dark nodes back, which is the worst possible outcome.
//
// The replacement asks the palette's own COLOURS instead of its flag: light
// when the page background is lighter than the page text. Core writes both from
// the active palette (colorPaletteService.ts sets them as inline custom
// properties on <html>, and <body> inherits them as real colour properties), so
// this tracks the palette itself and cannot be out of step with it.
// MEASURED against all six palettes core ships - arc, dark, github, light,
// solarized, nord - the verdict matches each one's own `light_theme` flag, with
// the nearest miss still two orders of magnitude clear (light 0.723 vs 0.016;
// the darkest dark 0.011 vs 0.818). It is a COMPARISON, not a threshold, so
// there is no cutoff to tune and a mid-grey palette still resolves correctly.
//
// In a dark palette no rule below can match, which is why the dark look is
// untouched (measured: every element's computed colours identical before and
// after).
//
// THE SPECIFICITY TRICK, and why this sheet does not care about load order.
// :where() adds nothing. Each rule then names the element TYPE with the class
// (button.pix-text-actbtn = one class + one type), which lands exactly between
// the node's own base rule (one class) and its hover / active / disabled rules
// (two classes). So a light rule always replaces the dark base look, and the
// node's own accent hover and "on" states still win, whichever stylesheet was
// injected first. Where a dark STATE rule would paint white-on-light (a white
// hover, a disabled colour), this sheet adds its own twin with one more class.
//
// SCOPE: the eight nodes where you type a prompt (user's choice 2026-09-17).
// Floating panels, popups and confirm dialogs stay dark, like every other
// Pixaroma panel. Extending to another node = more rules here, same pattern.

const LIGHT = ":where(html.pix-light)";
const LIGHT_CLASS = "pix-light";

// A light palette paints a Pixaroma node's BODY #AAAAAA (measured: the canvas
// pixel in Classic, the Vue body in Nodes 2.0), so text sitting straight on the
// body needs more weight than text inside a white field or a row card.
const C = {
  text: "#1f1f1f",
  soft: "#2e2e2e",
  dim: "#555555",
  bodyText: "#3a3a3a",     // small text straight on the #AAA body (4.9:1; #555 there is 3.2:1)
  faint: "#767676",        // placeholders
  icon: "#555555",         // drag handles and the row delete cross, on a row card (#5f5f5f was 4.3:1)
  field: "#ffffff",
  fieldBorder: "#b3b3b3",
  locked: "#ececec",
  panel: "#f0f0f0",
  panelBorder: "#cccccc",
  card: "rgba(255,255,255,0.5)",
  cardBorder: "rgba(0,0,0,0.14)",
  btnBg: "rgba(255,255,255,0.62)",
  btnBorder: "rgba(0,0,0,0.26)",
  hoverBg: "rgba(255,255,255,0.92)",
  hoverBorder: "rgba(0,0,0,0.42)",
  offText: "rgba(0,0,0,0.34)",
  offBg: "rgba(255,255,255,0.3)",
  offBorder: "rgba(0,0,0,0.12)",
  recess: "rgba(0,0,0,0.08)",
};

// The accent as TEXT: #f66744 on white is only 2.9:1, so accent-coloured words
// are darkened here. Fills and borders keep the real accent.
const ACC = "var(--pix-acc,#f66744)";
const PACC = "var(--acc, var(--pix-acc,#f66744))";   // Prompt sets --acc on its own root
const accText = (v) => "color-mix(in srgb, " + v + " 70%, #000)";

const FIELD = "background:" + C.field + "; border-color:" + C.fieldBorder + "; color:" + C.text + ";";
const BTN = "background:" + C.btnBg + "; border-color:" + C.btnBorder + "; color:" + C.soft + ";";
const OFF = "background:" + C.offBg + "; border-color:" + C.offBorder + "; color:" + C.offText + ";";
const HOVER = "background:" + C.hoverBg + "; border-color:" + C.hoverBorder + "; color:" + C.text + ";";

const CSS = `
/* ---- Text Pixaroma ---- */
${LIGHT} div.pix-text-root { color:${C.text}; }
${LIGHT} textarea.pix-text-ta { ${FIELD} }
${LIGHT} textarea.pix-text-ta::placeholder { color:${C.faint}; }
${LIGHT} textarea.pix-text-ta.pix-text-locked { background:${C.locked}; color:${C.dim}; }
${LIGHT} div.pix-text-lockhint { color:${accText(ACC)}; }
${LIGHT} button.pix-text-actbtn { ${BTN} }
${LIGHT} button.pix-text-actbtn[disabled], ${LIGHT} button.pix-text-actbtn[disabled]:hover { ${OFF} }
${LIGHT} button.pix-text-switch { ${BTN} }
${LIGHT} button.pix-text-switch:not(.is-on):hover { color:${C.text}; }
${LIGHT} button.pix-text-switch[disabled]:hover { border-color:${C.btnBorder}; color:${C.soft}; }
${LIGHT} span.pix-text-switch-dot { border-color:rgba(0,0,0,0.45); }

/* ---- Prompt Pixaroma ---- */
${LIGHT} div.pix-prm-root { color:${C.text}; }
${LIGHT} div.pix-prm-portrow .cl { color:${accText(PACC)}; }
${LIGHT} div.pix-prm-seg { background:${C.field}; }
${LIGHT} div.pix-prm-seg button { color:${accText(PACC)}; }
${LIGHT} div.pix-prm-seg button:not(.on):hover { color:${C.text}; background:${C.recess}; }
${LIGHT} div.pix-prm-dd-btn { background:${C.field}; color:${accText(PACC)}; }
${LIGHT} div.pix-prm-dd-btn:hover { color:${C.text}; }
${LIGHT} div.pix-prm-tawrap { background:${C.field}; border-color:${C.fieldBorder}; }
${LIGHT} div.pix-prm-backdrop { color:${C.text}; }
${LIGHT} textarea.pix-prm-ta::placeholder { color:${C.faint}; }
${LIGHT} div.pix-prm-expand { background:${C.panel}; border-color:${C.panelBorder}; color:${C.text}; }
${LIGHT} div.pix-prm-expand .lbl, ${LIGHT} div.pix-prm-expand .note { color:${C.dim}; }
${LIGHT} div.pix-prm-lockhint { color:${accText(PACC)}; }
${LIGHT} button.pix-prm-btn { ${BTN} }
${LIGHT} button.pix-prm-btn[disabled], ${LIGHT} button.pix-prm-btn[disabled]:hover { ${OFF} }
${LIGHT} button.pix-prm-sw { ${BTN} }
${LIGHT} button.pix-prm-sw:not(.on):hover { color:${C.text}; }
${LIGHT} span.pix-prm-sw-dot { border-color:rgba(0,0,0,0.45); }
/* Tag colours, only inside Prompt Pixaroma: AI Prompt shares these classes and keeps a dark box.
   Same meaning as dark (orange @tag, green *category, violet #list, three shades each), darker for white. */
${LIGHT} div.pix-prm-root span.pix-prm-chip { color:${accText(PACC)}; }
${LIGHT} div.pix-prm-root span.pix-prm-chip.s1 { color:color-mix(in srgb, ${PACC} 55%, #5a2c00); }
${LIGHT} div.pix-prm-root span.pix-prm-chip.s2 { color:color-mix(in srgb, ${PACC} 35%, #5a4000); }
${LIGHT} div.pix-prm-root span.pix-prm-wild { color:#136c35; }
${LIGHT} div.pix-prm-root span.pix-prm-wild.s1 { color:#356a10; }
${LIGHT} div.pix-prm-root span.pix-prm-wild.s2 { color:#50600b; }
${LIGHT} div.pix-prm-root span.pix-prm-list { color:#6d28d9; }
${LIGHT} div.pix-prm-root span.pix-prm-list.s1 { color:#8b2fa8; }
${LIGHT} div.pix-prm-root span.pix-prm-list.s2 { color:#93235f; }
${LIGHT} div.pix-prm-root span.pix-prm-chip.bad, ${LIGHT} div.pix-prm-root span.pix-prm-wild.bad, ${LIGHT} div.pix-prm-root span.pix-prm-list.bad { color:${C.text}; }

/* ---- Prompt Stack + Prompt Multi (same row shape) ---- */
${LIGHT} div.pix-ps-root, ${LIGHT} div.pix-pm-root { color:${C.text}; }
${LIGHT} div.pix-ps-row, ${LIGHT} div.pix-pm-row { background:${C.card}; border-color:${C.cardBorder}; }
${LIGHT} span.pix-ps-handle, ${LIGHT} span.pix-pm-handle { color:${C.icon}; }
${LIGHT} span.pix-ps-handle:hover, ${LIGHT} span.pix-pm-handle:hover { color:${C.text}; }
${LIGHT} div.pix-ps-toggle, ${LIGHT} div.pix-pm-toggle { ${BTN} color:${C.dim}; }
${LIGHT} div.pix-ps-toggle:not(.on):hover, ${LIGHT} div.pix-pm-toggle:not(.on):hover { ${HOVER} }
${LIGHT} input.pix-ps-label, ${LIGHT} input.pix-pm-label { ${FIELD} }
${LIGHT} input.pix-ps-label::placeholder, ${LIGHT} input.pix-pm-label::placeholder { color:${C.faint}; }
${LIGHT} button.pix-ps-delete, ${LIGHT} button.pix-pm-delete { color:${C.icon}; }
${LIGHT} button.pix-ps-delete:disabled, ${LIGHT} button.pix-pm-delete:disabled { color:rgba(0,0,0,0.25); }
${LIGHT} textarea.pix-ps-textarea, ${LIGHT} textarea.pix-pm-textarea { ${FIELD} }
${LIGHT} textarea.pix-ps-textarea::placeholder, ${LIGHT} textarea.pix-pm-textarea::placeholder { color:${C.faint}; }
${LIGHT} button.pix-ps-add, ${LIGHT} button.pix-ps-clear, ${LIGHT} button.pix-ps-reset { ${BTN} }
${LIGHT} button.pix-ps-clear:disabled, ${LIGHT} button.pix-ps-reset:disabled,
${LIGHT} button.pix-ps-clear:disabled:hover, ${LIGHT} button.pix-ps-reset:disabled:hover { ${OFF} }
${LIGHT} button.pix-pm-modepill, ${LIGHT} button.pix-pm-actbtn { ${BTN} }
${LIGHT} button.pix-pm-actbtn[disabled], ${LIGHT} button.pix-pm-actbtn[disabled]:hover { ${OFF} }

/* ---- Prompt Pack ---- */
${LIGHT} div.pix-pp-root { color:${C.text}; }
${LIGHT} button.pix-pp-modepill, ${LIGHT} button.pix-pp-actbtn { ${BTN} }
${LIGHT} button.pix-pp-actbtn[disabled], ${LIGHT} button.pix-pp-actbtn[disabled]:hover { ${OFF} }
${LIGHT} textarea.pix-pp-ta { ${FIELD} }
${LIGHT} textarea.pix-pp-ta::placeholder { color:${C.faint}; }
${LIGHT} div.pix-pp-counter { background:${C.panel}; color:${C.dim}; }
${LIGHT} div.pix-pp-counter.active { background:${C.field}; color:${accText(ACC)}; }
${LIGHT} div.pix-pp-counter.empty { color:${C.offText}; }

/* ---- Pause Text ---- */
${LIGHT} div.pix-pt-root { color:${C.text}; }
${LIGHT} div.pix-pt-band { color:${C.bodyText}; }
${LIGHT} div.pix-pt-box { background:${C.field}; border-color:${C.fieldBorder}; }
${LIGHT} div.pix-pt-hdr { background:rgba(0,0,0,0.03); border-bottom-color:rgba(0,0,0,0.12); }
${LIGHT} span.pix-pt-hlbl { color:${C.dim}; }
/* the "edited" marker is written with an INLINE orange, so only !important reaches it */
${LIGHT} span.pix-pt-hlbl span { color:color-mix(in srgb, #f66744 70%, #000) !important; }
${LIGHT} div.pix-pt-toggle { background:${C.recess}; }
${LIGHT} div.pix-pt-seg { color:${C.dim}; }
${LIGHT} div.pix-pt-seg:not(.active):hover { color:${C.text}; }
${LIGHT} span.pix-pt-hic { ${BTN} }
${LIGHT} textarea.pix-pt-ta { color:${C.text}; }
${LIGHT} textarea.pix-pt-ta::placeholder { color:${C.faint}; }
${LIGHT} textarea.pix-pt-ta:disabled { color:${C.dim}; }
${LIGHT} span.pix-pt-count { color:${C.bodyText}; }
${LIGHT} button.pix-pt-btn { ${BTN} }
${LIGHT} button.pix-pt-btn:not(.primary):hover:not(:disabled) { color:${C.text}; }

/* ---- Text Join ---- */
${LIGHT} div.pix-tj-field { background:${C.field}; border-color:${C.fieldBorder}; }
${LIGHT} div.pix-tj-field.wired:focus-within { border-color:${C.fieldBorder}; }
${LIGHT} span.pix-tj-lbl { color:${C.dim}; }
${LIGHT} textarea.pix-tj-ta { color:${C.text}; }
${LIGHT} textarea.pix-tj-ta::placeholder { color:${C.faint}; }
${LIGHT} span.pix-tj-ic { ${BTN} }

/* ---- Find and Replace ---- */
${LIGHT} div.pix-fr-root { color:${C.text}; }
${LIGHT} div.pix-fr-tog { ${BTN} color:${C.dim}; }
${LIGHT} div.pix-fr-tog:not(.on):hover { color:${C.text}; }
/* :not(.on): a pill can be ON and muted at once (Whole word, then Regex); the type selector would
   otherwise outrank the node's own ".on" white text and leave dark grey on the orange fill */
${LIGHT} div.pix-fr-tog.is-muted:not(.on), ${LIGHT} div.pix-fr-tog.is-muted:not(.on):hover { border-color:${C.offBorder}; color:${C.dim}; }
${LIGHT} div.pix-fr-row { background:${C.card}; border-color:${C.cardBorder}; }
${LIGHT} span.pix-fr-handle { color:${C.icon}; }
${LIGHT} span.pix-fr-handle:hover { color:${C.text}; }
${LIGHT} div.pix-fr-toggle { ${BTN} color:${C.dim}; }
${LIGHT} div.pix-fr-toggle:not(.on):hover { ${HOVER} }
${LIGHT} textarea.pix-fr-field { ${FIELD} }
${LIGHT} textarea.pix-fr-field::placeholder { color:${C.faint}; }
${LIGHT} textarea.pix-fr-field.is-delete::placeholder { color:rgba(170,30,60,0.7); }
${LIGHT} span.pix-fr-arrow { color:${accText(ACC)}; }
${LIGHT} button.pix-fr-delete { color:${C.icon}; }
${LIGHT} button.pix-fr-delete:disabled { color:rgba(0,0,0,0.25); }
${LIGHT} button.pix-fr-add, ${LIGHT} button.pix-fr-reset { ${BTN} }
${LIGHT} button.pix-fr-add { color:${accText(ACC)}; border-color:color-mix(in srgb, ${ACC} 55%, transparent); }
${LIGHT} button.pix-fr-reset:disabled, ${LIGHT} button.pix-fr-reset:disabled:hover { ${OFF} }
${LIGHT} div.pix-fr-preview { border-top-color:rgba(0,0,0,0.18); }
${LIGHT} div.pix-fr-prev-head { color:#0d4420; }
${LIGHT} span.pix-fr-prev-note { color:${C.bodyText}; }
${LIGHT} div.pix-fr-prev-body { background:${C.panel}; border-color:#b9d3bd; color:${C.text}; }
${LIGHT} div.pix-fr-root .pix-fr-before { color:${C.dim}; }
${LIGHT} div.pix-fr-root .pix-fr-before .o { background:#fbdde3; color:#a61e3c; }
${LIGHT} div.pix-fr-root .pix-fr-after .n { background:#d7f2de; color:#16692f; }
${LIGHT} div.pix-fr-root .pix-fr-prev-empty, ${LIGHT} div.pix-fr-root .pix-fr-prev-nochange { color:${C.dim}; }
${LIGHT} div.pix-fr-root .pix-fr-prev-trunc { color:#8a4a66; }
${LIGHT} div.pix-fr-root .pix-fr-warn { color:#8a5a00; }
`;

// ── deciding which palette is on ──────────────────────────────────────────
//
// "Auto" measures; "Dark" and "Light" are the user overriding the measurement.
// The mode is PUSHED in by brand/index.js from its setting's onChange (which
// must use its ARGUMENT - a setting's onChange fires BEFORE the store write),
// so this module needs no ComfyUI import and cannot form a cycle.
let _mode = "Auto";

// Both values arrive from getComputedStyle on a real colour property, so the
// browser has already normalised them to rgb()/rgba(). The hex branch is only
// for the raw custom-property fallback below, where the value is as-authored.
function parseColor(v) {
  if (!v) return null;
  const s = String(v).trim();
  const m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i);
  if (m) {
    let a = m[4] == null ? 1 : (m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
    return [+m[1], +m[2], +m[3], a];
  }
  let h = s.startsWith("#") ? s.slice(1) : null;
  if (!h) return null;
  if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 && h.length !== 8) return null;
  if (!/^[0-9a-f]+$/i.test(h)) return null;
  const n = (i) => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
}

// WCAG relative luminance. Used only to compare two colours with each other,
// never against a fixed cutoff.
function luminance(c) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}

// Light when the palette's background is lighter than the palette's text.
//
// ⚠️ MUST read the CUSTOM PROPERTIES, not <body>'s computed colours. The first
// cut of this used the body pair, on the reasoning that real colour properties
// come back already normalised to rgb() so nothing can mis-parse. The test for
// the actual reported case killed it: with a DARK palette and the "dark-theme"
// class removed - which is the bug, exactly as the user has it - <body>'s
// `color` flips to rgb(0,0,0), because core's own stylesheets key text colour
// on that class too, while the background correctly stays #202020. The pair
// then reads "dark background, darker text" and the comparison answers LIGHT:
// the very failure this rewrite exists to stop, reintroduced one layer down.
// MEASURED: --bg-color / --fg-color are byte-identical with the class present
// and absent, because colorPaletteService writes them from the palette itself.
//
// Order of evidence, each step used only if the one before cannot answer:
//   1. --bg-color vs --fg-color. Palette driven, and proven class independent.
//   2. <body>'s BACKGROUND alone against a mid cutoff. Its background is not
//      contaminated (measured above), only its text is. A threshold is weaker
//      than a comparison, so it is a fallback, not the main path.
//   3. Nothing readable: DARK. The pack is drawn dark, so an unknown page must
//      never be painted light. This is the inversion the old code got wrong.
// Core's "dark-theme" class is deliberately NOT consulted: it is the signal
// that failed, and it can be wrong in both directions (absent on a dark
// palette, which is the reported bug, and present on a light one whose
// optional light_theme flag was never set).
function detectLight() {
  try {
    const hs = getComputedStyle(document.documentElement);
    const bg = parseColor(hs.getPropertyValue("--bg-color"));
    const fg = parseColor(hs.getPropertyValue("--fg-color"));
    if (bg && fg) return luminance(bg) > luminance(fg);

    if (document.body) {
      // alpha: a transparent body tells us nothing about what shows through.
      const bbg = parseColor(getComputedStyle(document.body).backgroundColor);
      if (bbg && bbg[3] > 0.5) return luminance(bbg) > 0.5;
    }
  } catch { /* fall through to dark */ }
  return false;
}

function resolveLight() {
  if (_mode === "Light") return true;
  if (_mode === "Dark") return false;
  return detectLight();
}

// Writes the class only when the answer CHANGES. A class on <html> is the most
// expensive thing on the page to churn (every Pixaroma sheet is scoped to one),
// so this must never write on a tick where nothing moved - see CLAUDE.md
// convention #36 for what class churn costs.
function applyTheme() {
  try {
    const want = resolveLight();
    const el = document.documentElement;
    if (el.classList.contains(LIGHT_CLASS) !== want) el.classList.toggle(LIGHT_CLASS, want);
  } catch { /* nothing to do */ }
}

// Core sets the palette as ~40 inline custom properties on <html>, one call
// each, plus its own class. So watch that element's attributes and coalesce the
// burst into ONE recompute. Event driven, so the idle cost is nil - no poll.
let _scheduled = false;
function scheduleApply() {
  if (_scheduled) return;
  _scheduled = true;
  setTimeout(() => { _scheduled = false; applyTheme(); }, 60);
}

// Called by brand/index.js when the user picks a mode. Takes the value rather
// than reading it back, because a setting's onChange runs before the store write.
export function setThemeMode(mode) {
  _mode = (mode === "Dark" || mode === "Light") ? mode : "Auto";
  applyTheme();
}

// True while ComfyUI shows a light colour palette. Reads the class this module
// maintains, so a canvas paint (Pause Text's Classic status line) and the
// stylesheet can never disagree about which theme is on.
export function isLightTheme() {
  try { return document.documentElement.classList.contains(LIGHT_CLASS); } catch { return false; }
}

// One stylesheet for the whole page, injected once. Safe to call repeatedly.
export function installTextNodesLightTheme() {
  try {
    if (document.getElementById("pix-light-text-nodes")) return;
    const s = document.createElement("style");
    s.id = "pix-light-text-nodes";
    s.textContent = CSS;
    document.head.appendChild(s);

    applyTheme();
    // <body> may not exist yet at import time, and its colours are the best
    // evidence, so re-decide once the document is ready.
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", applyTheme, { once: true });
    }
    try {
      new MutationObserver(scheduleApply).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "style"],
      });
    } catch { /* no observer: the theme is then decided once, at load */ }
  } catch { /* no document yet: nothing to theme */ }
}
