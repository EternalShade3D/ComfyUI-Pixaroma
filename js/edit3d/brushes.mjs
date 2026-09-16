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

/** Pinch: gather the surface towards the middle of the brush, SIDEWAYS, so an edge tightens instead of sinking.
 *  Ctrl spreads it apart again. */
export function brushPinch(ctx) {
  const pl = brushPlane(ctx);
  if (!pl) return 0;
  const { pos, idx, w, k, invert, cx, cy, cz } = ctx;
  const s = (invert ? -1 : 1) * k * 0.5;
  let moved = 0;
  for (let i = 0; i < idx.length; i++) {
    const p = idx[i];
    let dx = pos[3 * p] - cx, dy = pos[3 * p + 1] - cy, dz = pos[3 * p + 2] - cz;
    const along = dx * pl.nx + dy * pl.ny + dz * pl.nz;
    dx -= along * pl.nx; dy -= along * pl.ny; dz -= along * pl.nz; // only the sideways part: no sinking
    const f = s * w[i];
    pos[3 * p] -= dx * f; pos[3 * p + 1] -= dy * f; pos[3 * p + 2] -= dz * f;
    moved++;
  }
  return moved;
}

/** Crease: Pinch, plus a small push IN along the surface, which is what cuts a line rather than just tightening one.
 *  Ctrl raises a ridge instead. */
export function brushCrease(ctx) {
  const pl = brushPlane(ctx);
  if (!pl) return 0;
  const moved = brushPinch(ctx);
  const { pos, idx, w, k, invert, radius } = ctx;
  // Gentle on purpose: a crease that cuts fast cannot be steered, and several soft passes always beat one hard one.
  const depth = (invert ? -1 : 1) * k * radius * 0.04;
  for (let i = 0; i < idx.length; i++) {
    const p = idx[i], f = depth * w[i];
    pos[3 * p] -= pl.nx * f; pos[3 * p + 1] -= pl.ny * f; pos[3 * p + 2] -= pl.nz * f;
  }
  return moved;
}

/** Inflate: out along the surface's OWN direction at each point, so a thin part thickens and keeps its shape.
 *  Ctrl pulls it in. */
export function brushInflate(ctx) {
  const { pos, ptN, idx, w, k, invert, radius } = ctx;
  const s = (invert ? -1 : 1) * k * radius * 0.25;
  let moved = 0;
  for (let i = 0; i < idx.length; i++) {
    const p = idx[i], f = s * w[i];
    pos[3 * p] += ptN[3 * p] * f; pos[3 * p + 1] += ptN[3 * p + 1] * f; pos[3 * p + 2] += ptN[3 * p + 2] * f;
    moved++;
  }
  return moved;
}

/** Build up: out along ONE direction, the average under the brush, so it lays a smooth mound instead of following
 *  every wrinkle the way Inflate does. Ctrl carves the same shape inwards. */
export function brushBuildUp(ctx) {
  const pl = brushPlane(ctx);
  if (!pl) return 0;
  const { pos, idx, w, k, invert, radius } = ctx;
  const s = (invert ? -1 : 1) * k * radius * 0.25;
  let moved = 0;
  for (let i = 0; i < idx.length; i++) {
    const p = idx[i], f = s * w[i];
    pos[3 * p] += pl.nx * f; pos[3 * p + 1] += pl.ny * f; pos[3 * p + 2] += pl.nz * f;
    moved++;
  }
  return moved;
}

/**
 * How far a point stands off the middle of its own neighbours, measured in edge lengths so it means the same thing
 * on a coarse patch and a fine one. A smooth surface gives roughly 0.01 to 0.05; a spike gives 1 and upwards.
 * Fills `out` with the neighbours' middle. -> the ratio, or -1 for a point with no neighbours.
 */
function umbrella(pos, nbOff, nb, p, out) {
  let sx = 0, sy = 0, sz = 0, len = 0, m = 0;
  for (let j = nbOff[p], e = nbOff[p + 1]; j < e; j++) {
    const q = nb[j];
    sx += pos[3 * q]; sy += pos[3 * q + 1]; sz += pos[3 * q + 2];
    len += Math.hypot(pos[3 * q] - pos[3 * p], pos[3 * q + 1] - pos[3 * p + 1], pos[3 * q + 2] - pos[3 * p + 2]);
    m++;
  }
  if (!m) return -1;
  out[0] = sx / m; out[1] = sy / m; out[2] = sz / m;
  const avgLen = len / m;
  if (avgLen < 1e-12) return -1;
  return Math.hypot(pos[3 * p] - out[0], pos[3 * p + 1] - out[1], pos[3 * p + 2] - out[2]) / avgLen;
}

const SPIKE_OFF = 0.3; // edge lengths a point must stand off its neighbours before it counts as a spike at all

/**
 * Is p on the rim of a hole? `buildAdjacency` lists a neighbour ONCE PER TRIANGLE, so an inside point has every
 * neighbour twice and a rim point has two of them once. An umbrella offset is meaningless on a rim: the ring is
 * only half a ring, so its middle sits well off to one side and EVERY rim point reads as a spike. Measured before
 * this guard: one spike in a flat 11 by 11 grid, and the brush "fixed" 27 points, 26 of them the border.
 */
function onBoundary(nbOff, nb, p) {
  const s = nbOff[p], e = nbOff[p + 1];
  for (let i = s; i < e; i++) {
    const q = nb[i];
    let seen = 0;
    for (let j = s; j < e; j++) if (nb[j] === q) seen++;
    if (seen === 1) return true;
  }
  return false;
}

/**
 * Fix spikes: snaps the points that stand out from their OWN neighbours back onto them, and touches nothing else.
 * One click, no dragging, and it cannot be half done, because half a spike is still a spike.
 *
 * The trap this has to avoid is eating real edges: the apex of a sharp crease also stands off its neighbours (about
 * 0.42 edge lengths on a 90 degree fold), so an offset test alone would chamfer every panel line on the model. What
 * separates them is the NEIGHBOURS: along a crease the neighbours stand off too, while around a lone spike they sit
 * flat. So a point is only a spike when it stands off AND its neighbours do not.
 */
export function brushSpike(ctx) {
  const { pos, idx, k, adj } = ctx;
  const { nbOff, nb } = adj;
  const mid = [0, 0, 0], nbMid = [0, 0, 0];
  // EVERY decision is made against the untouched surface, and only then are the points moved. Judging as it walks
  // destroys the evidence the crease test needs: traced on a test roof, snapping the first ridge point flattened
  // it, so the next point no longer saw a line of standing-off neighbours beside it and the brush ate the whole
  // ridge one point at a time (dev drifting 0.482, 0.549, 0.56 as it went). Smooth and Even out already write
  // through a scratch buffer for the same reason.
  const plan = ctx.scratch(4 * idx.length);
  let fixed = 0;
  for (let i = 0; i < idx.length; i++) {
    plan[4 * i + 3] = 0;
    const p = idx[i];
    if (onBoundary(nbOff, nb, p)) continue; // the rim of a hole is not a spike
    const dev = umbrella(pos, nbOff, nb, p, mid);
    if (dev < SPIKE_OFF) continue;
    // A CREASE IS A LINE AND A SPIKE IS A BLOB: that, and not the size of the offsets, is what separates them on a
    // real mesh. Comparing a point against its neighbours' offsets does NOT work, because a real pulled vertex
    // drags its whole ring off the surface with it. Measured on the Ep34 gun: the spike stood off 0.993 edge
    // lengths and its worst neighbour 0.761, so a "my neighbours are flatter than me" test vetoed the very case
    // this brush exists for, while every synthetic fixture passed because their rings were perfectly flat.
    // So: count the neighbours that also stand off. A ridge running through p has FEW of them (the two next points
    // along the ridge) and they sit on OPPOSITE sides; a tent has most of its ring standing off, in no such line.
    let high = 0, firstX = 0, firstY = 0, firstZ = 0, opposed = false, touchesRim = false;
    for (let j = nbOff[p], e = nbOff[p + 1]; j < e; j++) {
      const q = nb[j];
      if (onBoundary(nbOff, nb, q)) { touchesRim = true; continue; } // a rim neighbour proves nothing either way
      if (umbrella(pos, nbOff, nb, q, nbMid) < dev * 0.5) continue;
      let dx = pos[3 * q] - pos[3 * p], dy = pos[3 * q + 1] - pos[3 * p + 1], dz = pos[3 * q + 2] - pos[3 * p + 2];
      const l = Math.hypot(dx, dy, dz);
      if (l < 1e-12) continue;
      dx /= l; dy /= l; dz /= l;
      high++;
      if (high === 1) { firstX = dx; firstY = dy; firstZ = dz; } else if (firstX * dx + firstY * dy + firstZ * dz < -0.5) opposed = true;
    }
    // A line of standing-off points runs through it: a crease, not a spike. At the END of a crease one side is a
    // rim, so there is nothing opposite to find; one standing-off neighbour beside a rim is treated as that case
    // rather than eaten, since chamfering the end of every panel line is worse than leaving one point alone.
    if (opposed || (touchesRim && high >= 1)) continue;
    plan[4 * i] = mid[0]; plan[4 * i + 1] = mid[1]; plan[4 * i + 2] = mid[2];
    plan[4 * i + 3] = 1;
    fixed++;
  }
  for (let i = 0; i < idx.length; i++) {
    if (!plan[4 * i + 3]) continue;
    const p = idx[i];
    pos[3 * p] += (plan[4 * i] - pos[3 * p]) * k;
    pos[3 * p + 1] += (plan[4 * i + 1] - pos[3 * p + 1]) * k;
    pos[3 * p + 2] += (plan[4 * i + 2] - pos[3 * p + 2]) * k;
  }
  return fixed;
}

/** The palette, in the order it is shown. `strength` is the default for that brush, tuned by hand on real models. */
export const BRUSHES = [
  {
    id: "smooth", label: "Smooth", apply: brushSmooth, strength: 0.5,
    help: "Evens the surface out towards its neighbours, and stops at a crease so a crisp edge beside it survives. Hold Ctrl to sharpen instead. Example: paint over the stair steps on a curved AI surface.",
  },
  {
    id: "spike", label: "Fix spikes", apply: brushSpike, strength: 1, counts: "changed",
    help: "Click on a point that sticks out of an otherwise smooth surface and it drops back level with its neighbours. It only touches points that stand off on their own, so a real panel edge beside it is left alone, and it needs a click rather than a drag. Example: the single pulled vertex that makes a little tent in a flat area.",
  },
  {
    // Topology, not points: sculpt.mjs sees `topo` and calls the model instead of a maths function.
    id: "simplify", label: "Simplify", apply: () => 0, strength: 0.6, topo: "simplify", counts: "changed",
    help: "Merges the shortest edges under the brush, so a patch that came out far denser than the rest loses points and matches its surroundings. It never touches a hole's rim, never folds the surface, and refuses any merge that would flip a face. Strength sets how long an edge may be and still be merged. Example: the crowded triangles left where a dent used to be.",
  },
  {
    // The other topology brush, and the other half of the density pair.
    id: "detail", label: "Add detail", apply: () => 0, strength: 0.5, topo: "detail", counts: "changed",
    help: "Splits the edges under the brush so the other brushes have something to work with, and does not move the surface at all: every new point sits exactly on the edge it splits. Strength sets how fine it goes, and an edge that is already short is left alone, so pressing again settles instead of running away. Example: an area so coarse that Smooth or Fill has nothing to bite on.",
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
  {
    id: "fill", label: "Fill", apply: (ctx) => brushScrape({ ...ctx, invert: !ctx.invert }), strength: 0.5,
    help: "Raises only what sits BELOW the average and leaves the good surface where it is: the brush for dents and pits. Ctrl turns it back into Scrape. Example: the dents in the flat side of a gun.",
  },
  {
    id: "pinch", label: "Pinch", apply: brushPinch, strength: 0.08,
    help: "Gathers the surface towards the middle of the brush, sideways, so a soft edge tightens into a crisp line without sinking. Ctrl spreads it apart. Example: an edge that came out rounded. Go gently: this one runs away if you lean on it.",
  },
  {
    id: "crease", label: "Crease", apply: brushCrease, strength: 0.08,
    help: "Pinch with a small push in, which cuts a line rather than only tightening one. Ctrl raises a ridge instead. Example: a panel line that got rounded off, or a seam that should read as a groove.",
  },
  {
    id: "inflate", label: "Inflate", apply: brushInflate, strength: 0.25,
    help: "Pushes the surface out along its own direction at every point, so a thin part thickens and keeps its shape. Ctrl pulls it in. Example: a barrel or a limb that came out too thin to print.",
  },
  {
    id: "buildup", label: "Build up", apply: brushBuildUp, strength: 0.3,
    help: "Lays a smooth mound along one direction, the average under the brush, instead of following every wrinkle. Ctrl carves the same shape inwards. Example: rebuilding a chipped corner, or deepening a groove.",
  },
];

// Not a stamping brush: it drags what it grabbed, so sculpt.mjs holds the points from the moment of the press and
// moves them by the drag vector. The same thing as the Move tool in Polygons mode, living where shaping lives.
BRUSHES.push({
  id: "grab", label: "Grab", apply: () => 0, strength: 1, grabs: true,
  help: "Drags the surface along with the brush while the rim of the brush stays put. Example: pull a dented nose tip back out, or nudge a part that sits slightly wrong. It is the same tool as Move in Polygons mode.",
});

// Not a sculpting brush: it paints the PICKED AREA (the same points Polygons mode selects), so the protection can be
// painted where it is needed without leaving Sculpt mode. `paints` tells sculpt.mjs to set the selection instead of
// moving points, which also means no snapshot and no History line: picking is a way of working, not an edit.
BRUSHES.push({
  id: "protect", label: "Protect", apply: () => 0, strength: 1, paints: true,
  help: "Paints the area the other brushes must leave alone, and Ctrl rubs it out again. Example: paint a crisp panel edge, then smooth the lumps right up against it without rounding it off. Clear and Invert are under the brush settings.",
});

export const brushById = (id) => BRUSHES.find((b) => b.id === id) || BRUSHES[0];
export const BRUSH_IDS = BRUSHES.map((b) => b.id);
