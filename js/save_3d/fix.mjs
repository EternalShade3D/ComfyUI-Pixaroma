// Save 3D Pixaroma - the Fix, as the viewer previews it.
//
// A mirror of nodes/_mesh3d.py (TURNS, turns_matrix, fix_shift, apply_fix,
// placement_check) and nodes/_save3d_helpers.py (check_line), so the node shows
// exactly what a Run will save. Keep the two in lockstep:
// D:\Claude Tests\_save3d_fix_parity.py runs both on random models and fails on
// any difference.
//
// Pure: no imports and no DOM, so plain node can load it.

// 90 degree turns, right-handed, Y up, as rows (numpy's layout): x tips the
// model forward, y spins it, z tips it onto its side.
export const TURNS = {
  x: [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
  y: [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
  z: [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
};

const IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

function mul(a, b) {
  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
    }
  }
  return out;
}

function transpose(a) {
  return [[a[0][0], a[1][0], a[2][0]], [a[0][1], a[1][1], a[2][1]], [a[0][2], a[1][2], a[2][2]]];
}

function apply(m, p) {
  return [
    m[0][0] * p[0] + m[0][1] * p[1] + m[0][2] * p[2],
    m[1][0] * p[0] + m[1][1] * p[1] + m[1][2] * p[2],
    m[2][0] * p[0] + m[2][1] * p[1] + m[2][2] * p[2],
  ];
}

/** The turns, applied in order, as one 3x3 matrix (rows). */
export function turnsMatrix(turns) {
  let m = IDENTITY;
  for (const t of Array.isArray(turns) ? turns : []) {
    if (TURNS[t]) m = mul(TURNS[t], m);
  }
  return m;
}

/** The move the Fix adds after the turns, from the TURNED model's box {min, max}. */
export function fixShift(box, center, ground) {
  const s = [0, 0, 0];
  if (!box) return s;
  if (center) {
    s[0] = -(box.min[0] + box.max[0]) / 2;
    s[2] = -(box.min[2] + box.max[2]) / 2;
  }
  if (ground) s[1] = -box.min[1];
  return s;
}

/**
 * How to show a saved file with a DIFFERENT Fix, without reloading it.
 *
 * The file holds F = R_last p + shift_last (the report's `fix`). The Fix now on
 * the node wants R_cur p + shift_cur, where shift_cur comes from the box of
 * R_cur p. So every point of the file moves by x -> D x + t, with
 * D = R_cur R_last^T and t = shift_cur - D shift_last.
 *
 * `box` is the file's own box {min, max}. D is a signed permutation (only 90
 * degree turns), so the box after it is exact without touching a vertex.
 * -> {rotation (rows), translation, box (as it will be shown), shift (shift_cur)}
 */
export function displayTransform(last, current, box) {
  const D = mul(turnsMatrix(current?.turns), transpose(turnsMatrix(last?.turns)));
  const s = Array.isArray(last?.shift) && last.shift.length === 3 ? last.shift.map(Number) : [0, 0, 0];
  const min = [0, 0, 0];
  const max = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    let j = 0;
    while (j < 2 && D[i][j] === 0) j++;
    const lo = box.min[j] - s[j];
    const hi = box.max[j] - s[j];
    if (D[i][j] > 0) {
      min[i] = lo;
      max[i] = hi;
    } else {
      min[i] = -hi;
      max[i] = -lo;
    }
  }
  const shift = fixShift({ min, max }, !!current?.center, !!current?.ground);
  const Ds = apply(D, s);
  return {
    rotation: D,
    translation: [shift[0] - Ds[0], shift[1] - Ds[1], shift[2] - Ds[2]],
    box: { min: min.map((v, i) => v + shift[i]), max: max.map((v, i) => v + shift[i]) },
    shift,
  };
}

/** The 16 row-major numbers three.js's Matrix4.set() takes. */
export function matrixRows(tr) {
  const r = tr.rotation;
  const t = tr.translation;
  return [r[0][0], r[0][1], r[0][2], t[0], r[1][0], r[1][1], r[1][2], t[1], r[2][0], r[2][1], r[2][2], t[2], 0, 0, 0, 1];
}

/** Where the shown model sits, measured like _mesh3d.placement_check. */
export function placementFlags(box, tolerance = 0.005) {
  if (!box) return { floating: false, sunk: false, off_center: false };
  const ext = [0, 1, 2].map((i) => box.max[i] - box.min[i]);
  const limit = (Math.max(...ext) || 1) * tolerance;
  const mid = [0, 1, 2].map((i) => (box.min[i] + box.max[i]) / 2);
  return {
    floating: box.min[1] > limit,
    sunk: box.min[1] < -limit,
    off_center: Math.abs(mid[0]) > limit || Math.abs(mid[2]) > limit,
  };
}

/** The line under the Fix row, word for word as _save3d_helpers.check_line. */
export function checkLine(flags) {
  const parts = [];
  if (flags?.floating) parts.push("Floating above the ground");
  if (flags?.sunk) parts.push("Sunk into the ground");
  if (flags?.off_center) parts.push("Off center");
  return parts.length
    ? { level: "warn", text: parts.join(" · ") }
    : { level: "good", text: "On the ground · centered" };
}
