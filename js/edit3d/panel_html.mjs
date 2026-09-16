// Edit 3D Pixaroma - the MARKUP of the editor's panels, and nothing else: no state, no listeners, no maths.
// panels.mjs builds this into the framework's shell and wires every button to a method of the editor.
//
// Each panel carries data-mode with the modes it belongs to (space separated); a panel with no data-mode is in every
// mode. The mode switch at the top of the left column shows one set at a time, so nothing a mode cannot do is ever
// on screen. Panels are built ONCE and hidden, never rebuilt, so no listener can go stale.
import { BRUSHES } from "./brushes.mjs";

export const ICONS = {
  select: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/></svg>',
  erase: '<svg viewBox="0 0 24 24"><path d="M4 15l8-8 6 6-5 5H9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M13 19h7" stroke="currentColor" stroke-width="2"/></svg>',
  lasso: '<svg viewBox="0 0 24 24"><path d="M12 4c4.5 0 8 2.5 8 5.8s-3.5 5.8-8 5.8c-2 0-3.8-.5-5.1-1.3M12 4C7.5 4 4 6.5 4 9.8c0 1.6.8 3 2.2 4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7.4 14.6c-1.2 1.6-1.2 3.4-.4 5.4" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  panel: '<svg viewBox="0 0 24 24"><path d="M3 9l9-4.5L21 9l-9 4.5z" fill="currentColor"/><path d="M3 13l9 4.5 9-4.5" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
  detail: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 4.5v15M4.5 12h15" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  piece: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="8" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="13" y="6" width="8" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="7" y="14" width="9" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  move: '<svg viewBox="0 0 24 24"><path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  edge: '<svg viewBox="0 0 24 24"><path d="M3 19L12 6l9 13" fill="none" stroke="currentColor" stroke-width="2.3"/></svg>',
  hole: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle class="red" cx="12" cy="12" r="3.4" fill="none" stroke="#ff4d4d" stroke-width="2.2"/></svg>',
  smooth: '<svg viewBox="0 0 24 24"><path d="M2 16c3 0 3-8 6-8s3 8 6 8 3-6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  even: '<svg viewBox="0 0 24 24"><circle cx="4" cy="12" r="1.8" fill="currentColor"/><circle cx="10" cy="12" r="1.8" fill="currentColor"/><circle cx="16" cy="12" r="1.8" fill="currentColor"/><circle cx="21" cy="12" r="1.8" fill="currentColor"/><path d="M4 18h17" stroke="currentColor" stroke-width="1.4" opacity=".5"/></svg>',
  flatten: '<svg viewBox="0 0 24 24"><path d="M3 9h18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M4 16c2-3 4 1 6-1s4 2 6-1 2 1 4 0" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".55"/></svg>',
  scrape: '<svg viewBox="0 0 24 24"><path d="M3 15h7l2-5 2 5h7" fill="none" stroke="currentColor" stroke-width="1.7" opacity=".55"/><path d="M2 9h20" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  protect: '<svg viewBox="0 0 24 24"><path d="M12 3l7 3v6c0 4-3 6.5-7 9-4-2.5-7-5-7-9V6z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>',
  pinch: '<svg viewBox="0 0 24 24"><path d="M3 12h6M21 12h-6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M7 8l2.5 4L7 16M17 8l-2.5 4L17 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  crease: '<svg viewBox="0 0 24 24"><path d="M3 7h6l3 9 3-9h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  inflate: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 5V2M12 22v-3M5 12H2M22 12h-3M7.5 7.5L5.5 5.5M18.5 18.5l-2-2M16.5 7.5l2-2M5.5 18.5l2-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  buildup: '<svg viewBox="0 0 24 24"><path d="M2 18c4 0 5-9 10-9s6 9 10 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  fill: '<svg viewBox="0 0 24 24"><path d="M3 9h7l2 5 2-5h7" fill="none" stroke="currentColor" stroke-width="1.7" opacity=".55"/><path d="M2 15h20" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M12 12v-4M10 10l2-2 2 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  simplify: '<svg viewBox="0 0 24 24"><path d="M3 5h18M3 19h18" stroke="currentColor" stroke-width="1.5" opacity=".45"/><path d="M12 8v8M9 11l3-3 3 3M9 13l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  spike: '<svg viewBox="0 0 24 24"><path d="M3 16h6l3-11 3 11h6" fill="none" stroke="currentColor" stroke-width="1.7" opacity=".5"/><path d="M2 16h20" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/><path d="M12 9V4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M10 6l2 3 2-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  grab: '<svg viewBox="0 0 24 24"><path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
};

export const TOOLS = [
  ["select", "Select", "B", "Paint a selection on the surface. Hold Ctrl to take away. Example: paint the lumpy top of a helmet, then press Smooth."],
  ["erase", "Deselect", "D", "Paint over a selection to take it away. Example: after All, paint the eyes so Smooth leaves them alone."],
  ["lasso", "Lasso", "L", "Draw a loop to select everything inside it. Ctrl-drag takes away. Example: loop a sword handle, then press Delete."],
  ["panel", "Panel", "P", "Click a flat panel to select all of it. Shift-click adds another. Example: click the wavy side of a gun, then press Flatten."],
  ["piece", "Piece", "I", "Click a part to select the whole separate piece it belongs to. Example: click a floating speck, then press Delete."],
  ["move", "Move", "M", "Drag to pull the surface under the brush; the edge of the brush stays put. Example: pull a dented nose tip back out."],
  ["edge", "Sharpen edge", "E", "Click a panel, then the panel next to it, then press Sharpen edges: the rounded edge between them turns crisp."],
  ["hole", "Fill hole", "O", "Shows holes as red dots; click next to a hole to close it. Example: click beside the dots around a hole in a boot sole."],
];

/** The modes, in the order of the switch. Keep in step with MODES in core.mjs. */
export const MODE_TABS = [
  ["model", "Whole model", "One press fixes the whole model: the skin hidden inside, holes, loose bits, quads, a printable solid. Nothing to pick first."],
  ["sculpt", "Sculpt", "Brushes that shape the surface under your hand: Smooth, Even out, Flatten, Scrape. Hold Ctrl to reverse a brush."],
  ["polys", "Polygons", "Pick the exact faces you mean with the tools on the left, then fix only those."],
];

export const b = (attrs, text, help, name) => `<button type="button" class="pxf-btn" ${attrs}${name ? ` data-name="${name}"` : ""} data-help="${help}">${text}</button>`;
export const seg = (key, items, cls = "") => `<div class="pix-e3d-seg${cls}" data-seg="${key}">${items.map(([v, t, h]) => `<button type="button" data-v="${v}" data-help="${h}">${t}</button>`).join("")}</div>`;

/**
 * A settings row that BELONGS to the button above it. Reported 2026-09-16: "buttons that look like it doesnt do
 * nothing so is not intuitiive" - and they were right, because the only thing joining a chip row to its button was
 * `.pix-e3d-under`'s -1px margin, while the chips are styled exactly like real buttons. Five chips therefore read as
 * five actions, and clicking one appears to do nothing.
 * A NAME on the left says "this is a setting", which is the same shape the Symmetry and Format rows already use.
 */
export const setRow = (label, key, items) =>
  `<div class="pix-e3d-row pix-e3d-setrow"><span>${label}</span>${seg(key, items)}</div>`;
export const sw = (key, text, help) => `<div class="pix-e3d-sw-row" data-switch="${key}" data-name="${text}" data-help="${help}"><span>${text}</span><span class="pix-e3d-sw"></span></div>`;

/** The Symmetry row: the SAME setting wherever it appears, so the two copies can never disagree. */
export const symRow = () => `<div class="pix-e3d-row pix-e3d-symrow" data-name="Symmetry" data-help="Off, or an axis: every tool then works on both sides of the model at once, so a fix on one side happens on the other. The middle is the middle of the model as it opened. Example: Symmetry X, then Panel on a dent picks the dent on the other side too."><span>Symmetry</span>${seg("sym", [["off", "Off", "The tools work only where you point."], ["x", "X", "Both sides left and right at once."], ["y", "Y", "Above and below at once."], ["z", "Z", "Front and back at once."]])}</div>`
  + sw("mirrorRing", "Show the other side", "While Symmetry is on, a blue dashed ring marks the second place the brush is working. Switch it off when it gets in the way; the brush still works on both sides either way.");

export const modesHtml = () => `<div class="pix-e3d-modes">${MODE_TABS.map(([v, t, h]) => `<button type="button" data-mode-btn="${v}" data-name="${t}" data-help="${h}">${t}</button>`).join("")}</div>`;

export function leftHtml() {
  return `
<div class="pxf-panel" data-mode="sculpt"><div class="pxf-panel-title">Brushes</div><div class="pix-e3d-tools">
${BRUSHES.map((b) => `<button type="button" class="pix-e3d-tool" data-brush="${b.id}" data-name="${b.label}" data-help="${b.help}">${ICONS[b.id] || ICONS.smooth}${b.label}</button>`).join("")}
</div>
<div class="pix-e3d-hint">Drag on the model to use the brush. Hold Ctrl to reverse most of them, the [ and ] keys change its size, and one drag is one step in the History.</div>
</div>
<div class="pxf-panel" data-mode="model"><div class="pxf-panel-title">Model check</div>
<div class="pix-e3d-check" data-el="check"></div>
<div class="pix-e3d-hint">A skin hidden inside cannot be counted, only seen: switch X-ray on, or just press Remove inside surfaces.</div>
</div>
<div class="pxf-panel" data-mode="polys"><div class="pxf-panel-title">Tools</div><div class="pix-e3d-tools">
${TOOLS.map(([id, label, key, help]) => `<button type="button" class="pix-e3d-tool" data-tool="${id}" data-name="${label} (${key})" data-help="${help}">${ICONS[id]}${label}</button>`).join("")}
</div></div>
<div class="pxf-panel" data-mode="polys"><div class="pxf-panel-title">Selection</div>
${symRow()}
<div class="pix-e3d-count" data-el="selCount">Nothing selected</div>
<div class="pix-e3d-g3">${b('data-sel="all"', "All", "Selects everything that is shown. (Ctrl+A)")}${b('data-sel="none"', "None", "Clears the selection. (Esc)")}${b('data-sel="invert"', "Invert", "Swaps selected and not selected.")}</div>
<div class="pix-e3d-g2">${b('data-sel="grow"', "Grow", "Adds one row of points all around the selection.")}${b('data-sel="shrink"', "Shrink", "Takes one row of points off the edge of the selection.")}</div>
<div class="pix-e3d-g3">${b('data-sel="hide"', "Hide", "Hides the selected faces so you can reach what is behind them. (H)")}${b('data-sel="isolate"', "Isolate", "Shows only the selection. Example: Isolate a grip to smooth it without touching the rest.")}${b('data-sel="show"', "Show all", "Brings every hidden face back. (Alt+H)")}</div>
</div>
<div class="pxf-panel"><div class="pxf-panel-title">Look</div>
${seg("look", [["clay", "Clay", "Plain grey: the best look for judging the shape."], ["color", "Color", "The model's own colours or texture."], ["wire", "Wire", "The real edges: a quad shows as a quad."], ["normal", "Normal", "Surface directions as colours: odd colours show faces pointing the wrong way."]])}
${sw("holes", "Show holes and broken edges", "Red dots mark open edges (holes), yellow dots broken edges, where more than two faces meet.")}
${sw("xray", "X-ray", "A see-through model, to spot surfaces hidden inside it. (X)")}
</div>
<div class="pxf-panel"><div class="pxf-panel-title">View</div>
<div class="pix-e3d-g4">${b('data-view="front"', "Front", "Looks at the front. (1)")}${b('data-view="back"', "Back", "Looks at the back. (Ctrl+1)")}${b('data-view="left"', "Left", "Looks at the model's left side. (Ctrl+3)")}${b('data-view="right"', "Right", "Looks at the model's right side. (3)")}</div>
<div class="pix-e3d-g4">${b('data-view="top"', "Top", "Looks down from above. (7)")}${b('data-view="bottom"', "Bottom", "Looks up from below. (Ctrl+7)")}${b('data-view="q"', "3/4", "The three-quarter view. (0)")}${b('data-view="fit"', "Fit", "Frames the whole model again. (F)")}</div>
<div class="pix-e3d-hint">Right-drag turns the view, middle-drag moves it, the wheel zooms. The marker at the bottom right shows which way X, Y and Z point.</div>
</div>`;
}

export function rightHtml() {
  // `owns` is the key of the settings row underneath: the button then joins to it as one box (square bottom, no
  // gap) and carries the chosen value on its right, so pressing it says what it will do and clicking a chip is
  // visibly answered. A button with NO row below must not pass it, or it renders with a cut-off bottom edge.
  const wide = (attrs, text, help, badge = "", owns = "") => `<button type="button" class="pxf-btn pix-e3d-wide${owns ? " pix-e3d-owner" : ""}" ${attrs} data-name="${text}" data-help="${help}">${text}${badge}${owns ? `<span class="pix-e3d-btnval" data-btnval="${owns}"></span>` : ""}</button>`;
  return `
<div class="pxf-panel" data-mode="sculpt"><div class="pxf-panel-title">Brush settings</div>
<div class="pix-e3d-brushname" data-el="brushName"></div>
<div class="pix-e3d-slider" data-name="Strength" data-help="How hard the brush pulls, from 1% to 100% in steps of one. Each brush remembers its own: Smooth likes half, Pinch and Crease want under a tenth of that. Several soft passes always beat one hard one."><span>Strength</span><input type="range" min="1" max="100" step="1" data-brange="strength"><b data-out="strength"></b></div>
${symRow()}
<div class="pix-e3d-row pix-e3d-symrow" data-name="Selection" data-help="What the area you picked in Polygons mode does to the brushes. Protected means the brush cannot move it; Only there means the brush moves nothing else."><span>Selection</span>${seg("lock", [["off", "Off", "The selection is ignored: the brush works wherever you drag it."], ["protect", "Protected", "The brush never moves the selected points. Select a crisp edge, then smooth right up against it without losing it."], ["only", "Only there", "The brush moves the selected points and nothing else, however big the brush is."]])}</div>
<div class="pix-e3d-locknote" data-el="lockNote"></div>
<div class="pix-e3d-g2">${b('data-sel="none"', "Clear", "Rubs out the whole painted area, so every brush can reach everywhere again. (Esc)")}${b('data-sel="invert"', "Invert", "Swaps it over: what was protected is free and what was free is protected.")}</div>
<div class="pix-e3d-hint">Most brushes move the points that are already there. Add detail splits the edges under the brush when a patch is too coarse to shape, Simplify merges them away when it came out too dense, and Quads in Whole model is quicker when the density is wrong all over.</div>
</div>
<div class="pxf-panel" data-mode="polys"><div class="pxf-panel-title">Fix the selection</div>
${wide('data-op="flatten"', "Flatten", "Moves the selected panel onto its best flat plane. Points facing another way are left alone, and the edge of the selection fades in. Example: Panel on a wavy car door, then Flatten.")}
<div class="pix-e3d-slider" data-name="Flatten strength" data-help="How far the points move onto the plane: 100% is fully flat."><span>Strength</span><input type="range" min="10" max="100" step="5" data-range="flatStrength"><b data-out="flatStrength"></b></div>
${wide('data-op="smooth"', "Smooth", "Evens out lumps inside the selection without shrinking it. Example: brush over bumpy cheeks, Smooth at 40%.")}
<div class="pix-e3d-slider" data-name="Smooth strength" data-help="How many smoothing passes run: more is softer."><span>Strength</span><input type="range" min="10" max="100" step="5" data-range="smoothStrength"><b data-out="smoothStrength"></b></div>
${wide('data-op="straighten"', "Straighten", "Flattens the selection and turns it exactly level or upright, when it is within 15 degrees of that. Example: a table top that tilts a little.")}
${wide('data-op="symmetrise"', "Make symmetric", "Folds the selection across the symmetry plane: each point is paired with the one nearest its mirror INSIDE the selection, and both move to the middle. Pick an axis under Symmetry first. It only moves points, so it can never break the mesh. Example: one side of a grip came out fatter than the other.")}
<div class="pix-e3d-slider" data-name="Symmetry strength" data-help="How far the two sides move together: 100% makes them match exactly, less leaves some of the difference."><span>Strength</span><input type="range" min="10" max="100" step="5" data-range="symStrength"><b data-out="symStrength"></b></div>
${wide('data-op="sharpen"', "Sharpen edges", "With two panels picked by the Sharpen edge tool: flattens both and closes the rounded edge between them into a crisp one.")}
<div class="pxf-btn-row">${b('data-op="del"', "Delete", "Removes the selected faces. (Delete)")}${b('data-op="fillSelection"', "Fill holes", "Closes the holes whose whole edge is inside the selection. Example: Lasso around a hole in a shoulder, then Fill holes.")}</div>
</div>
<div class="pxf-panel" data-mode="model"><div class="pxf-panel-title">Whole model</div>
${wide('data-op="quickClean"', "Quick clean up", "The three fixes every AI model needs, in order and in one press: Remove inside surfaces, Fill holes at Small, Remove loose bits. It counts as one step, so one Undo takes all three back. Cutting the skin away from inside opens the seam where the two skins met, so it says how many bigger holes are left and what to press next. Example: the first thing to press on a fresh Pixal3D or Trellis 2 model.")}
<div class="pix-e3d-hint pix-e3d-under">Or press them one at a time:</div>
${wide('data-op="removeInside"', "Remove inside surfaces", "Removes every face that can never be seen from outside: the second skin AI models carry inside. Often more than half the model.")}
${wide('data-op="fillHoles"', "Fill holes", "Closes the holes whose rim is no longer than the size chosen below, and fills again while it keeps finding them. Any size closes every hole the editor can walk around; a big one gets a flat cap, so look at it afterwards. Example: after Remove inside surfaces, at Small.", '<span class="pix-e3d-badge" data-el="holeBadge"></span>', "holeSize")}
${setRow("Size", "holeSize", [["16", "Small", "Rims of up to 16 edges: pinholes and the specks left where the inside skin was cut away."], ["60", "Medium", "Rims of up to 60 edges: the openings a cleaned AI model usually has left."], ["100000", "Any size", "Every hole the editor can walk around. A big opening is closed with a flat cap, so check it afterwards."]])}
${wide('data-op="removeLoose"', "Remove loose bits", "Removes the separate pieces smaller than 8 faces: the specks AI models scatter around.", '<span class="pix-e3d-badge" data-el="looseBadge"></span>')}
${wide('data-op="closeCracks"', "Close cracks", "Joins open edges that almost touch, then closes the small gaps left. Example: a model spliced from several views, at 0.25%.", "", "cracks")}
${setRow("Gap", "cracks", [["0.1", "0.1%", "Joins edges closer than 0.1% of the model's size: only hairline cracks."], ["0.25", "0.25%", "Joins edges closer than 0.25% of the model's size."], ["0.5", "0.5%", "Joins edges closer than 0.5% of the model's size."], ["1", "1%", "Joins edges closer than 1% of the model's size: wide cracks, but small details can fuse."]])}
${wide('data-heavy="quads"', "Quads", "Lays a clean grid of quads over the whole model, following its crisp edges. Example: before sending a model to Blender or a game engine.", "", "quads")}
${setRow("Count", "quads", [["10000", "10K", "10,000 quads: very light, for a game or a web viewer. This is also the way to make a QUAD model lighter, since Reduce polygons turns it into triangles."], ["25000", "25K", "25,000 quads: light, and still holds the big shapes."], ["50000", "50K", "50,000 quads: light, for games."], ["100000", "100K", "100,000 quads: about half the time of 200K."], ["200000", "200K", "200,000 quads: keeps slots, panel lines and small round details."]])}
${wide('data-heavy="reduce"', "Reduce polygons", "Removes faces while keeping the shape, and the model comes back as TRIANGLES: it is the same kind of decimation Blender does, and it holds the original shape better than rebuilding it. To make a QUAD model lighter and keep the quads, press Quads at a lower number instead. Example: a 1.5 million triangle model for a web viewer, at -75%.", "", "reduce")}
${setRow("Amount", "reduce", [["25", "-25%", "Keeps three quarters of the triangles."], ["50", "-50%", "Keeps half of the triangles."], ["75", "-75%", "Keeps a quarter of the triangles."]])}
${wide('data-heavy="solid"', "Make solid", "Rebuilds the model as one closed solid for 3D printing. It softens small details, so use it last. More detail keeps more of the shape and takes longer.", "", "solid")}
${setRow("Detail", "solid", [["256", "256", "Fastest, softest."], ["384", "384", "The usual choice."], ["512", "512", "The most detail, the slowest."]])}
${wide('data-heavy="mirror"', "Make both sides match", "Throws one side away and copies the other over it, so the two halves are exactly the same. This is not the Symmetry switch: this one rebuilds the model. Example: a character whose left arm came out better.", "", "mirrorAxis")}
<div class="pix-e3d-row pix-e3d-setrow"><span>Axis</span>${seg("mirrorAxis", [["x", "X", "Match left and right."], ["y", "Y", "Match top and bottom."], ["z", "Z", "Match front and back."]])}${seg("mirrorSide", [["positive", "Keep +", "Keeps the side on the plus end of the axis."], ["negative", "Keep -", "Keeps the side on the minus end of the axis."]])}</div>
</div>
<div class="pxf-panel"><div class="pxf-panel-title">Save to Disk as</div>
<div class="pix-e3d-row"><span>Format</span>${seg("fmt", [["auto", "Auto", "OBJ, or GLB when the model keeps a texture."], ["obj", "OBJ", "Keeps quads and colours."], ["glb", "GLB", "Keeps colours and a texture."], ["stl", "STL", "For 3D printing: standing on Z, 100 mm on its longest side."]])}</div>
<div class="pix-e3d-row" data-name="Name" data-help="The file name inside output/3d. A number is added when the name is taken, so nothing is written over."><span>Name</span><input class="pix-e3d-name" data-el="name" maxlength="80" spellcheck="false"></div>
<div class="pix-e3d-row"><span>Turn Y</span>${seg("turnY", [["0", "0", "No turn."], ["90", "90", "A quarter turn around Y."], ["180", "180", "A half turn around Y."], ["270", "270", "Three quarters of a turn around Y."]])}</div>
${sw("center", "Center on the ground", "Puts the written copy in the middle, standing on the ground, so it opens the right way in Blender.")}
</div>
<div class="pxf-panel"><div class="pxf-panel-title">History</div><ol class="pix-e3d-history" data-el="history"></ol></div>`;
}
