// @ice/ground/packs — the reference packs (design-014, D1): what an app
// registers to give the engine's ground a look beyond the dot and the shell.
// `needleGlyph` and `cuttingMat` are grid programs (`Ground.create({ grids })`,
// `groundCompose({ grids })`); `vfFrame()` is a card program (`{ card }`).
// widgetlab registers all three; VibeField registers them through the pin, or
// forks one when its look diverges.
export * from "./needle";
export * from "./mat";
export * from "./vf-frame";
