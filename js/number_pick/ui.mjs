// Number Pick Pixaroma - the node face.
//
// One DOM widget, so a single implementation serves both renderers, and one row
// inside it: the buttons plus the gear. Deliberately no readout and no typed
// box - the chosen chip IS the readout, and the whole point of the node is that
// it is the smallest thing that can hold a number you change often.

import { applyAdaptiveCanvasOnly, isVueNodes } from "../shared/nodes2.mjs";
import { installCanvasZoomPassthrough } from "../shared/canvas_zoom.mjs";
import { installNodeAccent, ACC } from "../shared/node_settings.mjs";
import { installResizeFloor } from "../shared/resize_floor.mjs";
import { pixAsset } from "../shared/api_url.mjs";
import { ROW_H, BODY_PAD, readState, writeState, fmt } from "./core.mjs";

const ROOT_CLASS = "pix-npick-root";
const WIDGET_NAME = "number_pick_ui";
// Namespaced so a future frontend cannot claim the type name and render its own
// widget instead of our element (the Show Text bug, Nodes 2.0 notes).
const WIDGET_TYPE = "pixaroma_number_pick";

let _cssDone = false;

// Classic stacks one 20px slot row per output ABOVE the widgets. This node has
// ONE output, so that band is 20px of dead space with a right-aligned "value"
// label in it; we lift the widget over the band and lay the buttons into its
// empty left half, which is what makes the node one row tall.
export const SLOT_BAND = 20;
// Room for the right-aligned "value" label plus its dot. MEASURED the way
// duration.md #14 says to, not guessed: at LiteGraph's 14px node font "value"
// is 34px wide and the dot sits ~18px outboard, so 54 leaves a small gap.
// Re-measure with ctx.measureText at LiteGraph.NODE_TEXT_SIZE if the output is
// ever renamed.
export const LABEL_RESERVE = 54;
// Classic hands the DOM widget `node.size[1] - widgets_start_y - 2*margin`, so
// the node has to be that much taller than the content. Measured, not guessed.
const CLASSIC_CHROME = 22;

export function bodyHeight(vue = isVueNodes()) {
  const content = ROW_H + BODY_PAD + 2;
  return vue ? ROW_H + BODY_PAD * 2 + 6 : content + CLASSIC_CHROME;
}

export function injectCSS() {
  if (_cssDone) return;
  _cssDone = true;
  const css = `
  .${ROOT_CLASS}{
    box-sizing:border-box; display:flex; flex-direction:column; gap:4px;
    padding:${BODY_PAD}px; font:12px 'Segoe UI',sans-serif; user-select:none;
    /* Transparent, not a panel colour: an opaque root would cover the "value"
       label the node paints in the same band. */
    background:transparent;
  }
  /* Classic: the body is lifted over the output-slot band and the buttons take
     the empty left half of it, which puts them ~20px higher. It reserves the
     right for the "value" label the node paints there. */
  .${ROOT_CLASS}.classic{ padding-top:2px; }
  .${ROOT_CLASS}.classic .pix-npick-row{ padding-right:${LABEL_RESERVE}px; }
  .pix-npick-row{ display:flex; align-items:center; gap:5px; min-height:${ROW_H}px; }

  /* NEVER wrap. Wrapping pushed a second row of buttons out of the node as soon
     as it was dragged narrow (duration.md #13, learned there first). The
     buttons shrink together instead, which is what someone deliberately making
     the node smaller is asking for; overflow:hidden is the backstop for a list
     long enough that even that runs out. */
  .pix-npick-chips{
    display:flex; gap:4px; flex:1 1 auto; min-width:0;
    flex-wrap:nowrap; overflow:hidden;
  }
  .pix-npick-chip{
    flex:1 1 auto; min-width:26px; box-sizing:border-box;
    background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.14);
    border-radius:4px; color:rgba(255,255,255,0.72); font-size:12px;
    padding:4px 6px; cursor:pointer; text-align:center; line-height:1.1;
    font-family:inherit; white-space:nowrap; overflow:hidden;
  }
  .pix-npick-chip:hover{ border-color:${ACC}; color:#ddd; }
  .pix-npick-chip.on, .pix-npick-chip.on:hover{
    background:${ACC}; border-color:${ACC}; color:#fff;
  }

  /* The bundled gear SVG as a mask, never the emoji (convention #28): an emoji
     is drawn by the OS, so it is a different shape and baseline on every
     platform. currentColor so it follows the row rather than drifting. */
  .pix-npick-gear{
    flex:none; width:16px; height:16px; padding:0; margin:0; line-height:0;
    background:none; border:none; cursor:pointer; color:#bbb;
  }
  .pix-npick-gear::before{
    content:""; display:block; width:14px; height:14px; background:currentColor;
    -webkit-mask:url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat;
    mask:url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat;
  }
  .pix-npick-gear:hover{ color:${ACC}; }
  `;
  const el = document.createElement("style");
  el.textContent = css;
  document.head.appendChild(el);
}

export function buildFace(node, openPanel) {
  const root = document.createElement("div");
  root.className = ROOT_CLASS + (isVueNodes() ? "" : " classic");

  const row = document.createElement("div");
  row.className = "pix-npick-row";
  root.appendChild(row);

  node._pixNpRoot = root;
  node._pixNpRow = row;
  node._pixNpOpenPanel = openPanel;

  const widget = node.addDOMWidget(WIDGET_NAME, WIDGET_TYPE, root, {
    serialize: false,
    getMinHeight: () => bodyHeight(),
  });
  // BOTH flags, they are not the same one: options.serialize keeps the widget
  // out of the PROMPT, widget.serialize (top level) keeps it out of the saved
  // WORKFLOW. With only the first, the node writes widgets_values: [""] into
  // every saved file - state that means nothing and can differ between
  // renderers, which is how a clean workflow starts opening "modified".
  widget.serialize = false;
  // canvasOnly must be TRUE in Classic (keeps it out of the Parameters tab) and
  // FALSE in Nodes 2.0 (or the Vue body renders nothing) - hence the live getter.
  applyAdaptiveCanvasOnly(widget);
  // Without this the wheel stops zooming the canvas whenever the cursor is over
  // this node, because the DOM widget swallows it (convention #17).
  installCanvasZoomPassthrough(root);
  installNodeAccent(node, root);
  // Pins a content floor ONLY while a resize handle is dragged, so the row
  // cannot be squashed out of the frame - and node.size is never written, so a
  // clean workflow cannot open "modified".
  node._pixNpFloorOff = installResizeFloor(root, () => bodyHeight());

  return widget;
}

export function renderFace(node) {
  const row = node?._pixNpRow;
  // Deliberately NOT gated on `row.isConnected`. The first render runs from a
  // queueMicrotask in onNodeCreated, and the widget element is NOT in the
  // document yet at that point - an isConnected guard there returns early and
  // nothing ever renders again, so the node comes up with an empty body.
  // Building into a detached element is fine; it shows when it is attached.
  if (!row) return;
  // Re-asserted every render, not just at build: the renderer can be switched
  // while the node is on the canvas, and the two layouts are not interchangeable.
  node._pixNpRoot?.classList.toggle("classic", !isVueNodes());
  const st = readState(node);
  row.textContent = "";

  const chips = document.createElement("div");
  chips.className = "pix-npick-chips";
  for (const v of st.values) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pix-npick-chip" + (Math.abs(v - st.value) < 1e-9 ? " on" : "");
    b.textContent = fmt(v);
    b.title = `Send ${fmt(v)}`;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      writeState(node, { value: v });
      renderFace(node);
      node.setDirtyCanvas?.(true, true);
    });
    chips.appendChild(b);
  }
  row.appendChild(chips);

  const gear = document.createElement("button");
  gear.type = "button";
  gear.className = "pix-npick-gear";
  gear.title = "Settings: choose the numbers on the buttons";
  gear.addEventListener("click", (e) => {
    e.stopPropagation();
    node._pixNpOpenPanel?.(node);
  });
  row.appendChild(gear);
}

export function destroyFace(node) {
  try { node._pixNpFloorOff?.(); } catch {}
  node._pixNpFloorOff = null;
  node._pixNpRoot = null;
  node._pixNpRow = null;
}
