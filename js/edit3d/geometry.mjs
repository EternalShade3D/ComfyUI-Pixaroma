// Edit 3D Pixaroma - the geometry maths, pure (no three, no DOM). Ported from output/claude_output/edit3d_idea/app.mjs,
// where every function was tested on the Ep34 gun. Positions are Float32Array(3P); triangle corners `cp` are Int32Array(3T)
// over the WELDED points; `alive`/`vis` are Uint8Array per triangle; `sel` and marks are Uint8Array(P).
export const _testHooks = { flatWeights: true, dominantRounds: 3 };
export const COS_CREASE = Math.cos((30 * Math.PI) / 180);
export const COS35 = Math.cos((35 * Math.PI) / 180);
export const COS15 = Math.cos((15 * Math.PI) / 180);

/** point -> triangles (pfOff/pf) and point -> neighbour points (nbOff/nb, a shared neighbour listed twice). */
export function buildAdjacency(P, cp) {
  const T = cp.length / 3;
  const pfOff = new Int32Array(P + 1);
  for (let c = 0; c < cp.length; c++) pfOff[cp[c] + 1]++;
  for (let p = 0; p < P; p++) pfOff[p + 1] += pfOff[p];
  const pf = new Int32Array(cp.length);
  {
    const at = pfOff.slice(0, P);
    for (let c = 0; c < cp.length; c++) pf[at[cp[c]]++] = (c / 3) | 0;
  }
  const nbOff = new Int32Array(P + 1);
  for (let c = 0; c < cp.length; c++) nbOff[cp[c] + 1] += 2;
  for (let p = 0; p < P; p++) nbOff[p + 1] += nbOff[p];
  const nb = new Int32Array(T * 6);
  {
    const at = nbOff.slice(0, P);
    for (let f = 0; f < T; f++) {
      const a = cp[3 * f], b = cp[3 * f + 1], d = cp[3 * f + 2];
      nb[at[a]++] = b; nb[at[a]++] = d; nb[at[b]++] = a; nb[at[b]++] = d; nb[at[d]++] = a; nb[at[d]++] = b;
    }
  }
  return { pfOff, pf, nbOff, nb };
}

/** Raw (area-weighted) and unit triangle normals; a dead triangle gets zero. */
export function faceNormals(pos, cp, alive, raw = null, unit = null) {
  const T = cp.length / 3;
  raw = raw || new Float32Array(T * 3);
  unit = unit || new Float32Array(T * 3);
  for (let f = 0; f < T; f++) {
    const a = 3 * cp[3 * f], b = 3 * cp[3 * f + 1], c = 3 * cp[3 * f + 2];
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (!alive[f]) nx = ny = nz = 0;
    raw[3 * f] = nx; raw[3 * f + 1] = ny; raw[3 * f + 2] = nz;
    const l = Math.hypot(nx, ny, nz) || 1;
    unit[3 * f] = nx / l; unit[3 * f + 1] = ny / l; unit[3 * f + 2] = nz / l;
  }
  return { raw, unit };
}

export function pointNormals(P, cp, alive, raw, out = null) {
  out = out || new Float32Array(P * 3);
  out.fill(0);
  for (let f = 0; f < cp.length / 3; f++) {
    if (!alive[f]) continue;
    for (let k = 0; k < 3; k++) {
      const p = 3 * cp[3 * f + k];
      out[p] += raw[3 * f]; out[p + 1] += raw[3 * f + 1]; out[p + 2] += raw[3 * f + 2];
    }
  }
  for (let p = 0; p < P; p++) {
    const l = Math.hypot(out[3 * p], out[3 * p + 1], out[3 * p + 2]) || 1;
    out[3 * p] /= l; out[3 * p + 1] /= l; out[3 * p + 2] /= l;
  }
  return out;
}

/** Per-corner normals for drawing: a corner averages the triangles around its point within 30 degrees of its own
 *  (smooth with crisp creases, the way Blender's Shade Auto Smooth draws). */
export function creasedCornerNormals(cp, alive, raw, unit, pfOff, pf, out) {
  const T = cp.length / 3;
  for (let f = 0; f < T; f++) {
    const ux = unit[3 * f], uy = unit[3 * f + 1], uz = unit[3 * f + 2];
    for (let k = 0; k < 3; k++) {
      const p = cp[3 * f + k];
      let sx = 0, sy = 0, sz = 0;
      for (let j = pfOff[p], e = pfOff[p + 1]; j < e; j++) {
        const g = pf[j];
        if (!alive[g]) continue;
        if (ux * unit[3 * g] + uy * unit[3 * g + 1] + uz * unit[3 * g + 2] >= COS_CREASE) { sx += raw[3 * g]; sy += raw[3 * g + 1]; sz += raw[3 * g + 2]; }
      }
      const l = Math.hypot(sx, sy, sz), o = 9 * f + 3 * k;
      if (l < 1e-20) { out[o] = ux; out[o + 1] = uy; out[o + 2] = uz; } else { out[o] = sx / l; out[o + 1] = sy / l; out[o + 2] = sz / l; }
    }
  }
  return out;
}

/** Graph distance in rings from the marked points, up to `limit`; -1 beyond. */
export function ringsFrom(P, mark, nbOff, nb, limit) {
  const d = new Int16Array(P).fill(-1);
  let front = [];
  for (let p = 0; p < P; p++) if (mark[p]) { d[p] = 0; front.push(p); }
  for (let r = 1; r <= limit && front.length; r++) {
    const next = [];
    for (const p of front) {
      for (let j = nbOff[p], e = nbOff[p + 1]; j < e; j++) { const q = nb[j]; if (d[q] < 0) { d[q] = r; next.push(q); } }
    }
    front = next;
  }
  return d;
}

/** 0.3 on the mark's border row, 0.65 on the next, 1 further in: an edit fades out at its edge. */
export function weightsInside(P, mark, nbOff, nb) {
  const w = new Float32Array(P);
  if (!_testHooks.flatWeights) { for (let p = 0; p < P; p++) if (mark[p]) w[p] = 1; return w; }
  const d = new Int8Array(P).fill(-1);
  let front = [];
  for (let p = 0; p < P; p++) {
    if (!mark[p]) continue;
    for (let j = nbOff[p], e = nbOff[p + 1]; j < e; j++) if (!mark[nb[j]]) { d[p] = 1; front.push(p); break; }
  }
  for (let r = 2; r <= 3 && front.length; r++) {
    const next = [];
    for (const p of front) {
      for (let j = nbOff[p], e = nbOff[p + 1]; j < e; j++) { const q = nb[j]; if (mark[q] && d[q] < 0) { d[q] = r; next.push(q); } }
    }
    front = next;
  }
  for (let p = 0; p < P; p++) if (mark[p]) w[p] = d[p] === 1 ? 0.3 : d[p] === 2 ? 0.65 : 1;
  return w;
}

/** Connected groups of selected, visible points (a mirrored selection is two groups). */
export function selectedPointGroups(P, sel, vis, nbOff, nb) {
  const seen = new Uint8Array(P), groups = [];
  for (let p0 = 0; p0 < P; p0++) {
    if (!sel[p0] || !vis[p0] || seen[p0]) continue;
    const pts = [], stack = [p0];
    seen[p0] = 1;
    while (stack.length) {
      const p = stack.pop();
      pts.push(p);
      for (let j = nbOff[p], e = nbOff[p + 1]; j < e; j++) { const q = nb[j]; if (sel[q] && vis[q] && !seen[q]) { seen[q] = 1; stack.push(q); } }
    }
    if (pts.length >= 3) groups.push(pts);
  }
  return groups;
}

/** The flat area inside a selection: the direction most points face, refined so a selection running over an edge
 *  settles on the bigger panel (a lasso across several panels flattened them all into spikes before this). */
export function dominantPanel(pos, ptN, pts) {
  let nx = 0, ny = 0, nz = 0;
  for (const p of pts) { nx += ptN[3 * p]; ny += ptN[3 * p + 1]; nz += ptN[3 * p + 2]; }
  let panel = pts;
  for (let round = 0; round < _testHooks.dominantRounds; round++) {
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    panel = pts.filter((p) => ptN[3 * p] * nx + ptN[3 * p + 1] * ny + ptN[3 * p + 2] * nz >= COS35);
    if (!panel.length) return null;
    let sx = 0, sy = 0, sz = 0;
    for (const p of panel) { sx += ptN[3 * p]; sy += ptN[3 * p + 1]; sz += ptN[3 * p + 2]; }
    nx = sx; ny = sy; nz = sz;
  }
  const l = Math.hypot(nx, ny, nz) || 1;
  let cx = 0, cy = 0, cz = 0;
  for (const p of panel) { cx += pos[3 * p]; cy += pos[3 * p + 1]; cz += pos[3 * p + 2]; }
  const n = panel.length;
  return { pts: panel, pl: { nx: nx / l, ny: ny / l, nz: nz / l, cx: cx / n, cy: cy / n, cz: cz / n } };
}

export const distTo = (pos, p, pl) => (pos[3 * p] - pl.cx) * pl.nx + (pos[3 * p + 1] - pl.cy) * pl.ny + (pos[3 * p + 2] - pl.cz) * pl.nz;

export function moveOnto(pos, p, pl, k = 1) {
  const d = distTo(pos, p, pl) * k;
  pos[3 * p] -= pl.nx * d; pos[3 * p + 1] -= pl.ny * d; pos[3 * p + 2] -= pl.nz * d;
}

/** Flatten (or Straighten with snapToAxis) every group of the selection onto its dominant panel's plane.
 *  -> {moved, left, skipped, groups, touched: Int32Array of the points moved} */
export function flattenSelection(pos, ptN, sel, vis, adj, opts) {
  const P = sel.length, groups = selectedPointGroups(P, sel, vis, adj.nbOff, adj.nb);
  const k = opts.snapToAxis ? 1 : opts.strength;
  let moved = 0, left = 0, skipped = 0;
  const touched = [];
  for (const pts of groups) {
    const dom = dominantPanel(pos, ptN, pts);
    if (!dom) continue;
    const { pl } = dom;
    if (opts.snapToAxis) {
      const n = [pl.nx, pl.ny, pl.nz], ax = n.map(Math.abs), i = ax.indexOf(Math.max(...ax));
      if (ax[i] < COS15) { skipped++; continue; }
      const s = [0, 0, 0];
      s[i] = n[i] < 0 ? -1 : 1;
      pl.nx = s[0]; pl.ny = s[1]; pl.nz = s[2];
    }
    const mark = new Uint8Array(P);
    for (const p of dom.pts) mark[p] = 1;
    const w = weightsInside(P, mark, adj.nbOff, adj.nb);
    for (const p of dom.pts) { moveOnto(pos, p, pl, k * w[p]); moved++; touched.push(p); }
    left += pts.length - dom.pts.length;
  }
  return { moved, left, skipped, groups: groups.length, touched: Int32Array.from(touched) };
}

/** Taubin smoothing of the selected visible points (a smoothing step then an inflating one, so nothing shrinks).
 *  -> the points moved */
export function smoothSelection(pos, sel, vis, adj, opts) {
  const P = sel.length, list = [];
  for (let p = 0; p < P; p++) if (sel[p] && vis[p]) list.push(p);
  if (!list.length) return 0;
  const w = weightsInside(P, sel, adj.nbOff, adj.nb), iters = Math.round(2 + 12 * opts.strength), tmp = new Float32Array(list.length * 3);
  const { nbOff, nb } = adj;
  for (let it = 0; it < iters; it++) {
    for (const lam of [0.55, -0.58]) {
      for (let i = 0; i < list.length; i++) {
        const p = list[i], s = nbOff[p], e = nbOff[p + 1], c = e - s || 1;
        let sx = 0, sy = 0, sz = 0;
        for (let j = s; j < e; j++) { const q = 3 * nb[j]; sx += pos[q]; sy += pos[q + 1]; sz += pos[q + 2]; }
        const f = lam * w[p];
        tmp[3 * i] = pos[3 * p] + f * (sx / c - pos[3 * p]);
        tmp[3 * i + 1] = pos[3 * p + 1] + f * (sy / c - pos[3 * p + 1]);
        tmp[3 * i + 2] = pos[3 * p + 2] + f * (sz / c - pos[3 * p + 2]);
      }
      for (let i = 0; i < list.length; i++) { const p = 3 * list[i]; pos[p] = tmp[3 * i]; pos[p + 1] = tmp[3 * i + 1]; pos[p + 2] = tmp[3 * i + 2]; }
    }
  }
  return list.length;
}

function planeOf(pos, raw, faces, mark) {
  let nx = 0, ny = 0, nz = 0;
  for (const f of faces) { nx += raw[3 * f]; ny += raw[3 * f + 1]; nz += raw[3 * f + 2]; }
  const l = Math.hypot(nx, ny, nz) || 1;
  let cx = 0, cy = 0, cz = 0, n = 0;
  for (let p = 0; p < mark.length; p++) if (mark[p]) { cx += pos[3 * p]; cy += pos[3 * p + 1]; cz += pos[3 * p + 2]; n++; }
  n = n || 1;
  return { nx: nx / l, ny: ny / l, nz: nz / l, cx: cx / n, cy: cy / n, cz: cz / n };
}

/**
 * Sharpen the edge between panel A and panel B: the rounded strip between them closes onto the line where the two
 * planes meet (only points whose surface faces BETWEEN the panels and lie within lineReach of the line), then both
 * panels are flattened, full strength beside the strip and fading over three rows elsewhere.
 * -> { squeezed, flattened } or { error: "same" } when the two panels face the same way
 */
export function sharpenEdge(pos, ptN, raw, panelA, facesA, panelB, facesB, adj, opts) {
  const P = panelA.length, A = planeOf(pos, raw, facesA, panelA), B = planeOf(pos, raw, facesB, panelB);
  const cosAB = A.nx * B.nx + A.ny * B.ny + A.nz * B.nz;
  if (Math.abs(cosAB) > 0.97) return { error: "same" };
  let lx = A.ny * B.nz - A.nz * B.ny, ly = A.nz * B.nx - A.nx * B.nz, lz = A.nx * B.ny - A.ny * B.nx;
  const ll = Math.hypot(lx, ly, lz);
  lx /= ll; ly /= ll; lz /= ll;
  const hA = A.nx * A.cx + A.ny * A.cy + A.nz * A.cz, hB = B.nx * B.cx + B.ny * B.cy + B.nz * B.cz;
  const den = 1 - cosAB * cosAB, ka = (hA - hB * cosAB) / den, kb = (hB - hA * cosAB) / den;
  const ox = ka * A.nx + kb * B.nx, oy = ka * A.ny + kb * B.ny, oz = ka * A.nz + kb * B.nz;
  const dA = ringsFrom(P, panelA, adj.nbOff, adj.nb, 12), dB = ringsFrom(P, panelB, adj.nbOff, adj.nb, 12);
  const strip = new Uint8Array(P);
  let squeezed = 0, flattened = 0;
  for (let p = 0; p < P; p++) {
    if (panelA[p] || panelB[p] || dA[p] < 0 || dB[p] < 0) continue;
    const nx = ptN[3 * p], ny = ptN[3 * p + 1], nz = ptN[3 * p + 2];
    if (nx * A.nx + ny * A.ny + nz * A.nz < 0.2 || nx * B.nx + ny * B.ny + nz * B.nz < 0.2) continue;
    if (Math.abs(nx * lx + ny * ly + nz * lz) > 0.35) continue;
    const t = (pos[3 * p] - ox) * lx + (pos[3 * p + 1] - oy) * ly + (pos[3 * p + 2] - oz) * lz;
    const qx = ox + lx * t, qy = oy + ly * t, qz = oz + lz * t;
    if (Math.hypot(pos[3 * p] - qx, pos[3 * p + 1] - qy, pos[3 * p + 2] - qz) > opts.lineReach) continue;
    pos[3 * p] = qx; pos[3 * p + 1] = qy; pos[3 * p + 2] = qz;
    strip[p] = 1;
    squeezed++;
  }
  const mA = panelA.slice(), mB = panelB.slice();
  for (let p = 0; p < P; p++) if (strip[p]) { mA[p] = 1; mB[p] = 1; }
  const wA = weightsInside(P, mA, adj.nbOff, adj.nb), wB = weightsInside(P, mB, adj.nbOff, adj.nb);
  for (let p = 0; p < P; p++) {
    if (panelA[p]) { moveOnto(pos, p, A, wA[p]); flattened++; } else if (panelB[p]) { moveOnto(pos, p, B, wB[p]); flattened++; }
  }
  return { squeezed, flattened };
}

/** The triangles of a flat panel around triangle f0: a flood over visible triangles whose normal is within `flatDeg` of f0's. */
export function floodPanel(cp, unit, vis, pfOff, pf, f0, flatDeg) {
  const cosT = Math.cos((flatDeg * Math.PI) / 180), T = cp.length / 3;
  const nx = unit[3 * f0], ny = unit[3 * f0 + 1], nz = unit[3 * f0 + 2];
  const seen = new Uint8Array(T), stack = [f0], faces = [];
  seen[f0] = 1;
  while (stack.length) {
    const f = stack.pop();
    faces.push(f);
    for (let k = 0; k < 3; k++) {
      const p = cp[3 * f + k];
      for (let j = pfOff[p], e = pfOff[p + 1]; j < e; j++) {
        const g = pf[j];
        if (seen[g] || !vis[g]) continue;
        seen[g] = 1;
        if (nx * unit[3 * g] + ny * unit[3 * g + 1] + nz * unit[3 * g + 2] >= cosT) stack.push(g);
      }
    }
  }
  return faces;
}

export function pointInPolygon(x, y, poly) {
  let inn = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inn = !inn;
  }
  return inn;
}
