import { defineConfig } from "vitest/config";
import { umbrellaAlias } from "../../scripts/umbrella-alias.mjs";

// @ice/desk's units are the prototype's (vibe-field/draft/ground, moved at D1): the pure
// laws, the layouts against the WGSL that reads them, the slot tree — no GPU, run in Node
// as they always were. The GPU path is the oracle's (`pnpm --filter @ice/objects oracle`,
// Dawn in Node) and apps/desk's `rig:parity` (the same frame in headless Chrome).
// `@vibecook/ice/*` resolve to the umbrella's source entries (petition I24: the kind-fault units register the desk clock's fault
// fixture, examples/desk-clock — a plugin's package, on the published entries — exactly as a host does; one module graph, never a build).
export default defineConfig({
  resolve: { alias: umbrellaAlias() },
  test: { environment: "node" },
});
