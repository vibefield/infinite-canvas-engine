import { defineConfig } from "vitest/config";

// @ice/ground tests cover the pure collectors (ECS → typed arrays) and the
// no-GPU fault paths under happy-dom; the actual WebGPU/WebGL2 render path is
// exercised by the Playwright e2e scripts only (no GPU in this environment).
export default defineConfig({
  test: { environment: "happy-dom" },
});
