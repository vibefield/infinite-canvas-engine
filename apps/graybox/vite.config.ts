import { defineConfig } from "vite";

// Plain-TS demo (no framework plugin). The @ice/* workspace packages resolve
// through their package.json `exports` to source, so vite bundles them directly.
export default defineConfig({
  server: { open: false },
  resolve: {
    alias: {
      // loro-crdt's dev-time resolution (`browser.development` condition) hits
      // its wasm-bindgen `bundler/` target, whose raw `import ... from
      // "./loro_wasm_bg.wasm"` vite dev refuses ("ESM integration proposal for
      // Wasm"). The `base64/` entry is API-identical with the wasm inlined —
      // one consistent target for dev AND build, no wasm plugins needed.
      "loro-crdt": "loro-crdt/base64",
    },
  },
});
