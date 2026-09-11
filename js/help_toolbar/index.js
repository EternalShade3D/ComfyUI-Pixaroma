// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma - the node selection-toolbar buttons (? and ⚙)      ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// Two buttons in ComfyUI's selection toolbar (the floating bar above a selected
// node, next to the native ⓘ Node Info), both drawn as an orange circle with a
// white glyph so they read as a pair:
//
//   ?  Help      - shown for any node that registered help via registerNodeHelp
//   ⚙  Settings  - shown for any node that registered settings via
//                  registerNodeSettings / registerNodeAccent
//
// Both commands are returned from ONE getSelectionToolboxCommands hook so they
// always render adjacent, in that order.
//
// This file ALSO owns the central right-click entry: getNodeMenuItems adds a
// "⚙ <Title> settings" line to any node that registered settings, so a node
// never has to wire its own menu item. A node that already builds a richer menu
// (Outpaint, Seed, Save Image, ...) registers with `ownMenuItem: true` and keeps
// its own line - the central hook then stays out of the way so nothing doubles.
//
// This is the OFFICIAL extension path (verified against frontend 1.44.19), not a
// monkey-patch: ComfyUI calls `getSelectionToolboxCommands(item)` on every
// extension to collect command IDs to show, looks each up in the command store,
// and renders it via ExtensionCommandButton as `<i :class="command.icon">` +
// `@click="command.function()"`. So we register commands and answer the hook.
// On older ComfyUI builds that lack the hook it's simply never called -> the
// commands are registered but never shown (harmless, no error).
//
// The buttons' hover tooltips come from ComfyUI's i18n table, NOT command.label:
// locales/en/commands.json, keyed by the command id with dots lowercased to
// underscores (Pixaroma.ShowHelp -> Pixaroma_ShowHelp).

import { app } from "/scripts/app.js";
import { openHelpPopup, openHelpFor, getNodeHelp } from "../shared/index.mjs";
import { pixAsset } from "../shared/api_url.mjs";
import {
  getNodeSettings, openNodeSettings, repaintAllAccents, closeNodeSettingsFor,
  settleNodeAccent, GLOBAL_ACCENT_SETTING, BRAND,
} from "../shared/node_settings.mjs";
import "./help_defs.mjs";     // registers help for most Pixaroma nodes (one place to edit)

const HELP_CMD = "Pixaroma.ShowHelp";
const SET_CMD = "Pixaroma.ShowSettings";
const HELP_ICON = "pix-help-toolbar-icon";
const SET_ICON = "pix-settings-toolbar-icon";
const CSS_ID = "pix-help-toolbar-css";
const QUESTION_ICON = pixAsset("icons/note/question-mark.svg");
const GEAR_ICON = pixAsset("icons/note/gear.svg");

// command.icon renders as the class on an <i>, so we draw the orange circle +
// glyph purely in CSS: a filled BRAND circle with the bundled svg as a white
// mask. The two buttons share every rule except the mask so they match exactly.
function injectIconCSS() {
  if (document.getElementById(CSS_ID)) return;
  const el = document.createElement("style");
  el.id = CSS_ID;
  el.textContent = `
    .${HELP_ICON}, .${SET_ICON} {
      display: inline-flex; align-items: center; justify-content: center;
      width: 16px; height: 16px; border-radius: 50%;
      background: ${BRAND};
    }
    .${HELP_ICON}::before, .${SET_ICON}::before {
      content: ""; width: 10px; height: 10px; background-color: #fff;
    }
    .${HELP_ICON}::before {
      -webkit-mask: url("${QUESTION_ICON}") center / contain no-repeat;
      mask: url("${QUESTION_ICON}") center / contain no-repeat;
    }
    .${SET_ICON}::before {
      width: 11px; height: 11px;
      -webkit-mask: url("${GEAR_ICON}") center / contain no-repeat;
      mask: url("${GEAR_ICON}") center / contain no-repeat;
    }
  `;
  document.head.appendChild(el);
}

// Every selected node, from both selection maps: selected_nodes (the node map in
// both renderers) and, as a fallback, selectedItems (a Set that can mix groups).
function selectedNodes() {
  const c = app.canvas;
  if (!c) return [];
  const nodes = [];
  if (c.selected_nodes) nodes.push(...Object.values(c.selected_nodes));
  if (c.selectedItems) for (const it of c.selectedItems) if (it && it.comfyClass) nodes.push(it);
  return nodes;
}

function firstWith(resolve) {
  for (const n of selectedNodes()) {
    const hit = resolve(n);
    if (hit) return { node: n, hit };
  }
  return null;
}

app.registerExtension({
  name: "Pixaroma.HelpToolbar",

  // The master accent colour. Every Pixaroma node follows it unless that node
  // (or its node type) has been given a colour of its own. The two "save as
  // default" buttons in each node's settings panel write this and the per-type
  // key; this row just makes the master reachable from the Settings panel too.
  settings: [
    {
      id: GLOBAL_ACCENT_SETTING,
      name: "Accent colour for Pixaroma nodes",
      type: "color",
      defaultValue: BRAND,
      tooltip:
        "The colour Pixaroma nodes paint their buttons and highlights with. A node keeps " +
        "its own colour if you picked one for it, or for its node type. NOTE: ComfyUI's " +
        "colour field shows saved values without '#' but requires '#' when typing - enter " +
        "'#f66744' to go back to the Pixaroma orange, or use the colour picker.",
      // Two levels, like every other Pixaroma setting. A distinct leaf ("Accent")
      // so it cannot collapse into another node's row (Align Pattern #10).
      category: ["👑 Pixaroma", "Accent"],
      // onChange fires BEFORE the store write, so repaint on the next tick or
      // every node re-reads the value it already had.
      onChange: () => { setTimeout(repaintAllAccents, 0); },
    },
  ],

  commands: [
    {
      id: HELP_CMD,
      label: "Help",
      icon: HELP_ICON,
      function: () => {
        const found = firstWith((n) => getNodeHelp(n.comfyClass));
        // Pass the class so the popup can offer a way through to the full Help
        // browser, opened on this node's page.
        if (found) openHelpFor(found.node.comfyClass, found.hit, { comfyClass: found.node.comfyClass });
      },
    },
    {
      id: SET_CMD,
      label: "Settings",
      icon: SET_ICON,
      function: () => {
        const found = firstWith((n) => getNodeSettings(n.comfyClass));
        if (found) openNodeSettings(found.node);
      },
    },
  ],

  // ComfyUI asks each extension which toolbar commands to show for a selected
  // item, then unions the ids. Returning both from here keeps them adjacent.
  getSelectionToolboxCommands(item) {
    const cls = item && item.comfyClass;
    if (!cls) return [];
    const out = [];
    if (getNodeSettings(cls)) out.push(SET_CMD);
    if (getNodeHelp(cls)) out.push(HELP_CMD);
    return out;
  },

  // One central right-click entry for every node that registered settings and
  // does not already add its own line.
  getNodeMenuItems(node) {
    const def = getNodeSettings(node?.comfyClass);
    if (!def || def.ownMenuItem) return [];
    const label = def.menuLabel || (def.title || "Node") + " settings";
    return [null, { content: "⚙ " + label, callback: () => openNodeSettings(node) }];
  },

  // A node's saved accent lives in node.properties, which configure() restores
  // AFTER this hook runs (Vue Compat #8) - so every node painted its colour from
  // the DEFAULTS and a saved pick never reached the face. Measured 2026-09-11:
  // reopening a workflow brought 42 of 48 DOM node types back orange while their
  // settings panel still showed the right colour. settleNodeAccent re-applies on
  // the next microtask, and only when the colour actually changed.
  //
  // Central for the same reason onRemoved below is: seven nodes (Prompt, Sliders,
  // LoRA Loader, Sizes, Outpaint, Outpaint Stitch, Load Image Mini) paint from
  // their own --acc var and never call installNodeAccent, so nothing in the
  // shared installer can reach them. Here they are covered by registration alone.
  nodeCreated(node) {
    try { if (getNodeSettings(node?.comfyClass)) settleNodeAccent(node); } catch {}
  },

  // Deleting a node while its settings panel is open must close that panel.
  // Doing it centrally is the only way that scales: registerNodeAccent wires a
  // closeFor for every node, but nothing was ever CALLING it - so the panel
  // stayed on screen pointing at a destroyed node until the user clicked away.
  // The registry is read at removal time, so registration order does not matter.
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (!nodeData?.name || nodeType.prototype._pixSettingsRemovedPatched) return;
    nodeType.prototype._pixSettingsRemovedPatched = true;
    const origRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      try {
        const def = getNodeSettings(this.comfyClass);
        if (def) (def.closeFor ? def.closeFor(this) : closeNodeSettingsFor(this));
      } catch {}
      return origRemoved?.apply(this, arguments);
    };
  },

  setup() {
    injectIconCSS();
  },
});
