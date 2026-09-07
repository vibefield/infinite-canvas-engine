// @ice/ground/compose — the ground as design-013's compositor: the magnet field
// and the cutting mat, the SDF card frame with its content term and the heat,
// the live portal's slot tree and the flight's second slot, the theme's engine
// half, and `Ground` itself. Moved from vibe-field/draft/ground at B1
// (2026-09-07); the old leg (`@ice/ground`'s barrel) imports none of this and
// this imports none of it — dependency-cruiser holds the wall until B8.
export * from "../engine/device";
export * from "../engine/pipeline";
export * from "../engine/shader";
export * from "../engine/struct";
export * from "../engine/target";
export * from "../lattice/line";
export * from "../lattice/lod";
export * from "../field/bake-pass";
export * from "../field/field";
export * from "../field/glyph-pass";
export * from "../field/glyph-size";
export * from "../field/layout";
export * from "../field/line-glyph";
export * from "../field/program";
export * from "../field/shaders";
export * from "../card/content";
export * from "../card/frame-pass";
export * from "../card/geometry";
export * from "../card/layout";
export * from "../card/motion";
export * from "../card/program";
export * from "../card/shaders";
export * from "../card/springs";
export * from "../nav/fill-pass";
export * from "../nav/flight";
export * from "../nav/portal";
export * from "../compose/ground";
export * from "../compose/dom-compose";
export * from "../compose/dom-render";
export * from "../compose/frame-inputs";
export * from "../compose/host";
export * from "../compose/residency";
export * from "../compose/video-ingest";
export * from "../submit-instrument";
export * from "../theme";
export * from "../shaders";
export { WGSL, type WgslFile } from "../shaders.gen";
