import { resolve } from "node:path";
import { defineConfig } from "vite";
import { umbrellaAlias } from "../../scripts/umbrella-alias.mjs";

// apps/desk — design-015's showcase. THREE pages: `index.html` is the DESK (D2a-world: React 19 over
// `createCanvasEngine`, `<Desk layer={deskLayer(…)}>`, the mat and its objects drawn FROM THE WORLD) — the
// product, whose modules import the published surface only; `rig.html` is the same desk plus the rigs' harness
// (src/rig/ — the oracle's scenes and fixtures behind `window.__desk.setScene` and `kinds.print`, design-015 D7),
// the page every `rig:*` drives through `window.__desk`; `parity.html` is D1's parity page, unchanged in meaning —
// an oracle scene drawn straight through the engine by the Node oracle's own desk, what `rig:parity` holds to Dawn
// byte for byte. The rigs serve the REPO root so the app's dist and the package's oracle results share one COOP/COEP
// origin; automatic JSX; the loro alias is build plumbing for @ice/core's doc kit.
export default defineConfig({
  base: "./",
  build: {
    target: "esnext",
    rollupOptions: { input: { index: resolve(import.meta.dirname, "index.html"), rig: resolve(import.meta.dirname, "rig.html"), parity: resolve(import.meta.dirname, "parity.html") } },
  },
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  // the plugin kinds (design-016 K8b — examples/*, e.g. the desk clock) import ICE by its PUBLISHED names (`@vibecook/ice/desk` …):
  // those resolve to the umbrella's source entries, the same modules the app's `@ice/*` names reach (one desk, one kind registry)
  resolve: { dedupe: ["react", "react-dom"], alias: [{ find: "loro-crdt", replacement: "loro-crdt/base64" }, ...umbrellaAlias()] },
  server: {
    // crossOriginIsolated → performance.now() at 5 µs instead of 100 µs.
    headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" },
  },
});
