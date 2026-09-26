/**
 * The import walls (design-002 §6). One direction only:
 *   kernel ← core ← dom ← react ← r3f          devtools → core (+kernel)
 * kernel imports NOTHING. core never touches react/dom/three.
 * Violations are CI failures, not warnings — v1 had no wall to stop at.
 *
 * Each package rule is a POSITIVE ALLOWLIST: `to.pathNot` enumerates the ONLY
 * targets a package's `src` may import; anything else — a stray npm package, a
 * Node builtin, a higher layer — is a violation. Blocklists alone (list the
 * known-bad targets) let unknown deps slip through (review B2); allowlists
 * close that. `from` binds on `src` only, so test/ files (vitest, fixtures)
 * are exempt.
 *
 * Path forms these matchers must accept:
 *  - own + cross-package: `@ice/*` imports resolve via tsconfig `paths` to
 *    `packages/<pkg>/src/index.ts`, so `^packages/<pkg>` covers a whole package.
 *  - node_modules: pnpm resolves through its virtual store, but the real path
 *    (`node_modules/.pnpm/<pkg>@ver/node_modules/<pkg>/…`) always ends in the
 *    substring `node_modules/<pkg>/`, so an UNANCHORED `nm()` matches both it
 *    and the hoisted `node_modules/<pkg>` symlink. Kept repetition-free (no
 *    `[^/]+` inside an optional group) because dependency-cruiser rejects
 *    nested-quantifier regexes as unsafe. The `(/|$)` boundary keeps `react`
 *    from also matching `react-dom`, etc.
 */
const nm = (pkg) => `node_modules/${pkg}(/|$)`;

module.exports = {
  forbidden: [
    {
      name: "no-circular",
      // `viaOnly` keeps this rule on RUNTIME cycles, which is the only kind it
      // ever caught: before `tsPreCompilationDeps` (design-013 C4, 2026-09-08)
      // a type-only import was invisible to the cruiser, so every cycle it
      // reported closed through real, emitted edges. Turning type edges on to
      // seal `three-only-in-r3f` also made 21 TYPE-ONLY cycles visible in core
      // and react (`behavior/types.ts` ⇄ `guards/guarded-tx.ts` is the shape:
      // both sides `import type`). Those are erased by `tsc` — no emitted
      // require, no initialisation order to get wrong — so reporting them would
      // change what this rule means, not what the code does. A cycle with even
      // ONE runtime edge still fails.
      severity: "error",
      from: {},
      to: { circular: true, viaOnly: { dependencyTypesNot: ["type-only"] } },
    },
    {
      name: "kernel-imports-nothing",
      comment:
        "design-002 §6: kernel is pure math — plain structs in/out. Sole exception: rbush (zero-dep R-tree).",
      severity: "error",
      from: { path: "^packages/kernel/src" },
      to: { pathNot: ["^packages/kernel/src", nm("rbush")] },
    },
    {
      name: "core-only-kernel-strata",
      comment:
        "design-002 §6: core is headless — kernel + strata-ecs only, never react/dom/three or a stray dep. " +
        "Named exception (design-005 §6.1, M5): loro-crdt — strata's own optional peer; the engine doc kit " +
        "is 'the ONE place a LoroDoc enters' now that doc creation is engine-owned.",
      severity: "error",
      from: { path: "^packages/core/src" },
      to: {
        pathNot: [
          "^packages/core/src",
          "^packages/kernel",
          nm("@vibecook/strata-ecs"),
          nm("loro-crdt"),
          // Subpath exports ("@vibecook/strata-ecs/durable") resolve through the
          // package "exports" map, which the cruiser reports by SPECIFIER — allow
          // the specifier form alongside the resolved node_modules path.
          "^@vibecook/strata-ecs(/|$)",
        ],
      },
    },
    {
      name: "dom-only-core-kernel",
      comment: "design-002 §6: dom sits on core — core + kernel only, never react/three/higher layers.",
      severity: "error",
      from: { path: "^packages/dom/src" },
      to: { pathNot: ["^packages/dom/src", "^packages/core", "^packages/kernel"] },
    },
    {
      name: "react-only-dom-core-kernel-react",
      comment:
        "design-002 §6: react layers on dom — dom/core/kernel + react/react-dom peers " +
        "(jsx-runtime + createPortal: portals-from-one-root IS the package, design-004 §2), never three/r3f.",
      severity: "error",
      from: { path: "^packages/react/src" },
      to: {
        pathNot: [
          "^packages/react/src",
          "^packages/dom",
          "^packages/core",
          "^packages/kernel",
          nm("react"),
          nm("react-dom"),
        ],
      },
    },
    {
      name: "r3f-top-of-chain",
      comment:
        "design-002 §6: r3f is the top — react/dom/core/kernel + peers react|three|@react-three " +
        "+ stats-gl (2026-07-13: the GL profiling seam's GPU-timer dep, dynamic-imported), nothing above. " +
        "Note what the design-012 S5 addition below does NOT open: r3f still may not import ground. " +
        "Islands reach the unified compositor through core's CompositorSourceRegistry, which is the " +
        "whole reason that seam lives in core.",
      severity: "error",
      from: { path: "^packages/r3f/src" },
      to: {
        pathNot: [
          "^packages/r3f/src",
          "^packages/react",
          "^packages/dom",
          "^packages/core",
          "^packages/kernel",
          nm("react"),
          nm("three"),
          nm("@react-three"),
          nm("stats-gl"),
          "^stats-gl(/|$)", // dynamic import reports by specifier (the strata-subpath precedent)
          // design-012 S5: `three/webgpu` (the WebGPURenderer incantation) resolves
          // through three's exports map, which the cruiser reports by SPECIFIER
          // rather than by node_modules path — the same allowance ground already
          // carries. Confined to ONE file, src/webgpu/island-renderer.ts, behind
          // the `@ice/r3f/webgpu` subpath, so a stratified app never pulls three's
          // node material system (its `sideEffects: ["./src/nodes/**"]` makes that
          // import survive tree-shaking).
          "^three(/|$)",
        ],
      },
    },
    {
      name: "ground-only-core-kernel",
      comment:
        "design-002 §6 (amended 2026-07-16, the @ice/ground extraction; three struck out at " +
        "design-013 C3, 2026-09-07): the P0 ground layer draws in RAW WebGPU — core + kernel " +
        "ONLY. C2 deleted the three-based stratified leg (the WebGPURenderer, TSL, the pass " +
        "registry, the programs) and C3 struck the `three` allowance this rule carried for it, " +
        "along with the package's `three` peer and dev deps. Off the react chain: react must " +
        "NOT import ground (its own allowlist enforces that); apps inject the layer through the " +
        "InfiniteCanvas `ground` factory prop or register its reflector directly.",
      severity: "error",
      from: { path: "^packages/ground/src" },
      to: { pathNot: ["^packages/ground/src", "^packages/core", "^packages/kernel"] },
    },
    {
      name: "devtools-only-core-kernel-strata",
      comment:
        "design-002 §6 (amended 2026-07-13): devtools reads core + kernel and WRAPS " +
        "@vibecook/strata-ecs/tools (observer panel + profiler — the standing rule is wrap " +
        "first-party tools, never re-implement); it sits off the chain, imported by no one.",
      severity: "error",
      from: { path: "^packages/devtools/src" },
      to: {
        pathNot: [
          "^packages/devtools/src",
          "^packages/core",
          "^packages/kernel",
          nm("@vibecook/strata-ecs"),
          // Subpath exports ("@vibecook/strata-ecs/tools") resolve through the
          // package "exports" map, reported by SPECIFIER (the core rule's precedent).
          "^@vibecook/strata-ecs(/|$)",
        ],
      },
    },
    {
      name: "nobody-imports-devtools",
      comment: "design-002 §6: devtools is a leaf — no engine package may depend on it.",
      severity: "error",
      from: { path: "^packages/(kernel|core|dom|react|r3f|ground)/src" },
      to: { path: "^packages/devtools" },
    },
    {
      name: "no-cross-profile-imports",
      comment:
        "design-012 §3: the composited and stratified presentation profiles are ALTERNATIVES, " +
        "selected by an app's build wiring (the design-010 idiom — the unselected one is excluded " +
        "from that app's graph). An import edge between them would put both in every bundle and " +
        "turn a build-time selection into dead weight. They share vocabulary through " +
        "profiles/contract.ts, never through each other.",
      severity: "error",
      from: { path: "^packages/react/src/profiles/composited" },
      to: { path: "^packages/react/src/profiles/stratified" },
    },
    {
      name: "no-cross-profile-imports-reverse",
      comment: "The other direction of no-cross-profile-imports; see that rule.",
      severity: "error",
      from: { path: "^packages/react/src/profiles/stratified" },
      to: { path: "^packages/react/src/profiles/composited" },
    },
    {
      name: "hic-symbols-live-in-the-adapter",
      comment:
        "design-012 §8 gates 1+6: HTML-in-Canvas is an origin trial that has been renamed once " +
        "and ends at M154. Everything HiC-touching sits behind ONE adapter module, so it dies in " +
        "one place. No module may import ground's internals to reach around it.",
      severity: "error",
      // `from` binds on src dirs only — the file header's standing convention,
      // which keeps ground's OWN test/ files (which must import the adapter to
      // test it) out of every rule.
      from: { path: "^packages/[^/]+/src", pathNot: "^packages/ground/src" },
      to: { path: "^packages/ground/src/hic-adapter" },
    },
    {
      name: "nobody-imports-ground",
      comment:
        "design-002 §6 (2026-07-16): ground is a leaf like devtools — apps consume it directly; " +
        "no engine package may depend on it (react receives its layer as an OPAQUE factory prop).",
      severity: "error",
      from: { path: "^packages/(kernel|core|dom|react|r3f|devtools)/src" },
      to: { path: "^packages/ground" },
    },
    {
      name: "desk-only-core-kernel",
      comment:
        "design-015 §3 (D1, 2026-09-25): the desk draws in RAW WebGPU on its own engine " +
        "(vibe-field/draft/ground's prototype, moved) — core + kernel ONLY, the ground's wall. D1 " +
        "imported neither: the engine, the mat, nav, the mini mat and the objects are self-contained; " +
        "the world arrived at D2a-world (the kinds' world halves, `defineObject` over core's " +
        "`defineWidget`, the builder and the pick source over the world — src/compose, src/objects). " +
        "`from` binds on src, so the Node oracle and the tests are exempt (they import `webgpu`, " +
        "`vitest` and `node:*`).",
      severity: "error",
      from: { path: "^packages/desk/src" },
      to: { pathNot: ["^packages/desk/src", "^packages/core", "^packages/kernel"] },
    },
    {
      name: "nobody-imports-desk",
      comment:
        "design-015 D1: nothing imports @ice/desk yet — apps consume it directly (apps/desk). The " +
        "react host (`<Desk>`) and the umbrella's /desk entries are D2's to open, by amending this " +
        "rule. Both path forms: a resolved import lands in packages/desk; an unresolved one (no " +
        "workspace dependency declared) is reported by SPECIFIER.",
      severity: "error",
      from: { path: "^packages/(kernel|core|dom|react|r3f|devtools|ice)/src" },
      to: { path: ["^packages/desk/", "^@ice/desk(/|$)"] },
    },
    {
      name: "ground-never-imports-desk",
      comment:
        "design-015 plan D-D0.3: @ice/desk is born BESIDE @ice/ground and the two never import " +
        "each other until D5 deletes the old leg — from anywhere in the package (src, tests, " +
        "oracle, tools), not only src: the two legs share no code, only the laws the oracle pins.",
      severity: "error",
      from: { path: "^packages/ground/" },
      to: { path: ["^packages/desk/", "^@ice/desk(/|$)"] },
    },
    {
      name: "desk-never-imports-ground",
      comment: "The other direction of ground-never-imports-desk (D-D0.3); see that rule.",
      severity: "error",
      from: { path: "^packages/desk/" },
      to: { path: ["^packages/ground/", "^@ice/ground(/|$)"] },
    },
    {
      name: "three-only-in-r3f",
      comment:
        "design-013 §8 Phase C (D-C3.1, 2026-09-07): `three` left @ice/ground with the " +
        "stratified leg's renderer, so `packages/r3f` is the ONLY package that may name it — " +
        "the GL islands and their WebGPU renderer are what the published `three` peer is FOR, " +
        "and the peer stays declared (optional) for exactly them. Belt and braces over the " +
        "per-package allowlists above: it also binds on `packages/ice/src`, the publish " +
        "bundle's entry modules, which have no allowlist of their own — so a three edge cannot " +
        "re-enter the graph through the umbrella. BOTH path forms are listed because the " +
        "cruiser reports a bare `three` by its resolved node_modules path and an exports-map " +
        "subpath (`three/webgpu`, `three/tsl`) by SPECIFIER; either alone leaves half the door " +
        "open (the probe that proved it: a temporary `import \"three\"` in ground's theme.ts).",
      severity: "error",
      from: { path: "^packages/(kernel|core|dom|react|ground|devtools|ice)/src" },
      to: { path: ["^three(/|$)", nm("three")] },
    },
    // The two Phase-B/C leg walls (`ground-compose-imports-no-old-leg` and its reverse) left with
    // the old stratified leg at design-013 C2 (2026-09-07): `packages/ground/src` is ONE leg now —
    // the barrel (`index.ts`) is the engine's stratified face and imports from `compose/`; the
    // paths the walls named (`passes`, `programs`, `program-host`, `renderer`, `layer`, `pass`,
    // `poles`) no longer exist, so a wall between them would bind on nothing.
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // THIS REPO'S BUILD OUTPUT IS NOT SOURCE. `depcruise packages` walks the
    // directory, so `packages/ice/dist` joined the graph whenever anything had
    // built it — the module count swung 483 (clean tree) to 778 (after a
    // build), which is why two sessions reported different numbers for the same
    // commit. Harmless while type edges were invisible; with
    // `tsPreCompilationDeps` below, the `.d.ts` barrel cycles tsc emits BY
    // DESIGN became 9 `no-circular` errors, so `pnpm run ci` went red purely
    // because `pnpm run gate:landing` (or a publish, or `pnpm run build`) had
    // run first. Every rule binds on `packages/*/src`; nothing wants the emitted
    // tree. Excluding it makes the cruise hermetic — the same answer before and
    // after a build.
    //
    // ANCHORED AT `packages/` ON PURPOSE. A bare `(^|/)dist/` also swallows a
    // DEPENDENCY's own dist (strata-ecs, vitest, fiber, stats-gl, tsup — five
    // modules), and an excluded target takes its edges with it: an import of
    // `some-pkg/dist/thing` would stop being a wall violation and start being
    // invisible. The allowlists work by seeing the node_modules target, so it
    // must stay in the graph.
    exclude: { path: "^packages/[^/]+/dist/" },
    tsConfig: { fileName: "tsconfig.base.json" },
    // A `import type { X } from "three"` is an EDGE (design-013 C4, D-C4.11).
    // Without this the cruiser walks the emitted JS, where a type-only import is
    // erased — so `three-only-in-r3f` could not see one, and the wall stood only
    // because `@types/three` happens to be absent from every walled package's
    // node_modules. That is a resolution accident, not a wall. The probe that
    // proved it: a temporary `import type { Vector3 } from "three"` in ground's
    // theme.ts passes without this flag and is a violation with it.
    tsPreCompilationDeps: true,
  },
};
