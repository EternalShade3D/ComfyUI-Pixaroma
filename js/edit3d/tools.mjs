// Edit 3D Pixaroma - the pointer tools, ported from the idea page (output/claude_output/edit3d_idea/app.mjs): the Select
// and Deselect brushes (a fast stroke is stamped along the way so it stays one stroke), Lasso, Panel, Piece, Move,
// the Sharpen edge panel picks and the Fill hole click. The triangle under the mouse comes from the GPU (one pixel of
// the id picture), the brush visits only the points in the grid cells around it.
import { floodPanel, pointInPolygon } from "./geometry.mjs";
import { fmtInt } from "./core.mjs";
import { createPick } from "./pick.mjs";

export function installTools(ed) {
  const view = ed.view, THREE = ed.THREE, canvas = view.canvas;
  const V3 = () => new THREE.Vector3();
  const _c = V3(), _pt = V3();
  let painting = false, lastEv = null, queued = false, raf = 0, lastHit = null;
  let lasso = null, lassoRemove = false, grab = null;

  // Picking, symmetry and the rings are shared with Sculpt mode: see pick.mjs.
  const P = createPick(ed);
  const { reflect, symAxis, hideRings, facing, capture, projector, hitAt, screenRadius, centres, drawMirrorRing } = P;

  function brushAt(point, remove) {
    const m = ed.model, r = ed.brushRadius(), val = remove ? 0 : 1, sel = m.sel, vis = m.ptVis;
    let changed = false;
    for (const { c, cam } of centres(point)) {
      m.pointsNear(c.x, c.y, c.z, r, (p) => {
        if (sel[p] === val || !vis[p] || !facing(m, p, cam)) return;
        sel[p] = val;
        changed = true;
      });
    }
    return changed;
  }

  function onDown(ev) {
    if (ev.button !== 0) return;
    const m = ed.model;
    if (!m || !ed.loaded) return;
    if (ed.prefs.mode !== "polys") return; // the tools belong to Polygons mode
    if (ed.busy) { ed.ui.toast("Wait for the current job to finish, or press Stop.", 3000); return; }
    if (ed.showingBefore) ed.setBeforeAfter("after");
    const t = ed.tool;
    lastEv = ev;
    if (t === "select" || t === "erase") {
      painting = true;
      lastHit = null;
      m.ensureGrid(ed.brushRadius());
      capture(ev);
      step();
      return;
    }
    if (t === "lasso") {
      const r = canvas.getBoundingClientRect();
      lasso = [[ev.clientX - r.left, ev.clientY - r.top]];
      lassoRemove = ev.ctrlKey || ev.metaKey;
      capture(ev);
      view.drawLasso(lasso);
      return;
    }
    if (t === "hole") { fillHoleAt(ev); return; }
    const hit = hitAt(ev.clientX, ev.clientY);
    if (!hit) return;
    if (t === "move") {
      m.ensureGrid(ed.brushRadius());
      startGrab(hit);
      if (grab) capture(ev);
    } else if (t === "panel") pickPanel(hit, ev.shiftKey);
    else if (t === "piece") pickPiece(hit, ev.shiftKey);
    else if (t === "edge") pickEdgePanel(hit);
  }

  function onMove(ev) {
    lastEv = ev;
    if (!queued) { queued = true; raf = requestAnimationFrame(step); }
  }

  function onUp(ev) {
    const wasPainting = painting;
    painting = false;
    lastHit = null;
    if (lasso) finishLasso(lassoRemove || !!(ev && (ev.ctrlKey || ev.metaKey)));
    if (grab) endGrab();
    if (wasPainting) ed.ui.refreshInfo();
  }

  function onLeave() {
    if (!painting && !grab) hideRings();
  }

  function step() {
    queued = false;
    const ev = lastEv, m = ed.model;
    if (!ev || !m) return;
    if (painting && !(ev.buttons & 1)) { painting = false; lastHit = null; ed.ui.refreshInfo(); }
    if (lasso) {
      if (!(ev.buttons & 1)) { onUp(ev); return; }
      const r = canvas.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top, last = lasso[lasso.length - 1];
      if (Math.hypot(x - last[0], y - last[1]) >= 2) { lasso.push([x, y]); view.drawLasso(lasso); }
      return;
    }
    if (grab) {
      if (!(ev.buttons & 1)) { endGrab(); return; }
      applyGrab(ev);
      return;
    }
    const t = ed.tool, ring = view.ring;
    const brushTool = ed.prefs.mode === "polys" && (t === "select" || t === "erase" || t === "move");
    if (!brushTool || ed.showingBefore || ed.busy || ev.buttons & 6) { hideRings(); return; }
    const hit = hitAt(ev.clientX, ev.clientY);
    if (!hit) { hideRings(); lastHit = null; return; }
    const r = ed.brushRadius(), rad = screenRadius(hit.point, r), wr = ed.layout.workspace.getBoundingClientRect();
    ring.style.display = "block";
    ring.style.width = ring.style.height = 2 * rad + "px";
    ring.style.left = ev.clientX - wr.left - rad + "px";
    ring.style.top = ev.clientY - wr.top - rad + "px";
    const remove = t === "erase" || ev.ctrlKey || ev.metaKey;
    ring.className = "pix-e3d-ring" + (t === "move" ? " move" : remove ? " remove" : "");
    drawMirrorRing(hit.point, r, ring.className, wr);
    if (!painting) return;
    // A jump longer than 12 brush sizes is a move to another part of the model, not a stroke, so it is not bridged.
    let changed = false;
    if (lastHit) {
      const d = lastHit.distanceTo(hit.point), stepLen = r * 0.5;
      if (d > stepLen && d < r * 12) {
        const n = Math.ceil(d / stepLen);
        for (let i = 1; i < n; i++) changed = brushAt(_c.copy(lastHit).lerp(hit.point, i / n), remove) || changed;
      }
    }
    changed = brushAt(hit.point, remove) || changed;
    lastHit = (lastHit || V3()).copy(hit.point);
    if (changed) ed.recolour();
  }

  function finishLasso(remove) {
    const poly = lasso;
    lasso = null;
    view.drawLasso(null);
    const m = ed.model;
    if (!m || !poly || poly.length < 3) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const project = projector(), s = [0, 0], cam = view.camera.position;
    const a = symAxis(), c = a >= 0 ? ed.symC[a] : 0, camM = a >= 0 ? reflect(cam, a, c) : null;
    const { pos, ptVis, sel, P } = m, val = remove ? 0 : 1;
    const inLoop = (x, y, z) => project(x, y, z, s) && s[0] >= x0 && s[0] <= x1 && s[1] >= y0 && s[1] <= y1 && pointInPolygon(s[0], s[1], poly);
    let n = 0, mirrored = 0;
    for (let p = 0; p < P; p++) {
      if (sel[p] === val || !ptVis[p]) continue;
      const x = pos[3 * p], y = pos[3 * p + 1], z = pos[3 * p + 2];
      let take = facing(m, p, cam) && inLoop(x, y, z);
      // Symmetry: a point whose mirror image falls inside the loop is taken too, seen from the mirrored camera.
      if (!take && camM && facing(m, p, camM)) {
        take = a === 0 ? inLoop(2 * c - x, y, z) : a === 1 ? inLoop(x, 2 * c - y, z) : inLoop(x, y, 2 * c - z);
        if (take) mirrored++;
      }
      if (!take) continue;
      sel[p] = val;
      n++;
    }
    ed.recolour();
    ed.ui.refreshInfo();
    if (n) ed.ui.toast(`Lasso: ${fmtInt(n)} points ${remove ? "taken out of" : "added to"} the selection${mirrored ? `, ${fmtInt(mirrored)} of them on the other side` : ""}.`, 3500);
  }

  const markFaces = (m, faces, mark) => {
    for (const f of faces) { mark[m.cp[3 * f]] = 1; mark[m.cp[3 * f + 1]] = 1; mark[m.cp[3 * f + 2]] = 1; }
    return mark;
  };

  /**
   * The face on the other side of the symmetry plane: the visible triangle nearest the mirrored point that faces the
   * mirrored way. -> a triangle index, or -1 when Symmetry is off, the click sits on the plane, or nothing matches.
   */
  function mirrorFace(hit) {
    const a = symAxis();
    if (a < 0) return -1;
    const m = ed.model, c = ed.symC[a];
    if (Math.abs(hit.point.getComponent(a) - c) < m.diag * 0.004) return -1; // a click on the plane has no other side
    const q = reflect(hit.point, a, c);
    const want = [m.fnUnit[3 * hit.t], m.fnUnit[3 * hit.t + 1], m.fnUnit[3 * hit.t + 2]];
    want[a] = -want[a];
    const { pfOff, pf } = m.adj, fn = m.fnUnit;
    // Close by and facing the same way first; then further out and any direction, for a model that is not exact.
    for (const [reach, minDot] of [[0.02, 0.2], [0.06, -0.2]]) {
      const r = m.diag * reach;
      m.ensureGrid(r);
      let best = -1, bestScore = Infinity;
      m.pointsNear(q.x, q.y, q.z, r, (p, d2) => {
        const d = Math.sqrt(d2) / r;
        for (let j = pfOff[p], e = pfOff[p + 1]; j < e; j++) {
          const t = pf[j];
          if (!m.vis[t] || t === hit.t) continue;
          const dot = want[0] * fn[3 * t] + want[1] * fn[3 * t + 1] + want[2] * fn[3 * t + 2];
          if (dot < minDot) continue;
          const score = d + (1 - dot);
          if (score < bestScore) { bestScore = score; best = t; }
        }
      });
      if (best >= 0) return best;
    }
    return -1;
  }

  function pickPanel(hit, add) {
    const m = ed.model;
    const panelAt = (t) => floodPanel(m.cp, m.fnUnit, m.vis, m.adj.pfOff, m.adj.pf, t, ed.opts.flat);
    const faces = panelAt(hit.t);
    if (!add) m.sel.fill(0);
    markFaces(m, faces, m.sel);
    const t2 = mirrorFace(hit);
    const other = t2 >= 0 ? panelAt(t2) : null;
    if (other) markFaces(m, other, m.sel);
    ed.recolour();
    ed.ui.refreshInfo();
    const n = faces.length + (other ? other.length : 0);
    ed.ui.toast(`Panel: ${fmtInt(n)} triangles selected${other ? ", on both sides" : ""}. Now try Flatten, Straighten or Smooth on the right.`, 4000);
  }

  function pickPiece(hit, add) {
    const m = ed.model;
    if (m.censusDirty) ed.census();
    const want = new Set();
    const addComp = (poly) => { const c = m.faceComp[poly]; if (c != null && c >= 0) want.add(c); };
    addComp(hit.poly);
    const t2 = mirrorFace(hit);
    if (t2 >= 0) addComp(m.triPoly[t2]);
    if (!want.size) return;
    if (!add) m.sel.fill(0);
    const { counts, indices, starts, alive, hidden, faceComp, sel } = m;
    let n = 0;
    for (let f = 0; f < m.F; f++) {
      if (!alive[f] || hidden[f] || !want.has(faceComp[f])) continue;
      for (let k = 0, s = starts[f]; k < counts[f]; k++) sel[indices[s + k]] = 1;
      n++;
    }
    ed.recolour();
    ed.ui.refreshInfo();
    ed.ui.toast(`Piece: ${fmtInt(n)} faces${want.size > 1 ? " in two pieces" : ""}, of the ${fmtInt(m.stats.pieces)} separate pieces of this model. Delete removes them, Isolate shows them alone.`, 4500);
  }

  function pickEdgePanel(hit) {
    const m = ed.model;
    const faces = floodPanel(m.cp, m.fnUnit, m.vis, m.adj.pfOff, m.adj.pf, hit.t, ed.opts.flat);
    const mark = markFaces(m, faces, new Uint8Array(m.P));
    if (!m.panelA || m.panelB) { m.panelA = mark; m.panelAFaces = faces; m.panelB = null; m.panelBFaces = null; } else { m.panelB = mark; m.panelBFaces = faces; }
    ed.recolour();
    ed.ui.renderOptions();
    ed.ui.toast(m.panelB ? "Panel B picked. Press Sharpen edges on the right." : "Panel A picked. Now click the panel next to it.", 4000);
  }

  /** The Fill hole click: the open edge nearest the click on screen (within 28 px) picks the hole. */
  function fillHoleAt(ev) {
    const m = ed.model;
    if (m.censusDirty) ed.census();
    const list = m.openEdges;
    if (!list || !list.length) { ed.ui.toast("This model has no holes to fill.", 3000); return; }
    const rect = canvas.getBoundingClientRect(), px = ev.clientX - rect.left, py = ev.clientY - rect.top;
    const project = projector(), s = [0, 0], pos = m.pos;
    let best = -1, bestD = 28 * 28;
    for (let i = 0; i < list.length; i += 2) {
      const a = 3 * list[i], b = 3 * list[i + 1];
      if (!project((pos[a] + pos[b]) / 2, (pos[a + 1] + pos[b + 1]) / 2, (pos[a + 2] + pos[b + 2]) / 2, s)) continue;
      const d = (s[0] - px) ** 2 + (s[1] - py) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) { ed.ui.toast("Click closer to a hole: the red dots mark the open edges.", 3500); return; }
    ed.ops.fillLoopAt(list[best], list[best + 1]);
  }

  // ── Move ──
  function startGrab(hit) {
    const m = ed.model, r = ed.brushRadius(), r2 = r * r, sets = [];
    const collect = (c, cam, flip) => {
      const idx = [], w = [];
      m.pointsNear(c.x, c.y, c.z, r, (p, d2) => {
        if (!m.ptVis[p] || !facing(m, p, cam)) return;
        const k = 1 - d2 / r2;
        idx.push(p);
        w.push(k * k);
      });
      if (idx.length) sets.push({ idx: Int32Array.from(idx), w: Float32Array.from(w), flip });
    };
    collect(hit.point, view.camera.position, -1);
    const a = symAxis();
    // Only when the brush is off the symmetry plane, or the two halves would pull the same points twice.
    if (a >= 0 && Math.abs(hit.point.getComponent(a) - ed.symC[a]) > r * 0.5) {
      collect(reflect(hit.point, a, ed.symC[a]), reflect(view.camera.position, a, ed.symC[a]), a);
    }
    if (!sets.length) return;
    const touched = new Int32Array(sets.reduce((n, s) => n + s.idx.length, 0));
    let o = 0;
    for (const s of sets) { touched.set(s.idx, o); o += s.idx.length; }
    const normal = view.camera.getWorldDirection(V3()).negate();
    grab = {
      start: hit.point.clone(), snap: m.snapshot("pos"), sets, touched, moved: false,
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, hit.point),
    };
  }

  function applyGrab(ev) {
    if (!view.rayAt(ev.clientX, ev.clientY).intersectPlane(grab.plane, _pt)) return;
    const d = [_pt.x - grab.start.x, _pt.y - grab.start.y, _pt.z - grab.start.z];
    const m = ed.model, pos = m.pos, B = grab.snap.pos;
    for (const s of grab.sets) {
      for (let i = 0; i < s.idx.length; i++) {
        const p = 3 * s.idx[i], k = s.w[i];
        for (let c = 0; c < 3; c++) pos[p + c] = B[p + c] + (c === s.flip ? -d[c] : d[c]) * k;
      }
    }
    grab.moved = true;
    m.writePositionsAround(grab.touched);
    view.requestDraw();
  }

  function endGrab() {
    const g = grab;
    grab = null;
    if (!g || !g.moved) return;
    ed.ops.commit(g.snap, `Move (${fmtInt(g.touched.length)} points)`);
  }

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("lostpointercapture", onUp);
  canvas.addEventListener("pointerleave", onLeave);

  return {
    cancel() {
      painting = false;
      lastHit = null;
      if (lasso) { lasso = null; view.drawLasso(null); }
      if (grab) endGrab();
      hideRings();
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
