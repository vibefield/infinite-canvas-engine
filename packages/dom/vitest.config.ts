import { defineConfig } from "vitest/config";

// @ice/dom tests exercise real DOM reflectors/adapters, so they run under
// happy-dom (mirrors core's `vitest run`; picked up by the root `pnpm run ci`).
export default defineConfig({
  test: { environment: "happy-dom" },
});
