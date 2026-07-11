import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// widgetlab — the v1 playground widget showcase on the v3 engine. Tailwind v4
// because the v1 widget bodies are Tailwind JSX ported verbatim. Same build
// shape as the other apps otherwise (automatic JSX; loro alias is build
// plumbing for @ice/core's doc kit; three deduped so the islands share one).
export default defineConfig({
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
