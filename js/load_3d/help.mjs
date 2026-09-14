// Load 3D Pixaroma - the help page.
// Written for someone making pictures and 3D models, not for someone reading the code.

export const LOAD_3D_HELP = {
  title: "Load 3D Pixaroma",
  tagline: "Load a 3D model, turn it to the view you need, and take the model and a picture of it.",
  keywords: "3d 3d model load 3d open 3d import 3d model loader mesh glb gltf obj fbx stl ply point cloud "
    + "trellis trellis 2 pixal3d hunyuan3d tripo meshy rodin render a 3d model picture of a model "
    + "screenshot of a model turntable turn rotate orbit front back left right top three quarter 3/4 "
    + "view angle camera orthographic perspective field of view clay no texture no colours grey model "
    + "shape only normal map depth map controlnet wireframe wire quads triangles polygon count mask "
    + "silhouette cut out background colour model_3d file 3d save 3d preview 3d get 3d components "
    + "multi view reference image image to image 3d to image upload model drag and drop model "
    + "width height size resolution picture size sizes pixaroma empty latent latent size match size "
    + "same size aspect ratio portrait landscape",
  sections: [
    {
      heading: "What it does",
      body:
        "Loads a 3D model and shows it live on the node. It gives you three things at once: the "
        + "model file for 3D workflows, a picture of the model for image workflows, and a mask of "
        + "its shape. The picture's width and height come out as numbers too.\n\n"
        + "The bright frame on the view is exactly the picture that comes out, at the width and "
        + "height you type. The dimmed edge around it is not part of the picture, and neither is "
        + "the grid.",
    },
    {
      heading: "Getting a model in",
      bullets: [
        "Click the model name to choose from the list. It shows ComfyUI's input/3d folder and its "
          + "output/3d folder, so a model a 3D workflow just saved is already there.",
        "Use the arrows beside the name to step through the list.",
        "Click Upload to copy models from your computer into input/3d. For an OBJ, pick the .obj, "
          + "its .mtl and its textures together.",
        "Or drag model files straight onto the node.",
      ],
    },
    {
      heading: "Turning the model",
      defs: [
        ["Drag", "Turns the model."],
        ["Right-drag or Shift-drag", "Moves the model inside the frame."],
        ["Scroll", "Zooms in and out. With Nodes 2.0 on, click the view once first, the same as ComfyUI's own Load 3D. Over the rest of the node the wheel zooms the canvas as usual."],
        ["Double-click", "Frames the whole model again."],
        ["Front, Back, Left, Right, Top", "Jump straight to that side. Left is the model's own left "
          + "side, so it looks towards the left edge of the picture, which is what multi-view 3D "
          + "models expect. The sides follow the way the file was saved, so if Front shows the "
          + "wrong side, give the model a quarter turn in the gear settings."],
        ["3/4", "A front corner, seen a little from above."],
        ["Fit", "Frames the whole model again and keeps the angle."],
      ],
    },
    {
      heading: "The looks",
      defs: [
        ["Color", "The model's own colours and textures."],
        ["Clay", "Plain grey with no colours or textures, so you see only the shape."],
        ["Normal", "The directions of the surface as colours, for a normal ControlNet."],
        ["Depth", "Near parts white and far parts black, for a depth ControlNet."],
        ["Wire", "Shows the edges of the mesh."],
      ],
    },
    {
      heading: "The buttons on the node",
      defs: [
        ["Upload", "Copies model files from your computer into input/3d."],
        ["The gear", "Opens the settings: background colour, light (Studio, Soft or Flat), camera "
          + "(perspective or orthographic, and the field of view), which way is up, a quarter "
          + "turn for a model that faces the wrong way, the grid, and the button colour."],
        ["Width and Height", "The size of the picture in pixels, from 64 to 4096. The arrows step "
          + "by 8, and the button between them swaps the two. When a width or height is wired in, "
          + "its field locks and shows the number that arrives."],
        ["The line at the bottom", "The file type, its size, how many triangles it has, and "
          + "whether it carries textures or vertex colours. It turns red to warn you when a wired "
          + "size cannot be used."],
      ],
    },
    {
      heading: "Matching the size",
      bullets: [
        "Wire width and height out into your empty latent, and the image you make comes out the "
          + "same size as the picture.",
        "Or let Sizes Pixaroma decide: wire its width and height into this node's width and height "
          + "inputs, and into your latent as well. The frame on the node follows whatever you pick "
          + "in Sizes, and the picture is drawn at that size.",
        "Only Sizes Pixaroma can be read this way, because the picture is drawn the moment you "
          + "press Run, before anything else runs. A size that is worked out while the workflow "
          + "runs, such as maths on numbers or the size of a photo, cannot shape the picture. The "
          + "node warns you on its bottom line, and if the numbers do not match, the run stops "
          + "with a message rather than making a picture of the wrong size.",
        "A muted or bypassed Sizes node sends nothing, so the node goes back to its own Width and "
          + "Height.",
      ],
    },
    {
      heading: "What comes out",
      defs: [
        ["model_3d", "The model file itself. Wire it into Save 3D, Preview 3D (Advanced), or Get "
          + "3D Components to edit the mesh."],
        ["image", "The picture in the frame, in the look you picked."],
        ["mask", "White where the model is, black everywhere else."],
        ["width", "The width of the picture in pixels."],
        ["height", "The height of the picture in pixels."],
      ],
    },
    {
      heading: "Good to know",
      bullets: [
        "Opens GLB, GLTF, OBJ, FBX, STL and PLY. GLB is the best choice, because its textures "
          + "travel inside the file.",
        "GLB and GLTF files only ever hold triangles. For OBJ and FBX files the line at the bottom "
          + "also counts the quads.",
        "The picture is drawn in your browser at the moment you press Run, so run the workflow "
          + "from the ComfyUI page. A run started from a script has no picture to send, unless "
          + "only model_3d is wired.",
        "Not supported yet: gaussian splat files, and GLB files compressed with Draco.",
      ],
    },
  ],
  footer: "Works in the classic node design and in Nodes 2.0.",
};
