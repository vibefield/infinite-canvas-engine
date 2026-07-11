import { defineConfig } from "vitest/config";

// Headless widget tests: the @ice/react widget views + defineWidget registry
// under happy-dom. esbuild transforms .tsx via the automatic JSX runtime.
// NO loro-crdt alias here (unlike vite.config.ts, where it is browser build
// plumbing): Node loads loro's real nodejs wasm, and aliasing only the app's
// imports while strata resolves the un-aliased package yields TWO wasm
// instances — "expected instance of LoroDoc" the moment a doc session exists
// (graybox precedent: session-creating tests run alias-free).
export default defineConfig({
  test: { environment: "happy-dom" },
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
});
