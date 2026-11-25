// The desk's RENDER KIT (design-016 §5, K4a): what every kind's pass is written against besides the engine — the slot's
// view and its mat (`MatPass`), the lamp and its light, a container's inside, the host's rasters and stores a kind is
// lent, a live face's texture and the source a host lends for it (M24), the desk's PEN (petition I59: the faces, the glyph
// run, the run store, the atlas on the GPU, the pen's clock — `hand_ink` is the `hand` WGSL piece) and the MARKS it draws
// (petition I60: the ink value, its strokes as a hand makes them, the selection's wash — `ink_marks` is the `marks` piece), and
// the shared pieces two kinds would otherwise copy from each other. A kind imports the desk through this, the engine
// (`@ice/desk/engine`) and the contract (`KindProgram`, `ObjectKind`, `defineObject` — `@ice/desk`) alone.
export * from "./arrays";
export * from "./blobs";
export * from "./book";
export * from "./editor";
export * from "./eye";
export * from "./hand-atlas";
export * from "./hand-faces";
export * from "./hand-gpu";
export * from "./hand-run";
export * from "./hold";
export * from "./ink";
export * from "./ink-marks";
export * from "./ink-strokes";
export * from "./inside";
export * from "./layer";
export * from "./light";
export * from "./live";
export * from "./mesh";
export * from "./mips";
export * from "./nav";
export * from "./paper-tex";
export * from "./pen-clock";
export * from "./physics";
export * from "./place";
export * from "./print";
export * from "./raster";
export * from "./sdf";
export * from "./seeds";
export * from "./services";
export * from "./springs";
export * from "./strokes";
export * from "./text";
export * from "./uniform";
export * from "./view";
export * from "./wgsl";
