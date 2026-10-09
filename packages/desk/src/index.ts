// `@ice/desk` — THE DESK (design-015 §3; the root barrel since D5b, mirroring the umbrella's
// `@vibecook/ice/desk`): the renderer (ground.ts — the slot tree, the frame, `Ground`), the host
// half that may touch the DOM (host/ — `deskLayer`, the text raster, the image decode), the desk FROM
// THE WORLD (compose/ — the builder, the pick source, the ambient, the reflector, the submit
// instrument), the kind CONTRACT (kind.ts, kinds/world.ts, `defineObject` — what a kind implements, is
// handed and declares), the render kit (kit/), the theme, the shaders' text and the blue noise.
// `./engine` (the raw-WebGPU engine) and `./kit` (the render kit) are the two other entries. The six
// reference kinds are a package of their own since design-016 K4b — `@ice/objects`
// (`@vibecook/ice/desk/objects`), built on these entries alone, as a plugin kind is — and this barrel
// names none of them (design-011:863: the ground MUST NOT import a barrel of all built-ins). The
// desk's own units import the modules under src/ directly; a kind's package imports this barrel, in
// Node too — host/ touches the DOM only when called, never at module scope (pack:audit imports every
// entry in Node).
export * from "./ground";
export * from "./tray/index";
export * from "./host/index";
export * from "./compose/index";
export * from "./kit/index";
export * from "./object";
// the kind contract's WORLD half (kinds/world.ts, D2a-world): what a kind implements and is handed — its world half, its drivers'
// host, its DOM half's (K4b) — beside the render half ground.ts re-exports from kind.ts
export { type DataChildren, FLUX_REST, type HeldContext, type HeldCursorContext, type HeldEvent, type HeldReadoutContext, type HeldToolDef, type InsideContext, isObjectKind, type KindDriver, type KindDriverHost, type KindHost, type KindLocal, numberProp, type ObjectContext, type ObjectDomHost, type ObjectFlux, type ObjectHit, type ObjectHost, type ObjectKind, type ObjectRect, type OpenBinding, rectFrame, rectOf, type RungContext, type StratumName, stringProp } from "./kinds/world";
// the hand's pose (design-015 §8, D4b): the reading size, the pose between the desk and the hand, the pose as a camera
export { carryOf, focusOf, HELD_USER_REST, type HeldPose, type HeldUser, type HeldViewport, heldCamera, heldFrame, heldPose, HOLD, type HoldOptions, type HoldReserves, type HomePose, homePose, isNarrow, type ReadingTarget, readingTarget } from "./hold/pose";
export { NO_DOCS, type TypingDocs, type WritableSession, writable } from "./docs";
// THE KIND BOUNDARY (petition I24): one kind's fault is that kind's — the faults a layer keeps and says (`DeskLayerStatus.faults`),
// the ladder's numbers, `due().kinds`' word for a missing kind — and the missing face both hosts draw what nothing can draw with
export { createKindFaults, faultText, KIND_MISSING, KIND_STRIKES, type KindFault, type KindFaults } from "./faults";
export { MISSING_KIND, MISSING_OBJECT } from "./missing/object";
export { isMissingRecord, missingFace, type MissingRecord } from "./missing/layout";
export * from "./theme";
export * from "./shaders";
export { BLUE_NOISE_SIZE, blueNoise } from "./assets/blue-noise.gen";
// THE STILL (petition I30): one frame of a desk on the CALLER's device, no canvas — a world staged through the engine's doors, drawn
// into a readable texture and read back as RGBA (a plugin's pixel proof through this door alone); the host-less desk it draws on
// (still.ts `createStillDesk`) is the Node oracle's too, and stays the module's
export { createStill, STILL_PALETTE, type Still, type StillFormat, type StillOptions, type StillStage } from "./still";
// the desk's scale-free zoom band (design-015 §9): what an engine preset spreads (`@ice/objects`' `DESK_ENGINE`)
export { ZOOM_MAX, ZOOM_MIN } from "./lattice/lod";
