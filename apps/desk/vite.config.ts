import { resolve } from "node:path";
import { defineConfig } from "vite";

// apps/desk — design-015's showcase. TWO pages: `index.html` is the DESK (D2a-world: React 19 over
// `createCanvasEngine`, `<InfiniteCanvas ground={deskLayer(…)} chrome={false}>`, the mat and its
// objects drawn FROM THE WORLD — what `rig:world`, `rig:interact` and `rig:idle` drive through
// `window.__desk`); `parity.html` is D1's parity page, unchanged in meaning — an oracle scene drawn
// straight through the engine by the Node oracle's own desk, what `rig:parity` holds to Dawn byte
// for byte. Same shape as apps/groundlab otherwise: the rigs serve the REPO root so the app's dist
// and the package's oracle results share one COOP/COEP origin; automatic JSX (widgetlab's build
// shape); the loro alias is build plumbing for @ice/core's doc kit.
export default defineConfig({
  base: "./",
  build: {
    target: "esnext",
    rollupOptions: { input: { index: resolve(import.meta.dirname, "index.html"), parity: resolve(import.meta.dirname, "parity.html") } },
  },
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  resolve: { dedupe: ["react", "react-dom"], alias: { "loro-crdt": "loro-crdt/base64" } },
  server: {
    // crossOriginIsolated → performance.now() at 5 µs instead of 100 µs.
    headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" },
  },
});
