// `@ice/desk` — THE DESK (design-015 §3; the root barrel since D5b, mirroring the umbrella's
// `@vibecook/ice/desk`): the renderer (ground.ts — the slot tree, the frame, `Ground`), the host
// half that may touch the DOM (host/ — `deskLayer`, the one focused editor, the text raster, the
// image decode), the desk FROM THE WORLD (compose/ — the builder, the pick source, the ambient, the
// reflector, the submit instrument), the kind registry (kinds/), `defineObject` (the typed door),
// the theme, the shaders' text and the blue noise. `./engine` (the raw-WebGPU engine) and
// `./objects` (the six reference kinds' world halves) are the two other entries; the Node oracle
// and the tests import the modules under src/ directly, never this barrel (host/ touches the DOM).
export * from "./ground";
export * from "./tray/index";
export * from "./host/index";
export * from "./compose/index";
export * from "./kinds/index";
export * from "./kit/index";
export * from "./object";
export { NO_DOCS, type TypingDocs, type WritableSession, writable } from "./docs";
export * from "./theme";
export * from "./shaders";
export { BLUE_NOISE_SIZE, blueNoise } from "./assets/blue-noise.gen";
