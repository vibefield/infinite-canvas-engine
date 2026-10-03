// `@ice/desk`'s src/host/ (no entry of its own; the root barrel re-exports it) — the half of the desk that may touch the
// DOM (design-015 §3 `desk-dom-free`):
// the swap chain over a canvas, and the desk LAYER a host mounts (`deskLayer`, D2a-world: the
// canvas in the ground slot, the device, the reflector and the pick source over the world).
// Everything else under src/ is DOM-free, so the Node oracle imports it whole; a test greps.
// The kinds' DOM halves — the note's editor, the calendar's input and print raster — left with their kinds at design-016 K4b
// (`@ice/objects`: each object declares its half, `defineObject({ host })`, and the layer builds what the objects declare).
export { deskLayer, type DeskLayerBoot, type DeskLayerContext, type DeskLayerFactory, type DeskLayerHandle, type DeskLayerOptions, type DeskLayerPerf, type DeskLayerStatus, type DeskTrayDoor, type MatPin, type SelectionSource, type TrayAnchor } from "./layer";
export type { SelectionAnchor } from "../compose/marks";
export { surface, type Surface } from "./surface";
// the ONE focused editor (D2c; the desk's since design-016 K8a — every kind LEASES it through the text parts its object declares):
// its maker (the layer's) and its markers
export { createDeskEditor, type DeskEditorOptions, EDITOR_ATTR, KEYBOARD_CLAIM_ATTR } from "./editor";
// the TEXT raster a browser hands the kinds (D2c; the `TEXT_RASTER` service, K8a — the note writes in it, the calendar prints in its hand): the
// faces by URL, Canvas2D ink on an OffscreenCanvas
export { type FaceSpec, inkRaster, type InkRaster, type InkRasterOptions, PEN_FACES, penFaces } from "./ink";
// the one image decode — a pasted or dropped picture for a print (D3w; the `PICTURE_DECODER` service, K8a — the host's for any kind with pictures)
export { decodePicture } from "./picture";
// What a host FEEDS the mat through the handle (the render map's finding #2): the plates' slots, the glyph atlas's shape and cells, the mat's config.
export { DEFAULT_MAT_CONFIG, GLYPH_PAD, GLYPHS, type GlyphAtlasMeta, type MatConfig, type PlateName, type RulerConfig } from "../mat/layout";
export type { GridConfig } from "../mat/grid";
// …and the objects' springs a host may keep and tune live (`DeskLayerOptions.springs` — the dev panel, D5a)
export { type ObjectSprings, SPRINGS } from "../kit/springs";
