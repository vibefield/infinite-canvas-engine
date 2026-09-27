// The desk's RENDER KIT (design-016 §5, K4a): what every kind's pass is written against besides the engine — the slot's
// view and its mat (`MatPass`), the lamp and its light, a container's inside, the host's rasters and stores a kind is
// lent, and the shared pieces two kinds would otherwise copy from each other. A kind imports the desk through this, the
// engine (`@ice/desk/engine`) and the contract (`KindProgram`, `ObjectKind`, `defineObject` — `@ice/desk`) alone.
export * from "./blobs";
export * from "./inside";
export * from "./light";
export * from "./physics";
export * from "./print";
export * from "./raster";
export * from "./text";
export * from "./view";
