import { configDefaults, defineConfig } from "vitest/config";
import { umbrellaAlias } from "../../scripts/umbrella-alias.mjs";

// @ice/desk's units are the prototype's (vibe-field/draft/ground, moved at D1): the pure
// laws, the layouts against the WGSL that reads them, the slot tree — no GPU, run in Node
// as they always were. The GPU path is the oracle's (`pnpm --filter @ice/objects oracle`,
// Dawn in Node) and apps/desk's `rig:parity` (the same frame in headless Chrome); the desk's own Dawn units (test/*.dawn.test.ts —
// M24 LT1's live texture and a live kind's still) are `pnpm dawn`'s (vitest.dawn.config.ts), never `test`'s: CI runs no Dawn.
// `@vibecook/ice/*` resolve to the umbrella's source entries (petition I24: the kind-fault units register the desk clock's fault
// fixture, examples/desk-clock — a plugin's package, on the published entries — exactly as a host does; one module graph, never a build).
export default defineConfig({
  resolve: { alias: umbrellaAlias() },
  test: { environment: "node", exclude: [...configDefaults.exclude, "test/**/*.dawn.test.ts"] },
});
