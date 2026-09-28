import { defineConfig } from "vitest/config";
import { umbrellaAlias } from "../../scripts/umbrella-alias.mjs";

// apps/desk's units (D5a): the exit tests the retired apps carried, ported BY NAME (design-015 §11.6) — M10's
// `exit-imports` (the app against its published surface) and M9's `collab` (two desk engines over the SAME
// in-memory doubles core's bootstrap/presence suites use). Headless in Node: no GPU, no DOM — the desk's pictures
// are the rigs' (`rig:*`, headless Chrome) and the oracle's (Dawn in Node). Its own config, so the app's
// vite.config.ts (the browser build's loro alias, the COOP/COEP headers) stays out of the units.
// The app's plugin kinds (design-016 K8b — the desk clock) import ICE by its PUBLISHED names: those resolve to the umbrella's source
// entries here as in the browser build (scripts/umbrella-alias.mjs).
export default defineConfig({
  resolve: { alias: umbrellaAlias() },
  test: { environment: "node", include: ["test/**/*.test.ts"] },
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
});
