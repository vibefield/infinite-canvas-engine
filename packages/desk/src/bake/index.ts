// THE HAND'S BAKER (petition I59) — published as `@vibecook/ice/desk/bake`, so a host bakes its own faces as ICE bakes the
// desk's (apps/desk/tools/bake-hand.mjs): `bakeHand(ttfBytes, { file })` → the `ice-hand/1` atlas's json, its canonical text and
// its bin. Node-only by nature (a build step, never a frame) yet Node-free: pure TypeScript, no fs, no DOM, no GPU — the caller
// reads the font and writes the two files. The format and its reader are the kit's (kit/hand-atlas.ts), re-exported here so a
// host's bake script can read back what it wrote.
export { bakeHand, type BakedHand, type BakeHandOptions, HAND_EM, HAND_GLYPH_SET, HAND_INKLESS, handAtlasText } from "./bake";
export { correctionsFor, HAND_CORRECTIONS, type HandCorrection } from "./corrections";
export * from "../kit/hand-atlas";
