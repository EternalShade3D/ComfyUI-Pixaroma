// Edit 3D Pixaroma - the file writers behind Save and Save to Disk, pure: GLB (glTF 2.0 binary), binary STL, and
// the placement Save to Disk applies to a copy of the points. No three and no DOM, so node can test them
// (D:\Claude Tests\_edit3d_geo_test.mjs, section D), and ComfyUI's own GLB reader reads what writeGlb writes
// (D:\Claude Tests\_edit3d_test.py, section E).

const FLOAT = 5126, UINT = 5125, ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963;

/**
 * A triangle model -> GLB bytes. positions Float32Array(3N); normals, colours (LINEAR) Float32Array(3N) or null;
 * uvs Float32Array(2N) or null; indices Uint32Array(3T); texturePng Uint8Array or null (only used with uvs).
 */
export function writeGlb({ positions, normals = null, uvs = null, colours = null, indices, texturePng = null, generator = "Pixaroma Edit 3D" }) {
  const N = positions.length / 3;
  const parts = [], bufferViews = [], accessors = [];
  let offset = 0;
  const view = (bytes, target) => {
    const pad = (4 - (offset % 4)) % 4;
    if (pad) { parts.push(new Uint8Array(pad)); offset += pad; }
    const bv = { buffer: 0, byteOffset: offset, byteLength: bytes.length };
    if (target) bv.target = target;
    bufferViews.push(bv);
    parts.push(bytes);
    offset += bytes.length;
    return bufferViews.length - 1;
  };
  const bytesOf = (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const accessor = (typed, target, componentType, type, count, extra = null) => {
    const acc = { bufferView: view(bytesOf(typed), target), componentType, count, type };
    if (extra) Object.assign(acc, extra);
    accessors.push(acc);
    return accessors.length - 1;
  };
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) {
    const v = positions[3 * i + k];
    if (v < min[k]) min[k] = v;
    if (v > max[k]) max[k] = v;
  }
  if (!N) { min.fill(0); max.fill(0); }
  const attributes = { POSITION: accessor(positions, ARRAY_BUFFER, FLOAT, "VEC3", N, { min, max }) };
  if (normals) attributes.NORMAL = accessor(normals, ARRAY_BUFFER, FLOAT, "VEC3", N);
  const textured = !!(uvs && texturePng);
  if (uvs) attributes.TEXCOORD_0 = accessor(uvs, ARRAY_BUFFER, FLOAT, "VEC2", N);
  if (colours) attributes.COLOR_0 = accessor(colours, ARRAY_BUFFER, FLOAT, "VEC3", N);
  const idx = accessor(indices, ELEMENT_ARRAY_BUFFER, UINT, "SCALAR", indices.length);
  const material = { pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 }, name: "edit3d" };
  const json = {
    asset: { version: "2.0", generator }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: "model" }],
    meshes: [{ primitives: [{ attributes, indices: idx, material: 0, mode: 4 }] }],
    materials: [material], accessors, bufferViews, buffers: [{ byteLength: 0 }],
  };
  if (textured) {
    json.images = [{ bufferView: view(texturePng, 0), mimeType: "image/png" }];
    json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
    json.textures = [{ source: 0, sampler: 0 }];
    material.pbrMetallicRoughness.baseColorTexture = { index: 0 };
  }
  const binPad = (4 - (offset % 4)) % 4;
  if (binPad) { parts.push(new Uint8Array(binPad)); offset += binPad; }
  json.buffers[0].byteLength = offset;
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  if (jsonPad) {
    const padded = new Uint8Array(jsonBytes.length + jsonPad);
    padded.set(jsonBytes);
    padded.fill(0x20, jsonBytes.length);
    jsonBytes = padded;
  }
  const total = 12 + 8 + jsonBytes.length + 8 + offset;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // "glTF"
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(jsonBytes, 20);
  let at = 20 + jsonBytes.length;
  dv.setUint32(at, offset, true);
  dv.setUint32(at + 4, 0x004e4942, true); // "BIN\0"
  at += 8;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out.buffer;
}

/** A triangle model -> binary STL bytes (a face normal per triangle, little-endian). */
export function writeStl(positions, indices, header = "Pixaroma Edit 3D") {
  const T = (indices.length / 3) | 0;
  const out = new ArrayBuffer(84 + 50 * T);
  const u8 = new Uint8Array(out), dv = new DataView(out);
  const head = new TextEncoder().encode(header).subarray(0, 80);
  u8.set(head, 0);
  dv.setUint32(80, T, true);
  let o = 84;
  for (let t = 0; t < T; t++) {
    const a = 3 * indices[3 * t], b = 3 * indices[3 * t + 1], c = 3 * indices[3 * t + 2];
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
    o += 12;
    for (const p of [a, b, c]) {
      dv.setFloat32(o, positions[p], true); dv.setFloat32(o + 4, positions[p + 1], true); dv.setFloat32(o + 8, positions[p + 2], true);
      o += 12;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return out;
}

/**
 * A copy of the points placed the way Save to Disk was asked: turned about Y by turnY degrees (0 / 90 / 180 / 270,
 * right-handed, the turn Save 3D's Turn Y makes), then centred on X and Z, then the lowest point on Y = 0.
 * With `zUp` the result is also stood up for a 3D printer (x, y, z) -> (x, -z, y), a TURN, never a mirror, and with
 * `longest` its longest side is scaled to that many units.
 */
export function placeCopy(positions, { turnY = 0, center = false, ground = false, zUp = false, longest = 0 } = {}) {
  const n = positions.length / 3, out = new Float32Array(positions.length);
  const steps = (((Math.round(turnY / 90) % 4) + 4) % 4);
  for (let i = 0; i < n; i++) {
    let x = positions[3 * i], y = positions[3 * i + 1], z = positions[3 * i + 2];
    for (let s = 0; s < steps; s++) { const nx = z, nz = -x; x = nx; z = nz; } // the Y row of Save 3D's TURNS
    out[3 * i] = x; out[3 * i + 1] = y; out[3 * i + 2] = z;
  }
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const v = out[3 * i + k]; if (Number.isFinite(v)) { if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; } }
  if (n && lo[0] !== Infinity) {
    const sx = center ? -(lo[0] + hi[0]) / 2 : 0, sz = center ? -(lo[2] + hi[2]) / 2 : 0, sy = ground ? -lo[1] : 0;
    for (let i = 0; i < n; i++) { out[3 * i] += sx; out[3 * i + 1] += sy; out[3 * i + 2] += sz; }
    if (longest > 0) {
      const span = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1, k = longest / span;
      for (let i = 0; i < out.length; i++) out[i] *= k;
    }
  }
  if (zUp) for (let i = 0; i < n; i++) { const y = out[3 * i + 1], z = out[3 * i + 2]; out[3 * i + 1] = -z; out[3 * i + 2] = y; }
  return out;
}
