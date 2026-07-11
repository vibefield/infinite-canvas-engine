import { defineConfig } from "vite";

// Pure DOM demo (no GL), so no @react-three/fiber and no @vitejs/plugin-react:
// esbuild transforms .tsx JSX via the automatic runtime (`jsx: "automatic"` —
// matches tsconfig's `react-jsx`), so there is no `import React` ceremony. The
// @ice/* workspace packages resolve to source through their package.json
// `exports`.
export default defineConfig({
  server: { open: false },
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  resolve: {
    // One copy each of react across the app + @ice/react.
    dedupe: ["react", "react-dom"],
    alias: {
      // loro-crdt's dev `browser.development` condition hits its wasm-bindgen
      // `bundler/` target, whose raw `import ... from "*.wasm"` vite dev refuses.
      // The `base64/` entry is API-identical with the wasm inlined — one target
      // for dev AND build, no wasm plugins. (Same fix as glboard/cardboard.)
      "loro-crdt": "loro-crdt/base64",
    },
  },
});
