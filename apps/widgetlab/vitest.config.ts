import { defineConfig } from "vitest/config";

// Headless widget tests: the @ice/react widget views + defineWidget registry
// under happy-dom. esbuild transforms .tsx via the automatic JSX runtime; the
// loro-crdt→base64 alias keeps the CRDT dependency importable in Node.
export default defineConfig({
  test: { environment: "happy-dom" },
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  resolve: { alias: { "loro-crdt": "loro-crdt/base64" } },
});
