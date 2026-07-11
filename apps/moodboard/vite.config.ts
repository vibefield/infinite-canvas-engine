import { defineConfig } from "vite";

// A third-party-shaped consumer app: it depends on the PUBLISHED @ice/* packages
// and nothing else. No @vitejs/plugin-react — esbuild transforms .tsx JSX via the
// automatic runtime (`jsx: "automatic"`, matching tsconfig's `react-jsx`), so no
// `import React` ceremony and no plugin. The @ice/* workspace packages resolve to
// source through their package.json `exports`.
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
      // for dev AND build, no wasm plugins. This alias is BUILD PLUMBING for a
      // transitive dep pulled in by @ice/core's doc kit; the app never imports
      // loro-crdt itself. (Same fix as cardboard/nodeboard/glboard.)
      "loro-crdt": "loro-crdt/base64",
    },
  },
});
