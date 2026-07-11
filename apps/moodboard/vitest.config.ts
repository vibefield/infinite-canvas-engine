import { defineConfig } from "vitest/config";

// Headless React + real DOM (the @ice/react widget views render into portals) ⇒
// happy-dom. esbuild transforms the .tsx tests via the automatic JSX runtime,
// same as the vite build.
export default defineConfig({
  test: { environment: "happy-dom" },
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
});
