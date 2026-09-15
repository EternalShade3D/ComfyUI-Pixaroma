// Edit 3D Pixaroma - the editor's panels: the tools and views on the left, the fixes, the whole-model buttons, Save to
// Disk as and the History on the right, the options bar for the tool in use, Before / After in the title bar, the
// line at the bottom left (the numbers, or what the control under the mouse does), the toast and the job panel.
// DOM only: every button calls a method of the editor.
import { fmtInt, facesText } from "./core.mjs";

const ICONS = {
  select: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/></svg>',
  erase: '<svg viewBox="0 0 24 24"><path d="M4 15l8-8 6 6-5 5H9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M13 19h7" stroke="currentColor" stroke-width="2"/></svg>',
  lasso: '<svg viewBox="0 0 24 24"><path d="M12 4c4.5 0 8 2.5 8 5.8s-3.5 5.8-8 5.8c-2 0-3.8-.5-5.1-1.3M12 4C7.5 4 4 6.5 4 9.8c0 1.6.8 3 2.2 4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7.4 14.6c-1.2 1.6-1.2 3.4-.4 5.4" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  panel: '<svg viewBox="0 0 24 24"><path d="M3 9l9-4.5L21 9l-9 4.5z" fill="currentColor"/><path d="M3 13l9 4.5 9-4.5" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
  piece: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="8" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="13" y="6" width="8" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="7" y="14" width="9" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  move: '<svg viewBox="0 0 24 24"><path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  edge: '<svg viewBox="0 0 24 24"><path d="M3 19L12 6l9 13" fill="none" stroke="currentColor" stroke-width="2.3"/></svg>',
  hole: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle class="red" cx="12" cy="12" r="3.4" fill="none" stroke="#ff4d4d" stroke-width="2.2"/></svg>',
};

const TOOLS = [
  ["select", "Select", "B", "Paint a selection on the surface. Hold Ctrl to take away. Example: paint the lumpy top of a helmet, then press Smooth."],
  ["erase", "Deselect", "D", "Paint over a selection to take it away. Example: after All, paint the eyes so Smooth leaves them alone."],
  ["lasso", "Lasso", "L", "Draw a loop to select everything inside it. Ctrl-drag takes away. Example: loop a sword handle, then press Delete."],
  ["panel", "Panel", "P", "Click a flat panel to select all of it. Shift-click adds another. Example: click the wavy side of a gun, then press Flatten."],
  ["piece", "Piece", "I", "Click a part to select the whole separate piece it belongs to. Example: click a floating speck, then press Delete."],
  ["move", "Move", "M", "Drag to pull the surface under the brush; the edge of the brush stays put. Example: pull a dented nose tip back out."],
  ["edge", "Sharpen edge", "E", "Click a panel, then the panel next to it, then press Sharpen edges: the rounded edge between them turns crisp."],
  ["hole", "Fill hole", "O", "Shows holes as red dots; click next to a hole to close it. Example: click beside the dots around a hole in a boot sole."],
];

const b = (attrs, text, help, name) => `<button type="button" class="pxf-btn" ${attrs}${name ? ` data-name="${name}"` : ""} data-help="${help}">${text}</button>`;
const seg = (key, items, cls = "") => `<div class="pix-e3d-seg${cls}" data-seg="${key}">${items.map(([v, t, h]) => `<button type="button" data-v="${v}" data-help="${h}">${t}</button>`).join("")}</div>`;
const sw = (key, text, help) => `<div class="pix-e3d-sw-row" data-switch="${key}" data-name="${text}" data-help="${help}"><span>${text}</span><span class="pix-e3d-sw"></span></div>`;

function leftHtml() {
  return `
<div class="pxf-panel"><div class="pxf-panel-title">Tools</div><div class="pix-e3d-tools">
${TOOLS.map(([id, label, key, help]) => `<button type="button" class="pix-e3d-tool" data-tool="${id}" data-name="${label} (${key})" data-help="${help}">${ICONS[id]}${label}</button>`).join("")}
</div></div>
<div class="pxf-panel"><div class="pxf-panel-title">Selection</div>
<div class="pix-e3d-count" data-el="selCount">Nothing selected</div>
<div class="pix-e3d-g3">${b('data-sel="all"', "All", "Selects everything that is shown. (Ctrl+A)")}${b('data-sel="none"', "None", "Clears the selection. (Esc)")}${b('data-sel="invert"', "Invert", "Swaps selected and not selected.")}</div>
<div class="pix-e3d-g2">${b('data-sel="grow"', "Grow", "Adds one row of points all around the selection.")}${b('data-sel="shrink"', "Shrink", "Takes one row of points off the edge of the selection.")}</div>
<div class="pix-e3d-g3">${b('data-sel="hide"', "Hide", "Hides the selected faces so you can reach what is behind them. (H)")}${b('data-sel="isolate"', "Isolate", "Shows only the selection. Example: Isolate a grip to smooth it without touching the rest.")}${b('data-sel="show"', "Show all", "Brings every hidden face back. (Alt+H)")}</div>
</div>
<div class="pxf-panel"><div class="pxf-panel-title">Look</div>
${seg("look", [["clay", "Clay", "Plain grey: the best look for judging the shape."], ["color", "Color", "The model's own colours or texture."], ["wire", "Wire", "The real edges: a quad shows as a quad."], ["normal", "Normal", "Surface directions as colours: odd colours show faces pointing the wrong way."]])}
${sw("holes", "Show holes and broken edges", "Red dots mark open edges (holes), yellow dots broken edges, where more than two faces meet.")}
${sw("xray", "X-ray", "A see-through model, to spot surfaces hidden inside it. (X)")}
</div>
<div class="pxf-panel"><div class="pxf-panel-title">View</div>
<div class="pix-e3d-g4">${b('data-view="front"', "Front", "Looks at the front. (1)")}${b('data-view="back"', "Back", "Looks at the back. (Ctrl+1)")}${b('data-view="left"', "Left", "Looks at the model's left side. (Ctrl+3)")}${b('data-view="right"', "Right", "Looks at the model's right side. (3)")}</div>
<div class="pix-e3d-g4">${b('data-view="top"', "Top", "Looks down from above. (7)")}${b('data-view="bottom"', "Bottom", "Looks up from below. (Ctrl+7)")}${b('data-view="q"', "3/4", "The three-quarter view. (0)")}${b('data-view="fit"', "Fit", "Frames the whole model again. (F)")}</div>
<div class="pix-e3d-hint">Right-drag turns the view, middle-drag moves it, the wheel zooms. The marker at the bottom right shows which way X, Y and Z point.</div>
</div>`;
}

function rightHtml() {
  const wide = (attrs, text, help, badge = "") => `<button type="button" class="pxf-btn pix-e3d-wide" ${attrs} data-name="${text}" data-help="${help}">${text}${badge}</button>`;
  return `
<div class="pxf-panel"><div class="pxf-panel-title">Fix the selection</div>
${wide('data-op="flatten"', "Flatten", "Moves the selected panel onto its best flat plane. Points facing another way are left alone, and the edge of the selection fades in. Example: Panel on a wavy car door, then Flatten.")}
<div class="pix-e3d-slider" data-name="Flatten strength" data-help="How far the points move onto the plane: 100% is fully flat."><span>Strength</span><input type="range" min="10" max="100" step="5" data-range="flatStrength"><b data-out="flatStrength"></b></div>
${wide('data-op="smooth"', "Smooth", "Evens out lumps inside the selection without shrinking it. Example: brush over bumpy cheeks, Smooth at 40%.")}
<div class="pix-e3d-slider" data-name="Smooth strength" data-help="How many smoothing passes run: more is softer."><span>Strength</span><input type="range" min="10" max="100" step="5" data-range="smoothStrength"><b data-out="smoothStrength"></b></div>
${wide('data-op="straighten"', "Straighten", "Flattens the selection and turns it exactly level or upright, when it is within 15 degrees of that. Example: a table top that tilts a little.")}
${wide('data-op="sharpen"', "Sharpen edges", "With two panels picked by the Sharpen edge tool: flattens both and closes the rounded edge between them into a crisp one.")}
<div class="pxf-btn-row">${b('data-op="del"', "Delete", "Removes the selected faces. (Delete)")}${b('data-op="fillSelection"', "Fill holes", "Closes the holes whose whole edge is inside the selection. Example: Lasso around a hole in a shoulder, then Fill holes.")}</div>
</div>
<div class="pxf-panel"><div class="pxf-panel-title">Whole model</div>
${wide('data-op="removeInside"', "Remove inside surfaces", "Removes every face that can never be seen from outside: the second skin AI models carry inside. Often more than half the model. The first button to press on a Pixal3D or Trellis 2 model.")}
${wide('data-op="fillSmall"', "Fill small holes", "Closes every hole of up to 16 edges and leaves big openings alone. Close a big one with the Fill hole tool.", '<span class="pix-e3d-badge" data-el="holeBadge"></span>')}
${wide('data-op="removeLoose"', "Remove loose bits", "Removes the separate pieces smaller than 8 faces: the specks AI models scatter around.", '<span class="pix-e3d-badge" data-el="looseBadge"></span>')}
${wide('data-op="closeCracks"', "Close cracks", "Joins open edges that almost touch, then closes the small gaps left. Example: a model spliced from several views, at 0.25%.")}
${seg("cracks", [["0.1", "0.1%", "Joins edges closer than 0.1% of the model's size: only hairline cracks."], ["0.25", "0.25%", "Joins edges closer than 0.25% of the model's size."], ["0.5", "0.5%", "Joins edges closer than 0.5% of the model's size."], ["1", "1%", "Joins edges closer than 1% of the model's size: wide cracks, but small details can fuse."]], " pix-e3d-under")}
${wide('data-heavy="quads"', "Quads", "Lays a clean grid of quads over the whole model, following its crisp edges. Example: before sending a model to Blender or a game engine.")}
${seg("quads", [["50000", "50K", "50,000 quads: light, for games."], ["100000", "100K", "100,000 quads: about half the time of 200K."], ["200000", "200K", "200,000 quads: keeps slots, panel lines and small round details."]], " pix-e3d-under")}
${wide('data-heavy="reduce"', "Reduce polygons", "Removes triangles while keeping the shape. Example: a 1.5 million triangle model for a web viewer, at -75%.")}
${seg("reduce", [["25", "-25%", "Keeps three quarters of the triangles."], ["50", "-50%", "Keeps half of the triangles."], ["75", "-75%", "Keeps a quarter of the triangles."]], " pix-e3d-under")}
${wide('data-heavy="solid"', "Make solid", "Rebuilds the model as one closed solid for 3D printing. It softens small details, so use it last. More detail keeps more of the shape and takes longer.")}
${seg("solid", [["256", "256", "Fastest, softest."], ["384", "384", "The usual choice."], ["512", "512", "The most detail, the slowest."]], " pix-e3d-under")}
${wide('data-heavy="mirror"', "Mirror", "Keeps one side along X, Y or Z and copies it onto the other, so both match exactly. Example: a character whose left arm came out better.")}
<div class="pix-e3d-row pix-e3d-under">${seg("mirrorAxis", [["x", "X", "Mirror left and right."], ["y", "Y", "Mirror top and bottom."], ["z", "Z", "Mirror front and back."]])}${seg("mirrorSide", [["positive", "Keep +", "Keeps the side on the plus end of the axis."], ["negative", "Keep -", "Keeps the side on the minus end of the axis."]])}</div>
</div>
<div class="pxf-panel"><div class="pxf-panel-title">Save to Disk as</div>
<div class="pix-e3d-row"><span>Format</span>${seg("fmt", [["auto", "Auto", "OBJ, or GLB when the model keeps a texture."], ["obj", "OBJ", "Keeps quads and colours."], ["glb", "GLB", "Keeps colours and a texture."], ["stl", "STL", "For 3D printing: standing on Z, 100 mm on its longest side."]])}</div>
<div class="pix-e3d-row" data-name="Name" data-help="The file name inside output/3d. A number is added when the name is taken, so nothing is written over."><span>Name</span><input class="pix-e3d-name" data-el="name" maxlength="80" spellcheck="false"></div>
<div class="pix-e3d-row"><span>Turn Y</span>${seg("turnY", [["0", "0", "No turn."], ["90", "90", "A quarter turn around Y."], ["180", "180", "A half turn around Y."], ["270", "270", "Three quarters of a turn around Y."]])}</div>
${sw("center", "Center on the ground", "Puts the written copy in the middle, standing on the ground, so it opens the right way in Blender.")}
</div>
<div class="pxf-panel"><div class="pxf-panel-title">History</div><ol class="pix-e3d-history" data-el="history"></ol></div>`;
}

export function buildPanels(ed) {
  const L = ed.layout;
  const q = (root, sel) => root.querySelector(sel);
  L.leftSidebar.insertAdjacentHTML("beforeend", leftHtml());
  const scroll = document.createElement("div");
  scroll.className = "pix-e3d-scroll";
  scroll.innerHTML = rightHtml();
  L.rightSidebar.insertBefore(scroll, L.sidebarFooter);
  L.titlebarCenter.innerHTML = seg("view", [["before", "Before", "The model as it came in, for comparing."], ["after", "After", "The model with your edits."]]);

  const ws = L.workspace;
  const toastEl = document.createElement("div");
  toastEl.className = "pix-e3d-toast";
  const legend = document.createElement("div");
  legend.className = "pix-e3d-legend";
  legend.innerHTML = '<i style="background:#ff4d4d"></i>open edge (hole)<i style="background:#ffc233"></i>broken edge';
  const job = document.createElement("div");
  job.className = "pix-e3d-job";
  job.innerHTML = '<span class="spin"></span><span class="msg"></span><button type="button" class="pxf-btn pxf-btn-danger" data-help="Stops the job: a job still waiting in the queue is taken out, a running one is interrupted.">Stop</button>';
  ws.append(toastEl, legend, job);

  // The framework's own controls get a hover line too.
  const help = (el, text, name) => { if (el) { el.dataset.help = text; if (name) el.dataset.name = name; } };
  const foot = L.sidebarFooter.querySelectorAll("button");
  help(foot[0], "How to use the editor, tool by tool, with examples. (? or F1)", "Help");
  help(L.saveBtn, "Keeps the edit on the node and closes the editor. The node shows its picture and hands the edited model on at the next Run.", "Save");
  help(L.closeBtn, "Writes the model into output/3d now, in the format chosen under Save to Disk as.", "Save to Disk");
  if (L.closeBtn) L.closeBtn.title = "Write the model into output/3d";
  help(L.undoBtn, "Takes the last edit back. (Ctrl+Z)", "Undo");
  help(L.redoBtn, "Puts an undone edit back. (Ctrl+Shift+Z)", "Redo");
  const zoom = L.titlebar.querySelectorAll(".pxf-titlebar-zoom button");
  help(zoom[0], "Steps the view back.", "Zoom out");
  help(zoom[1], "Frames the whole model again. (F)", "Fit");
  help(zoom[2], "Steps the view closer.", "Zoom in");
  help(L.titlebar.querySelector(".pxf-btn-danger"), "Leaves the editor without keeping this session's edits.", "Close");

  const els = {
    selCount: q(L.leftSidebar, '[data-el="selCount"]'), holeBadge: q(scroll, '[data-el="holeBadge"]'),
    looseBadge: q(scroll, '[data-el="looseBadge"]'), history: q(scroll, '[data-el="history"]'), name: q(scroll, '[data-el="name"]'),
    toast: toastEl, legend, job, jobMsg: job.querySelector(".msg"), jobStop: job.querySelector("button"), scroll,
  };
  els.name.value = ed.opts.name;

  // ── bindings ──
  const all = (sel) => L.overlay.querySelectorAll(sel);
  for (const t of all("[data-tool]")) t.addEventListener("click", () => ed.setTool(t.dataset.tool));
  for (const t of all("[data-sel]")) t.addEventListener("click", () => ed.selection(t.dataset.sel));
  for (const t of all("[data-view]")) t.addEventListener("click", () => ed.setView(t.dataset.view));
  for (const t of all("[data-op]")) t.addEventListener("click", () => ed.ops?.[t.dataset.op]?.());
  for (const t of all("[data-heavy]")) t.addEventListener("click", () => ed.heavy(t.dataset.heavy));
  for (const r of all("[data-range]")) {
    const key = r.dataset.range, out = q(scroll, `[data-out="${key}"]`);
    r.value = String(Math.round(ed.opts[key] * 100));
    const upd = () => { ed.opts[key] = Number(r.value) / 100; out.textContent = r.value + "%"; };
    r.addEventListener("input", upd);
    upd();
  }
  const SEGS = {
    look: [() => ed.prefs.look, (v) => ed.setLook(v)],
    view: [() => (ed.showingBefore ? "before" : "after"), (v) => ed.setBeforeAfter(v)],
    cracks: [() => String(ed.opts.cracks), (v) => { ed.opts.cracks = Number(v); }],
    quads: [() => String(ed.opts.quads), (v) => { ed.opts.quads = Number(v); }],
    reduce: [() => String(ed.opts.reduce), (v) => { ed.opts.reduce = Number(v); }],
    solid: [() => String(ed.opts.solid), (v) => { ed.opts.solid = Number(v); }],
    mirrorAxis: [() => ed.opts.mirrorAxis, (v) => { ed.opts.mirrorAxis = v; }],
    mirrorSide: [() => ed.opts.mirrorSide, (v) => { ed.opts.mirrorSide = v; }],
    fmt: [() => ed.opts.fmt, (v) => { ed.opts.fmt = v; }],
    turnY: [() => String(ed.opts.turnY), (v) => { ed.opts.turnY = Number(v); }],
  };
  const syncSeg = (s) => {
    const cur = SEGS[s.dataset.seg]?.[0]();
    for (const x of s.querySelectorAll("button")) x.classList.toggle("on", x.dataset.v === cur);
  };
  for (const s of all("[data-seg]")) {
    const def = SEGS[s.dataset.seg];
    if (!def) continue;
    for (const x of s.querySelectorAll("button")) x.addEventListener("click", () => { def[1](x.dataset.v); syncSeg(s); });
    syncSeg(s);
  }
  const SWITCHES = {
    holes: [() => ed.prefs.holes, () => ed.setHoles(!ed.prefs.holes)],
    xray: [() => ed.prefs.xray, () => ed.setXray(!ed.prefs.xray)],
    center: [() => ed.opts.center, () => { ed.opts.center = !ed.opts.center; }],
  };
  const syncSwitches = () => {
    for (const r of all("[data-switch]")) r.querySelector(".pix-e3d-sw").classList.toggle("on", !!SWITCHES[r.dataset.switch]?.[0]());
  };
  for (const r of all("[data-switch]")) r.addEventListener("click", () => { SWITCHES[r.dataset.switch]?.[1](); syncSwitches(); });
  syncSwitches();
  els.name.addEventListener("input", () => { ed.opts.name = els.name.value; });

  // ── the line at the bottom left ──
  let helpShowing = false;
  let busyMsg = "";
  const info = L.statusText;
  const statsLine = () => {
    const m = ed.model;
    if (!m) return ed.loadMsg || "";
    if (ed.showingBefore) return "BEFORE: the model as it came in. Switch to After to edit.";
    const s = m.stats;
    const parts = [facesText({ triangles: s.triangles, quads: s.quads, ngons: s.ngons }), `${fmtInt(s.pieces)} piece${s.pieces === 1 ? "" : "s"}`,
      `${fmtInt(s.open)} open edges`, `${fmtInt(s.broken)} broken edges`];
    if (s.hidden) parts.push(`${fmtInt(s.hidden)} hidden`);
    return parts.join(" · ");
  };
  const ui = {
    els,
    refreshInfo() {
      const m = ed.model;
      if (m) {
        const n = m.selectedCount();
        els.selCount.textContent = n ? `${fmtInt(n)} points selected` : "Nothing selected";
        els.holeBadge.textContent = `${fmtInt(m.stats.open)} open edges`;
        els.looseBadge.textContent = `${fmtInt(m.stats.tiny)} tiny`;
      }
      if (busyMsg || helpShowing) return;
      info.className = "pxf-tool-info" + (ed.loadError ? " error" : "");
      info.textContent = statsLine();
    },
    setBusy(msg) {
      busyMsg = msg || "Working...";
      helpShowing = false;
      info.className = "pxf-tool-info busy";
      info.textContent = busyMsg;
    },
    clearBusy() {
      busyMsg = "";
      ui.refreshInfo();
    },
    toast(msg, ms = 6500) {
      toastEl.textContent = msg;
      toastEl.classList.add("show");
      clearTimeout(ui._toastT);
      ui._toastT = setTimeout(() => toastEl.classList.remove("show"), ms);
    },
    showJob(msg, onStop) {
      job.classList.add("show");
      L.overlay.classList.add("pix-e3d-jobbing");
      els.jobMsg.textContent = msg;
      els.jobStop.disabled = false;
      els.jobStop.onclick = () => { els.jobStop.disabled = true; onStop?.(); };
    },
    updateJob(msg) { els.jobMsg.textContent = msg; },
    hideJob() {
      job.classList.remove("show");
      L.overlay.classList.remove("pix-e3d-jobbing");
      els.jobStop.onclick = null;
    },
    setToolActive(t) { for (const x of all("[data-tool]")) x.classList.toggle("active", x.dataset.tool === t); },
    syncLook() { for (const s of all('[data-seg="look"], [data-seg="view"]')) syncSeg(s); },
    syncSwitches,
    showLegend(on) { legend.style.display = on ? "block" : "none"; },
    renderHistory(undo, redo) {
      const ol = els.history;
      ol.textContent = "";
      if (!undo.length && !redo.length) ol.innerHTML = '<li class="dim">Nothing yet</li>';
      for (const label of undo) { const li = document.createElement("li"); li.textContent = label; ol.appendChild(li); }
      for (const label of redo.slice().reverse()) { const li = document.createElement("li"); li.className = "undone"; li.textContent = label; ol.appendChild(li); }
      L.setUndoState({ canUndo: undo.length > 0, canRedo: redo.length > 0 });
    },
    renderOptions() { renderOptions(ed, L.topOptionsBar); },
    dispose() { clearTimeout(ui._toastT); },
  };

  L.overlay.addEventListener("mouseover", (e) => {
    const el = e.target.closest?.("[data-help]");
    if (!el || busyMsg) return;
    const name = el.dataset.name || el.textContent.trim().split("\n")[0].trim();
    helpShowing = true;
    info.className = "pxf-tool-info help";
    info.textContent = "";
    const bold = document.createElement("b");
    bold.textContent = name;
    info.append(bold, document.createTextNode(el.dataset.help));
  });
  L.overlay.addEventListener("mouseout", (e) => {
    const el = e.target.closest?.("[data-help]");
    if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return;
    helpShowing = false;
    ui.refreshInfo();
  });
  ui.renderHistory([], []);
  return ui;
}

function renderOptions(ed, bar) {
  if (!bar) return;
  const t = ed.tool, m = ed.model;
  const through = seg("through", [["0", "Facing me", "Only the surface turned towards you is picked, so the far side stays out."], ["1", "Through", "Picks right through the model: the far side too. Example: both sides of a thin wing at once."]]);
  const sep = '<span class="pix-e3d-opt-sep"></span>';
  const hint = (s) => `<span class="pix-e3d-opt-hint">${s}</span>`;
  if (t === "select" || t === "erase" || t === "move") {
    const h = t === "select" ? "Paint with the left button, hold Ctrl to take away. Right-drag turns the view."
      : t === "erase" ? "Paint over a selection to take it away." : "Drag to pull the surface. Small moves work best.";
    bar.innerHTML = '<span class="pix-e3d-opt-label">Brush size</span><input type="range" data-opt="brush" min="0.004" max="0.15" step="0.001" data-name="Brush size" data-help="How wide the brush reaches, in millimetres on a 100 mm print. The [ and ] keys change it too.">'
      + `<span class="pix-e3d-opt-val" data-out="brush"></span>${through}${sep}<span class="pix-e3d-opt-label">Mirror</span>`
      + seg("mirror", [["off", "Off", "The brush works where you paint only."], ["x", "X", "The brush works on both sides of the X axis at once."], ["y", "Y", "The brush works above and below at once."], ["z", "Z", "The brush works front and back at once."]])
      + sep + hint(h);
    const r = bar.querySelector('[data-opt="brush"]'), out = bar.querySelector('[data-out="brush"]');
    r.value = String(ed.prefs.brush);
    const upd = () => { out.textContent = (ed.prefs.brush * 100).toFixed(1) + " mm"; };
    r.addEventListener("input", () => { ed.prefs.brush = Number(r.value); upd(); });
    upd();
  } else if (t === "lasso") {
    bar.innerHTML = through + sep + hint("Draw a loop around an area with the left button. Ctrl-drag takes away instead.");
  } else if (t === "panel") {
    bar.innerHTML = '<span class="pix-e3d-opt-label">How flat</span><input type="range" data-opt="flat" min="3" max="30" step="1" data-name="How flat" data-help="How much a face may tilt and still count as the same panel: higher takes in gentle curves.">'
      + `<span class="pix-e3d-opt-val" data-out="flat"></span>${sep}${hint("Click a flat panel to select all of it. Shift-click adds another panel.")}`;
    const r = bar.querySelector('[data-opt="flat"]'), out = bar.querySelector('[data-out="flat"]');
    r.value = String(ed.opts.flat);
    const upd = () => { out.textContent = ed.opts.flat + " degrees"; };
    r.addEventListener("input", () => { ed.opts.flat = Number(r.value); upd(); });
    upd();
  } else if (t === "piece") {
    bar.innerHTML = hint(`Click any part to select the whole separate piece it belongs to${m ? `: this model has ${fmtInt(m.stats.pieces)} pieces` : ""}. Shift-click adds another.`);
  } else if (t === "edge") {
    const a = !!m?.panelA, bb = !!m?.panelB;
    bar.innerHTML = `<span class="pix-e3d-chip a${a ? " on" : ""}">Panel A${a ? " picked" : ""}</span><span class="pix-e3d-chip b${bb ? " on" : ""}">Panel B${bb ? " picked" : ""}</span>`
      + sep + hint("Click a panel, then the panel next to it, then press Sharpen edges on the right. A third click starts again.");
  } else {
    bar.innerHTML = hint(`Red dots are open edges (holes), yellow dots broken edges${m ? `: ${fmtInt(m.stats.open)} open and ${fmtInt(m.stats.broken)} broken on this model` : ""}. Click next to a hole to close it; Fill small holes on the right closes all the small ones.`);
  }
  for (const s of bar.querySelectorAll("[data-seg]")) {
    const key = s.dataset.seg;
    const cur = key === "through" ? (ed.prefs.through ? "1" : "0") : ed.prefs.mirror;
    for (const x of s.querySelectorAll("button")) {
      x.classList.toggle("on", x.dataset.v === cur);
      x.addEventListener("click", () => {
        if (key === "through") ed.prefs.through = x.dataset.v === "1";
        else ed.prefs.mirror = x.dataset.v;
        renderOptions(ed, bar);
      });
    }
  }
}
