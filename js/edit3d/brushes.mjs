// Edit 3D Pixaroma - the sculpting brushes, pure: no three.js, no DOM, no editor. Each one takes the points under
// the brush and moves them, and each one pulls the surface towards something that is already right (the neighbours,
// a flat plane, a picked plane). That is what makes them REPAIR tools rather than free-form clay: nothing here
// invents shape out of nothing.
//
// ctx = {
//   pos:  Float32Array(3P), moved in place
//   ptN:  Float32Array(3P), point normals (stale by at most one stamp, which is fine at these sizes)
//   fnUnit: Float32Array(3T), unit face normals, used to find the creases Smooth must not melt
//   adj:  { nbOff, nb, pfOff, pf } from buildAdjacency
//   idx:  Int32Array, the points under the brush
//   w:    Float32Array, the falloff weight of each, 0 at the rim and 1 in the middle
//   k:    strength 0..1
//   invert: true while Ctrl is held
//   cx, cy, cz: the brush centre;  radius: its reach
//   plane: an optional {nx, ny, nz, cx, cy, cz} picked by the user, which beats the plane under the brush
//   scratch(n): a reusable Float32Array of at least n, so a stroke allocates nothing
// }
// Every brush returns how many points it moved.

// A neighbour whose surface faces more than this away is across a CREASE and is not averaged in. Without it one
// careless Smooth stroke rounds off the very edges a hard-surface model is being repaired to keep.
export const COS_KEEP = Math.cos((40 * Math.PI) / 180);
// Sharper than that, and the point is standing ON a crease. Filtering its neighbours is NOT enough for those: a
// ridge point's own normal is the average of both slopes, so every slope neighbour looks near enough to average in
// and the ridge floats up. Measured on a 62 degree roof: 20 Smooth passes lifted the ridge 0.138 before this.
// Such a point may only slide ALONG the crease, never off it. The two angles are deliberately different: 40 decides
// what to average, 55 decides what to protect, so ordinary lumpy noise is still smoothed away.
export const COS_RIDGE = Math.cos((55 * Math.PI) / 180);

/** The plane the brush works against: the one the user picked, else the weighted average under the brush. */
export function brushPlane(ctx) {
  if (ctx.plane) return ctx.plane;
  const { pos, ptN, idx, w } = ctx;
  let cx = 0, cy = 0, cz = 0, nx = 0, ny = 0, nz = 0, sw = 0;
  for (let i = 0; i < idx.length; i++) {
    const p = idx[i], ww = w[i];
    cx += ww * pos[3 * p]; cy += ww * pos[3 * p + 1]; cz += ww * pos[3 * p + 2];
    nx += ww * ptN[3 * p]; ny += ww * ptN[3 * p + 1]; nz += ww * ptN[3 * p + 2];
    sw += ww;
  }
  if (sw <= 1e-20) return null;
  const l = Math.hypot(nx, ny, nz);
  if (l < 1e-20) return null;
  return { cx: cx / sw, cy: cy / sw, cz: cz / sw, nx: nx / l, ny: ny / l, nz: nz / l };
}

/** The average of a point's neighbours, creases left out. -> true when it found any. */
function creasedAverage(pos, ptN, nbOff, nb, p, out) {
  const nx = ptN[3 * p], ny = ptN[3 * p + 1], nz = ptN[3 * p + 2];
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (let j = nbOff[p], e = nbOff[p + 1]; j < e; j++) {
    const q = nb[j];
    if (ptN[3 * q] * nx + ptN[3 * q + 1] * ny + ptN[3 * q + 2] * nz < COS_KEEP) continue;
    sx += pos[3 * q]; sy += pos[3 * q + 1]; sz += pos[3 * q + 2];
    n++;
  }
  if (!n) return false;
  out[0] = sx / n; out[1] = sy / n; out[2] = sz / n;
  return true;
}

const _avg = [0, 0, 0];
const _dir = [0, 0, 0];

/**
 * Is p standing on a crease, and which way does the crease run? Takes the face normal furthest from the point's own,
 * then the one furthest from THAT: if those two disagree by more than COS_RIDGE the point sits on an edge between two
 * surfaces, and the crease runs along their cross product. -> true, with the unit direction in `out`.
 */
function creaseDir(ctx, p, out) {
  const { fnUnit, ptN } = ctx;
  const { pfOff, pf } = ctx.adj;
  if (!fnUnit || !pfOff) return false;
  const nx = ptN[3 * p], ny = ptN[3 * p + 1], nz = ptN[3 * p + 2];
  let a = -1, aDot = 2;
  for (let j = pfOff[p], e = pfOff[p + 1]; j < e; j++) {
    const t = pf[j], d = fnUnit[3 * t] * nx + fnUnit[3 * t + 1] * ny + fnUnit[3 * t + 2] * nz;
    if (d < aDot) { aDot = d; a = t; }
  }
  if (a < 0) return false;
  const ax = fnUnit[3 * a], ay = fnUnit[3 * a + 1], az = fnUnit[3 * a + 2];
  let b = -1, bDot = 2;
  for (let j = pfOff[p], e = pfOff[p + 1]; j < e; j++) {
    const t = pf[j], d = fnUnit[3 * t] * ax + fnUnit[3 * t + 1] * ay + fnUnit[3 * t + 2] * az;
    if (d < bDot) { bDot = d; b = t; }
  }
  if (b < 0 || bDot >= COS_RIDGE) return false; // every face around it agrees: ordinary surface, smooth it freely
  const bx = fnUnit[3 * b], by = fnUnit[3 * b + 1], bz = fnUnit[3 * b + 2];
  const dx = ay * bz - az * by, dy = az * bx - ax * bz, dz = ax * by - ay * bx;
  const l = Math.hypot(dx, dy, dz);
  if (l < 1e-9) return false;
  out[0] = dx / l; out[1] = dy / l; out[2] = dz / l;
  return true;
}

/** Smooth: towards the average of the neighbours, creases kept. Ctrl sharpens instead (away from the average). */
export function brushSmooth(ctx) {
  const { pos, ptN, idx, w, k, invert } = ctx;
  const { nbOff, nb } = ctx.adj;
  const t = ctx.scratch(3 * idx.length);
  let moved = 0;
  for (let i = 0; i < idx.length; i++) {
    const p = idx[i];
    const px = pos[3 * p], py = pos[3 * p + 1], pz = pos[3 * p + 2];
    t[3 * i] = px; t[3 * i + 1] = py; t[3 * i + 2] = pz;
    if (!creasedAverage(pos, ptN, nbOff, nb, p, _avg)) continue;
    const f = k * w[i] * (invert ? -0.5 : 1); // sharpening is halved: it runs away fast
    let dx = _avg[0] - px, dy = _avg[1] - py, dz = _avg[2] - pz;
    // A point standing on a crease may only slide along it, or the edge melts away.
    if (creaseDir(ctx, p, _dir)) {
      const along = dx * _dir[0] + dy * _dir[1] + dz * _dir[2];
      dx = _dir[0] * along; dy = _dir[1] * along; dz = _dir[2] * along;
    }
    t[3 * i] = px + f * dx;
    t[3 * i + 1] = py + f * dy;
    t[3 * i + 2] = pz + f * dz;
    moved++;
  }
  for (let i = 0; i < idx.length; i++) {
    const p = idx[i];
    pos[3 * p] = t[3 * i]; pos[3 * p + 1] = t[3 * i + 1]; pos[3 * p + 2] = t[3 * i + 2];
  }
  return moved;
}

/** Even out: the same average, but SIDEWAYS only, so the spacing evens while the shape stays where it is. */
export function brushEven(ctx) {
  const { pos, ptN, idx, w, k } = ctx;
  const { nbOff, nb } = ctx.adj;
  const t = ctx.scratch(3 * idx.length);
  let moved = 0;
  for (let i = 0; i < idx.length; i++) {
    const p = idx[i];
    const px = pos[3 * p], py = pos[3 * p + 1], pz = pos[3 * p + 2];
    t[3 * i] = px; t[3 * i + 1] = py; t[3 * i + 2] = pz;
    if (!creasedAverage(pos, ptN, nbOff, nb, p, _avg)) continue;
    let dx = _avg[0] - px, dy = _avg[1] - py, dz = _avg[2] - pz;
    const nx = ptN[3 * p], ny = ptN[3 * p + 1], nz = ptN[3 * p + 2];
    const dn = dx * nx + dy * ny + dz * nz;
    dx -= dn * nx; dy -= dn * ny; dz -= dn * nz; // drop the part that would change the shape
    const f = k * w[i];
    t[3 * i] = px + f * dx; t[3 * i + 1] = py + f * dy; t[3 * i + 2] = pz + f * dz;
    moved++;
  }
  for (let i = 0; i < idx.length; i++) {
    const p = idx[i];
    pos[3 * p] = t[3 * i]; pos[3 * p + 1] = t[3 * i + 1]; pos[3 * p + 2] = t[3 * i + 2];
  }
  return moved;
}

/** Flatten: everything under the brush onto one plane. */
export function brushFlatten(ctx) {
  const pl = brushPlane(ctx);
  if (!pl) return 0;
  const { pos, idx, w, k } = ctx;
  let moved = 0;
  for (let i = 0; i < idx.length; i++) {
    const p = idx[i];
    const d = (pos[3 * p] - pl.cx) * pl.nx + (pos[3 * p + 1] - pl.cy) * pl.ny + (pos[3 * p + 2] - pl.cz) * pl.nz;
    const f = d * k * w[i];
    pos[3 * p] -= pl.nx * f; pos[3 * p + 1] -= pl.ny * f; pos[3 * p + 2] -= pl.nz * f;
    moved++;
  }
  return moved;
}

/** Scrape: the same plane, but only what sticks OUT moves, so the dents beside a bump are left alone.
 *  Ctrl turns it into Fill: only what sits IN moves, which raises pits without touching the good surface. */
export function brushScrape(ctx) {
  const pl = brushPlane(ctx);
  if (!pl) return 0;
  const { pos, idx, w, k, invert } = ctx;
  let moved = 0;
  for (let i = 0; i < idx.length; i++) {
    const p = idx[i];
    const d = (pos[3 * p] - pl.cx) * pl.nx + (pos[3 * p + 1] - pl.cy) * pl.ny + (pos[3 * p + 2] - pl.cz) * pl.nz;
    if (invert ? d >= 0 : d <= 0) continue;
    const f = d * k * w[i];
    pos[3 * p] -= pl.nx * f; pos[3 * p + 1] -= pl.ny * f; pos[3 * p + 2] -= pl.nz * f;
    moved++;
  }
  return moved;
}

/** The palette, in the order it is shown. `strength` is the default for that brush, tuned by hand on real models. */
export const BRUSHES = [
  {
    id: "smooth", label: "Smooth", apply: brushSmooth, strength: 0.5,
    help: "Evens the surface out towards its neighbours, and stops at a crease so a crisp edge beside it survives. Hold Ctrl to sharpen instead. Example: paint over the stair steps on a curved AI surface.",
  },
  {
    id: "even", label: "Even out", apply: brushEven, strength: 0.6,
    help: "Slides the points sideways until they are evenly spaced, leaving the shape where it is. Every other brush behaves better afterwards. Example: a patch of stretched, bunched triangles.",
  },
  {
    id: "flatten", label: "Flatten", apply: brushFlatten, strength: 0.4,
    help: "Presses everything under the brush onto one flat plane: the average under the brush, or the plane you picked. Example: a panel that should be flat but waves.",
  },
  {
    id: "scrape", label: "Scrape", apply: brushScrape, strength: 0.5,
    help: "Shaves off only what sticks out above the average and leaves the dents alone. Hold Ctrl to do the opposite and raise the pits. Example: bumps and pimples on a flat panel.",
  },
];

export const brushById = (id) => BRUSHES.find((b) => b.id === id) || BRUSHES[0];
export const BRUSH_IDS = BRUSHES.map((b) => b.id);
