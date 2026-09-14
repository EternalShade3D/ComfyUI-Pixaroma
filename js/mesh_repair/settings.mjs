// Mesh Repair Pixaroma - the floating settings panel.
//
// Copied from Free VRAM's panel, which carries every fix the pack's panels
// earned (node-settings-accent.md): pointerdown outside-close, the gear and the
// pickers exempted, the close button ignored by the drag, listeners registered
// on the next tick and removed on close, and _userMoved reset on CLOSE.

import { createAccentSection } from "../shared/node_settings.mjs";
import { followNode, getNodeScreenRect, makeDraggable, placeBeside } from "../shared/node_panel.mjs";
import { PRINT_SIZES, TRIANGLES, optionLabel, readState, writeState } from "./core.mjs";
import { closeOptionPopup, openOptionPopup } from "./ui.mjs";

let _panel = null;
let _panelNode = null;
let _onChange = null;
let _stopFollow = null;
let _userMoved = false;
let _cpHandle = null;
let _cssDone = false;

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function injectPanelCSS() {
  if (_cssDone || document.getElementById("pix-mrep-panel-css")) return;
  _cssDone = true;
  const style = document.createElement("style");
  style.id = "pix-mrep-panel-css";
  style.textContent = [
    ".pix-mrep-panel{position:fixed;z-index:10010;width:320px;max-width:94vw;background:#1a1a1a;border:1px solid #444;border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.6);font-family:'Segoe UI',system-ui,sans-serif;overflow:hidden;max-height:88vh;display:flex;flex-direction:column;}",
    ".pix-mrep-phead{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #333;color:#ddd;font-size:13px;font-weight:600;cursor:move;}",
    ".pix-mrep-px{border:0;background:transparent;color:#999;font-size:13px;cursor:pointer;padding:2px 7px;border-radius:4px;}",
    ".pix-mrep-px:hover{color:#fff;}",
    ".pix-mrep-pbody{padding:12px;display:flex;flex-direction:column;gap:12px;color:#ddd;overflow-y:auto;min-height:0;}",
    ".pix-mrep-plab{font-size:12px;color:#ddd;}",
    ".pix-mrep-psub{font-size:10px;color:#8f8f8f;margin-top:2px;line-height:1.4;}",
    ".pix-mrep-pfld{display:flex;align-items:center;gap:8px;height:28px;background:#1d1d1d;border:1px solid #444;border-radius:4px;padding:0 9px;cursor:pointer;margin-top:7px;font-size:12px;}",
    ".pix-mrep-pfld:hover{border-color:var(--pix-acc,#f66744);}",
    ".pix-mrep-pfld span{margin-left:auto;color:#ddd;white-space:nowrap;}",
    ".pix-mrep-pfld b{color:var(--pix-acc,#f66744);font-size:9px;font-weight:400;}",
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
  // The colour picker, the generic option popup and our own option list all
  // open on document.body; this guard is capture phase, so without exempting
  // them a pick would dismiss the panel underneath.
  if (e.target.closest?.(".pix-cp-popup, .pix-cp-modal-backdrop, .pix-nset-pop, .pix-mrep-pop")) return;
  // The face's gear acts on click, after this pointerdown: without this the
  // panel would close and instantly reopen.
  if (e.target.closest?.(".pix-mrep-gear")) return;
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
  closeOptionPopup();
  try { _cpHandle?.close?.(); } catch {}
  _cpHandle = null;
  if (_panel) {
    try { _panel.remove(); } catch {}
  }
  _panel = null;
  _panelNode = null;
  _onChange = null;
  _userMoved = false;
  document.removeEventListener("pointerdown", outsideClose, true);
  document.removeEventListener("keydown", escClose, true);
}

export function closeSettingsPanelFor(node) {
  if (_panelNode === node) closeSettingsPanel();
}

function section(body, label, sub) {
  const wrap = el("div");
  wrap.appendChild(el("div", "pix-mrep-plab", label));
  if (sub) wrap.appendChild(el("div", "pix-mrep-psub", sub));
  body.appendChild(wrap);
  return wrap;
}

export function openSettingsPanel(node, onChange) {
  if (_panelNode === node && _panel) {
    closeSettingsPanel();
    return null;
  }
  closeSettingsPanel();
  injectPanelCSS();
  _onChange = onChange || null;
  const panel = el("div", "pix-mrep-panel");
  _panel = panel;
  _panelNode = node;

  const head = el("div", "pix-mrep-phead");
  head.appendChild(el("span", null, "Mesh Repair settings"));
  const x = el("button", "pix-mrep-px", "✕");
  x.type = "button";
  x.onclick = closeSettingsPanel;
  head.appendChild(x);
  panel.appendChild(head);
  makeDraggable(panel, head, {
    onUserMove: () => { _userMoved = true; },
    ignoreSelector: ".pix-mrep-px",
  });

  const body = el("div", "pix-mrep-pbody");

  const tri = section(body, "Triangles in the result",
    "Make solid builds a new surface, which usually has several times the triangles of the model " +
    "that came in (four times on the Ep34 radio). Same as the input brings it back down to that " +
    "count, using ComfyUI's own Decimate Mesh, and keeps the full result if reducing ever opened " +
    "the model again.");
  const fld = el("div", "pix-mrep-pfld");
  const value = el("span", null, optionLabel(TRIANGLES, readState(node).triangles));
  fld.append(el("div", "pix-mrep-plab", "At most"), value, el("b", null, "▼"));
  fld.addEventListener("click", (e) => {
    e.stopPropagation();
    openOptionPopup(node, fld, TRIANGLES, readState(node).triangles, (picked) => {
      writeState(node, { triangles: picked });
      value.textContent = optionLabel(TRIANGLES, picked);
      _onChange?.();
    });
  });
  tri.appendChild(fld);

  const size = section(body, "Size of the stl file",
    "How long the model's longest side is in the stl output. The stl is also stood upright on Z, " +
    "the way slicers expect. The mesh output is not changed.");
  const sizeFld = el("div", "pix-mrep-pfld");
  const sizeValue = el("span", null, optionLabel(PRINT_SIZES, readState(node).printSize));
  sizeFld.append(el("div", "pix-mrep-plab", "Longest side"), sizeValue, el("b", null, "▼"));
  sizeFld.addEventListener("click", (e) => {
    e.stopPropagation();
    openOptionPopup(node, sizeFld, PRINT_SIZES, readState(node).printSize, (picked) => {
      writeState(node, { printSize: picked });
      sizeValue.textContent = optionLabel(PRINT_SIZES, picked);
      _onChange?.();
    });
  });
  size.appendChild(sizeFld);

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
  setTimeout(() => {
    if (_panel !== panel) return;
    document.addEventListener("pointerdown", outsideClose, true);
    document.addEventListener("keydown", escClose, true);
  }, 0);
  return panel;
}
