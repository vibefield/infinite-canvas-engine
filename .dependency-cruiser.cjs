/**
 * The import walls (design-002 §6; reshaped at design-015 §3, D5b). One direction only:
 *   kernel ← core ← dom ← react          desk → core (+kernel)       devtools → core (+kernel)
 * kernel imports NOTHING. core never touches react/dom/three. Nobody imports desk but apps
 * (and the umbrella's entries); nobody imports devtools. three is imported NOWHERE.
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
 * A KIND'S FILES (K4a, design-016 §5 · K-L1), by path — the six reference kinds are one package's worth of code each, spread
 * where the desk's layout puts them: its folder (`src/<k>/`), its registry adapter (`kinds/<k>.ts`), its object-side files
 * (`objects/<k>.ts` and what its object alone uses — the note's typing, the board's pen, the print's carry, the calendar's hand
 * and writing, the notebook's leaves) and its DOM half (`host/…` — the note's editor and ink raster, the calendar's input and
 * print raster, the print's picture decode; `desk-dom-free` keeps those under host/, so no layout makes a kind one folder).
 * Its WGSL (`shaders/<k>/`) is read by name, not imported: test/kit-wgsl.test.ts holds a kind's programs to its own files and
 * the kit's. NOT a kind's: the barrels and the preset that list them all (kinds/index.ts, objects/index.ts, objects/preset.ts,
 * objects/palette.ts), the contract, the kit, the seam.
 */
const DESK = "^packages/desk/src/";
const KIND_FILES = {
  paper: ["paper/", "kinds/paper\\.ts$", "objects/(note|typing)\\.ts$", "host/(editor|ink)\\.ts$"],
  minimat: ["minimat/", "kinds/minimat\\.ts$", "objects/minimat\\.ts$"],
  board: ["board/", "kinds/board\\.ts$", "objects/(board|pen)\\.ts$"],
  photo: ["photo/", "kinds/photo\\.ts$", "objects/(photo|carry)\\.ts$", "host/picture\\.ts$"],
  calendar: ["calendar/", "kinds/calendar\\.ts$", "objects/(calendar|calendar-hand|calendar-writing)\\.ts$", "host/(calendar-input|print)\\.ts$"],
  notebook: ["notebook/", "kinds/notebook\\.ts$", "objects/(notebook|leaf)\\.ts$"],
};
const kindFiles = (k) => KIND_FILES[k].map((p) => DESK + p);
const ALL_KIND_FILES = Object.keys(KIND_FILES).flatMap(kindFiles);
/**
 * THE SDK a kind is written against, inside the desk (K4a): the render kit (`kit/` — `@ice/desk/kit`), the engine (`engine/` —
 * `@ice/desk/engine`) and the contract's modules (`kind.ts`, `kinds/world.ts`, `object.ts`, the engine's theme, the typing docs,
 * the shader text — `@ice/desk`). Outside it: core's and kernel's public entries alone.
 */
const KIND_SDK = [DESK + "kit/", DESK + "engine/", DESK + "(kind|object|theme|docs|shaders)\\.ts$", DESK + "kinds/world\\.ts$"];

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
      name: "desk-engine-never-imports-objects",
      comment:
        "design-015 §3 (the design-014 seam test): `desk/engine` is what every desk needs and depends " +
        "on world facts; a KIND is a look plus its behaviours and plugs in through `defineObject` " +
        "exactly as a third-party kind will. The engine may not know the reference kinds.",
      severity: "error",
      from: { path: "^packages/desk/src/engine/" },
      to: { path: "^packages/desk/src/objects/" },
    },
    {
      name: "desk-seam-never-imports-a-kind",
      comment:
        "design-015 §3 + D7 #5 (D-D7-A.3): the desk's SEAM — the composition (compose/), the host (host/), the hold and the " +
        "marks — wires kinds only through what a kind DECLARES in `defineObject` (its kind, its local, its drivers) and never " +
        "names one, so a third-party kind plugs in by declaring, exactly as the reference kinds do. Nothing under " +
        "compose|host|hold|marks imports a reference kind's module — objects/*, kinds/<kind>.ts or a kind's own folder — at " +
        "runtime (a type is a word, not a wire: type-only edges pass). Three named exceptions carry their own rules below: " +
        "host/editor.ts (the note's DOM half — the desk's ONE focused editor; DOM lives only under host/, so it cannot live " +
        "with its kind), host/calendar-input.ts (the calendar's DOM half, the same reason) and compose/builder.ts (the mini mat " +
        "is the frame's kind: the builder nests frames through its insides). The debt behind the two DOM exceptions is a " +
        "kind-declared input lease.",
      severity: "error",
      from: {
        path: "^packages/desk/src/(compose|host|hold|marks)/",
        pathNot: ["^packages/desk/src/host/(editor|calendar-input|print)\\.ts$", "^packages/desk/src/compose/builder\\.ts$"],
      },
      to: {
        path: [
          "^packages/desk/src/objects/",
          "^packages/desk/src/(paper|board|notebook|calendar|photo|minimat)/",
          "^packages/desk/src/kinds/(paper|board|notebook|calendar|photo|minimat)\\.ts$",
        ],
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "desk-seam-builder-nests-only-the-mini-mat",
      comment: "D-D7-A.3's first exception, bounded: the builder may reach the mini mat's insides (the frame's own kind) and no other kind.",
      severity: "error",
      from: { path: "^packages/desk/src/compose/builder\\.ts$" },
      to: {
        path: [
          "^packages/desk/src/objects/",
          "^packages/desk/src/(paper|board|notebook|calendar|photo)/",
          "^packages/desk/src/kinds/(paper|board|notebook|calendar|photo)\\.ts$",
        ],
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "desk-seam-editor-is-the-notes-dom-half",
      comment: "D-D7-A.3's second exception, bounded: the ONE focused editor is the note's DOM half and may reach the note's driver and the paper's writing — no other kind.",
      severity: "error",
      from: { path: "^packages/desk/src/host/editor\\.ts$" },
      to: {
        path: [
          "^packages/desk/src/objects/(?!note\\.ts$|typing\\.ts$|index\\.ts$)",
          "^packages/desk/src/(board|notebook|calendar|photo|minimat)/",
          "^packages/desk/src/kinds/(board|notebook|calendar|photo|minimat)\\.ts$",
        ],
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "desk-seam-print-is-the-calendars-raster-half",
      comment: "D-D7-A.3's fourth exception, bounded: the calendar's print is rasterised with Canvas2D, which lives only under host/ — host/print.ts may reach the calendar's print and tiles and no other kind.",
      severity: "error",
      from: { path: "^packages/desk/src/host/print\\.ts$" },
      to: {
        path: [
          "^packages/desk/src/objects/",
          "^packages/desk/src/(paper|board|notebook|photo|minimat)/",
          "^packages/desk/src/kinds/(paper|board|notebook|calendar|photo|minimat)\\.ts$",
        ],
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "desk-seam-calendar-input-is-the-calendars-dom-half",
      comment: "D-D7-A.3's third exception, bounded: the calendar's DOM half may reach the calendar's driver, its data and its kind — no other kind.",
      severity: "error",
      from: { path: "^packages/desk/src/host/calendar-input\\.ts$" },
      to: {
        path: [
          "^packages/desk/src/objects/(?!calendar\\.ts$|calendar-writing\\.ts$|typing\\.ts$|index\\.ts$)",
          "^packages/desk/src/(paper|board|notebook|photo|minimat)/",
          "^packages/desk/src/kinds/(paper|board|notebook|photo|minimat)\\.ts$",
        ],
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "kinds-import-only-the-sdk",
      comment:
        "design-016 §5 · K-L1 (K4a): every built-in kind compiles against the public entries alone — a kind's files (KIND_FILES " +
        "above) import, inside the desk, only the SDK (KIND_SDK: the kit, the engine, the contract's modules) and kind files " +
        "(their own — another kind's is `no-kind-imports-a-kind`); outside it, core's and kernel's entries only, never a " +
        "package's inner module. What two kinds share lives in the kit. K4b moves the kinds to their own package against " +
        "exactly this surface. Type-only edges count: a type a kind names from a private module is a word a plugin cannot write.",
      severity: "error",
      from: { path: ALL_KIND_FILES },
      to: {
        path: [DESK, "^packages/(core|kernel)/src/"],
        pathNot: [...KIND_SDK, ...ALL_KIND_FILES, "^packages/(core|kernel)/src/index\\.ts$"],
      },
    },
    // K-L1's second half, one rule per kind (one name): a kind's files import no other kind's — not a module, not a type
    ...Object.keys(KIND_FILES).map((k) => ({
      name: "no-kind-imports-a-kind",
      comment:
        `design-016 K-L1 (K4a): no kind imports another — the ${k} kind's files import none of the other five's (a kind names ` +
        "another only by its registry name, which core or the host resolves at run time: test/kind-names.test.ts).",
      severity: "error",
      from: { path: kindFiles(k) },
      to: { path: Object.keys(KIND_FILES).filter((o) => o !== k).flatMap(kindFiles) },
    })),
    {
      name: "the-kit-imports-no-kind",
      comment:
        "design-016 §5 (K4a): the render kit is what kinds SHARE — it is below every kind and names none (not a kind's file, " +
        "not the barrels that list them all), so a plugin kind and a reference kind stand on the same kit.",
      severity: "error",
      from: { path: DESK + "kit/" },
      to: { path: [...ALL_KIND_FILES, DESK + "kinds/index\\.ts$", DESK + "objects/"] },
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
      from: { path: "^packages/(kernel|core|dom|react|desk)/src" },
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
      from: { path: ["^packages/(kernel|core|dom|react|desk|devtools|ice)/src", "^apps/"] },
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
