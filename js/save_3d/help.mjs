// Save 3D Pixaroma - the help page.
// Written for someone making pictures and 3D models, not for someone reading the code.

export const SAVE_3D_HELP = {
  title: "Save 3D Pixaroma",
  tagline: "See a 3D model, check which way it faces, stand it on the ground, and save it as OBJ, GLB or STL.",
  keywords: "save 3d export 3d save model export model save mesh export mesh obj glb gltf stl 3d print printing "
    + "slicer quads quad mesh keep quads panels groups materials vertex colours texture turn model rotate model "
    + "upright stand up lying down lying on its back wrong way round front back which way is front orientation "
    + "floor ground floating sunk centered center origin pivot preview 3d 3d viewer wireframe wire clay normal "
    + "model_3d mesh pixal3d trellis hunyuan3d quad remesher blender zbrush meshlab media assets output folder "
    + "save folder browse file name date y up z up millimetres mm",
  sections: [
    {
      heading: "What it does",
      body:
        "Shows the model that reaches it in a 3D view on the node, and saves it as a file. Wire in a mesh "
        + "from a 3D generator or a mesh node, or a model_3d from Load 3D Pixaroma or another 3D node.\n\n"
        + "Preview writes a temporary file to look at. Save writes the file into the save folder on every "
        + "run: ComfyUI's output folder, unless the gear names another. Either way the model_3d output is "
        + "exactly the file that was written, so the next node gets what you see.",
    },
    {
      heading: "Which way is front",
      bullets: [
        "The FRONT arrow on the floor points to the front the FILE says. That is where the model faces in "
          + "Blender, in a game engine and in Load 3D Pixaroma's Front view.",
        "The floor grid is the ground. A gap between the model and its shadow means it floats; a model cut "
          + "by the floor sinks into it.",
        "The X Y Z marker in the corner turns with the view. Y is up and Z points to the front.",
        "No program can tell which side of a gun or a chair is its real front. That is for your eye: if the "
          + "arrow points at the wrong side, turn the model until it points at the side you want.",
      ],
    },
    {
      heading: "Fixing the model",
      defs: [
        ["Turn X", "Tips the model forward, a quarter turn at a time. Use it for a model lying on its back "
          + "or standing on its nose."],
        ["Turn Y", "Spins the model a quarter turn, to choose which side faces the FRONT arrow."],
        ["Turn Z", "Tips the model onto its side, a quarter turn at a time."],
        ["Center", "Puts the middle of the model over the middle of the floor. On by default."],
        ["On ground", "Stands the lowest point of the model on the floor. On by default."],
        ["Reset", "Undoes the turns and switches Center and On ground back on."],
        ["The line under the row", "Where the model will sit in the saved file: green when it stands on "
          + "the ground and is centered, amber when it floats, sinks or sits off center."],
      ],
    },
    {
      heading: "Looking around",
      defs: [
        ["Drag", "Turns the view around the middle of the model. Turning the view never changes the file."],
        ["Right-drag or Shift-drag", "Moves the view."],
        ["Scroll", "Zooms. With Nodes 2.0 on, click the view once first."],
        ["Double-click or Fit", "Frames the whole model again."],
        ["Front, Back, Left, Right, Top, 3/4", "Jumps straight to that side."],
      ],
    },
    {
      heading: "The looks",
      defs: [
        ["Color", "The model's own colours and textures."],
        ["Clay", "Plain grey, only the shape."],
        ["Wire", "The real edges of the model. An OBJ made of quads shows its quads, not triangles."],
        ["Panels", "One colour for each group in an OBJ, so the parts a modelling tool marked stand out."],
        ["Normal", "The directions of the surface as colours, handy for spotting faces that point the wrong way."],
      ],
    },
    {
      heading: "Saving",
      defs: [
        ["Preview and Save", "Preview writes a temporary file only. Save writes into the save folder on every "
          + "run; inside ComfyUI's output folder the file also shows up in the Media Assets panel."],
        ["Save now", "Copies the file from the last Preview run into the save folder, without running "
          + "anything again. If you changed the Fix or the format since that run, run again first. A new "
          + "Name or save folder needs no new run."],
        ["Save folder", "ComfyUI's output folder, unless the gear names another. For a folder of your own, "
          + "click Browse in the gear and pick it once: that approves it, and you can type or paste it from "
          + "then on."],
        ["Format", "Auto keeps quads as OBJ and writes a model made of triangles as GLB. OBJ keeps quads, "
          + "panel groups and vertex colours. GLB keeps colours and textures but holds triangles only. STL "
          + "is for 3D printers: it stands on Z, its longest side is 100 mm unless the gear says otherwise, "
          + "and it keeps no colours."],
        ["Name", "The folder and file name inside the save folder, for example 3d/gun. A counter is added, "
          + "so nothing is ever written over, and date tokens such as %date:yyyy-MM-dd% work as they do in "
          + "Save Image Pixaroma. In the output folder, the default 3d folder is one Load 3D Pixaroma lists, "
          + "so a saved model can be loaded again."],
        ["The gear", "Switches for the floor grid, the FRONT arrow, the X Y Z marker and the shadow, the light, "
          + "the background, the save folder, which way is up in the saved file, the STL size, and the button "
          + "colour."],
      ],
    },
    {
      heading: "What comes out",
      defs: [
        ["model_3d", "The saved file, in the format it was written in. Wire it into another 3D node."],
      ],
    },
    {
      heading: "Good to know",
      bullets: [
        "Reads GLB, GLTF, OBJ and STL. An STL is read standing on Z, the way slicers save it, so it comes in "
          + "upright.",
        "When a mesh and a model_3d are both wired in, the mesh is used.",
        "The line at the bottom shows whether the model has colours, how many separate pieces it has, and its "
          + "open and broken edges. Hover it for notes about what the chosen format could not keep.",
      ],
    },
  ],
  footer: "Works in the classic node design and in Nodes 2.0.",
};
