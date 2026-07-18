import { defineConfig } from "vitest/config";

// @ice/devtools mounts a real DOM panel and reads the world outside the tick, so
// its tests run under happy-dom (mirrors @ice/dom; picked up by root `pnpm run ci`).
export default defineConfig({
  // setup.ts: localStorage shim — vitest 3.2 + happy-dom 20 stopped exposing
  // it as a test global (see the file header for the probe).
  test: { environment: "happy-dom", setupFiles: ["./test/setup.ts"] },
});
