// Save 3D Pixaroma - the floating settings panel.
//
// Copied from js/load_3d/settings.mjs (node-settings-accent.md: copy a panel, do
// not write one): pointerdown outside-close with the node's gear exempt, the
// close button kept out of the drag handle, listeners registered a tick late,
// _userMoved reset on CLOSE, and the panel follows its node (#29). Nothing is
// folded away, because the panel has room (#34). The Save folder row is Save
// Video's: Browse asks the Load Images from Folder native-dialog route, and the
// folder is only ever approved there, on the server.

import { openPixaromaColorPickerPopup } from "../shared/color_picker.mjs";
import { createAccentSection, applyAccent } from "../shared/node_settings.mjs";
import { followNode, placeBeside, getNodeScreenRect, makeDraggable } from "../shared/node_panel.mjs";
import { pixApiUrl } from "../shared/api_url.mjs";
import { normalizePath } from "../shared/filename_mirror.mjs";
import { DEFAULT_STATE, STL_SIZES, UPS, readState, writeState } from "./core.mjs";

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
    ".pix-s3d-panel{position:fixed;z-index:10010;width:300px;max-width:94vw;background:#1a1a1a;border:1px solid #444;border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.6);font-family:'Segoe UI',system-ui,sans-serif;overflow:hidden;max-height:88vh;display:flex;flex-direction:column;}",
    ".pix-s3d-phead{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #333;color:#ddd;font-size:13px;font-weight:600;cursor:move;}",
    ".pix-s3d-px{border:0;background:transparent;color:#999;font-size:13px;cursor:pointer;padding:2px 7px;border-radius:4px;}",
    ".pix-s3d-px:hover{color:#fff;}",
    ".pix-s3d-pbody{padding:12px;display:flex;flex-direction:column;gap:14px;color:#ddd;overflow-y:auto;min-height:0;}",
    ".pix-s3d-plab{font-size:12px;color:#ddd;}",
    ".pix-s3d-psub{font-size:10px;color:#8f8f8f;margin-top:3px;line-height:1.4;}",
    ".pix-s3d-psub.warn{color:#e0a040;}",
    ".pix-s3d-prow{display:flex;align-items:center;gap:9px;margin-top:8px;}",
    ".pix-s3d-prow .k{font-size:11px;color:#aaa;min-width:66px;}",
    ".pix-s3d-pgrid{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px;}",
    ".pix-s3d-pchip{flex:1 1 58px;background:#1d1d1d;border:1px solid #444;color:#aaa;border-radius:4px;padding:4px 8px;font-size:11px;cursor:pointer;font-family:inherit;user-select:none;}",
    ".pix-s3d-pchip:hover{border-color:var(--pix-acc,#f66744);color:#ddd;}",
    ".pix-s3d-pchip.on{background:var(--pix-acc,#f66744);border-color:var(--pix-acc,#f66744);color:#fff;}",
    ".pix-s3d-psl{flex:1;min-width:0;accent-color:var(--pix-acc,#f66744);}",
    ".pix-s3d-pval{font-size:12px;color:var(--pix-acc,#f66744);min-width:46px;text-align:right;white-space:nowrap;}",
    ".pix-s3d-sws{display:flex;gap:6px;margin-top:8px;align-items:center;}",
    ".pix-s3d-swt{width:24px;height:24px;border-radius:4px;border:1px solid #555;cursor:pointer;padding:0;box-sizing:border-box;flex:0 0 auto;}",
    ".pix-s3d-swt.on{outline:2px solid var(--pix-acc,#f66744);outline-offset:1px;}",
    ".pix-s3d-swt.custom{background:conic-gradient(#f55,#fd5,#5e7,#5df,#57f,#f5d,#f55);}",
    ".pix-s3d-sws .pix-s3d-pval{margin-left:auto;font-family:ui-monospace,monospace;font-size:11px;}",
    ".pix-s3d-psw{width:30px;height:16px;border-radius:8px;background:#555;position:relative;display:inline-block;cursor:pointer;flex:0 0 auto;transition:background .15s;margin-top:1px;}",
    '.pix-s3d-psw::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#ccc;transition:left .15s;}',
    ".pix-s3d-psw.on{background:var(--pix-acc,#f66744);}",
    ".pix-s3d-psw.on::after{left:16px;background:#fff;}",
    ".pix-s3d-pfield{flex:1;min-width:0;box-sizing:border-box;background:#1d1d1d;border:1px solid #444;color:#e0e0e0;border-radius:4px;padding:5px 7px;font:11px ui-monospace,monospace;outline:none;}",
    ".pix-s3d-pfield:focus{border-color:var(--pix-acc,#f66744);}",
    ".pix-s3d-pbtn{flex:0 0 auto;background:#1d1d1d;border:1px solid #444;color:#ccc;border-radius:4px;padding:5px 10px;font-size:11px;cursor:pointer;font-family:inherit;user-select:none;}",
    ".pix-s3d-pbtn:hover{border-color:var(--pix-acc,#f66744);color:#ddd;}",
    ".pix-s3d-pbtn:disabled{opacity:.6;cursor:default;}",
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
  if (_panelNode?._pixS3dEls?.gear?.contains(e.target)) return;
  closeSave3DPanel();
}

function escClose(e) {
  if (e.key === "Escape" && _panel) {
    e.stopPropagation();
    closeSave3DPanel();
  }
}

export function closeSave3DPanel() {
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

export function closeSave3DPanelFor(node) {
  if (_panelNode === node) closeSave3DPanel();
}

export function isSave3DPanelOpenFor(node) {
  return !!_panel && _panelNode === node;
}

function section(body, label, sub) {
  const wrap = el("div");
  wrap.appendChild(el("div", "pix-s3d-plab", label));
  if (sub) wrap.appendChild(el("div", "pix-s3d-psub", sub));
  body.appendChild(wrap);
  return wrap;
}

function chipGroup(wrap, items, isOn, onPick) {
  const grid = el("div", "pix-s3d-pgrid");
  const btns = [];
  const sync = () => {
    for (const [k, b] of btns) b.classList.toggle("on", isOn(k));
  };
  for (const it of items) {
    const b = el("button", "pix-s3d-pchip", it.label);
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
  const row = el("div", "pix-s3d-prow");
  row.style.alignItems = "flex-start";
  const sw = el("span", "pix-s3d-psw" + (readState(node)[key] ? " on" : ""));
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
  txt.appendChild(el("div", "pix-s3d-plab", label));
  if (sub) txt.appendChild(el("div", "pix-s3d-psub", sub));
  row.append(sw, txt);
  wrap.appendChild(row);
}

function folderSection(body, node, set) {
  const wrap = section(body, "Save folder",
    "Where Save and Save now write the file. Empty is ComfyUI's output folder. For a folder of your own, "
    + "click Browse and pick it once: that approves it, and you can type or paste it from then on. "
    + "The Media Assets panel lists only files saved inside the output folder.");
  const row = el("div", "pix-s3d-prow");
  const input = el("input", "pix-s3d-pfield");
  input.type = "text";
  input.spellcheck = false;
  input.placeholder = "ComfyUI output folder";
  input.value = readState(node).folder || "";
  input.title = "Empty = ComfyUI's output folder. The Name on the node, with its subfolders, goes inside this folder.";
  const note = el("div", "pix-s3d-psub warn");
  note.hidden = true;
  input.addEventListener("input", () => {
    note.hidden = true;
    set({ folder: input.value });
  });
  const browse = el("button", "pix-s3d-pbtn", "Browse");
  browse.type = "button";
  browse.title = "Pick a folder with the system folder dialog";
  browse.addEventListener("click", async () => {
    browse.disabled = true;
    browse.textContent = "…";
    let res;
    try {
      const r = await fetch(pixApiUrl(
        `/pixaroma/api/load_images_folder/pick_native?path=${encodeURIComponent(readState(node).folder || "")}`));
      res = await r.json();
    } catch (e) {
      res = { ok: false };
    }
    browse.disabled = false;
    browse.textContent = "Browse";
    // The node can be deleted while the system dialog is open.
    if (!node.graph) return;
    if (res?.ok && res.path) {
      const folder = normalizePath(res.path);
      set({ folder });
      input.value = folder;
      note.hidden = true;
    } else if (!res?.cancelled) {
      note.textContent = "The folder dialog did not open here. Type or paste the folder instead.";
      note.hidden = false;
    }
  });
  row.append(input, browse);
  wrap.append(row, note);
}

export function openSave3DPanel(node, onChange) {
  closeSave3DPanel();
  injectPanelCSS();
  _onChange = onChange || null;
  const panel = el("div", "pix-s3d-panel");
  _panel = panel;
  _panelNode = node;
  // A panel on document.body does not inherit the node's colour (invariant 5).
  applyAccent(panel, node);

  const head = el("div", "pix-s3d-phead");
  head.appendChild(el("span", null, "Save 3D settings"));
  const x = el("button", "pix-s3d-px", "✕");
  x.type = "button";
  x.title = "Close";
  x.onclick = closeSave3DPanel;
  head.appendChild(x);
  panel.appendChild(head);
  makeDraggable(panel, head, {
    onUserMove: () => { _userMoved = true; },
    ignoreSelector: ".pix-s3d-px",
  });

  const body = el("div", "pix-s3d-pbody");
  const set = (patch) => {
    writeState(node, patch);
    _onChange?.(node);
  };

  // ── the viewer ──
  const viewWrap = section(body, "The view on the node",
    "Help for judging the model. They are drawn on the node only and never go into the saved file.");
  switchRow(viewWrap, node, "grid", "Floor grid", "The ground the model should stand on.", set);
  switchRow(viewWrap, node, "arrow", "FRONT arrow", "Points to the front the file says (+Z).", set);
  switchRow(viewWrap, node, "marker", "X Y Z marker", "The axes in the corner, turning with the view.", set);
  switchRow(viewWrap, node, "shadow", "Shadow", "A gap between the model and its shadow means it floats.", set);

  // ── light ──
  const lightWrap = section(body, "Light",
    "Studio has a strong key light for shape. Soft is even and gentle. Flat shows the colours exactly "
    + "as saved, with no shading at all.");
  chipGroup(lightWrap, [
    { key: "studio", label: "Studio" },
    { key: "soft", label: "Soft" },
    { key: "flat", label: "Flat" },
  ], (k) => readState(node).light === k, (k) => set({ light: k }));
  const brightRow = el("div", "pix-s3d-prow");
  const brightSl = el("input", "pix-s3d-psl");
  brightSl.type = "range";
  brightSl.min = "0.2";
  brightSl.max = "3";
  brightSl.step = "0.05";
  brightSl.value = String(readState(node).bright);
  const brightVal = el("span", "pix-s3d-pval", `${Math.round(readState(node).bright * 100)}%`);
  brightSl.addEventListener("input", () => {
    const v = parseFloat(brightSl.value);
    set({ bright: v });
    brightVal.textContent = `${Math.round(v * 100)}%`;
  });
  brightRow.append(el("span", "k", "Brightness"), brightSl, brightVal);
  lightWrap.appendChild(brightRow);

  // ── background ──
  const bgWrap = section(body, "Background", "The colour behind the model on the node.");
  const sws = el("div", "pix-s3d-sws");
  const presets = [["#262626", "Dark grey"], ["#000000", "Black"], ["#7f7f7f", "Mid grey"], ["#ffffff", "White"]];
  const swBtns = [];
  const hexLab = el("span", "pix-s3d-pval", "");
  const custom = el("button", "pix-s3d-swt custom");
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
    const b = el("button", "pix-s3d-swt");
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

  // ── the saved file ──
  folderSection(body, node, set);

  const upWrap = section(body, "Up direction in the saved file",
    "Auto writes OBJ and GLB standing on Y, the way Blender and game engines read them, and STL "
    + "standing on Z, the way slicers read it. The view on the node always shows the model standing up.");
  chipGroup(upWrap, UPS.map((u) => ({ key: u.value, label: u.label, tip: u.title })),
    (k) => readState(node).up === k, (k) => set({ up: k }));

  const stlWrap = section(body, "STL size",
    "The longest side of an STL file, in millimetres, the way a slicer measures it. Model keeps the "
    + "model's own units. OBJ and GLB files always keep the model's own size.");
  chipGroup(stlWrap, STL_SIZES.map((v) => ({
    key: String(v), label: v === "model" ? "Model" : `${v} mm`,
  })), (k) => String(readState(node).stlSize) === k, (k) => set({ stlSize: k === "model" ? "model" : Number(k) }));

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
