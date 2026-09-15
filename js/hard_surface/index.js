// Hard Surface Pixaroma - wiring.
//
// core.mjs holds the state, ui.mjs the face, settings.mjs the gear panel, help.mjs the help page. The
// view draws through Load 3D's ONE shared renderer in its stage mode, the same way Save 3D's does
// (.claude/patterns/save-3d.md #6: stage mode must never change Load 3D).

import { app } from "/scripts/app.js";
import { isVueNodes, applyAdaptiveCanvasOnly, installZoomRepaint } from "../shared/nodes2.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { installCanvasZoomPassthrough } from "../shared/canvas_zoom.mjs";
import { installResizeFloor } from "../shared/resize_floor.mjs";
import { onRendererChange } from "../shared/renderer_switch.mjs";
import { registerNodeHelp } from "../shared/help.mjs";
import { accentOf, installNodeAccent, registerNodeSettings, repaintAccent } from "../shared/node_settings.mjs";
import {
  attachCanvas, setModel, detach, requestDraw, invalidateModel, knownNodes, canvasAttached,
} from "../load_3d/engine.mjs";
import {
  CLASS, HIDDEN_INPUT, UI_WIDGET, WIDGET_TYPE, engineState, promptState, readLastRun, readState, refValue,
  writeLastRun,
} from "./core.mjs";
import { buildFace, renderFace, placeBand, destroyFace, VP_MIN } from "./ui.mjs";
import { openHardSurfacePanel, closeHardSurfacePanelFor, isHardSurfacePanelOpenFor } from "./settings.mjs";
import { HARD_SURFACE_HELP } from "./help.mjs";

// CONSTANTS, never live measurements: getMinHeight drives node.size, and a measured value comes back a
// pixel or two different between save and reload, which flags an untouched workflow "modified" (Vue
// Compat #18). The fixed rows are sharpen 28, views 24, looks 24, options 26, info 22, with five 6px
// gaps and 2 + 8 of padding; the view fills what is left above its floor.
const WIDGET_MIN_H = 28 + 24 + 24 + 26 + 22 + 5 * 6 + 10 + VP_MIN;
// MEASURED in Classic (#39, 2026-09-15): node.size[1] minus the widget root = 76 above it (three output
// rows) + 10 below it. Save 3D's 66 is for two slot rows; re-measure after any slot change.
const CHROME_H = 86;
const MIN_W = 360;
const MIN_H = WIDGET_MIN_H + CHROME_H;
const DEFAULT_W = 380;
// The view comes out square at the default width: its inside is DEFAULT_W - 37 wide (Save 3D, measured)
// and its box 2 taller than its inside.
const DEFAULT_H = WIDGET_MIN_H - VP_MIN + (DEFAULT_W - 37) + 2 + CHROME_H;

registerNodeHelp(CLASS, HARD_SURFACE_HELP);

// Its own panel, so ONE registration with registerNodeSettings (never also registerNodeAccent,
// node-settings-accent invariant 3b).
registerNodeSettings(CLASS, {
  title: "Hard Surface",
  ownMenuItem: false,
  open: (node) => openPanel(node),
  closeFor: (node) => closeHardSurfacePanelFor(node),
  // The face paints its own canvas, which no shared repaint reaches (node-settings-accent.md invariant 2).
  onChange: (node) => renderFace(node),
});

function openPanel(node) {
  openHardSurfacePanel(node, (n) => {
    renderFace(n);
    repaintAccent(n);
    n.setDirtyCanvas?.(true, true);
  });
}

function toggleSettings(node) {
  if (isHardSurfacePanelOpenFor(node)) closeHardSurfacePanelFor(node);
  else openPanel(node);
}

// What the shared renderer asks this node while drawing it.
function stageOptions() {
  return {
    stage: true,
    getState: (n) => engineState(readState(n)),
    // The files are shown exactly as the node wrote them: no Fix to preview here.
    display: () => null,
    accent: (n) => accentOf(n),
  };
}

/** Point the renderer at the file Before / After asks for. `fresh`: a run rewrote both under the same names. */
function syncView(node, fresh) {
  const run = readLastRun(node);
  if (fresh && run) {
    // The renderer caches a URL for two minutes; both files were written again, the one not shown too.
    for (const ref of [run.before, run.after]) {
      const v = refValue(ref);
      if (v) invalidateModel(v);
    }
  }
  const value = run ? refValue(run[readState(node).show]) : "";
  setModel(node, value || "none");
  renderFace(node);
}

// ── let go of nodes that are gone ──────────────────────────────────────────
// A tab switch rebuilds every node object (Vue Compat #11) and a copy builds a throwaway one, each with
// an engine record. One shared check frees the records of Hard Surface nodes that are neither in the
// graph nor on the page.
let _poll = 0;

function watchNodes() {
  if (_poll) return;
  _poll = setInterval(() => {
    const live = new Set(buildIndex().values());
    const mine = knownNodes().filter((n) => n?.comfyClass === CLASS || n?.type === CLASS);
    for (const n of mine) {
      if (!live.has(n) && !canvasAttached(n)) detach(n);
    }
    if (!live.size && !knownNodes().some((n) => n?.comfyClass === CLASS || n?.type === CLASS)) {
      clearInterval(_poll);
      _poll = 0;
    }
  }, 1000);
}

app.registerExtension({
  name: "Pixaroma.HardSurface",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== CLASS) return;
    // A re-registration (hot reload) must not double-wrap every hook.
    if (nodeType.prototype._pixHsPatched) return;
    nodeType.prototype._pixHsPatched = true;

    const _created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = _created?.apply(this, arguments);
      const node = this;
      const root = buildFace(node, {
        openSettings: (n) => toggleSettings(n),
        showChanged: (n) => syncView(n, false),
      });
      // A UNIQUE widget type, or Nodes 2.0 renders its own widget and orphans ours.
      const w = node.addDOMWidget(UI_WIDGET, WIDGET_TYPE, root, {
        serialize: false,
        getMinHeight: () => WIDGET_MIN_H,
      });
      // Two different flags: options.serialize keeps it out of the PROMPT, the top-level one keeps it out
      // of the saved WORKFLOW (widgets_values).
      w.serialize = false;
      applyAdaptiveCanvasOnly(w);
      w.computeLayoutSize = () => ({ minHeight: WIDGET_MIN_H, minWidth: 1 });
      installCanvasZoomPassthrough(root); // convention #17
      installNodeAccent(node, root);
      node._pixHsFloorOff = installResizeFloor(root, () => WIDGET_MIN_H);
      // The view's backing store is sized dpr x zoom: a pure zoom resizes nothing, so the ResizeObserver
      // stays quiet and the view would go soft.
      node._pixHsZoomOff = installZoomRepaint(node, null, () => requestDraw(node), "_pixHsRaf");
      try {
        node._pixHsRo = new ResizeObserver(() => requestDraw(node));
        node._pixHsRo.observe(node._pixHsEls.vp);
      } catch (_e) { /* no ResizeObserver: redraws still come from every change */ }
      attachCanvas(node, node._pixHsEls.canvas, () => renderFace(node), stageOptions());
      placeBand(node);
      node._pixHsRendererOff = onRendererChange(() => {
        placeBand(node);
        renderFace(node);
      });

      // Fresh size, SYNCHRONOUSLY: configure() runs straight after and restores a saved size, which a
      // deferred write would clobber (convention #9).
      if (!Array.isArray(node.size)) node.size = [DEFAULT_W, DEFAULT_H];
      node.size[0] = DEFAULT_W;
      node.size[1] = DEFAULT_H;

      queueMicrotask(() => {
        // Only a node that is IN a graph loads a model: Copy, Clone and Convert to Subgraph configure a
        // throwaway copy that is never added (Vue Compat #8).
        if (node.graph) syncView(node, false);
        renderFace(node);
      });
      watchNodes();
      return r;
    };

    const _configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = _configure?.apply(this, arguments);
      // DOM and the engine only: nothing here writes node.properties or node.size, so an untouched
      // workflow never opens "modified" (Vue Compat #18).
      if (this.graph) syncView(this, false);
      const node = this;
      queueMicrotask(() => {
        if (node.graph) syncView(node, false);
        renderFace(node);
      });
      watchNodes();
      return r;
    };

    // The empty view says "wire in a mesh" while nothing is wired. DOM only, so it is safe inside the
    // connection replay of a workflow load.
    const _conn = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const r = _conn?.apply(this, arguments);
      const node = this;
      if (node._pixHsEls) queueMicrotask(() => renderFace(node));
      return r;
    };

    // A CACHED node replays its executed event with the SAME payload: an unchanged stamp means nothing
    // was written this time (free-vram.md #5).
    const _executed = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      _executed?.apply(this, arguments);
      const report = message?.pixaroma_hardsurface?.[0];
      if (!report || typeof report !== "object") return;
      if (report.skipped || !report.after) {
        renderFace(this);
        return;
      }
      const prev = readLastRun(this);
      const replay = !!prev && prev.stamp != null && prev.stamp === report.stamp;
      if (!replay) writeLastRun(this, report);
      syncView(this, !replay);
    };

    // Classic-only clamps; in Nodes 2.0 the rendered size lives in the Vue layout store and clamping
    // node.size desyncs the two.
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
      // The load gate matters most here: a draw hook runs on the first frame of a load, earlier than any
      // other clamp (convention #7).
      if (!isVueNodes() && !isGraphLoading()) {
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
        if (this.size[1] < MIN_H) this.size[1] = MIN_H;
      }
      return _draw?.apply(this, arguments);
    };

    const _removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      closeHardSurfacePanelFor(this);
      this._pixHsFloorOff?.();
      this._pixHsFloorOff = null;
      this._pixHsZoomOff?.();
      this._pixHsZoomOff = null;
      this._pixHsRendererOff?.();
      this._pixHsRendererOff = null;
      try { this._pixHsRo?.disconnect(); } catch (_e) { /* already gone */ }
      this._pixHsRo = null;
      destroyFace(this);
      detach(this);
      return _removed?.apply(this, arguments);
    };
  },
});

// ── graphToPrompt: inject the state ────────────────────────────────────────
// INJECT ONLY - never prune (reference_never_prune_in_graphtoprompt).
function buildIndex() {
  const index = new Map();
  const seen = new Set();
  const visit = (graph, prefix) => {
    if (!graph || seen.has(graph)) return; // a subgraph cycle would recurse forever
    seen.add(graph);
    for (const n of graph._nodes || graph.nodes || []) {
      if (!n) continue;
      if (n.comfyClass === CLASS || n.type === CLASS) {
        // Keyed by the COMPOSITE id ("5:12" inside a subgraph), so a top-level node and a subgraph node
        // sharing a local id cannot swap states.
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
    console.error("[Pixaroma.HardSurface] inject failed", e);
  }
  return result;
};
