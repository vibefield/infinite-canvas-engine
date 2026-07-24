import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// The renderer is owned and built by widgetlab-desktop. A relative base is
// required because production Electron windows load dist/index.html over the
// file: protocol instead of from a web-server origin.
export default defineConfig({
  base: "./",
  plugins: [tailwindcss()],
  server: { open: false },
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  resolve: {
    dedupe: ["react", "react-dom", "three", "@react-three/fiber"],
    alias: {
      "loro-crdt": "loro-crdt/base64",
    },
  },
});
