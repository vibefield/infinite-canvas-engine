import { defineConfig } from "vite";

// groundlab — the ground's lab: the tweak panel, the scenes, and the host of the
// Chrome rigs (scripts/*.mjs) that drive it headless. Same shape as draft/ground's
// lab (moved at B1, 2026-09-07). The rigs serve the REPO root so the app's dist
// and the package's oracle results share one COOP/COEP origin.
export default defineConfig({
  base: "./",
  build: { target: "esnext" },
  server: {
    // crossOriginIsolated → performance.now() at 5 µs instead of 100 µs.
    headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" },
  },
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
