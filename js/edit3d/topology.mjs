// Edit 3D Pixaroma - topology on POLYGONS, pure. `counts` Int32Array(F), `indices` Uint32Array (flat corners),
// `wid` Int32Array welds points by position (weldIds) or null when the points are already welded, `alive`
// Uint8Array(F) per polygon. Sorted typed arrays and open-addressing tables instead of Maps where a model of a
// million faces would otherwise take seconds.
export const _testHooks = { turnAtPinch: true, earFill: true };

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
 * Collapse the short edges whose BOTH ends are allowed: the Simplify brush. Each surviving edge merges its two
 * points into their middle, so a dense patch loses points and the polygons around it close up.
 *
 * Topology is unforgiving, so four rules, each of which prevents a mesh nothing downstream could mend:
 *  1. Neither end may sit on a hole's RIM. Collapsing a rim point drags the hole's outline about.
 *  2. The LINK CONDITION: the two ends must share exactly two neighbours. Fewer or more and the collapse folds the
 *     surface onto itself and leaves an edge shared by three or more faces.
 *  3. No polygon around the edge may FLIP (its normal turning more than a right angle), which is what makes the
 *     shredded spikes people see after a careless decimation.
 *  4. A point may take part ONCE per pass, so nothing cascades inside a single call.
 * Everything is decided against the ORIGINAL positions and applied afterwards, the same rule the brushes follow.
 *
 * Returns the new arrays rather than editing in place, because a polygon that loses a corner changes the flat
 * layout of counts and indices. Dead polygons are dropped while it is rebuilding anyway.
 * -> { collapsed, killed, counts, indices, alive, hidden, cornerUv }
 */
export function collapseShortEdges(pos, P, counts, indices, alive, hidden, cornerUv, allow, maxLen, maxCollapses = 400) {
  const st = faceStarts(counts), F = counts.length;
  const none = { collapsed: 0, killed: 0, counts, indices, alive, hidden, cornerUv };
  // ONLY the polygons near the brush: the ones holding an allowed point, plus one ring out. Every edge touching an
  // allowed point then has BOTH its polygons here, so its multiplicity, and with it the rim test, is still exact.
  // Sorting every edge in the model to merge a few hundred inside the footprint was 495 ms of a 596 ms stamp.
  const near = new Uint8Array(F), ringPt = new Uint8Array(P);
  let anyCore = false;
  for (let f = 0; f < F; f++) {
    if (!alive[f]) continue;
    const s = st[f], n = counts[f];
    let hit = false;
    for (let k = 0; k < n; k++) if (allow[indices[s + k]]) { hit = true; break; }
    if (!hit) continue;
    near[f] = 1;
    anyCore = true;
    for (let k = 0; k < n; k++) ringPt[indices[s + k]] = 1;
  }
  if (!anyCore) return none;
  for (let f = 0; f < F; f++) {
    if (near[f] || !alive[f]) continue;
    const s = st[f], n = counts[f];
    for (let k = 0; k < n; k++) if (ringPt[indices[s + k]]) { near[f] = 1; break; }
  }
  // Unique edges of that neighbourhood, with how many polygons hold each: one means a rim.
  const mult = new Map();
  for (let f = 0; f < F; f++) {
    if (!near[f]) continue;
    const s = st[f], n = counts[f];
    for (let k = 0; k < n; k++) {
      const a = indices[s + k], b = indices[s + ((k + 1) % n)];
      if (a === b) continue;
      const key = a < b ? a * P + b : b * P + a;
      mult.set(key, (mult.get(key) || 0) + 1);
    }
  }
  if (!mult.size) return none;
  const onRim = new Uint8Array(P), ea = [], eb = [];
  for (const [key, m] of mult) {
    const a = Math.floor(key / P), b = key % P;
    if (m === 1) { onRim[a] = 1; onRim[b] = 1; }
    ea.push(a);
    eb.push(b);
  }
  // point -> neighbours (over real polygon edges) and point -> polygons, both needed for rules 2 and 3, and both
  // exact for every allowed point because the neighbourhood carries their whole ring.
  const nOff = new Int32Array(P + 1), pOff = new Int32Array(P + 1);
  for (let e = 0; e < ea.length; e++) { nOff[ea[e] + 1]++; nOff[eb[e] + 1]++; }
  for (let f = 0; f < F; f++) if (near[f]) for (let k = 0; k < counts[f]; k++) pOff[indices[st[f] + k] + 1]++;
  for (let p = 0; p < P; p++) { nOff[p + 1] += nOff[p]; pOff[p + 1] += pOff[p]; }
  const nbr = new Int32Array(nOff[P]), pf = new Int32Array(pOff[P]);
  {
    const at = nOff.slice(0, P);
    for (let e = 0; e < ea.length; e++) { nbr[at[ea[e]]++] = eb[e]; nbr[at[eb[e]]++] = ea[e]; }
    const ap = pOff.slice(0, P);
    for (let f = 0; f < F; f++) if (near[f]) for (let k = 0; k < counts[f]; k++) pf[ap[indices[st[f] + k]]++] = f;
  }
  /** Does face f hold both a and b? */
  const holdsEdge = (f, a, b) => {
    let hasA = false, hasB = false;
    for (let k = 0; k < counts[f]; k++) {
      const v = indices[st[f] + k];
      if (v === a) hasA = true; else if (v === b) hasB = true;
    }
    return hasA && hasB;
  };
  /**
   * The LINK CONDITION, stated for POLYGONS rather than for triangles. Every neighbour the two ends SHARE must be a
   * corner of a face that already holds the edge (a, b). A shared neighbour outside those faces is the danger: the
   * collapse merges edge (a, v) with edge (b, v), two distinct edges become one, their faces add up, and the result
   * is an edge in three or more faces that nothing downstream can mend.
   *
   * It used to read `shared(a, b) === 2`, which is the TRIANGLE form of exactly this: a triangle's two faces
   * contribute their opposite corners, so the count is always 2. A QUAD's two faces contribute NO common neighbour,
   * so that test refused every collapse on a quad model and Simplify silently did nothing there - measured, 0 of 64
   * quads against 60 on the same grid triangulated. This pack keeps quads through every edit, so that was half the
   * models it would ever be pointed at.
   */
  const linkOk = (a, b) => {
    let faces = 0;
    for (let i = pOff[a]; i < pOff[a + 1]; i++) if (holdsEdge(pf[i], a, b)) faces++;
    if (faces !== 2) return false; // not a plain interior edge (a rim, or already non-manifold): leave it alone
    for (let i = nOff[a]; i < nOff[a + 1]; i++) {
      const q = nbr[i];
      let isShared = false;
      for (let j = nOff[b]; j < nOff[b + 1]; j++) if (nbr[j] === q) { isShared = true; break; }
      if (!isShared) continue;
      let onEdgeFace = false;
      for (let i2 = pOff[q]; i2 < pOff[q + 1] && !onEdgeFace; i2++) if (holdsEdge(pf[i2], a, b)) onEdgeFace = true;
      if (!onEdgeFace) return false;
    }
    return true;
  };
  // A polygon's normal from its first three corners, with one point moved and another merged away.
  const normalOf = (f, moveP, to, mergeQ) => {
    const s = st[f], n = counts[f];
    const at = (k) => {
      let v = indices[s + k];
      if (v === mergeQ) v = moveP;
      return v === moveP ? to : [pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]];
    };
    const A = at(0), B = at(1 % n), C = at(2 % n);
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
    const vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  };
  const used = new Uint8Array(P), remap = new Int32Array(P);
  for (let p = 0; p < P; p++) remap[p] = p;
  const mid = [0, 0, 0];
  let collapsed = 0;
  for (let e = 0; e < ea.length && collapsed < maxCollapses; e++) {
    const a = ea[e], b = eb[e];
    if (!allow[a] || !allow[b] || onRim[a] || onRim[b] || used[a] || used[b]) continue;
    const dx = pos[3 * b] - pos[3 * a], dy = pos[3 * b + 1] - pos[3 * a + 1], dz = pos[3 * b + 2] - pos[3 * a + 2];
    if (Math.hypot(dx, dy, dz) > maxLen) continue;
    if (!linkOk(a, b)) continue;
    mid[0] = pos[3 * a] + dx / 2; mid[1] = pos[3 * a + 1] + dy / 2; mid[2] = pos[3 * a + 2] + dz / 2;
    let flips = false;
    for (const p of [a, b]) {
      for (let i = pOff[p]; i < pOff[p + 1] && !flips; i++) {
        const f = pf[i];
        let holdsBoth = false;
        for (let k = 0; k < counts[f]; k++) { const v = indices[st[f] + k]; if (v === (p === a ? b : a)) { holdsBoth = true; break; } }
        if (holdsBoth) continue; // the polygons ON the edge are the ones meant to vanish
        const before = normalOf(f, -1, null, -1), after = normalOf(f, a === p ? a : b, mid, p === a ? b : a);
        const lb = Math.hypot(before[0], before[1], before[2]), la = Math.hypot(after[0], after[1], after[2]);
        if (lb < 1e-20 || la < 1e-20) continue;
        if ((before[0] * after[0] + before[1] * after[1] + before[2] * after[2]) / (lb * la) < 0) flips = true;
      }
    }
    if (flips) continue;
    pos[3 * a] = mid[0]; pos[3 * a + 1] = mid[1]; pos[3 * a + 2] = mid[2];
    remap[b] = a;
    used[a] = 1;
    used[b] = 1;
    collapsed++;
  }
  if (!collapsed) return none;
  // Rebuild the polygons: remap, drop repeated corners, drop anything left with under three, drop the dead.
  const outCounts = [], outIdx = [], outAlive = [], outHidden = [], outUv = cornerUv ? [] : null;
  let killed = 0;
  for (let f = 0; f < F; f++) {
    if (!alive[f]) continue;
    const s = st[f], n = counts[f], corners = [], uvs = [];
    for (let k = 0; k < n; k++) {
      const v = remap[indices[s + k]];
      if (corners.length && corners[corners.length - 1] === v) continue;
      corners.push(v);
      if (outUv) uvs.push(cornerUv[2 * (s + k)], cornerUv[2 * (s + k) + 1]);
    }
    while (corners.length > 1 && corners[0] === corners[corners.length - 1]) { corners.pop(); if (outUv) { uvs.pop(); uvs.pop(); } }
    if (corners.length < 3) { killed++; continue; }
    outCounts.push(corners.length);
    for (const c of corners) outIdx.push(c);
    if (outUv) for (const u of uvs) outUv.push(u);
    outAlive.push(1);
    outHidden.push(hidden[f]);
  }
  return {
    collapsed, killed,
    counts: Int32Array.from(outCounts), indices: Uint32Array.from(outIdx),
    alive: Uint8Array.from(outAlive), hidden: Uint8Array.from(outHidden),
    cornerUv: outUv ? Float32Array.from(outUv) : null,
  };
}

/**
 * Split the edges whose BOTH ends are allowed: the Add detail brush, and the other half of Simplify's pair. The
 * answer to "this patch is too coarse for any brush to have anything to bite on".
 *
 * Every new point sits at the STRAIGHT middle of the edge it splits, so the surface does not move at all. A
 * smoothing subdivision would round the model off as a side effect of adding points, which is the opposite of what
 * a repair tool is for.
 *
 * The part that can quietly ruin a model is the ring of polygons just OUTSIDE the footprint. If a split polygon uses
 * (a, m) and (m, b) while its neighbour still uses (a, b), all three of those edges are held by ONE polygon, so the
 * census gains three OPEN edges per T-junction and the brush manufactures holes in an editor whose whole purpose is
 * closing them. So EVERY polygon touching a split edge is rebuilt:
 *  - all of its edges split -> n quads around a new centre point (a quad stays quads, a triangle becomes 3 quads);
 *  - only some of them -> the SAME polygon carrying the midpoints as extra corners. Its shape is untouched, because
 *    a midpoint lies exactly on the edge it splits; it simply has more corners, and that is what closes the
 *    T-junction. (An n-gon here is what Blender does by default for a partial subdivide, for the same reason.)
 * The longest edges go first, so a capped stamp spends its budget where the detail is most missing.
 *
 * Returns new arrays, `pos` included since it GROWS, plus where each new point came from (srcOff / srcList), so the
 * caller can carry the colours and the selection across.
 * -> { split, added, pos, P, counts, indices, alive, hidden, cornerUv, srcOff, srcList }
 */
export function subdivideUnder(pos, P, counts, indices, alive, hidden, cornerUv, allow, minLen, maxSplits = 400) {
  const st = faceStarts(counts), F = counts.length;
  const none = { split: 0, added: 0, pos, P, counts, indices, alive, hidden, cornerUv, srcOff: new Int32Array(1), srcList: new Int32Array(0) };
  // The candidates: an edge with both ends under the brush, longer than minLen. An edge already shorter than that is
  // left alone, which is what makes pressing again settle instead of running away.
  const seen = new Set(), ca = [], cb = [], clen = [];
  for (let f = 0; f < F; f++) {
    if (!alive[f]) continue;
    const s = st[f], n = counts[f];
    for (let k = 0; k < n; k++) {
      const a = indices[s + k], b = indices[s + ((k + 1) % n)];
      if (a === b || !allow[a] || !allow[b]) continue;
      const key = a < b ? a * P + b : b * P + a;
      if (seen.has(key)) continue;
      const len = Math.hypot(pos[3 * a] - pos[3 * b], pos[3 * a + 1] - pos[3 * b + 1], pos[3 * a + 2] - pos[3 * b + 2]);
      if (!(len > minLen)) continue;
      seen.add(key);
      ca.push(a);
      cb.push(b);
      clen.push(len);
    }
  }
  if (!ca.length) return none;
  let order = null;
  if (ca.length > maxSplits) {
    order = ca.map((_, i) => i).sort((x, y) => clen[y] - clen[x]);
    order.length = maxSplits;
  }
  // A midpoint is keyed by the welded PAIR, so the two polygons sharing an edge get the same one: that is what keeps
  // the split manifold.
  const midOf = new Map(), newPos = [], srcOff = [0], srcList = [];
  const take = order || ca.map((_, i) => i);
  for (const i of take) {
    const a = ca[i], b = cb[i];
    midOf.set(a < b ? a * P + b : b * P + a, P + newPos.length / 3);
    newPos.push((pos[3 * a] + pos[3 * b]) / 2, (pos[3 * a + 1] + pos[3 * b + 1]) / 2, (pos[3 * a + 2] + pos[3 * b + 2]) / 2);
    srcList.push(a, b);
    srcOff.push(srcList.length);
  }
  const outCounts = [], outIdx = [], outAlive = [], outHidden = [], outUv = cornerUv ? [] : null;
  const mids = [];
  for (let f = 0; f < F; f++) {
    if (!alive[f]) continue;
    const s = st[f], n = counts[f];
    const uvc = (k) => cornerUv[2 * (s + (k % n))];
    const uvd = (k) => cornerUv[2 * (s + (k % n)) + 1];
    mids.length = 0;
    let sCount = 0;
    for (let k = 0; k < n; k++) {
      const a = indices[s + k], b = indices[s + ((k + 1) % n)];
      let m = -1;
      if (a !== b) {
        const g = midOf.get(a < b ? a * P + b : b * P + a);
        if (g !== undefined) { m = g; sCount++; }
      }
      mids.push(m);
    }
    if (!sCount) {
      outCounts.push(n);
      for (let k = 0; k < n; k++) {
        outIdx.push(indices[s + k]);
        if (outUv) outUv.push(uvc(k), uvd(k));
      }
      outAlive.push(1);
      outHidden.push(hidden[f]);
    } else if (sCount === n) {
      let cxx = 0, cyy = 0, czz = 0, cu = 0, cv = 0;
      for (let k = 0; k < n; k++) {
        const v = indices[s + k];
        cxx += pos[3 * v]; cyy += pos[3 * v + 1]; czz += pos[3 * v + 2];
        if (outUv) { cu += uvc(k); cv += uvd(k); }
      }
      const c = P + newPos.length / 3;
      newPos.push(cxx / n, cyy / n, czz / n);
      for (let k = 0; k < n; k++) srcList.push(indices[s + k]);
      srcOff.push(srcList.length);
      // v_k -> m_k -> centre -> m_(k-1) keeps the polygon's own winding, so nothing comes out inside first.
      for (let k = 0; k < n; k++) {
        const prev = (k + n - 1) % n;
        outCounts.push(4);
        outIdx.push(indices[s + k], mids[k], c, mids[prev]);
        outAlive.push(1);
        outHidden.push(hidden[f]);
        if (outUv) {
          outUv.push(uvc(k), uvd(k));
          outUv.push((uvc(k) + uvc(k + 1)) / 2, (uvd(k) + uvd(k + 1)) / 2);
          outUv.push(cu / n, cv / n);
          outUv.push((uvc(prev) + uvc(k)) / 2, (uvd(prev) + uvd(k)) / 2);
        }
      }
    } else {
      // The transition polygon: same shape, extra corners. Dropping this branch is what leaves T-junctions behind.
      let ring = 0;
      for (let k = 0; k < n; k++) {
        outIdx.push(indices[s + k]);
        if (outUv) outUv.push(uvc(k), uvd(k));
        ring++;
        if (mids[k] >= 0) {
          outIdx.push(mids[k]);
          if (outUv) outUv.push((uvc(k) + uvc(k + 1)) / 2, (uvd(k) + uvd(k + 1)) / 2);
          ring++;
        }
      }
      outCounts.push(ring);
      outAlive.push(1);
      outHidden.push(hidden[f]);
    }
  }
  const added = newPos.length / 3;
  const outPos = new Float32Array(3 * (P + added));
  outPos.set(pos);
  outPos.set(newPos, 3 * P);
  return {
    split: take.length, added,
    pos: outPos, P: P + added,
    counts: Int32Array.from(outCounts), indices: Uint32Array.from(outIdx),
    alive: Uint8Array.from(outAlive), hidden: Uint8Array.from(outHidden),
    cornerUv: outUv ? Float32Array.from(outUv) : null,
    srcOff: Int32Array.from(srcOff), srcList: Int32Array.from(srcList),
  };
}

/**
 * Close loops: up to `maxLenOneFace` corners one polygon, else a fan around the loop's middle (a new point).
 * `firstOf[wid]` maps a welded id back to one point index (null when the loops already hold point indices).
 * -> { counts, indices, newPoints: number[] (xyz), faces }
 */
/** Newell's normal of a loop: the average plane of a rim that is never exactly flat. */
function loopNormal(positions, L) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < L.length; i++) {
    const a = L[i], b = L[(i + 1) % L.length];
    const ax = positions[3 * a], ay = positions[3 * a + 1], az = positions[3 * a + 2];
    const bx = positions[3 * b], by = positions[3 * b + 1], bz = positions[3 * b + 2];
    nx += (ay - by) * (az + bz);
    ny += (az - bz) * (ax + bx);
    nz += (ax - bx) * (ay + by);
  }
  const l = Math.hypot(nx, ny, nz);
  return l ? [nx / l, ny / l, nz / l] : null;
}

/**
 * Triangulate a rim by clipping ears, so the patch has NO point of its own in the middle. A fan puts one point in
 * the centre carrying an edge to every rim point, which on a 14 edge rim is a 14 way star: exactly the artefact
 * users point at and call messed up geometry. Ear clipping adds no point at all, so no star can exist.
 * The loop is flattened onto its own Newell plane to decide which corners are ears; a rim too creased to flatten
 * (no normal) falls back to the fan, which always produces something. -> true when it triangulated
 */
function earClip(positions, L, newCounts, newIdx) {
  const n = L.length, N = loopNormal(positions, L);
  if (!N) return false;
  let tx = Math.abs(N[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let ux = tx[1] * N[2] - tx[2] * N[1], uy = tx[2] * N[0] - tx[0] * N[2], uz = tx[0] * N[1] - tx[1] * N[0];
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul; uy /= ul; uz /= ul;
  const vx = N[1] * uz - N[2] * uy, vy = N[2] * ux - N[0] * uz, vz = N[0] * uy - N[1] * ux;
  const X = new Float64Array(n), Y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = L[i], px = positions[3 * p], py = positions[3 * p + 1], pz = positions[3 * p + 2];
    X[i] = px * ux + py * uy + pz * uz;
    Y[i] = px * vx + py * vy + pz * vz;
  }
  let area = 0;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += X[i] * Y[j] - X[j] * Y[i]; }
  const sign = area >= 0 ? 1 : -1;
  const cross = (a, b, c) => sign * ((X[b] - X[a]) * (Y[c] - Y[a]) - (Y[b] - Y[a]) * (X[c] - X[a]));
  const inside = (a, b, c, p) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  const live = [];
  for (let i = 0; i < n; i++) live.push(i);
  const out = [];
  let guard = 0, start = 0;
  const CAND = 8;
  while (live.length > 3 && guard++ < 4 * n) {
    // The BEST ear, not the first one found. Clipping the first valid ear each round keeps returning to the easiest
    // corner and walks around it, which rebuilds the very star this function exists to avoid: MEASURED, a 14 edge
    // rim put 11 of its 12 triangles on ONE rim point, no better than the fan it replaced. Scoring by shape spreads
    // the work across the rim. Densifying afterwards cannot undo it, since splitting edges never lowers a valence.
    // The scan is bounded (a rotating start, at most CAND candidates) so a 600 edge rim, the most one Fill hole
    // click closes, cannot make this cubic.
    let bestK = -1, bestQ = -1, seen = 0;
    for (let s = 0; s < live.length && seen < CAND; s++) {
      const k = (start + s) % live.length;
      const a = live[(k + live.length - 1) % live.length], b = live[k], c = live[(k + 1) % live.length];
      const ar = cross(a, b, c);
      if (ar <= 0) continue; // reflex corner, not an ear
      let blocked = false;
      for (const q of live) {
        if (q === a || q === b || q === c) continue;
        if (inside(a, b, c, q)) { blocked = true; break; }
      }
      if (blocked) continue;
      seen++;
      // 1 for an equilateral triangle, towards 0 for a sliver. `ar` is twice the signed area.
      const e1 = (X[a] - X[b]) ** 2 + (Y[a] - Y[b]) ** 2, e2 = (X[b] - X[c]) ** 2 + (Y[b] - Y[c]) ** 2, e3 = (X[c] - X[a]) ** 2 + (Y[c] - Y[a]) ** 2;
      const qual = (2 * Math.sqrt(3) * ar) / (e1 + e2 + e3 || 1);
      if (qual > bestQ) { bestQ = qual; bestK = k; }
    }
    if (bestK < 0) return false; // a rim this tangled is better served by the fan than by a bad guess
    const a = live[(bestK + live.length - 1) % live.length], b = live[bestK], c = live[(bestK + 1) % live.length];
    out.push([a, b, c]);
    live.splice(bestK, 1);
    start = live.length ? bestK % live.length : 0;
  }
  if (live.length === 3) out.push([live[0], live[1], live[2]]);
  // Wound the same way the rest of this function winds a fill: reversed against the loop's own order.
  for (const [a, b, c] of out) { newCounts.push(3); newIdx.push(L[c], L[b], L[a]); }
  return true;
}

export function fanFill(positions, loops, maxLenOneFace, firstOf = null) {
  const newCounts = [], newIdx = [], newPoints = [];
  const base = positions.length / 3;
  for (const loop of loops) {
    const L = firstOf ? loop.map((w) => firstOf[w]) : loop;
    const n = L.length;
    if (n <= maxLenOneFace) { newCounts.push(n); for (let i = n - 1; i >= 0; i--) newIdx.push(L[i]); continue; }
    // A rim past the one polygon limit is triangulated with no new point, so the patch carries no star. The fan is
    // kept as the fallback for a rim too tangled to clip, and `_testHooks.earFill = false` restores it everywhere.
    if (_testHooks.earFill && earClip(positions, L, newCounts, newIdx)) continue;
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
