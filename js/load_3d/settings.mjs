// Load 3D Pixaroma - the floating settings panel.
//
// Shaped after js/save_video/settings.mjs (node-settings-accent.md: copy a
// panel, do not write one): pointerdown outside-close with the gear exempt, the
// close button kept out of the drag handle, listeners registered a tick late,
// _userMoved reset on CLOSE, and the panel follows its node (#29). Nothing is
// folded away, because the panel has room (#34).

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
    ".pix-l3d-panel{position:fixed;z-index:10010;width:300px;max-width:94vw;background:#1a1a1a;border:1px solid #444;border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.6);font-family:'Segoe UI',system-ui,sans-serif;overflow:hidden;max-height:88vh;display:flex;flex-direction:column;}",
    ".pix-l3d-phead{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #333;color:#ddd;font-size:13px;font-weight:600;cursor:move;}",
    ".pix-l3d-px{border:0;background:transparent;color:#999;font-size:13px;cursor:pointer;padding:2px 7px;border-radius:4px;}",
    ".pix-l3d-px:hover{color:#fff;}",
    ".pix-l3d-pbody{padding:12px;display:flex;flex-direction:column;gap:14px;color:#ddd;overflow-y:auto;min-height:0;}",
    ".pix-l3d-plab{font-size:12px;color:#ddd;}",
    ".pix-l3d-psub{font-size:10px;color:#8f8f8f;margin-top:3px;line-height:1.4;}",
    ".pix-l3d-prow{display:flex;align-items:center;gap:9px;margin-top:8px;}",
    ".pix-l3d-prow .k{font-size:11px;color:#aaa;min-width:66px;}",
    ".pix-l3d-pgrid{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px;}",
    ".pix-l3d-pchip{flex:1 1 58px;background:#1d1d1d;border:1px solid #444;color:#aaa;border-radius:4px;padding:4px 8px;font-size:11px;cursor:pointer;font-family:inherit;user-select:none;}",
    ".pix-l3d-pchip:hover{border-color:var(--pix-acc,#f66744);color:#ddd;}",
    ".pix-l3d-pchip.on{background:var(--pix-acc,#f66744);border-color:var(--pix-acc,#f66744);color:#fff;}",
    ".pix-l3d-psl{flex:1;min-width:0;accent-color:var(--pix-acc,#f66744);}",
    ".pix-l3d-psl:disabled{opacity:.4;}",
    ".pix-l3d-pval{font-size:12px;color:var(--pix-acc,#f66744);min-width:46px;text-align:right;white-space:nowrap;}",
    ".pix-l3d-sws{display:flex;gap:6px;margin-top:8px;align-items:center;}",
    ".pix-l3d-swt{width:24px;height:24px;border-radius:4px;border:1px solid #555;cursor:pointer;padding:0;box-sizing:border-box;flex:0 0 auto;}",
    ".pix-l3d-swt.on{outline:2px solid var(--pix-acc,#f66744);outline-offset:1px;}",
    ".pix-l3d-swt.custom{background:conic-gradient(#f55,#fd5,#5e7,#5df,#57f,#f5d,#f55);}",
    ".pix-l3d-sws .pix-l3d-pval{margin-left:auto;font-family:ui-monospace,monospace;font-size:11px;}",
    ".pix-l3d-psw{width:30px;height:16px;border-radius:8px;background:#555;position:relative;display:inline-block;cursor:pointer;flex:0 0 auto;transition:background .15s;}",
    '.pix-l3d-psw::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#ccc;transition:left .15s;}',
    ".pix-l3d-psw.on{background:var(--pix-acc,#f66744);}",
    ".pix-l3d-psw.on::after{left:16px;background:#fff;}",
    ".pix-l3d-pbtn{background:#1d1d1d;border:1px solid #444;color:#ccc;border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer;font-family:inherit;}",
    ".pix-l3d-pbtn:hover{border-color:var(--pix-acc,#f66744);color:#fff;}",
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
  // The node's own gear toggles the panel on click; closing here on pointerdown
  // would make that click open it straight back up.
  if (_panelNode?._pixL3dEls?.gear?.contains(e.target)) return;
  closeLoad3DPanel();
}

function escClose(e) {
  if (e.key === "Escape" && _panel) {
    e.stopPropagation();
    closeLoad3DPanel();
  }
}

export function closeLoad3DPanel() {
  stopFollowing();
  try { _cpHandle?.close?.(); } catch (_e) { /* already closed */ }
  _cpHandle = null;
  try { _panel?.remove(); } catch (_e) { /* already gone */ }
  _panel = null;
  _panelNode = null;
  _onChange = null;
  // Reset on CLOSE, never on open, or one dragged panel teaches the next one to
  // sit still where the node is not.
  _userMoved = false;
  document.removeEventListener("pointerdown", outsideClose, true);
  document.removeEventListener("keydown", escClose, true);
}

export function closeLoad3DPanelFor(node) {
  if (_panelNode === node) closeLoad3DPanel();
}

export function isLoad3DPanelOpenFor(node) {
  return !!_panel && _panelNode === node;
}

function section(body, label, sub) {
  const wrap = el("div");
  wrap.appendChild(el("div", "pix-l3d-plab", label));
  if (sub) wrap.appendChild(el("div", "pix-l3d-psub", sub));
  body.appendChild(wrap);
  return wrap;
}

function chipGroup(wrap, items, isOn, onPick) {
  const grid = el("div", "pix-l3d-pgrid");
  const btns = [];
  const sync = () => {
    for (const [k, b] of btns) b.classList.toggle("on", isOn(k));
  };
  for (const it of items) {
    const b = el("button", "pix-l3d-pchip", it.label);
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

function slider(wrap, label, min, max, step, get, fmt, onInput) {
  const row = el("div", "pix-l3d-prow");
  const k = el("span", "k", label);
  const sl = el("input", "pix-l3d-psl");
  sl.type = "range";
  sl.min = String(min);
  sl.max = String(max);
  sl.step = String(step);
  sl.value = String(get());
  const val = el("span", "pix-l3d-pval", fmt(get()));
  sl.addEventListener("input", () => {
    const v = parseFloat(sl.value);
    onInput(v);
    val.textContent = fmt(v);
  });
  row.append(k, sl, val);
  wrap.appendChild(row);
  return sl;
}

export function openLoad3DPanel(node, onChange) {
  closeLoad3DPanel();
  injectPanelCSS();
  _onChange = onChange || null;
  const panel = el("div", "pix-l3d-panel");
  _panel = panel;
  _panelNode = node;
  // A panel on document.body does not inherit the node's colour (invariant 5).
  applyAccent(panel, node);

  const head = el("div", "pix-l3d-phead");
  head.appendChild(el("span", null, "Load 3D settings"));
  const x = el("button", "pix-l3d-px", "✕");
  x.type = "button";
  x.title = "Close";
  x.onclick = closeLoad3DPanel;
  head.appendChild(x);
  panel.appendChild(head);
  makeDraggable(panel, head, {
    onUserMove: () => { _userMoved = true; },
    ignoreSelector: ".pix-l3d-px",
  });

  const body = el("div", "pix-l3d-pbody");
  const set = (patch) => {
    writeState(node, patch);
    _onChange?.(node);
  };

  // ── background ──
  const bgWrap = section(body, "Background",
    "The colour behind the model in the picture. Depth and Normal always use their own.");
  const sws = el("div", "pix-l3d-sws");
  const presets = [["#262626", "Dark grey"], ["#000000", "Black"], ["#7f7f7f", "Mid grey"], ["#ffffff", "White"]];
  const swBtns = [];
  const hexLab = el("span", "pix-l3d-pval", "");
  const custom = el("button", "pix-l3d-swt custom");
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
    const b = el("button", "pix-l3d-swt");
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

  // ── light ──
  const lightWrap = section(body, "Light",
    "Studio has a strong key light for shape. Soft is even and gentle. Flat shows the colours "
    + "exactly as saved, with no shading at all.");
  chipGroup(lightWrap, [
    { key: "studio", label: "Studio" },
    { key: "soft", label: "Soft" },
    { key: "flat", label: "Flat" },
  ], (k) => readState(node).light === k, (k) => set({ light: k }));
  slider(lightWrap, "Brightness", 0.2, 3, 0.05, () => readState(node).bright,
    (v) => `${Math.round(v * 100)}%`, (v) => set({ bright: v }));

  // ── camera ──
  const camWrap = section(body, "Camera",
    "Orthographic keeps parallel lines parallel, like a technical drawing or a character "
    + "turnaround. A narrow field of view flattens the model, a wide one stretches it.");
  let fovSlider = null;
  chipGroup(camWrap, [
    { key: "persp", label: "Perspective" },
    { key: "ortho", label: "Orthographic" },
  ], (k) => readState(node).proj === k, (k) => {
    set({ proj: k });
    if (fovSlider) fovSlider.disabled = k === "ortho";
  });
  fovSlider = slider(camWrap, "Field of view", 10, 100, 1, () => readState(node).fov,
    (v) => `${Math.round(v)}°`, (v) => set({ fov: v }));
  fovSlider.disabled = readState(node).proj === "ortho";

  // ── model ──
  const modelWrap = section(body, "Model",
    "Many STL and OBJ files come in lying down: Z is up stands them upright. Turn spins the "
    + "model a quarter, for one whose front faces the wrong way.");
  chipGroup(modelWrap, [
    { key: "Y", label: "Y is up" },
    { key: "Z", label: "Z is up" },
  ], (k) => readState(node).up === k, (k) => set({ up: k }));
  const turnRow = el("div", "pix-l3d-prow");
  const turnBtn = el("button", "pix-l3d-pbtn", "Turn 90°");
  turnBtn.type = "button";
  const turnVal = el("span", "pix-l3d-pval", "");
  const syncTurn = () => { turnVal.textContent = `${readState(node).turn * 90}°`; };
  turnBtn.addEventListener("click", () => {
    set({ turn: (readState(node).turn + 1) % 4 });
    syncTurn();
  });
  turnRow.append(turnBtn, turnVal);
  modelWrap.appendChild(turnRow);
  syncTurn();

  // ── viewer ──
  const gridRow = el("div", "pix-l3d-prow");
  gridRow.style.alignItems = "flex-start";
  const sw = el("span", "pix-l3d-psw" + (readState(node).grid ? " on" : ""));
  sw.setAttribute("role", "switch");
  sw.setAttribute("aria-checked", String(readState(node).grid));
  sw.tabIndex = 0;
  const toggleGrid = () => {
    const on = !readState(node).grid;
    set({ grid: on });
    sw.classList.toggle("on", on);
    sw.setAttribute("aria-checked", String(on));
  };
  sw.addEventListener("click", toggleGrid);
  sw.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      toggleGrid();
    }
  });
  const gridTxt = el("div");
  gridTxt.appendChild(el("div", "pix-l3d-plab", "Show the grid"));
  gridTxt.appendChild(el("div", "pix-l3d-psub", "A floor grid on the node's view only. It is never part of the picture."));
  gridRow.append(sw, gridTxt);
  body.appendChild(gridRow);

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
