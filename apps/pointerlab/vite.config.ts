import { defineConfig } from "vite";

// pointerlab — the v2 "Pointer Prototype" demo, 100%-identical, rebuilt on the
// v3 engine. Same build shape as moodboard: no @vitejs/plugin-react (esbuild
// automatic JSX runtime), loro alias is build plumbing for @ice/core's doc kit
// (this app never imports loro-crdt itself).
export default defineConfig({
  server: { open: false },
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "loro-crdt": "loro-crdt/base64",
    },
  },
});
