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
      // The product, plus one page per design-013 exit rig. A rig is a separate
      // PAGE rather than a mode of the product, deliberately: one profile ships
      // per app (§11 Q2), so the product must not grow a runtime switch between
      // the profiles just to be measurable.
      //   composited        — B2: the composited profile boots to the ground's own
      //                          canvas (no cards), idle-zero, alive.
      //   composited-render — B4: DomRender — the promote witness (D7), the demand
      //                          clamp's rate and bucket ladder, and the drift
      //                          readback under both raster strategies.
      //   composited-input  — B8 R7 (the old `input` rig, ported): transform compose
      //                          inside layoutsubtree, stale hit regions, a zero-byte
      //                          pan, and native focus/typing through a promoted card.
      //   composited-islands— B5: a `gl` island rendered into the PRIVATE target
      //                          Residency named, drawn by the ground in `own` mode;
      //                          parity against a WebGL render of the same scene, and
      //                          the cross-kind z check.
      //   line-grid-ab      — C1d: the RECORDED A/B — the old TSL line grid and the
      //                          engine's new `line` glyph at three zooms, one device,
      //                          with an A-vs-A control per arm.
      //   composited-video  — B6: a live surface — a producer registers a stable
      //                          texture and each arriving frame is one copy and one
      //                          compose frame.
      //   composited-app    — C0: the PRODUCT's board — the demo seed, the App's own
      //                          <Canvas> wiring, and the seven lit GL cards graded
      //                          against a WebGL control on the same Scene objects.
      input: {
        index: "index.html",
        composited: "composited.html",
        "composited-render": "composited-render.html",
        "composited-input": "composited-input.html",
        "composited-islands": "composited-islands.html",
        "composited-video": "composited-video.html",
        "composited-app": "composited-app.html",
        "line-grid-ab": "line-grid-ab.html",
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
