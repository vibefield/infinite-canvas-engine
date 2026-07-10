import { defineConfig } from "vite";

// React demo, NO @vitejs/plugin-react: esbuild transforms .tsx JSX via the
// automatic runtime (`jsx: "automatic"` — matches tsconfig's `react-jsx`), so
// there is no `import React` ceremony and no plugin. (HMR/Fast-Refresh is the
// only thing the plugin would add; a demo full-reload is fine.) The @ice/*
// workspace packages resolve to source through their package.json `exports`.
export default defineConfig({
  server: { open: false },
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  resolve: {
    alias: {
      // loro-crdt's dev `browser.development` condition hits its wasm-bindgen
      // `bundler/` target, whose raw `import ... from "*.wasm"` vite dev refuses.
      // The `base64/` entry is API-identical with the wasm inlined — one target
      // for dev AND build, no wasm plugins. (Same fix as graybox.)
      "loro-crdt": "loro-crdt/base64",
    },
  },
});
