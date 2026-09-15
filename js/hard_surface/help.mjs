// Hard Surface Pixaroma - the help page.
// Written for someone making pictures and 3D models, not for someone reading the code.

export const HARD_SURFACE_HELP = {
  title: "Hard Surface Pixaroma",
  tagline: "Make an AI 3D model hard-surface again: flat panels flat, rounded bevels crisp, round parts left round.",
  keywords: "hard surface hardsurface sharpen sharp edges crisp edges bevel bevels chamfer flatten flat panels planar "
    + "lumpy wobbly soft edges rounded edges melted ai 3d model cleanup clean up tidy pixal3d trellis hunyuan3d "
    + "hard ops mechanical weapon gun robot vehicle prop quad remesh quad remesher retopology retopo panels "
    + "materials groups keep round keep colours before after compare model_3d mesh obj",
  sections: [
    {
      heading: "What it does",
      body:
        "3D models made by AI come out soft: flat panels have small lumps, and the sharp edges between them "
        + "are rounded into little bevels. This node moves the model's vertices, by a fraction of a millimetre, "
        + "so the flat panels come out flat and the bevels between them close into crisp edges. Round parts "
        + "such as grips, barrels and knobs are found and left alone.\n\n"
        + "It only moves vertices. The model keeps its polygons, its colours and its textures, and nothing is "
        + "added or removed. Use it before Save 3D Pixaroma for a crisper model to render or print, or before "
        + "Quad Remesh Pixaroma for a crisp model with clean quads.",
    },
    {
      heading: "The controls",
      defs: [
        ["Sharpen", "How far a vertex may move. Light closes only the smallest bevels, Medium closes bevels up to "
          + "about half a millimetre (measured as if the model were printed 100 mm long), and Strong closes wider "
          + "ones and flattens more."],
        ["Before and After", "Switches the view between the model as it came in and the sharpened result. Only "
          + "the view changes: nothing runs again."],
        ["Keep round", "Leaves curved parts round. Off flattens everything it can, which turns a grip or a barrel "
          + "into flat facets."],
        ["Settings changed", "Appears beside Keep round when Sharpen, Keep round or a result switch in the gear "
          + "differs from the run you are looking at. Run the workflow to see the new result."],
        ["The gear", "Panels as materials and Keep colours (both change the result), then switches for the floor "
          + "grid, the FRONT arrow, the X Y Z marker and the shadow, the light, the background and the button "
          + "colour."],
      ],
    },
    {
      heading: "Looking around",
      defs: [
        ["Drag", "Turns the view around the middle of the model."],
        ["Right-drag or Shift-drag", "Moves the view."],
        ["Scroll", "Zooms. With Nodes 2.0 on, click the view once first."],
        ["Double-click or Fit", "Frames the whole model again."],
        ["Front, Back, Left, Right, Top, 3/4", "Jumps straight to that side."],
      ],
    },
    {
      heading: "The looks",
      defs: [
        ["Clay", "Plain grey, the best look for judging edges and flat panels."],
        ["Color", "The model's own colours and textures."],
        ["Wire", "The real edges of the model."],
        ["Panels", "After: one colour for each flat panel the node found. Before: the model's own groups."],
        ["Normal", "The directions of the surface as colours."],
      ],
    },
    {
      heading: "What comes out",
      defs: [
        ["mesh", "The sharpened model as a mesh, with its colours, uvs and textures. Wire it into any mesh node."],
        ["model_3d", "The sharpened model as an OBJ file, with one group for each flat panel. Wire it into Save 3D "
          + "Pixaroma, or into Quad Remesh Pixaroma, which carries the panels onto its quads."],
        ["report", "What the run did, as text: the flat panels found, the round parts kept, how much crisper the "
          + "edges got, how far vertices moved and how many folded faces were repaired."],
      ],
    },
    {
      heading: "A good chain",
      bullets: [
        "For a crisp model to render or print: a 3D generator, then Mesh Repair Pixaroma if the model is hollow or "
          + "broken, then Hard Surface Pixaroma, then Save 3D Pixaroma.",
        "For a crisp model with clean quads: this node on Medium, then Quad Remesh Pixaroma on 200K. The quads keep "
          + "the flat panels and crisp edges, and carry the panels over as groups. Put this node first, never after "
          + "Quad Remesh: sharpening finished quads squeezes some of them flat.",
        "Before and After is the quickest way to judge a setting: switch between them with the Clay look.",
      ],
    },
    {
      heading: "Good to know",
      bullets: [
        "Reads GLB, GLTF, OBJ and STL, or a mesh wire. When both are wired in, the mesh is used.",
        "Where a bevel closes onto its edge, some faces are squeezed to nothing. That is how an edge becomes sharp "
          + "without adding polygons; the report counts them.",
        "Models that are mostly organic, such as characters and animals, have few flat panels, so this node "
          + "changes little on them.",
        "The line under the view shows the flat panels found, the round parts kept, how much crisper the edges "
          + "got and the largest move. Hover it for the whole report.",
      ],
    },
  ],
  footer: "Works in the classic node design and in Nodes 2.0.",
};
