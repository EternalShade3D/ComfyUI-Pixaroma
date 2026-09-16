// Edit 3D Pixaroma - the pointer helpers every mode shares: the triangle under the mouse (one pixel of the GPU id
// picture), how wide the brush is on screen, whether a point faces the camera, the symmetry axis and the mirrored
// ring. tools.mjs (Polygons) and sculpt.mjs (Sculpt) both build on these, so the two modes cannot drift apart: a fix
// to picking or to symmetry lands in both at once.
const AXIS = { x: 0, y: 1, z: 2 };

export function createPick(ed) {
  const view = ed.view, THREE = ed.THREE, canvas = view.canvas;
  const V3 = () => new THREE.Vector3();
  const _a = V3(), _b = V3(), _right = V3();

  const reflect = (v, a, c) => { const o = v.clone(); o.setComponent(a, 2 * c - o.getComponent(a)); return o; };
  /** The symmetry axis as an index, or -1 when Symmetry is off. The plane is ed.symC, the model's middle as it opened. */
  const symAxis = () => { const a = AXIS[ed.prefs.symmetry]; return a === undefined ? -1 : a; };
  const hideRings = () => { view.ring.style.display = "none"; view.ring2.style.display = "none"; };
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

  /** The brush centre, and its mirror image seen by the mirrored camera when Symmetry is on. */
  function centres(point) {
    const out = [{ c: point, cam: view.camera.position }];
    const a = symAxis();
    if (a >= 0) out.push({ c: reflect(point, a, ed.symC[a]), cam: reflect(view.camera.position, a, ed.symC[a]) });
    return out;
  }

  /** The ring where the brush ALSO works while Symmetry is on, so it is seen before the press. */
  function drawMirrorRing(point, r, cls, wr) {
    const ring2 = view.ring2, a = symAxis();
    if (a < 0) { ring2.style.display = "none"; return; }
    const q = reflect(point, a, ed.symC[a]);
    const rad = screenRadius(q, r);
    const v = q.clone().project(view.camera);
    if (v.z > 1) { ring2.style.display = "none"; return; }
    const cr = canvas.getBoundingClientRect();
    ring2.style.display = "block";
    ring2.className = cls + " mirror";
    ring2.style.width = ring2.style.height = 2 * rad + "px";
    ring2.style.left = cr.left - wr.left + ((v.x + 1) / 2) * cr.width - rad + "px";
    ring2.style.top = cr.top - wr.top + ((1 - v.y) / 2) * cr.height - rad + "px";
  }

  /** The main ring under the cursor. `cls` is the look: "", " remove", " move" or " sculpt". */
  function drawRing(ev, point, r, cls) {
    const ring = view.ring, wr = ed.layout.workspace.getBoundingClientRect(), rad = screenRadius(point, r);
    ring.style.display = "block";
    ring.style.width = ring.style.height = 2 * rad + "px";
    ring.style.left = ev.clientX - wr.left - rad + "px";
    ring.style.top = ev.clientY - wr.top - rad + "px";
    ring.className = "pix-e3d-ring" + cls;
    drawMirrorRing(point, r, ring.className, wr);
  }

  return { AXIS, reflect, symAxis, hideRings, facing, capture, projector, hitAt, screenRadius, centres, drawMirrorRing, drawRing };
}
