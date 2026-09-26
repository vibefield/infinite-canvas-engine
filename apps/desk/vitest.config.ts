import { defineConfig } from "vitest/config";

// apps/desk's units (D5a): the exit tests the retired apps carried, ported BY NAME (design-015 §11.6) — M10's
// `exit-imports` (the app against its published surface) and M9's `collab` (two desk engines over the SAME
// in-memory doubles core's bootstrap/presence suites use). Headless in Node: no GPU, no DOM — the desk's pictures
// are the rigs' (`rig:*`, headless Chrome) and the oracle's (Dawn in Node). Its own config, so the app's
// vite.config.ts (the browser build's loro alias, the COOP/COEP headers) stays out of the units.
export default defineConfig({
  test: { environment: "node", include: ["test/**/*.test.ts"] },
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
});
