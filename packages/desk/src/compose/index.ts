// `@ice/desk/compose` — the desk FROM THE WORLD, the DOM-free half (design-015 §4.4–§4.6;
// D2a-world): the builder (the frame's objects as records, the flux, the ghosts), the pick source
// over the kinds' mirrors, the ambient policy (the wind that idles), the reflector that draws
// only on pulled dirt, and the submit instrument that proves it. The host half — the canvas, the
// device, the layer factory a React or vanilla host mounts — is `@ice/desk/host` (`deskLayer`).
export { AMBIENT_DEFAULTS, type Ambient, type AmbientMode, type AmbientOptions, type AmbientPhase, type AmbientPin, type AmbientState, createAmbient } from "./ambient";
export { type BuildViewport, type BuildWork, type BuiltDesk, createDeskBuilder, type DeskBuilder, type DeskBuilderOptions, type DeskBuilderStats, type DeskWakeReason, type HeldBuild, type HoldPin } from "./builder";
export { createMarksCollector, type MarkRow, type MarksCollector, type SelectionAnchor } from "./marks";
export { createPickSource } from "./pick";
export { createDeskReflector, type DeskReflector, type DeskReflectorOptions, type DeskReflectorStats, type DeskWakes } from "./reflector";
export { instrumentSubmits, type SubmitInstrument, type UploadTally } from "../submit-instrument";
export { type BudgetStats, createRasterBudget, type RasterBudget } from "../engine/budget";
export { createRecordStore, type RecordStore, type RecordStoreStats } from "../engine/records";
