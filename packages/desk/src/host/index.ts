// `@ice/desk/host` — the half of the desk that may touch the DOM (design-015 §3 `desk-dom-free`):
// the swap chain over a canvas, and the desk LAYER a host mounts (`deskLayer`, D2a-world: the
// canvas in the ground slot, the device, the reflector and the pick source over the world).
// Everything else under src/ is DOM-free, so the Node oracle imports it whole; a test greps.
export { deskLayer, type DeskLayerContext, type DeskLayerFactory, type DeskLayerHandle, type DeskLayerOptions, type DeskLayerStatus, type MatPin } from "./layer";
export { surface, type Surface } from "./surface";
// What a host FEEDS the mat through the handle (the render map's finding #2): the plates' slots, the glyph atlas's shape and cells, the mat's config.
export { DEFAULT_MAT_CONFIG, GLYPH_PAD, GLYPHS, type GlyphAtlasMeta, type MatConfig, type PlateName, type RulerConfig } from "../mat/layout";
export type { GridConfig } from "../mat/grid";
