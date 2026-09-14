// Load 3D Pixaroma - the 3D engine.
//
// ONE WebGL renderer for every Load 3D node on the canvas. A page gets only
// about 16 live WebGL contexts (3d-builder.md #9), so a renderer per node would
// start failing around the sixteenth node. Each node owns a plain 2D canvas; the
// shared renderer draws that node's scene at the canvas's size and the pixels
// are copied across. Nothing animates on its own: a node is drawn only when
// something about it changed.
//
// three.js is the pack's vendored copy (offline-first), loaded on first use and
// shared with the 3D Builder through the identical module URL.

import { pixApiUrl } from "../shared/api_url.mjs";
import { canvasBackingScale } from "../shared/nodes2.mjs";
import { NONE, splitModelName, fmtBytes, fmtInt } from "./core.mjs";
// The size the picture is drawn at can come from a wire, so the frame, the drag
// maths and the capture all read the EFFECTIVE state, never the stored one.
import { effectiveState } from "./size.mjs";

const VENDOR = "/pixaroma/vendor/three"; // a BARE base, wrapped at each use (hosted-urls.md #4)
const vendor = (tail) => pixApiUrl(VENDOR + tail);

let _THREE = null;
let _libs = null;
function loadLibs() {
  if (!_libs) {
    _libs = import(vendor("/three.mjs")).then((THREE) => {
      _THREE = THREE;
      return THREE;
    });
    _libs.catch(() => { _libs = null; });
  }
  return _libs;
}

const _loaderMods = new Map();
function loaderModule(tail) {
  if (!_loaderMods.has(tail)) {
    const p = import(vendor(tail));
    p.catch(() => _loaderMods.delete(tail));
    _loaderMods.set(tail, p);
  }
  return _loaderMods.get(tail);
}

// ── per-node records ────────────────────────────────────────────────────────
const _recs = new Map();

function recOf(node) {
  let rec = _recs.get(node);
  if (!rec) {
    rec = {
      node, canvas: null, onStatus: null, status: "empty", info: null, error: "",
      value: "", seq: 0, loading: null, model: null, view: null, anim: null,
    };
    _recs.set(node, rec);
  }
  return rec;
}

export function attachCanvas(node, canvas, onStatus) {
  const rec = recOf(node);
  rec.canvas = canvas;
  rec.onStatus = onStatus || null;
  requestDraw(node);
}

export function detach(node) {
  const rec = _recs.get(node);
  if (!rec) return;
  rec.seq++;
  disposeModel(rec);
  _recs.delete(node);
  _dirty.delete(node);
}

export function statusOf(node) {
  const rec = _recs.get(node);
  if (!rec) return { status: "empty", info: null, error: "", value: "" };
  return { status: rec.status, info: rec.info, error: rec.error, value: rec.value };
}

function setStatus(rec, status, error = "") {
  rec.status = status;
  rec.error = status === "error" ? error : "";
  if (status !== "ready") rec.info = null;
  try { rec.onStatus?.(); } catch (_e) { /* the face may be gone */ }
  requestDraw(rec.node);
}

// ── fetching ────────────────────────────────────────────────────────────────
function viewUrl(type, subfolder, filename) {
  let q = `/view?filename=${encodeURIComponent(filename)}&type=${encodeURIComponent(type)}`;
  if (subfolder) q += `&subfolder=${encodeURIComponent(subfolder)}`;
  return pixApiUrl(q);
}

// A tab switch or a renderer flip rebuilds every node, so keep the last few
// downloads for a little while rather than fetching a 50 MB model again.
const _bufCache = new Map();
const BUF_TTL = 120000;
const BUF_MAX = 3;

// Which copy of a file was downloaded. A model replaced on disk keeps its name,
// so this is how a Run notices the file changed under a view drawn from the old
// one (measured: the pyramid's picture was still sent after the file became a
// cube). ComfyUI's /view answers with the ETag and Last-Modified of the file.
function stampOf(res) {
  return {
    etag: (res.headers.get("etag") || "").replace(/^W\//, ""),
    modified: res.headers.get("last-modified") || "",
  };
}

function sameStamp(a, b) {
  if (a.etag && b.etag) return a.etag === b.etag;
  if (a.modified && b.modified) return a.modified === b.modified;
  // Nothing comparable (a proxy stripped both): keep what is there rather than
  // redraw and re-run everything downstream on every Run.
  return true;
}

function fetchBuffer(url) {
  const now = Date.now();
  for (const [k, v] of _bufCache) if (now - v.at > BUF_TTL) _bufCache.delete(k);
  const hit = _bufCache.get(url);
  if (hit) {
    hit.at = now;
    return hit.promise;
  }
  const promise = fetch(url, { cache: "no-store" }).then(async (res) => {
    if (!res.ok) {
      throw new Error(res.status === 404 ? "the file is not there any more" : `the server answered ${res.status}`);
    }
    return { buf: await res.arrayBuffer(), stamp: stampOf(res) };
  });
  promise.catch(() => _bufCache.delete(url));
  _bufCache.set(url, { at: now, promise });
  while (_bufCache.size > BUF_MAX) _bufCache.delete(_bufCache.keys().next().value);
  return promise;
}

// Bumped when a file is replaced under the same name, so the picture made from
// the old file is not reused for the new one.
const _versions = new Map();

export function modelVersion(value) {
  const p = splitModelName(value);
  return _versions.get(viewUrl(p.type, p.subfolder, p.filename)) || 0;
}

/** Forget a downloaded file that was replaced under the same name (an upload, or refreshIfReplaced). */
export function invalidateModel(value) {
  const p = splitModelName(value);
  const url = viewUrl(p.type, p.subfolder, p.filename);
  _bufCache.delete(url);
  _versions.set(url, (_versions.get(url) || 0) + 1);
  for (const rec of _recs.values()) if (rec.value === String(value)) rec.value = "";
}

/**
 * Before a Run draws `value` for `node`: when the file on disk is no longer the
 * copy this node drew (replaced under the same name outside the Upload button,
 * a re-export from a 3D app say), forget it so the picture is drawn again from
 * the new file. One HEAD request; any failure keeps what is there.
 */
export async function refreshIfReplaced(node, value) {
  const rec = _recs.get(node);
  if (!rec || rec.value !== String(value) || rec.status !== "ready" || !rec.stamp) return false;
  const p = splitModelName(value);
  let now = null;
  try {
    const res = await fetch(viewUrl(p.type, p.subfolder, p.filename), { method: "HEAD", cache: "no-store" });
    if (res.ok) now = stampOf(res);
  } catch (_e) { /* offline or refused: keep what is there */ }
  if (!now || sameStamp(now, rec.stamp)) return false;
  invalidateModel(value);
  return true;
}

/** R (Refresh Node Definitions) drops what was downloaded. */
export function clearCaches() {
  _bufCache.clear();
}

/** Every node the engine still holds, so the wiring can let go of dead ones. */
export function knownNodes() {
  return [..._recs.keys()];
}

export function canvasAttached(node) {
  return !!_recs.get(node)?.canvas?.isConnected;
}

// Side files (a .bin, a texture, an .mtl) are asked for relative to the model.
// A fake scheme keeps the folder in the path so the loaders resolve them the
// ordinary way, and this turns every such request into a proper /view url -
// built per request, so it stays correct on a token-gated hosted ComfyUI.
const SCHEME = "pix3d://";

function baseFor(p) {
  return SCHEME + p.type + "/" + (p.subfolder ? p.subfolder + "/" : "");
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

function countObjFaces(text) {
  const out = { tris: 0, quads: 0, ngons: 0, polys: 0 };
  const n = text.length;
  let i = 0;
  while (i < n) {
    let j = text.indexOf("\n", i);
    if (j < 0) j = n;
    if (text.charCodeAt(i) === 102 && (text.charCodeAt(i + 1) === 32 || text.charCodeAt(i + 1) === 9)) {
      const corners = text.slice(i + 2, j).trim().split(/\s+/).length;
      if (corners >= 3) {
        out.polys++;
        if (corners === 3) out.tris++;
        else if (corners === 4) out.quads++;
        else out.ngons++;
      }
    }
    i = j + 1;
  }
  return out;
}

async function parseModel(THREE, p, buf) {
  const manager = makeManager(THREE);
  const base = baseFor(p);
  let object = null;
  let polys = null;
  switch (p.ext) {
    case "glb":
    case "gltf": {
      const { GLTFLoader } = await loaderModule("/examples/jsm/loaders/GLTFLoader.mjs");
      const gltf = await new GLTFLoader(manager).parseAsync(buf, base);
      object = gltf.scene || gltf.scenes?.[0] || null;
      break;
    }
    case "obj": {
      const [{ OBJLoader }, { MTLLoader }] = await Promise.all([
        loaderModule("/examples/jsm/loaders/OBJLoader.mjs"),
        loaderModule("/examples/jsm/loaders/MTLLoader.mjs"),
      ]);
      const text = new TextDecoder().decode(buf);
      polys = countObjFaces(text);
      const loader = new OBJLoader(manager);
      const lib = (text.match(/^[ \t]*mtllib[ \t]+(.+?)[ \t]*$/m) || [])[1]
        || p.filename.replace(/\.obj$/i, ".mtl");
      try {
        const materials = await new MTLLoader(manager).setPath(base).loadAsync(lib);
        materials.preload();
        loader.setMaterials(materials);
      } catch (_e) {
        // No .mtl next to the model: it simply shows in plain grey.
      }
      object = loader.parse(text);
      break;
    }
    case "fbx": {
      const { FBXLoader } = await loaderModule("/examples/jsm/loaders/FBXLoader.mjs");
      object = new FBXLoader(manager).parse(buf, base);
      polys = object?.userData?.pixPolygonStats || null;
      if (object?.userData) delete object.userData.pixPolygonStats;
      break;
    }
    case "stl": {
      const { STLLoader } = await loaderModule("/examples/jsm/loaders/STLLoader.mjs");
      const geo = new STLLoader().parse(buf);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xc9c9c9, roughness: 0.8, metalness: 0, vertexColors: !!geo.hasColors,
      });
      object = new THREE.Group();
      object.add(new THREE.Mesh(geo, mat));
      break;
    }
    case "ply": {
      const { PLYLoader } = await loaderModule("/examples/jsm/loaders/PLYLoader.mjs");
      const geo = new PLYLoader().parse(buf);
      const colors = !!geo.getAttribute("color");
      object = new THREE.Group();
      if (geo.index && geo.index.count >= 3) {
        object.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
          color: colors ? 0xffffff : 0xc9c9c9, roughness: 0.8, metalness: 0, vertexColors: colors,
        })));
      } else {
        object.add(new THREE.Points(geo, new THREE.PointsMaterial({
          color: colors ? 0xffffff : 0xc9c9c9, size: 2, sizeAttenuation: false, vertexColors: colors,
        })));
      }
      break;
    }
    default:
      throw new Error("this file type is not supported");
  }
  if (!object) throw new Error("the file holds no 3D model");
  return { object, polys };
}

function colourful(c) {
  return !!c && Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) > 0.06;
}

function prepareModel(object, polys, bytes, ext) {
  const meshes = [];
  const points = [];
  const lines = [];
  let tris = 0;
  let pts = 0;
  let textures = false;
  let vcolors = false;
  let matColors = false;
  object.traverse((o) => {
    if (o.isMesh) {
      const g = o.geometry;
      const pos = g?.getAttribute?.("position");
      if (pos && !g.getAttribute("normal")) g.computeVertexNormals();
      if (pos) tris += (g.index ? g.index.count : pos.count) / 3;
      if (g?.getAttribute?.("color")) vcolors = true;
      for (const m of [].concat(o.material || [])) {
        if (m?.map) textures = true;
        if (colourful(m?.color)) matColors = true;
      }
      o.frustumCulled = false;
      meshes.push(o);
    } else if (o.isPoints) {
      pts += o.geometry?.getAttribute?.("position")?.count || 0;
      if (o.geometry?.getAttribute?.("color")) vcolors = true;
      o.frustumCulled = false;
      points.push(o);
    } else if (o.isLine) {
      lines.push(o);
    }
  });
  const orig = new Map();
  for (const m of meshes) orig.set(m, m.material);
  for (const p of points) orig.set(p, p.material);
  return {
    object, meshes, points, lines, orig, flat: new Map(), wires: null,
    info: { ext: String(ext || "").toUpperCase(), bytes, tris: Math.round(tris), points: pts, polys, textures, vcolors, matColors },
  };
}

export function infoText(info) {
  if (!info) return "";
  const parts = [info.ext, fmtBytes(info.bytes)];
  if (info.tris > 0) {
    parts.push(info.polys?.quads > 0
      ? `${fmtInt(info.polys.quads)} quads (${fmtInt(info.tris)} triangles)`
      : `${fmtInt(info.tris)} triangles`);
  }
  if (info.points > 0) parts.push(`${fmtInt(info.points)} points`);
  if (info.ext === "STL" && !info.vcolors) parts.push("shape only");
  else parts.push(info.textures ? "textures" : info.vcolors ? "vertex colors" : info.matColors ? "material colors" : "no colors");
  return parts.filter(Boolean).join(" · ");
}

function friendly(e) {
  const msg = String(e?.message || e || "");
  if (/draco/i.test(msg)) return "it is compressed with Draco, which is not supported yet";
  if (/meshopt/i.test(msg)) return "it is compressed with meshopt, which is not supported yet";
  if (/ktx2|basisu/i.test(msg)) return "its textures use KTX2 compression, which is not supported yet";
  if (/Unexpected token|JSON|Invalid typed array|out of bounds|Unknown format|Cannot read prop/i.test(msg)) {
    return "the file looks damaged, or is not the kind of file its name says";
  }
  return msg.slice(0, 160) || "the file could not be opened";
}

// ── disposal ────────────────────────────────────────────────────────────────
function disposeMaterial(m, sharedSet) {
  for (const mat of [].concat(m || [])) {
    if (!mat || sharedSet.has(mat)) continue;
    for (const k of Object.keys(mat)) {
      const t = mat[k];
      if (t && t.isTexture) t.dispose();
    }
    mat.dispose();
  }
}

function disposeModel(rec) {
  const model = rec.model;
  if (!model) return;
  try {
    rec.view?.holder.remove(model.object);
    const shared = sharedMaterials();
    for (const mesh of model.meshes) {
      disposeMaterial(model.orig.get(mesh), shared);
      mesh.geometry?.dispose();
    }
    for (const p of model.points) {
      disposeMaterial(model.orig.get(p), shared);
      p.geometry?.dispose();
    }
    for (const l of model.lines) {
      disposeMaterial(l.material, shared);
      l.geometry?.dispose();
    }
    for (const w of model.wires || []) if (w.isLineSegments) w.geometry?.dispose();
    for (const f of model.flat.values()) f.dispose();
  } catch (e) {
    console.warn("[Pixaroma.Load3D] dispose failed", e);
  }
  rec.model = null;
}

// ── loading ─────────────────────────────────────────────────────────────────
/** Point a node at a model. Resolves when it is drawn or has failed. */
export function setModel(node, value) {
  const rec = recOf(node);
  const v = String(value || "");
  if (rec.value === v && rec.status !== "error") return rec.loading || Promise.resolve();
  rec.value = v;
  const seq = ++rec.seq;
  rec.anim = null;
  if (!v || v === NONE) {
    disposeModel(rec);
    rec.loading = null;
    setStatus(rec, "empty");
    return Promise.resolve();
  }
  setStatus(rec, "loading");
  const job = (async () => {
    try {
      const THREE = await loadLibs();
      const p = splitModelName(v);
      const got = await fetchBuffer(viewUrl(p.type, p.subfolder, p.filename));
      const buf = got?.buf || got;
      if (seq !== rec.seq) return;
      const { object, polys } = await parseModel(THREE, p, buf);
      if (seq !== rec.seq) {
        disposeModel({ model: prepareModel(object, null, 0, ""), view: null });
        return;
      }
      const view = ensureView(THREE, rec);
      disposeModel(rec);
      rec.model = prepareModel(object, polys, buf.byteLength, p.ext);
      // Which copy of the file this view was drawn from (see refreshIfReplaced).
      rec.stamp = got?.stamp || null;
      view.holder.add(object);
      view.orient = "";
      rec.info = rec.model.info;
      setStatus(rec, "ready");
    } catch (e) {
      if (seq !== rec.seq) return;
      disposeModel(rec);
      console.warn("[Pixaroma.Load3D] could not open", v, e);
      setStatus(rec, "error", friendly(e));
    } finally {
      if (seq === rec.seq) rec.loading = null;
    }
  })();
  rec.loading = job;
  return job;
}

/** Make sure `value` is the loaded model; throws when it cannot be. */
export async function ensureReady(node, value) {
  const v = String(value || "");
  await setModel(node, v);
  const rec = recOf(node);
  if (rec.value !== v) await setModel(node, v);
  if (rec.status !== "ready" || !rec.model) throw new Error(rec.error || "the model could not be opened");
}

// ── the scene ───────────────────────────────────────────────────────────────
function ensureView(THREE, rec) {
  if (rec.view) return rec.view;
  const v = {};
  v.scene = new THREE.Scene();
  v.turn = new THREE.Group();   // Turn 90 (about the vertical axis)
  v.upfix = new THREE.Group();  // Z up -> Y up
  v.holder = new THREE.Group(); // the model
  v.scene.add(v.turn);
  v.turn.add(v.upfix);
  v.upfix.add(v.holder);
  v.persp = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
  v.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000);
  v.hemi = new THREE.HemisphereLight(0xffffff, 0x3a3a3a, 1);
  v.key = new THREE.DirectionalLight(0xffffff, 2);
  v.fill = new THREE.DirectionalLight(0xffffff, 1);
  v.rim = new THREE.DirectionalLight(0xffffff, 1);
  v.scene.add(v.hemi, v.key, v.fill, v.rim, v.key.target, v.fill.target, v.rim.target);
  v.grid = null;
  v.radius = 1;
  v.floorY = -1;
  v.orient = "";
  rec.view = v;
  return v;
}

function applyOrientation(THREE, rec, st) {
  const v = rec.view;
  const key = st.up + st.turn;
  if (v.orient === key) return;
  v.upfix.rotation.set(st.up === "Z" ? -Math.PI / 2 : 0, 0, 0);
  v.turn.rotation.set(0, st.turn * (Math.PI / 2), 0);
  v.turn.position.set(0, 0, 0);
  v.turn.updateMatrixWorld(true);
  // precise=true: a loose box grows with rotation (3d-builder.md #1).
  const box = new THREE.Box3().setFromObject(v.turn, true);
  if (box.isEmpty()) {
    v.radius = 1;
    v.floorY = -1;
  } else {
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    v.radius = Math.max(size.length() / 2, 1e-6);
    v.half = size.clone().multiplyScalar(0.5);
    v.turn.position.copy(c).multiplyScalar(-1);
    v.floorY = box.min.y - c.y;
  }
  v.turn.updateMatrixWorld(true);
  if (v.grid) {
    v.scene.remove(v.grid);
    v.grid.geometry.dispose();
    v.grid.material.dispose();
  }
  v.grid = new THREE.GridHelper(v.radius * 8, 16, 0x6a6a6a, 0x3a3a3a);
  v.grid.material.transparent = true;
  v.grid.material.opacity = 0.55;
  v.grid.material.depthWrite = false;
  v.grid.position.y = v.floorY;
  v.scene.add(v.grid);
  v.orient = key;
}

function deg(d) {
  return (d * Math.PI) / 180;
}

/**
 * The camera. `outAspect` is the PICTURE's shape; `spanScale` (>= 1) widens the
 * view by exactly the dimmed margin around the frame, so the bright frame on
 * the node shows precisely what the picture will hold.
 */
function cameraFor(THREE, v, st, az, el, outAspect, viewAspect, spanScale) {
  const r = v.radius || 1;
  const a = deg(az);
  const e = deg(Math.max(-90, Math.min(90, el)));
  const dir = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
  const up = new THREE.Vector3(0, 1, 0);
  // Straight down (or up) has no horizon to hold on to: keep the model's front
  // at the bottom of the picture, like a floor plan.
  if (Math.abs(el) > 89.5) up.set(-Math.sin(a) * Math.sign(el), 0, -Math.cos(a) * Math.sign(el));
  const right = new THREE.Vector3().crossVectors(up, dir).normalize();
  const upv = new THREE.Vector3().crossVectors(dir, right).normalize();
  const target = new THREE.Vector3().addScaledVector(right, st.panX * r).addScaledVector(upv, st.panY * r);
  let cam;
  let dist;
  if (st.proj === "ortho") {
    let halfH = (r * 1.08) / st.zoom;
    if (outAspect < 1) halfH /= outAspect;
    halfH *= spanScale;
    const halfW = halfH * viewAspect;
    cam = v.ortho;
    cam.left = -halfW;
    cam.right = halfW;
    cam.top = halfH;
    cam.bottom = -halfH;
    dist = r * 6;
    cam.near = Math.max(1e-4, dist - r * 3);
    cam.far = dist + r * 3;
  } else {
    const t = Math.tan(deg(st.fov) / 2);
    const halfV = deg(st.fov) / 2;
    const halfH = Math.atan(t * outAspect);
    dist = (r * 1.08) / Math.sin(Math.min(halfV, halfH)) / st.zoom;
    cam = v.persp;
    cam.fov = (2 * Math.atan(t * spanScale) * 180) / Math.PI;
    cam.aspect = viewAspect;
    cam.near = Math.max(dist * 1e-3, dist - r * 4);
    cam.far = dist + r * 4;
  }
  cam.position.copy(target).addScaledVector(dir, dist);
  cam.up.copy(upv);
  cam.lookAt(target);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  cam.userData.pix = { dist, dir, right, upv, target };
  return cam;
}

// ── materials ───────────────────────────────────────────────────────────────
const DEPTH_VS = `
varying float vDepth;
uniform float uSize;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_PointSize = uSize;
  gl_Position = projectionMatrix * mv;
}`;
// Linear depth between the nearest and farthest point of the model, so the
// whole grey range is spent on the model instead of on empty space.
const DEPTH_FS = `
uniform float uNear;
uniform float uFar;
varying float vDepth;
void main() {
  float d = clamp((uFar - vDepth) / max(uFar - uNear, 1e-6), 0.0, 1.0);
  gl_FragColor = vec4(vec3(d), 1.0);
}`;
// View-space normals packed as colours (right = red, up = green, towards you =
// blue). Written raw, never colour-managed, so a flat surface facing the camera
// is exactly 128,128,255.
const NORMAL_VS = `
varying vec3 vN;
void main() {
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const NORMAL_FS = `
varying vec3 vN;
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
}`;
let _mats = null;
function mats(THREE) {
  if (_mats) return _mats;
  const DS = THREE.DoubleSide;
  _mats = {
    clay: new THREE.MeshStandardMaterial({ color: 0xbfbcb6, roughness: 0.85, metalness: 0, side: DS }),
    clayFlat: new THREE.MeshBasicMaterial({ color: 0xbfbcb6, side: DS }),
    wireBase: new THREE.MeshStandardMaterial({
      color: 0x3a3a3a, roughness: 1, metalness: 0, side: DS,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }),
    normal: new THREE.ShaderMaterial({ side: DS, vertexShader: NORMAL_VS, fragmentShader: NORMAL_FS }),
    depth: new THREE.ShaderMaterial({
      side: DS, uniforms: { uNear: { value: 1 }, uFar: { value: 2 }, uSize: { value: 2 } },
      vertexShader: DEPTH_VS, fragmentShader: DEPTH_FS,
    }),
    line: new THREE.LineBasicMaterial({ color: 0xe8e8e8, transparent: true, opacity: 0.45 }),
    wireOverlay: new THREE.MeshBasicMaterial({ color: 0xe8e8e8, wireframe: true, transparent: true, opacity: 0.22 }),
    ptsClay: new THREE.PointsMaterial({ color: 0xbfbcb6, size: 2, sizeAttenuation: false }),
    ptsNormal: new THREE.PointsMaterial({ color: 0x8080ff, size: 2, sizeAttenuation: false }),
    ptsDepth: new THREE.ShaderMaterial({
      uniforms: { uNear: { value: 1 }, uFar: { value: 2 }, uSize: { value: 2 } },
      vertexShader: DEPTH_VS, fragmentShader: DEPTH_FS,
    }),
  };
  _mats._set = new Set(Object.values(_mats).filter((m) => m && m.isMaterial));
  return _mats;
}

function sharedMaterials() {
  return _mats?._set || new Set();
}

function flatOf(THREE, model, orig, bright) {
  if (Array.isArray(orig)) return orig.map((m) => flatOf(THREE, model, m, bright));
  if (!orig) return orig;
  let f = model.flat.get(orig);
  if (!f) {
    f = new THREE.MeshBasicMaterial({
      map: orig.map || null,
      vertexColors: !!orig.vertexColors,
      transparent: !!orig.transparent,
      opacity: orig.opacity ?? 1,
      alphaTest: orig.alphaTest || 0,
      side: orig.side ?? THREE.FrontSide,
    });
    model.flat.set(orig, f);
  }
  if (orig.color) f.color.copy(orig.color);
  else f.color.setRGB(1, 1, 1);
  f.color.multiplyScalar(bright);
  return f;
}

function ensureWires(THREE, model) {
  if (model.wires) return;
  const M = mats(THREE);
  model.wires = [];
  for (const mesh of model.meshes) {
    const g = mesh.geometry;
    const pos = g?.getAttribute?.("position");
    if (!pos) continue;
    const tris = (g.index ? g.index.count : pos.count) / 3;
    // Edges (which leave out the diagonal of a flat quad) while that stays
    // cheap; a plain wireframe beyond it, where every edge would show anyway.
    const w = tris <= 150000
      ? new THREE.LineSegments(new THREE.EdgesGeometry(g, 1), M.line)
      : new THREE.Mesh(g, M.wireOverlay);
    w.raycast = () => {};
    w.frustumCulled = false;
    mesh.add(w);
    model.wires.push(w);
  }
}

function lookBackground(st) {
  if (st.look === "depth") return "#000000";
  if (st.look === "normal") return "#8080ff";
  return st.bg;
}

let _renderer = null;
let _env = null;

function getRenderer(THREE) {
  if (_renderer) {
    let lost = false;
    try { lost = _renderer.getContext().isContextLost(); } catch (_e) { lost = true; }
    if (!lost) return _renderer;
    try { _renderer.dispose(); } catch (_e) { /* already gone */ }
    _renderer = null;
    _env = null;
  }
  try {
    const canvas = document.createElement("canvas");
    _renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    _renderer.setPixelRatio(1);
    _renderer.outputColorSpace = THREE.SRGBColorSpace;
  } catch (e) {
    console.warn("[Pixaroma.Load3D] WebGL is not available", e);
    _renderer = null;
  }
  return _renderer;
}

// A small soft "studio room" so metal and glossy models are not black. Built
// in code rather than loading an HDRI, so it needs no asset and no download.
function envTexture(THREE, r) {
  if (_env) return _env;
  try {
    const pmrem = new THREE.PMREMGenerator(r);
    const scene = new THREE.Scene();
    const add = (geo, mat, pos, rot) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(pos[0], pos[1], pos[2]);
      if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
      scene.add(m);
    };
    add(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshBasicMaterial({ color: 0x5a5a5a, side: THREE.BackSide }), [0, 0, 0]);
    const glow = (k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k), side: THREE.DoubleSide });
    add(new THREE.PlaneGeometry(6, 2), glow(5), [0, 4.8, 0], [Math.PI / 2, 0, 0]);
    add(new THREE.PlaneGeometry(2, 4), glow(3), [-4.8, 1, 1], [0, Math.PI / 2, 0]);
    add(new THREE.PlaneGeometry(2, 4), glow(2), [4.8, 1, -1], [0, -Math.PI / 2, 0]);
    const rt = pmrem.fromScene(scene, 0.04);
    scene.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
    pmrem.dispose();
    _env = rt.texture;
  } catch (e) {
    console.warn("[Pixaroma.Load3D] environment light failed", e);
    _env = null;
  }
  return _env;
}

function applyLook(THREE, model, st, near, far, pointPx) {
  const M = mats(THREE);
  const flat = st.light === "flat";
  for (const mesh of model.meshes) {
    const orig = model.orig.get(mesh);
    let mat;
    if (st.look === "color") mat = flat ? flatOf(THREE, model, orig, st.bright) : orig;
    else if (st.look === "clay") mat = flat ? M.clayFlat : M.clay;
    else if (st.look === "normal") mat = M.normal;
    else if (st.look === "depth") mat = M.depth;
    else mat = M.wireBase;
    mesh.material = mat;
  }
  for (const u of [M.depth.uniforms, M.ptsDepth.uniforms]) {
    u.uNear.value = near;
    u.uFar.value = far;
    u.uSize.value = pointPx;
  }
  M.ptsClay.size = pointPx;
  M.ptsNormal.size = pointPx;
  for (const p of model.points) {
    const orig = model.orig.get(p);
    if (orig?.isPointsMaterial) orig.size = pointPx;
    let mat;
    if (st.look === "color") mat = orig;
    else if (st.look === "normal") mat = M.ptsNormal;
    else if (st.look === "depth") mat = M.ptsDepth;
    else mat = M.ptsClay;
    p.material = mat;
  }
  for (const w of model.wires || []) w.visible = st.look === "wire";
}

function applyLights(v, st, cam) {
  const b = st.bright;
  const soft = st.light === "soft";
  v.hemi.intensity = (soft ? 1.3 : 0.55) * b;
  v.key.intensity = (soft ? 1.0 : 2.3) * b;
  v.fill.intensity = (soft ? 0.55 : 0.75) * b;
  v.rim.intensity = (soft ? 0.35 : 1.2) * b;
  // The lights travel with the camera, so every named view is lit the same
  // way and a Back view is never left in shadow.
  const { right, upv, dir, target } = cam.userData.pix;
  const R = v.radius * 6;
  const place = (light, x, y, z) => {
    light.position.copy(target).addScaledVector(right, x * R).addScaledVector(upv, y * R).addScaledVector(dir, z * R);
    light.target.position.copy(target);
    light.target.updateMatrixWorld();
  };
  place(v.key, -0.8, 1.0, 1.2);
  place(v.fill, 1.2, 0.2, 0.9);
  place(v.rim, 0.2, 0.9, -1.4);
}

function renderScene(THREE, r, rec, st, cam, w, h, { grid, pointPx, clearAlpha = 1 }) {
  const v = rec.view;
  const model = rec.model;
  // Depth spans the model's own box as seen from THIS camera, not a sphere
  // around it: a flat object seen side-on otherwise uses a sliver of the grey
  // range and comes out as one flat tone.
  let near = Infinity;
  let far = -Infinity;
  const half = v.half;
  if (half) {
    const fwd = cam.userData.pix.dir;
    const px = cam.position.x, py = cam.position.y, pz = cam.position.z;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const d = -((sx * half.x - px) * fwd.x + (sy * half.y - py) * fwd.y + (sz * half.z - pz) * fwd.z);
      if (d < near) near = d;
      if (d > far) far = d;
    }
  }
  const { dist } = cam.userData.pix;
  if (!Number.isFinite(near) || !Number.isFinite(far) || far - near < 1e-9) {
    near = dist - v.radius;
    far = dist + v.radius;
  }
  near = Math.max(near, dist * 1e-3);
  far = Math.max(far, near + 1e-6);
  const lit = st.look === "color" || st.look === "clay" || st.look === "wire";
  if (st.look === "wire") ensureWires(THREE, model);
  applyLook(THREE, model, st, near, far, pointPx);
  applyLights(v, st, cam);
  if (v.grid) v.grid.visible = !!grid && lit;
  v.scene.environment = lit && st.light !== "flat" ? envTexture(THREE, r) : null;
  v.scene.environmentIntensity = (st.light === "soft" ? 1.0 : 0.55) * st.bright;
  r.setSize(w, h, false);
  // clearAlpha 0 is the mask pass: the same look over a see-through background.
  r.setClearColor(new THREE.Color(lookBackground(st)), clearAlpha);
  r.render(v.scene, cam);
}

// ── drawing a node ──────────────────────────────────────────────────────────
const _dirty = new Set();
let _raf = 0;

export function requestDraw(node) {
  if (!node) return;
  _dirty.add(node);
  if (!_raf) _raf = requestAnimationFrame(flush);
}

function flush() {
  _raf = 0;
  const nodes = [..._dirty];
  _dirty.clear();
  for (const n of nodes) {
    try {
      drawNow(n);
    } catch (e) {
      console.warn("[Pixaroma.Load3D] draw failed", e);
    }
  }
}

/** Glide the camera from where it was to the state's new angle. */
export function animateView(node, fromAz, fromEl) {
  const rec = recOf(node);
  const st = effectiveState(node);
  let reduce = false;
  try { reduce = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (_e) { /* old browser */ }
  if (reduce) {
    rec.anim = null;
  } else {
    const dAz = ((((st.az - fromAz) % 360) + 540) % 360) - 180;
    rec.anim = { az0: fromAz, el0: fromEl, dAz, dEl: st.el - fromEl, t0: performance.now(), dur: 260 };
  }
  requestDraw(node);
}

function displayedAngles(rec, st) {
  const a = rec.anim;
  if (!a) return { az: st.az, el: st.el };
  const t = Math.min(1, (performance.now() - a.t0) / a.dur);
  if (t >= 1) {
    rec.anim = null;
    return { az: st.az, el: st.el };
  }
  requestDraw(rec.node);
  const e = 1 - Math.pow(1 - t, 3);
  return { az: a.az0 + a.dAz * e, el: a.el0 + a.dEl * e };
}

/** Where the picture frame sits inside the view, in CSS px (for interaction maths). */
export function frameRect(cssW, cssH, st) {
  const pad = 10;
  const A = st.w / st.h;
  let fw = Math.max(4, cssW - 2 * pad);
  let fh = fw / A;
  if (fh > cssH - 2 * pad) {
    fh = Math.max(4, cssH - 2 * pad);
    fw = fh * A;
  }
  return { x: (cssW - fw) / 2, y: (cssH - fh) / 2, w: fw, h: fh };
}

/** World units per CSS pixel at the target, for dragging the model around. */
export function panScale(node, cssW, cssH) {
  const rec = _recs.get(node);
  const st = effectiveState(node);
  const f = frameRect(cssW, cssH, st);
  const r = rec?.view?.radius || 1;
  const A = st.w / st.h;
  let halfH;
  if (st.proj === "ortho") {
    halfH = (r * 1.08) / st.zoom;
    if (A < 1) halfH /= A;
  } else {
    const t = Math.tan(deg(st.fov) / 2);
    const halfV = deg(st.fov) / 2;
    const dist = (r * 1.08) / Math.sin(Math.min(halfV, Math.atan(t * A))) / st.zoom;
    halfH = dist * t;
  }
  return { unitsPerPx: (2 * halfH) / f.h, radius: r };
}

function drawFrame(ctx, fr, bw, bh, sc, st) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(0, 0, bw, fr.y);
  ctx.fillRect(0, fr.y + fr.h, bw, bh - fr.y - fr.h);
  ctx.fillRect(0, fr.y, fr.x, fr.h);
  ctx.fillRect(fr.x + fr.w, fr.y, bw - fr.x - fr.w, fr.h);
  const lw = Math.max(1, Math.round(sc));
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = lw;
  ctx.strokeRect(fr.x + lw / 2, fr.y + lw / 2, fr.w - lw, fr.h - lw);
  const label = `${st.w} × ${st.h}`;
  ctx.font = `${Math.round(10 * sc)}px ui-sans-serif, system-ui, sans-serif`;
  const tw = ctx.measureText(label).width;
  const px = fr.x + 5 * sc;
  const py = fr.y + 5 * sc;
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(px - 3 * sc, py - 2 * sc, tw + 6 * sc, 14 * sc);
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.textBaseline = "top";
  ctx.fillText(label, px, py);
  ctx.restore();
}

function drawNow(node) {
  const rec = _recs.get(node);
  const cv = rec?.canvas;
  if (!cv) return;
  const cssW = cv.clientWidth;
  const cssH = cv.clientHeight;
  if (cssW < 8 || cssH < 8) return; // hidden: ComfyUI parks off-screen widgets at display:none
  const sc = canvasBackingScale(cssW, cssH);
  const bw = Math.max(1, Math.round(cssW * sc));
  const bh = Math.max(1, Math.round(cssH * sc));
  if (cv.width !== bw) cv.width = bw;
  if (cv.height !== bh) cv.height = bh;
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const st = effectiveState(node);
  const f = frameRect(cssW, cssH, st);
  const fr = { x: f.x * (bw / cssW), y: f.y * (bh / cssH), w: f.w * (bw / cssW), h: f.h * (bh / cssH) };

  const THREE = _THREE;
  const r = rec.status === "ready" && rec.model && THREE ? getRenderer(THREE) : null;
  if (!r) {
    ctx.fillStyle = lookBackground(st);
    ctx.fillRect(0, 0, bw, bh);
    drawFrame(ctx, fr, bw, bh, sc, st);
    return;
  }
  applyOrientation(THREE, rec, st);
  const ang = displayedAngles(rec, st);
  const cam = cameraFor(THREE, rec.view, st, ang.az, ang.el, st.w / st.h, bw / bh, bh / fr.h);
  renderScene(THREE, r, rec, st, cam, bw, bh, { grid: st.grid, pointPx: Math.max(1, 1.5 * sc) });
  ctx.clearRect(0, 0, bw, bh);
  ctx.drawImage(r.domElement, 0, 0, bw, bh, 0, 0, bw, bh);
  drawFrame(ctx, fr, bw, bh, sc, st);
}

function toBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("the browser could not make the picture"))), "image/png");
  });
}

function canvas2d(src, w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("the browser could not make the picture");
  ctx.drawImage(src, 0, 0, w, h, 0, 0, w, h);
  return { c, ctx };
}

/**
 * The picture and the mask at the state's exact size, for the image and mask
 * outputs. Draws the model named by `value`, loading it first if needed.
 *
 * The mask is the COVERAGE of that same picture: the look drawn a second time
 * over a clear background, its alpha turned into grey. It used to be a pass of
 * its own painting every face white from both sides, which ignored single-sided
 * faces and cutout textures, so it claimed model wherever the picture showed a
 * hole (35,070 px at 1024 on a box with three inward faces). Core's Load 3D
 * takes its mask from the alpha in the same way.
 *
 * Both renders are copied off the shared canvas before the first await: any
 * node's redraw can run during an await, and it repaints that canvas and
 * re-aims this node's camera.
 */
export async function captureModel(node, value, state = null) {
  await ensureReady(node, value);
  const THREE = await loadLibs();
  const r = getRenderer(THREE);
  if (!r) throw new Error("WebGL is not available in this browser");
  const rec = recOf(node);
  // Draw the state the CALLER named the picture after. Reading it again here,
  // after the awaits above, stored a view changed while the model was loading
  // under the old view's file name (measured: a Left picture saved as Front).
  const st = state || effectiveState(node);
  const limit = Math.min(r.capabilities?.maxTextureSize || 4096, 16384);
  let w = st.w;
  let h = st.h;
  if (Math.max(w, h) > limit) {
    const k = limit / Math.max(w, h);
    w = Math.max(1, Math.floor(w * k));
    h = Math.max(1, Math.floor(h * k));
  }
  applyOrientation(THREE, rec, st);
  rec.anim = null;
  const cam = cameraFor(THREE, rec.view, st, st.az, st.el, w / h, w / h, 1);
  const pointPx = Math.max(1, Math.round(Math.min(w, h) / 512));
  renderScene(THREE, r, rec, st, cam, w, h, { grid: false, pointPx });
  const picture = canvas2d(r.domElement, w, h);
  renderScene(THREE, r, rec, st, cam, w, h, { grid: false, pointPx, clearAlpha: 0 });
  const cover = canvas2d(r.domElement, w, h);
  // Keep only the alpha, paint it white, then lay that over black: grey = coverage.
  cover.ctx.globalCompositeOperation = "source-in";
  cover.ctx.fillStyle = "#ffffff";
  cover.ctx.fillRect(0, 0, w, h);
  cover.ctx.globalCompositeOperation = "destination-over";
  cover.ctx.fillStyle = "#000000";
  cover.ctx.fillRect(0, 0, w, h);
  requestDraw(node);
  try {
    const [image, mask] = await Promise.all([toBlob(picture.c), toBlob(cover.c)]);
    return { image, mask, w, h };
  } finally {
    // A 4096 px canvas holds about 64 MB until it is collected.
    picture.c.width = 0;
    cover.c.width = 0;
  }
}
