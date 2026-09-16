// Edit 3D Pixaroma - Sculpt mode: a brush drags across the surface and the points under it move, sixty times a
// second, with symmetry, with Ctrl reversing the brush, and ONE step in the History per stroke. The maths of each
// brush is pure and lives in brushes.mjs; picking and symmetry are shared with Polygons mode through pick.mjs.
//
// Three things make a stroke affordable on a 200,000 triangle model: the point grid finds only the points under the
// brush, mesh.refreshLocal renews the normals of the brush's footprint instead of the whole model, and the commit
// is posOnly, so the census (an edge sort over everything) is not paid for at the end of every stroke.
import { createPick } from "./pick.mjs";
import { brushById } from "./brushes.mjs";
import { fmtInt } from "./core.mjs";

const SPACING = 0.25; // of the brush size: how often a fast drag is stamped, so it stays one stroke and not dabs
const MAX_BRIDGE = 12; // brush sizes: further than this is a move to another part of the model, not a stroke

export function installSculpt(ed) {
  const view = ed.view, THREE = ed.THREE, canvas = view.canvas;
  const P = createPick(ed);
  const V3 = () => new THREE.Vector3();
  const _c = V3();
  let stroke = null, lastEv = null, queued = false, raf = 0;
  let scratch = new Float32Array(3072);
  const grow = (n) => {
    if (scratch.length < n) scratch = new Float32Array(Math.max(n, scratch.length * 2));
    return scratch;
  };

  const sculpting = () => ed.prefs.mode === "sculpt";

  /** One stamp of the brush at a point (and at its mirror when Symmetry is on). -> the points it touched */
  function stampAt(point, invert) {
    const m = ed.model, r = ed.brushRadius(), r2 = r * r;
    const brush = brushById(ed.prefs.brushId), k = ed.brushStrength();
    const lock = stroke ? stroke.lock : "off";
    const touched = [];
    for (const { c, cam } of P.centres(point)) {
      const idx = [], w = [];
      m.pointsNear(c.x, c.y, c.z, r, (p, d2) => {
        if (!m.ptVis[p] || !P.facing(m, p, cam)) return;
        // The Polygons selection is the LOCK: protect what is already good, or work only inside it.
        if (lock === "protect" && m.sel[p]) return;
        if (lock === "only" && !m.sel[p]) return;
        const t = 1 - d2 / r2;
        idx.push(p);
        w.push(t * t);
      });
      if (!idx.length) continue;
      const ctx = {
        pos: m.pos, ptN: m.ptN, fnUnit: m.fnUnit, adj: m.adj, idx: Int32Array.from(idx), w: Float32Array.from(w),
        k, invert, cx: c.x, cy: c.y, cz: c.z, radius: r, plane: ed.sculptPlane || null, scratch: grow,
      };
      if (brush.apply(ctx)) for (const p of idx) touched.push(p);
    }
    return touched;
  }

  /** The Protect brush paints the picked area instead of moving anything. -> the points it changed */
  function paintSelection(point, remove) {
    const m = ed.model, r = ed.brushRadius(), val = remove ? 0 : 1;
    const touched = [];
    for (const { c, cam } of P.centres(point)) {
      m.pointsNear(c.x, c.y, c.z, r, (p) => {
        if (m.sel[p] === val || !m.ptVis[p] || !P.facing(m, p, cam)) return;
        m.sel[p] = val;
        touched.push(p);
      });
    }
    return touched;
  }

  function paint(point, invert) {
    const brush = brushById(ed.prefs.brushId);
    if (brush.paints) {
      const painted = paintSelection(point, invert);
      if (!painted.length) return false;
      ed.recolour();
      ed.ui.refreshInfo();
      // Painting protection that protects nothing would be a trap, so the first stroke switches Selection on.
      if (!invert && ed.prefs.lock === "off") {
        ed.prefs.lock = "protect";
        ed.ui.syncSegKey("lock");
        ed.ui.refreshInfo();
        ed.ui.toast("What you paint is now protected: the other brushes will not move it. Change that under Selection.", 7000);
      }
      return true;
    }
    const touched = stampAt(point, invert);
    if (!touched.length) return false;
    const m = ed.model;
    m.refreshLocal(touched);
    for (const p of touched) stroke.touched.add(p);
    stroke.moved = true;
    view.requestDraw();
    return true;
  }

  /** Grab holds the points it caught at the press, with their weights, and moves them by the drag. A mirrored set
   *  flips its own axis so both sides pull outwards together. */
  function buildGrab(hit, lock) {
    const m = ed.model, r = ed.brushRadius(), r2 = r * r, sets = [];
    const collect = (c, cam, flip) => {
      const idx = [], w = [];
      m.pointsNear(c.x, c.y, c.z, r, (p, d2) => {
        if (!m.ptVis[p] || !P.facing(m, p, cam)) return;
        if (lock === "protect" && m.sel[p]) return;
        if (lock === "only" && !m.sel[p]) return;
        const k = 1 - d2 / r2;
        idx.push(p);
        w.push(k * k);
      });
      if (idx.length) sets.push({ idx: Int32Array.from(idx), w: Float32Array.from(w), flip });
    };
    collect(hit.point, view.camera.position, -1);
    const a = P.symAxis();
    // Only when the brush is off the symmetry plane, or the two halves would pull the same points twice.
    if (a >= 0 && Math.abs(hit.point.getComponent(a) - ed.symC[a]) > r * 0.5) {
      collect(P.reflect(hit.point, a, ed.symC[a]), P.reflect(view.camera.position, a, ed.symC[a]), a);
    }
    if (!sets.length) return null;
    const touched = new Int32Array(sets.reduce((n, s) => n + s.idx.length, 0));
    let o = 0;
    for (const s of sets) { touched.set(s.idx, o); o += s.idx.length; }
    const normal = view.camera.getWorldDirection(V3()).negate();
    return { start: hit.point.clone(), sets, touched, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, hit.point) };
  }

  function applyGrab(ev) {
    const g = stroke.grab, m = ed.model, pos = m.pos, B = stroke.snap.pos;
    if (!view.rayAt(ev.clientX, ev.clientY).intersectPlane(g.plane, _c)) return false;
    const d = [_c.x - g.start.x, _c.y - g.start.y, _c.z - g.start.z];
    for (const s of g.sets) {
      for (let i = 0; i < s.idx.length; i++) {
        const p = 3 * s.idx[i], k = s.w[i];
        for (let c = 0; c < 3; c++) pos[p + c] = B[p + c] + (c === s.flip ? -d[c] : d[c]) * k;
      }
    }
    m.refreshLocal(g.touched);
    for (const p of g.touched) stroke.touched.add(p);
    stroke.moved = true;
    view.requestDraw();
    return true;
  }

  function onDown(ev) {
    if (ev.button !== 0 || !sculpting()) return;
    const m = ed.model;
    if (!m || !ed.loaded) return;
    if (ed.busy) { ed.ui.toast("Wait for the current job to finish, or press Stop.", 3000); return; }
    if (ed.showingBefore) ed.setBeforeAfter("after");
    const hit = P.hitAt(ev.clientX, ev.clientY);
    if (!hit) return;
    m.ensureGrid(ed.brushRadius());
    // Reading the selection once per stroke, not once per stamp: selectedCount walks every point.
    const lock = m.selectedCount() ? ed.prefs.lock : "off";
    const brush = brushById(ed.prefs.brushId);
    const paints = !!brush.paints;
    stroke = { snap: paints ? null : m.snapshot("pos"), touched: new Set(), moved: false, last: hit.point.clone(), lock, grab: null };
    if (brush.grabs) {
      stroke.grab = buildGrab(hit, lock);
      if (!stroke.grab) { stroke = null; return; }
      lastEv = ev;
      P.capture(ev);
      return;
    }
    lastEv = ev;
    P.capture(ev);
    paint(hit.point, ev.ctrlKey || ev.metaKey);
  }

  function onMove(ev) {
    lastEv = ev;
    if (!queued) { queued = true; raf = requestAnimationFrame(step); }
  }

  function step() {
    queued = false;
    const ev = lastEv, m = ed.model;
    if (!ev || !m || !sculpting()) return;
    if (stroke && !(ev.buttons & 1)) { finish(); return; }
    if (ed.showingBefore || ed.busy || ev.buttons & 6) { P.hideRings(); return; }
    // A Grab drag follows the pointer even once it has left the surface, so it must not need a hit to carry on.
    if (stroke && stroke.grab) { applyGrab(ev); return; }
    const hit = P.hitAt(ev.clientX, ev.clientY);
    if (!hit) { P.hideRings(); return; }
    const r = ed.brushRadius(), invert = ev.ctrlKey || ev.metaKey;
    const brush = brushById(ed.prefs.brushId);
    P.drawRing(ev, hit.point, r, brush.paints ? (invert ? " remove" : " mask") : brush.grabs ? " move" : invert ? " remove" : " sculpt");
    if (!stroke) return;
    if (stroke.grab) { applyGrab(ev); return; }
    // ONE stamp per step of the brush along the path, never one per frame. Without this gate a slow drag, or simply
    // holding still with the button down, lands a stamp on every animation frame and piles them up: reported as
    // "even at 10% it is too strong", which it was, by a factor of however long you lingered.
    const d = stroke.last.distanceTo(hit.point), stepLen = r * SPACING;
    if (d < stepLen) return;
    if (d < r * MAX_BRIDGE) {
      // Stamped along the way, so a fast drag is one stroke and not a row of dabs.
      const n = Math.min(24, Math.ceil(d / stepLen));
      for (let i = 1; i < n; i++) paint(_c.copy(stroke.last).lerp(hit.point, i / n), invert);
    }
    paint(hit.point, invert);
    stroke.last.copy(hit.point);
  }

  function finish() {
    const s = stroke;
    stroke = null;
    if (!s) return;
    if (!s.moved || !s.snap) return; // the Protect brush paints the picked area: nothing to undo
    const brush = brushById(ed.prefs.brushId);
    ed.ops.commit(s.snap, `${brush.label} (${fmtInt(s.touched.size)} points)`, true);
  }

  function onUp() { if (stroke) finish(); }
  function onLeave() { if (!stroke) P.hideRings(); }

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("lostpointercapture", onUp);
  canvas.addEventListener("pointerleave", onLeave);

  return {
    cancel() {
      if (stroke) finish();
      P.hideRings();
    },
    dispose() {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("lostpointercapture", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
    },
  };
}
