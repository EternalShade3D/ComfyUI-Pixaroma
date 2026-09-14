// Mesh Repair Pixaroma - wiring.
//
// Turn a hollow, broken 3D model into one clean solid. core.mjs holds the state
// and geometry, ui.mjs the face, settings.mjs the gear panel, help.mjs the help.

import { app } from "/scripts/app.js";
import { isVueNodes } from "../shared/nodes2.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { registerNodeHelp } from "../shared/help.mjs";
import { registerNodeSettings, repaintAccent } from "../shared/node_settings.mjs";
import { onRendererChange } from "../shared/renderer_switch.mjs";
import {
  CLASS, DEFAULT_W, HIDDEN_INPUT, MIN_W,
  contentHeight, injectedState, readReport, readState, writeReport,
} from "./core.mjs";
import { buildFace, closeOptionPopup, destroyFace, injectCSS, renderFace } from "./ui.mjs";
import { closeSettingsPanelFor, openSettingsPanel } from "./settings.mjs";
import { MESH_REPAIR_HELP } from "./help.mjs";

registerNodeHelp(CLASS, MESH_REPAIR_HELP);

// Its own panel, so ONE registration with registerNodeSettings (never also
// registerNodeAccent - the second call replaces the first, node-settings-accent
// invariant 3b). ownMenuItem false: the central right-click entry is wanted.
registerNodeSettings(CLASS, {
  title: "Mesh Repair",
  ownMenuItem: false,
  open: (node) => openPanel(node),
  closeFor: (node) => closeSettingsPanelFor(node),
});

// ── the Classic height arithmetic (nodes2-preview-fill.md, free-vram.md #9b) ──
// computeSize reserves computeLayoutSize().minHeight + LG_COMPUTE_PAD while the
// element receives node.size[1] - NODE_CHROME_H. Both MEASURED live on this node
// and both follow the tallest slot column: with two inputs and two outputs they
// were 58 and 66 at every height (557, 620, 700); the third output (stl) added a
// slot row and made them 78 and 86. Free VRAM's 38 is for ONE slot row - copying
// it left this face 8px taller than its content. Re-measure if a slot changes.
const LG_COMPUTE_PAD = 78;
const NODE_CHROME_H = 86;
const LAYOUT_TRIM = LG_COMPUTE_PAD - NODE_CHROME_H;

function nodeHeight(node) {
  return contentHeight(readState(node).mode) + NODE_CHROME_H;
}

/**
 * Nodes 2.0: NO computeLayoutSize, so the widget row is min-content and the face
 * hugs its fixed height instead of absorbing the node's spare height. Classic:
 * the method must exist, reporting the pre-trimmed height computeSize consumes.
 */
function applyLayoutSizing(node, widget) {
  const w = widget || node?._pixMrWidget;
  if (!w) return;
  if (isVueNodes()) {
    w.computeLayoutSize = undefined;
  } else {
    w.computeLayoutSize = () => ({
      minHeight: contentHeight(readState(node).mode) - LAYOUT_TRIM,
      minWidth: 1,
    });
  }
}

/** Classic only, diff-gated and load-gated: follow a content height change. */
function syncSize(node) {
  if (!node?.size || isVueNodes() || isGraphLoading()) return;
  const want = nodeHeight(node);
  if (Math.abs((node.size?.[1] ?? 0) - want) < 1) return;
  node.setSize?.([Math.max(MIN_W, node.size?.[0] ?? DEFAULT_W), want]);
}

function onStateChange(node) {
  renderFace(node);
  syncSize(node);
  node.setDirtyCanvas?.(true, true);
}

function openPanel(node) {
  // The panel calls back with NO arguments: close over node (free-vram.md #8).
  openSettingsPanel(node, () => {
    renderFace(node);
    repaintAccent(node);
    syncSize(node);
    node.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
  });
}

app.registerExtension({
  name: "Pixaroma.MeshRepair",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== CLASS) return;
    if (nodeType.prototype._pixMrPatched) return;
    nodeType.prototype._pixMrPatched = true;

    injectCSS();

    const _created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      _created?.apply(this, arguments);
      const widget = buildFace(this, { openPanel, onChange: onStateChange });
      applyLayoutSizing(this, widget);

      // Fresh size SYNCHRONOUSLY: configure() runs next and restores a saved
      // size, so a deferred write would clobber it (convention #9).
      if (!Array.isArray(this.size)) this.size = [DEFAULT_W, nodeHeight(this)];
      this.size[0] = DEFAULT_W;
      this.size[1] = nodeHeight(this);

      queueMicrotask(() => renderFace(this));

      // One DOM widget serves both renderers, so a flip rebuilds nothing; it
      // only needs the per-renderer layout sizing and the Classic height back.
      this._pixMrRendererOff = onRendererChange(() => {
        applyLayoutSizing(this);
        renderFace(this);
        syncSize(this);
      });
    };

    const _configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = _configure?.apply(this, arguments);
      // DOM only: nothing here may write node.size (Vue Compat #18).
      renderFace(this);
      queueMicrotask(() => renderFace(this));
      return r;
    };

    // The status line says when nothing is wired in, so it follows wire changes.
    // DOM only, so it is safe inside the load replay.
    const _conn = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const r = _conn?.apply(this, arguments);
      renderFace(this);
      return r;
    };

    // A CACHED node replays its executed event with the SAME payload. An
    // unchanged stamp means nothing was repaired this time (free-vram.md #5).
    const _executed = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      _executed?.apply(this, arguments);
      const report = message?.pixaroma_mesh_repair?.[0];
      if (!report || typeof report !== "object") return;
      const previous = readReport(this);
      const replayed = previous && previous.stamp != null && previous.stamp === report.stamp;
      writeReport(this, { ...report, cached: !!replayed });
      renderFace(this);
    };

    const _resize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (!isVueNodes() && !isGraphLoading()) {
        if (size[0] < MIN_W) size[0] = MIN_W;
        const floor = nodeHeight(this);
        if (size[1] < floor) size[1] = floor;
      }
      return _resize?.apply(this, arguments);
    };

    const _draw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (!isVueNodes() && !isGraphLoading() && this.size[0] < MIN_W) this.size[0] = MIN_W;
      return _draw?.apply(this, arguments);
    };

    const _removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      closeSettingsPanelFor(this);
      closeOptionPopup();
      try { this._pixMrRendererOff?.(); } catch {}
      this._pixMrRendererOff = null;
      destroyFace(this);
      return _removed?.apply(this, arguments);
    };
  },
});

// ── graphToPrompt: inject the state ────────────────────────────────────────
// INJECT ONLY - never prune, because Export (API) serialises this same output.
function buildIndex() {
  const index = new Map();
  const seen = new Set();
  const visit = (graph) => {
    if (!graph || seen.has(graph)) return;
    seen.add(graph);
    for (const n of graph._nodes || graph.nodes || []) {
      if (!n) continue;
      if (n.comfyClass === CLASS || n.type === CLASS) index.set(String(n.id), n);
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== graph) visit(inner);
    }
  };
  visit(app.graph);
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
        entry.inputs[HIDDEN_INPUT] = JSON.stringify(injectedState(node));
      }
    }
  } catch (e) {
    console.error("[Pixaroma.MeshRepair] inject failed", e);
  }
  return result;
};

export { openPanel };
