// VibeField's projection into the ground — the oracle's name for the reference objects' palette.
// The table itself moved to `src/objects/palette.ts` at design-015 D7 (D-D7-C.1: a complete default
// palette SHIPPED in `@vibecook/ice/desk/objects`, so the published quickstart mounts); this module
// re-exports it, so the oracle, apps/desk's parity page and the units read the one table the
// package publishes.
export * from "../../src/objects/palette";
