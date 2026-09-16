// Edit 3D Pixaroma - the view: ONE WebGL renderer made when the editor opens and disposed when it closes (a page gets
// about 16 WebGL contexts, 3d-builder.md #9), the camera and its controls, the named views, zoom, the X Y Z marker,
// the brush ring, the lasso layer, GPU picking, the Remove inside pictures and the node picture.

// Where the CAMERA stands, the same convention as Load 3D (load-3d.md #7): Left looks at the model's own left.
export const VIEWS = {
  front: [0, 0, 1], back: [0, 0, -1], left: [1, 0, 0], right: [-1, 0, 0],
  top: [0, 1, 0.0001], bottom: [0, -1, 0.0001], q: [1.1, 0.55, 1.35],
};

export function createView(THREE, OrbitControls, workspace) {
  const canvas = document.createElement("canvas");
  canvas.className = "pix-e3d-canvas";
  canvas.tabIndex = -1;
  const lasso = document.createElement("canvas");
  lasso.className = "pix-e3d-lasso";
  const axes = document.createElement("canvas");
  axes.className = "pix-e3d-axes";
  axes.width = axes.height = 184;
  const ring = document.createElement("div");
  ring.className = "pix-e3d-ring";
  // The second ring is where the brush also works while Symmetry is on, so it is seen before the press, not after.
  const ring2 = document.createElement("div");
  ring2.className = "pix-e3d-ring mirror";
  workspace.prepend(canvas);
  workspace.append(lasso, axes, ring, ring2);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x141517);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  scene.add(camera);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2c30, 1.25));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(1.2, 1.6, 0.6);
  camera.add(key);
  camera.add(key.target);
  key.target.position.set(0, 0, -1);
  const back = new THREE.DirectionalLight(0xffffff, 0.45);
  back.position.set(-3, 2, -3);
  scene.add(back);

  const controls = new OrbitControls(camera, canvas);
  controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
  controls.zoomToCursor = true;
  controls.screenSpacePanning = true;

  const pickScene = new THREE.Scene();
  pickScene.background = new THREE.Color(0x000000);
  const pickTarget = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const px4 = new Uint8Array(4);
  const lctx = lasso.getContext("2d");
  const actx = axes.getContext("2d");
  const _q = new THREE.Quaternion(), _ax = new THREE.Vector3();

  const view = {
    THREE, renderer, scene, camera, controls, canvas, lasso, lctx, axes, ring, ring2,
    center: new THREE.Vector3(), radius: 1, fitDist: 4, dirty: true, disposed: false, onCamera: null, raf: 0,
  };

  controls.addEventListener("change", () => {
    view.dirty = true;
    view.onCamera?.();
  });

  function resize() {
    const w = Math.max(1, workspace.clientWidth), h = Math.max(1, workspace.clientHeight), dpr = window.devicePixelRatio || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    lasso.width = Math.round(w * dpr);
    lasso.height = Math.round(h * dpr);
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    view.dirty = true;
  }
  const ro = new ResizeObserver(resize);
  ro.observe(workspace);
  resize();

  function frame() {
    if (view.disposed) return;
    view.raf = requestAnimationFrame(frame);
    if (!view.dirty) return;
    view.dirty = false;
    renderer.render(scene, camera);
    drawAxes();
  }
  view.raf = requestAnimationFrame(frame);

  view.requestDraw = () => { view.dirty = true; };

  /** Frame a sphere (center [x,y,z], radius), from the 3/4 view unless keepAngle. */
  view.fit = (center, radius, keepAngle = false) => {
    if (center) view.center.set(center[0], center[1], center[2]);
    if (radius) view.radius = radius;
    const R = view.radius || 1;
    view.fitDist = (R * 1.18) / Math.sin((camera.fov * Math.PI) / 360);
    camera.near = Math.max(R * 0.001, 1e-5);
    camera.far = R * 200;
    camera.updateProjectionMatrix();
    const dir = keepAngle && camera.position.distanceTo(controls.target) > 0
      ? camera.position.clone().sub(controls.target).normalize()
      : new THREE.Vector3(...VIEWS.q).normalize();
    controls.target.copy(view.center);
    camera.position.copy(view.center).addScaledVector(dir, view.fitDist);
    controls.update();
    view.dirty = true;
    view.onCamera?.();
  };

  view.setView = (name) => {
    if (name === "fit") { view.fit(null, null, true); return; }
    const d = new THREE.Vector3(...(VIEWS[name] || VIEWS.q)).normalize();
    const dist = camera.position.distanceTo(controls.target) || view.fitDist;
    camera.position.copy(controls.target).addScaledVector(d, dist);
    camera.up.set(0, 1, 0);
    controls.update();
    view.dirty = true;
    view.onCamera?.();
  };

  view.zoomBy = (k) => {
    const t = controls.target;
    camera.position.copy(camera.position.clone().sub(t).multiplyScalar(k).add(t));
    controls.update();
    view.dirty = true;
    view.onCamera?.();
  };

  view.zoomPercent = () => Math.round((view.fitDist / (camera.position.distanceTo(controls.target) || 1)) * 100);

  function drawAxes() {
    const S = axes.width, c = S / 2, L = S * 0.34;
    _q.copy(camera.quaternion).invert();
    const items = [["X", 1, 0, 0, "#ff5c5c"], ["Y", 0, 1, 0, "#7ee07e"], ["Z", 0, 0, 1, "#6aa0ff"]].map(([n, x, y, z, col]) => {
      _ax.set(x, y, z).applyQuaternion(_q);
      return { n, col, sx: c + _ax.x * L, sy: c - _ax.y * L, depth: _ax.z };
    }).sort((a, b) => a.depth - b.depth);
    actx.clearRect(0, 0, S, S);
    actx.beginPath();
    actx.arc(c, c, c - 2, 0, Math.PI * 2);
    actx.fillStyle = "rgba(0,0,0,0.55)";
    actx.fill();
    for (const it of items) {
      actx.globalAlpha = it.depth < 0 ? 0.45 : 1;
      actx.strokeStyle = it.col;
      actx.lineWidth = 4;
      actx.lineCap = "round";
      actx.beginPath();
      actx.moveTo(c, c);
      actx.lineTo(it.sx, it.sy);
      actx.stroke();
      actx.fillStyle = it.col;
      actx.beginPath();
      actx.arc(it.sx, it.sy, 13, 0, Math.PI * 2);
      actx.fill();
      actx.fillStyle = "#111";
      actx.font = "bold 16px Segoe UI, sans-serif";
      actx.textAlign = "center";
      actx.textBaseline = "middle";
      actx.fillText(it.n, it.sx, it.sy + 1);
    }
    actx.globalAlpha = 1;
  }

  view.drawLasso = (pts) => {
    lctx.clearRect(0, 0, lasso.width, lasso.height);
    if (!pts || pts.length < 2) return;
    lctx.beginPath();
    lctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) lctx.lineTo(pts[i][0], pts[i][1]);
    lctx.closePath();
    lctx.fillStyle = "rgba(246,103,68,0.14)";
    lctx.fill();
    lctx.strokeStyle = "#f66744";
    lctx.lineWidth = 1.5;
    lctx.setLineDash([5, 4]);
    lctx.stroke();
    lctx.setLineDash([]);
  };

  /** The triangle under a screen point: one pixel of the id picture, drawn on the GPU. -> triangle index or -1 */
  view.pickTriangle = (clientX, clientY, pickMesh) => {
    const r = canvas.getBoundingClientRect();
    const x = clientX - r.left, y = clientY - r.top;
    if (x < 0 || y < 0 || x >= r.width || y >= r.height || !pickMesh) return -1;
    const dpr = renderer.getPixelRatio();
    const W = Math.max(1, Math.floor(r.width * dpr)), H = Math.max(1, Math.floor(r.height * dpr));
    // The controls move the camera between frames; its world matrix is only refreshed by a render of the scene.
    camera.updateMatrixWorld();
    pickScene.add(pickMesh);
    camera.setViewOffset(W, H, Math.floor(x * dpr), Math.floor(y * dpr), 1, 1);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(pickTarget);
    renderer.render(pickScene, camera);
    renderer.readRenderTargetPixels(pickTarget, 0, 0, 1, 1, px4);
    renderer.setRenderTarget(prev);
    camera.clearViewOffset();
    pickScene.remove(pickMesh);
    const id = px4[0] | (px4[1] << 8) | (px4[2] << 16);
    return id ? id - 1 : -1;
  };

  /** A ray through a screen point (world space). */
  view.rayAt = (clientX, clientY) => {
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    camera.updateMatrixWorld();
    rc.setFromCamera(ndc, camera);
    return rc.ray;
  };

  /**
   * Which triangles can be seen from outside: the id picture drawn from `dirs` directions spread evenly around the
   * model (Fibonacci sphere), orthographic, each triangle's id read back. -> Uint8Array(T + 1), seen[id]
   */
  view.seenTriangles = async (seenMesh, T, center, radius, dirs = 96, S = 1024, onProgress = null) => {
    const sc = new THREE.Scene();
    sc.background = new THREE.Color(0x000000);
    sc.add(seenMesh);
    const rt = new THREE.WebGLRenderTarget(S, S, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
    const R = radius * 1.02, C = new THREE.Vector3(center[0], center[1], center[2]);
    const cam = new THREE.OrthographicCamera(-R, R, R, -R, R * 0.01, 4 * R);
    const buf = new Uint8Array(S * S * 4), u32 = new Uint32Array(buf.buffer), seen = new Uint8Array(T + 1);
    const prev = renderer.getRenderTarget();
    const golden = Math.PI * (3 - Math.sqrt(5));
    try {
      for (let i = 0; i < dirs; i++) {
        const y = 1 - (2 * (i + 0.5)) / dirs, rr = Math.sqrt(1 - y * y), phi = i * golden;
        const d = new THREE.Vector3(rr * Math.cos(phi), y, rr * Math.sin(phi));
        cam.up.set(0, Math.abs(y) > 0.99 ? 0 : 1, Math.abs(y) > 0.99 ? 1 : 0);
        cam.position.copy(C).addScaledVector(d, 2 * R);
        cam.lookAt(C);
        cam.updateMatrixWorld();
        renderer.setRenderTarget(rt);
        renderer.render(sc, cam);
        renderer.readRenderTargetPixels(rt, 0, 0, S, S, buf);
        for (let j = 0; j < u32.length; j++) {
          const id = u32[j] & 0xffffff;
          if (id) seen[id] = 1;
        }
        if (onProgress && i % 8 === 7) {
          onProgress((i + 1) / dirs);
          await new Promise((r) => setTimeout(r, 0));
        }
      }
    } finally {
      renderer.setRenderTarget(prev);
      sc.remove(seenMesh);
      rt.dispose();
    }
    return seen;
  };

  /** The current view as a PNG blob (the picture on the node). */
  view.snapshotPng = async (w = 512, h = 384) => {
    const rt = new THREE.WebGLRenderTarget(w, h, { samples: 4 });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const aspect = camera.aspect;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const prev = renderer.getRenderTarget();
    const buf = new Uint8Array(w * h * 4);
    try {
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    } finally {
      renderer.setRenderTarget(prev);
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      rt.dispose();
      view.dirty = true;
    }
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    ctx.putImageData(img, 0, 0);
    return await new Promise((r) => c.toBlob(r, "image/png"));
  };

  view.dispose = () => {
    if (view.disposed) return;
    view.disposed = true;
    cancelAnimationFrame(view.raf);
    try { ro.disconnect(); } catch (_e) { /* gone */ }
    try { controls.dispose(); } catch (_e) { /* gone */ }
    pickTarget.dispose();
    renderer.dispose();
    try { renderer.forceContextLoss(); } catch (_e) { /* no context */ }
    for (const e of [canvas, lasso, axes, ring, ring2]) e.remove();
  };
  return view;
}
