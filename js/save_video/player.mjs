// Save Video Pixaroma - the in-node video player and its control bar.
//
// Adapted from js/save_mp4/index.js, and it carries that node's hard-won
// behaviour FROM THE START rather than waiting to rediscover it:
//   * a clip whose file is gone shows the placeholder with a REASON, driven by
//     the media element's own `error` event (save-mp4 pattern #10)
//   * the scrub drag has the buttons-are-up guard, or a lost mouseup leaves it
//     seeking under a bare cursor forever (save-mp4 pattern #11, convention #20)

import { pixApiUrl, pixAsset } from "../shared/api_url.mjs";
import { buildVolumeControl, applyVideoVolume } from "../shared/video_volume.mjs";

const UI_ICON = "icons/ui/";
export const PLACEHOLDER_DEFAULT = "Run the workflow to save and play the video here";

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// A saved file reaches the browser one of two ways, and the entry says which:
//   inside output/ or temp/  -> ComfyUI's own /view
//   the user's own folder    -> our token route, because /view cannot reach it
// Both go through pixApiUrl: a root-relative URL works on localhost and 401s on
// a hosted ComfyUI (hosted-urls pattern #1).
export function buildVideoUrl(entry) {
  if (!entry) return "";
  // Cache-bust so the browser cannot reuse a stale file when the counter lands
  // on a name it has seen before.
  const bust = String(Date.now());
  if (entry.token) {
    return pixApiUrl(`/pixaroma/api/save_video/file?t=${encodeURIComponent(entry.token)}&b=${bust}`);
  }
  const params = new URLSearchParams({
    filename: entry.filename || "",
    subfolder: entry.subfolder || "",
    type: entry.type || "output",
    t: bust,
  });
  return pixApiUrl(`/view?${params.toString()}`);
}

function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Re-cache the element refs after a Vue rebuild (a tab switch replaces the DOM
// while node._xxx fields survive, so a cached ref can be detached).
export function getLive(node) {
  const ui = node._pixSvUI;
  if (!ui) return null;
  if (ui.video?.isConnected) return ui.video;
  const root = node._pixSvRoot;
  if (!root?.isConnected) return null;
  ui.video = root.querySelector("video");
  ui.vph = root.querySelector(".pix-sv-vph");
  ui.bar = root.querySelector(".pix-sv-bar");
  ui.playIco = root.querySelector(".pix-sv-btn .pix-sv-ico");
  ui.fill = root.querySelector(".pix-sv-scrub-fill");
  ui.handle = root.querySelector(".pix-sv-scrub-handle");
  ui.time = root.querySelector(".pix-sv-time");
  return ui.video?.isConnected ? ui.video : null;
}

// Sync the bar to the video's state: enabled or greyed, play vs pause icon,
// scrub fill + handle, and the time readout. Cheap and idempotent, so wiring it
// to timeupdate is fine.
export function refreshBar(node) {
  const ui = node._pixSvUI;
  const v = ui?.video;
  if (!v || !ui.bar) return;
  // A src whose file FAILED to load is not a clip. Asking only `!!v.src` is what
  // left Save Mp4's bar looking live and clickable over a black rectangle when
  // the persisted clip had been deleted. The flag is a RUNTIME field set by the
  // element's own error event and cleared when a fresh load starts or succeeds,
  // so a load merely still in flight is never mistaken for a failed one -
  // reading v.error directly would flicker, because aborting an in-flight load
  // transiently sets MEDIA_ERR_ABORTED on every restore.
  const hasClip = !!v.src && !node._pixSvFailed;
  ui.bar.classList.toggle("is-disabled", !hasClip);
  const playing = hasClip && !v.paused && !v.ended;
  ui.playIco?.style.setProperty(
    "--ico",
    `url(${pixAsset(UI_ICON + (playing ? "pause" : "play") + ".svg")})`
  );
  const dur = isFinite(v.duration) ? v.duration : 0;
  const cur = isFinite(v.currentTime) ? v.currentTime : 0;
  const ratio = dur > 0 ? Math.max(0, Math.min(1, cur / dur)) : 0;
  const pct = (ratio * 100).toFixed(2) + "%";
  if (ui.fill) ui.fill.style.width = pct;
  if (ui.handle) ui.handle.style.left = pct;
  if (ui.time) ui.time.textContent = `${fmtTime(cur)} / ${fmtTime(dur)}`;
}

export function applyVideoEntry(node, entry) {
  const video = getLive(node);
  if (!video || !entry || !entry.filename) return false;
  const ui = node._pixSvUI;
  node._pixSvFailed = false; // a fresh load: not failed until its error event says so
  video.src = buildVideoUrl(entry);
  video.style.display = "block";
  if (ui.vph?.isConnected) {
    // Put the normal text back - this element doubles as the "clip is gone"
    // message and a later successful run has to clear it.
    ui.vph.textContent = PLACEHOLDER_DEFAULT;
    ui.vph.style.display = "none";
  }
  video.load();
  refreshBar(node);
  return true;
}

// The clip's file is not on disk any more, so the element got a 404 and has
// nothing to show. Three routine ways that happens, and none is user error:
// Preview mode writes to ComfyUI's temp/, which is WIPED on every restart; a
// saved file can be moved, renamed or deleted later; and an EXTERNAL save's
// token dies with the server process, so it 404s after a restart even though
// the file is still sitting there.
//
// DISPLAY ONLY. This runs on the workflow LOAD path, so it must NEVER write
// node.properties / node.size / a widget value - clearing the persisted entry
// here would flag an untouched workflow "modified" on every open (Vue Compat
// #18). Keeping the entry is also what lets the message name the cause.
export function showClipMissing(node) {
  node._pixSvFailed = true;
  const ui = node._pixSvUI;
  const video = getLive(node) || ui?.video;
  if (video) video.style.display = "none";
  const ph = ui?.vph;
  if (ph?.isConnected) {
    const last = node.properties?.pixSvLastRun;
    ph.textContent =
      last?.type === "temp"
        ? "Preview clip is gone. ComfyUI clears its temp folder on restart, so run again to make a new one."
        : last?.token
        ? "Cannot reach that video any more. Links to your own folders only last until ComfyUI restarts - the file itself is still where you saved it. Run again to play it here."
        : "Video not found. The file may have been moved, renamed or deleted. Run again to make a new one.";
    ph.style.display = "flex";
  }
  refreshBar(node); // greys the bar, so the play button no longer looks live
}

// Build the media area + control bar. Returns the pieces index.js wires up.
export function buildPlayer(node) {
  const media = el("div", "pix-sv-media");
  const video = document.createElement("video");
  video.className = "pix-sv-video";
  video.setAttribute("playsinline", "");
  video.preload = "metadata";
  const vph = el("div", "pix-sv-vph", PLACEHOLDER_DEFAULT);
  media.appendChild(video);
  media.appendChild(vph);

  const bar = el("div", "pix-sv-bar is-disabled");
  const playBtn = el("button", "pix-sv-btn");
  playBtn.type = "button";
  playBtn.title = "Play / pause";
  const playIco = el("span", "pix-sv-ico");
  playIco.style.setProperty("--ico", `url(${pixAsset(UI_ICON + "play.svg")})`);
  playBtn.appendChild(playIco);
  const time = el("div", "pix-sv-time", "0:00 / 0:00");
  const scrub = el("div", "pix-sv-scrub");
  scrub.title = "Drag to move through the video";
  const fill = el("div", "pix-sv-scrub-fill");
  const handle = el("div", "pix-sv-scrub-handle");
  scrub.appendChild(fill);
  scrub.appendChild(handle);
  const fsBtn = el("button", "pix-sv-btn");
  fsBtn.type = "button";
  fsBtn.title = "Fullscreen";
  const fsIco = el("span", "pix-sv-ico");
  // fit.svg is what Save Mp4's fullscreen button uses; there is no
  // fullscreen.svg in the shared set and inventing one would look different
  fsIco.style.setProperty("--ico", `url(${pixAsset(UI_ICON + "fit.svg")})`);
  fsBtn.appendChild(fsIco);
  // Volume sits between the scrub and fullscreen, where every media player
  // puts it. The level is a shared preference, not node state - see
  // js/shared/video_volume.mjs for why.
  const volume = buildVolumeControl(video);
  bar.appendChild(playBtn);
  bar.appendChild(time);
  bar.appendChild(scrub);
  bar.appendChild(volume.group);
  bar.appendChild(fsBtn);

  const ui = { media, video, vph, bar, playBtn, playIco, time, scrub, fill, handle, fsBtn, volume };
  node._pixSvUI = Object.assign(node._pixSvUI || {}, ui);

  const togglePlay = () => {
    if (!video.src || node._pixSvFailed) return;
    if (video.paused || video.ended) video.play().catch(() => {});
    else video.pause();
  };
  playBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePlay();
  });
  // clicking the picture plays/pauses too, like every other player
  media.addEventListener("click", (e) => {
    if (e.target === video || e.target === media) togglePlay();
  });
  fsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    video.requestFullscreen?.().catch(() => {});
  });

  for (const ev of ["play", "pause", "ended", "timeupdate", "durationchange"]) {
    video.addEventListener(ev, () => refreshBar(node));
  }
  video.addEventListener("loadedmetadata", () => {
    node._pixSvFailed = false; // proven good
    // Re-assert the stored level on every clip. Cheap and idempotent, and it
    // covers any path where the element was replaced without rebuilding the
    // bar - which is exactly what a Vue tab switch can do (Vue Compat #2).
    applyVideoVolume(video);
    // Mirror showClipMissing rather than only half-undoing it. applyVideoEntry
    // is otherwise the ONLY thing that can un-hide the element, so any future
    // route to "failed, then succeeded without a fresh apply" would leave a
    // loaded video hidden behind a stale message. Display-only, driven by a
    // success event, so it cannot touch serialized state.
    video.style.display = "block";
    if (ui.vph?.isConnected) {
      ui.vph.textContent = PLACEHOLDER_DEFAULT;
      ui.vph.style.display = "none";
    }
    refreshBar(node);
  });
  // The ONLY unambiguous signal that a load failed. A pre-flight HEAD cannot
  // work here: a load still in flight is indistinguishable from a failed one by
  // inspection, and this costs no extra round trip.
  video.addEventListener("error", () => showClipMissing(node));

  // ── scrub drag ──
  let dragging = false;
  const seekTo = (clientX) => {
    const r = scrub.getBoundingClientRect();
    if (!r.width || !isFinite(video.duration)) return;
    // a RATIO of two lengths in the same space, so this is zoom-correct in both
    // renderers with no scale correction
    const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    video.currentTime = ratio * video.duration;
    refreshBar(node);
  };
  const onMove = (e) => {
    // Convention #20. Without this a LOST mouseup (cursor leaves the window, a
    // context menu eats the release, another element takes pointer capture)
    // leaves `dragging` true forever, and every later mouse move anywhere on the
    // page seeks the clip under a bare cursor. Measured on Save Mp4 with no
    // button held: 0.506s -> 4.119s -> 2.054s.
    if (!(e.buttons & 1)) {
      endDrag();
      return;
    }
    seekTo(e.clientX);
  };
  const endDrag = () => {
    if (!dragging) return; // idempotent: the guard above can call this too
    dragging = false;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", endDrag);
  };
  scrub.addEventListener("mousedown", (e) => {
    if (node._pixSvFailed || !video.src) return;
    e.stopPropagation();
    // Without this, dragging along the bar starts a native text selection and
    // the filename, hints and "Will save as" line highlight blue behind the
    // player, staying selected after the release. Save Mp4 has it; the line was
    // dropped in the port.
    e.preventDefault();
    dragging = true;
    seekTo(e.clientX);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", endDrag);
  });
  node._pixSvEndDrag = endDrag; // released in onRemoved

  // never let a click on the bar start a node drag
  for (const ev of ["mousedown", "pointerdown"]) {
    bar.addEventListener(ev, (e) => e.stopPropagation());
  }

  return { media, bar, ui };
}
