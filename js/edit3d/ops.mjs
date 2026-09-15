// Edit 3D Pixaroma - the edits that run in the browser (Flatten, Smooth, Straighten, Sharpen edges, Delete, the fills,
// Remove inside surfaces, Remove loose bits, Close cracks) and the History behind Undo / Redo. Every edit is one step:
// a snapshot before, the label after. The heavy buttons are in jobs.mjs and land here as one step too.
import { flattenSelection, smoothSelection, sharpenEdge } from "./geometry.mjs";
import { boundaryLoops, fanFill, dropLoosePieces, closeCracks } from "./topology.mjs";
import { fmtInt } from "./core.mjs";

const MAX_STEPS = 30;
const BUDGET = 600 * 1024 * 1024; // bytes the History may hold before its oldest steps go
const SMALL_HOLE = 16; // edges: the most Fill small holes closes (Tidy's rule)
const BIG_HOLE = 600; // edges: the most one Fill hole click closes
const LOOSE = 8; // faces: a separate piece smaller than this is a loose bit
const LINE_REACH = 0.015; // of the longest side (1.5 mm on a 100 mm print): how far a rounded edge may lie from its crease

export class Ops {
  constructor(ed) {
    this.ed = ed;
    this.undoStack = [];
    this.redoStack = [];
  }

  get count() { return this.undoStack.length; }
  labels() { return this.undoStack.map((u) => u.label); }
  render() { this.ed.ui.renderHistory(this.labels(), this.redoStack.map((r) => r.label)); }
  toast(msg, ms) { this.ed.ui.toast(msg, ms); }
  needSelection() { this.toast("Select an area first: paint it with Select, draw a Lasso, or click a Panel or a Piece."); }

  reset() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.render();
  }

  push(snap, label) {
    this.undoStack.push({ snap, label });
    this.redoStack.length = 0;
    let bytes = this.undoStack.reduce((n, u) => n + (u.snap.bytes || 0), 0);
    while (this.undoStack.length > MAX_STEPS || (this.undoStack.length > 1 && bytes > BUDGET)) bytes -= this.undoStack.shift().snap.bytes || 0;
    this.render();
  }

  /** Move: the points already moved during the drag. */
  commit(snap, label) {
    this.push(snap, label);
    this.ed.model.refreshGeometry();
    this.ed.afterGeometry();
  }

  /** One edit: the busy line, a snapshot, the edit, the History, the refresh. fn returns a label, or false for no edit. */
  async run(fn, busy, kind = "pos") {
    const ed = this.ed;
    if (!ed.loaded || !ed.model) return false;
    if (ed.busy) { this.toast("Wait for the current job to finish, or press Stop.", 3000); return false; }
    if (ed.showingBefore) ed.setBeforeAfter("after");
    ed.tools?.cancel();
    ed.busy = true;
    ed.ui.setBusy(busy || "Working...");
    await new Promise((r) => setTimeout(r, 30)); // so the line paints before a long edit
    // Closed in those 30 ms (Close, or the node removed): cleanup has already let the model go.
    if (!ed.isOpen() || !ed.model) {
      ed.busy = false;
      return false;
    }
    const m = ed.model;
    const snap = m.snapshot(kind);
    let label = false, failed = false;
    try {
      label = await fn();
    } catch (err) {
      failed = true;
      console.error("[Pixaroma.Edit3D]", err);
      try { m.restore(snap); } catch (_e) { /* keep what there is */ }
      this.toast(`That did not work: ${err?.message || err}`, 8000);
    } finally {
      ed.busy = false;
      ed.ui.clearBusy();
    }
    if (!label) {
      if (failed) ed.afterGeometry();
      return false;
    }
    this.push(snap, label);
    if (kind === "pos") m.refreshGeometry();
    ed.afterGeometry();
    return true;
  }

  undo() { this.step(this.undoStack, this.redoStack, "Undo"); }
  redo() { this.step(this.redoStack, this.undoStack, "Redo"); }

  step(from, to, word) {
    const ed = this.ed, m = ed.model;
    if (!ed.loaded || !m) return;
    if (ed.busy) { this.toast("Wait for the current job to finish, or press Stop.", 3000); return; }
    const entry = from.pop();
    if (!entry) { this.toast(`Nothing to ${word.toLowerCase()}.`, 2000); this.render(); return; }
    ed.tools?.cancel();
    const now = m.snapshot(entry.snap.kind);
    try {
      m.restore(entry.snap);
    } catch (err) {
      this.reset();
      this.toast(`${word} did not work, so the History was cleared: ${err?.message || err}`, 8000);
      ed.afterGeometry();
      return;
    }
    to.push({ snap: now, label: entry.label });
    if (ed.showingBefore) ed.setBeforeAfter("after");
    ed.afterGeometry();
    this.render();
    this.toast(`${word}: ${entry.label}`, 2500);
  }

  // ── Fix the selection ──
  flatten() { return this.run(() => this.flattenWith(false), "Flattening..."); }
  straighten() { return this.run(() => this.flattenWith(true), "Straightening..."); }

  flattenWith(snapToAxis) {
    const m = this.ed.model;
    const r = flattenSelection(m.pos, m.ptN, m.sel, m.ptVis, m.adj, { strength: this.ed.opts.flatStrength, snapToAxis });
    if (!r.groups) { this.needSelection(); return false; }
    if (snapToAxis && !r.moved && r.skipped) {
      this.toast("The selection is more than 15 degrees off level or upright, so it was left alone. Use Flatten for a slanted panel.");
      return false;
    }
    if (!r.moved) { this.toast("No part of the selection faces one way enough to flatten. Select a flatter area, or use Smooth."); return false; }
    const extra = [];
    if (r.left) extra.push(`${fmtInt(r.left)} facing another way left alone`);
    if (r.skipped) extra.push(`${r.skipped} area${r.skipped > 1 ? "s" : ""} too far off`);
    return `${snapToAxis ? "Straighten" : "Flatten"} (${fmtInt(r.moved)} points${extra.length ? ", " + extra.join(", ") : ""})`;
  }

  smooth() {
    return this.run(() => {
      const m = this.ed.model;
      const n = smoothSelection(m.pos, m.sel, m.ptVis, m.adj, { strength: this.ed.opts.smoothStrength });
      if (!n) { this.needSelection(); return false; }
      return `Smooth (${fmtInt(n)} points)`;
    }, "Smoothing...");
  }

  sharpen() {
    const m = this.ed.model;
    if (!m) return false;
    if (!m.panelA || !m.panelB) {
      this.ed.setTool("edge");
      this.toast("Pick two panels first: with the Sharpen edge tool, click a panel, then the panel next to it.");
      return false;
    }
    return this.run(() => {
      const r = sharpenEdge(m.pos, m.ptN, m.fnRaw, m.panelA, m.panelAFaces, m.panelB, m.panelBFaces, m.adj, { lineReach: LINE_REACH * m.longest });
      if (r.error) { this.toast("Those two panels face the same way, so there is no edge between them to sharpen."); return false; }
      m.panelA = m.panelB = m.panelAFaces = m.panelBFaces = null;
      if (!r.squeezed) this.toast("No rounded edge was found between those two panels, so they were only flattened. Pick two panels that meet.");
      return `Sharpen edge (${fmtInt(r.squeezed)} edge points, ${fmtInt(r.flattened)} panel points)`;
    }, "Sharpening the edge...");
  }

  del() {
    return this.run(() => {
      const m = this.ed.model;
      const n = m.deleteSelected();
      if (!n) { this.needSelection(); return false; }
      m.sel.fill(0);
      return `Delete (${fmtInt(n)} faces)`;
    }, "Deleting...");
  }

  // ── holes ──
  loops(maxLen, accept = null) {
    const m = this.ed.model;
    return boundaryLoops(null, m.P, m.counts, m.indices, m.alive, maxLen, accept).loops;
  }

  /** Close loops: up to 4 corners one polygon, a fan around the middle otherwise. -> faces added */
  fill(loops) {
    const m = this.ed.model;
    const f = fanFill(m.pos, loops, 4);
    m.appendPolys(f.counts, f.indices, f.newPoints);
    return f.faces;
  }

  fillSelection() {
    return this.run(() => {
      const m = this.ed.model;
      if (!m.selectedCount()) { this.needSelection(); return false; }
      const loops = this.loops(BIG_HOLE, (a, b) => m.sel[a] && m.sel[b]).filter((l) => l.every((p) => m.sel[p]));
      if (!loops.length) {
        this.toast("No hole has its whole edge inside the selection. Select all around a hole (a Lasso works well), then press Fill holes.");
        return false;
      }
      const faces = this.fill(loops);
      return `Fill holes (${fmtInt(loops.length)} hole${loops.length > 1 ? "s" : ""}, ${fmtInt(faces)} faces)`;
    }, "Filling...", "all");
  }

  fillLoopAt(a, b) {
    return this.run(() => {
      const on = (x, y) => (x === a && y === b) || (x === b && y === a);
      const loops = this.loops(BIG_HOLE, on);
      const loop = loops.find((l) => l.some((x, i) => on(x, l[(i + 1) % l.length]))) || loops.find((l) => l.includes(a));
      if (!loop) { this.toast(`That hole is too big or too tangled to close in one go (more than ${BIG_HOLE} edges).`); return false; }
      const faces = this.fill([loop]);
      return `Fill hole (${fmtInt(loop.length)} edges, ${fmtInt(faces)} faces)`;
    }, "Filling the hole...", "all");
  }

  // ── Whole model ──
  removeInside() {
    return this.run(async () => {
      const ed = this.ed, m = ed.model;
      const seen = await ed.view.seenTriangles(m.seenMesh, m.T, m.center, m.radius, 96, 1024,
        (f) => ed.ui.setBusy(`Looking at the model from 96 sides... ${Math.round(f * 100)}%`));
      const polySeen = new Uint8Array(m.F);
      for (let t = 0; t < m.T; t++) if (seen[t + 1]) polySeen[m.triPoly[t]] = 1;
      let n = 0, shown = 0;
      for (let f = 0; f < m.F; f++) {
        if (!m.alive[f] || m.hidden[f]) continue;
        shown++;
        if (!polySeen[f]) { m.alive[f] = 0; n++; }
      }
      if (!n) { this.toast("Nothing is hidden inside this model: every surface can be seen from outside."); return false; }
      m.sel.fill(0);
      this.toast(`${fmtInt(n)} faces (${Math.round((100 * n) / shown)}% of the model) could never be seen from outside and are gone. Switch X-ray on and compare Before and After.`, 8000);
      return `Remove inside surfaces (${fmtInt(n)} faces)`;
    }, "Looking at the model from 96 sides...");
  }

  fillSmall() {
    return this.run(() => {
      const m = this.ed.model;
      const loops = this.loops(SMALL_HOLE).filter((l) => l.length <= SMALL_HOLE);
      if (!loops.length) {
        this.toast(m.stats.open ? `Every hole left is longer than ${SMALL_HOLE} edges. Close a big one with the Fill hole tool.` : "This model has no holes.");
        return false;
      }
      const faces = this.fill(loops);
      return `Fill small holes (${fmtInt(loops.length)} holes, ${fmtInt(faces)} faces)`;
    }, "Filling the small holes...", "all");
  }

  removeLoose() {
    return this.run(() => {
      const m = this.ed.model;
      const n = dropLoosePieces(null, m.P, m.counts, m.indices, m.alive, LOOSE);
      if (!n) { this.toast(`No loose bits: every separate piece has at least ${LOOSE} faces.`); return false; }
      return `Remove loose bits (${fmtInt(n)} faces)`;
    }, "Removing loose bits...");
  }

  closeCracks() {
    return this.run(() => {
      const ed = this.ed, m = ed.model, pct = ed.opts.cracks;
      const r = closeCracks(m.pos, m.P, m.counts, m.indices, m.alive, (pct / 100) * m.longest);
      if (!r.joined) { this.toast(`No open edges lie within ${pct}% of the model's size of each other. Try a bigger distance.`); return false; }
      const loops = this.loops(SMALL_HOLE).filter((l) => l.length <= SMALL_HOLE);
      if (loops.length) this.fill(loops);
      else m.rebuild(); // the corners were renumbered in place
      return `Close cracks ${pct}% (${fmtInt(r.joined)} points joined${loops.length ? `, ${fmtInt(loops.length)} gaps filled` : ""})`;
    }, "Closing cracks...", "all");
  }
}
