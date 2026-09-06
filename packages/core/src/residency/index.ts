/**
 * Residency (design-013 §4) — the module that replaces "atlasing". It owns
 * every compositor destination: atlas layers for dom cards, private textures
 * for oversize slots and gl islands, and producers' registered stable textures.
 *
 * A2 part 1 is the PURE half — `layer-allocator.ts` (where a slot may sit) and
 * `texture-table.ts` (what a `TextureRef.texture` handle means). Nothing here
 * touches the world, and nothing is realised on a GPU: the Residency SYSTEM
 * that reads the presentation facts and writes `TextureRef` lands beside them,
 * and realisation is Phase B's (plan §3).
 */
export * from "./layer-allocator";
export * from "./texture-table";
