import { defineConfig } from "vitest/config";

// Headless React + real DOM reflectors/adapters + real three scenes (no WebGL)
// ⇒ happy-dom (three constructs Scene/Mesh/geometry headlessly; the exit tests
// never render a <Canvas>). esbuild transforms the .tsx tests via the automatic
// JSX runtime, same as the vite build.
export default defineConfig({
  test: { environment: "happy-dom" },
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
});
