// Edit 3D Pixaroma - the working mesh. Polygons stay as they are (counts + indices over WELDED points, so a quad model
// keeps its quads through every edit and into the saved OBJ); triangles are derived from them for drawing, picking and
// the maths. Per-polygon alive and hidden flags, a per-point selection, and the GPU buffers (drawn unindexed, so each
// corner can have its own normal and colour). Every tool edits `pos`, the same numbers the screen shows.
import { weldIds, faceStarts, census, collapseShortEdges, subdivideUnder } from "./topology.mjs";
import { buildAdjacency, faceNormals, pointNormals, creasedCornerNormals, COS_CREASE } from "./geometry.mjs";

const SEL = [0.965, 0.404, 0.267];
// How strongly a tint replaces the surface colour. The selection is drawn FAINT wherever nothing can act on it
// (Whole model mode, and Sculpt with the Selection setting off): reported 2026-09-16 as a selection that follows
// you into a mode that appears to have no use for it. Dimmed rather than hidden, so a careful pick is never lost
// and turning the Selection setting on visibly brings it back to life.
// 0.32 is MEASURED, not guessed: the blends were rendered as swatches against a pale, a clay and a dark surface.
// At 0.18 the faint tint is clear on clay and dark but nearly invisible on a PALE model, which turns "dim" into
// "hidden" and defeats the point. Judge any change to it on the pale case, and WITHOUT an untinted patch beside it
// for reference: side by side flatters a value that is far too faint on its own.
const SEL_MIX = 0.65;
const SEL_MIX_IDLE = 0.32;
const BLUE = [0.18, 0.45, 0.9];
const GREEN = [0.25, 0.72, 0.4];
const CLAY = 0.62;

export class MeshModel {
  constructor(THREE, src) {
    this.THREE = THREE;
    this.texture = src.texture || null;
    this.flipUv = !!(src.texture && src.texture.flipY);
    this.fromPolys = !!src.polys;
    this.material = null;
    this.wire = null;
    this.markers = null;
    this.grid = null;
    this.stats = { alive: 0, hidden: 0, open: 0, broken: 0, pieces: 0, tiny: 0, quads: 0, triangles: 0, ngons: 0 };
    this._init(src.positions, src.counts, src.indices, src.colours, src.uvs);
  }

  _init(positions, counts, indices, colours, uvs) {
    const N = positions.length / 3;
    const w = weldIds(positions, N);
    const P = w.count;
    const pos = new Float32Array(3 * P);
    const col = colours ? new Float32Array(3 * P).fill(1) : null;
    const seen = new Uint8Array(P);
    for (let i = 0; i < N; i++) {
      const id = w.ids[i];
      if (seen[id]) continue;
      seen[id] = 1;
      pos[3 * id] = positions[3 * i]; pos[3 * id + 1] = positions[3 * i + 1]; pos[3 * id + 2] = positions[3 * i + 2];
      if (col) { col[3 * id] = colours[3 * i]; col[3 * id + 1] = colours[3 * i + 1]; col[3 * id + 2] = colours[3 * i + 2]; }
    }
    const C = indices.length;
    const idx = new Uint32Array(C);
    const cornerUv = uvs ? new Float32Array(2 * C) : null;
    for (let k = 0; k < C; k++) {
      const v = indices[k];
      idx[k] = w.ids[v];
      if (cornerUv) { cornerUv[2 * k] = uvs[2 * v]; cornerUv[2 * k + 1] = uvs[2 * v + 1]; }
    }
    this.P = P;
    this.pos = pos;
    this.colours = col;
    this.counts = counts instanceof Int32Array ? counts.slice() : Int32Array.from(counts);
    this.indices = idx;
    this.cornerUv = this.texture ? cornerUv : null;
    this.F = this.counts.length;
    this.alive = new Uint8Array(this.F).fill(1);
    this.hidden = new Uint8Array(this.F);
    this.sel = new Uint8Array(P);
    this._derive();
  }

  /** Everything that follows from counts + indices: the triangles, the adjacency, the per-triangle arrays, the GPU buffers. */
  _derive() {
    const { counts, indices, F } = this;
    this.starts = faceStarts(counts);
    let T = 0;
    for (let f = 0; f < F; f++) T += Math.max(0, counts[f] - 2);
    const cp = new Int32Array(3 * T), triPoly = new Int32Array(T), triCorner = new Int32Array(3 * T);
    let t = 0;
    for (let f = 0; f < F; f++) {
      const s = this.starts[f], n = counts[f];
      for (let k = 1; k + 1 < n; k++) {
        cp[3 * t] = indices[s]; cp[3 * t + 1] = indices[s + k]; cp[3 * t + 2] = indices[s + k + 1];
        triCorner[3 * t] = s; triCorner[3 * t + 1] = s + k; triCorner[3 * t + 2] = s + k + 1;
        triPoly[t++] = f;
      }
    }
    this.T = T;
    this.cp = cp;
    this.triPoly = triPoly;
    this.triCorner = triCorner;
    this.adj = buildAdjacency(this.P, cp);
    this.fnRaw = new Float32Array(3 * T);
    this.fnUnit = new Float32Array(3 * T);
    this.ptN = new Float32Array(3 * this.P);
    this.vis = new Uint8Array(T);
    this.ptVis = new Uint8Array(this.P);
    this.panelA = this.panelB = this.panelAFaces = this.panelBFaces = null;
    if (this.sel.length !== this.P) this.sel = new Uint8Array(this.P);
    this._buildGpu();
    this.censusDirty = true;
    this.gridDirty = true;
    this.wireDirty = true;
  }

  _buildGpu() {
    const THREE = this.THREE, T = this.T;
    const oldGeo = this.geometry, oldId = this.idGeometry;
    const dyn = (n, size) => {
      const a = new THREE.BufferAttribute(new Float32Array(n), size);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    const geo = new THREE.BufferGeometry();
    this.aPos = dyn(9 * T, 3);
    this.aNor = dyn(9 * T, 3);
    this.aCol = dyn(9 * T, 3);
    geo.setAttribute("position", this.aPos);
    geo.setAttribute("normal", this.aNor);
    geo.setAttribute("color", this.aCol);
    this.aUv = null;
    if (this.texture && this.cornerUv) {
      const uv = new Float32Array(6 * T);
      for (let c = 0; c < 3 * T; c++) { const k = this.triCorner[c]; uv[2 * c] = this.cornerUv[2 * k]; uv[2 * c + 1] = this.cornerUv[2 * k + 1]; }
      this.aUv = new THREE.BufferAttribute(uv, 2);
      geo.setAttribute("uv", this.aUv);
    }
    // Triangle ids as colours (1-based, 24 bits) for GPU picking and Remove inside surfaces. The SAME position
    // attribute, so both geometries always draw the same numbers; never dispose one without the other.
    const ids = new Uint8Array(9 * T);
    for (let i = 0; i < T; i++) {
      const id = i + 1, r = id & 255, g = (id >> 8) & 255, b = (id >> 16) & 255;
      for (let k = 0; k < 3; k++) { const o = 9 * i + 3 * k; ids[o] = r; ids[o + 1] = g; ids[o + 2] = b; }
    }
    const idGeo = new THREE.BufferGeometry();
    idGeo.setAttribute("position", this.aPos);
    idGeo.setAttribute("color", new THREE.BufferAttribute(ids, 3, true));
    if (!this.material) {
      this.material = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.78, metalness: 0, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      });
      // Picking sees both sides; Remove inside sees only the front (the inner skin of an AI model faces inward).
      this.pickMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide });
      this.seenMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.FrontSide });
      this.mesh = new THREE.Mesh(geo, this.material);
      this.pickMesh = new THREE.Mesh(idGeo, this.pickMaterial);
      this.seenMesh = new THREE.Mesh(idGeo, this.seenMaterial);
      for (const m of [this.mesh, this.pickMesh, this.seenMesh]) m.frustumCulled = false;
    } else {
      this.mesh.geometry = geo;
      this.pickMesh.geometry = idGeo;
      this.seenMesh.geometry = idGeo;
    }
    this.geometry = geo;
    this.idGeometry = idGeo;
    if (oldGeo) oldGeo.dispose();
    if (oldId) oldId.dispose();
  }

  computeVis() {
    const { T, triPoly, alive, hidden, cp, vis, ptVis } = this;
    for (let t = 0; t < T; t++) { const f = triPoly[t]; vis[t] = alive[f] && !hidden[f] ? 1 : 0; }
    let hid = 0;
    for (let f = 0; f < this.F; f++) if (alive[f] && hidden[f]) hid++;
    ptVis.fill(0);
    for (let t = 0; t < T; t++) if (vis[t]) { ptVis[cp[3 * t]] = 1; ptVis[cp[3 * t + 1]] = 1; ptVis[cp[3 * t + 2]] = 1; }
    this.stats.hidden = hid;
  }

  /** After positions or alive / hidden changed: normals, the drawn positions, the shading normals.
   *  `posOnly` says only POSITIONS moved, so the census (holes, broken edges, pieces) cannot have changed and the
   *  edge sort that costs the most on a big model is not paid for. */
  refreshGeometry(opts) {
    const posOnly = !!(opts && opts.posOnly);
    this.computeVis();
    faceNormals(this.pos, this.cp, this.vis, this.fnRaw, this.fnUnit);
    this.writePositions();
    creasedCornerNormals(this.cp, this.vis, this.fnRaw, this.fnUnit, this.adj.pfOff, this.adj.pf, this.aNor.array);
    this.aNor.needsUpdate = true;
    pointNormals(this.P, this.cp, this.vis, this.fnRaw, this.ptN);
    this.bounds();
    this.gridDirty = true;
    if (!posOnly) this.censusDirty = true;
    this.wireDirty = true;
  }

  /**
   * After a BRUSH moved `points`: the normals and the drawn positions of just the triangles around them. The full
   * refresh walks every triangle in the model, which is fine once per edit and far too slow sixty times a second.
   * Costs the brush's footprint, not the model: A are the triangles of the moved points, B the ring around them,
   * whose corner normals average a neighbour that has changed.
   */
  refreshLocal(points) {
    const { cp, vis, pos, fnRaw, fnUnit, ptN, T, P } = this;
    const { pfOff, pf } = this.adj;
    if (!this._mT || this._mT.length !== T || this._mP.length !== P) {
      this._mT = new Int32Array(T);
      this._mP = new Int32Array(P);
      this._tick = 0;
    }
    const mT = this._mT, mP = this._mP;
    const a1 = ++this._tick, triA = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      for (let j = pfOff[p], e = pfOff[p + 1]; j < e; j++) { const t = pf[j]; if (mT[t] !== a1) { mT[t] = a1; triA.push(t); } }
    }
    for (const t of triA) {
      const A = 3 * cp[3 * t], B = 3 * cp[3 * t + 1], C = 3 * cp[3 * t + 2];
      const ux = pos[B] - pos[A], uy = pos[B + 1] - pos[A + 1], uz = pos[B + 2] - pos[A + 2];
      const vx = pos[C] - pos[A], vy = pos[C + 1] - pos[A + 1], vz = pos[C + 2] - pos[A + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (!vis[t]) { nx = 0; ny = 0; nz = 0; }
      fnRaw[3 * t] = nx; fnRaw[3 * t + 1] = ny; fnRaw[3 * t + 2] = nz;
      const l = Math.hypot(nx, ny, nz) || 1;
      fnUnit[3 * t] = nx / l; fnUnit[3 * t + 1] = ny / l; fnUnit[3 * t + 2] = nz / l;
    }
    const a2 = ++this._tick, ptsB = [];
    for (const t of triA) for (let k = 0; k < 3; k++) { const p = cp[3 * t + k]; if (mP[p] !== a2) { mP[p] = a2; ptsB.push(p); } }
    for (const p of ptsB) {
      let sx = 0, sy = 0, sz = 0;
      for (let j = pfOff[p], e = pfOff[p + 1]; j < e; j++) {
        const t = pf[j];
        if (!vis[t]) continue;
        sx += fnRaw[3 * t]; sy += fnRaw[3 * t + 1]; sz += fnRaw[3 * t + 2];
      }
      const l = Math.hypot(sx, sy, sz) || 1;
      ptN[3 * p] = sx / l; ptN[3 * p + 1] = sy / l; ptN[3 * p + 2] = sz / l;
    }
    const a3 = ++this._tick, out = this.aNor.array;
    for (const p of ptsB) {
      for (let j = pfOff[p], e = pfOff[p + 1]; j < e; j++) {
        const f = pf[j];
        if (mT[f] === a3) continue;
        mT[f] = a3;
        const ux = fnUnit[3 * f], uy = fnUnit[3 * f + 1], uz = fnUnit[3 * f + 2];
        for (let k = 0; k < 3; k++) {
          const q = cp[3 * f + k];
          let sx = 0, sy = 0, sz = 0;
          for (let i2 = pfOff[q], e2 = pfOff[q + 1]; i2 < e2; i2++) {
            const g = pf[i2];
            if (!vis[g]) continue;
            if (ux * fnUnit[3 * g] + uy * fnUnit[3 * g + 1] + uz * fnUnit[3 * g + 2] >= COS_CREASE) { sx += fnRaw[3 * g]; sy += fnRaw[3 * g + 1]; sz += fnRaw[3 * g + 2]; }
          }
          const l = Math.hypot(sx, sy, sz), o = 9 * f + 3 * k;
          if (l < 1e-20) { out[o] = ux; out[o + 1] = uy; out[o + 2] = uz; } else { out[o] = sx / l; out[o + 1] = sy / l; out[o + 2] = sz / l; }
        }
      }
    }
    this.aNor.needsUpdate = true;
    this.writePositionsAround(points);
  }

  /** A dead or hidden triangle collapses onto its first corner, so it draws nothing and cannot be picked. */
  writePositions() {
    const out = this.aPos.array, { cp, vis, pos, T } = this;
    for (let t = 0; t < T; t++) {
      for (let k = 0; k < 3; k++) {
        const p = 3 * (vis[t] ? cp[3 * t + k] : cp[3 * t]), o = 9 * t + 3 * k;
        out[o] = pos[p]; out[o + 1] = pos[p + 1]; out[o + 2] = pos[p + 2];
      }
    }
    this.aPos.needsUpdate = true;
  }

  /** Only the triangles around the given points (a Move drag, 60 times a second). */
  writePositionsAround(points) {
    const out = this.aPos.array, { cp, vis, pos } = this, { pfOff, pf } = this.adj;
    for (const p of points) {
      for (let j = pfOff[p], e = pfOff[p + 1]; j < e; j++) {
        const t = pf[j];
        for (let k = 0; k < 3; k++) {
          const q = 3 * (vis[t] ? cp[3 * t + k] : cp[3 * t]), o = 9 * t + 3 * k;
          out[o] = pos[q]; out[o + 1] = pos[q + 1]; out[o + 2] = pos[q + 2];
        }
      }
    }
    this.aPos.needsUpdate = true;
  }

  bounds() {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const { pos, ptVis, P } = this;
    let any = false;
    for (let p = 0; p < P; p++) {
      if (!ptVis[p]) continue;
      const x = pos[3 * p], y = pos[3 * p + 1], z = pos[3 * p + 2];
      if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) continue;
      any = true;
      if (x < lo[0]) lo[0] = x; if (x > hi[0]) hi[0] = x;
      if (y < lo[1]) lo[1] = y; if (y > hi[1]) hi[1] = y;
      if (z < lo[2]) lo[2] = z; if (z > hi[2]) hi[2] = z;
    }
    if (!any) { lo.fill(-1); hi.fill(1); }
    this.lo = lo;
    this.hi = hi;
    this.center = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    this.diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
    this.longest = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
    this.radius = this.diag / 2;
  }

  /** Colours for the look, then the selection and the two Sharpen edge panels on top. */
  writeColours(look, tint = true, selActive = true) {
    const out = this.aCol.array, { cp, T, colours, sel, panelA, panelB } = this;
    const nrm = this.aNor.array;
    const textured = look === "color" && !!this.aUv;
    for (let c = 0; c < 3 * T; c++) {
      const p = cp[c];
      let r, g, b;
      if (look === "color") {
        if (textured) { r = g = b = 1; } else if (colours) { r = colours[3 * p]; g = colours[3 * p + 1]; b = colours[3 * p + 2]; } else { r = g = b = 0.8; }
      } else if (look === "normal") {
        r = nrm[3 * c] * 0.5 + 0.5; g = nrm[3 * c + 1] * 0.5 + 0.5; b = nrm[3 * c + 2] * 0.5 + 0.5;
      } else {
        r = g = b = CLAY;
      }
      if (tint) {
        // The two Sharpen edge panels always show at full strength: they are only ever set while that tool is in
        // use, so they cannot go stale. The SELECTION can: it survives a mode switch on purpose (losing a careful
        // pick just for looking at another mode would be worse), so it is dimmed wherever nothing can act on it.
        let tc = null, mix = SEL_MIX;
        if (panelA && panelA[p]) tc = BLUE;
        else if (panelB && panelB[p]) tc = GREEN;
        else if (sel[p]) { tc = SEL; mix = selActive ? SEL_MIX : SEL_MIX_IDLE; }
        if (tc) { const k = 1 - mix; r = r * k + tc[0] * mix; g = g * k + tc[1] * mix; b = b * k + tc[2] * mix; }
      }
      out[3 * c] = r; out[3 * c + 1] = g; out[3 * c + 2] = b;
    }
    this.aCol.needsUpdate = true;
  }

  applyLook(look, xray) {
    const m = this.material;
    const wantMap = look === "color" && this.aUv ? this.texture : null;
    if (m.map !== wantMap) { m.map = wantMap; m.needsUpdate = true; }
    m.transparent = !!xray;
    m.opacity = xray ? 0.38 : 1;
    m.depthWrite = !xray;
    m.needsUpdate = true;
    if (look === "wire") this.ensureWire();
    if (this.wire) this.wire.visible = look === "wire";
  }

  /** The real polygon edges (a quad shows as a quad, not two triangles), for the Wire look. */
  ensureWire() {
    const THREE = this.THREE;
    if (!this.wire) {
      this.wire = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x1b1d20, transparent: true, opacity: 0.85 }));
      this.wire.frustumCulled = false;
      this.wire.renderOrder = 1;
      this.wireDirty = true;
    }
    if (!this.wireDirty) return;
    this.wireDirty = false;
    const { counts, indices, starts, alive, hidden, pos, F, P } = this;
    const keys = [];
    for (let f = 0; f < F; f++) {
      if (!alive[f] || hidden[f]) continue;
      const s = starts[f], n = counts[f];
      for (let k = 0; k < n; k++) {
        const a = indices[s + k], b = indices[s + ((k + 1) % n)];
        if (a !== b) keys.push(a < b ? a * P + b : b * P + a);
      }
    }
    const sorted = Float64Array.from(keys).sort();
    const arr = new Float32Array(6 * sorted.length);
    let e = 0;
    for (let i = 0; i < sorted.length; i++) {
      if (i && sorted[i] === sorted[i - 1]) continue;
      const a = Math.floor(sorted[i] / P), b = sorted[i] % P;
      arr[6 * e] = pos[3 * a]; arr[6 * e + 1] = pos[3 * a + 1]; arr[6 * e + 2] = pos[3 * a + 2];
      arr[6 * e + 3] = pos[3 * b]; arr[6 * e + 4] = pos[3 * b + 1]; arr[6 * e + 5] = pos[3 * b + 2];
      e++;
    }
    this.wire.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(arr.subarray(0, 6 * e), 3));
    this.wire.geometry = g;
  }

  /** Open and broken edges, pieces and polygon counts. Hidden polygons still count: hiding only changes the view. */
  runCensus() {
    const c = census(null, this.P, this.counts, this.indices, this.alive);
    Object.assign(this.stats, { alive: c.alive, open: c.open, broken: c.broken, pieces: c.pieces, tiny: c.tiny, quads: c.quads, triangles: c.triangles, ngons: c.ngons });
    this.faceComp = c.faceComp;
    this.pieceSizes = c.pieceSizes;
    this.openEdges = c.openEdges;
    this.brokenEdges = c.brokenEdges;
    this.censusDirty = false;
    this.updateMarkers();
    return this.stats;
  }

  updateMarkers() {
    const THREE = this.THREE;
    if (!this.markers) {
      const mk = (color, size) => {
        const pts = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: false }));
        pts.renderOrder = 3;
        pts.frustumCulled = false;
        pts.visible = false;
        return pts;
      };
      this.markers = { open: mk(0xff4d4d, 7), broken: mk(0xffc233, 5) };
    }
    const mids = (list) => {
      const out = new Float32Array(3 * (list.length / 2)), pos = this.pos;
      for (let i = 0, e = 0; i < list.length; i += 2, e++) {
        const a = 3 * list[i], b = 3 * list[i + 1];
        out[3 * e] = (pos[a] + pos[b]) / 2; out[3 * e + 1] = (pos[a + 1] + pos[b + 1]) / 2; out[3 * e + 2] = (pos[a + 2] + pos[b + 2]) / 2;
      }
      return out;
    };
    for (const [key, list] of [["open", this.openEdges], ["broken", this.brokenEdges]]) {
      const m = this.markers[key];
      m.geometry.dispose();
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(mids(list || new Int32Array(0)), 3));
      m.geometry = g;
    }
  }

  // ── the brush grid: a stamp visits only the points in the cells around it ──
  ensureGrid(size) {
    const cell = Math.max(size, this.longest / 1024);
    if (!this.gridDirty && this.grid && this.gridCell >= cell * 0.8 && this.gridCell <= cell * 1.6) return;
    const { P, pos } = this, lo = this.lo, inv = 1 / cell;
    const keys = new Int32Array(P);
    const counts = new Map();
    for (let p = 0; p < P; p++) {
      const ix = Math.min(1023, Math.max(0, Math.floor((pos[3 * p] - lo[0]) * inv)));
      const iy = Math.min(1023, Math.max(0, Math.floor((pos[3 * p + 1] - lo[1]) * inv)));
      const iz = Math.min(1023, Math.max(0, Math.floor((pos[3 * p + 2] - lo[2]) * inv)));
      const key = (ix * 1024 + iy) * 1024 + iz;
      keys[p] = key;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const cells = new Map();
    for (const [k, n] of counts) cells.set(k, { list: new Int32Array(n), n: 0 });
    for (let p = 0; p < P; p++) { const c = cells.get(keys[p]); c.list[c.n++] = p; }
    this.grid = cells;
    this.gridCell = cell;
    this.gridLo = lo.slice();
    this.gridDirty = false;
  }

  /** Calls fn(p) for every point within r of (x, y, z), visible or not. */
  pointsNear(x, y, z, r, fn) {
    const cell = this.gridCell, lo = this.gridLo, inv = 1 / cell, reach = Math.ceil(r * inv);
    const cx = Math.floor((x - lo[0]) * inv), cy = Math.floor((y - lo[1]) * inv), cz = Math.floor((z - lo[2]) * inv);
    const r2 = r * r, pos = this.pos;
    for (let ix = cx - reach; ix <= cx + reach; ix++) {
      if (ix < 0 || ix > 1023) continue;
      for (let iy = cy - reach; iy <= cy + reach; iy++) {
        if (iy < 0 || iy > 1023) continue;
        for (let iz = cz - reach; iz <= cz + reach; iz++) {
          if (iz < 0 || iz > 1023) continue;
          const c = this.grid.get((ix * 1024 + iy) * 1024 + iz);
          if (!c) continue;
          for (let i = 0; i < c.n; i++) {
            const p = c.list[i], dx = pos[3 * p] - x, dy = pos[3 * p + 1] - y, dz = pos[3 * p + 2] - z;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 <= r2) fn(p, d2);
          }
        }
      }
    }
  }

  // ── selection ──
  selectedCount() {
    let n = 0;
    for (let p = 0; p < this.P; p++) n += this.sel[p];
    return n;
  }
  polySelected(f) {
    const s = this.starts[f], n = this.counts[f];
    for (let k = 0; k < n; k++) if (!this.sel[this.indices[s + k]]) return false;
    return true;
  }
  selectAll() { for (let p = 0; p < this.P; p++) this.sel[p] = this.ptVis[p]; }
  clearSelection() { this.sel.fill(0); this.panelA = this.panelB = this.panelAFaces = this.panelBFaces = null; }
  invertSelection() { for (let p = 0; p < this.P; p++) this.sel[p] = this.sel[p] || !this.ptVis[p] ? 0 : 1; }
  growSelection() {
    const { nbOff, nb } = this.adj, add = [];
    for (let p = 0; p < this.P; p++) if (this.sel[p]) for (let j = nbOff[p], e = nbOff[p + 1]; j < e; j++) if (!this.sel[nb[j]] && this.ptVis[nb[j]]) add.push(nb[j]);
    for (const q of add) this.sel[q] = 1;
  }
  shrinkSelection() {
    const { nbOff, nb } = this.adj, rem = [];
    for (let p = 0; p < this.P; p++) {
      if (!this.sel[p]) continue;
      for (let j = nbOff[p], e = nbOff[p + 1]; j < e; j++) if (!this.sel[nb[j]]) { rem.push(p); break; }
    }
    for (const p of rem) this.sel[p] = 0;
  }
  /** -> polygons hidden */
  hideSelected() {
    let n = 0;
    for (let f = 0; f < this.F; f++) if (this.alive[f] && !this.hidden[f] && this.polySelected(f)) { this.hidden[f] = 1; n++; }
    return n;
  }
  /** -> polygons hidden, or -1 when nothing is selected */
  isolateSelected() {
    const keep = new Uint8Array(this.F);
    let kept = 0, n = 0;
    for (let f = 0; f < this.F; f++) if (this.alive[f] && !this.hidden[f] && this.polySelected(f)) { keep[f] = 1; kept++; }
    if (!kept) return -1; // nothing selected: what was hidden before stays hidden
    for (let f = 0; f < this.F; f++) if (this.alive[f] && !this.hidden[f] && !keep[f]) { this.hidden[f] = 1; n++; }
    return n;
  }
  showAll() { this.hidden.fill(0); }
  /**
   * Polygons with SOME corners selected but not all: Delete, Hide and Isolate all need every corner, so these are
   * skipped. On a quad model that is the usual case at the edge of a Panel selection - a quad straddling the panel
   * boundary belongs half to each side, and leaving it is the conservative choice (taking it would bite into the
   * neighbouring panel, which an Undo is the only way back from). MEASURED on a 48,643-quad gun: one Panel click on
   * the grip touched 622 quads, 491 fully selected and 131 not, of which 128 were on the selection rim. Counted so
   * the fringe can be NAMED rather than silently left behind.
   * -> polygons skipped
   */
  partlySelectedCount() {
    let n = 0;
    for (let f = 0; f < this.F; f++) {
      if (!this.alive[f] || this.hidden[f]) continue;
      const s = this.starts[f], k = this.counts[f];
      let any = false, all = true;
      for (let c = 0; c < k; c++) { if (this.sel[this.indices[s + c]]) any = true; else all = false; }
      if (any && !all) n++;
    }
    return n;
  }

  /** -> polygons deleted */
  deleteSelected() {
    let n = 0;
    for (let f = 0; f < this.F; f++) if (this.alive[f] && !this.hidden[f] && this.polySelected(f)) { this.alive[f] = 0; n++; }
    return n;
  }

  // ── undo ──
  snapshot(kind = "pos") {
    // Hide / Isolate are a way of looking, not an edit: an undo never brings back what the user hid since.
    if (kind === "pos") {
      return { kind, pos: this.pos.slice(), alive: this.alive.slice(), bytes: this.pos.byteLength + this.F };
    }
    const s = {
      kind: "all", P: this.P, pos: this.pos.slice(), colours: this.colours ? this.colours.slice() : null, counts: this.counts.slice(),
      indices: this.indices.slice(), cornerUv: this.cornerUv ? this.cornerUv.slice() : null, alive: this.alive.slice(), hidden: this.hidden.slice(),
      texture: this.texture, flipUv: this.flipUv,
    };
    s.bytes = s.pos.byteLength + (s.colours?.byteLength || 0) + s.counts.byteLength + s.indices.byteLength + (s.cornerUv?.byteLength || 0) + 2 * this.F;
    return s;
  }
  restore(s) {
    if (s.kind === "pos") {
      if (s.pos.length !== this.pos.length || s.alive.length !== this.F) throw new Error("the history is out of step with the model");
      this.pos.set(s.pos);
      this.alive.set(s.alive);
      this.refreshGeometry();
      return;
    }
    const keepHidden = s.counts.length === this.F ? this.hidden : null;
    this.P = s.P;
    this.pos = s.pos.slice();
    this.colours = s.colours ? s.colours.slice() : null;
    this.counts = s.counts.slice();
    this.indices = s.indices.slice();
    this.cornerUv = s.cornerUv ? s.cornerUv.slice() : null;
    this.texture = s.texture;
    this.flipUv = s.flipUv;
    this.F = this.counts.length;
    this.alive = s.alive.slice();
    this.hidden = keepHidden || s.hidden.slice();
    this.sel = new Uint8Array(this.P);
    this._derive();
    this.refreshGeometry();
  }

  /** Simplify: merge the short edges among `points` (the brush's footprint). Rebuilds everything, because the
   *  polygons themselves change. -> { collapsed, killed } */
  simplifyUnder(points, maxLen, maxCollapses) {
    const allow = new Uint8Array(this.P);
    for (const p of points) allow[p] = 1;
    const r = collapseShortEdges(this.pos, this.P, this.counts, this.indices, this.alive, this.hidden, this.cornerUv, allow, maxLen, maxCollapses);
    if (!r.collapsed) return r;
    this.counts = r.counts;
    this.indices = r.indices;
    this.alive = r.alive;
    this.hidden = r.hidden;
    this.cornerUv = r.cornerUv;
    this.F = this.counts.length;
    this.rebuild();
    return r;
  }

  /**
   * Add detail: split the edges among `points` (the brush's footprint). The point count GROWS, which is what makes
   * this different from every other edit, so the colours and the selection are carried across HERE: `_derive` hands
   * back a blank selection whenever the length changes (it would wipe the user's Protect painting on every stamp),
   * and a new point with no colour of its own is a black dot on a vertex-coloured AI model. -> { split, added }
   */
  detailUnder(points, minLen, maxSplits) {
    const allow = new Uint8Array(this.P);
    for (const p of points) allow[p] = 1;
    const r = subdivideUnder(this.pos, this.P, this.counts, this.indices, this.alive, this.hidden, this.cornerUv, allow, minLen, maxSplits);
    if (!r.split) return r;
    const P0 = this.P, P1 = r.P;
    const colours = this.colours ? new Float32Array(3 * P1) : null;
    if (colours) colours.set(this.colours);
    const sel = new Uint8Array(P1);
    sel.set(this.sel);
    for (let i = 0; i < P1 - P0; i++) {
      const a = r.srcOff[i], b = r.srcOff[i + 1], n = b - a || 1;
      let all = b > a;
      for (let j = a; j < b; j++) {
        const q = r.srcList[j];
        if (colours) for (let c = 0; c < 3; c++) colours[3 * (P0 + i) + c] += this.colours[3 * q + c] / n;
        if (!this.sel[q]) all = false;
      }
      // A new point is picked only when every point it sits between was, so a protected patch keeps its own border.
      sel[P0 + i] = all ? 1 : 0;
    }
    this.pos = r.pos;
    this.P = P1;
    this.colours = colours;
    this.sel = sel;
    this.counts = r.counts;
    this.indices = r.indices;
    this.alive = r.alive;
    this.hidden = r.hidden;
    this.cornerUv = r.cornerUv;
    this.F = this.counts.length;
    this.rebuild();
    return r;
  }

  /** After counts or indices were changed in place (Close cracks): the triangles, the adjacency and the buffers again. */
  rebuild() {
    this._derive();
    this.refreshGeometry();
  }

  /** Swap in a whole new model (a heavy button's result); the texture goes, its colours stay. */
  replaceWith(src) {
    this.texture = src.texture || null;
    this.flipUv = !!(src.texture && src.texture.flipY);
    this.material.map = null;
    this._init(src.positions, src.counts, src.indices, src.colours, src.uvs);
    this.refreshGeometry();
  }

  /** The uv each point first appears with, for the corners of a fill. */
  pointUvs() {
    if (!this.cornerUv) return null;
    const out = new Float32Array(2 * this.P), has = new Uint8Array(this.P);
    for (let k = 0; k < this.indices.length; k++) {
      const p = this.indices[k];
      if (has[p]) continue;
      has[p] = 1;
      out[2 * p] = this.cornerUv[2 * k];
      out[2 * p + 1] = this.cornerUv[2 * k + 1];
    }
    return out;
  }

  /** Add polygons (a fill). addIdx may name new points P, P+1, ... given in newPoints (xyz). -> polygons added */
  appendPolys(addCounts, addIdx, newPoints) {
    const k = newPoints.length / 3, P0 = this.P, P1 = P0 + k;
    const ptUv = this.pointUvs();
    if (k) {
      const pos = new Float32Array(3 * P1);
      pos.set(this.pos);
      pos.set(newPoints, 3 * P0);
      this.pos = pos;
      if (this.colours) {
        const col = new Float32Array(3 * P1).fill(1);
        col.set(this.colours);
        this.colours = col;
      }
      const sel = new Uint8Array(P1);
      sel.set(this.sel);
      this.sel = sel;
      this.P = P1;
    }
    // A new point takes the colour and uv of the loop it closes (the average of the corners it is fanned from).
    const newCol = this.colours ? new Float32Array(3 * k) : null, newUv = ptUv ? new Float32Array(2 * k) : null, used = new Int32Array(k);
    // EVERY new corner of a face, not just the last one found. The old loop kept a single `centre`, which is right
    // for a fan (one new point per triangle) and silently wrong for any fill that adds more than one: a new point
    // that is never the last on any of its faces ends with used = 0, keeps the colour zero it was allocated with,
    // and renders as a BLACK DOT on a vertex-coloured model. With exactly one new point per face this is
    // byte-identical to what it did before, so nothing that fills today can change behaviour.
    let o = 0;
    for (let f = 0; f < addCounts.length; f++) {
      const n = addCounts[f];
      for (let j = 0; j < n; j++) {
        const q = addIdx[o + j];
        if (q < P0) continue;
        const nw = q - P0;
        for (let i = 0; i < n; i++) {
          const p = addIdx[o + i];
          if (p >= P0) continue; // an old corner: the only one carrying a colour to borrow
          used[nw]++;
          if (newCol) for (let c = 0; c < 3; c++) newCol[3 * nw + c] += this.colours[3 * p + c];
          if (newUv) for (let c = 0; c < 2; c++) newUv[2 * nw + c] += ptUv[2 * p + c];
        }
      }
      o += n;
    }
    for (let i = 0; i < k; i++) {
      const d = used[i] || 1;
      if (newCol) for (let c = 0; c < 3; c++) this.colours[3 * (P0 + i) + c] = newCol[3 * i + c] / d;
    }
    const F0 = this.F, add = addCounts.length;
    const counts = new Int32Array(F0 + add);
    counts.set(this.counts);
    counts.set(addCounts, F0);
    const indices = new Uint32Array(this.indices.length + addIdx.length);
    indices.set(this.indices);
    indices.set(addIdx, this.indices.length);
    if (this.cornerUv) {
      const uv = new Float32Array(2 * indices.length);
      uv.set(this.cornerUv);
      for (let j = 0; j < addIdx.length; j++) {
        const p = addIdx[j], at = 2 * (this.indices.length + j);
        if (p >= P0) { const i = p - P0, d = used[i] || 1; uv[at] = newUv[2 * i] / d; uv[at + 1] = newUv[2 * i + 1] / d; } else { uv[at] = ptUv[2 * p]; uv[at + 1] = ptUv[2 * p + 1]; }
      }
      this.cornerUv = uv;
    }
    const alive = new Uint8Array(F0 + add).fill(1);
    alive.set(this.alive);
    const hidden = new Uint8Array(F0 + add);
    hidden.set(this.hidden);
    this.counts = counts;
    this.indices = indices;
    this.alive = alive;
    this.hidden = hidden;
    this.F = F0 + add;
    this._derive();
    this.refreshGeometry();
    return add;
  }

  // ── saving ──
  /** The live polygons with the points they use renumbered: what objio.writeObj takes. Hidden polygons are kept. */
  toObjModel() {
    const used = new Int32Array(this.P).fill(-1);
    let n = 0, C = 0, F = 0;
    for (let f = 0; f < this.F; f++) if (this.alive[f]) { F++; C += this.counts[f]; }
    const counts = new Int32Array(F), indices = new Uint32Array(C);
    let fo = 0, co = 0;
    for (let f = 0; f < this.F; f++) {
      if (!this.alive[f]) continue;
      const s = this.starts[f], k = this.counts[f];
      counts[fo++] = k;
      for (let j = 0; j < k; j++) {
        const p = this.indices[s + j];
        if (used[p] < 0) used[p] = n++;
        indices[co++] = used[p];
      }
    }
    const positions = new Float32Array(3 * n), colours = this.colours ? new Float32Array(3 * n) : null;
    for (let p = 0; p < this.P; p++) {
      const q = used[p];
      if (q < 0) continue;
      positions[3 * q] = this.pos[3 * p]; positions[3 * q + 1] = this.pos[3 * p + 1]; positions[3 * q + 2] = this.pos[3 * p + 2];
      if (colours) { colours[3 * q] = this.colours[3 * p]; colours[3 * q + 1] = this.colours[3 * p + 1]; colours[3 * q + 2] = this.colours[3 * p + 2]; }
    }
    return { positions, colours, counts, indices, groups: null, groupNames: [] };
  }

  /** The live polygons as triangles for GLB and STL. With `uv` a point is split wherever its corners carry different uvs,
   *  so a texture seam keeps both sides. uvs come out in glTF's convention (v down). */
  toTriangles(uv = false) {
    const useUv = uv && !!this.cornerUv;
    const map = new Map(), vpt = [], vuv = [];
    const idxs = [];
    const vertexOf = (p, k) => {
      let key = p;
      if (useUv) key = `${p}|${this.cornerUv[2 * k]}|${this.cornerUv[2 * k + 1]}`;
      let v = map.get(key);
      if (v === undefined) {
        v = vpt.length;
        map.set(key, v);
        vpt.push(p);
        if (useUv) vuv.push(this.cornerUv[2 * k], this.flipUv ? 1 - this.cornerUv[2 * k + 1] : this.cornerUv[2 * k + 1]);
      }
      return v;
    };
    for (let t = 0; t < this.T; t++) {
      if (!this.alive[this.triPoly[t]]) continue;
      for (let j = 0; j < 3; j++) idxs.push(vertexOf(this.cp[3 * t + j], this.triCorner[3 * t + j]));
    }
    const V = vpt.length, positions = new Float32Array(3 * V), normals = new Float32Array(3 * V);
    const colours = this.colours ? new Float32Array(3 * V) : null;
    for (let v = 0; v < V; v++) {
      const p = vpt[v];
      positions[3 * v] = this.pos[3 * p]; positions[3 * v + 1] = this.pos[3 * p + 1]; positions[3 * v + 2] = this.pos[3 * p + 2];
      if (colours) { colours[3 * v] = this.colours[3 * p]; colours[3 * v + 1] = this.colours[3 * p + 1]; colours[3 * v + 2] = this.colours[3 * p + 2]; }
    }
    const indices = Uint32Array.from(idxs);
    for (let i = 0; i < indices.length; i += 3) {
      const a = 3 * indices[i], b = 3 * indices[i + 1], c = 3 * indices[i + 2];
      const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
      const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const q of [a, b, c]) { normals[q] += nx; normals[q + 1] += ny; normals[q + 2] += nz; }
    }
    for (let v = 0; v < V; v++) {
      const l = Math.hypot(normals[3 * v], normals[3 * v + 1], normals[3 * v + 2]) || 1;
      normals[3 * v] /= l; normals[3 * v + 1] /= l; normals[3 * v + 2] /= l;
    }
    return { positions, normals, colours, uvs: useUv ? Float32Array.from(vuv) : null, indices };
  }

  /** The texture as PNG bytes, or null. */
  async texturePng() {
    const img = this.texture?.image;
    const w = img?.width || img?.naturalWidth || 0, h = img?.height || img?.naturalHeight || 0;
    if (!w || !h) return null;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d").drawImage(img, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  }

  dispose() {
    this.geometry?.dispose();
    this.idGeometry?.dispose();
    this.material?.dispose();
    this.pickMaterial?.dispose();
    this.seenMaterial?.dispose();
    if (this.wire) { this.wire.geometry.dispose(); this.wire.material.dispose(); }
    if (this.markers) for (const m of Object.values(this.markers)) { m.geometry.dispose(); m.material.dispose(); }
  }
}

/** The source as it came, for Before: one light mesh, never edited. */
export function buildBeforeMesh(THREE, src) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(src.positions, 3));
  let tri = src.indices;
  if (src.counts.some((n) => n !== 3)) {
    const out = [];
    let s = 0;
    for (let f = 0; f < src.counts.length; f++) {
      const n = src.counts[f];
      for (let k = 1; k + 1 < n; k++) out.push(src.indices[s], src.indices[s + k], src.indices[s + k + 1]);
      s += n;
    }
    tri = Uint32Array.from(out);
  }
  geo.setIndex(new THREE.BufferAttribute(tri instanceof Uint32Array ? tri : Uint32Array.from(tri), 1));
  if (src.colours) geo.setAttribute("color", new THREE.BufferAttribute(src.colours, 3));
  if (src.uvs && src.texture) geo.setAttribute("uv", new THREE.BufferAttribute(src.uvs, 2));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0x9e9e9e, roughness: 0.78, metalness: 0, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.userData.setLook = (look, xray) => {
    const color = look === "color";
    mat.map = color && src.texture && src.uvs ? src.texture : null;
    mat.vertexColors = color && !mat.map && !!src.colours;
    mat.color.setHex(color ? 0xffffff : 0x9e9e9e);
    mat.wireframe = look === "wire";
    mat.transparent = !!xray;
    mat.opacity = xray ? 0.38 : 1;
    mat.depthWrite = !xray;
    mat.needsUpdate = true;
  };
  mesh.userData.dispose = () => { geo.dispose(); mat.dispose(); };
  return mesh;
}
