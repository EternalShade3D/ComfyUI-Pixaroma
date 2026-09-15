// Edit 3D Pixaroma - everything that talks to the server: model files through core's /view, uploads through core's
// /upload/image, and the heavy buttons as a one-node job through core's /prompt. There is no route of our own
// (registry-compliance.md 2d / 4e). Bare routes go to api.fetchApi; plain fetch URLs go through pixApiUrl
// (hosted-urls.md).
import { api } from "/scripts/api.js";
import { pixApiUrl } from "../shared/api_url.mjs";
import { OP_CLASS, OP_INPUT, OP_UI_KEY, SUBFOLDER, splitModelName } from "./core.mjs";

export function viewUrl(type, subfolder, filename, bust = "") {
  let q = `/view?filename=${encodeURIComponent(filename)}&type=${encodeURIComponent(type)}`;
  if (subfolder) q += `&subfolder=${encodeURIComponent(subfolder)}`;
  if (bust) q += `&t=${encodeURIComponent(bust)}`;
  return pixApiUrl(q);
}

/** "sub/file.obj [temp]" -> { buf, p }. */
export async function fetchModel(value, bust = "") {
  const p = splitModelName(value);
  const res = await fetch(viewUrl(p.type, p.subfolder, p.filename, bust), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(res.status === 404
      ? "the file is not there any more (ComfyUI empties its temp folder when it starts: run the workflow again)"
      : `the server answered ${res.status}`);
  }
  return { buf: await res.arrayBuffer(), p };
}

/** Core's own upload: a Blob into <type>/<subfolder>/<filename>. -> { name, subfolder, type } as the server kept it. */
export async function upload(blob, filename, { type = "input", subfolder = SUBFOLDER, overwrite = true } = {}) {
  const body = new FormData();
  body.append("image", blob, filename);
  body.append("type", type);
  body.append("subfolder", subfolder);
  if (overwrite) body.append("overwrite", "true");
  const res = await api.fetchApi("/upload/image", { method: "POST", body });
  if (res.status !== 200) {
    throw new Error(res.status === 413 ? "it is bigger than ComfyUI's upload limit (its --max-upload-size setting)" : `the upload answered ${res.status}`);
  }
  const data = await res.json().catch(() => ({}));
  return { name: data?.name || filename, subfolder: data?.subfolder ?? subfolder, type };
}

async function queueState(id) {
  try {
    const res = await api.fetchApi("/queue", { cache: "no-store" });
    if (!res.ok) return "unknown";
    const q = await res.json();
    const running = Array.isArray(q?.queue_running) ? q.queue_running : [];
    const pending = Array.isArray(q?.queue_pending) ? q.queue_pending : [];
    if (running.some((e) => e?.[1] === id)) return "running";
    if (pending.some((e) => e?.[1] === id)) return running.length ? "waiting" : "queued";
    return "gone";
  } catch (_e) {
    return "unknown";
  }
}

/**
 * Queue one heavy button. `file` is a work file already uploaded to temp/pixaroma_edit3d.
 * -> { promise: Promise<answer>, stop() }. The answer is the job's ui dict ({ ok, file, stats, ... } or
 * { ok: false, error }). onStatus receives "waiting" (another run is using ComfyUI) or "running".
 */
export function startJob(file, op, params, onStatus = () => {}) {
  let id = null;
  let finished = false;
  let settle = null; // rejects the answer from outside (Stop on a job still waiting in the queue)
  const listeners = [];
  const on = (name, fn) => { api.addEventListener(name, fn); listeners.push([name, fn]); };
  let poll = 0;
  let limit = 0;
  const cleanup = () => {
    for (const [name, fn] of listeners) api.removeEventListener(name, fn);
    listeners.length = 0;
    clearInterval(poll);
    clearTimeout(limit);
  };

  const promise = (async () => {
    const prompt = { 1: { class_type: OP_CLASS, inputs: { [OP_INPUT]: JSON.stringify({ file, op, params }) } } };
    // Straight to core, NOT through api.queuePrompt: our own and other packs' prune hooks wrap that one.
    const res = await api.fetchApi("/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: api.clientId ?? api.initialClientId ?? "", prompt, front: true }),
    });
    const data = await res.json().catch(() => null);
    if (res.status !== 200 || !data?.prompt_id) {
      const why = data?.error?.message || data?.error || `the server answered ${res.status}`;
      throw new Error(typeof why === "string" ? why : "ComfyUI refused the job");
    }
    id = data.prompt_id;
    return await new Promise((resolve, reject) => {
      const finish = (fn, v) => {
        if (finished) return;
        finished = true;
        cleanup();
        fn(v);
      };
      settle = (err) => finish(reject, err);
      on("executed", (e) => {
        const d = e?.detail;
        if (d?.prompt_id !== id) return;
        const out = d?.output?.[OP_UI_KEY]?.[0];
        if (out) finish(resolve, out);
      });
      on("execution_error", (e) => {
        if (e?.detail?.prompt_id === id) finish(reject, new Error(e.detail.exception_message || "the job failed"));
      });
      on("execution_interrupted", (e) => {
        if (e?.detail?.prompt_id === id) finish(reject, Object.assign(new Error("stopped"), { stopped: true }));
      });
      // A dropped websocket loses events: when the job has left the queue with no answer, ask the history.
      let goneTicks = 0;
      poll = setInterval(async () => {
        if (finished) return;
        const s = await queueState(id);
        if (s === "running" || s === "waiting" || s === "queued") {
          goneTicks = 0;
          onStatus(s === "running" ? "running" : "waiting");
          return;
        }
        if (s !== "gone" || ++goneTicks < 3) return;
        try {
          const h = await api.fetchApi(`/history/${encodeURIComponent(id)}`, { cache: "no-store" });
          const hist = h.ok ? await h.json() : null;
          const entry = hist?.[id];
          const out = entry?.outputs?.["1"]?.[OP_UI_KEY]?.[0];
          if (out) finish(resolve, out);
          else if (entry?.status?.status_str === "error") finish(reject, new Error("the job failed"));
          else if (goneTicks > 10) finish(reject, new Error("the job ended without an answer"));
        } catch (_e) { /* try again on the next tick */ }
      }, 1000);
      limit = setTimeout(() => finish(reject, new Error("the job took more than 20 minutes and was given up")), 20 * 60 * 1000);
    });
  })();
  promise.catch(() => cleanup());

  const stop = async () => {
    if (!id || finished) return;
    const s = await queueState(id);
    try {
      if (s === "running") {
        await api.fetchApi("/interrupt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt_id: id }) });
      } else if (s === "waiting" || s === "queued") {
        await api.fetchApi("/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delete: [id] }) });
        // A job taken out of the queue sends no event, so the answer is settled here.
        settle?.(Object.assign(new Error("stopped"), { stopped: true }));
      }
    } catch (_e) { /* the job ends by itself */ }
  };
  return { promise, stop, get stoppedEarly() { return finished && !id; } };
}
