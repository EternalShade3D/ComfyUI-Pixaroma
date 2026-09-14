// Mesh Repair Pixaroma - the help shown by the orange ? in the selection toolbar
// and in the full Help browser. Written for someone making models, not for
// someone reading the code.

export const MESH_REPAIR_HELP = {
  title: "Mesh Repair Pixaroma",
  tagline: "Turn a hollow, broken 3D model into one clean solid you can 3D print.",
  sections: [
    {
      heading: "What it is for",
      body:
        "Models made with Pixal3D and Trellis 2 look fine on screen but fail in a 3D printer's "
        + "slicer. The step that rebuilds their mesh wraps the model in two skins, one outside and "
        + "one inside, with nothing in between. A slicer sees a hollow shell a fraction of a "
        + "millimetre thick. On top of that there are broken edges where the two skins touch, "
        + "loose bits floating around, and a few small holes.\n\n"
        + "Mesh Repair rebuilds the model as one closed solid. It seals the small gaps, fills the "
        + "inside, builds a new closed surface and snaps it back onto the original shape, so the "
        + "details and the colours stay.",
    },
    {
      heading: "Where to put it",
      defs: [
        ["In the Pixal3D and Trellis 2 workflows", "Right after the step that rebuilds the mesh "
          + "(Remesh Mesh) and before the one that reduces the triangles (Decimate Mesh). The unwrap "
          + "and bake nodes after it then paint the repaired model, so the textures still come out."],
        ["For any model file", "Wire the model_3d output of Load 3D Pixaroma into it. GLB, GLTF, OBJ "
          + "and STL files can be read."],
      ],
    },
    {
      heading: "Saving the repaired model",
      defs: [
        ["To 3D print it", "Wire the `stl` output into Save 3D Model. It writes a .stl file into "
          + "ComfyUI's output/3d folder that a slicer opens directly. The model stands upright the "
          + "way slicers expect, and its longest side is 100 mm (change it in the gear)."],
        ["If the stl preview looks empty", "Press Fit to Viewer, the middle of the three small buttons "
          + "under Save 3D Model's preview. At 100 mm the model is far bigger than that preview expects, "
          + "so it can start out of view. It then lies on its back there, because ComfyUI's viewer and "
          + "slicers treat a different direction as up. In the slicer it stands upright."],
        ["To keep the colours", "Wire the `mesh` output into Save 3D Model instead. That writes a "
          + ".glb with the colours, which Load 3D Pixaroma can open again. Wire both if you want both "
          + "files."],
      ],
    },
    {
      heading: "The two modes",
      defs: [
        ["Make solid", "Rebuilds the model as one closed solid. The one to use for 3D printing: it "
          + "fills the hollow inside, closes every hole and removes the broken edges and loose bits. "
          + "The result has new triangles, so UV textures do not carry over, but the colours do."],
        ["Tidy only", "Keeps the original triangles and textures and only cleans them: removes loose "
          + "bits, turns wrong-way faces around and closes small holes. It cannot fill a hollow "
          + "model, and the node says so when the result is still hollow."],
      ],
    },
    {
      heading: "The settings on the node",
      defs: [
        ["Detail", "How fine the rebuild is. On a model printed 100 mm long, Low keeps details down "
          + "to about 0.4 mm, Medium (the default) about 0.26 mm, High about 0.2 mm and Max about "
          + "0.13 mm. Each step up takes longer and needs more memory."],
        ["Seal gaps", "How wide a gap or slit is closed before the inside is filled. The skin of "
          + "these models is full of pinholes, and until they are sealed the inside cannot be "
          + "filled. Auto finds the smallest seal that works and shows what it found after a run."],
        ["Remove loose bits under", "Separate pieces smaller than this share of the biggest piece "
          + "are removed. Off keeps every piece."],
        ["Keep surface detail", "Snaps the new surface back onto the original shape. Turn it off "
          + "only when you want a softer, smoother result."],
        ["Keep colours", "Copies the model's colours, or its base colour texture, onto the result."],
      ],
    },
    {
      heading: "Reading the result",
      defs: [
        ["The cut", "A slice through the middle of the model, before and after. Coloured means "
          + "solid. A hollow model shows only a thin outline, which is exactly how a slicer sees it."],
        ["The report", "Real holes, broken edges, loose bits, how much of the cut is solid, whether "
          + "the model is closed all round, and the triangle count, before and after. The `report` "
          + "output carries the same list as text."],
        ["Ready to print", "The status line turns green when the result is closed all round with "
          + "no broken edges."],
      ],
    },
    {
      heading: "In the gear",
      defs: [
        ["Triangles in the result", "Make solid usually builds two to four times the triangles that "
          + "came in. Same as the input brings the count back down with ComfyUI's own Decimate "
          + "Mesh, and keeps the full result if reducing would open the model again. Keep them all "
          + "skips that step."],
        ["Size of the stl file", "The longest side of the model in the stl output, 100 mm by "
          + "default. Model units keeps the model's own size, which for an AI model is usually about "
          + "1 mm. The Detail hint on the node uses this size too."],
        ["Colour", "The accent colour of this node's buttons."],
      ],
    },
    {
      heading: "Good to know",
      bullets: [
        "The rebuild runs on the processor, so it does not need graphics memory.",
        "On a fast desktop processor the Ep34 radio (700,000 triangles) took about 23 seconds at "
          + "Medium, including bringing the triangles back down.",
        "An STL file has no colours. Save the mesh output as well if you want them.",
        "Parts thinner than the detail size can disappear, and slots narrower than the seal close up.",
        "Reading a model file needs a recent ComfyUI that has the Get 3D Components node.",
      ],
    },
  ],
};
