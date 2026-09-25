import { defineConfig } from "vite";

// apps/desk — design-015's showcase. At D1 it is a PARITY page and nothing else: any oracle scene
// drawn straight through @ice/desk's engine by the Node oracle's own desk (frame.mjs), so the
// `rig:parity` script can hold Chrome to Dawn byte for byte. Same shape as apps/groundlab: the
// rig serves the REPO root so the app's dist and the package's oracle results share one
// COOP/COEP origin.
export default defineConfig({
  base: "./",
  build: { target: "esnext" },
  server: {
    // crossOriginIsolated → performance.now() at 5 µs instead of 100 µs.
    headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" },
  },
});
