import { defineConfig } from "vitest/config";
import { umbrellaAlias } from "../../scripts/umbrella-alias.mjs";

// THE DESK ON DAWN (M24 LT1): test/*.dawn.test.ts alone — the kit's live texture on a real device (Dawn in Node, the `webgpu`
// package: its level 0 read back, its mips made into a frame's encoder as deep as asked, its label in the memory ledger) and a live
// kind's still from committed bytes (`createStill` + `stillLive`). Kept out of `test` (vitest.config.ts excludes it): CI runs no
// Dawn; `pnpm dawn` runs it, and the landing gate runs that right after the oracle.
export default defineConfig({
  resolve: { alias: umbrellaAlias() },
  test: { environment: "node", include: ["test/**/*.dawn.test.ts"], testTimeout: 120_000 },
});
