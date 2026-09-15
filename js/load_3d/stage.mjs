// Load 3D Pixaroma engine - the STAGE mode that Save 3D Pixaroma draws with.
//
// Load 3D centres a model in its view and frames a picture. Save 3D instead
// shows the model where its FILE puts it, over a floor at Y = 0, so a floating,
// sunk or off-centre model is visible, with a FRONT arrow on the floor at +Z
// (the glTF front), the model's shadow, an X Y Z marker, the real polygon edges
// in Wire and one colour per panel group in Panels.
//
// engine.mjs calls these only for a node attached with {stage: true}; a Load 3D
// node never reaches this file.

const ACCENT = "#f66744";
const AXES = [
  { key: "X", color: "#f0605a", v: [1, 0, 0] },
  { key: "Y", color: "#7fcf3a", v: [0, 1, 0] },
  { key: "Z", color: "#4d9bff", v: [0, 0, 1] },
];
const IDENTITY_ROWS = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const GOLDEN = 137.508;
// Edges that bend more than this stay sharp when an OBJ is shaded smooth: the default of Blender's Shade Auto Smooth.
export const STAGE_CREASE_DEG = 30;

/**
 * Smooth shading for an OBJ that carries no normals of its own, as every file the 3D nodes write. three's
 * OBJLoader gives such a file one flat normal per triangle, so a quad model looked faceted beside an AI model whose
 * GLB brings smooth normals, and the nodes' results looked worse than they are. Each corner now takes the
 * area-weighted normals of the triangles around its point that bend less than `creaseDeg` from its own triangle:
 * rounded surfaces shade smooth, hard edges stay sharp. Points are matched by their exact position bits, which is
 * safe because OBJLoader copies every corner of one OBJ vertex from the same parsed numbers. Each mesh (one per OBJ
 * group) is smoothed on its own.
 * -> the number of meshes given new normals
 */
export function objCreasedNormals(THREE, object, creaseDeg = STAGE_CREASE_DEG) {
  const cosLimit = Math.cos((creaseDeg * Math.PI) / 180);
  let done = 0;
  object.traverse((o) => {
    const g = o.isMesh ? o.geometry : null;
    const pos = g?.getAttribute?.("position");
    if (!pos || g.index || pos.itemSize !== 3 || !(pos.array instanceof Float32Array)) return;
    const n = pos.count - (pos.count % 3);
    if (n < 3) return;
    const P = pos.array;
    const bits = new Uint32Array(P.buffer, P.byteOffset, pos.count * 3);
    const tris = n / 3;
    const raw = new Float64Array(tris * 3);
    const unit = new Float64Array(tris * 3);
    for (let t = 0; t < tris; t++) {
      const a = t * 9;
      const ux = P[a + 3] - P[a], uy = P[a + 4] - P[a + 1], uz = P[a + 5] - P[a + 2];
      const vx = P[a + 6] - P[a], vy = P[a + 7] - P[a + 1], vz = P[a + 8] - P[a + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      const k = t * 3;
      raw[k] = cx;
      raw[k + 1] = cy;
      raw[k + 2] = cz;
      const len = Math.hypot(cx, cy, cz);
      if (len > 0) {
        unit[k] = cx / len;
        unit[k + 1] = cy / len;
        unit[k + 2] = cz / len;
      }
    }
    // One id per point, from an open-addressing table over the position bits.
    let size = 1;
    while (size < n * 2) size *= 2;
    const table = new Int32Array(size).fill(-1);
    const pid = new Int32Array(n);
    const first = new Int32Array(n);
    let points = 0;
    for (let i = 0; i < n; i++) {
      const b0 = bits[i * 3], b1 = bits[i * 3 + 1], b2 = bits[i * 3 + 2];
      let h = (Math.imul(b0, 0x9e3779b1) ^ Math.imul(b1, 0x85ebca77) ^ Math.imul(b2, 0xc2b2ae3d)) & (size - 1);
      for (;;) {
        const p = table[h];
        if (p < 0) {
          table[h] = points;
          first[points] = i;
          pid[i] = points++;
          break;
        }
        const f = first[p] * 3;
        if (bits[f] === b0 && bits[f + 1] === b1 && bits[f + 2] === b2) {
          pid[i] = p;
          break;
        }
        h = (h + 1) & (size - 1);
      }
    }
    // The triangles around each point.
    const start = new Int32Array(points + 1);
    for (let i = 0; i < n; i++) start[pid[i] + 1]++;
    for (let p = 0; p < points; p++) start[p + 1] += start[p];
    const next = start.slice(0, points);
    const around = new Int32Array(n);
    for (let i = 0; i < n; i++) around[next[pid[i]]++] = (i / 3) | 0;
    const out = new Float32Array(pos.count * 3);
    for (let i = 0; i < n; i++) {
      const k = ((i / 3) | 0) * 3;
      const tx = unit[k], ty = unit[k + 1], tz = unit[k + 2];
      let sx = 0, sy = 0, sz = 0;
      for (let j = start[pid[i]], end = start[pid[i] + 1]; j < end; j++) {
        const u = around[j] * 3;
        if (unit[u] * tx + unit[u + 1] * ty + unit[u + 2] * tz >= cosLimit) {
          sx += raw[u];
          sy += raw[u + 1];
          sz += raw[u + 2];
        }
      }
      const len = Math.hypot(sx, sy, sz);
      out[i * 3] = len > 0 ? sx / len : tx;
      out[i * 3 + 1] = len > 0 ? sy / len : ty;
      out[i * 3 + 2] = len > 0 ? sz / len : tz;
    }
    g.setAttribute("normal", new THREE.BufferAttribute(out, 3));
    done++;
  });
  return done;
}

/**
 * The OBJ's own polygon edges (a quad stays a quad), for the Wire look.
 * -> {positions: Float32Array, index: Uint32Array} or null
 */
export function objPolygonEdges(text) {
  const verts = [];
  let a = new Uint32Array(1 << 16);
  let b = new Uint32Array(1 << 16);
  let m = 0;
  const push = (x, y) => {
    if (m === a.length) {
      const na = new Uint32Array(a.length * 2);
      na.set(a);
      a = na;
      const nb = new Uint32Array(b.length * 2);
      nb.set(b);
      b = nb;
    }
    if (x < y) {
      a[m] = x;
      b[m] = y;
    } else {
      a[m] = y;
      b[m] = x;
    }
    m++;
  };
  let nv = 0;
  const n = text.length;
  let i = 0;
  while (i < n) {
    let j = text.indexOf("\n", i);
    if (j < 0) j = n;
    const c0 = text.charCodeAt(i);
    const c1 = text.charCodeAt(i + 1);
    if (c0 === 118 && (c1 === 32 || c1 === 9)) {
      const parts = text.slice(i + 2, j).trim().split(/\s+/);
      verts.push(+parts[0] || 0, +parts[1] || 0, +parts[2] || 0);
      nv++;
    } else if (c0 === 102 && (c1 === 32 || c1 === 9)) {
      const ids = [];
      for (const tok of text.slice(i + 2, j).trim().split(/\s+/)) {
        const head = tok.split("/")[0];
        if (!head) continue;
        const k = parseInt(head, 10);
        const id = k > 0 ? k - 1 : nv + k;
        if (id >= 0 && id < nv) ids.push(id);
      }
      if (ids.length >= 3) {
        for (let q = 0; q < ids.length; q++) {
          const x = ids[q];
          const y = ids[(q + 1) % ids.length];
          if (x !== y) push(x, y);
        }
      }
    }
    i = j + 1;
  }
  if (!m || !nv) return null;
  const keys = new Float64Array(m);
  for (let q = 0; q < m; q++) keys[q] = a[q] * nv + b[q];
  keys.sort();
  const index = [];
  let last = -1;
  for (let q = 0; q < m; q++) {
    const k = keys[q];
    if (k === last) continue;
    last = k;
    const lo = Math.floor(k / nv);
    index.push(lo, k - lo * nv);
  }
  return { positions: new Float32Array(verts), index: new Uint32Array(index) };
}

function disposeTree(root) {
  root.traverse?.((o) => {
    o.geometry?.dispose?.();
    for (const mat of [].concat(o.material || [])) {
      mat?.map?.dispose?.();
      mat?.dispose?.();
    }
  });
}

/**
 * Put the model where the node wants it shown and build the floor around it.
 * Called before every draw; does nothing while the display is unchanged.
 * `rec.opts.display(node, fileBox)` returns {rows, box}: the three.js row-major
 * matrix that moves the file to its preview place, and the box it lands in.
 */
export function placeStage(THREE, rec) {
  const v = rec.view;
  const model = rec.model;
  if (!v || !model) return;
  if (!rec.stageBox) {
    v.holder.matrixAutoUpdate = false;
    v.holder.matrix.identity();
    v.holder.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(model.object, true);
    rec.stageBox = b.isEmpty()
      ? { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] }
      : { min: b.min.toArray(), max: b.max.toArray() };
  }
  let d = null;
  try {
    d = rec.opts?.display?.(rec.node, rec.stageBox) || null;
  } catch (e) {
    console.warn("[Pixaroma.Save3D] the preview transform failed", e);
  }
  const rows = Array.isArray(d?.rows) && d.rows.length === 16 ? d.rows : IDENTITY_ROWS;
  const box = d?.box || rec.stageBox;
  const accent = rec.opts?.accent?.(rec.node) || ACCENT;
  const key = `${rows.join(",")}|${box.min.join(",")}|${box.max.join(",")}|${accent}`;
  if (v.stageKey === key && v.stage) return;
  v.stageKey = key;
  v.holder.matrixAutoUpdate = false;
  v.holder.matrix.set(...rows);
  v.holder.updateMatrixWorld(true);
  const size = [0, 1, 2].map((i) => box.max[i] - box.min[i]);
  const geo = floorGeometry(box, size);
  // The camera orbits around the MODEL's own centre, as in Load 3D. Centring on model +
  // floor + arrow swung the model around a point in front of and below it while dragging
  // (user report 2026-09-15). The camera distance (radius) and the depth box (half) still
  // cover the floor under the model and the FRONT arrow with its word, so the word is not
  // cut off in a 3/4 view. The framing ignores the switches, so turning the arrow off
  // never moves the camera.
  const c = [0, 1, 2].map((i) => (box.min[i] + box.max[i]) / 2);
  const points = [];
  for (const x of [box.min[0], box.max[0]]) {
    for (const z of [box.min[2], box.max[2]]) {
      for (const y of [box.min[1], box.max[1], 0]) points.push([x, y, z]);
    }
  }
  for (const x of [geo.cx - geo.labelW / 2, geo.cx + geo.labelW / 2]) {
    for (const z of [geo.z0, geo.reach]) points.push([x, 0, z]);
  }
  const half = [0, 0, 0];
  let radius = 1e-6;
  for (const p of points) {
    radius = Math.max(radius, Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]));
    for (let i = 0; i < 3; i++) half[i] = Math.max(half[i], Math.abs(p[i] - c[i]));
  }
  v.center = new THREE.Vector3(c[0], c[1], c[2]);
  v.half = new THREE.Vector3(half[0], half[1], half[2]);
  v.radius = radius;
  buildFloor(THREE, rec, box, accent, geo);
}

/**
 * Where the floor, the arrow and its word go: one place, so the drawing and the framing
 * agree. Compact on purpose: the view is framed from the model's centre, so every bit the
 * arrow reaches past the model makes the model smaller on the node.
 */
function floorGeometry(box, size) {
  const span = Math.max(size[0], size[2], size[1] * 0.5, 1e-4);
  const L = span * 0.32;
  const z0 = box.max[2] + span * 0.06;
  const labelW = span * 0.4;
  const labelH = labelW / 4;
  const labelZ = z0 + L + labelH * 0.9;
  return {
    span, L, W: span * 0.06, z0, labelW, labelH, labelZ, reach: labelZ + labelH / 2,
    cx: (box.min[0] + box.max[0]) / 2,
    cz: (box.min[2] + box.max[2]) / 2,
  };
}

function buildFloor(THREE, rec, box, accent, geo) {
  const v = rec.view;
  if (v.stage) {
    v.scene.remove(v.stage.group);
    disposeTree(v.stage.group);
  }
  const group = new THREE.Group();
  const { span, cx, cz } = geo;
  const size = [0, 1, 2].map((i) => box.max[i] - box.min[i]);
  const floorSize = span * 3;

  const grid = new THREE.GridHelper(floorSize, 12, 0x707070, 0x3c3c3c);
  grid.material.transparent = true;
  grid.material.opacity = 0.6;
  grid.material.depthWrite = false;
  grid.position.set(cx, 0, cz);
  group.add(grid);

  // The shadow: an overhead light that only casts (intensity 0, so the look is
  // unchanged) onto a floor that shows nothing but shadow. depthWrite off, so a
  // sunk model is still seen through the floor.
  const floorMat = new THREE.ShadowMaterial({ opacity: 0.32 });
  floorMat.depthWrite = false;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(floorSize, floorSize), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0, cz);
  floor.receiveShadow = true;
  group.add(floor);
  const light = new THREE.DirectionalLight(0xffffff, 0);
  light.castShadow = true;
  light.position.set(cx, Math.max(box.max[1], 0) + span * 2, cz);
  light.target.position.set(cx, 0, cz);
  const ext = Math.max(size[0], size[2]) * 0.75 + span * 0.1;
  const scam = light.shadow.camera;
  scam.left = -ext;
  scam.right = ext;
  scam.top = ext;
  scam.bottom = -ext;
  scam.near = span * 0.001;
  scam.far = light.position.y + Math.abs(Math.min(box.min[1], 0)) + span;
  scam.updateProjectionMatrix();
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.bias = -0.0005;
  group.add(light, light.target);

  // FRONT: a flat arrow on the floor in front of the model, pointing +Z, and the
  // word beyond its head, readable from the front. Sizes from floorGeometry, which
  // the framing reads too.
  const { L, W, z0, labelW, labelH, labelZ } = geo;
  const shape = new THREE.Shape();
  shape.moveTo(-W / 2, 0);
  shape.lineTo(W / 2, 0);
  shape.lineTo(W / 2, L * 0.62);
  shape.lineTo(W * 1.6, L * 0.62);
  shape.lineTo(0, L);
  shape.lineTo(-W * 1.6, L * 0.62);
  shape.lineTo(-W / 2, L * 0.62);
  shape.closePath();
  const arrow = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ color: accent, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false }),
  );
  arrow.rotation.x = Math.PI / 2;
  arrow.position.set(cx, span * 0.002, z0);
  group.add(arrow);

  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const g = canvas.getContext("2d");
  if (g) {
    g.font = "700 44px ui-sans-serif, system-ui, sans-serif";
    g.fillStyle = accent;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("FRONT", 128, 34);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(labelW, labelH),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
  );
  label.rotation.x = -Math.PI / 2;
  label.position.set(cx, span * 0.002, labelZ);
  group.add(label);

  for (const mesh of rec.model?.meshes || []) mesh.castShadow = true;
  v.scene.add(group);
  v.stage = { group, grid, floor, light, arrow, label };
}

/** Grid, arrow and shadow as the node's switches say. The renderer's shadow is switched off again after the draw. */
export function decorateStage(THREE, r, rec, st, lit) {
  const s = rec.view?.stage;
  if (!s) return;
  s.grid.visible = st.grid !== false && lit;
  const arrow = st.arrow !== false && lit;
  s.arrow.visible = arrow;
  s.label.visible = arrow;
  const shadow = st.shadow !== false && lit;
  s.floor.visible = shadow;
  s.light.castShadow = shadow;
  r.shadowMap.enabled = shadow;
}

/** Panels: one muted colour per mesh (an OBJ group becomes its own mesh). */
export function stageLook(THREE, model, st) {
  if (st.look !== "panels") return;
  model.meshes.forEach((mesh, i) => {
    let mat = model.flat.get(mesh);
    if (!mat) {
      const c = new THREE.Color().setHSL(((i * GOLDEN) % 360) / 360, 0.42, 0.58);
      mat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
      model.flat.set(mesh, mat);
    }
    mesh.material = mat;
  });
}

/** Wire: the OBJ's own polygon edges, or every triangle edge of anything else. */
export function ensureStageWires(THREE, model, lineMaterial) {
  if (model.wires) return;
  model.wires = [];
  if (model.objEdges) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(model.objEdges.positions, 3));
    geo.setIndex(new THREE.BufferAttribute(model.objEdges.index, 1));
    const w = new THREE.LineSegments(geo, lineMaterial);
    w.raycast = () => {};
    w.frustumCulled = false;
    model.object.add(w);
    model.wires.push(w);
    return;
  }
  for (const mesh of model.meshes) {
    if (!mesh.geometry?.getAttribute?.("position")) continue;
    const w = new THREE.LineSegments(new THREE.WireframeGeometry(mesh.geometry), lineMaterial);
    w.raycast = () => {};
    w.frustumCulled = false;
    mesh.add(w);
    model.wires.push(w);
  }
}

/** The X Y Z marker in the top-left corner, turning with the camera. */
export function drawMarker(ctx, cam, bw, bh, sc) {
  const p = cam?.userData?.pix;
  if (!p) return;
  const ox = 30 * sc;
  const oy = 30 * sc;
  const len = 17 * sc;
  const items = AXES.map((ax) => {
    const [x, y, z] = ax.v;
    return {
      ...ax,
      sx: x * p.right.x + y * p.right.y + z * p.right.z,
      sy: -(x * p.upv.x + y * p.upv.y + z * p.upv.z),
      depth: x * p.dir.x + y * p.dir.y + z * p.dir.z,
    };
  }).sort((u, w) => u.depth - w.depth);
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.arc(ox, oy, len + 9 * sc, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineCap = "round";
  ctx.font = `700 ${Math.round(10 * sc)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const ax of items) {
    ctx.globalAlpha = ax.depth < -0.2 ? 0.5 : 1;
    ctx.strokeStyle = ax.color;
    ctx.lineWidth = 2 * sc;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + ax.sx * len, oy + ax.sy * len);
    ctx.stroke();
    ctx.fillStyle = ax.color;
    ctx.fillText(ax.key, ox + ax.sx * (len + 6 * sc), oy + ax.sy * (len + 6 * sc));
  }
  ctx.restore();
}
