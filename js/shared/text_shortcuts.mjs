// Keys that ComfyUI ITSELF handles while one of our text boxes has focus.
//
// Our prompt boxes stop keydown from bubbling, so typing a letter cannot fire a
// canvas shortcut (Delete removes the node, Q queues, and so on). That blanket
// stop also hid the few shortcuts ComfyUI deliberately offers INSIDE text boxes,
// so every such handler asks this first and lets these through:
//
//  - Ctrl/Cmd+Enter: run the workflow (issue #41).
//  - Ctrl/Cmd+ArrowUp / ArrowDown: ComfyUI's own "edit attention" shortcut
//    (core extension Comfy.EditAttention). It turns the selected words into
//    (words:1.05) and steps the weight by the Comfy.EditAttention.Delta setting.
//    It listens on WINDOW, which is why the key has to leave the box, and it
//    writes through execCommand("insertText"), so the box fires an ordinary
//    input event (our own input handlers see the change as if it were typed)
//    and Ctrl+Z inside the box undoes it. Reported on Discord 2026-09-14: it
//    worked in ComfyUI's text boxes and did nothing in ours.
//
// Letting the arrows out changes nothing else: core does not reserve
// Ctrl+ArrowUp/Down for text inputs and binds nothing to them by default
// (platform/keybindings), so our boxes now behave exactly like core's own.
export function isComfyTextShortcut(e) {
  if (!e || !(e.ctrlKey || e.metaKey)) return false;
  return e.key === "Enter" || e.key === "ArrowUp" || e.key === "ArrowDown";
}
