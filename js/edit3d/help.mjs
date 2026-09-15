// Edit 3D Pixaroma - the help: EDIT3D_HELP for the Help browser and the node's ? button, EDITOR_HELP_HTML for the
// Help window inside the editor. The same words in both; every tool and button carries an example. No em dashes.

export const EDIT3D_HELP = {
  title: "Edit 3D Pixaroma",
  tagline: "Clean up a 3D model by hand and with one-click buttons, then hand the edited model on or save it to disk.",
  sections: [
    {
      heading: "What it does",
      body:
        "3D models made by AI (Pixal3D, Trellis 2, Hunyuan 3D) come out with a hidden second skin inside, small holes, loose specks, " +
        "wavy flat panels and soft edges. Edit 3D opens the model in a fullscreen editor where buttons do the big jobs in one click " +
        "(Remove inside surfaces, Fill small holes, Quads, Make solid...) and your own tools fix exactly the parts you pick " +
        "(Flatten a wavy panel, Sharpen an edge, Delete a loose piece). Nothing changes that you did not ask for, and every step can be undone.",
    },
    {
      heading: "Quick start",
      bullets: [
        "Pick a model on the node, press Upload to add one, or wire a mesh (from Pixal3D or Trellis 2) or a model_3d (from Load 3D Pixaroma) into it. A wired model needs one Run first.",
        "Press Open Edit 3D.",
        "On the right, press Remove inside surfaces, then Fill small holes, then Remove loose bits.",
        "Fix what still looks wrong: pick an area with a tool on the left, then press a button under Fix the selection.",
        "Press Save. The editor closes, the node shows a picture of your edit, and the next Run hands the edited model on. Save to Disk writes a file into output/3d instead.",
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
      heading: "The tools (left)",
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
      heading: "Selection and the options bar",
      bullets: [
        "All, None and Invert work on what is shown. Grow and Shrink add or take away one row of points at the edge.",
        "Hide puts the selected faces out of sight so you can reach what is behind them; Isolate shows only the selection; Show all brings everything back. Example: Isolate a gun's grip to smooth it without touching the rest.",
        "Brush size sets how wide Select, Deselect and Move reach, in millimetres on a 100 mm print. The [ and ] keys change it.",
        "Facing me selects only the surface turned towards you; Through reaches the far side too. Example: Through with Lasso selects both sides of a thin wing at once.",
        "Mirror: X, Y or Z makes the brushes and Move work on both sides of a symmetric model at once.",
        "How flat (Panel) sets how much tilt still counts as the same panel: a higher value takes in gentle curves.",
      ],
    },
    {
      heading: "Fix the selection (right)",
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
      heading: "Whole model (right)",
      table: {
        headers: ["Button", "What it does", "Example"],
        rows: [
          ["Remove inside surfaces", "Removes every face that can never be seen from outside: the second skin AI models carry inside. Often more than half the model.", "First button on any Pixal3D or Trellis 2 model."],
          ["Fill small holes", "Closes every hole of up to 16 edges and leaves big openings alone. Close a big one with the Fill hole tool.", "After Remove inside surfaces, to seal the pinholes."],
          ["Remove loose bits", "Removes separate pieces smaller than 8 faces.", "The specks floating around a generated character."],
          ["Close cracks", "Joins open edges that almost touch (within the chosen share of the model's size), then closes the small gaps left.", "A model spliced from several views, at 0.25%."],
          ["Quads", "Lays a clean grid of quads over the whole model, following its crisp edges. 200K keeps small details, 50K is light.", "Before sending a model to Blender or a game engine."],
          ["Reduce polygons", "Removes 25, 50 or 75% of the triangles while keeping the shape.", "A 1.5 million triangle model for a web viewer: -75%."],
          ["Make solid", "Rebuilds the model as one closed solid for 3D printing. More detail keeps more of the shape and takes longer.", "Last step before printing, at 384."],
          ["Mirror", "Keeps one side (+ or -) along X, Y or Z and copies it onto the other, so both match exactly.", "A character whose left arm came out better: Mirror X, keep the good side."],
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
          ["B D L P I M E O", "Select, Deselect, Lasso, Panel, Piece, Move, Sharpen edge, Fill hole"],
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
        "Your hand tools, Remove inside surfaces and the fills keep a model's texture. Quads, Reduce polygons, Make solid and Mirror build new faces, so the texture becomes colours on them.",
        "The editor keeps the colour texture of a model. A PBR model's other maps (normal, roughness, metal) are not kept, so an edited PBR model looks a little flatter in a renderer that uses them.",
        "Quads, Reduce polygons, Make solid and Mirror run through ComfyUI's queue: while a generation is running they wait for it, and the page pauses for a few seconds while Quads works.",
        "When the model wired in changes (a new generation, say), the node passes it on unedited and says so: open the editor and edit the new model.",
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
