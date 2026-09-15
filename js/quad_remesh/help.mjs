// Quad Remesh Pixaroma - the help page.
// Written for someone making pictures and 3D models, not for someone reading the code. Every "good to know"
// line was measured on the Ep34 gun (output/claude_output/quad_remesh_proto/README.txt).

export const QUAD_REMESH_HELP = {
  title: "Quad Remesh Pixaroma",
  tagline: "Lay clean quads over a 3D model: crisp edges, holes closed, and a true mirror when the model is symmetric.",
  keywords: "quad remesh remesher quad remesher retopology retopo quads quad mesh instant meshes zremesher "
    + "clean topology edge loops symmetry mirror symmetric crisp edges sharp edges hard surface holes "
    + "low poly game asset blender ai 3d model pixal3d trellis hunyuan3d obj mesh model_3d wire",
  sections: [
    {
      heading: "What it does",
      body:
        "3D models made by AI come as a dense tangle of triangles. This node lays a clean grid of quads over "
        + "the model instead, the way a 3D artist would: the quads line up along the model's crisp edges, the "
        + "small holes the grid would leave are closed, and when the two sides of the model match, the quads "
        + "are mirrored so both sides match exactly.\n\n"
        + "The quads follow the model's surface closely, so the shape stays the same. Its colours, or its "
        + "texture, are carried over as colours on the new points.",
    },
    {
      heading: "The controls",
      defs: [
        ["Quads", "How many quads to lay: 5K, 10K, 25K, 50K, 100K or 200K. 100K, the default, keeps the slots, "
          + "buttons and panel lines of a hard-surface model crisp. A character, or any model with small round "
          + "details such as fingers or rings, needs 200K, which takes about twice as long. Fewer quads make a "
          + "lighter model that rounds off small details, and run faster."],
        ["Symmetry", "Auto mirrors the model when both sides match closely and leaves it whole when they do not. "
          + "X, Y and Z mirror across that axis anyway (the axes of the marker on the view). Off never mirrors."],
        ["Follow crisp edges", "Keeps edge loops on the model's sharp edges, so slots, buttons and panel lines stay "
          + "crisp. Off lays an even grid that rounds them."],
        ["Before and Quads", "Switches the view between the model as it came in and the new quads. Only the view "
          + "changes: nothing runs again."],
        ["Settings changed", "Appears beside Follow crisp edges when Quads, Symmetry or a result switch in the gear "
          + "differs from the run you are looking at. Run the workflow to see the new result."],
        ["The gear", "Keep colours and Keep groups (both change the result), then switches for the floor grid, the "
          + "FRONT arrow, the X Y Z marker and the shadow, the light, the background and the button colour."],
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
        ["Wire", "The quads' real edges, the best look for judging the grid."],
        ["Clay", "Plain grey, the best look for judging the shape and the crisp edges."],
        ["Panels", "One colour for each group: the panels Hard Surface Pixaroma found, carried onto the quads, "
          + "or the model's own groups."],
        ["Color", "The colours carried over from the model."],
        ["Normal", "The directions of the surface as colours."],
      ],
    },
    {
      heading: "What comes out",
      defs: [
        ["mesh", "The quads as a mesh, each quad split into two triangles, with the colours. Wire it into any "
          + "mesh node."],
        ["model_3d", "The quads as an OBJ file that keeps the real quads, the groups and the colours. Wire it into "
          + "Save 3D Pixaroma, or save it and open it in Blender."],
        ["report", "What came out, as text: how many quads, how clean the grid is, how far it sits from the model, "
          + "the mirror, the holes closed and the open edges."],
      ],
    },
    {
      heading: "A good chain",
      bullets: [
        "A 3D generator, then Mesh Repair Pixaroma if the model is hollow or torn, then Quad Remesh Pixaroma, then "
          + "Save 3D Pixaroma.",
        "For a new texture, wire the mesh output into ComfyUI's own Unwrap Mesh and bake nodes.",
      ],
    },
    {
      heading: "Good to know",
      bullets: [
        "ComfyUI's page pauses while the quads are laid: on our test PC about 7 seconds at 100K and about 3 at 25K. "
          + "The run carries on.",
        "Each run lays the quads a little differently, even with the same settings. The shape stays the same.",
        "Holes the model itself has stay open; the small holes the quads would leave are closed.",
        "Auto only mirrors a model whose two sides match closely. A detail on one side only, such as a logo or a "
          + "button, keeps it from mirroring. Pick X, Y or Z to mirror anyway.",
        "Quad Remesh finds the crisp edges on its own. In our tests, running Hard Surface Pixaroma first did not "
          + "make the quads any cleaner.",
      ],
    },
  ],
  footer: "Works in the classic node design and in Nodes 2.0.",
};
