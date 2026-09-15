// Edit 3D Pixaroma - OBJ in and out, keeping polygons, groups and colours. Pure: no three, no ComfyUI.
// The same conventions as nodes/_mesh3d.py: `v x y z r g b` colours are sRGB on the line and LINEAR in
// memory, faces are 1-based (negative indices count from the end), `usemtl` names the groups (a `g` line
// is used only when there is no usemtl), and a face with fewer than three corners is dropped.

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * OBJ text -> { positions: Float32Array(3N), colours: Float32Array(3N) | null, counts: Int32Array(F),
 * indices: Uint32Array, groups: Int32Array(F) | null, groupNames: string[] }.
 */
export function readObj(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const pos = [], col = [];
  let hasColour = false;
  const counts = [], flat = [], faceM = [], faceG = [];
  const mNames = [], mIds = new Map(), gNames = [], gIds = new Map();
  let curM = -1, curG = -1;
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line[0] === "#") continue;
    const parts = line.split(/\s+/);
    const tag = parts[0];
    if (tag === "v") {
      pos.push(+parts[1], +parts[2], +parts[3]);
      if (parts.length >= 7) {
        col.push(srgbToLinear(clamp01(+parts[4])), srgbToLinear(clamp01(+parts[5])), srgbToLinear(clamp01(+parts[6])));
        hasColour = true;
      } else col.push(1, 1, 1);
    } else if (tag === "f") {
      const n = pos.length / 3, face = [];
      for (let i = 1; i < parts.length; i++) {
        const head = parts[i].split("/", 1)[0];
        if (!head) continue;
        const k = parseInt(head, 10);
        const r = k > 0 ? k - 1 : n + k;
        if (k === 0 || !(r >= 0 && r < n)) throw new Error(`OBJ index ${k} is out of range for ${n} vertices`);
        face.push(r);
      }
      if (face.length < 3) continue;
      counts.push(face.length);
      for (const v of face) flat.push(v);
      faceM.push(curM);
      faceG.push(curG);
    } else if (tag === "usemtl") {
      const key = parts.slice(1).join(" ") || "default";
      if (!mIds.has(key)) { mIds.set(key, mNames.length); mNames.push(key); }
      curM = mIds.get(key);
    } else if (tag === "g") {
      const key = parts.slice(1).join(" ") || "default";
      if (!gIds.has(key)) { gIds.set(key, gNames.length); gNames.push(key); }
      curG = gIds.get(key);
    }
  }
  if (!counts.length) throw new Error("OBJ contains no faces");
  let groups = null, groupNames = [];
  const useM = mNames.length > 0, ids = useM ? faceM : faceG, names = useM ? mNames : gNames;
  if (names.length) {
    groupNames = names.slice();
    groups = new Int32Array(ids.length);
    let dflt = -1;
    for (let f = 0; f < ids.length; f++) {
      if (ids[f] < 0) {
        if (dflt < 0) { dflt = groupNames.length; groupNames.push("default"); }
        groups[f] = dflt;
      } else groups[f] = ids[f];
    }
  }
  return {
    positions: new Float32Array(pos), colours: hasColour ? new Float32Array(col) : null,
    counts: new Int32Array(counts), indices: new Uint32Array(flat), groups, groupNames,
  };
}

/** The reverse: a model (positions, colours, counts, indices, groups, groupNames) -> OBJ text the Python reader takes. */
export function writeObj(m, header = "Pixaroma Edit 3D") {
  const out = ["# " + header, "o model"];
  const n = m.positions.length / 3, P = m.positions, C = m.colours;
  for (let i = 0; i < n; i++) {
    let line = `v ${P[3 * i].toFixed(6)} ${P[3 * i + 1].toFixed(6)} ${P[3 * i + 2].toFixed(6)}`;
    if (C) {
      line += ` ${linearToSrgb(clamp01(C[3 * i])).toFixed(4)} ${linearToSrgb(clamp01(C[3 * i + 1])).toFixed(4)} ${linearToSrgb(clamp01(C[3 * i + 2])).toFixed(4)}`;
    }
    out.push(line);
  }
  const F = m.counts.length;
  const starts = new Uint32Array(F + 1);
  for (let f = 0; f < F; f++) starts[f + 1] = starts[f] + m.counts[f];
  const order = Array.from({ length: F }, (_, f) => f);
  if (m.groups) order.sort((a, b) => m.groups[a] - m.groups[b] || a - b); // stable by group, as the Python writer does
  let current = null;
  for (const f of order) {
    if (m.groups && m.groups[f] !== current) {
      current = m.groups[f];
      const name = (m.groupNames && m.groupNames[current]) || `group_${current}`;
      out.push("g " + name, "usemtl " + name);
    }
    let line = "f";
    for (let k = starts[f]; k < starts[f + 1]; k++) line += " " + (m.indices[k] + 1);
    out.push(line);
  }
  return out.join("\n") + "\n";
}
