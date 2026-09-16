// Edit 3D Pixaroma - the fullscreen editor. One per node while open (node._pixE3dEditor), the framework chrome
// (js/framework/layout.mjs), the shared undo guard (graph-undo-guard.md), and ONE WebGL renderer made here and
// disposed on close. panels.mjs builds the controls, tools.mjs the pointer tools, ops.mjs the edits and the History,
// jobs.mjs the heavy buttons.
import { app } from "/scripts/app.js";
import { createEditorLayout } from "../framework/index.mjs";
import { installGraphUndoGuard } from "../shared/graph_undo_guard.mjs";
import { notifyGraphChanged } from "../shared/graph_changed.mjs";
import { readState, writeState, sourceRef, editedName, snapName, fileIdFor, sanitizePrefs, MODES, SUBFOLDER, MAX_EDITS, fmtInt } from "./core.mjs";
import { fetchModel, upload } from "./server.mjs";
import { loadThree, parseSource } from "./loaders.mjs";
import { createView } from "./view.mjs";
import { MeshModel, buildBeforeMesh } from "./mesh.mjs";
import { buildPanels } from "./panels.mjs";
import { installTools } from "./tools.mjs";
import { Ops } from "./ops.mjs";
import { runHeavy, modelFile } from "./jobs.mjs";
import { writeObj } from "./objio.mjs";
import { writeGlb, writeStl, placeCopy } from "./writers.mjs";
import { EDITOR_HELP_HTML } from "./help.mjs";
import { injectEditorCSS } from "./editor_css.mjs";
import { renderFace, flash } from "./face.mjs";
import { fileKey } from "./filekey.mjs";

const SLOW_TRIANGLES = 1500000;
const GENERATOR = "Pixaroma Edit 3D";

export function isEditorOpen(node) {
  const ed = node?._pixE3dEditor;
  if (!ed) return false;
  if (!ed.isOpen()) {
    node._pixE3dEditor = null;
    return false;
  }
  return true;
}

export function closeEditorFor(node) {
  if (isEditorOpen(node)) node._pixE3dEditor.close();
}

export async function openEditor(node) {
  if (!node?.graph || isEditorOpen(node)) return;
  const src = sourceRef(node);
  if (src.error) { flash(node, src.error, true, 8000); return; }
  const ed = new Edit3DEditor(node);
  node._pixE3dEditor = ed;
  await ed.open(src);
}

function cleanName(raw) {
  let s = String(raw || "").trim().replace(/\.(obj|glb|gltf|stl|fbx|ply)$/i, "").replace(/[^A-Za-z0-9 _.-]+/g, "_");
  s = s.replace(/^[.\s]+|[.\s]+$/g, "").slice(0, 80);
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s += "_3d";
  return s || "edit3d";
}

class Edit3DEditor {
  constructor(node) {
    this.node = node;
    this.state = readState(node);
    this.prefs = { ...sanitizePrefs(this.state.prefs) };
    this.opts = {
      flat: 12, flatStrength: 1, smoothStrength: 0.5, cracks: 0.25, holeSize: 16, quads: 200000, reduce: 50, solid: 384,
      mirrorAxis: "x", mirrorSide: "positive", fmt: "auto", name: "edit3d", turnY: 0, center: true,
    };
    this.tool = "select";
    this.showingBefore = false;
    this.busy = false;
    this.saving = false;
    this.loaded = false;
    this.closed = false;
    this.layout = this.view = this.THREE = this.model = this.before = this.ui = this.ops = this.tools = null;
    this.symC = [0, 0, 0]; // the symmetry plane: the middle of the model as it opened
    this.loadMsg = "Loading the model...";
    this.loadError = false;
    this.fileId = fileIdFor(node, node.graph || app.graph);
    this.sourceKey = "";
    this.continuing = false;
    this.heavy = (op) => runHeavy(this, op);
  }

  isOpen() { return !this.closed && !!this.layout?.overlay?.isConnected; }
  brushRadius() { return this.prefs.brush * (this.model?.longest || 1); }

  async open(src) {
    injectEditorCSS();
    const L = createEditorLayout({
      editorName: "Edit 3D", leftWidth: 232, rightWidth: 290, showUndoRedo: true, showZoomBar: true, showTopOptionsBar: true,
      onSave: () => this.save(), onClose: () => this.close(), onUndo: () => this.ops?.undo(), onRedo: () => this.ops?.redo(),
      onZoomIn: () => this.view?.zoomBy(0.85), onZoomOut: () => this.view?.zoomBy(1 / 0.85), onZoomFit: () => this.setView("fit"),
      helpContent: EDITOR_HELP_HTML, helpTitle: "Edit 3D Pixaroma: how to use it, with examples",
    });
    this.layout = L;
    L.overlay.classList.add("pix-e3d-editor");
    L.onSaveToDisk = () => this.saveToDisk();
    L.onCleanup = () => this.cleanup();
    L.mount();
    this._undoGuardOff = installGraphUndoGuard(() => this.isOpen());
    this.ui = buildPanels(this);
    this.ui.setToolActive(this.tool);
    this.ui.renderOptions();
    this._onKey = (e) => this.onKey(e);
    // After mount: the layout's own window-capture blocker stops the key reaching ComfyUI, and a later listener on
    // the same target still runs.
    window.addEventListener("keydown", this._onKey, true);
    this.ui.setBusy("Loading the model...");
    try {
      const { THREE, OrbitControls } = await loadThree();
      if (!this.isOpen()) return;
      this.THREE = THREE;
      this.view = createView(THREE, OrbitControls, L.workspace);
      this.view.onCamera = () => L.setZoomLabel(this.view.zoomPercent() + "%");
      const { buf, p } = await fetchModel(src.value);
      if (!this.isOpen()) return;
      this.ui.setBusy("Reading the model...");
      await new Promise((r) => setTimeout(r, 20));
      const source = await parseSource(THREE, buf, p);
      // The key the node compares at Run: a picked file's comes from its bytes (the same rule as Python's file_key),
      // a wired model's from the last run's report.
      const key = src.kind === "wired" ? src.sourceKey : fileKey(p.filename, buf);
      const st = this.state;
      let working = source;
      if (st.edited && st.sourceKey && st.sourceKey === key) {
        try {
          const e = await fetchModel(`${SUBFOLDER}/${st.edited} [input]`, String(st.stamp || ""));
          working = await parseSource(THREE, e.buf, e.p);
          this.continuing = true;
        } catch (err) {
          this.ui.toast(`The saved edit could not be opened (${err?.message || err}), so the model opens as it came.`, 9000);
        }
      } else if (st.edited && st.sourceKey) {
        this.ui.toast("The model changed since it was last edited, so it opens as it came. Save replaces the old edit.", 9000);
      }
      if (!this.isOpen()) return;
      this.sourceKey = key;
      this.model = new MeshModel(THREE, working);
      this.before = buildBeforeMesh(THREE, source);
      this.before.visible = false;
      this.view.scene.add(this.model.mesh, this.before);
      this.model.refreshGeometry();
      this.symC = this.model.center.slice();
      this.ops = new Ops(this);
      this.tools = installTools(this);
      this.loaded = true;
      this.applyLook();
      this.afterGeometry();
      this.view.fit(this.model.center, this.model.radius);
      if (src.kind === "picked") this.opts.name = cleanName(p.filename.replace(/\.[^.]+$/, "") + "_edit");
      this.ui.els.name.value = this.opts.name;
      this.ui.clearBusy();
      if (this.model.T > SLOW_TRIANGLES) {
        this.ui.toast(`This model has ${fmtInt(this.model.T)} triangles, so the tools will be slow. Reduce polygons first if you can.`, 9000);
      } else if (source.textures > 1) {
        this.ui.toast("This model has several textures. The editor shows them as colours; Save keeps the colours.", 7000);
      } else if (this.continuing) {
        this.ui.toast(`Your saved edit is open (${fmtInt(st.editCount)} edits). Before shows the model as it came.`, 5000);
      }
    } catch (err) {
      console.error("[Pixaroma.Edit3D] open", err);
      this.loadError = true;
      this.loadMsg = `Could not open the model: ${err?.message || err}`;
      if (this.isOpen()) {
        this.ui.clearBusy();
        this.ui.toast(this.loadMsg, 12000);
      }
    }
  }

  // ── what the screen shows ──
  attach() {
    const m = this.model, s = this.view?.scene;
    if (!m || !s) return;
    for (const o of [m.wire, m.markers?.open, m.markers?.broken]) if (o && o.parent !== s) s.add(o);
  }

  afterGeometry() {
    const m = this.model;
    if (!m || !this.view) return;
    m.writeColours(this.prefs.look, true);
    if (this.prefs.look === "wire") m.ensureWire();
    m.runCensus();
    this.attach();
    if (m.wire) m.wire.visible = this.prefs.look === "wire" && !this.showingBefore;
    this.syncMarkers();
    this.ui.refreshInfo();
    if (this.tool === "piece" || this.tool === "hole" || this.tool === "edge") this.ui.renderOptions();
    this.view.requestDraw();
  }

  census() {
    this.model.runCensus();
    this.attach();
    this.syncMarkers();
  }

  recolour() {
    this.model?.writeColours(this.prefs.look, true);
    this.view?.requestDraw();
  }

  syncMarkers() {
    const m = this.model;
    const on = !this.showingBefore && (this.prefs.holes || this.tool === "hole");
    if (m?.markers) {
      m.markers.open.visible = on;
      m.markers.broken.visible = on;
    }
    this.ui.showLegend(on && !!m);
    this.view?.requestDraw();
  }

  applyLook() {
    const m = this.model;
    if (!m) return;
    m.applyLook(this.prefs.look, this.prefs.xray);
    this.attach();
    if (m.wire) m.wire.visible = this.prefs.look === "wire" && !this.showingBefore;
    m.writeColours(this.prefs.look, true);
    this.before?.userData.setLook(this.prefs.look, this.prefs.xray);
    this.view.requestDraw();
  }

  setLook(look) {
    this.prefs.look = look;
    this.applyLook();
    this.ui.syncLook();
  }

  setXray(on) {
    this.prefs.xray = !!on;
    this.applyLook();
    this.ui.syncSwitches();
  }

  setHoles(on) {
    this.prefs.holes = !!on;
    if (on && this.model?.censusDirty) this.census();
    this.syncMarkers();
    this.ui.syncSwitches();
  }

  /** The mode decides which panels are on screen. It changes nothing about the model, so switching is always safe. */
  setMode(mode) {
    if (!MODES.includes(mode)) return;
    this.prefs.mode = mode;
    this.tools?.cancel();
    this.hideRings();
    this.ui.setMode(mode);
    this.syncMarkers();
  }

  setSymmetry(v) {
    this.prefs.symmetry = v;
    if (v === "off") this.hideRings();
    this.ui.syncSegKey("sym");
    this.ui.renderOptions();
    this.view?.requestDraw();
  }

  hideRings() {
    if (!this.view) return;
    this.view.ring.style.display = "none";
    this.view.ring2.style.display = "none";
  }

  setTool(t) {
    // Every tool belongs to Polygons mode, so its key takes you there instead of doing nothing.
    if (this.prefs.mode !== "polys") this.setMode("polys");
    this.tools?.cancel();
    this.tool = t;
    this.ui.setToolActive(t);
    this.hideRings();
    this.ui.renderOptions();
    this.syncMarkers();
  }

  setView(name) { this.view?.setView(name); }

  setBeforeAfter(which) {
    const before = which === "before";
    if (before !== this.showingBefore) {
      this.tools?.cancel();
      this.showingBefore = before;
      if (this.model) {
        this.model.mesh.visible = !before;
        if (this.model.wire) this.model.wire.visible = !before && this.prefs.look === "wire";
      }
      if (this.before) this.before.visible = before;
      if (this.view) this.view.ring.style.display = "none";
      this.syncMarkers();
      this.ui.refreshInfo();
      this.view?.requestDraw();
    }
    this.ui.syncLook();
  }

  selection(cmd) {
    const m = this.model;
    if (!this.loaded || !m) return;
    if (this.busy) { this.ui.toast("Wait for the current job to finish, or press Stop.", 3000); return; }
    if (this.showingBefore) this.setBeforeAfter("after");
    if (cmd === "hide" || cmd === "isolate" || cmd === "show") {
      if (cmd === "hide") {
        const n = m.hideSelected();
        if (!n) { this.ops.needSelection(); return; }
        m.sel.fill(0);
        this.ui.toast(`${fmtInt(n)} faces hidden. Show all brings them back.`, 3500);
      } else if (cmd === "isolate") {
        const n = m.isolateSelected();
        if (n < 0) { this.ops.needSelection(); return; }
        this.ui.toast(`Only the selection is shown now (${fmtInt(n)} faces hidden). Show all brings the rest back.`, 4000);
      } else {
        m.showAll();
      }
      m.refreshGeometry();
      this.afterGeometry();
      return;
    }
    if (cmd === "all") m.selectAll();
    else if (cmd === "none") { m.clearSelection(); this.ui.renderOptions(); }
    else if (cmd === "invert") m.invertSelection();
    else if (cmd === "grow") m.growSelection();
    else if (cmd === "shrink") m.shrinkSelection();
    this.recolour();
    this.ui.refreshInfo();
  }

  onKey(e) {
    if (!this.isOpen()) return;
    // The framework's focus trap is a hidden textarea that holds the focus while the editor is open, so a key normally
    // arrives from THAT; only a real text field the user types into (the Name box) keeps its keys.
    const tg = e.target;
    const typing = tg && !tg.dataset?.pixaromaTrap && (tg.isContentEditable || tg.tagName === "TEXTAREA"
      || (tg.tagName === "INPUT" && !["range", "checkbox", "radio", "button"].includes(tg.type)));
    if (typing) {
      if (e.key === "Escape") tg.blur();
      return;
    }
    const k = String(e.key || "").toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    const L = this.layout;
    if (e.key === "?" || e.key === "F1") { e.preventDefault(); L.toggleHelp(); return; }
    if (e.key === "Escape") {
      e.preventDefault();
      if (L.helpPanel.style.display === "block") L.toggleHelp();
      else this.selection("none");
      return;
    }
    if (mod && k === "z") { e.preventDefault(); if (e.shiftKey) this.ops?.redo(); else this.ops?.undo(); return; }
    if (mod && k === "y") { e.preventDefault(); this.ops?.redo(); return; }
    if (mod && k === "a") { e.preventDefault(); this.selection("all"); return; }
    if (e.altKey && k === "h") { e.preventDefault(); this.selection("show"); return; }
    if (mod) {
      const v = { 1: "back", 3: "left", 7: "bottom" }[k];
      if (v) { e.preventDefault(); this.setView(v); }
      return;
    }
    if (e.altKey) return;
    if (e.key === "Delete") { e.preventDefault(); this.ops?.del(); return; }
    const tools = { b: "select", d: "erase", l: "lasso", p: "panel", i: "piece", m: "move", e: "edge", o: "hole" };
    const views = { 1: "front", 3: "right", 7: "top", 0: "q", f: "fit" };
    if (tools[k]) this.setTool(tools[k]);
    else if (views[k]) this.setView(views[k]);
    else if (k === "h") this.selection("hide");
    else if (k === "x") this.setXray(!this.prefs.xray);
    else if (k === "[" || k === "]") {
      this.prefs.brush = Math.min(0.15, Math.max(0.004, this.prefs.brush * (k === "]" ? 1.15 : 1 / 1.15)));
      if (this.tool === "select" || this.tool === "erase" || this.tool === "move") this.ui.renderOptions();
    } else return;
    e.preventDefault();
  }

  // ── saving ──
  /** The picture on the node: the whole model framed from the current angle, Clay (or Color), nothing marked. */
  async snapshotPng() {
    const v = this.view, m = this.model;
    if (!v || !m) return null;
    const cam = v.camera, ctl = v.controls;
    const pos = cam.position.clone(), target = ctl.target.clone();
    const look = this.prefs.look === "color" ? "color" : "clay";
    try {
      if (m.markers) { m.markers.open.visible = false; m.markers.broken.visible = false; }
      m.mesh.visible = true;
      if (this.before) this.before.visible = false;
      m.applyLook(look, false);
      m.writeColours(look, false);
      v.fit(m.center, m.radius, true);
      return await v.snapshotPng(512, 384);
    } finally {
      cam.position.copy(pos);
      ctl.target.copy(target);
      ctl.update();
      m.mesh.visible = !this.showingBefore;
      if (this.before) this.before.visible = this.showingBefore;
      this.applyLook();
      this.syncMarkers();
    }
  }

  async save() {
    if (this.saving || this.closed) return;
    const L = this.layout;
    if (!this.loaded || !this.model) { this.close(); return; }
    if (this.busy) { this.ui.toast("Wait for the current job to finish, or press Stop.", 3000); return; }
    const count = this.ops.count;
    if (!count) {
      flash(this.node, this.continuing ? "No new edits, so the saved edit stays as it was." : "Nothing was changed, so nothing was saved.", false, 5000);
      this.close();
      return;
    }
    this.tools?.cancel();
    this.saving = true;
    this.busy = true;
    L.setSaving();
    try {
      const { blob, ext } = await modelFile(this.model);
      const want = editedName(this.fileId, ext);
      const up = await upload(blob, want, { type: "input", subfolder: SUBFOLDER, overwrite: true });
      if (up.name !== want) throw new Error(`the server kept the file as ${up.name}`);
      const png = await this.snapshotPng();
      if (png) await upload(png, snapName(this.fileId), { type: "input", subfolder: SUBFOLDER, overwrite: true });
      const st = readState(this.node);
      const keep = this.continuing && st.edited;
      writeState(this.node, {
        edited: up.name, sourceKey: this.sourceKey, editCount: (keep ? st.editCount : 0) + count,
        edits: [...(keep ? st.edits : []), ...this.ops.labels()].slice(-MAX_EDITS), stamp: Date.now(), fileId: this.fileId, prefs: this.prefs,
      });
      notifyGraphChanged();
      renderFace(this.node);
      this.busy = false;
      L.setSaved(true);
    } catch (err) {
      console.error("[Pixaroma.Edit3D] save", err);
      this.busy = false;
      L.setSaveError(`Save failed: ${err?.message || err}`);
      this.ui.toast(`Save failed: ${err?.message || err}. Nothing changed on the node.`, 9000);
    } finally {
      this.saving = false;
    }
  }

  async saveToDisk() {
    const m = this.model;
    if (!this.loaded || !m || this.closed) return;
    if (this.busy) { this.ui.toast("Wait for the current job to finish, or press Stop.", 3000); return; }
    if (!m.stats.alive) { this.ui.toast("There are no faces to write."); return; }
    this.tools?.cancel();
    const o = this.opts, name = cleanName(o.name);
    const textured = !!(m.texture && m.cornerUv);
    const fmt = o.fmt === "auto" ? (textured ? "glb" : "obj") : o.fmt;
    const place = { turnY: o.turnY, center: o.center, ground: o.center };
    this.busy = true;
    this.ui.setBusy(`Writing ${name}.${fmt}...`);
    try {
      await new Promise((r) => setTimeout(r, 20));
      let blob;
      if (fmt === "obj") {
        const om = m.toObjModel();
        om.positions = placeCopy(om.positions, place);
        blob = new Blob([writeObj(om, GENERATOR)], { type: "text/plain" });
      } else if (fmt === "glb") {
        const tri = m.toTriangles(textured);
        tri.positions = placeCopy(tri.positions, place);
        if (o.turnY) tri.normals = placeCopy(tri.normals, { turnY: o.turnY });
        const png = textured ? await m.texturePng() : null;
        blob = new Blob([writeGlb({ ...tri, texturePng: png, generator: GENERATOR })], { type: "model/gltf-binary" });
      } else {
        const tri = m.toTriangles(false);
        // For printing it always stands on the bed: centred, on Z, 100 mm on its longest side.
        const pts = placeCopy(tri.positions, { turnY: o.turnY, center: true, ground: true, zUp: true, longest: 100 });
        blob = new Blob([writeStl(pts, tri.indices, GENERATOR)], { type: "application/octet-stream" });
      }
      const up = await upload(blob, `${name}.${fmt}`, { type: "output", subfolder: "3d", overwrite: false });
      this.ui.toast(`Saved to output/3d/${up.name}`, 6000);
    } catch (err) {
      console.error("[Pixaroma.Edit3D] save to disk", err);
      this.ui.toast(`Save to Disk failed: ${err?.message || err}`, 9000);
    } finally {
      this.busy = false;
      this.ui.clearBusy();
    }
  }

  close() {
    if (this.saving) { this.ui?.toast("Saving: the editor closes by itself when it is done.", 2500); return; }
    this.layout?.unmount();
  }

  /** Every way out (Close, Save, the node removed) ends here exactly once. */
  cleanup() {
    if (this.closed) return;
    this.closed = true;
    try { this._stopJob?.(); } catch (_e) { /* the job ends by itself */ }
    window.removeEventListener("keydown", this._onKey, true);
    this._undoGuardOff?.();
    this._undoGuardOff = null;
    try { this.tools?.dispose(); } catch (_e) { /* gone */ }
    try { this.ui?.dispose(); } catch (_e) { /* gone */ }
    try { this.model?.dispose(); } catch (_e) { /* gone */ }
    try { this.before?.userData?.dispose?.(); } catch (_e) { /* gone */ }
    try { this.view?.dispose(); } catch (_e) { /* gone */ }
    this.model = this.before = this.view = this.tools = null;
    if (this.node._pixE3dEditor === this) this.node._pixE3dEditor = null;
    this.node.setDirtyCanvas?.(true, true);
  }
}
