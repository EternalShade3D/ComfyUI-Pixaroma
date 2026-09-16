// Edit 3D Pixaroma - the edits that run in the browser (Flatten, Smooth, Straighten, Sharpen edges, Delete, the fills,
// Remove inside surfaces, Remove loose bits, Close cracks) and the History behind Undo / Redo. Every edit is one step:
// a snapshot before, the label after. The heavy buttons are in jobs.mjs and land here as one step too.
import { flattenSelection, smoothSelection, sharpenEdge, symmetriseSelection } from "./geometry.mjs";
import { boundaryLoops, fanFill, dropLoosePieces, closeCracks } from "./topology.mjs";
import { fmtInt, SYM_AXES } from "./core.mjs";

const MAX_STEPS = 30;
const BUDGET = 600 * 1024 * 1024; // bytes the History may hold before its oldest steps go
const SMALL_HOLE = 16; // edges: the size Quick clean up closes (Tidy's rule)
// How far a boundary walk may run before it gives up. It is NOT the size filter: a loop only exists once its walk
// CLOSES, so walking with a small cap abandons every longer border AND the small loops that border splits into.
// Measured on the Ep34 gun after Quick clean up: a cap of 16 returned NO loops at all while a cap of 60 returned 17,
// four of them 6 edges or under. Always walk with this cap and filter the ANSWER by size.
const WALK_CAP = 4000;
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

  /** A drag that already moved the points (Move, a sculpt stroke). posOnly skips the census: the topology did not
   *  change, and paying for an edge sort of the whole model at the end of every stroke is what makes it feel slow. */
  commit(snap, label, posOnly = false) {
    this.push(snap, label);
    this.ed.model.refreshGeometry(posOnly ? { posOnly: true } : undefined);
    this.ed.afterGeometry();
  }

  /** One edit: the busy line, a snapshot, the edit, the History, the refresh. fn returns a label, or false for no edit. */
  async run(fn, busy, kind = "pos") {
    const ed = this.ed;
    if (!ed.loaded || !ed.model) return false;
    if (ed.busy) { this.toast("Wait for the current job to finish, or press Stop.", 3000); return false; }
    if (ed.showingBefore) ed.setBeforeAfter("after");
    ed.tools?.cancel();
    ed.sculpt?.cancel(); // a stroke still under the mouse lands as its own step first
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
    ed.sculpt?.cancel();
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

  /**
   * Make the selection match itself across the symmetry plane. Point-moving only, so a "pos" snapshot undoes it and
   * no polygon can be harmed. The AXIS comes from the Symmetry switch the Selection panel already has, rather than
   * from a second picker of its own: one axis control for the whole mode is the thing to keep.
   */
  symmetrise() {
    const ed = this.ed, a = SYM_AXES.indexOf(ed.prefs.symmetry) - 1;
    if (a < 0) {
      this.toast("Pick an axis under Symmetry first: X, Y or Z. Make symmetric folds the selection across that plane.");
      return false;
    }
    return this.run(() => {
      const m = ed.model;
      if (!m.selectedCount()) { this.needSelection(); return false; }
      const r = symmetriseSelection(m.pos, m.sel, m.ptVis, m.adj, a, ed.symC[a], { strength: ed.opts.symStrength });
      if (!r.moved) {
        this.toast("Nothing in the selection has a matching point on the other side of the plane, so there was nothing to average.");
        return false;
      }
      const extra = r.lone ? `, ${fmtInt(r.lone)} with no partner left alone` : "";
      return `Make symmetric (${fmtInt(r.moved)} points${extra})`;
    }, "Making it symmetric...");
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
      // Counted BEFORE the delete, while the selection is still there. A face with only some corners selected is
      // skipped (Delete needs them all), which on a quad model is the fringe around a Panel selection. Saying so
      // turns "why is there a ragged border left" into something the user can act on.
      const skipped = m.partlySelectedCount();
      const n = m.deleteSelected();
      if (!n) { this.needSelection(); return false; }
      m.sel.fill(0);
      if (skipped) {
        this.toast(`${fmtInt(skipped)} face${skipped === 1 ? " was" : "s were"} left because only part of ${skipped === 1 ? "it" : "them"} was selected: on a quad model that is the row along the edge of the selection. Press Grow before Delete to take them too.`, 8000);
      }
      return `Delete (${fmtInt(n)} faces${skipped ? `, ${fmtInt(skipped)} partly selected left alone` : ""})`;
    }, "Deleting...");
  }

  // ── holes ──
  /** The holes whose rim is no longer than `sizeMax` edges. See WALK_CAP: the cap and the size filter are not the
   *  same thing, and using the size as the cap is how small holes went missing. */
  loops(sizeMax, accept = null) {
    const m = this.ed.model;
    const all = boundaryLoops(null, m.P, m.counts, m.indices, m.alive, WALK_CAP, accept).loops;
    return sizeMax >= WALK_CAP ? all : all.filter((l) => l.length <= sizeMax);
  }

  /** Every hole the editor can walk around, whatever its size. */
  allLoops() { return this.loops(WALK_CAP); }

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
  // Each of the three carries its work in a _body, so Quick clean up can run all three as ONE step in the History.

  /** Kills every face that can never be seen from outside. -> {n, shown} or null when there are none. */
  async _insideBody(onProgress) {
    const ed = this.ed, m = ed.model;
    const seen = await ed.view.seenTriangles(m.seenMesh, m.T, m.center, m.radius, 96, 1024, onProgress);
    const polySeen = new Uint8Array(m.F);
    for (let t = 0; t < m.T; t++) if (seen[t + 1]) polySeen[m.triPoly[t]] = 1;
    let n = 0, shown = 0;
    for (let f = 0; f < m.F; f++) {
      if (!m.alive[f] || m.hidden[f]) continue;
      shown++;
      if (!polySeen[f]) { m.alive[f] = 0; n++; }
    }
    if (!n) return null;
    m.sel.fill(0);
    return { n, shown };
  }

  /** Closes every hole whose rim is up to `sizeMax` edges. -> {holes, faces} or null. */
  _fillHolesBody(sizeMax) {
    const loops = this.loops(sizeMax);
    if (!loops.length) return null;
    return { holes: loops.length, faces: this.fill(loops) };
  }

  /** Fills again while it keeps finding holes: closing one rim can leave a small new one beside it. */
  _fillRepeat(sizeMax, passes = 3) {
    let holes = 0, faces = 0;
    for (let i = 0; i < passes; i++) {
      const r = this._fillHolesBody(sizeMax);
      if (!r) break;
      holes += r.holes;
      faces += r.faces;
    }
    return holes ? { holes, faces } : null;
  }

  /** Drops the separate pieces under LOOSE faces. -> faces removed (0 when there are none). */
  _looseBody() {
    const m = this.ed.model;
    return dropLoosePieces(null, m.P, m.counts, m.indices, m.alive, LOOSE);
  }

  removeInside() {
    return this.run(async () => {
      const ed = this.ed;
      const r = await this._insideBody((f) => ed.ui.setBusy(`Looking at the model from 96 sides... ${Math.round(f * 100)}%`));
      if (!r) { this.toast("Nothing is hidden inside this model: every surface can be seen from outside."); return false; }
      this.toast(`${fmtInt(r.n)} faces (${Math.round((100 * r.n) / r.shown)}% of the model) could never be seen from outside and are gone. Switch X-ray on and compare Before and After.`, 8000);
      return `Remove inside surfaces (${fmtInt(r.n)} faces)`;
    }, "Looking at the model from 96 sides...");
  }

  fillHoles() {
    return this.run(() => {
      const size = this.ed.opts.holeSize;
      const r = this._fillRepeat(size);
      if (!r) {
        const left = this.allLoops().length;
        this.toast(left
          ? `Every hole left has a rim longer than ${size} edges. Choose a bigger size beside this button, close one by hand with the Fill hole tool in Polygons mode, or press Make solid.`
          : this.ed.model.stats.open
            ? "The open edges left do not form a rim the editor can walk around, which happens where faces meet in threes. Make solid rebuilds the model as one closed solid."
            : "This model has no holes to close.");
        return false;
      }
      const left = this.allLoops().length;
      return `Fill holes (${fmtInt(r.holes)} closed, ${fmtInt(r.faces)} faces${left ? `, ${fmtInt(left)} left`: ""})`;
    }, "Filling the holes...", "all");
  }

  removeLoose() {
    return this.run(() => {
      const n = this._looseBody();
      if (!n) { this.toast(`No loose bits: every separate piece has at least ${LOOSE} faces.`); return false; }
      return `Remove loose bits (${fmtInt(n)} faces)`;
    }, "Removing loose bits...");
  }

  /** The three fixes every AI model needs, in the order that works, as ONE step: one Undo takes all three back. */
  quickClean() {
    return this.run(async () => {
      const ed = this.ed;
      const step = (msg) => { ed.ui.setBusy(msg); return new Promise((r) => setTimeout(r, 20)); };
      await step("Quick clean up 1 of 3: looking at the model from 96 sides...");
      const inside = await this._insideBody((f) => ed.ui.setBusy(`Quick clean up 1 of 3: looking from 96 sides... ${Math.round(f * 100)}%`));
      if (!ed.isOpen() || !ed.model) return false; // closed while the GPU pass ran
      await step("Quick clean up 2 of 3: filling the small holes...");
      const holes = this._fillRepeat(SMALL_HOLE);
      await step("Quick clean up 3 of 3: removing the loose bits...");
      const loose = this._looseBody();
      const left = this.allLoops().length;
      const parts = [];
      if (inside) parts.push(`${fmtInt(inside.n)} faces inside`);
      if (holes) parts.push(`${fmtInt(holes.holes)} holes`);
      if (loose) parts.push(`${fmtInt(loose)} loose faces`);
      if (!parts.length) {
        this.toast(left
          ? `Nothing was hidden inside and there are no small holes or loose bits, but ${fmtInt(left)} bigger hole${left > 1 ? "s are" : " is"} still open. Fill holes at a bigger size closes ${left > 1 ? "them" : "it"}, and Make solid always gives one closed solid.`
          : "This model is already clean: nothing hidden inside, no holes, no loose bits.");
        return false;
      }
      // Removing the skin inside OPENS the seam where the two skins met, so a cleaned model usually has MORE open
      // edges than it started with. Say so and name the next button, or it reads as a job half done.
      this.toast(`Quick clean up: ${inside ? `${fmtInt(inside.n)} faces that can never be seen from outside are gone (${Math.round((100 * inside.n) / inside.shown)}% of the model)` : "nothing was hidden inside"}, `
        + `${holes ? `${fmtInt(holes.holes)} small holes closed` : "no small holes to close"}, ${loose ? `${fmtInt(loose)} loose faces removed` : "no loose bits"}. `
        + (left
          ? `${fmtInt(left)} bigger hole${left > 1 ? "s" : ""} left where the skin inside was cut away: press Fill holes at Medium or Any size, or Make solid for printing.`
          : "No holes left."), 12000);
      return `Quick clean up (${parts.join(", ")}${left ? `, ${fmtInt(left)} holes left` : ""})`;
    }, "Quick clean up...", "all");
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
