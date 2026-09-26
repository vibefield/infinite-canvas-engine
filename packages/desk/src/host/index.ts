// `@ice/desk/host` — the half of the desk that may touch the DOM (design-015 §3 `desk-dom-free`):
// the swap chain over a canvas, and the desk LAYER a host mounts (`deskLayer`, D2a-world: the
// canvas in the ground slot, the device, the reflector and the pick source over the world).
// Everything else under src/ is DOM-free, so the Node oracle imports it whole; a test greps.
export { surface, type Surface } from "./surface";
