import { defineConfig } from "vitest/config";

// The harness drives real DOM reflectors headlessly, so it runs under happy-dom
// (mirrors @ice/dom; picked up by the root `pnpm run ci`).
export default defineConfig({
  test: { environment: "happy-dom" },
});
