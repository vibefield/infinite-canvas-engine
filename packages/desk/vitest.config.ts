import { defineConfig } from "vitest/config";

// @ice/desk's units are the prototype's (vibe-field/draft/ground, moved at D1): the pure
// laws, the layouts against the WGSL that reads them, the slot tree — no GPU, run in Node
// as they always were. The GPU path is the oracle's (`pnpm --filter @ice/desk oracle`,
// Dawn in Node) and apps/desk's `rig:parity` (the same frame in headless Chrome).
export default defineConfig({
  test: { environment: "node" },
});
