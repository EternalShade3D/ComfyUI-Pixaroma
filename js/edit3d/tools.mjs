// Edit 3D Pixaroma - the pointer tools, ported from the idea page (output/claude_output/edit3d_idea/app.mjs): the Select
// and Deselect brushes (a fast stroke is stamped along the way so it stays one stroke), Lasso, Panel, Piece, Move,
// the Sharpen edge panel picks and the Fill hole click. The triangle under the mouse comes from the GPU (one pixel of
// the id picture), the brush visits only the points in the grid cells around it.
import { floodPanel, pointInPolygon } from "./geometry.mjs";
import { fmtInt } from "./core.mjs";

const AXIS = { x: 0, y: 1, z: 2 };

export function installTools(ed) {
  const view = ed.view, THREE = ed.THREE, canvas = view.canvas;
  const V3 = () => new THREE.Vector3();
  const _a = V3(), _b = V3(), _right = V3(), _c = V3(), _pt = V3();
  let painting = false, lastEv = null, queued = false, raf = 0, lastHit = null;
  let lasso = null, lassoRemove = false, grab = null;

  const reflect = (v, a, c) => { const o = v.clone(); o.setComponent(a, 2 * c - o.getComponent(a)); return o; };
  const facing = (m, p, cam) => ed.prefs.through
    || m.ptN[3 * p] * (cam.x - m.pos[3 * p]) + m.ptN[3 * p + 1] * (cam.y - m.pos[3 * p + 1]) + m.ptN[3 * p + 2] * (cam.z - m.pos[3 * p + 2]) > 0;
  const capture = (ev) => { try { canvas.setPointerCapture(ev.pointerId); } catch (_e) { /* a nicety */ } };

  function projector() {
    const cam = view.camera;
    cam.updateMatrixWorld();
    const M = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).elements;
    const r = canvas.getBoundingClientRect();
    return (x, y, z, out) => {
      const w = M[3] * x + M[7] * y + M[11] * z + M[15];
      if (w <= 0) return false;
      out[0] = (((M[0] * x + M[4] * y + M[8] * z + M[12]) / w + 1) / 2) * r.width;
      out[1] = ((1 - (M[1] * x + M[5] * y + M[9] * z + M[13]) / w) / 2) * r.height;
      return true;
    };
  }

  /** The triangle under a screen point and the point on it. */
  function hitAt(clientX, clientY) {
    const m = ed.model;
    if (!m || ed.showingBefore) return null;
    const t = view.pickTriangle(clientX, clientY, m.pickMesh);
    if (t < 0 || t >= m.T || !m.vis[t]) return null;
    const cp = m.cp, pos = m.pos;
    const A = V3().fromArray(pos, 3 * cp[3 * t]), B = V3().fromArray(pos, 3 * cp[3 * t + 1]), C = V3().fromArray(pos, 3 * cp[3 * t + 2]);
    const centroid = V3().add(A).add(B).add(C).multiplyScalar(1 / 3);
    const point = V3();
    const plane = new THREE.Plane().setFromCoplanarPoints(A, B, C);
    if (!view.rayAt(clientX, clientY).intersectPlane(plane, point) || point.distanceTo(centroid) > m.diag * 0.05) point.copy(centroid);
    return { t, poly: m.triPoly[t], point };
  }

  function screenRadius(pt, r) {
    const rect = canvas.getBoundingClientRect(), cam = view.camera;
    cam.updateMatrixWorld();
    _right.setFromMatrixColumn(cam.matrixWorld, 0).normalize().multiplyScalar(r);
    _a.copy(pt).project(cam);
    _b.copy(pt).add(_right).project(cam);
    return Math.max(3, Math.hypot(((_b.x - _a.x) * rect.width) / 2, ((_b.y - _a.y) * rect.height) / 2));
  }

  /** The brush centre, and its mirror image seen by the mirrored camera when Mirror is on. */
  function centres(point) {
    const out = [{ c: point, cam: view.camera.position }];
    const a = AXIS[ed.prefs.mirror];
    if (a !== undefined) out.push({ c: reflect(point, a, ed.mirrorC[a]), cam: reflect(view.camera.position, a, ed.mirrorC[a]) });
    return out;
  }

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
    if (!painting && !grab) view.ring.style.display = "none";
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
    const brushTool = t === "select" || t === "erase" || t === "move";
    if (!brushTool || ed.showingBefore || ed.busy || ev.buttons & 6) { ring.style.display = "none"; return; }
    const hit = hitAt(ev.clientX, ev.clientY);
    if (!hit) { ring.style.display = "none"; lastHit = null; return; }
    const r = ed.brushRadius(), rad = screenRadius(hit.point, r), wr = ed.layout.workspace.getBoundingClientRect();
    ring.style.display = "block";
    ring.style.width = ring.style.height = 2 * rad + "px";
    ring.style.left = ev.clientX - wr.left - rad + "px";
    ring.style.top = ev.clientY - wr.top - rad + "px";
    const remove = t === "erase" || ev.ctrlKey || ev.metaKey;
    ring.className = "pix-e3d-ring" + (t === "move" ? " move" : remove ? " remove" : "");
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
    const { pos, ptVis, sel, P } = m, val = remove ? 0 : 1;
    let n = 0;
    for (let p = 0; p < P; p++) {
      if (sel[p] === val || !ptVis[p] || !facing(m, p, cam)) continue;
      if (!project(pos[3 * p], pos[3 * p + 1], pos[3 * p + 2], s)) continue;
      if (s[0] < x0 || s[0] > x1 || s[1] < y0 || s[1] > y1 || !pointInPolygon(s[0], s[1], poly)) continue;
      sel[p] = val;
      n++;
    }
    ed.recolour();
    ed.ui.refreshInfo();
    if (n) ed.ui.toast(`Lasso: ${fmtInt(n)} points ${remove ? "taken out of" : "added to"} the selection.`, 3500);
  }

  const markFaces = (m, faces, mark) => {
    for (const f of faces) { mark[m.cp[3 * f]] = 1; mark[m.cp[3 * f + 1]] = 1; mark[m.cp[3 * f + 2]] = 1; }
    return mark;
  };

  function pickPanel(hit, add) {
    const m = ed.model;
    const faces = floodPanel(m.cp, m.fnUnit, m.vis, m.adj.pfOff, m.adj.pf, hit.t, ed.opts.flat);
    if (!add) m.sel.fill(0);
    markFaces(m, faces, m.sel);
    ed.recolour();
    ed.ui.refreshInfo();
    ed.ui.toast(`Panel: ${fmtInt(faces.length)} triangles selected. Now try Flatten, Straighten or Smooth on the right.`, 4000);
  }

  function pickPiece(hit, add) {
    const m = ed.model;
    if (m.censusDirty) ed.census();
    const comp = m.faceComp[hit.poly];
    if (comp == null || comp < 0) return;
    if (!add) m.sel.fill(0);
    const { counts, indices, starts, alive, hidden, faceComp, sel } = m;
    let n = 0;
    for (let f = 0; f < m.F; f++) {
      if (!alive[f] || hidden[f] || faceComp[f] !== comp) continue;
      for (let k = 0, s = starts[f]; k < counts[f]; k++) sel[indices[s + k]] = 1;
      n++;
    }
    ed.recolour();
    ed.ui.refreshInfo();
    ed.ui.toast(`Piece: ${fmtInt(n)} faces, one of the ${fmtInt(m.stats.pieces)} separate pieces of this model. Delete removes it, Isolate shows it alone.`, 4500);
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
    const a = AXIS[ed.prefs.mirror];
    // Only when the brush is off the mirror plane, or the two halves would pull the same points twice.
    if (a !== undefined && Math.abs(hit.point.getComponent(a) - ed.mirrorC[a]) > r * 0.5) {
      collect(reflect(hit.point, a, ed.mirrorC[a]), reflect(view.camera.position, a, ed.mirrorC[a]), a);
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
      view.ring.style.display = "none";
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
