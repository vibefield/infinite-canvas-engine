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
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
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
      name: "ground-only-core-kernel-three",
      comment:
        "design-002 §6 (amended 2026-07-16, the @ice/ground extraction): the P0 ground layer " +
        "renders with three's WebGPURenderer + TSL — core + kernel + three ONLY (never react/" +
        "@react-three or a stray dep). Off the react chain: react must NOT import ground (its own " +
        "allowlist enforces that); apps inject the layer through the InfiniteCanvas `ground` " +
        "factory prop or register its reflector directly.",
      severity: "error",
      from: { path: "^packages/ground/src" },
      to: {
        pathNot: [
          "^packages/ground/src",
          "^packages/core",
          "^packages/kernel",
          nm("three"),
          // "three/webgpu" and "three/tsl" resolve through the package exports
          // map, which the cruiser reports by SPECIFIER (the strata-subpath
          // precedent) — allow the specifier form alongside node_modules paths.
          "^three(/|$)",
        ],
      },
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
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.base.json" },
  },
};
