import { defineConfig } from "tsup";

/**
 * The publish bundle: one npm package (`@vibecook/ice`) with subpath exports,
 * built from the six workspace packages. `splitting: true` is load-bearing —
 * the workspace code (catalog registrations, tool/prefab registries, HMR boot
 * kit) must exist ONCE as shared chunks, not be duplicated per entry, or
 * duplicate-definition guards throw at import time.
 */
export default defineConfig({
  entry: {
    index: "src/index.ts",
    kernel: "src/kernel.ts",
    dom: "src/dom.ts",
    react: "src/react.ts",
    r3f: "src/r3f.ts",
    ground: "src/ground.ts",
    devtools: "src/devtools.ts",
  },
  format: ["esm"],
  splitting: true,
  /* Types are emitted separately by `tsc -p tsconfig.dts.json` (tree-style
     declarations under dist/types, structure preserved) — tsup's dts bundler
     cannot follow cross-package source re-exports. */
  dts: false,
  sourcemap: true,
  clean: true,
  target: "es2022",
  /* bundle the workspace packages in… */
  noExternal: [/^@ice\//],
  /* …and leave real dependencies/peers to the consumer's node_modules. */
  external: [
    /^@vibecook\/strata-ecs(\/|$)/,
    /^loro-crdt(\/|$)/,
    /^rbush(\/|$)/,
    /^react(\/|$)/,
    /^react-dom(\/|$)/,
    /^three(\/|$)/,
    /^@react-three\//,
    /^stats-gl(\/|$)/, // GL profiling GPU timer — dynamic-imported by the r3f entry
  ],
});
