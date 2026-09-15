// Hard Surface Pixaroma - the floating settings panel.
//
// Copied from js/save_3d/settings.mjs (node-settings-accent.md: copy a panel, do not write one):
// pointerdown outside-close with the node's gear exempt, the close button kept out of the drag handle,
// listeners registered a tick late, _userMoved reset on CLOSE, and the panel follows its node (#29).
// Nothing is folded away, because the panel has room (#34).

import { openPixaromaColorPickerPopup } from "../shared/color_picker.mjs";
import { createAccentSection, applyAccent } from "../shared/node_settings.mjs";
import { followNode, placeBeside, getNodeScreenRect, makeDraggable } from "../shared/node_panel.mjs";
import { DEFAULT_STATE, readState, writeState } from "./core.mjs";

let _panel = null;
let _panelNode = null;
let _onChange = null;
let _stopFollow = null;
let _userMoved = false;
let _cpHandle = null;
let _cssDone = false;

function injectPanelCSS() {
  if (_cssDone) return;
  _cssDone = true;
  const s = document.createElement("style");
  s.textContent = [
    ".pix-hsurf-panel{position:fixed;z-index:10010;width:300px;max-width:94vw;background:#1a1a1a;border:1px solid #444;border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.6);font-family:'Segoe UI',system-ui,sans-serif;overflow:hidden;max-height:88vh;display:flex;flex-direction:column;}",
    ".pix-hsurf-phead{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #333;color:#ddd;font-size:13px;font-weight:600;cursor:move;}",
    ".pix-hsurf-px{border:0;background:transparent;color:#999;font-size:13px;cursor:pointer;padding:2px 7px;border-radius:4px;}",
    ".pix-hsurf-px:hover{color:#fff;}",
    ".pix-hsurf-pbody{padding:12px;display:flex;flex-direction:column;gap:14px;color:#ddd;overflow-y:auto;min-height:0;}",
    ".pix-hsurf-plab{font-size:12px;color:#ddd;}",
    ".pix-hsurf-psub{font-size:10px;color:#8f8f8f;margin-top:3px;line-height:1.4;}",
    ".pix-hsurf-prow{display:flex;align-items:center;gap:9px;margin-top:8px;}",
    ".pix-hsurf-prow .k{font-size:11px;color:#aaa;min-width:66px;}",
    ".pix-hsurf-pgrid{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px;}",
    ".pix-hsurf-pchip{flex:1 1 58px;background:#1d1d1d;border:1px solid #444;color:#aaa;border-radius:4px;padding:4px 8px;font-size:11px;cursor:pointer;font-family:inherit;user-select:none;}",
    ".pix-hsurf-pchip:hover{border-color:var(--pix-acc,#f66744);color:#ddd;}",
    ".pix-hsurf-pchip.on{background:var(--pix-acc,#f66744);border-color:var(--pix-acc,#f66744);color:#fff;}",
    ".pix-hsurf-psl{flex:1;min-width:0;accent-color:var(--pix-acc,#f66744);}",
    ".pix-hsurf-pval{font-size:12px;color:var(--pix-acc,#f66744);min-width:46px;text-align:right;white-space:nowrap;}",
    ".pix-hsurf-sws{display:flex;gap:6px;margin-top:8px;align-items:center;}",
    ".pix-hsurf-swt{width:24px;height:24px;border-radius:4px;border:1px solid #555;cursor:pointer;padding:0;box-sizing:border-box;flex:0 0 auto;}",
    ".pix-hsurf-swt.on{outline:2px solid var(--pix-acc,#f66744);outline-offset:1px;}",
    ".pix-hsurf-swt.custom{background:conic-gradient(#f55,#fd5,#5e7,#5df,#57f,#f5d,#f55);}",
    ".pix-hsurf-sws .pix-hsurf-pval{margin-left:auto;font-family:ui-monospace,monospace;font-size:11px;}",
    ".pix-hsurf-psw{width:30px;height:16px;border-radius:8px;background:#555;position:relative;display:inline-block;cursor:pointer;flex:0 0 auto;transition:background .15s;margin-top:1px;}",
    '.pix-hsurf-psw::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#ccc;transition:left .15s;}',
    ".pix-hsurf-psw.on{background:var(--pix-acc,#f66744);}",
    ".pix-hsurf-psw.on::after{left:16px;background:#fff;}",
  ].join("\n");
  document.head.appendChild(s);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function stopFollowing() {
  _stopFollow?.();
  _stopFollow = null;
}

function outsideClose(e) {
  if (!_panel) return;
  if (_panel.contains(e.target)) return;
  // The colour picker and the accent dropdown open OUTSIDE the panel.
  if (e.target.closest?.(".pix-cp-popup, .pix-cp-modal-backdrop, .pix-nset-pop")) return;
  // The node's own gear toggles the panel on click; closing here on pointerdown would make that click
  // open it straight back up.
  if (_panelNode?._pixHsEls?.gear?.contains(e.target)) return;
  closeHardSurfacePanel();
}

function escClose(e) {
  if (e.key === "Escape" && _panel) {
    e.stopPropagation();
    closeHardSurfacePanel();
  }
}

export function closeHardSurfacePanel() {
  stopFollowing();
  try { _cpHandle?.close?.(); } catch (_e) { /* already closed */ }
  _cpHandle = null;
  try { _panel?.remove(); } catch (_e) { /* already gone */ }
  _panel = null;
  _panelNode = null;
  _onChange = null;
  // Reset on CLOSE, never on open, or one dragged panel teaches the next one to sit still where the
  // node is not.
  _userMoved = false;
  document.removeEventListener("pointerdown", outsideClose, true);
  document.removeEventListener("keydown", escClose, true);
}

export function closeHardSurfacePanelFor(node) {
  if (_panelNode === node) closeHardSurfacePanel();
}

export function isHardSurfacePanelOpenFor(node) {
  return !!_panel && _panelNode === node;
}

function section(body, label, sub) {
  const wrap = el("div");
  wrap.appendChild(el("div", "pix-hsurf-plab", label));
  if (sub) wrap.appendChild(el("div", "pix-hsurf-psub", sub));
  body.appendChild(wrap);
  return wrap;
}

function chipGroup(wrap, items, isOn, onPick) {
  const grid = el("div", "pix-hsurf-pgrid");
  const btns = [];
  const sync = () => {
    for (const [k, b] of btns) b.classList.toggle("on", isOn(k));
  };
  for (const it of items) {
    const b = el("button", "pix-hsurf-pchip", it.label);
    b.type = "button";
    if (it.tip) b.title = it.tip;
    b.addEventListener("click", () => {
      onPick(it.key);
      sync();
    });
    btns.push([it.key, b]);
    grid.appendChild(b);
  }
  sync();
  wrap.appendChild(grid);
  return sync;
}

function switchRow(wrap, node, key, label, sub, set) {
  const row = el("div", "pix-hsurf-prow");
  row.style.alignItems = "flex-start";
  const sw = el("span", "pix-hsurf-psw" + (readState(node)[key] ? " on" : ""));
  sw.setAttribute("role", "switch");
  sw.setAttribute("aria-checked", String(!!readState(node)[key]));
  sw.tabIndex = 0;
  const toggle = () => {
    const on = !readState(node)[key];
    set({ [key]: on });
    sw.classList.toggle("on", on);
    sw.setAttribute("aria-checked", String(on));
  };
  sw.addEventListener("click", toggle);
  sw.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      toggle();
    }
  });
  const txt = el("div");
  txt.appendChild(el("div", "pix-hsurf-plab", label));
  if (sub) txt.appendChild(el("div", "pix-hsurf-psub", sub));
  row.append(sw, txt);
  wrap.appendChild(row);
}

export function openHardSurfacePanel(node, onChange) {
  closeHardSurfacePanel();
  injectPanelCSS();
  _onChange = onChange || null;
  const panel = el("div", "pix-hsurf-panel");
  _panel = panel;
  _panelNode = node;
  // A panel on document.body does not inherit the node's colour (invariant 5).
  applyAccent(panel, node);

  const head = el("div", "pix-hsurf-phead");
  head.appendChild(el("span", null, "Hard Surface settings"));
  const x = el("button", "pix-hsurf-px", "✕");
  x.type = "button";
  x.title = "Close";
  x.onclick = closeHardSurfacePanel;
  head.appendChild(x);
  panel.appendChild(head);
  makeDraggable(panel, head, {
    onUserMove: () => { _userMoved = true; },
    ignoreSelector: ".pix-hsurf-px",
  });

  const body = el("div", "pix-hsurf-pbody");
  const set = (patch) => {
    writeState(node, patch);
    _onChange?.(node);
  };

  // ── the result ──
  const resultWrap = section(body, "The result",
    "These two change what the node hands on, so they apply at the next run.");
  switchRow(resultWrap, node, "panelsAsGroups", "Panels as materials",
    "The model_3d file gets one group, and material, for each flat panel, so a quad remesher can keep its "
    + "edges along the panel borders and the Panels look shows them. Off keeps the model's own groups.", set);
  switchRow(resultWrap, node, "keepColours", "Keep colours",
    "Keeps the vertex colours in both outputs. Off leaves them out, for a plain grey model.", set);

  // ── the viewer ──
  const viewWrap = section(body, "The view on the node",
    "Help for judging the model. They are drawn on the node only and change nothing in the result.");
  switchRow(viewWrap, node, "grid", "Floor grid", "The ground the model stands on.", set);
  switchRow(viewWrap, node, "arrow", "FRONT arrow", "Points to the front the file says (+Z).", set);
  switchRow(viewWrap, node, "marker", "X Y Z marker", "The axes in the corner, turning with the view.", set);
  switchRow(viewWrap, node, "shadow", "Shadow", "The model's shadow on the floor.", set);

  // ── light ──
  const lightWrap = section(body, "Light",
    "Studio has a strong key light, the best for seeing edges. Soft is even and gentle. Flat shows the "
    + "colours with no shading at all.");
  chipGroup(lightWrap, [
    { key: "studio", label: "Studio" },
    { key: "soft", label: "Soft" },
    { key: "flat", label: "Flat" },
  ], (k) => readState(node).light === k, (k) => set({ light: k }));
  const brightRow = el("div", "pix-hsurf-prow");
  const brightSl = el("input", "pix-hsurf-psl");
  brightSl.type = "range";
  brightSl.min = "0.2";
  brightSl.max = "3";
  brightSl.step = "0.05";
  brightSl.value = String(readState(node).bright);
  const brightVal = el("span", "pix-hsurf-pval", `${Math.round(readState(node).bright * 100)}%`);
  brightSl.addEventListener("input", () => {
    const v = parseFloat(brightSl.value);
    set({ bright: v });
    brightVal.textContent = `${Math.round(v * 100)}%`;
  });
  brightRow.append(el("span", "k", "Brightness"), brightSl, brightVal);
  lightWrap.appendChild(brightRow);

  // ── background ──
  const bgWrap = section(body, "Background", "The colour behind the model on the node.");
  const sws = el("div", "pix-hsurf-sws");
  const presets = [["#262626", "Dark grey"], ["#000000", "Black"], ["#7f7f7f", "Mid grey"], ["#ffffff", "White"]];
  const swBtns = [];
  const hexLab = el("span", "pix-hsurf-pval", "");
  const custom = el("button", "pix-hsurf-swt custom");
  const syncBg = () => {
    const bg = readState(node).bg;
    let preset = false;
    for (const [hex, b] of swBtns) {
      const on = hex === bg;
      b.classList.toggle("on", on);
      preset = preset || on;
    }
    custom.classList.toggle("on", !preset);
    hexLab.textContent = bg;
  };
  for (const [hex, label] of presets) {
    const b = el("button", "pix-hsurf-swt");
    b.type = "button";
    b.title = label;
    b.style.background = hex;
    b.addEventListener("click", () => {
      set({ bg: hex });
      syncBg();
    });
    swBtns.push([hex, b]);
    sws.appendChild(b);
  }
  custom.type = "button";
  custom.title = "Any colour";
  custom.addEventListener("click", () => {
    try { _cpHandle?.close?.(); } catch (_e) { /* already closed */ }
    _cpHandle = openPixaromaColorPickerPopup(custom, {
      initialColor: readState(node).bg,
      wide: true,
      resetColor: DEFAULT_STATE.bg,
      onPick: (c) => {
        set({ bg: typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c : DEFAULT_STATE.bg });
        syncBg();
      },
    });
  });
  sws.append(custom, hexLab);
  bgWrap.appendChild(sws);
  syncBg();

  // ── accent colour (convention #19) ──
  body.appendChild(createAccentSection(node, {
    onChange: () => _onChange?.(node),
    onPickerOpen: (h) => { _cpHandle = h; },
  }));

  panel.appendChild(body);
  document.body.appendChild(panel);
  placeBeside(panel, getNodeScreenRect(node));
  _stopFollow = followNode(panel, node, {
    isCurrent: () => _panel === panel,
    isUserMoved: () => _userMoved,
  });

  // A tick late, so the click that OPENED the panel does not close it again.
  setTimeout(() => {
    if (_panel !== panel) return;
    document.addEventListener("pointerdown", outsideClose, true);
    document.addEventListener("keydown", escClose, true);
  }, 0);
  return panel;
}
