/**
 * Residency (design-013 §4) — the module that replaces "atlasing". It owns
 * every compositor destination: atlas layers for dom cards, private textures
 * for oversize slots and gl islands, and producers' registered stable textures.
 *
 * Three modules: `layer-allocator.ts` (where a slot may sit), `texture-table.ts`
 * (what a `TextureRef.texture` handle means), and `residency-system.ts` (the one
 * writer of `TextureRef`, which reads the presentation facts and decides).
 *
 * Nothing here is realised on a GPU. The system computes allocation purely and
 * writes the world; `realize` / `realized` are Phase B's, and no renderer reads
 * `TextureRef` before B3 (plan §3).
 */
export * from "./layer-allocator";
export * from "./residency-system";
export * from "./texture-table";
