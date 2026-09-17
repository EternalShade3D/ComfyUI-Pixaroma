// ComfyUI's LIGHT colour palettes, for node faces that were designed dark.
//
// Reported on Discord 2026-09-10/13: with ComfyUI's light theme on, the buttons
// on the prompt-typing nodes were light text on a light node (measured 1.2:1 to
// 1.4:1 contrast, about invisible) and every text box stayed black.
//
// THE SIGNAL. Core puts the class "dark-theme" on <html> for every dark palette
// and removes it for a light one (GraphView.vue watches the active palette;
// PrimeVue's own dark mode keys on the same class). So every rule below sits
// under :where(:root:not(.dark-theme)). In a dark palette none of them can
// match, which is why the dark look is untouched (measured: every element's
// computed colours identical before and after).
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

const LIGHT = ":where(:root:not(.dark-theme))";

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

// True while ComfyUI shows a light colour palette. Read live, so a canvas paint
// (Pause Text's Classic status line) follows a theme switch on its next frame.
export function isLightTheme() {
  try { return !document.documentElement.classList.contains("dark-theme"); } catch { return false; }
}

// One stylesheet for the whole page, injected once. Safe to call repeatedly.
export function installTextNodesLightTheme() {
  try {
    if (document.getElementById("pix-light-text-nodes")) return;
    const s = document.createElement("style");
    s.id = "pix-light-text-nodes";
    s.textContent = CSS;
    document.head.appendChild(s);
  } catch { /* no document yet: nothing to theme */ }
}
