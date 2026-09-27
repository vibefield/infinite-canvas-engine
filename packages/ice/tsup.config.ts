import { defineConfig } from "tsup";

/**
 * The publish bundle: one npm package (`@vibecook/ice`) with subpath exports,
 * built from the seven workspace packages. `splitting: true` is load-bearing —
 * the workspace code (catalog registrations, tool/prefab registries, HMR boot
 * kit, the desk's kind registry) must exist ONCE as shared chunks, not be
 * duplicated per entry, or duplicate-definition guards throw at import time.
 *
 * design-015 §3 (D5b): the entries are `.` · `/kernel` · `/dom` · `/desk` ·
 * `/desk/engine` · `/desk/objects` · `/react` · `/devtools`; design-016 §5 (K4a)
 * adds `/desk/kit` (the render kit a kind is written against). `./r3f`,
 * `./r3f/webgpu` and the four `./ground*` entries left with their packages, and
 * with them the `three`, `@react-three` and `stats-gl` externals: the whole
 * graph is three-free (`tools/audit-pack.mjs` measures it).
 */
export default defineConfig({
  entry: {
    index: "src/index.ts",
    kernel: "src/kernel.ts",
    dom: "src/dom.ts",
    desk: "src/desk.ts",
    "desk-engine": "src/desk-engine.ts",
    "desk-objects": "src/desk-objects.ts",
    "desk-kit": "src/desk-kit.ts",
    react: "src/react.ts",
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
  external: [/^@vibecook\/strata-ecs(\/|$)/, /^loro-crdt(\/|$)/, /^rbush(\/|$)/, /^react(\/|$)/, /^react-dom(\/|$)/],
});
