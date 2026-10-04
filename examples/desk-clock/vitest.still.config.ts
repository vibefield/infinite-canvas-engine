import { defineConfig } from "vitest/config";
import { umbrellaAlias } from "../../scripts/umbrella-alias.mjs";

// THE CLOCK'S STILL ON DAWN (petition I30): test/*.dawn.test.ts alone — `createStill` through `@vibecook/ice/desk` on the oracle's
// device (Dawn in Node, the `webgpu` package), held to the golden beside its tests. Kept out of `test` (vitest.config.ts excludes
// it): CI runs no Dawn, and a golden is Dawn's bytes on the host that blessed it; `pnpm still` runs it, and the landing gate runs
// that right after the oracle. `STILL_BLESS=1 pnpm still` re-blesses — a deliberate event, said in its commit.
export default defineConfig({
  resolve: { alias: umbrellaAlias() },
  test: { environment: "node", include: ["test/**/*.dawn.test.ts"], testTimeout: 120_000 },
});
