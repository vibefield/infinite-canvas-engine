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
        "+ stats-gl (2026-07-13: the GL profiling seam's GPU-timer dep, dynamic-imported), nothing above.",
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
