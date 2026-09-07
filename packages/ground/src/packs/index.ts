// @ice/ground/packs — the reference packs (design-014, D1): what an app
// registers to give the engine's ground a look beyond the dot and the shell.
// `needleGlyph` and `cuttingMat` are grid programs (`Ground.create({ grids })`,
// `groundCompose({ grids })`); `vfFrame()` is a card program (`{ card }`).
// widgetlab registers all three; VibeField registers them through the pin, or
// forks one when its look diverges.
export * from "./needle";
export * from "./mat";
export * from "./vf-frame";
// The mat's blue-noise tile, as bytes (B8, D-B8.1). The pack has always taken it
// through `matPass.setNoise(bytes)`; what changed is that the tile now SHIPS —
// a published consumer has `dist/` only, so a `?url` import of
// `assets/blue-noise.rgba` reaches nothing. A lab may still load the file.
export { blueNoise, BLUE_NOISE_SIZE } from "../assets/blue-noise.gen";
