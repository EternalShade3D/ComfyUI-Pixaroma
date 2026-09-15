// Edit 3D Pixaroma - the key of a PICKED model file, the SAME rule as nodes/_edit3d_helpers.py file_sample +
// file_key: "f:<bare name>:<size>:<crc32 of the first and last 64 KB>". The editor computes it from the bytes
// it opened and writes it into the state; Python computes it from the file at Run; the edit is used only while
// the two agree. Pure, so node can test it. crc32 is the standard one (zlib's), written out because
// crypto.subtle is missing on a plain-http LAN host.
export const SAMPLE_BYTES = 65536;

let TABLE = null;
function table() {
  if (TABLE) return TABLE;
  TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    TABLE[n] = c >>> 0;
  }
  return TABLE;
}

export function crc32(bytes) {
  const t = table();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function fileSample(u) {
  if (u.length <= 2 * SAMPLE_BYTES) return u;
  const out = new Uint8Array(2 * SAMPLE_BYTES);
  out.set(u.subarray(0, SAMPLE_BYTES), 0);
  out.set(u.subarray(u.length - SAMPLE_BYTES), SAMPLE_BYTES);
  return out;
}

/** name = the bare file name (no folders); bytes = the file as an ArrayBuffer or Uint8Array. */
export function fileKey(name, bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return `f:${name}:${u.length}:${crc32(fileSample(u)).toString(16).padStart(8, "0")}`;
}
