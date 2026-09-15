// Edit 3D Pixaroma - wiring. core.mjs the state, face.mjs the node face, help.mjs the help, editor.mjs the fullscreen
// editor (imported on the first Open, so a page that never opens it never parses it).

import { app } from "/scripts/app.js";
import { isVueNodes, applyAdaptiveCanvasOnly } from "../shared/nodes2.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { installCanvasZoomPassthrough } from "../shared/canvas_zoom.mjs";
import { installResizeFloor } from "../shared/resize_floor.mjs";
import { onRendererChange } from "../shared/renderer_switch.mjs";
import { registerNodeHelp } from "../shared/help.mjs";
import { registerNodeAccent, installNodeAccent, openNodeSettings } from "../shared/node_settings.mjs";
import { CLASS, HIDDEN_INPUT, UI_WIDGET, WIDGET_TYPE, UI_KEY, promptState, readState, readLastRun, writeLastRun } from "./core.mjs";
import { buildFace, renderFace, destroyFace, hideModelWidget, placeBand, flash, SNAP_MIN } from "./face.mjs";
import { EDIT3D_HELP } from "./help.mjs";

// CONSTANTS, never live measurements (Vue Compat #18). Rows: file 28, open 34, info 22, three 6px gaps, 2 + 8 of
// padding, the picture fills what is left above SNAP_MIN. CHROME_H: the two-input / three-output slot column, the
// same as Quad Remesh's measured 86 (CLAUDE.md #39); re-measured on this node.
const WIDGET_MIN_H = 28 + 34 + 22 + 3 * 6 + 10 + SNAP_MIN;
const CHROME_H = 86;
const MIN_W = 320;
const MIN_H = WIDGET_MIN_H + CHROME_H;
const DEFAULT_W = 340;
// The picture comes out about 4:3 (the node picture is 512 x 384) at the default width.
const DEFAULT_H = WIDGET_MIN_H - SNAP_MIN + Math.round((DEFAULT_W - 37) * 0.75) + 2 + CHROME_H;

registerNodeHelp(CLASS, EDIT3D_HELP);
registerNodeAccent(CLASS, { title: "Edit 3D" });

let _editor = null;
function editorModule() {
  if (!_editor) {
    _editor = import("./editor.mjs");
    _editor.catch(() => { _editor = null; });
  }
  return _editor;
}

async function openFor(node) {
  try {
    const m = await editorModule();
    await m.openEditor(node);
  } catch (e) {
    console.error("[Pixaroma.Edit3D] the editor could not open", e);
    flash(node, `The editor could not open: ${e?.message || e}`, true, 10000);
  }
}

app.registerExtension({
  name: "Pixaroma.Edit3D",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== CLASS) return;
    if (nodeType.prototype._pixE3dPatched) return;
    nodeType.prototype._pixE3dPatched = true;

    const _created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = _created?.apply(this, arguments);
      const node = this;
      hideModelWidget(node);
      const root = buildFace(node, { openSettings: (n) => openNodeSettings(n), openEditor: (n) => openFor(n) });
      const w = node.addDOMWidget(UI_WIDGET, WIDGET_TYPE, root, { serialize: false, getMinHeight: () => WIDGET_MIN_H });
      // Two different flags: options.serialize keeps it out of the PROMPT, the top-level one out of the WORKFLOW.
      w.serialize = false;
      applyAdaptiveCanvasOnly(w);
      w.computeLayoutSize = () => ({ minHeight: WIDGET_MIN_H, minWidth: 1 });
      installCanvasZoomPassthrough(root); // convention #17
      installNodeAccent(node, root);
      node._pixE3dFloorOff = installResizeFloor(root, () => WIDGET_MIN_H);
      placeBand(node);
      node._pixE3dRendererOff = onRendererChange(() => {
        placeBand(node);
        renderFace(node);
      });
      // Fresh size, SYNCHRONOUSLY: configure() runs straight after and restores a saved size (convention #9).
      if (!Array.isArray(node.size)) node.size = [DEFAULT_W, DEFAULT_H];
      node.size[0] = DEFAULT_W;
      node.size[1] = DEFAULT_H;
      queueMicrotask(() => renderFace(node));
      return r;
    };

    const _configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = _configure?.apply(this, arguments);
      // DOM only: nothing here writes node.properties or node.size (Vue Compat #18).
      hideModelWidget(this);
      const node = this;
      queueMicrotask(() => renderFace(node));
      return r;
    };

    // The file row switches to "Wired in" while a wire is plugged in. DOM only, so safe in a load's link replay.
    const _conn = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const r = _conn?.apply(this, arguments);
      const node = this;
      if (node._pixE3dEls) queueMicrotask(() => renderFace(node));
      return r;
    };

    // A CACHED node replays its executed event with the SAME stamp: nothing new was handed on (free-vram.md #5).
    const _executed = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      _executed?.apply(this, arguments);
      const report = message?.[UI_KEY]?.[0];
      if (!report || typeof report !== "object") return;
      if (!report.skipped) {
        const prev = readLastRun(this);
        if (!(prev && prev.stamp === report.stamp)) writeLastRun(this, report);
      }
      renderFace(this);
    };

    // Classic-only clamps, gated on the load (conventions #7 and #39).
    const _resize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (!isVueNodes() && !isGraphLoading()) {
        if (size[0] < MIN_W) size[0] = MIN_W;
        if (size[1] < MIN_H) size[1] = MIN_H;
      }
      return _resize?.apply(this, arguments);
    };
    const _draw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function () {
      if (!isVueNodes() && !isGraphLoading()) {
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
        if (this.size[1] < MIN_H) this.size[1] = MIN_H;
      }
      return _draw?.apply(this, arguments);
    };

    const _removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      const node = this;
      _editor?.then((m) => m.closeEditorFor(node)).catch(() => {});
      node._pixE3dFloorOff?.();
      node._pixE3dFloorOff = null;
      node._pixE3dRendererOff?.();
      node._pixE3dRendererOff = null;
      destroyFace(node);
      return _removed?.apply(this, arguments);
    };
  },
});

// ── graphToPrompt: inject the state. INJECT ONLY, never prune. ─────────────
function buildIndex() {
  const index = new Map();
  const seen = new Set();
  const visit = (graph, prefix) => {
    if (!graph || seen.has(graph)) return;
    seen.add(graph);
    for (const n of graph._nodes || graph.nodes || []) {
      if (!n) continue;
      if (n.comfyClass === CLASS || n.type === CLASS) {
        // Keyed by the COMPOSITE id ("5:12" inside a subgraph), so two nodes sharing a local id cannot swap states.
        index.set(prefix + String(n.id), n);
        if (!index.has(String(n.id))) index.set(String(n.id), n);
      }
      if (n.subgraph) visit(n.subgraph, prefix + String(n.id) + ":");
    }
  };
  visit(app.graph, "");
  return index;
}

function findNode(index, id) {
  const s = String(id);
  if (index.has(s)) return index.get(s);
  const tail = s.includes(":") ? s.slice(s.lastIndexOf(":") + 1) : null;
  return tail && index.has(tail) ? index.get(tail) : null;
}

const _origGraphToPrompt_fn = app.graphToPrompt;
const _origGraphToPrompt = (...a) => _origGraphToPrompt_fn.apply(app, a);
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt(...args);
  try {
    const out = result?.output;
    if (out) {
      let index = null;
      for (const id in out) {
        const entry = out[id];
        if (!entry || entry.class_type !== CLASS) continue;
        if (!index) index = buildIndex();
        const node = findNode(index, id);
        if (!node) continue;
        entry.inputs = entry.inputs || {};
        entry.inputs[HIDDEN_INPUT] = JSON.stringify(promptState(readState(node)));
      }
    }
  } catch (e) {
    console.error("[Pixaroma.Edit3D] inject failed", e);
  }
  return result;
};
