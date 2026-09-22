// The @tag / *category / #list layer, SHARED by every node that offers one.
//
// It was all inside js/prompt/index.js until AI Prompt Pixaroma wanted the same tags
// in its idea box. Copying it would have broken the rule prompt.md #24 and #25 are
// built on: wildCat() is the SINGLE source of "is this *category live" and listOf()
// of "is this #list live", so the highlight, the preview, the autocomplete count and
// the actual run can never disagree. Two copies is exactly how they start to.
//
// What lives here: the resolvers (which tag / which line, and the held-pick machinery
// behind them), the colour scheme, the two HTML painters, the measured column parity
// the transparent-textarea trick needs, and the autocomplete popup.
//
// What does NOT: anything that knows about a particular node. A consumer passes a
// small ctx ({ accent, commit }) and owns its own DOM. js/prompt/index.js keeps its
// wired-text join and its run-workflow patcher; both are Prompt Pixaroma's own.
//
// Randomness still stays out of expand.mjs - that module is pure and the resolvers
// below are what inject the picking.

import { BRAND } from "../shared/index.mjs";
import {
  getTags, getCategories, findTag, tagLines, isListTag, isListCat, catOf,
  tagMode, catMode, TEXT_BUCKET, LIST_BUCKET,
} from "./library.mjs";
import { nextIndex, listKey, catKey } from "./cursors.mjs";
import { prevCodePoint, scanTokens } from "./expand.mjs";
// Side effect: the api.queuePrompt wrap that SPENDS a held pick. Importing it here
// means ANY node that uses tags gets the commit, without depending on some other
// node's index.js having loaded first.
import "./pick_commit.mjs";

// ---------------------------------------------------------------------------
// CSS - the token colours and the autocomplete popup
// ---------------------------------------------------------------------------
// Shared so the two nodes cannot drift apart visually: a green run means *category
// in BOTH of them. The class names keep their .pix-prm- prefix even though they are
// no longer Prompt-only - renaming them would touch every rule and every call site
// for no behaviour, and one class meaning one thing across the pack is the point.
//
// NO BACKTICKS ANYWHERE IN THIS TEMPLATE LITERAL, comments included. One ends the
// string, the rest of the stylesheet parses as JavaScript, node --check PASSES, and
// the browser silently refuses the whole module so the node renders as an empty box
// (prompt.md #49 - it shipped that way for a round).
let _tagCSSInjected = false;
export function injectTagCSS() {
  if (_tagCSSInjected) return;
  _tagCSSInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    /* ── WHERE A PIECE OF THE PROMPT CAME FROM (rebuilt 2026-08-02, user's design) ──
       TWO things are encoded at once:
         HUE  = which KIND of token produced it: @tag = your accent (orange by default),
                *category = green, #list = violet, and red = broken whatever the kind.
         SHADE = which ONE of that kind, cycling s0 -> s1 -> s2, so "@a @b" side by side
                never blur into one run.
       The SAME classes are used in the prompt box AND in the expanded preview, which is
       the whole point: a green run downstairs can ONLY have come from a *category, and
       its exact shade tells you WHICH one. The previous version rotated four colours by
       position with no meaning at all, so a violet run read as "that came from the
       #list" when it might have been the third @tag (user-reported, and right).
       Colour ONLY - no weight/width change, or the caret drifts off the transparent
       textarea (see the wrapping-parity note). The .bad rule is last so it beats any
       shade. NOTE: no BACKTICKS anywhere in this CSS, not even inside a comment - the
       whole block is a JS template literal, so a backtick ends the string and the rest
       of the stylesheet is parsed as JavaScript. node --check does NOT catch it; the
       browser just refuses the module and the node renders as an empty box. */
    /* TWO variable names on purpose. Prompt Pixaroma sets --acc on its own root;
       every other node in the pack gets --pix-acc from installNodeAccent. A bare
       var(--acc) is INVALID where that name is undefined, and an invalid custom
       property does not fall back to the rule below it - the declaration is dropped
       and the colour INHERITS from the parent instead. That is silent: the span
       still carries .pix-prm-chip, so a check that only asserts the CLASS passes
       while every @tag renders in the backdrop's plain grey. Reported as "didnt pic
       the color code when used tags", and my own verification had checked the class
       and not the computed colour. Assert the COLOUR. */
    .pix-prm-chip { color:var(--acc, var(--pix-acc, #f66744)); }
    .pix-prm-chip.s1 { color:color-mix(in srgb, var(--acc, var(--pix-acc, #f66744)) 55%, #ffd27a); }
    .pix-prm-chip.s2 { color:color-mix(in srgb, var(--acc, var(--pix-acc, #f66744)) 25%, #ffe3a2); }
    .pix-prm-wild { color:#4fc98a; }
    .pix-prm-wild.s1 { color:#86d977; }
    .pix-prm-wild.s2 { color:#b6e58d; }
    .pix-prm-list { color:#b98cff; }
    .pix-prm-list.s1 { color:#d79bf0; }
    .pix-prm-list.s2 { color:#efaadf; }
    /* A name we cannot find - INCLUDING every half-typed one, since a tag is unknown
       until the moment its last letter lands. So the TEXT stays white and readable and
       only a red wavy underline marks it, exactly like a spellchecker: you can read
       what you are typing, and it takes its real colour the instant it matches. Two
       earlier attempts were worse - a warm #ff4d4d was mistaken for the #f66744 accent,
       and a stronger rose-red fixed that but made typing feel like an error state.
       The underline also carries the meaning for the ~1 in 12 men who cannot separate
       red from orange at all, which no choice of red could. It is safe for the caret:
       text-decoration is PAINTED, it changes no glyph advance and no line breaking, so
       the transparent textarea on top still wraps identically (measured, not assumed -
       see the wrapping-parity note). NO BACKTICKS in this comment; see above. */
    .pix-prm-chip.bad, .pix-prm-wild.bad, .pix-prm-list.bad {
      color:#f0f0f0; text-decoration:underline wavy #ff2d55; text-underline-offset:2px; }
    /* @-autocomplete popup (appended to <body> so the node never clips it) */
    .pix-prm-ac { position:fixed; z-index:10030; background:#1d1d1d; border:1px solid #4a4a4a; border-radius:7px;
      overflow-y:auto; max-height:230px; min-width:260px; box-shadow:0 12px 30px rgba(0,0,0,.6);
      font:12px 'Segoe UI',sans-serif; display:none; }
    .pix-prm-ac-h { padding:5px 11px 3px; font:600 9.5px 'Segoe UI',sans-serif; letter-spacing:.1em; text-transform:uppercase; color:#767676;
      display:flex; align-items:center; gap:6px; border-top:1px solid #262626; }
    .pix-prm-ac-h:first-child { border-top:none; }
    .pix-prm-ac-h .cd { width:8px; height:8px; border-radius:50%; }
    .pix-prm-ac-i { padding:6px 11px; cursor:pointer; }
    .pix-prm-ac-i.sel, .pix-prm-ac-i:hover { background:#3a2a24; }
    .pix-prm-ac-n { font:12px monospace; color:var(--acc, var(--pix-acc, ${BRAND})); }
    .pix-prm-ac-i.wild .pix-prm-ac-n { color:#b98cff; }
    .pix-prm-ac-i.list .pix-prm-ac-n { color:#b98cff; }
    .pix-prm-ac-d { font-size:10.5px; color:#767676; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:320px; }
    .pix-prm-ac-empty { padding:9px 11px; color:#767676; font-size:11.5px; }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
export function escapeHTML(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
export function catColor(name) {
  // The two buckets (Text / List) are not real categories - keep them neutral grey.
  if (name === TEXT_BUCKET || name === LIST_BUCKET) return "#7a7a7a";
  const i = getCategories().indexOf(name);
  if (i < 0) return "#7a7a7a";
  const PAL = ["#e0894b", "#5aa9e6", "#8e7bd6", "#5fbf8f", "#d76b98", "#c9a24b", "#6fb3b8"];
  return PAL[i % PAL.length];
}

// ── *wildcard resolution (a random tag from a category) ─────────────────────
// One category lookup shared by the highlight, the preview, and the run so they
// agree on which *categories are "live". Case-insensitive; returns {canonical, pool}
// or null (unknown OR empty category -> the *token is left literal).
export function wildCat(name) {
  const canonical = getCategories().find((c) => c && c.toLowerCase() === String(name).toLowerCase());
  if (!canonical) return null;
  // catOf() matches the two buckets too: a tag with no category is stored with cat ""
  // while getCategories() surfaces it under "Text" / "List" depending on its kind.
  // Only string-text tags can be rolled (a corrupted import could carry a non-string).
  const pool = getTags().filter((t) => catOf(t).toLowerCase() === canonical.toLowerCase() && typeof t.text === "string");
  return pool.length ? { canonical, pool } : null;
}
// The word the preview shows for a mode ("[random: Styles]" / "[next: Styles]").
export const MODE_WORD = { random: "random", shuffle: "shuffled", order: "next" };

// RUN resolver: the next tag from that category at queue time, per the category's
// mode (random / shuffle / in order - cursors.mjs owns the position). When the pick
// lands on a LIST tag its lines are the options, so pick one of those too, using
// THAT list's own mode (a category of lists composes: pick a list, then a line).
export function pickWild(name, nextOcc) {
  const w = wildCat(name);
  if (!w) return null;
  const ck = catKey(w.canonical);
  const i = nextIndex(ck, w.pool.length, catMode(w.canonical), nextOcc ? nextOcc(ck) : 0);
  const t = w.pool[i < 0 ? 0 : i];
  if (isListTag(t)) {
    const lines = tagLines(t.text);
    if (lines.length) {
      const lk = listKey(t.name);
      const j = nextIndex(lk, lines.length, tagMode(t), nextOcc ? nextOcc(lk) : 0);
      return lines[j < 0 ? 0 : j];
    }
  }
  return t.text;
}
// PREVIEW resolver: a STABLE placeholder (the real pick happens at run time, so the
// preview must not flicker a different sample on every keystroke) that still names
// the mode, so you can see how a slot behaves without opening the library.
export function previewWild(name) {
  const w = wildCat(name);
  return w ? `[${MODE_WORD[catMode(w.canonical)]}: ${w.canonical}]` : null;
}

// ── #list resolution (a random LINE from one tag) ───────────────────────────
// The SINGLE source of "is this #list live", shared by the highlight, the preview,
// the run and the autocomplete count so they can never disagree. The SYMBOL is the
// authority, not the tag's stored kind: #name rolls a line from whatever that tag
// holds (a one-line snippet just returns itself), and @name still gives the whole
// text - so no combination can error. Returns {tag, lines} or null (unknown name /
// no usable lines -> the #token is left literal).
export function listOf(name) {
  const t = findTag(name);
  if (!t || typeof t.text !== "string") return null;
  const lines = tagLines(t.text);
  return lines.length ? { tag: t, lines } : null;
}
// RUN resolver: the next line at queue time, per this list's own mode.
export function pickList(name, nextOcc) {
  const l = listOf(name);
  if (!l) return null;
  const lk = listKey(l.tag.name);
  const i = nextIndex(lk, l.lines.length, tagMode(l.tag), nextOcc ? nextOcc(lk) : 0);
  return l.lines[i < 0 ? 0 : i];
}
// PREVIEW resolver: a STABLE placeholder, same reasoning as previewWild.
export function previewList(name) {
  const l = listOf(name);
  return l ? `[${MODE_WORD[tagMode(l.tag)]} line: ${l.tag.name}]` : null;
}
export const PREVIEW_RESOLVERS = { resolveWild: previewWild, resolveList: previewList };
// The RUN resolvers are built FRESH per node expansion, because they carry the
// per-use counter that makes a repeated `#list` in one box deal a new card. Starting
// each node at 0 is what keeps two Prompt nodes in step on their first use (the
// user's choice) and what stops a parked, unwired node consuming a card of its own.
export function makeRunResolvers() {
  const used = new Map();
  const nextOcc = (k) => { const n = used.get(k) || 0; used.set(k, n + 1); return n; };
  return {
    resolveWild: (name) => pickWild(name, nextOcc),
    resolveList: (name) => pickList(name, nextOcc),
  };
}

// THE one place that decides what colour a piece of prompt gets. Both the prompt box
// and the expanded preview call it, which is what lets you follow a colour from the
// token you typed to the words it produced. They MUST also count tokens the same way -
// `nth` is "the Nth token of this kind", counted over EVERY token of that kind
// including unknown ones, so an unrecognised `@typo` cannot knock the two surfaces out
// of step with each other.
const KIND_CLASS = { tag: "pix-prm-chip", wild: "pix-prm-wild", list: "pix-prm-list" };
const TOKEN_SHADES = 3;
export function tokenClass(kind, nth, known) {
  const base = KIND_CLASS[kind] || KIND_CLASS.tag;
  if (!known) return base + " bad";
  const s = nth % TOKEN_SHADES;
  return s ? `${base} s${s}` : base;
}
export const newTokenCounts = () => ({ tag: 0, wild: 0, list: 0 });

/**
 * The HTML for a highlight BACKDROP - the visible text layer that sits under a
 * transparent textarea. Returns a string rather than writing to an element, so each
 * node owns its own DOM and there is still one implementation of the colouring.
 */
export function backdropHTML(text) {
  // Colour the @tags / *categories / #lists scanTokens counts (an email's @name and
  // arithmetic like 2*2 stay plain, matching the preview + the run). Hue = kind,
  // shade = which one of that kind, red = unknown; see the CSS block for the rules.
  if (typeof text !== "string") text = "";
  const toks = scanTokens(text);
  const seen = newTokenCounts();
  let html = "";
  let i = 0;
  for (const h of toks) {
    html += escapeHTML(text.slice(i, h.start));
    const known = h.kind === "tag" ? !!findTag(h.name)
      : h.kind === "wild" ? !!wildCat(h.name)
      : !!listOf(h.name);
    const nth = seen[h.kind]++;
    html += `<span class="${tokenClass(h.kind, nth, known)}">${escapeHTML(h.raw)}</span>`;
    i = h.end;
  }
  html += escapeHTML(text.slice(i));
  // A <div> with white-space:pre-wrap drops ONLY the single empty line after a
  // TRAILING newline, but the textarea keeps it - so the invisible textarea would be
  // taller than the visible backdrop and the caret would drift off the text you
  // click. One trailing space puts content on that final line so both layers have
  // identical height + wrapping (works for any number of trailing newlines).
  if (text.endsWith("\n")) html += " ";
  return html;
}
// Colour each token's expanded words with the SAME class the prompt box gave that
// token, so you can trace a run of colour back to what produced it. Every piece is
// escaped exactly as before - the ONLY markup added is our own span wrappers, so this
// cannot become an HTML injection route.
export function paintExpanded(text, spans) {
  if (!spans || !spans.length) return escapeHTML(text);
  const seen = newTokenCounts();
  let html = "", i = 0;
  for (const s of spans) {
    // Count FIRST, and count every token of the kind exactly as renderBackdrop does -
    // including one about to be skipped below. Counting after the skip would let a
    // single malformed span shift every later shade, and the prompt box and this
    // preview would quietly stop agreeing about which tag was which.
    const nth = (s && seen[s.kind] !== undefined) ? seen[s.kind]++ : 0;
    // Defensive: a span that does not line up with this string (a stale record) is
    // skipped rather than allowed to slice the text apart at the wrong place.
    if (!s || s.start < i || s.end > text.length || s.end < s.start) continue;
    html += escapeHTML(text.slice(i, s.start));
    const body = escapeHTML(text.slice(s.start, s.end));
    // An unknown token was left literal, so it is your text now, not tag text, and
    // stays plain - the prompt box above already marks it red.
    html += s.known ? `<span class="${tokenClass(s.kind, nth, true)}">${body}</span>` : body;
    i = s.end;
  }
  return html + escapeHTML(text.slice(i));
}
/**
 * THE TWO TEXT COLUMNS MUST BE EXACTLY THE SAME WIDTH, AND THAT IS MEASURED, NEVER
 * ASSUMED (prompt.md #18, house convention #26).
 *
 * scrollbar-gutter:stable on both layers is the first line of defence and is still
 * in the CSS, but it is a GUESS about engine behaviour: whether an overflow:hidden
 * box reserves a gutter varies by engine and version, and a ComfyUI theme can style
 * ::-webkit-scrollbar differently for a textarea than for a div. Where they differ
 * the layers wrap at different characters and the error ACCUMULATES on every wrapped
 * line - measured 7 / 18 / 28 characters out on lines 4 / 5 / 6, which is the
 * "the cursor gets further from the text the longer the prompt" report.
 *
 * Invariants: reset to the CSS baseline FIRST so corrections cannot compound; write
 * NOTHING under half a pixel so a healthy machine is untouched; DOM only, so it can
 * never dirty a workflow. Drive it from a ResizeObserver on the TEXTAREA - never on
 * the backdrop, whose padding this mutates, or it re-fires forever.
 */
// The properties that decide WHERE A LINE BREAKS. Copied from the live textarea
// onto the backdrop every relayout, as LONGHANDS, never the `font` shorthand (the
// computed shorthand serialises to "" whenever a sub-property makes it
// unserialisable, which would silently drop the backdrop back to the node body's
// font). `js/shared/line_numbers.mjs::copyTextMetrics` is where this idiom comes
// from and is the reference; it is not shared yet because that module mirrors a
// textarea into a MEASURING mirror and this one into a VISIBLE layer, so the two
// lists are free to diverge. Keep them in step by hand if you change either.
//
// WHY it is not enough to declare the same values in both stylesheets, which is
// what the CSS already does: a ComfyUI theme, a user stylesheet or a font
// extension can restyle `textarea` without touching our div, and then the two
// layers wrap at different characters. That error ACCUMULATES down the box, which
// is the whole "the caret is nowhere near what I type" family (prompt.md #18,
// house convention #26). Declaring a value is not owning it - measuring is.
//
// `text-transform` and `text-indent` are deliberately NOT copied: both change what
// the user READS on the visible layer, and neither has ever been implicated.
function mirrorTextMetrics(bd, cs) {
  bd.style.fontStyle = cs.fontStyle;
  bd.style.fontVariant = cs.fontVariant;
  bd.style.fontWeight = cs.fontWeight;
  bd.style.fontSize = cs.fontSize;
  bd.style.fontFamily = cs.fontFamily;
  bd.style.fontStretch = cs.fontStretch;
  bd.style.letterSpacing = cs.letterSpacing;
  bd.style.wordSpacing = cs.wordSpacing;
  bd.style.lineHeight = cs.lineHeight;
  bd.style.whiteSpace = cs.whiteSpace;
  bd.style.overflowWrap = cs.overflowWrap;
  bd.style.wordBreak = cs.wordBreak;
  bd.style.tabSize = cs.tabSize;
}

export function syncColumns(ta, bd) {
  if (!ta || !bd || !ta.isConnected) return;
  bd.style.paddingRight = "";
  bd.style.width = "";
  const cs = getComputedStyle(ta), bs = getComputedStyle(bd);
  // Before the width maths, because a mismatched font is the other half of the
  // same failure and neither correction is any use on its own.
  mirrorTextMetrics(bd, cs);
  const taText = ta.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const padR = parseFloat(bs.paddingRight);
  const bdText = bd.clientWidth - parseFloat(bs.paddingLeft) - padR;
  if (!(taText > 0) || !(bdText > 0)) return;      // not laid out yet - the observer retries
  const gap = bdText - taText;                     // > 0 = the visible text column is too wide
  if (Math.abs(gap) < 0.5) return;                 // already identical - write nothing
  if (padR + gap >= 0) bd.style.paddingRight = (padR + gap) + "px";
  else bd.style.width = Math.max(0, bd.offsetWidth - gap) + "px";  // padding can't go negative
}
const TAG_TOKEN_RE = /@([a-zA-Z0-9_\-]*)$/;
const WILD_TOKEN_RE = /\*([a-zA-Z0-9_\-]*)$/;
const LIST_TOKEN_RE = /#([a-zA-Z0-9_\-]*)$/;
let _acEl = null;
let _ac = null; // { ctx, ta, start, items, sel, sym }

function acPopup() {
  if (_acEl) return _acEl;
  _acEl = document.createElement("div");
  _acEl.className = "pix-prm-ac";
  document.body.appendChild(_acEl);
  return _acEl;
}
export function closeAC() {
  if (_acEl) _acEl.style.display = "none";
  _ac = null;
}
// The popup only re-evaluates on 'input'; clicking or arrow-keying the caret OFF a
// tag doesn't fire 'input', so it would linger. Watch caret moves and close/refresh
// it. One singleton document listener (no per-node leak); no-ops when no AC is open.
let _acSelInstalled = false;
function installACSelWatch() {
  if (_acSelInstalled) return;
  _acSelInstalled = true;
  document.addEventListener("selectionchange", () => {
    if (!_ac) return;
    const ta = _ac.ta;
    if (!ta || document.activeElement !== ta) { closeAC(); return; }
    maybeAC(_ac.ctx, ta);
  });
}
export function maybeAC(ctx, ta) {
  const pos = ta.selectionStart;
  const upto = ta.value.slice(0, pos);
  // @tag autocomplete. Boundary (Unicode-consistent with scanTokens): don't open
  // when @ sits after a letter/number/mark/_ (an email) or another @.
  const mt = TAG_TOKEN_RE.exec(upto);
  if (mt) {
    const start = pos - mt[0].length;
    // Whole code point, not a code unit - see prevCodePoint in expand.mjs. Using
    // ta.value[start-1] would hand back half of an astral letter and open the list.
    const prev = prevCodePoint(ta.value, start);
    if (prev && /[\p{L}\p{N}\p{M}_@]/u.test(prev)) { closeAC(); return; }
    openAC(ctx, ta, start, mt[1].toLowerCase(), "tag");
    return;
  }
  // *wildcard (category) autocomplete - same boundary so "2*2" doesn't trigger.
  const mw = WILD_TOKEN_RE.exec(upto);
  if (mw) {
    const start = pos - mw[0].length;
    const prev = prevCodePoint(ta.value, start);
    if (prev && /[\p{L}\p{N}\p{M}_*]/u.test(prev)) { closeAC(); return; }
    openAC(ctx, ta, start, mw[1].toLowerCase(), "wild");
    return;
  }
  // #list autocomplete - same boundary (a "#" glued to a word isn't a token).
  const ml = LIST_TOKEN_RE.exec(upto);
  if (ml) {
    const start = pos - ml[0].length;
    const prev = prevCodePoint(ta.value, start);
    if (prev && /[\p{L}\p{N}\p{M}_#]/u.test(prev)) { closeAC(); return; }
    openAC(ctx, ta, start, ml[1].toLowerCase(), "list");
    return;
  }
  closeAC();
}
function openAC(ctx, ta, start, q, mode) {
  installACSelWatch();
  const el = acPopup();
  el.style.setProperty("--acc", ctx.accent ? ctx.accent() : BRAND);
  el.innerHTML = "";
  const flat = [];
  const sym = mode === "wild" ? "*" : mode === "list" ? "#" : "@";

  if (mode === "list") {
    // #lists offer ONLY the tags on the List side (the Text / List switch in the
    // library), grouped by their List category, with the number of options they roll
    // from - straight out of listOf so the count is exactly the pool. Inserts #name.
    const lists = getTags()
      .filter((t) => isListTag(t) && t.name.toLowerCase().includes(q))
      .map((t) => ({ name: t.name, cat: catOf(t), lines: listOf(t.name)?.lines || [] }))
      .filter((t) => t.lines.length > 0);
    if (!lists.length) {
      const e = document.createElement("div");
      e.className = "pix-prm-ac-empty";
      e.textContent = q
        ? `No list matches "#${q}".`
        : "No lists yet. Open Tags, then switch a tag to List and put one option per line.";
      el.appendChild(e);
    } else {
      const byCat = new Map();
      for (const t of lists) { if (!byCat.has(t.cat)) byCat.set(t.cat, []); byCat.get(t.cat).push(t); }
      for (const c of getCategories("list").filter((c) => byCat.has(c))) {
        const h = document.createElement("div");
        h.className = "pix-prm-ac-h";
        h.innerHTML = `<span class="cd" style="background:${catColor(c)}"></span>${escapeHTML(c)}`;
        el.appendChild(h);
        for (const t of byCat.get(c)) {
          const idx = flat.length;
          flat.push({ name: t.name });
          const d = document.createElement("div");
          d.className = "pix-prm-ac-i list" + (idx === 0 ? " sel" : "");
          d.dataset.i = String(idx);
          d.innerHTML = `<div class="pix-prm-ac-n">#${escapeHTML(t.name)}</div>` +
            `<div class="pix-prm-ac-d">${t.lines.length} option${t.lines.length === 1 ? "" : "s"} · ${escapeHTML(t.lines.slice(0, 3).join(" · "))}</div>`;
          d.addEventListener("mousedown", (e) => { e.preventDefault(); pickAC(flat[idx]); });
          el.appendChild(d);
        }
      }
    }
  } else if (mode === "wild") {
    // *wildcards list only categories that (a) can be TYPED as one *token - the token
    // grammar is [A-Za-z0-9_-]+, but a category name may contain spaces/symbols a
    // *token can't capture (offering "Sci Fi" would insert *Sci Fi and leave garbage);
    // AND (b) actually have at least one tag. Count comes straight from wildCat so the
    // number shown is exactly the pool it rolls from. Picking inserts *Category.
    const cats = getCategories()
      .filter((c) => c && c.toLowerCase().includes(q) && /^[a-zA-Z0-9_\-]+$/.test(c))
      .map((c) => ({ name: c, count: (wildCat(c)?.pool.length) || 0, list: isListCat(c) }))
      .filter((c) => c.count > 0);
    if (!cats.length) {
      const e = document.createElement("div");
      e.className = "pix-prm-ac-empty";
      e.textContent = q ? `No category matches "*${q}".` : "No categories with tags yet. Open Tags to add one.";
      el.appendChild(e);
    } else {
      const h = document.createElement("div");
      h.className = "pix-prm-ac-h";
      h.innerHTML = `<span class="cd" style="background:#b98cff"></span>random from category`;
      el.appendChild(h);
      for (const c of cats) {
        const idx = flat.length;
        flat.push({ name: c.name });
        const d = document.createElement("div");
        d.className = "pix-prm-ac-i wild" + (idx === 0 ? " sel" : "");
        d.dataset.i = String(idx);
        // A List category composes: *Cat picks one of its lists, then one of its lines.
        const desc = c.list
          ? `${c.count} list${c.count === 1 ? "" : "s"} · a random line from one of them`
          : `${c.count} tag${c.count === 1 ? "" : "s"} · random each run`;
        d.innerHTML = `<div class="pix-prm-ac-n">*${escapeHTML(c.name)}</div><div class="pix-prm-ac-d">${desc}</div>`;
        d.addEventListener("mousedown", (e) => { e.preventDefault(); pickAC(flat[idx]); });
        el.appendChild(d);
      }
    }
  } else {
    // @tags: ONLY the Text side, grouped by category. A List belongs to #, so
    // offering it here would just be noise (typing @listname still works - the symbol
    // is always the authority - it is simply not advertised).
    const tags = getTags().filter((t) => !isListTag(t) && t.name.toLowerCase().includes(q));
    const byCat = new Map();
    for (const t of tags) {
      const c = catOf(t);
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c).push(t);
    }
    const order = getCategories("text").filter((c) => byCat.has(c));
    if (!tags.length) {
      const e = document.createElement("div");
      e.className = "pix-prm-ac-empty";
      e.textContent = q ? `No text tag matches "@${q}". Type # for your lists, or open Tags to add one.` : "No tags yet. Open Tags to add one.";
      el.appendChild(e);
    } else {
      for (const c of order) {
        const h = document.createElement("div");
        h.className = "pix-prm-ac-h";
        h.innerHTML = `<span class="cd" style="background:${catColor(c)}"></span>${escapeHTML(c)}`;
        el.appendChild(h);
        for (const t of byCat.get(c)) {
          const idx = flat.length;
          flat.push(t);
          const d = document.createElement("div");
          d.className = "pix-prm-ac-i" + (idx === 0 ? " sel" : "");
          d.dataset.i = String(idx);
          d.innerHTML = `<div class="pix-prm-ac-n">@${escapeHTML(t.name)}</div><div class="pix-prm-ac-d">${escapeHTML(t.text)}</div>`;
          d.addEventListener("mousedown", (e) => { e.preventDefault(); pickAC(flat[idx]); });
          el.appendChild(d);
        }
      }
    }
  }

  _ac = { ctx, ta, start, items: flat, sel: 0, sym };
  const r = ta.getBoundingClientRect();
  el.style.display = "block";
  el.style.minWidth = Math.max(260, Math.min(360, r.width)) + "px";
  // Place below the field, flipping above if the FULL popup would run off the bottom.
  const below = window.innerHeight - r.bottom;
  const need = Math.min(el.offsetHeight || 230, 230);
  el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8)) + "px";
  if (below < need && r.top > below) { el.style.top = ""; el.style.bottom = (window.innerHeight - r.top + 4) + "px"; }
  else { el.style.bottom = ""; el.style.top = (r.bottom + 4) + "px"; }
}
function updateACSel() {
  if (!_acEl) return;
  _acEl.querySelectorAll(".pix-prm-ac-i").forEach((c) => c.classList.toggle("sel", +c.dataset.i === _ac.sel));
  const sel = _acEl.querySelector(".pix-prm-ac-i.sel");
  if (sel) sel.scrollIntoView({ block: "nearest" });
}
// A leading space when the char before would jam the tag against a word or a
// previous @tag, so inserts never produce "@a@b" (which reads badly and is
// awkward to edit). See expand.mjs - chained tags DO expand, but a space is cleaner.
export function tagSep(before) {
  return (before && /[\p{L}\p{N}\p{M}_@*#]$/u.test(before)) ? " " : "";
}
// A trailing space after an inserted tag (unless the next char already separates
// it), so typing more text continues as a SEPARATE word instead of extending the
// tag name (@goldenhour + "asdas" -> "@goldenhour asdas", not "@goldenhourasdas").
export function tagTrail(after) {
  return (!after || /^[\p{L}\p{N}\p{M}_@*#]/u.test(after)) ? " " : "";
}
function pickAC(item) {   // exported behaviour is via maybeAC / acKeydown
  if (!_ac) return;
  const { ctx, ta, start, sym } = _ac;
  const v = ta.value;
  const before = v.slice(0, start);
  const after = v.slice(ta.selectionStart);
  const ins = tagSep(before) + sym + item.name + tagTrail(after);
  ta.value = before + ins + after;
  const p = (before + ins).length; // cursor after the trailing space
  ta.selectionStart = ta.selectionEnd = p;
  closeAC();
  ta.focus();
  // The consumer owns what "saved" means - Prompt writes promptState.text and
  // re-renders its body, AI Prompt writes its idea and repaints its face.
  ctx.commit?.(ta.value);
}

/**
 * The keydown branch the autocomplete needs, shared so the two nodes cannot drift.
 * Returns TRUE when it consumed the key; the caller then does nothing else with it.
 *
 * The order here is load-bearing (prompt.md #19d): Ctrl/Cmd+Enter is checked FIRST so
 * it closes the list and BUBBLES to run the workflow - with Enter-to-insert checked
 * first, running from the box was swallowed. The arrows and Enter are only claimed
 * when there is actually a list to move through, so with an empty popup ("No list
 * matches...") they still move the caret between the lines of a multi-line prompt.
 */
export function acKeydown(e) {
  if (!_ac || !_acEl || _acEl.style.display !== "block") return false;
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { closeAC(); return false; }
  if (e.key === "ArrowDown" && _ac.items.length) {
    e.preventDefault(); _ac.sel = Math.min(_ac.sel + 1, _ac.items.length - 1); updateACSel(); return true;
  }
  if (e.key === "ArrowUp" && _ac.items.length) {
    e.preventDefault(); _ac.sel = Math.max(_ac.sel - 1, 0); updateACSel(); return true;
  }
  if ((e.key === "Enter" || e.key === "Tab") && _ac.items.length) {
    e.preventDefault(); e.stopPropagation(); pickAC(_ac.items[_ac.sel]); return true;
  }
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeAC(); return true; }
  return false;
}

/**
 * Insert a tag at the caret of `ta` and hand the new value to ctx.commit.
 * Used by the library editor's Insert button, which is a second way into the same
 * field. `sym` is "#" for a List tag and "@" for a snippet.
 */
export function insertTagAt(ta, ctx, name, sym) {
  if (!ta) return;
  const s = sym === "#" ? "#" : "@";
  const p = ta.selectionStart;
  const before = ta.value.slice(0, p);
  const after = ta.value.slice(p);
  const ins = tagSep(before) + s + name + tagTrail(after);
  ta.value = before + ins + after;
  ta.selectionStart = ta.selectionEnd = p + ins.length;
  ctx.commit?.(ta.value);
}
document.addEventListener("mousedown", (e) => {
  if (_acEl && _acEl.style.display === "block" && !_acEl.contains(e.target)) {
    if (!_ac || e.target !== _ac.ta) closeAC();
  }
}, true);
// The list is position:fixed, so zooming or panning the canvas would leave it stranded
// at the old screen spot while the node moves under it (the same bug the separator
// dropdown was fixed for). installCanvasZoomPassthrough forwards wheel events from
// over the textarea to the canvas, so this fires even with the cursor on the prompt box.
document.addEventListener("wheel", (e) => {
  if (_acEl && _acEl.style.display === "block" && !_acEl.contains(e.target)) closeAC();
}, true);

