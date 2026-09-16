// Edit 3D Pixaroma - the help: EDIT3D_HELP for the Help browser and the node's ? button, EDITOR_HELP_HTML for the
// Help window inside the editor. The same words in both; every tool and button carries an example. No em dashes.

export const EDIT3D_HELP = {
  title: "Edit 3D Pixaroma",
  tagline: "Clean up a 3D model in a fullscreen editor: one-click fixes for the whole model, hand tools for the exact faces you pick, then hand the edited model on or save it to disk.",
  sections: [
    {
      heading: "What it does",
      body:
        "3D models made by AI (Pixal3D, Trellis 2, Hunyuan 3D) come out with a hidden second skin inside, small holes, loose specks, " +
        "wavy flat panels and soft edges. Edit 3D opens the model in a fullscreen editor with a mode for each kind of work: " +
        "Whole model, where one press fixes everything at once (Remove inside surfaces, Fill holes, Quads, Make solid...), " +
        "Sculpt, where brushes shape the surface under your hand (Smooth a lumpy area, Scrape a bump off a panel), " +
        "and Polygons, where you pick exactly the faces you mean and fix only those (Flatten a wavy panel, Sharpen an edge, " +
        "Delete a loose piece). Nothing changes that you did not ask for, and every step can be undone.",
    },
    {
      heading: "Quick start",
      bullets: [
        "Pick a model on the node, press Upload to add one, or wire a mesh (from Pixal3D or Trellis 2) or a model_3d (from Load 3D Pixaroma) into it. A wired model needs one Run first.",
        "Press Open Edit 3D. It opens in Whole model mode, and Model check on the left says what this model needs.",
        "Press Quick clean up. That is Remove inside surfaces, Fill holes at Small and Remove loose bits in one press, and one Undo takes all three back. It then says how many bigger holes are left, because cutting the skin away from inside opens the seam where the two skins met.",
        "If holes are left, press Fill holes again at Medium or Any size. For a 3D print, press Make solid: that one always gives a single closed solid.",
        "Switch to Polygons mode for what still looks wrong: pick an area with a tool on the left, then press a button under Fix the selection.",
        "Press Save. The editor closes, the node shows a picture of your edit, and the next Run hands the edited model on. Save to Disk writes a file into output/3d instead.",
      ],
    },
    {
      heading: "The modes",
      body:
        "The switch at the top left decides what the editor shows. It never changes the model, so you can switch as often as you like, "
        + "and the view, the looks, Before and After, Undo, the History and both Save buttons are there in every mode.",
      defs: [
        ["Whole model", "One press, the whole model, nothing to pick first. Model check on the left lists what is wrong and which button fixes it, with a Fix button on each line that needs one."],
        ["Sculpt", "Brushes that shape the surface under your hand: Smooth, Even out, Flatten and Scrape. Hold Ctrl to reverse any of them, and one drag is one step you can undo."],
        ["Polygons", "Pick the exact faces you mean with the tools on the left, then fix only those on the right. This is where the selection brushes, Lasso, Panel, Piece, Hide and Isolate live."],
      ],
    },
    {
      heading: "The node",
      defs: [
        ["Model list, arrows and Upload", "Choose the model to edit from input/3d and output/3d, step through them with the arrows, or add one from your computer. While a mesh or model_3d is wired in, the list is switched off and the wired model is used."],
        ["Open Edit 3D", "Opens the fullscreen editor. Clicking the picture does the same."],
        ["The picture", "The model as you last saved it in the editor."],
        ["The bottom line", "How many edits are saved, and the faces and holes of what the last Run handed on."],
        ["mesh (output)", "The edited model as triangles with its colours, for any mesh node."],
        ["model_3d (output)", "The edited model as a file: an OBJ that keeps quads and colours, or a GLB that keeps a texture. Wire it into Save 3D Pixaroma."],
        ["report (output)", "What was handed on, as text."],
      ],
    },
    {
      heading: "Sculpt mode: which brush for what",
      body:
        "Three of them look alike and are not. FLATTEN moves everything under the brush onto one plane, so it fills the dents "
        + "AND shaves the bumps AND pulls the good surface in with them: reach for it when the whole patch is wavy. "
        + "FILL raises only what sits below and leaves everything else exactly where it is: that is the one for dents and pits "
        + "in a surface that is otherwise good. SCRAPE is its opposite and takes off only what sticks out. "
        + "EVEN OUT changes no shape at all, it only spreads the points evenly, so it will never fix a dent.\n\n"
        + "So: dents in the flat side of a gun means Fill, at a low strength, with a brush a good deal wider than the dent. "
        + "If the whole side waves, Flatten it first and then Fill what is left.\n\n"
        + "ONE point standing out of a smooth surface, the little tent a single pulled vertex makes, is a different thing "
        + "again: that is FIX SPIKES, and it takes one click. Smooth will not do it, because a spike looks like a sharp "
        + "edge and Smooth is built to keep those.\n\n"
        + "DENSITY is a different question from shape. Even out spreads the points you have more evenly without changing "
        + "the shape, but it cannot remove any. SIMPLIFY does remove them, merging the shortest edges under the brush, "
        + "which is what a patch far denser than everything around it needs. ADD DETAIL is the other half of that pair "
        + "and goes the other way: it splits the edges under the brush, without moving the surface at all, so a patch "
        + "too coarse for any brush to bite on has something to shape. For a model whose density is uneven all over, "
        + "Quads in Whole model is quicker than brushing every patch by hand.",
    },
    {
      heading: "Sculpt mode: the brushes",
      body:
        "Drag on the model and the surface moves under the brush. Every brush pulls the surface towards something that is "
        + "already right, which is what makes them repair tools and not modelling clay: the neighbours, a flat plane, the crease. "
        + "Hold Ctrl to reverse a brush, and one drag is one step in the History. A brush stamps once per step along the path, "
        + "so holding still does not pile strokes up.",
      table: {
        headers: ["Brush", "What it does", "Example"],
        rows: [
          ["Smooth", "Evens the surface out towards its neighbours, and stops at a crease, so a crisp edge beside the lumps survives. Ctrl sharpens instead.", "The stair steps and lumps on a curved AI surface."],
          ["Simplify", "Merges the shortest edges under the brush, so a patch that came out far denser than the rest loses points and matches its surroundings. Strength sets how long an edge may be and still be merged. It never touches a hole's rim, never folds the surface, and refuses any merge that would flip a face.", "The crowded triangles left behind where a dent used to be."],
          ["Add detail", "Splits the edges under the brush so there are more points to work with, and moves the surface not at all: every new point sits exactly on the edge it splits. Strength sets how fine it goes, and an edge that is already short is left alone, so pressing again settles instead of running away.", "A patch so coarse that Smooth or Fill has nothing to bite on."],
          ["Fix spikes", "One click drops a point that stands out of a smooth surface back level with its neighbours. It only takes points that stand off on their own, so a real panel edge beside it survives. Click, do not drag.", "The little tent a single pulled vertex makes in a flat area."],
          ["Even out", "Slides the points sideways until they are evenly spaced, leaving the shape where it is. Every other brush behaves better afterwards.", "A patch of stretched, bunched triangles."],
          ["Flatten", "Presses everything under the brush onto one plane.", "A panel that should be flat but waves."],
          ["Scrape", "Shaves off only what sticks out above the average and leaves the dents alone. Ctrl does the opposite and raises the pits.", "Bumps and pimples on a flat panel."],
          ["Fill", "Raises only what sits below the average and leaves the good surface where it is. Ctrl turns it back into Scrape.", "The dents in the flat side of a gun."],
          ["Pinch", "Gathers the surface sideways towards the middle of the brush, so a soft edge tightens into a crisp line without sinking. Ctrl spreads it apart. Go gently: it starts at 8%.", "An edge that came out rounded."],
          ["Crease", "Pinch with a small push in, which cuts a line rather than only tightening one. Ctrl raises a ridge instead.", "A panel line that got rounded off."],
          ["Inflate", "Pushes the surface out along its own direction at every point, so a thin part thickens and keeps its shape. Ctrl pulls it in.", "A barrel or a limb too thin to print."],
          ["Build up", "Lays a smooth mound along one direction instead of following every wrinkle. Ctrl carves the same shape inwards.", "Rebuilding a chipped corner."],
          ["Grab", "Drags the surface along with the brush while the rim stays put. The same tool as Move in Polygons mode.", "Pull a dented nose tip back out."],
          ["Protect", "Not a shaping brush: it paints the area the others must leave alone, and Ctrl rubs that out again. Clear and Invert are under the brush settings.", "Paint a crisp panel edge, then smooth the lumps right up against it without rounding it off."],
        ],
      },
    },
    {
      heading: "Sculpt mode: the settings",
      bullets: [
        "Strength is remembered for each brush on its own, because they want different amounts: Smooth likes half, Flatten less. Several soft passes beat one hard one.",
        "Brush size is the same control as in Polygons mode, in millimetres on a 100 mm print, and the [ and ] keys change it.",
        "Symmetry works here too: with an axis on, the brush works on both sides at once, and a BLUE dashed ring marks the second place it is working. Show the other side switches that ring off when it gets in the way; the brush still works on both sides either way.",
        "The area a brush must not touch is painted with the Protect brush, right here in Sculpt mode, and the first stroke switches Selection to Protected for you. An area picked in Polygons mode (Panel, Lasso, Piece) counts as the same thing, so either way of choosing it works.",
        "Selection is what that painted area does to the brushes. Protected means the brush can never move those points, so you can smooth right up against a crisp edge without losing it. Only there means the brush moves them and nothing else. The line under it says what will happen with the selection you have, in numbers.",
        "Facing me and Through work as they do for the selection tools: Through reaches the far side of a thin part as well.",
        "Most brushes move the points that are already there, so on a patch too coarse to shape they have nothing to work with. Add detail splits the edges under the brush to give them some, and Simplify merges them away again where a patch came out too dense. Quads in Whole model is the quicker answer when the density is wrong all over.",
      ],
    },
    {
      heading: "Polygons mode: the tools",
      table: {
        headers: ["Tool", "What it does", "Example"],
        rows: [
          ["Select (B)", "Paint a selection on the surface. Hold Ctrl to take away.", "Paint over the lumpy top of a helmet, then press Smooth."],
          ["Deselect (D)", "Paint over a selection to take it away.", "After All, paint the eyes of a face to keep them out of a Smooth."],
          ["Lasso (L)", "Draw a loop to select everything inside it. Ctrl-drag takes away.", "Loop the handle of a sword, then press Delete to cut it off."],
          ["Panel (P)", "Click a flat panel to select all of it. Shift-click adds another.", "Click the wavy side of a gun, then press Flatten."],
          ["Piece (I)", "Click a part to select the whole separate piece it belongs to.", "Click a floating speck beside a character, then press Delete."],
          ["Move (M)", "Drag to pull the surface under the brush; the edge of the brush stays put.", "Pull a dented nose tip back out."],
          ["Sharpen edge (E)", "Click a panel, then the panel next to it, then press Sharpen edges.", "Click the top of a box, then its front: the rounded corner between them turns crisp."],
          ["Fill hole (O)", "Shows holes as red dots; click next to a hole to close it.", "Click beside the red dots around a hole in a boot sole."],
        ],
      },
    },
    {
      heading: "Symmetry, selection and the options bar",
      bullets: [
        "Symmetry (in the Selection panel) is off, X, Y or Z. With an axis on, every tool works on both sides of the model at once: Select, Deselect, Lasso, Panel, Piece and Move. Example: Symmetry X, then click a dent with Panel and the dent on the other side is picked too, so one Flatten fixes both. A BLUE dashed ring marks where the brush is also working, and Show the other side turns that ring off if it gets in the way.",
        "The middle it mirrors around is the middle of the model as it opened, and it stays there even after you delete half of it.",
        "Symmetry is not the same as Make both sides match. Symmetry only makes the tools work twice; Make both sides match rebuilds the model out of one half.",
        "All, None and Invert work on what is shown. Grow and Shrink add or take away one row of points at the edge.",
        "Hide puts the selected faces out of sight so you can reach what is behind them; Isolate shows only the selection; Show all brings everything back. Example: Isolate a gun's grip to smooth it without touching the rest.",
        "Brush size sets how wide Select, Deselect and Move reach, in millimetres on a 100 mm print. The [ and ] keys change it.",
        "Facing me selects only the surface turned towards you; Through reaches the far side too. Example: Through with Lasso selects both sides of a thin wing at once.",
        "How flat (Panel) sets how much tilt still counts as the same panel: a higher value takes in gentle curves.",
      ],
    },
    {
      heading: "Polygons mode: make a part symmetric",
      body:
        "MAKE SYMMETRIC folds the selection across the symmetry plane. Every selected point is paired with the point "
        + "nearest its mirror INSIDE the selection, and the pair moves to the middle, so the two sides end up matching "
        + "each other. Pick an axis under Symmetry first (X, Y or Z) or the button will say so.\n\n"
        + "It only moves points: not one face is added, removed or re-cut, so it can never break the mesh, and one "
        + "Undo puts it back. A point whose mirror finds nothing is left exactly where it is and counted in the "
        + "History line, because quietly dragging a lone point somewhere is worse than leaving it alone.\n\n"
        + "Strength is how far the two sides move together: 100% makes them match exactly, less closes part of the "
        + "difference. Example: one side of a grip came out fatter than the other, so Lasso the grip, Symmetry X, "
        + "then Make symmetric.\n\n"
        + "This is the one for a PART. To make the WHOLE model match, use Make both sides match in Whole model, which "
        + "copies one side onto the other instead of averaging them.",
    },
    {
      heading: "Polygons mode: fix the selection",
      table: {
        headers: ["Button", "What it does", "Example"],
        rows: [
          ["Flatten", "Moves the selected panel onto its best flat plane. Points facing another way are left alone, and the edge of the selection fades in.", "A Panel pick on a wavy car door, Flatten at 100%."],
          ["Smooth", "Evens out lumps without shrinking the area. Strength sets how soft.", "Brush over bumpy cheeks, Smooth at 40%."],
          ["Straighten", "Flattens the panel and turns it exactly level or upright, when it is within 15 degrees of that.", "A table top that tilts a little: Panel, then Straighten."],
          ["Sharpen edges", "With two panels picked by the Sharpen edge tool: flattens both and closes the rounded edge between them into a crisp one.", "The soft top edge of a gun slide."],
          ["Delete", "Removes the selected faces. The Delete key does the same.", "Piece a floating speck, Delete."],
          ["Fill holes", "Closes the holes whose edges are all in the selection.", "Lasso around a hole in a shoulder, Fill holes."],
        ],
      },
    },
    {
      heading: "Whole model mode",
      body:
        "Model check on the left is the list of what is wrong with this model: faces, pieces, holes, broken edges. A green line is fine, "
        + "an amber one needs a button, and hovering the line says which one. The buttons are on the right.",
      table: {
        headers: ["Button", "What it does", "Example"],
        rows: [
          ["Quick clean up", "Remove inside surfaces, Fill holes at Small and Remove loose bits, in that order, in one press. It counts as one step, so one Undo takes all three back, and it says what is left to do.", "The first thing to press on a fresh Pixal3D or Trellis 2 model."],
          ["Remove inside surfaces", "Removes every face that can never be seen from outside: the second skin AI models carry inside. Often more than half the model.", "First button on any Pixal3D or Trellis 2 model."],
          ["Fill holes", "Closes the holes whose rim is no longer than the size beside it (Small is 16 edges, Medium 60, Any size closes every rim it can walk around), and fills again while it keeps finding them. A big opening is closed with a flat cap, so look at it afterwards.", "After Remove inside surfaces: Small first, then Medium for whatever is left."],
          ["Remove loose bits", "Removes separate pieces smaller than 8 faces.", "The specks floating around a generated character."],
          ["Close cracks", "Joins open edges that almost touch (within the chosen share of the model's size), then closes the small gaps left.", "A model spliced from several views, at 0.25%."],
          ["Quads", "Lays a clean grid of quads over the whole model, following its crisp edges. 200K keeps small details, 50K is light.", "Before sending a model to Blender or a game engine."],
          ["Reduce polygons", "Removes 25, 50 or 75% of the faces while keeping the shape, and hands back TRIANGLES. That is what this kind of reducing is, in every program that has it, and it holds the original shape better than rebuilding the surface would. To make a QUAD model lighter and keep the quads, press Quads at a lower number (10K or 25K) instead.", "A 1.5 million triangle model for a web viewer: -75%."],
          ["Make solid", "Rebuilds the model as one closed solid for 3D printing. More detail keeps more of the shape and takes longer.", "Last step before printing, at 384."],
          ["Make both sides match", "Throws one side away along X, Y or Z and copies the other over it, so the two halves are exactly the same. This one rebuilds the model, unlike the Symmetry switch.", "A character whose left arm came out better: X, and keep the good side."],
        ],
      },
    },
    {
      heading: "Looking around",
      bullets: [
        "Right-drag turns the view, middle-drag moves it, the wheel zooms towards the mouse.",
        "The View buttons jump to Front, Back, Left, Right, Top, Bottom or 3/4; Fit frames the whole model. The X Y Z marker at the bottom right shows which way the axes point.",
        "Before and After at the top compare the model as it came with your edits.",
        "Looks: Clay (the best for judging the shape), Color (its colours or texture), Wire (the real edges), Normal (faces pointing the wrong way show odd colours). X-ray sees through the model; Show holes and broken edges marks open edges red and broken edges yellow.",
        "Hover any button: the line at the bottom left of the view says what it does.",
      ],
    },
    {
      heading: "Saving",
      defs: [
        ["Save", "Keeps the edit on the node and closes the editor. The node shows its picture and hands the edited model on at the next Run. Open the editor again to go on editing."],
        ["Save to Disk", "Writes the model into output/3d straight away, in the format chosen under Save to Disk as: Auto (OBJ, or GLB when the model keeps a texture), OBJ (quads and colours), GLB (texture and colours) or STL (for printing, standing on Z, 100 mm on its longest side). Turn Y and Center on ground place the written copy only."],
        ["Close", "Leaves the editor without keeping this session's edits."],
      ],
    },
    {
      heading: "Shortcuts",
      table: {
        headers: ["Key", "Does"],
        rows: [
          ["B D L P I M E O", "In Polygons mode: Select, Deselect, Lasso, Panel, Piece, Move, Sharpen edge, Fill hole. Pressing one from another mode takes you there."],
          ["S D V L W T C A N R I B G P", "In Sculpt mode: Smooth, Despike (fix spikes), Even out, Less detail (simplify), more detail (W), flaTten, sCrape, fill (A), piNch, cRease, Inflate, Build up, Grab, Protect. Each mode has its own letters, so the same key means the brush here and the tool there."],
          ["1 / Ctrl+1", "Front / Back"],
          ["3 / Ctrl+3", "Right / Left"],
          ["7 / Ctrl+7", "Top / Bottom"],
          ["0, F", "3/4 view, Fit"],
          ["Ctrl+A, Esc", "Select all, select none"],
          ["H, Alt+H", "Hide the selection, show all"],
          ["X", "X-ray on or off"],
          ["[ and ]", "Brush smaller and bigger"],
          ["Delete", "Delete the selected faces"],
          ["Ctrl+Z, Ctrl+Shift+Z", "Undo, redo"],
          ["? or F1", "This help"],
        ],
      },
    },
    {
      heading: "Good to know",
      bullets: [
        "Your hand tools, Remove inside surfaces and the fills keep a model's texture. Quads, Reduce polygons, Make solid and Make both sides match build new faces, so the texture becomes colours on them.",
        "The editor keeps the colour texture of a model. A PBR model's other maps (normal, roughness, metal) are not kept, so an edited PBR model looks a little flatter in a renderer that uses them.",
        "Quads, Reduce polygons, Make solid and Make both sides match run through ComfyUI's queue: while a generation is running they wait for it, and the page pauses for a few seconds while Quads works.",
        "When the model wired in changes (a new generation, say), the node passes it on unedited and says so: open the editor and edit the new model.",
        "A cleaned model usually shows MORE open edges than it started with, and that is normal: an AI model is two skins, one inside the other, and removing the inner one opens the seam where they met. Those openings are real holes in what is left, so Fill holes closes the ones it can walk around and Make solid closes the rest.",
        "Some open edges belong to no rim at all, where faces meet in threes. Nothing that walks a hole can close those; Make solid rebuilds the model and is the answer for printing.",
        "Close cracks can leave a few broken edges, where three faces now share one edge. For 3D printing, finish with Make solid, which always gives one closed solid.",
        "FBX and PLY files open in the editor, and need one Save before the node can hand them on.",
        "Saved edits live in input/pixaroma_edit3d. Models above about 1.5 million triangles work, but slowly: Reduce polygons first.",
      ],
    },
  ],
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function sectionHtml(sec) {
  let h = `<h4>${esc(sec.heading)}</h4>`;
  if (sec.body) h += `<p>${esc(sec.body)}</p>`;
  if (sec.bullets) h += `<ul>${sec.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`;
  if (sec.defs) h += `<table>${sec.defs.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join("")}</table>`;
  if (sec.table) {
    h += `<table>${sec.table.rows.map((r) => `<tr>${r.map((c, i) => `<td${i === 2 ? ' class="ex"' : ""}>${esc(c)}</td>`).join("")}</tr>`).join("")}</table>`;
  }
  return h;
}

/** The editor's Help window: the same sections, minus the node's own. */
export const EDITOR_HELP_HTML = EDIT3D_HELP.sections.filter((s) => s.heading !== "The node").map(sectionHtml).join("");
