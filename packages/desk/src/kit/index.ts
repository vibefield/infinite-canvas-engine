// The desk's RENDER KIT (design-016 §5, K4a): what every kind's pass is written against besides the engine — the slot's
// view and its mat (`MatPass`), the lamp and its light, a container's inside, the host's rasters and stores a kind is
// lent, and the shared pieces two kinds would otherwise copy from each other. A kind imports the desk through this, the
// engine (`@ice/desk/engine`) and the contract (`KindProgram`, `ObjectKind`, `defineObject` — `@ice/desk`) alone.
export * from "./arrays";
export * from "./blobs";
export * from "./book";
export * from "./editor";
export * from "./eye";
export * from "./hold";
export * from "./inside";
export * from "./layer";
export * from "./light";
export * from "./mesh";
export * from "./mips";
export * from "./nav";
export * from "./paper-tex";
export * from "./physics";
export * from "./place";
export * from "./print";
export * from "./raster";
export * from "./sdf";
export * from "./seeds";
export * from "./springs";
export * from "./strokes";
export * from "./text";
export * from "./uniform";
export * from "./view";
export * from "./wgsl";
