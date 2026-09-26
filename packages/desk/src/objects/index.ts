// `@ice/desk/objects` — the desk's reference objects (design-015 §6), each a widget type through
// `defineObject`: the note and the mini mat (D2a-world); the notebook, the whiteboard, the
// calendar and the photo arrive with D3. Importing this module DEFINES them (core's registry is
// process-global): an app lists them in `createCanvasEngine({ widgets })` and the desk layer
// registers their kinds with the ground.
export { MINIMAT_TYPE, MiniMat, VINYLS, type VinylName } from "./minimat";
export { NOTE_TYPE, Note, PAPERS, type PaperName, PENS, type PenName } from "./note";

import { MiniMat } from "./minimat";
import { Note } from "./note";

/** The desk's reference objects, in the order an app registers them. */
export const DESK_OBJECTS = [Note, MiniMat] as const;
