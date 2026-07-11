import { defineConfig } from "vitest/config";

// Headless app tests: the world assembly + real interaction stack under
// happy-dom (no WebGL — the grid reflector self-disables; no rAF needed, the
// tests step the engine directly).
export default defineConfig({
  test: { environment: "happy-dom" },
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  resolve: { alias: { "loro-crdt": "loro-crdt/base64" } },
});
