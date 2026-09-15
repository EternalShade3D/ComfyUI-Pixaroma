// Edit 3D Pixaroma - topology on POLYGONS, pure. `counts` Int32Array(F), `indices` Uint32Array (flat corners),
// `wid` Int32Array welds points by position (weldIds) or null when the points are already welded, `alive`
// Uint8Array(F) per polygon. Sorted typed arrays and open-addressing tables instead of Maps where a model of a
// million faces would otherwise take seconds.
export const _testHooks = { turnAtPinch: true };

/** One id per PLACE, numbered by first appearance: points within 1e-6 of the box diagonal share an id (the rule of
 *  nodes/_mesh3d.weld_ids). A point that is not a real number gets an id of its own after the others. */
export function weldIds(positions, N) {
  const ids = new Int32Array(N);
  if (!N) return { ids, count: 0 };
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const bad = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const x = positions[3 * i], y = positions[3 * i + 1], z = positions[3 * i + 2];
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) { bad[i] = 1; continue; }
    if (x < lo[0]) lo[0] = x; if (x > hi[0]) hi[0] = x;
    if (y < lo[1]) lo[1] = y; if (y > hi[1]) hi[1] = y;
    if (z < lo[2]) lo[2] = z; if (z > hi[2]) hi[2] = z;
  }
  const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1, inv = 1 / (diag * 1e-6);
  let cap = 16;
  while (cap < N * 2) cap *= 2;
  const mask = cap - 1;
  const tx = new Int32Array(cap), ty = new Int32Array(cap), tz = new Int32Array(cap), tid = new Int32Array(cap).fill(-1);
  let count = 0;
  for (let i = 0; i < N; i++) {
    if (bad[i]) continue;
    const qx = Math.round((positions[3 * i] - lo[0]) * inv) | 0;
    const qy = Math.round((positions[3 * i + 1] - lo[1]) * inv) | 0;
    const qz = Math.round((positions[3 * i + 2] - lo[2]) * inv) | 0;
    let h = (Math.imul(qx, 73856093) ^ Math.imul(qy, 19349663) ^ Math.imul(qz, 83492791)) & mask;
    for (;;) {
      const id = tid[h];
      if (id < 0) { tid[h] = count; tx[h] = qx; ty[h] = qy; tz[h] = qz; ids[i] = count++; break; }
      if (tx[h] === qx && ty[h] === qy && tz[h] === qz) { ids[i] = id; break; }
      h = (h + 1) & mask;
    }
  }
  for (let i = 0; i < N; i++) if (bad[i]) ids[i] = count++;
  return { ids, count };
}

export function faceStarts(counts) {
  const s = new Uint32Array(counts.length + 1);
  for (let f = 0; f < counts.length; f++) s[f + 1] = s[f] + counts[f];
  return s;
}

const idOf = (wid, v) => (wid ? wid[v] : v);

/** Every undirected edge of the live polygons as a sorted key a*nw+b (a < b), repeats kept. */
function sortedEdgeKeys(wid, nw, counts, indices, alive) {
  const st = faceStarts(counts);
  let E = 0;
  for (let f = 0; f < counts.length; f++) if (alive[f]) E += counts[f];
  const keys = new Float64Array(E);
  let e = 0;
  for (let f = 0; f < counts.length; f++) {
    if (!alive[f]) continue;
    const n = counts[f], s = st[f];
    for (let k = 0; k < n; k++) {
      const a = idOf(wid, indices[s + k]), b = idOf(wid, indices[s + ((k + 1) % n)]);
      if (a === b) continue;
      keys[e++] = a < b ? a * nw + b : b * nw + a;
    }
  }
  return keys.subarray(0, e).sort();
}

/** Open edges (one polygon), broken edges (three or more), pieces, the live polygons by corner count, and the open and
 *  broken edges as [a, b, a, b, ...] (for the red and yellow dots and the Fill hole click). */
export function census(wid, nw, counts, indices, alive) {
  const keys = sortedEdgeKeys(wid, nw, counts, indices, alive);
  let open = 0, broken = 0;
  const openList = [], brokenList = [];
  for (let i = 0; i < keys.length; ) {
    let j = i + 1;
    while (j < keys.length && keys[j] === keys[i]) j++;
    const n = j - i;
    if (n === 1) { open++; openList.push(Math.floor(keys[i] / nw), keys[i] % nw); } else if (n > 2) { broken++; brokenList.push(Math.floor(keys[i] / nw), keys[i] % nw); }
    i = j;
  }
  const pc = pieces(wid, nw, counts, indices, alive);
  let aliveN = 0, triangles = 0, quads = 0, ngons = 0;
  for (let f = 0; f < counts.length; f++) {
    if (!alive[f]) continue;
    aliveN++;
    if (counts[f] === 3) triangles++; else if (counts[f] === 4) quads++; else ngons++;
  }
  return {
    open, broken, pieces: pc.sizes.length, tiny: pc.sizes.filter((s) => s < 8).length, alive: aliveN, triangles, quads, ngons,
    openEdges: Int32Array.from(openList), brokenEdges: Int32Array.from(brokenList), faceComp: pc.faceComp, pieceSizes: pc.sizes,
  };
}

/** Connected pieces of live polygons (polygons sharing a welded point). -> { faceComp: Int32Array(F) (-1 dead), sizes } */
export function pieces(wid, nw, counts, indices, alive) {
  const par = new Int32Array(nw);
  for (let i = 0; i < nw; i++) par[i] = i;
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const st = faceStarts(counts);
  for (let f = 0; f < counts.length; f++) {
    if (!alive[f]) continue;
    const a = find(idOf(wid, indices[st[f]]));
    for (let k = 1; k < counts[f]; k++) { const b = find(idOf(wid, indices[st[f] + k])); if (a !== b) par[b] = a; }
  }
  const faceComp = new Int32Array(counts.length).fill(-1), index = new Map(), sizes = [];
  for (let f = 0; f < counts.length; f++) {
    if (!alive[f]) continue;
    const r = find(idOf(wid, indices[st[f]]));
    let id = index.get(r);
    if (id === undefined) { id = sizes.length; index.set(r, id); sizes.push(0); }
    faceComp[f] = id;
    sizes[id]++;
  }
  return { faceComp, sizes };
}

/** Kill the pieces with fewer than minFaces polygons. -> polygons removed */
export function dropLoosePieces(wid, nw, counts, indices, alive, minFaces) {
  const pc = pieces(wid, nw, counts, indices, alive);
  let n = 0;
  for (let f = 0; f < counts.length; f++) if (alive[f] && pc.sizes[pc.faceComp[f]] < minFaces) { alive[f] = 0; n++; }
  return n;
}

/** A loop that passes a point twice -> simple loops (one fan over such a loop uses that point's edges twice). */
function splitAtRepeats(verts) {
  const loops = [], stack = [], at = new Map();
  for (const v of verts) {
    if (at.has(v)) {
      const i = at.get(v), sub = stack.slice(i);
      if (sub.length >= 3) loops.push(sub);
      for (const x of sub.slice(1)) at.delete(x);
      stack.length = i + 1;
    } else { at.set(v, stack.length); stack.push(v); }
  }
  if (stack.length >= 3) loops.push(stack);
  return loops;
}

/**
 * Open boundaries as simple loops of welded ids, walked half-edge by half-edge the way the polygons run; at a pinch
 * point the walk turns through that point's polygons to the open edge of the same fan (the Python boundary_loops,
 * quad-remesh.md #4). Only polygons touching an open edge's points are indexed, so a big closed-ish model stays fast.
 * -> { loops: number[][], stray: open half-edges in no closed loop }
 */
export function boundaryLoops(wid, nw, counts, indices, alive, maxLen, accept = null) {
  const keys = sortedEdgeKeys(wid, nw, counts, indices, alive);
  const openSet = new Set();
  const onBorder = new Uint8Array(nw);
  for (let i = 0; i < keys.length; ) {
    let j = i + 1;
    while (j < keys.length && keys[j] === keys[i]) j++;
    if (j - i === 1) { openSet.add(keys[i]); onBorder[Math.floor(keys[i] / nw)] = 1; onBorder[keys[i] % nw] = 1; }
    i = j;
  }
  if (!openSet.size) return { loops: [], stray: 0 };
  const st = faceStarts(counts), fwd = new Map(), isOpen = new Set();
  for (let f = 0; f < counts.length; f++) {
    if (!alive[f]) continue;
    const n = counts[f], s = st[f];
    let touches = false;
    for (let k = 0; k < n; k++) if (onBorder[idOf(wid, indices[s + k])]) { touches = true; break; }
    if (!touches) continue;
    for (let k = 0; k < n; k++) {
      const a = idOf(wid, indices[s + k]), b = idOf(wid, indices[s + ((k + 1) % n)]), c = idOf(wid, indices[s + ((k + 2) % n)]);
      if (a === b) continue;
      fwd.set(a * nw + b, c); // half-edge a->b -> the corner after b in the same polygon
      if (openSet.has(a < b ? a * nw + b : b * nw + a)) isOpen.add(a * nw + b);
    }
  }
  const visited = new Set(), failed = new Set(), loops = [];
  for (const start of isOpen) {
    if (visited.has(start) || failed.has(start)) continue;
    // accept(a, b): only walk from these open edges (one hole under a click, the holes inside a selection), so a long
    // open border elsewhere is not walked 600 steps from each of its edges.
    if (accept && !accept(Math.floor(start / nw), start % nw)) continue;
    const walk = [], seenHere = new Set();
    let h = start, closed = false;
    for (let step = 0; step <= maxLen; step++) {
      walk.push(h);
      seenHere.add(h);
      const v = h % nw;
      let w = fwd.get(h), found = null;
      for (let turn = 0; turn < 64; turn++) {
        const cand = v * nw + w;
        if (isOpen.has(cand)) { found = cand; break; }
        if (!_testHooks.turnAtPinch) break;
        const twinNext = fwd.get(w * nw + v);
        if (twinNext === undefined) break;
        w = twinNext;
      }
      if (found === null) break;
      if (found === start) { closed = true; break; }
      if (visited.has(found) || seenHere.has(found)) break;
      h = found;
    }
    if (!closed) { failed.add(start); continue; }
    for (const x of walk) visited.add(x);
    loops.push(...splitAtRepeats(walk.map((hh) => Math.floor(hh / nw))));
  }
  return { loops, stray: isOpen.size - visited.size };
}

/**
 * Close loops: up to `maxLenOneFace` corners one polygon, else a fan around the loop's middle (a new point).
 * `firstOf[wid]` maps a welded id back to one point index (null when the loops already hold point indices).
 * -> { counts, indices, newPoints: number[] (xyz), faces }
 */
export function fanFill(positions, loops, maxLenOneFace, firstOf = null) {
  const newCounts = [], newIdx = [], newPoints = [];
  const base = positions.length / 3;
  for (const loop of loops) {
    const L = firstOf ? loop.map((w) => firstOf[w]) : loop;
    const n = L.length;
    if (n <= maxLenOneFace) { newCounts.push(n); for (let i = n - 1; i >= 0; i--) newIdx.push(L[i]); continue; }
    let cx = 0, cy = 0, cz = 0;
    for (const p of L) { cx += positions[3 * p]; cy += positions[3 * p + 1]; cz += positions[3 * p + 2]; }
    const c = base + newPoints.length / 3;
    newPoints.push(cx / n, cy / n, cz / n);
    for (let i = 0; i < n; i++) { newCounts.push(3); newIdx.push(L[(i + 1) % n], L[i], c); }
  }
  return { counts: Int32Array.from(newCounts), indices: Uint32Array.from(newIdx), newPoints, faces: newCounts.length };
}

/**
 * Close cracks: the points on OPEN edges that lie within `dist` of each other are joined (a grid hash and union-find
 * over the border points only), polygons are remapped, and polygons left with under three distinct corners die.
 * Works on already-welded point indices. -> { joined: points merged away, killed: polygons that collapsed }
 */
export function closeCracks(positions, P, counts, indices, alive, dist) {
  const keys = sortedEdgeKeys(null, P, counts, indices, alive);
  const border = new Uint8Array(P);
  for (let i = 0; i < keys.length; ) {
    let j = i + 1;
    while (j < keys.length && keys[j] === keys[i]) j++;
    if (j - i === 1) { border[Math.floor(keys[i] / P)] = 1; border[keys[i] % P] = 1; }
    i = j;
  }
  const pts = [];
  for (let p = 0; p < P; p++) if (border[p]) pts.push(p);
  if (!pts.length || !(dist > 0)) return { joined: 0, killed: 0 };
  const par = new Int32Array(P);
  for (let i = 0; i < P; i++) par[i] = i;
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const cell = new Map(), inv = 1 / dist, d2 = dist * dist;
  const key = (x, y, z) => `${x},${y},${z}`;
  for (const p of pts) {
    const x = Math.floor(positions[3 * p] * inv), y = Math.floor(positions[3 * p + 1] * inv), z = Math.floor(positions[3 * p + 2] * inv);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const list = cell.get(key(x + dx, y + dy, z + dz));
      if (!list) continue;
      for (const q of list) {
        const ex = positions[3 * p] - positions[3 * q], ey = positions[3 * p + 1] - positions[3 * q + 1], ez = positions[3 * p + 2] - positions[3 * q + 2];
        if (ex * ex + ey * ey + ez * ez <= d2) { const a = find(p), b = find(q); if (a !== b) par[Math.max(a, b)] = Math.min(a, b); }
      }
    }
    const k = key(x, y, z);
    const list = cell.get(k);
    if (list) list.push(p); else cell.set(k, [p]);
  }
  let joined = 0;
  for (const p of pts) if (find(p) !== p) joined++;
  if (!joined) return { joined: 0, killed: 0 };
  const st = faceStarts(counts);
  let killed = 0;
  for (let f = 0; f < counts.length; f++) {
    if (!alive[f]) continue;
    const s = st[f], n = counts[f];
    let distinct = 0;
    for (let k = 0; k < n; k++) {
      const r = find(indices[s + k]);
      indices[s + k] = r;
      let dup = false;
      for (let m = 0; m < k; m++) if (indices[s + m] === r) { dup = true; break; }
      if (!dup) distinct++;
    }
    if (distinct < 3) { alive[f] = 0; killed++; }
  }
  return { joined, killed };
}
