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
      // The product, plus one page per design-012 exit rig. A rig is a separate
      // PAGE rather than a mode of the product, deliberately: one profile ships
      // per app (§11 Q2), so the product must not grow a runtime switch between
      // the profiles just to be measurable.
      //   ground-parity    — S1: does device injection change ground's pixels?
      //   island-parity    — S5: do islands on the shared device match the
      //                          WebGL ones, and did MSAA / sRGB / orientation
      //                          survive?
      //   composited-board — S2/S3/S4: dom widget quads against the stratified
      //                          render, plus the write-back, input and demand
      //                          probes that share its board.
      input: {
        index: "index.html",
        "ground-parity": "ground-parity.html",
        "island-parity": "island-parity.html",
        "composited-board": "composited-board.html",
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
