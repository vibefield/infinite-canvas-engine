/**
 * `@vibecook/ice/desk/bake` — the hand's baker (petition I59): a TrueType face's bytes in, its `ice-hand/1` atlas out (`bakeHand`:
 * the json, its canonical text and the RG8 bin), so a host bakes its own faces as ICE bakes the desk's. A build step, never a
 * frame: Node-only by nature, yet pure — no fs, no DOM, no GPU. The format and its reader (`readHandAtlas`) ride along.
 */
export * from "../../desk/src/bake/index";
