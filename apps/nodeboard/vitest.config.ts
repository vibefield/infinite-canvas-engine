import { defineConfig } from "vitest/config";

// Headless React + real DOM reflectors/adapters under happy-dom (no WebGL; the
// wires reflector degrades to a no-op when `getContext("2d")` is null). esbuild
// transforms the .tsx tests via the automatic JSX runtime, same as the build.
export default defineConfig({
  test: { environment: "happy-dom" },
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
});
