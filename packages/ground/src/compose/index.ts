// @ice/ground/compose — the ground as design-013's compositor: the magnet field
// and the cutting mat, the SDF card frame with its content term and the heat,
// the live portal's slot tree and the flight's second slot, the theme's engine
// half, and `Ground` itself. Moved from vibe-field/draft/ground at B1
// (2026-09-07); the old leg (`@ice/ground`'s barrel) imports none of this and
// this imports none of it — dependency-cruiser holds the wall until B8.
export * from "../engine/device.ts";
export * from "../engine/pipeline.ts";
export * from "../engine/shader.ts";
export * from "../engine/struct.ts";
export * from "../engine/target.ts";
export * from "../lattice/line.ts";
export * from "../lattice/lod.ts";
export * from "../field/bake-pass.ts";
export * from "../field/field.ts";
export * from "../field/glyph-pass.ts";
export * from "../field/glyph-size.ts";
export * from "../field/layout.ts";
export * from "../field/shaders.ts";
export * from "../card/choreography.ts";
export * from "../card/content.ts";
export * from "../card/frame-pass.ts";
export * from "../card/heat.ts";
export * from "../card/layout.ts";
export * from "../card/motion.ts";
export * from "../card/sdf.ts";
export * from "../card/shaders.ts";
export * from "../card/sheet.ts";
export * from "../card/springs.ts";
export * from "../nav/fill-pass.ts";
export * from "../nav/flight.ts";
export * from "../nav/portal.ts";
export * from "../mat/layout.ts";
export * from "../mat/mat-pass.ts";
export * from "../mat/night.ts";
export * from "../mat/projector.ts";
export * from "../mat/shaders.ts";
export * from "../mat/tilt.ts";
export * from "../compose/ground.ts";
export * from "../theme.ts";
export * from "../shaders.ts";
export { WGSL, type WgslFile } from "../shaders.gen.ts";
