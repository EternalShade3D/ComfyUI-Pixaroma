// Edit 3D Pixaroma - three.js from the pack's vendored copy, and a model file turned into the plain arrays the editor
// works on: { positions (3N), counts, indices, colours (3N linear) | null, uvs (2N) | null, texture | null, polys }.
// OBJ without a texture goes through our own reader so quads stay quads; everything else through three's loaders,
// flattened to triangles in world space.
import { pixApiUrl } from "../shared/api_url.mjs";
import { readObj } from "./objio.mjs";

const VENDOR = "/pixaroma/vendor/three"; // a BARE base, wrapped at each use (hosted-urls.md #4)
const vendor = (tail) => pixApiUrl(VENDOR + tail);

let _three = null;
/** -> { THREE, OrbitControls } */
export function loadThree() {
  if (!_three) {
    _three = Promise.all([import(vendor("/three.mjs")), import(vendor("/examples/jsm/controls/OrbitControls.mjs"))])
      .then(([THREE, oc]) => ({ THREE, OrbitControls: oc.OrbitControls }));
    _three.catch(() => { _three = null; });
  }
  return _three;
}

const _mods = new Map();
function loaderModule(tail) {
  if (!_mods.has(tail)) {
    const p = import(vendor(tail));
    p.catch(() => _mods.delete(tail));
    _mods.set(tail, p);
  }
  return _mods.get(tail);
}

// Side files (a .bin, a texture, an .mtl) are asked for relative to the model; the fake scheme keeps the folder in
// the path and each request becomes a proper /view url, built per request (load-3d.md #5).
const SCHEME = "pix3d://";
function baseFor(p) {
  return SCHEME + p.type + "/" + (p.subfolder ? p.subfolder + "/" : "");
}
function viewUrl(type, subfolder, filename) {
  let q = `/view?filename=${encodeURIComponent(filename)}&type=${encodeURIComponent(type)}`;
  if (subfolder) q += `&subfolder=${encodeURIComponent(subfolder)}`;
  return pixApiUrl(q);
}
function makeManager(THREE) {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (typeof url !== "string" || !url.startsWith(SCHEME)) return url;
    const rest = url.slice(SCHEME.length);
    const cut = rest.indexOf("/");
    if (cut < 0) return url;
    const type = rest.slice(0, cut);
    let path = rest.slice(cut + 1).split(/[?#]/)[0];
    try { path = decodeURIComponent(path); } catch (_e) { /* keep it raw */ }
    const segs = [];
    for (const s of path.replace(/\\/g, "/").split("/")) {
      if (!s || s === ".") continue;
      if (s === "..") {
        if (!segs.length) return url;
        segs.pop();
      } else {
        segs.push(s);
      }
    }
    const file = segs.pop() || "";
    return viewUrl(type, segs.join("/"), file);
  });
  return manager;
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** A texture's pixels, once, for baking a second texture into colours. */
function pixelsOf(texture, cache) {
  if (cache.has(texture)) return cache.get(texture);
  let out = null;
  const img = texture?.image;
  const w = img?.width || img?.naturalWidth || 0, h = img?.height || img?.naturalHeight || 0;
  if (w && h) {
    try {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      out = { data: ctx.getImageData(0, 0, w, h).data, w, h, flipY: !!texture.flipY };
    } catch (_e) {
      out = null;
    }
  }
  cache.set(texture, out);
  return out;
}

function sample(px, u, v, out, o) {
  const x = Math.min(px.w - 1, Math.max(0, Math.round((u - Math.floor(u)) * (px.w - 1))));
  const vv = v - Math.floor(v);
  const y = Math.min(px.h - 1, Math.max(0, Math.round((px.flipY ? 1 - vv : vv) * (px.h - 1))));
  const i = 4 * (y * px.w + x);
  out[o] = srgbToLinear(px.data[i] / 255);
  out[o + 1] = srgbToLinear(px.data[i + 1] / 255);
  out[o + 2] = srgbToLinear(px.data[i + 2] / 255);
}

const colourful = (c) => !!c && Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) > 0.06;

/** Every mesh of a loaded three.js object -> one triangle model in world space. */
function fromObject(THREE, object) {
  object.updateMatrixWorld(true);
  const parts = [];
  object.traverse((o) => {
    if (o.isMesh && o.geometry?.getAttribute?.("position")) parts.push(o);
  });
  if (!parts.length) throw new Error("the file holds no surface to edit (only points or lines)");
  const maps = new Set();
  let anyColour = false;
  for (const m of parts) {
    if (m.geometry.getAttribute("color")) anyColour = true;
    for (const mat of [].concat(m.material || [])) {
      if (mat?.map?.image) maps.add(mat.map);
      if (colourful(mat?.color)) anyColour = true;
    }
  }
  const keep = maps.size === 1 ? [...maps][0] : null;
  if (maps.size > 1) anyColour = true; // several textures: baked into colours, the editor keeps one at most
  let N = 0, I = 0;
  for (const m of parts) {
    const g = m.geometry, pa = g.getAttribute("position");
    N += pa.count;
    I += g.index ? g.index.count - (g.index.count % 3) : pa.count - (pa.count % 3);
  }
  const positions = new Float32Array(3 * N);
  const indices = new Uint32Array(I);
  const colours = anyColour ? new Float32Array(3 * N).fill(1) : null;
  const uvs = keep ? new Float32Array(2 * N) : null;
  const px = new Map();
  const v = new THREE.Vector3(), c = new THREE.Color();
  let vo = 0, io = 0;
  for (const m of parts) {
    const g = m.geometry, pa = g.getAttribute("position"), ca = g.getAttribute("color"), ua = g.getAttribute("uv");
    const mats = [].concat(m.material || []);
    const mat0 = mats[0];
    const mw = m.matrixWorld;
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i).applyMatrix4(mw);
      positions[3 * (vo + i)] = v.x; positions[3 * (vo + i) + 1] = v.y; positions[3 * (vo + i) + 2] = v.z;
    }
    if (colours) {
      const map = mat0?.map;
      for (let i = 0; i < pa.count; i++) {
        const o = 3 * (vo + i);
        if (ca) {
          colours[o] = ca.getX(i); colours[o + 1] = ca.getY(i); colours[o + 2] = ca.getZ(i);
        } else if (map && map !== keep && ua) {
          const pix = pixelsOf(map, px);
          if (pix) sample(pix, ua.getX(i), ua.getY(i), colours, o);
        } else if (colourful(mat0?.color)) {
          c.copy(mat0.color);
          colours[o] = c.r; colours[o + 1] = c.g; colours[o + 2] = c.b;
        }
      }
    }
    if (uvs && ua && mats.some((mt) => mt?.map === keep)) {
      for (let i = 0; i < pa.count; i++) { uvs[2 * (vo + i)] = ua.getX(i); uvs[2 * (vo + i) + 1] = ua.getY(i); }
    }
    const flip = mw.determinant() < 0;
    const count = g.index ? g.index.count - (g.index.count % 3) : pa.count - (pa.count % 3);
    for (let k = 0; k < count; k += 3) {
      const a = g.index ? g.index.getX(k) : k, b = g.index ? g.index.getX(k + 1) : k + 1, d = g.index ? g.index.getX(k + 2) : k + 2;
      indices[io++] = vo + a;
      indices[io++] = vo + (flip ? d : b);
      indices[io++] = vo + (flip ? b : d);
    }
    vo += pa.count;
  }
  return {
    positions, counts: new Int32Array(io / 3).fill(3), indices: io === I ? indices : indices.subarray(0, io),
    colours, uvs, texture: keep, polys: false, textures: maps.size,
  };
}

/** A model file's bytes -> the editor's arrays. p = splitModelName(value). */
export async function parseSource(THREE, buf, p) {
  const manager = makeManager(THREE);
  const base = baseFor(p);
  switch (p.ext) {
    case "obj": {
      const text = new TextDecoder().decode(buf);
      const textured = /^[ \t]*vt[ \t]/m.test(text) && /^[ \t]*mtllib[ \t]/m.test(text);
      if (!textured) {
        const m = readObj(text);
        return { positions: m.positions, counts: m.counts, indices: m.indices, colours: m.colours, uvs: null, texture: null, polys: true, textures: 0 };
      }
      const [{ OBJLoader }, { MTLLoader }] = await Promise.all([
        loaderModule("/examples/jsm/loaders/OBJLoader.mjs"),
        loaderModule("/examples/jsm/loaders/MTLLoader.mjs"),
      ]);
      const loader = new OBJLoader(manager);
      const lib = (text.match(/^[ \t]*mtllib[ \t]+(.+?)[ \t]*$/m) || [])[1] || p.filename.replace(/\.obj$/i, ".mtl");
      try {
        const materials = await new MTLLoader(manager).setPath(base).loadAsync(lib);
        materials.preload();
        loader.setMaterials(materials);
      } catch (_e) { /* no .mtl beside it: plain grey */ }
      const object = loader.parse(text);
      await waitForTextures(object);
      return fromObject(THREE, object);
    }
    case "glb":
    case "gltf": {
      const { GLTFLoader } = await loaderModule("/examples/jsm/loaders/GLTFLoader.mjs");
      const gltf = await new GLTFLoader(manager).parseAsync(buf, base);
      return fromObject(THREE, gltf.scene || gltf.scenes?.[0]);
    }
    case "fbx": {
      const { FBXLoader } = await loaderModule("/examples/jsm/loaders/FBXLoader.mjs");
      const object = new FBXLoader(manager).parse(buf, base);
      await waitForTextures(object);
      return fromObject(THREE, object);
    }
    case "stl": {
      const { STLLoader } = await loaderModule("/examples/jsm/loaders/STLLoader.mjs");
      const geo = new STLLoader().parse(buf);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial());
      // STL stands on Z; everything in the editor stands on Y (the turn Save 3D uses, never a mirror).
      mesh.rotation.x = -Math.PI / 2;
      return fromObject(THREE, mesh);
    }
    case "ply": {
      const { PLYLoader } = await loaderModule("/examples/jsm/loaders/PLYLoader.mjs");
      const geo = new PLYLoader().parse(buf);
      if (!geo.index || geo.index.count < 3) throw new Error("the PLY file holds only points, no surface to edit");
      return fromObject(THREE, new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: !!geo.getAttribute("color") })));
    }
    default:
      throw new Error(`.${p.ext} files cannot be opened here`);
  }
}

/** Loaders that fetch textures in the background: wait (up to 8 s) so a texture baked into colours is really there. */
async function waitForTextures(object) {
  const maps = [];
  object.traverse((o) => {
    for (const m of [].concat(o.material || [])) if (m?.map) maps.push(m.map);
  });
  const t0 = performance.now();
  while (maps.some((t) => !(t.image && (t.image.width || t.image.naturalWidth))) && performance.now() - t0 < 8000) {
    await new Promise((r) => setTimeout(r, 100));
  }
}
