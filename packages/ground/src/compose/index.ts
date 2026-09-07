// @ice/ground/compose — the ground as design-013's engine: the magnet field
// and the cutting mat, the SDF card frame with its content term and the heat,
// the live portal's slot tree and the flight's second slot, the overlays, the
// poles, the theme's engine half, both hosts (`groundCompose` for the
// composited profile, `groundField` for the stratified one — C2) and `Ground`
// itself. Moved from vibe-field/draft/ground at B1 (2026-09-07); since C2 the
// whole package is this leg — `@ice/ground` (the barrel) is its stratified
// face and imports from here.
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
export * from "../compose/overlay";
export * from "../compose/soup";
export * from "../compose/overlays";
export * from "../compose/poles";
export { collectGuides } from "../compose/guides-collect";
export { collectWires } from "../compose/wires-collect";
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
