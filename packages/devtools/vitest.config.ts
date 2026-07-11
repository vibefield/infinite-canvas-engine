import { defineConfig } from "vitest/config";

// @ice/devtools mounts a real DOM panel and reads the world outside the tick, so
// its tests run under happy-dom (mirrors @ice/dom; picked up by root `pnpm run ci`).
export default defineConfig({
  test: { environment: "happy-dom" },
});
