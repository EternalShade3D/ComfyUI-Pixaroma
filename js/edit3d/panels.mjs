// Edit 3D Pixaroma - the editor's panels: the mode switch and the tools on the left, the fixes, the whole-model
// buttons, Save to Disk as and the History on the right, the options bar for the tool in use, Before / After in the
// title bar, the line at the bottom left (the numbers, or what the control under the mouse does), the toast and the
// job panel. The markup lives in panel_html.mjs; here it is built once and wired. Every button calls a method of the
// editor, and switching modes only shows and hides, so no listener can go stale.
import { fmtInt, facesText } from "./core.mjs";
import { leftHtml, rightHtml, modesHtml, seg } from "./panel_html.mjs";

export function buildPanels(ed) {
  const L = ed.layout;
  const q = (root, sel) => root.querySelector(sel);
  L.leftSidebar.insertAdjacentHTML("beforeend", modesHtml() + leftHtml());
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
  help(foot[0], "How to use the editor, mode by mode and tool by tool, with examples. (? or F1)", "Help");
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
    selCount: q(L.leftSidebar, '[data-el="selCount"]'), check: q(L.leftSidebar, '[data-el="check"]'),
    holeBadge: q(scroll, '[data-el="holeBadge"]'), looseBadge: q(scroll, '[data-el="looseBadge"]'),
    history: q(scroll, '[data-el="history"]'), name: q(scroll, '[data-el="name"]'),
    toast: toastEl, legend, job, jobMsg: job.querySelector(".msg"), jobStop: job.querySelector("button"), scroll,
  };
  els.name.value = ed.opts.name;

  // ── bindings ──
  const all = (sel) => L.overlay.querySelectorAll(sel);
  for (const t of all("[data-mode-btn]")) t.addEventListener("click", () => ed.setMode(t.dataset.modeBtn));
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
    sym: [() => ed.prefs.symmetry, (v) => ed.setSymmetry(v)],
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
  // A setting can appear in more than one panel (Symmetry does), so every copy is synced, never just the one clicked.
  const syncSegKey = (key) => { for (const s of all(`[data-seg="${key}"]`)) syncSeg(s); };
  for (const s of all("[data-seg]")) {
    const def = SEGS[s.dataset.seg];
    if (!def) continue;
    for (const x of s.querySelectorAll("button")) x.addEventListener("click", () => { def[1](x.dataset.v); syncSegKey(s.dataset.seg); });
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
      ui.renderCheck();
      if (busyMsg || helpShowing) return;
      info.className = "pxf-tool-info" + (ed.loadError ? " error" : "");
      info.textContent = statsLine();
    },
    /** Model check: what is wrong with this model, and which button fixes it. */
    renderCheck() {
      const m = ed.model, box = els.check;
      if (!box) return;
      if (!m) {
        box.innerHTML = '<div class="pix-e3d-check-row dim"><span>Waiting for the model</span></div>';
        return;
      }
      const s = m.stats;
      const rows = [
        ["Faces", facesText({ triangles: s.triangles, quads: s.quads, ngons: s.ngons }), "",
          "How many polygons the model has. Quads and triangles are counted apart. Quads and Reduce polygons change this."],
        ["Pieces", fmtInt(s.pieces), s.tiny ? "warn" : "ok", s.tiny
          ? `${fmtInt(s.tiny)} of them are specks of under 8 faces. Remove loose bits clears them.`
          : "Every separate piece is big enough to be a real part of the model."],
        ["Holes", fmtInt(s.open) + " open edges", s.open ? "warn" : "ok", s.open
          ? "Fill small holes closes the small ones. A big opening needs the Fill hole tool in Polygons mode."
          : "The surface is closed: no open edges."],
        ["Broken edges", fmtInt(s.broken), s.broken ? "warn" : "ok", s.broken
          ? "More than two faces share an edge, which a 3D printer cannot read. Make solid rebuilds the model as one clean solid."
          : "No edge is shared by more than two faces."],
      ];
      if (s.hidden) rows.push(["Hidden", fmtInt(s.hidden) + " faces", "", "Faces you hid are still there and are still saved. Show all brings them back. (Alt+H)"]);
      box.textContent = "";
      for (const [label, value, state, hint] of rows) {
        const row = document.createElement("div");
        row.className = "pix-e3d-check-row" + (state ? " " + state : "");
        row.dataset.name = label;
        row.dataset.help = hint;
        const a = document.createElement("span");
        a.textContent = label;
        const v = document.createElement("b");
        v.textContent = value;
        row.append(a, v);
        box.appendChild(row);
      }
    },
    setMode(mode) {
      for (const el of all("[data-mode]")) el.classList.toggle("pix-e3d-off", !el.dataset.mode.split(" ").includes(mode));
      for (const btn of all("[data-mode-btn]")) btn.classList.toggle("on", btn.dataset.modeBtn === mode);
      ui.renderOptions();
      ui.refreshInfo();
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
    syncSegKey,
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
  ui.setMode(ed.prefs.mode);
  return ui;
}

function renderOptions(ed, bar) {
  if (!bar) return;
  const t = ed.tool, m = ed.model;
  const sym = ed.prefs.symmetry !== "off" ? ` Symmetry ${ed.prefs.symmetry.toUpperCase()} is on, so it happens on both sides.` : "";
  const through = seg("through", [["0", "Facing me", "Only the surface turned towards you is picked, so the far side stays out."], ["1", "Through", "Picks right through the model: the far side too. Example: both sides of a thin wing at once."]]);
  const sep = '<span class="pix-e3d-opt-sep"></span>';
  const hint = (s) => `<span class="pix-e3d-opt-hint">${s}</span>`;
  if (ed.prefs.mode === "model") {
    bar.innerHTML = hint("Whole model: the buttons on the right work on everything, so there is nothing to pick first. Model check on the left says what this model needs.");
    return;
  }
  if (t === "select" || t === "erase" || t === "move") {
    const h = t === "select" ? "Paint with the left button, hold Ctrl to take away. Right-drag turns the view."
      : t === "erase" ? "Paint over a selection to take it away." : "Drag to pull the surface. Small moves work best.";
    bar.innerHTML = '<span class="pix-e3d-opt-label">Brush size</span><input type="range" data-opt="brush" min="0.004" max="0.15" step="0.001" data-name="Brush size" data-help="How wide the brush reaches, in millimetres on a 100 mm print. The [ and ] keys change it too.">'
      + `<span class="pix-e3d-opt-val" data-out="brush"></span>${through}${sep}${hint(h + sym)}`;
    const r = bar.querySelector('[data-opt="brush"]'), out = bar.querySelector('[data-out="brush"]');
    r.value = String(ed.prefs.brush);
    const upd = () => { out.textContent = (ed.prefs.brush * 100).toFixed(1) + " mm"; };
    r.addEventListener("input", () => { ed.prefs.brush = Number(r.value); upd(); });
    upd();
  } else if (t === "lasso") {
    bar.innerHTML = through + sep + hint("Draw a loop around an area with the left button. Ctrl-drag takes away instead." + sym);
  } else if (t === "panel") {
    bar.innerHTML = '<span class="pix-e3d-opt-label">How flat</span><input type="range" data-opt="flat" min="3" max="30" step="1" data-name="How flat" data-help="How much a face may tilt and still count as the same panel: higher takes in gentle curves.">'
      + `<span class="pix-e3d-opt-val" data-out="flat"></span>${sep}${hint("Click a flat panel to select all of it. Shift-click adds another panel." + sym)}`;
    const r = bar.querySelector('[data-opt="flat"]'), out = bar.querySelector('[data-out="flat"]');
    r.value = String(ed.opts.flat);
    const upd = () => { out.textContent = ed.opts.flat + " degrees"; };
    r.addEventListener("input", () => { ed.opts.flat = Number(r.value); upd(); });
    upd();
  } else if (t === "piece") {
    bar.innerHTML = hint(`Click any part to select the whole separate piece it belongs to${m ? `: this model has ${fmtInt(m.stats.pieces)} pieces` : ""}. Shift-click adds another.${sym}`);
  } else if (t === "edge") {
    const a = !!m?.panelA, bb = !!m?.panelB;
    bar.innerHTML = `<span class="pix-e3d-chip a${a ? " on" : ""}">Panel A${a ? " picked" : ""}</span><span class="pix-e3d-chip b${bb ? " on" : ""}">Panel B${bb ? " picked" : ""}</span>`
      + sep + hint("Click a panel, then the panel next to it, then press Sharpen edges on the right. A third click starts again.");
  } else {
    bar.innerHTML = hint(`Red dots are open edges (holes), yellow dots broken edges${m ? `: ${fmtInt(m.stats.open)} open and ${fmtInt(m.stats.broken)} broken on this model` : ""}. Click next to a hole to close it; Fill small holes in Whole model closes all the small ones.`);
  }
  for (const s of bar.querySelectorAll('[data-seg="through"]')) {
    for (const x of s.querySelectorAll("button")) {
      x.classList.toggle("on", x.dataset.v === (ed.prefs.through ? "1" : "0"));
      x.addEventListener("click", () => {
        ed.prefs.through = x.dataset.v === "1";
        renderOptions(ed, bar);
      });
    }
  }
}
