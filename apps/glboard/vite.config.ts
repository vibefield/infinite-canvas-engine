import { defineConfig } from "vite";

// Mixed DOM+GL demo, NO @vitejs/plugin-react: esbuild transforms .tsx JSX via
// the automatic runtime (`jsx: "automatic"` — matches tsconfig's `react-jsx`),
// so there is no `import React` ceremony and no plugin. R3F's three-element JSX
// (`<mesh>`, `<boxGeometry>`, …) needs no extra config — @react-three/fiber
// augments `react/jsx-runtime`'s IntrinsicElements at the type level. The @ice/*
// workspace packages (including @ice/r3f) resolve to source through their
// package.json `exports`.
export default defineConfig({
  server: { open: false },
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  resolve: {
    // One copy each of three/react across the app + @ice/r3f (a `three` peer) +
    // @react-three/fiber: the GL router raycasts the very three objects the
    // widget's JSX creates, so a duplicated `three` would break instanceof/hit
    // paths. Silences R3F's "Multiple instances of Three.js" warning too.
    dedupe: ["three", "@react-three/fiber", "react", "react-dom"],
    alias: {
      // loro-crdt's dev `browser.development` condition hits its wasm-bindgen
      // `bundler/` target, whose raw `import ... from "*.wasm"` vite dev refuses.
      // The `base64/` entry is API-identical with the wasm inlined — one target
      // for dev AND build, no wasm plugins. (Same fix as cardboard/graybox.)
      "loro-crdt": "loro-crdt/base64",
    },
  },
});
