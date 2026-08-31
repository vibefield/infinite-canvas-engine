/**
 * `@ice/r3f/webgpu` — the composited profile's opt-in door.
 *
 * A SEPARATE SUBPATH, not part of the package barrel, and the reason is
 * mechanical rather than stylistic: three declares
 * `sideEffects: ["./src/nodes/**\/*"]`, so a `three/webgpu` import anywhere in
 * the reachable graph survives tree-shaking and pulls the whole node material
 * system into the bundle. Re-exporting this from `src/index.ts` would put that
 * cost on every stratified app — which builds no compositor, owns no device,
 * and would never execute a line of it.
 *
 * So the split follows the profile: `@ice/r3f` is what both profiles import,
 * and `@ice/r3f/webgpu` is what only a composited app's build wiring names.
 * Everything else the composited profile needs — the WebGPU pool, the source
 * binder, the backend readers — lives in the barrel, because none of it
 * imports `three/webgpu`; they read three's backend structurally instead.
 */
export {
  createIslandRenderer,
  islandRendererFactory,
  type IslandRenderer,
  type IslandRendererOpts,
} from "./island-renderer";
