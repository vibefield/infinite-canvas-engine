import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// The renderer is owned and built by widgetlab-desktop. A relative base is
// required because production Electron windows load dist/index.html over the
// file: protocol instead of from a web-server origin.
export default defineConfig({
  base: "./",
  plugins: [tailwindcss()],
  server: { open: false },
  build: {
    rollupOptions: {
      // Two entries: the product, and the design-012 S1 parity rig
      // (ground-parity.html — the composited/stratified pixel oracle). The rig
      // is a separate PAGE rather than a mode of the product, deliberately:
      // one profile ships per app (§11 Q2), so the product must not grow a
      // runtime switch between them just to be measurable.
      input: {
        index: "index.html",
        "ground-parity": "ground-parity.html",
      },
    },
  },
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  resolve: {
    dedupe: ["react", "react-dom", "three", "@react-three/fiber"],
    alias: {
      "loro-crdt": "loro-crdt/base64",
    },
  },
});
