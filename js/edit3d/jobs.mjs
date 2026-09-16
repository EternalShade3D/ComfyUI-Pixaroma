// Edit 3D Pixaroma - the model written as a file (the work file of a job, and Save), and the four heavy buttons
// (Quads, Reduce polygons, Make solid, Mirror) as a one-node job through ComfyUI's own queue: the work file goes to
// temp/pixaroma_edit3d, the hidden Edit 3D job node reads it, and its answer names the result file.
import { upload, startJob, fetchModel } from "./server.mjs";
import { readObj, writeObj } from "./objio.mjs";
import { writeGlb } from "./writers.mjs";
import { workName, SUBFOLDER, fmtInt, facesText } from "./core.mjs";

const NAMES = { quads: "Quads", reduce: "Reduce polygons", solid: "Make solid", mirror: "Mirror" };
const GENERATOR = "Pixaroma Edit 3D";

/** GLB when the model keeps a texture, OBJ (quads, colours) otherwise. -> { blob, ext } */
export async function modelFile(model) {
  if (model.texture && model.cornerUv) {
    const tri = model.toTriangles(true);
    const png = await model.texturePng();
    const buf = writeGlb({ ...tri, texturePng: png, generator: GENERATOR });
    return { blob: new Blob([buf], { type: "model/gltf-binary" }), ext: "glb" };
  }
  return { blob: new Blob([writeObj(model.toObjModel(), GENERATOR)], { type: "text/plain" }), ext: "obj" };
}

function paramsFor(ed, op) {
  if (op === "quads") return { quads: ed.opts.quads, symmetry: "auto" };
  if (op === "reduce") return { percent: ed.opts.reduce };
  if (op === "solid") return { detail: ed.opts.solid };
  return { axis: ed.opts.mirrorAxis, side: ed.opts.mirrorSide };
}

function labelFor(op, p, a) {
  const faces = facesText(a.faces);
  if (op === "quads") return `Quads ${Math.round(p.quads / 1000)}K (${faces})`;
  if (op === "reduce") return `Reduce polygons -${p.percent}% (${faces})`;
  if (op === "solid") return `Make solid ${p.detail} (${faces}${a.edges ? (a.edges.open ? `, ${fmtInt(a.edges.open)} open edges` : ", closed") : ""})`;
  return `Mirror ${String(p.axis).toUpperCase()}, keep the ${p.side === "negative" ? "-" : "+"} side (${faces})`;
}

const stoppedError = () => Object.assign(new Error("stopped"), { stopped: true });

export async function runHeavy(ed, op) {
  const name = NAMES[op];
  const m = ed.model;
  if (!name || !ed.loaded || !m) return;
  if (ed.busy) { ed.ui.toast("Wait for the current job to finish, or press Stop.", 3000); return; }
  if (ed.showingBefore) ed.setBeforeAfter("after");
  if (!m.stats.alive) { ed.ui.toast("There are no faces left to work on."); return; }
  ed.tools?.cancel();
  const params = paramsFor(ed, op);
  ed.busy = true;
  let job = null, stopped = false;
  ed.ui.setBusy(`${name}...`);
  const stop = () => { stopped = true; job?.stop(); };
  ed._stopJob = stop; // closing the editor stops the job too
  ed.ui.showJob(`${name}: sending the model to ComfyUI...`, stop);
  try {
    const { blob, ext } = await modelFile(m);
    if (stopped) throw stoppedError();
    const up = await upload(blob, workName(ed.fileId, ext), { type: "temp", subfolder: SUBFOLDER, overwrite: true });
    if (stopped) throw stoppedError();
    ed.ui.updateJob(`${name}: in the queue...`);
    job = startJob(up.name, op, params, (s) => {
      if (!ed.isOpen()) return;
      ed.ui.updateJob(s === "waiting" ? `${name}: waiting for the run in progress to finish...`
        : `${name}: working${op === "quads" ? " (ComfyUI may pause for a few seconds)" : ""}...`);
    });
    const answer = await job.promise;
    if (stopped) throw stoppedError();
    if (!ed.isOpen()) return;
    if (!answer?.ok) throw new Error(answer?.error || "the job failed");
    ed.ui.updateJob(`${name}: loading the result...`);
    const f = answer.file || {};
    const { buf } = await fetchModel(`${f.subfolder ? f.subfolder + "/" : ""}${f.filename} [${f.type || "temp"}]`, String(Date.now()));
    if (!ed.isOpen()) return;
    const src = readObj(new TextDecoder().decode(buf));
    if (!src.counts.length) throw new Error("the result has no faces");
    const snap = m.snapshot("all");
    m.replaceWith({ positions: src.positions, counts: src.counts, indices: src.indices, colours: src.colours, uvs: null, texture: null, polys: true });
    ed.symC = m.center.slice();
    const label = labelFor(op, params, answer);
    ed.ops.push(snap, label);
    ed.afterGeometry();
    ed.ui.toast(answer.stats?.note ? `${label}. ${answer.stats.note}` : `${label}: done in ${answer.seconds} s.`, 7000);
  } catch (err) {
    if (ed.isOpen()) {
      if (err?.stopped || stopped) ed.ui.toast(`${name} was stopped. The model is as it was.`, 4000);
      else {
        console.error("[Pixaroma.Edit3D]", err);
        ed.ui.toast(`${name} did not work: ${err?.message || err}`, 9000);
      }
    }
  } finally {
    ed.busy = false;
    ed._stopJob = null;
    if (ed.isOpen()) {
      ed.ui.hideJob();
      ed.ui.clearBusy();
    }
  }
}
