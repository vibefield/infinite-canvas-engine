import { defineConfig } from "vitest/config";

// Headless React + real DOM reflectors/adapters ⇒ happy-dom (mirrors @ice/dom
// and @ice/react; picked up by the root `pnpm run ci`). esbuild transforms the
// .tsx tests via the automatic JSX runtime, same as the vite build.
export default defineConfig({
  test: { environment: "happy-dom" },
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
});
