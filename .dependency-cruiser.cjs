/**
 * The import walls (design-002 §6; reshaped at design-015 §3, D5b). One direction only:
 *   kernel ← core ← dom ← react     desk → core (+kernel)     objects → desk's entries, core, kernel     devtools → core (+kernel)
 * kernel imports NOTHING. core never touches react/dom/three. Nobody imports desk but apps and objects
 * (and the umbrella's entries); nobody imports objects but apps (and the umbrella's entry); the desk never
 * imports objects; nobody imports devtools. three is imported NOWHERE.
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
 *
 * GONE at design-015 D5b, with the packages and seams they bound: `r3f-top-of-chain`,
 * `ground-only-core-kernel`, `nobody-imports-ground`, `ground-never-imports-desk` and its
 * reverse (D-D0.3's two legs, one deleted), `hic-symbols-live-in-the-adapter`,
 * `no-cross-profile-imports` and its reverse. `three-only-in-r3f` became `no-three`.
 */
const nm = (pkg) => `node_modules/${pkg}(/|$)`;

/**
 * THE REFERENCE KINDS' PACKAGE (design-016 §5, K4b): `@ice/objects`, ONE FOLDER PER KIND — its world half and its pass
 * (`<k>/kind.ts` and the kind's modules), its object (`<k>/object.ts`, `defineObject`), what its object alone uses (the note's
 * typing, the board's pen, the print's carry, the calendar's hand and writing, the notebook's leaves) and its DOM half
 * (`<k>/host/` — the note's editor, the calendar's input and print raster). Its WGSL (`packages/objects/shaders/<k>/`) is read by
 * name, not imported: test/kit-wgsl.test.ts holds a kind's programs to its own files and the kit's. The package's own shared
 * modules — the barrel, the kinds' registry (`kinds.ts`), the preset and the palette that list them all, the shader text — are
 * no kind's. (K4a's `KIND_FILES` named a kind's files where the desk's layout spread them; K4b moved each set into its folder.)
 */
const OBJECTS = "^packages/objects/src/";
const KINDS = ["paper", "minimat", "board", "photo", "calendar", "notebook"];
const kindDir = (k) => `${OBJECTS}${k}/`;

module.exports = {
  forbidden: [
    {
      name: "no-circular",
      // `viaOnly` keeps this rule on RUNTIME cycles, which is the only kind it
      // ever caught: before `tsPreCompilationDeps` (design-013 C4, 2026-09-08)
      // a type-only import was invisible to the cruiser, so every cycle it
      // reported closed through real, emitted edges. Turning type edges on to
      // seal the three wall also made 21 TYPE-ONLY cycles visible in core and
      // react (`behavior/types.ts` ⇄ `guards/guarded-tx.ts` is the shape: both
      // sides `import type`). Those are erased by `tsc` — no emitted require,
      // no initialisation order to get wrong — so reporting them would change
      // what this rule means, not what the code does. A cycle with even ONE
      // runtime edge still fails.
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
      comment:
        "design-002 §6, design-015 §3: dom is SCREEN SPACE on core — core + kernel only, never " +
        "react/three/desk/higher layers. The desk reaches its host as an OPAQUE layer factory " +
        "(`createDeskHost`), typed structurally here.",
      severity: "error",
      from: { path: "^packages/dom/src" },
      to: { pathNot: ["^packages/dom/src", "^packages/core", "^packages/kernel"] },
    },
    {
      name: "react-only-dom-core-kernel-react",
      comment:
        "design-002 §6, design-015 §3: react layers on dom — dom/core/kernel + react/react-dom peers " +
        "(jsx-runtime for the screen-space chrome), never three/desk. `<Desk>` wraps dom's " +
        "`createDeskHost` and receives the desk as an opaque layer factory.",
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
      name: "desk-only-core-kernel",
      comment:
        "design-015 §3 (D1, 2026-09-25): the desk draws in RAW WebGPU on its own engine " +
        "(vibe-field/draft/ground's prototype, moved) — core + kernel ONLY, the ground's old wall. " +
        "`from` binds on src, so the Node oracle and the tests are exempt (they import `webgpu`, " +
        "`vitest` and `node:*`).",
      severity: "error",
      from: { path: "^packages/desk/src" },
      to: { pathNot: ["^packages/desk/src", "^packages/core", "^packages/kernel"] },
    },
    {
      name: "desk-dom-free",
      comment:
        "design-015 §3 `desk-dom-free`: `desk/src/*` may touch the DOM only under `desk/src/host/` " +
        "(the canvas, the editor element, font loading, Canvas2D rasters, image decode), so the Node " +
        "oracle imports everything else whole. The import-graph half of the wall: nothing under " +
        "desk/src outside host/ may import host/ (the DOM half is a LEAF the composition root and the " +
        "world half never reach) — except the package's root barrel, `src/index.ts`, which is the " +
        "published door and re-exports both halves. The API half — no `document`/`window`/`navigator` " +
        "outside host/ — is `packages/desk/test/dom-free.test.ts`, the grep a cruiser cannot be.",
      severity: "error",
      from: { path: "^packages/desk/src", pathNot: ["^packages/desk/src/host/", "^packages/desk/src/index\\.ts$"] },
      to: { path: "^packages/desk/src/host/" },
    },
    {
      name: "desk-never-imports-objects",
      comment:
        "design-016 §5 (K4b; design-011:863 — the ground MUST NOT import a barrel of all built-ins): the desk — the engine, the " +
        "seam, the kit, the contract — never imports the reference kinds, not a module, not a type, so a plugin kind and a built-in " +
        "stand on the same desk. Nothing in the desk package does: not its units (a desk unit that drives a built-in is an objects " +
        "unit), not its tools (the oracle left with the kinds it draws). With the kinds in their " +
        "own package this one rule is what `desk-engine-never-imports-objects`, `desk-seam-never-imports-a-kind` (and its four " +
        "fenced exceptions, retired at K4b's second step) and `the-kit-imports-no-kind` were. Both path forms: a relative climb " +
        "resolves into packages/objects; a package import is reported by SPECIFIER.",
      severity: "error",
      from: { path: "^packages/desk/" },
      to: { path: ["^packages/objects/", "^@ice/objects(/|$)"] },
    },
    {
      name: "objects-imports-only-the-sdk",
      comment:
        "design-016 §5 · K-L1 (K4b): the six built-ins compile against the desk's PUBLIC entries alone — `@ice/desk` (the contract: " +
        "`defineObject`, `ObjectKind`, `KindProgram`, the theme, the typing docs, the shader text), `@ice/desk/kit`, " +
        "`@ice/desk/engine` — and core's and kernel's entries, exactly as a plugin kind does. A POSITIVE allowlist: a desk source " +
        "path (a relative climb resolves into packages/desk), another entry (`@ice/desk/oracle/*`), a package's inner module, an " +
        "npm package or a Node builtin is a violation; type-only edges count (a type a kind names from a private module is a word a " +
        "plugin cannot write). The desk's entries are reported by SPECIFIER (resolved through node_modules), core's and kernel's " +
        "through tsconfig paths to their index.",
      severity: "error",
      from: { path: OBJECTS },
      to: { pathNot: [OBJECTS, "^packages/(core|kernel)/src/index\\.ts$", "^@ice/desk$", "^@ice/desk/(kit|engine)$"] },
    },
    // K-L1's second half, one rule per kind (one name): a kind's folder imports no other kind's — not a module, not a type
    ...KINDS.map((k) => ({
      name: "no-kind-imports-a-kind",
      comment:
        `design-016 K-L1 (K4a; by folder since K4b): the ${k} kind's folder imports none of the other five's (a kind names another ` +
        "only by its registry name, which core or the host resolves at run time: test/kind-names.test.ts); what two kinds share is the kit's.",
      severity: "error",
      from: { path: kindDir(k) },
      to: { path: KINDS.filter((o) => o !== k).map(kindDir) },
    })),
    {
      name: "objects-dom-half-is-its-objects",
      comment:
        "design-016 §5 · K-L2 (K4b): the objects are DOM-free but each kind's DOM half — its `host/` folder (the note's editor, the " +
        "calendar's input and print raster) — and that half is reached only by its OBJECT's declaration (`defineObject({ host })`, " +
        "`<k>/object.ts`) and the package's barrel: never by a world half, a pass or the registry, so the Node oracle imports every " +
        "world half whole and the desk layer builds what the objects declare. The API half — no document/window/navigator outside " +
        "a `host/` folder — is packages/objects/test/dom-free.test.ts, the grep a cruiser cannot be.",
      severity: "error",
      from: { path: OBJECTS, pathNot: [`${OBJECTS}[^/]+/host/`, `${OBJECTS}[^/]+/object\\.ts$`, `${OBJECTS}index\\.ts$`] },
      to: { path: `${OBJECTS}[^/]+/host/` },
    },
    {
      name: "examples-import-only-the-published-entries",
      comment:
        "design-016 K8b · K-L1/K-L2: a worked plugin package (examples/*) is written the way an OUTSIDE plugin is — its shipped " +
        "modules (src/, oracle/) import ICE through the umbrella's PUBLISHED entries alone (`@vibecook/ice`, `/kernel`, `/dom`, " +
        "`/desk`, `/desk/engine`, `/desk/kit`, `/react`, `/devtools` — tsconfig.base.json maps each to its source entry under " +
        "packages/ice/src, so a published specifier resolves THERE) and never the reference kinds (`/desk/objects`: no kind imports " +
        "a kind). A workspace name (`@ice/desk` resolves into packages/desk), a path into packages/, an npm package or a Node builtin " +
        "is a violation; type-only edges count. The unit test that holds the same wall per specifier is " +
        "examples/desk-clock/test/imports.test.ts.",
      severity: "error",
      from: { path: "^examples/[^/]+/(src|oracle)/" },
      to: { pathNot: ["^examples/[^/]+/(src|oracle)/", "^packages/ice/src/(index|kernel|dom|desk|desk-engine|desk-kit|react|devtools)\\.ts$"] },
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
      from: { path: "^packages/(kernel|core|dom|react|desk|objects)/src" },
      to: { path: "^packages/devtools" },
    },
    {
      name: "nobody-imports-desk",
      comment:
        "design-015 §3: nobody imports `desk` but apps (today's `nobody-imports-ground`) — the React " +
        "host and the vanilla host receive the desk as an opaque LAYER FACTORY (`deskLayer({ … })`), " +
        "exactly as `<InfiniteCanvas ground={groundCompose(…)}>` received the ground. The react package " +
        "stays renderer-free; the walls stay a chain (dom → react) with desk beside it. The umbrella's " +
        "entries (`packages/ice/src`) re-export it and are the one exception. Both path forms: a " +
        "resolved import lands in packages/desk; an unresolved one is reported by SPECIFIER.",
      severity: "error",
      from: { path: "^packages/(kernel|core|dom|react|devtools)/src" },
      to: { path: ["^packages/desk/", "^@ice/desk(/|$)"] },
    },
    {
      name: "nobody-imports-objects",
      comment:
        "design-016 §5 (K4b): the reference kinds are what an APP registers — nobody imports `@ice/objects` but apps (and the " +
        "umbrella's entry, `packages/ice/src/desk-objects.ts`, which re-exports it as `@vibecook/ice/desk/objects`). The engine's " +
        "packages below it never name a built-in (the desk's own rule is `desk-never-imports-objects`). Both path forms.",
      severity: "error",
      from: { path: "^packages/(kernel|core|dom|react|devtools)/(src|test)/" },
      to: { path: ["^packages/objects/", "^@ice/objects(/|$)"] },
    },
    {
      name: "no-three",
      comment:
        "design-015 §3 (D5b): `three` is imported NOWHERE. Until D5b `three-only-in-r3f` let " +
        "`packages/r3f` name it for the GL islands; the islands, their WebGPU renderer, the `three` " +
        "peer and the `stats-gl` dependency left together (a 3D object is an object kind with its own " +
        "pass — the notebook is one). Binds on every package's `src`, the umbrella's entry modules " +
        "included, so a three edge cannot re-enter the graph through a publish entry. BOTH path forms " +
        "are listed because the cruiser reports a bare `three` by its resolved node_modules path and an " +
        "exports-map subpath (`three/webgpu`, `three/tsl`) by SPECIFIER; either alone leaves half the " +
        "door open (the probe that proved it: a temporary `import \"three\"` in ground's theme.ts). " +
        "`@react-three` and `stats-gl` ride the same rule.",
      severity: "error",
      // …and every app's modules too (D7: `depcruise` walks apps/ since the fix wave; an app is a consumer, and three is
      // imported NOWHERE)
      from: { path: ["^packages/(kernel|core|dom|react|desk|objects|devtools|ice)/src", "^apps/", "^examples/"] },
      to: { path: ["^three(/|$)", nm("three"), "^@react-three/", nm("@react-three"), "^stats-gl(/|$)", nm("stats-gl")] },
    },
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
    // DEPENDENCY's own dist (strata-ecs, vitest, tsup — modules the allowlists
    // must SEE), and an excluded target takes its edges with it: an import of
    // `some-pkg/dist/thing` would stop being a wall violation and start being
    // invisible. The allowlists work by seeing the node_modules target, so it
    // must stay in the graph.
    exclude: { path: ["^packages/[^/]+/dist/", "^apps/[^/]+/(dist|results)/"] },
    tsConfig: { fileName: "tsconfig.base.json" },
    // A `import type { X } from "three"` is an EDGE (design-013 C4, D-C4.11).
    // Without this the cruiser walks the emitted JS, where a type-only import is
    // erased — so `no-three` could not see one, and the wall stood only because
    // `@types/three` happens to be absent from every walled package's
    // node_modules. That is a resolution accident, not a wall. The probe that
    // proved it: a temporary `import type { Vector3 } from "three"` in ground's
    // theme.ts passed without this flag and was a violation with it.
    tsPreCompilationDeps: true,
  },
};
