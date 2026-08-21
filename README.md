<div align="center">
  <img src="assets/pixaroma_logo.svg" width="120" alt="Pixaroma Logo">
  <h1>ComfyUI Pixaroma — EternalShade3D Fork</h1>
  <p align="center">
    <strong>A personal fork of <a href="https://gitlab.com/pixaroma/comfyui-pixaroma">Pixaroma/ComfyUI-Pixaroma</a> with a few local fixes for my own workflows.</strong>
  </p>
  <p align="center">
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License"></a>
  </p>
</div>

---

## 📌 What this fork is

This is **not** an official Pixaroma release. It is a fork I (EternalShade3D) keep so I can run the node pack with a couple of small fixes that matter for my own workflow scenarios. The base is upstream `main` @ `b8ae20e1`.

Everything else in the original project is unchanged. For full docs, nodes, and tutorials, see the upstream project.

## 🔧 Fixes included

All changes are front-end (JavaScript) only — the Python nodes are untouched.

### Inpaint Crop Pixaroma works behind Switch Source Pixaroma

When **Inpaint Crop Pixaroma** receives its image through a **Switch Source Pixaroma** node (instead of a direct Load Image wire):

- **Mask Editor opens the active image** — clicking **Open Mask Editor** now shows the picture of the currently selected A/B bank on the Switch Source (not a blank or wrong image).
- **Node preview updates on bank switch** — toggling the Switch Source A/B bank fires a `pix-switch-source-changed` event that Inpaint Crop listens to, so the preview re-resolves.
- **Upstream resize note** resolves correctly through the same real-source walk.

**Files changed (vs `b8ae20e1`):**

| File | Change |
|------|--------|
| `js/inpaint_crop/index.js` | `getRealImageSource()` walks through a Switch Source; adds the `pix-switch-source-changed` listener. |
| `js/switch_source/index.js` | Emits `pix-switch-source-changed` when the A/B bank toggles. |

> **Not included:** an earlier change to the Inpaint Crop `IS_CHANGED` (removing a disk-mtime read) was reverted. It was not a fix — only an accidental detour while debugging caching behaviour that turned out to be unrelated (Image Receiver from comfyui-impact-pack, `trigger_always`).

## 🔗 Upstream

- Original project (GitLab): https://gitlab.com/pixaroma/comfyui-pixaroma
- GitHub mirror: https://github.com/pixaroma/ComfyUI-Pixaroma
- Discord: https://discord.gg/gggpkVgBf3
- YouTube: https://www.youtube.com/@pixaroma
