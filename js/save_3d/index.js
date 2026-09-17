// Save 3D Pixaroma - wiring.
//
// core.mjs holds the state, fix.mjs the Fix maths (a mirror of the Python),
// ui.mjs the face, settings.mjs the gear panel, help.mjs the help page. The view
// draws through Load 3D's ONE shared renderer in its stage mode.

import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { isVueNodes, applyAdaptiveCanvasOnly, installZoomRepaint } from "../shared/nodes2.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { installCanvasZoomPassthrough } from "../shared/canvas_zoom.mjs";
import { installResizeFloor } from "../shared/resize_floor.mjs";
import { onRendererChange } from "../shared/renderer_switch.mjs";
import { registerNodeHelp } from "../shared/help.mjs";
import { accentOf, installNodeAccent, registerNodeSettings, repaintAccent } from "../shared/node_settings.mjs";
import { installNativeTextMenu } from "../shared/native_text_menu.mjs";
import {
  attachCanvas, setModel, detach, requestDraw, invalidateModel, knownNodes, canvasAttached,
} from "../load_3d/engine.mjs";
import {
  CLASS, HIDDEN_INPUT, UI_WIDGET, WIDGET_TYPE, engineState, fileKey, promptState, readLastRun, readState,
  refValue, writeLastRun,
} from "./core.mjs";
import { displayTransform, matrixRows, placementFlags } from "./fix.mjs";
import {
  buildFace, renderFace, placeBand, destroyFace, flash, setCheckLine, VP_MIN,
} from "./ui.mjs";
import { openSave3DPanel, closeSave3DPanelFor, isSave3DPanelOpenFor } from "./settings.mjs";
import { SAVE_3D_HELP } from "./help.mjs";

// CONSTANTS, never live measurements: getMinHeight drives node.size, and a
// measured value comes back a pixel or two different between save and reload,
// which flags an untouched workflow "modified" (Vue Compat #18). The fixed rows
// are mode 28, views 24, looks 24, fix 26, check 22, format and name 26, info 36
// (two 14px lines + 8 of padding: a run's line wraps once it holds a file name,
// 2026-09-17), with seven 6px gaps and 2 + 8 of padding; the view fills what is
// left above its floor. CHROME_H is MEASURED in Classic (#39, 2026-09-15):
// node.size[1] minus the widget root = 56 above it (the two slot rows) + 10 below it.
const WIDGET_MIN_H = 28 + 24 + 24 + 26 + 22 + 26 + 36 + 7 * 6 + 10 + VP_MIN;
const CHROME_H = 66;
const MIN_W = 360;
const MIN_H = WIDGET_MIN_H + CHROME_H;
const DEFAULT_W = 380;
// The view comes out square at the default width. MEASURED in Classic: its inside
// is DEFAULT_W - 37 wide (19 of widget margin, 16 of padding, 2 of border) and its
// box is 2 taller than its inside.
const DEFAULT_H = WIDGET_MIN_H - VP_MIN + (DEFAULT_W - 37) + 2 + CHROME_H;

registerNodeHelp(CLASS, SAVE_3D_HELP);

// Its own panel, so ONE registration with registerNodeSettings (never also
// registerNodeAccent, node-settings-accent invariant 3b).
registerNodeSettings(CLASS, {
  title: "Save 3D",
  ownMenuItem: false,
  open: (node) => openPanel(node),
  closeFor: (node) => closeSave3DPanelFor(node),
  // The face paints its own canvas (and the FRONT arrow in the accent), which no
  // shared repaint reaches (node-settings-accent.md invariant 2).
  onChange: (node) => renderFace(node),
});

function openPanel(node) {
  openSave3DPanel(node, (n) => {
    renderFace(n);
    repaintAccent(n);
    n.setDirtyCanvas?.(true, true);
  });
}

function toggleSettings(node) {
  if (isSave3DPanelOpenFor(node)) closeSave3DPanelFor(node);
  else openPanel(node);
}

// What the shared renderer asks this node while drawing it.
function stageOptions() {
  return {
    stage: true,
    getState: (n) => engineState(readState(n)),
    // The file shows the last run's Fix. The Fix now on the node may differ, so
    // the file is moved to where the next Run would put it (fix.mjs, a mirror of
    // the Python), and the check line reads that same place.
    display: (n, fileBox) => {
      const run = readLastRun(n);
      if (!run) return null;
      const st = readState(n);
      const tr = displayTransform(run.fix, { turns: st.turns, center: st.center, ground: st.ground }, fileBox);
      setCheckLine(n, placementFlags(tr.box));
      return { rows: matrixRows(tr), box: tr.box };
    },
    accent: (n) => accentOf(n),
  };
}

/** Point the renderer at the last run's view file. `fresh`: the file was rewritten under the same name. */
function syncView(node, fresh) {
  const run = readLastRun(node);
  const value = run ? refValue(run.view) : "";
  if (fresh && value) invalidateModel(value);
  setModel(node, value || "none");
  renderFace(node);
}

async function saveNow(node) {
  const run = readLastRun(node);
  const st = readState(node);
  if (!run) {
    flash(node, "Run the workflow first; Save now then copies its file into the save folder.", true);
    return;
  }
  if (run.file?.type !== "temp") {
    flash(node, `This run already saved ${run.file?.filename || "its file"}.`);
    return;
  }
  if (run.sent !== fileKey(st)) {
    flash(node, "The Fix or the format changed since the last run. Run again, then Save now.", true);
    return;
  }
  node._pixS3dEls?.save?.classList.add("busy");
  try {
    const res = await api.fetchApi("/pixaroma/api/save3d/save_now", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: run.file, name: st.name, folder: st.folder }),
    });
    let data = null;
    try { data = await res.json(); } catch (_e) { /* not JSON */ }
    if (!res.ok || !data?.ok) {
      flash(node, `Save now failed: ${data?.error || `the server answered ${res.status}`}`, true, 8000);
      return;
    }
    // A folder outside ComfyUI's output folder comes back as its full path.
    const where = String((data.type === "external" ? data.folder : data.subfolder) || "").replace(/\\/g, "/");
    flash(node, `Saved ${where ? where.replace(/\/$/, "") + "/" : ""}${data.filename}`, false, 8000);
  } catch (e) {
    flash(node, `Save now failed: ${e?.message || e}`, true, 8000);
  } finally {
    node._pixS3dEls?.save?.classList.remove("busy");
  }
}

// ── let go of nodes that are gone ──────────────────────────────────────────
// A tab switch rebuilds every node object (Vue Compat #11) and a copy builds a
// throwaway one, each with an engine record. One shared check frees the records
// of Save 3D nodes that are neither in the graph nor on the page.
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
  name: "Pixaroma.Save3D",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== CLASS) return;
    // A re-registration (hot reload) must not double-wrap every hook.
    if (nodeType.prototype._pixS3dPatched) return;
    nodeType.prototype._pixS3dPatched = true;

    const _created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = _created?.apply(this, arguments);
      const node = this;
      const root = buildFace(node, { openSettings: (n) => toggleSettings(n), saveNow: (n) => saveNow(n) });
      // A UNIQUE widget type, or Nodes 2.0 renders its own widget and orphans ours.
      const w = node.addDOMWidget(UI_WIDGET, WIDGET_TYPE, root, {
        serialize: false,
        getMinHeight: () => WIDGET_MIN_H,
      });
      // Two different flags: options.serialize keeps it out of the PROMPT, the
      // top-level one keeps it out of the saved WORKFLOW (widgets_values).
      w.serialize = false;
      applyAdaptiveCanvasOnly(w);
      w.computeLayoutSize = () => ({ minHeight: WIDGET_MIN_H, minWidth: 1 });
      installCanvasZoomPassthrough(root); // convention #17
      installNativeTextMenu(root); // convention #33: the name field keeps the browser menu
      installNodeAccent(node, root);
      node._pixS3dFloorOff = installResizeFloor(root, () => WIDGET_MIN_H);
      // The view's backing store is sized dpr x zoom: a pure zoom resizes nothing,
      // so the ResizeObserver stays quiet and the view would go soft.
      node._pixS3dZoomOff = installZoomRepaint(node, null, () => requestDraw(node), "_pixS3dRaf");
      try {
        node._pixS3dRo = new ResizeObserver(() => requestDraw(node));
        node._pixS3dRo.observe(node._pixS3dEls.vp);
      } catch (_e) { /* no ResizeObserver: redraws still come from every change */ }
      attachCanvas(node, node._pixS3dEls.canvas, () => renderFace(node), stageOptions());
      placeBand(node);
      node._pixS3dRendererOff = onRendererChange(() => {
        placeBand(node);
        renderFace(node);
      });

      // Fresh size, SYNCHRONOUSLY: configure() runs straight after and restores
      // a saved size, which a deferred write would clobber (convention #9).
      if (!Array.isArray(node.size)) node.size = [DEFAULT_W, DEFAULT_H];
      node.size[0] = DEFAULT_W;
      node.size[1] = DEFAULT_H;

      queueMicrotask(() => {
        // Only a node that is IN a graph loads a model: Copy, Clone and Convert
        // to Subgraph configure a throwaway copy that is never added (Vue Compat #8).
        if (node.graph) syncView(node, false);
        renderFace(node);
      });
      watchNodes();
      return r;
    };

    const _configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = _configure?.apply(this, arguments);
      // DOM and the engine only: nothing here writes node.properties or node.size,
      // so an untouched workflow never opens "modified" (Vue Compat #18).
      if (this.graph) syncView(this, false);
      const node = this;
      queueMicrotask(() => {
        if (node.graph) syncView(node, false);
        renderFace(node);
      });
      watchNodes();
      return r;
    };

    // The empty view says "wire in a mesh" while nothing is wired. DOM only, so it
    // is safe inside the connection replay of a workflow load.
    const _conn = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const r = _conn?.apply(this, arguments);
      const node = this;
      if (node._pixS3dEls) queueMicrotask(() => renderFace(node));
      return r;
    };

    // A CACHED node replays its executed event with the SAME payload: an unchanged
    // stamp means nothing was written this time (free-vram.md #5).
    const _executed = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      _executed?.apply(this, arguments);
      const report = message?.pixaroma_save3d?.[0];
      if (!report || typeof report !== "object") return;
      if (report.skipped || !report.view) {
        renderFace(this);
        return;
      }
      const prev = readLastRun(this);
      const replay = !!prev && prev.stamp != null && prev.stamp === report.stamp;
      // The key of what THIS run wrote comes from its own report. The one stamped in
      // graphToPrompt belongs to the LAST prompt queued, which can be newer than the run landing
      // now (queue A, change the Fix, queue B, then A finishes); it is only a fallback.
      const sent = report.request ? fileKey(report.request) : (this._pixS3dSent || "");
      if (!replay) writeLastRun(this, report, sent);
      syncView(this, !replay);
    };

    // Classic-only clamps; in Nodes 2.0 the rendered size lives in the Vue layout
    // store and clamping node.size desyncs the two.
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
      // The load gate matters most here: a draw hook runs on the first frame of a
      // load, earlier than any other clamp (convention #7).
      if (!isVueNodes() && !isGraphLoading()) {
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
        if (this.size[1] < MIN_H) this.size[1] = MIN_H;
      }
      return _draw?.apply(this, arguments);
    };

    const _removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      closeSave3DPanelFor(this);
      // destroyFace below closes the Format popup only if THIS node opened it: a bare close here
      // shut another Save 3D node's open popup whenever any Save 3D node was removed.
      this._pixS3dFloorOff?.();
      this._pixS3dFloorOff = null;
      this._pixS3dZoomOff?.();
      this._pixS3dZoomOff = null;
      this._pixS3dRendererOff?.();
      this._pixS3dRendererOff = null;
      try { this._pixS3dRo?.disconnect(); } catch (_e) { /* already gone */ }
      this._pixS3dRo = null;
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
        // Keyed by the COMPOSITE id ("5:12" inside a subgraph), so a top-level
        // node and a subgraph node sharing a local id cannot swap states.
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

// A key for the workflow being run (FNV-1a of its tab path), so two workflows that use the same
// node id keep their own preview file: every Ep34 file has a Stage 1 viewer with id 363, and each
// showed whichever had run last (2026-09-17). Stable for a workflow, so it re-runs nothing on its
// own; Python accepts only these 8 hex characters. No path (an older frontend) sends no key.
function workflowKey() {
  let path = "";
  try { path = String(app.extensionManager?.workflow?.activeWorkflow?.path || ""); } catch (_e) { /* no store */ }
  if (!path) return "";
  let h = 0x811c9dc5;
  for (let i = 0; i < path.length; i++) {
    h ^= path.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const _origGraphToPrompt_fn = app.graphToPrompt;
const _origGraphToPrompt = (...a) => _origGraphToPrompt_fn.apply(app, a);
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt(...args);
  try {
    const out = result?.output;
    if (out) {
      let index = null;
      let wf = null;
      for (const id in out) {
        const entry = out[id];
        if (!entry || entry.class_type !== CLASS) continue;
        if (!index) index = buildIndex();
        const node = findNode(index, id);
        if (!node) continue;
        const st = readState(node);
        if (wf === null) wf = workflowKey();
        entry.inputs = entry.inputs || {};
        entry.inputs[HIDDEN_INPUT] = JSON.stringify(wf ? { ...promptState(st), wf } : promptState(st));
        // What this run will write, so Save now can tell whether the file on the
        // node is still the one the settings describe.
        node._pixS3dSent = fileKey(st);
      }
    }
  } catch (e) {
    console.error("[Pixaroma.Save3D] inject failed", e);
  }
  return result;
};
