# Changelog

All notable changes to ICE are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semver](https://semver.org) (pre-1.0: minor versions may break APIs).

## [Unreleased]

## [0.13.0] — 2026-09-07

**The first publish since 0.11.0.** `0.12.0` was CUT on 2026-08-31 (`903f892`) and
never published to npm — the registry's `latest` is still 0.11.0. Its dated section
stays below as history, and its BREAK ships here: `WidgetSurface` →
`WidgetSurfaceKind` is as real as this section's, so an upgrading consumer must read
both. **Its `### Added` and `### Fixed` items do NOT ship here** — design-013 superseded
them inside the same unpublished window, so an upgrader who adopts them from that
section writes code 0.13.0 refuses. `defineWidget({ presentation })` is RETIRED by
Phase A (a kind's own behaviour is the one writer of `SurfaceTarget`);
`CompositorSourceVideo.onArrival` left with the compositor source registry at Phase B;
and 0.12.0's fixes to `ground()`, `groundHost` and `ground({ lift })` describe three
functions Phase C deleted. Read that Added and that Fixed as the history of a cut
nobody installed, never as this release's surface.

### Breaking, at a glance

design-013 rebuilt the presentation layer in three phases, and each one broke
something. In the order an upgrade meets them:

- **Phase A — where a card presents is a FACT, not a policy.**
  `defineWidget({ presentation })` and the whole `SurfacePresentation` family are
  RETIRED; a kind's own behaviour is the one writer of `SurfaceTarget`, and declaring
  nothing is still right for almost every widget. `@vibecook/ice/dom` loses the
  presentation registry and its policy. The `ice:` behaviour namespace is reserved.
- **Phase B — the ground IS the compositor.** The old composited leg is deleted:
  `compositedNextProfile` is now `compositedProfile` and the profile name is
  `"composited"`; core's `compositor-registry.ts`, r3f's `webgpu-pool` /
  `retained-quads` / `webgpu-sources`, and ground's `compositor/*` and
  `atlas-allocator` are gone. The package gained `./ground/compose`,
  `./ground/packs` and `./ground/engine`.
- **Phase C — the stratified ground is that same engine, and `three` leaves.**
  `ground()`, `groundHost` and design-011's `GroundProgramDefinition` with its
  transition ladder are deleted; **`groundField()`** replaces them.
  `presentation.ground` on a canvas type is a FIELD DECLARATION
  (`{ glyph, grid, wires, guides }`), and a `program` id is refused BY NAME at
  definition time with the migration in the message. `GridConfig` loses `spacings`,
  `fadeOut` and `levelWeight`; the workspace subpaths
  `@ice/ground/programs/{dot-grid,line-grid,magnet-grid}` are gone. **The ground is
  OPAQUE now** and writes the bytes the theme and the config name, so the stratified
  profile's colours change on screen by the amounts C1 and C1d measured.
  `@ice/ground` no longer declares `three` at all, and the `three` peer floor rises
  to `>=0.185.0`.

**`three` is still a declared peer, and it is still optional.** "The cut" does not
mean ICE stopped needing three — it means nothing outside `./r3f` and `./r3f/webgpu`
needs it. The GL ISLANDS are the whole reason, `three/webgpu`'s renderer and its own
`PMREMGenerator` are why the floor moved to 0.185, and the pack audit MEASURES the
claim rather than asserting it — at every publish (`prepack` runs it) and at every
landing (`pnpm run gate:landing`), 252 modules over the nine non-island entries, 0 edges
to `three`. An app that imports no islands can install none.

Every item above is spelled out with its migration in the sections that follow.

### Review fixes before publish (C4, 2026-09-08)

0.13.0 was CUT on 2026-09-07 and never published, so the Phase C review's fixes fold into
this section rather than into a 0.13.1 — the version stamp is unchanged and there is no
release for a patch to correct (D-C4.1; 0.12.0 above set the precedent that an unpublished
cut is history, not a contract). What changed after the cut is below; everything else in
this section is as it was written on the 7th.

<!-- design-013 C4a · C4b · C4c blocks land under this heading -->

<!-- design-013 C4a (2026-09-08) -->

#### Fixed — `@vibecook/ice/ground`

- **A nav cut no longer pops the departed grid.** The flight's second slot took its field
  config only when the canvas TYPE changed, so a `grid` re-tune (the react prop) and a
  same-type enter — a board inside a board — left it drawing in a stale config. The config
  is now snapshotted at every canvas-session change, and a re-tune at rest moves it too (one
  mid-flight still does not: the departed frame keeps what the cut left it with).
- **A lost device ends the ground layer** instead of leaving the last frame painted while the
  DOM pans above it: the ground is disposed, the canvas removed so the page shows through,
  `available()` false and `status()` `failed`. Both profiles — the stratified layer's own
  device and the composited profile's app-owned one.
- **An ordinary board no longer re-collects its overlays every painted frame.** With no wires
  and no guides the empty result was also the cache's "nothing cached" sentinel, so both
  collectors ran on every frame; an empty collection is now a cached answer.
- **A promoted card that outgrows its destination draws its plate, not a stretched raster.**
  A card that copied once and then grew inside its band kept its texture ref, so the refused
  copy left the old pixels stretched over it; the refusal now clears the standing write.
- **A refused destination is no longer re-minted every frame.** All three of DomRender's
  realise paths allocated a full texture and destroyed it again on each flush while the
  texture table refused; they now back off until the handle or the table's revision moves,
  keeping the debt.
- **A remounted content element gets its boundary back.** DomCompose's change-only cache was
  keyed by the entity, so a React remount of a card's content kept the record from the old
  element and never wrote the clip, the lift or the hold on the new one.
- **A live remote cursor no longer wakes the ground every frame.** `cursorVisualPoles` watched
  `Position` with a Tier-1 query observer, and a system that merely DECLARES a write on that
  column stamps it every tick it runs; it now pulls a change collector, like the overlays.
- **Past the source cap the far cards drop, never the cursor:** poles pack before the cards.
- **The `line` glyph is one CSS pixel wide on every monitor.** Its law was read as device px,
  so a retina screen drew a half-pixel line whose peak alpha swung with the sub-pixel phase
  and shimmered under a pan.
- **`parseCssColor` takes every CSS hex form** — `#rgb`, `#rgba` and the eight-digit form with
  its alpha, beside `#rrggbb`, `rgb()` and `rgba()`. Three of them used to come out mid-gray,
  silently; an unparsable colour now says so once per distinct string.
- **A glyph name nothing registered says so** (once per name) instead of falling back to the
  dot in silence, and a live portal whose inside canvas type does not resolve is counted
  (`GroundHostStats.portalsUnresolved`) rather than silently drawn in its parent's config.
- **A pooled slot's overlays cost no GPU memory until they draw.** Every portal slot and the
  flight's departed slot minted a uniform buffer and a bind group per registered overlay at
  acquisition, for data they never carry.
- **The world's journals drain from the first tick**, not from the first tick after the device
  and the pipelines resolved: the pre-ready return sat above the pulls.

#### Changed — `@vibecook/ice/ground`

- **`groundField()` with no `theme` follows `prefers-color-scheme` at the mount** (light where
  `matchMedia` is absent — Node, a lab) instead of always the light palette; a dark product
  that ported `ground()` across verbatim got a white viewport. A later switch is still the
  app's `setTheme`. The new `defaultTheme()` is exported from `@vibecook/ice/ground/compose`.
- `lineUniformValues(cfg, theme, dpr?)` takes the frame's device-pixel ratio and uploads the
  law's widths in device px; `LineLaw`'s widths are the unit its owner authors in (the cutting
  mat's stay device px, the `line` glyph's are CSS px).
- `ContentResidency` gains `unwrote(entity)` and `revision()`. `DomHostWriter` loses `forget()`
  (it had no callers) and `createDomHostWriter`'s third `isAlive` argument (the cache is a
  `WeakMap` keyed by the element, so it needs neither a liveness oracle nor a sweep).
- `DomRenderStats` gains `backedOff`; `GroundHostStats` gains `portalsUnresolved`.

<!-- design-013 C4b (2026-09-08) -->
**core + r3f.**

- **`docs.close()` no longer takes the host's viewport and the user's camera with
  it.** `DocSession.close()` is a strata `world.reset()`, and a reset clears
  RESOURCES as well as entities — so a `docs.create()` / `docs.open()` / `docs.join()`
  on a MOUNTED canvas came out the far side with `Camera`, `Viewport`, `ActiveTool`,
  `CameraLimits`, `GestureSettings`, `PointerSettings`, `SnapConfig`, `ChromeSettings`
  and `StageMode` all `undefined`, and neither ground host could build until the next
  ResizeObserver fire. `createCanvasEngine` now seeds those through one function and
  re-seeds after every close, carrying the LIVE values across: the box, the view, a
  host's tuned settings and a held stage background are the engine's, never the
  document's. The join re-bootstrap path (a `PendingImportError` quarantine, whose
  reset happens inside `joinDoc`) re-seeds too.
- **`PresentationTransitionCoordinator.ownerOf(plane)`** (new) answers the id of the
  adapter holding a plane, or `undefined`. `register` still throws on a second claim,
  and this is the question that throw answers.
- **A second `<GLViews>` over one engine no longer unmounts the React tree.** The `gl`
  plane registration ran inside a `useEffect` with no guard, so the second mount threw
  from an effect. `claimGlPlane(transitions)` (new export) claims the plane only when
  it is free and returns the unregister — or `undefined`, claiming nothing. One owner,
  no throw, and the plane is freed for the next mount either way.
- **`createGLBridge` accepts the `CanvasEngine` itself** (`GLBridgeHost = Engine |
  CanvasEngine`, new type) and takes `transitions` and `gpu` from it; the options stay
  as overrides. Every host used to repeat `{ transitions: ce.transitions, gpu: ce.gpu }`,
  and one that forgot got a GL plane with no owner and a snap instead of a flight, with
  nothing saying why. A bare `Engine` still works and carries neither seam.
- **A refused realise BACKS OFF** (`IslandRender`). A handle the residency's table
  refuses was re-rendered every flush — allocate a full target, paint it, be refused,
  destroy it, forever, spending Hot content's owed animation time on frames nobody
  sees. The card is now skipped whole (it draws the plate, which is honest) until the
  world names a different handle or the residency's revision moves. A backend that has
  not RESOLVED the target yet is unchanged: that is a delay, not a decision, and it
  still retries next frame.
- **`ContentSink.revision?(): number`** (new, optional) is that second retry
  condition — the residency saying "a refusal might land now". A residency that
  publishes none is retried on a new handle alone.
- **`IslandRenderStats.skippedRefused`** (new) counts the flushes the backoff skipped;
  a climbing `skippedRefused` beside a still `unrealised` is what "the table will not
  take this card" looks like from outside.
- Recorded, no code change: `picking`'s declared `access.write: [PointerPart]` is a
  column-wide stamp taken every frame `live()` runs, so a CONSUMER's Tier-1 observer of
  that column would wake on every spring frame. Nothing inside ICE observes it that
  way. The note is at the declaration.
- Corrected at source: glboard's bridge has no `transitions` and is owed none — it
  builds a bare engine and has no nested-canvas nav, so no switch ever asks for the
  plane. The review read it as a missing owner.
- **Only the world's OWNER resets it** (`DocSession.close()`). Strata's double-attach
  guard is per STORE, not per world, so attaching a second session to one world does
  not throw — it silently supersedes the first, and the first session's `close()` then
  reset the SECOND one's entities and every resource out of existence. A session now
  claims the world when it attaches and resets only while the world still points at
  it; a superseded session tears down its own binding and stops. The facade never
  reached this (two independent guards in `closeDoc`, neither of which was pinned —
  they are now), but `createDocSession`/`openDocSession`/`close` are exported and the
  ordering hazard was one edit away.

<!-- design-013 C4c (2026-09-08) -->

**The desktop lab's light mode, and two leaks under its board Canvas
(`apps/widgetlab-desktop`).** No package API changed here — this is the app that
mounts the two grounds, and every fix is in it or in the rigs that grade it.

- **Light mode was a dark board.** The app painted its page from a dark/light toggle
  and handed BOTH ground arms a hardcoded dark theme, so the OPAQUE ground cleared to
  `#171717` under a `#FAFAFA` page (the composited arm since B8, the stratified arm
  since C2). One projection now feeds both surfaces — `src/ground-theme.ts`, the app's
  background and dot ink substituted into the product palette while the card, the
  frame, the hairline, the accent and the `vf-frame` pack section stay as `THEMES` has
  them — and a `setTheme` effect re-projects the live layer, so a switch never re-boots
  the canvas. **Apps that pass a theme to `groundCompose`/`groundField` should project
  their own page background into it the same way:** the ground is opaque, so its
  `canvasBg` IS what the user sees behind the cards.
- **The renderer lease kept a stale build.** A real unmount swept while a build was in
  flight; the remount started a second one; the first arrived, passed the old
  `everRetained && retained === 0` guard, was installed and then overwritten — a
  `WebGPURenderer` parked on the app-owned device for the process. Every build now
  carries a generation and the sweep count it began under. The lease is also keyed on
  the device and rebuilt when it changes, and its `dispose()` frees a live renderer at
  once and an in-flight one on arrival.
- **The PMREM environment target leaked per Canvas mount.** three 0.185.1's
  `PMREMGenerator.fromScene` returns a render target the CALLER owns and the
  generator's own `dispose()` frees its internals only; the cleanup was `onTex(null)`,
  a dropped reference. Since C0 that target sits on the app-owned device, so it lived
  for the process. An env slot owns it and disposes it on cleanup and on a renderer
  change.
- **The counters moved off the module.** Renderer and PMREM-target censuses live on
  the lease and the env slot and reach the rigs through the board Canvas's
  `onInstruments` hook, so two mounts cannot stomp each other's numbers.
- **Witnesses.** The `app` and `stratified` rigs each gained a LIGHT-MODE phase that
  flips the app's own `dark` state and reads the ground canvas beside the page's
  `--canvas-bg`, with the pre-flip byte as the control; the `app` rig's cross-backend
  compare now asserts the two arms are actually different images (pixels AND hashes),
  its `diffCaptures` refuses two captures of different dimensions instead of shearing
  them, and its remount phase counts PMREM targets as well as renderers. 21 new unit
  tests carry the code fixes, each proved red with its fix reverted.


<!-- design-013 C4d (2026-09-08) -->

- **The pixel witnesses now have exit codes** (D-C4.11). The Phase C review found four
  checks that could not fail; these four bullets are them.
  `apps/groundlab/scripts/ab.mjs oracle` (the `rig:parity` harness) ASSERTS maxΔ 0 per
  page scene, prints PASS or FAIL with the numbers, and exits with the number of scenes that
  missed — it used to print a maxΔ nobody read and `process.exit(0)` unconditionally, which
  is how it reported success against a dist that had never been built. It also preflights
  before Chrome starts: a missing `apps/groundlab/dist/index.html` or a missing
  `packages/ground/oracle/results/oracle-<scene>.rgba` names the command that produces it and
  exits 1. A boot failure or a throw is 1. (The Dawn oracle already exited non-zero on a
  failed check; verified by corrupting one expectation, not by reading the code.)
- **`pnpm run gate:landing`** — the new root script: the Dawn oracle → the lab's build →
  `rig:parity` → `pack:audit`, in that order, each gating the next. It is REQUIRED at every
  landing and is deliberately NOT part of `pnpm run ci`: the oracle needs Dawn, which the CI
  runner has not been probed for (D-B1.4's finding is carried, not resolved).
- **`npm publish` runs the pack audit.** `packages/ice`'s `prepack` was `build`; it is
  `pack:audit` now (which builds first), so the "0 edges to `three` outside the island
  entries" claim above is measured on the bytes being published, by the publish itself.
- **A type-only import is a dependency-cruiser EDGE** (`tsPreCompilationDeps: true`). Without
  it, `import type { X } from "three"` was invisible to the `three-only-in-r3f` wall, which
  stood only because `@types/three` happens to be absent from every walled package. Turning
  type edges on made 21 TYPE-ONLY import cycles visible in `@ice/core` and `@ice/react`
  (`behavior/types.ts` ⇄ `guards/guarded-tx.ts` is the shape — both sides `import type`);
  `no-circular` now carries `viaOnly: { dependencyTypesNot: ["type-only"] }` so it keeps
  meaning what it always meant, a RUNTIME cycle. It also surfaced a latent one: `depcruise
  packages` was walking `packages/ice/dist`, so the cruise answered differently depending on
  whether anything had built (483 modules on a clean tree, 778 after) — and the `.d.ts`
  barrel cycles tsc emits by design would have turned `pnpm run ci` red for anyone who ran
  `gate:landing`, a publish or a build first. This repo's own build output is excluded now
  (`^packages/[^/]+/dist/`, anchored so a DEPENDENCY's `dist` stays in the graph where the
  walls can see it) and the cruise is hermetic. No consumer-visible surface changes.

design-013 Phase A — the presentation FACTS move into the world, and the
decision about them moves onto the behaviours door. Where a card presents used
to be a session-local map beside the world (`PresentationRegistry`) driven by
an app-wired policy; it is now a component with one writer, and that writer is
the entity's own kind behaviour.

### Breaking

- **`defineWidget({ presentation })` is RETIRED.** The three-valued
  `SurfacePresentation` (`live-dom | composited | picture`) it declared is gone
  with it — `picture` was never a third place for pixels to come from but a
  paused demand on a GPU target. A definition still passing the field throws at
  definition time rather than being quietly ignored. Migration, one line each:

  | was | now |
  | --- | --- |
  | `presentation: { pin: "live-dom" }` | `behaviors: [alwaysDom]` |
  | `presentation: { pin: "composited" }` | `behaviors: [alwaysGpu]` |
  | `presentation: { default: "picture" }` or `{ pin: "picture" }` | `behaviors: [alwaysGpu.with({ paused: true })]` |
  | `presentation: { default: "composited" }` | `behaviors: [alwaysGpu]` |

  The last row is not exact and says so: a `default` without a `pin` was
  promotion-eligible from a composited start, and no standard behaviour has
  that shape. A kind that wants it writes its own behaviour, which is
  design-013 §0's whole point. **Declaring nothing is still right for almost
  every widget** — a definition that names no surface behaviour is given its
  kind's default (`domAtRest` for `surface: "dom"`, `alwaysGpu` otherwise), so
  the ratified default is no longer something an app can fail to wire.

- **`@vibecook/ice/dom` loses the presentation registry and its policy:**
  `createPresentationRegistry`, `createPresentationPolicy`,
  `DEFAULT_PRESENTATION`, `PresentationRegistry`, `PresentationPolicy`,
  `PresentationPolicyOptions`, `declaredPresentation`, `presentationPinned`,
  `widgetPresentationPins`. `createDomWidgetsReflector` no longer takes a
  `presentation` option — it reads `SurfaceTarget` from the world.
- **Core loses the `SurfacePresentation` family:** the type itself plus
  `SurfacePresentationDecl`, `ResolvedSurfacePresentation`,
  `defaultPresentationFor`, `presentationIsLegal`,
  `surfacePresentationDeclError`, `resolveSurfacePresentation`.
  `WidgetType.presentation` is gone.
- **`WidgetSurface.presentation` → `WidgetSurface.target`** (`"dom" | "gpu"`),
  and the seam `WidgetSurfaceSeams.presentationOf` → `targetOf`. Both profiles'
  factories answer it: `compositedSurfaces` from the world's `SurfaceTarget`,
  `stratifiedSurfaces` from the kind. `compositedSurfaces` also drops its
  required `presentation` option and makes `demandOf` optional — absent, it
  answers from the `SurfaceDemand` clamp.
- **The type `SurfaceDemand` is now `SurfaceDemandValue`, and the type
  `SurfaceKind` is now `SurfaceKindValue`** (landed with A1a). design-013 §5
  gives both bare names to COMPONENTS, and a value and a type of one name
  re-exported from two modules collide at the package surface without a
  compile error. Migration is one identifier each.
- **A bare entity in the mount store is no longer promotable on grab.** The old
  policy promoted anything it was handed and refused only what it knew had no
  live-dom mode; the target is now a component, and `targetOf` reads a missing
  one as `dom`. So a mount entry with no widget type — a hand-built rig entity,
  a port, a ghost — stays in the content plane through a grab where it used to
  reach the canvas. This is the intended reading (there is no compositor source
  for such a thing either), and it is listed because a rig that leaned on the
  old behaviour will see the difference.
- **`defineWidget` refuses a type that lists TWO behaviours writing
  `SurfaceTarget`** (one of the standard three, or any behaviour declaring it in
  `writes:`). It used to accept them and attach both. An entity has one kind and
  that kind's behaviour is the sole writer of its target (design-013 §5), so
  `behaviors: [alwaysDom, alwaysGpu]` now throws at definition time naming both.
- **The `ice:` behaviour namespace is RESERVED for the engine.**
  `defineBehavior("ice:anything", …)` throws. The namespace carries two
  privileges — the compiler's `orderIndependent` attestation on declared writes,
  and an exemption from the published-read-surface warning — and a pack that
  named itself into it inherited both, including the one that silences strata's
  report of a second writer on a component. Rename to your own namespace; a name
  that merely starts with the same letters (`iceberg:x`) is unaffected.

<!-- design-013 C3 (2026-09-07) -->
- **The `three` peer floor rises from `>=0.160.0` to `>=0.185.0`** (design-013 §8 Phase C,
  C3 — D-C3.1). The peer is still OPTIONAL and still declared, but the versions it is
  declared against are now only the ones the GL islands actually run on: `./r3f/webgpu`
  builds `three/webgpu`'s `WebGPURenderer`, and the desktop board's environment path needs
  that module's own `PMREMGenerator` (C0), neither of which exists at 0.160. A consumer
  pinned below 0.185 was already broken on those two subpaths; the manifest now says so
  instead of promising a floor it could not meet. Consumers who never import `./r3f` or
  `./r3f/webgpu` need no `three` at all — see below.
- **`three` is gone from the ground.** `@ice/ground` (`@vibecook/ice/ground`,
  `./ground/compose`, `./ground/packs`, `./ground/engine`) declared `three` as a peer and a
  dev dep for the stratified leg's `WebGPURenderer` + TSL; C2 deleted that leg and C3 struck
  the declarations. **The `three` peer of `@vibecook/ice` now exists for ONE reason: the GL
  ISLANDS.** "The cut" does not mean ICE stopped needing three — it means nothing outside
  `./r3f` and `./r3f/webgpu` does, and the pack audit measures that rather than asserting it:
  252 modules reachable from the nine non-island entries, 0 edges to `three`, externals
  exactly `@vibecook/strata-ecs` (+ its `durable`/`ephemeral`/`tools` subpaths), `loro-crdt`,
  `rbush`, `react` and `react-dom`. A dependency-cruiser rule (`three-only-in-r3f`) makes it a
  CI failure for any of kernel/core/dom/react/ground/devtools/ice to import three again.

<!-- design-013 C2 (2026-09-07) -->
- **The stratified profile's ground is the ENGINE's, and the three-based leg is deleted**
  (design-013 §8 Phase C, C2 — D-C2.1…D-C2.6). `@ice/ground` (`@vibecook/ice/ground`) no longer
  exports `ground()`, `groundHost`, `GroundLayer`, `GroundFactory`, `GroundContext`,
  `GroundHostLayer`, `GroundProgramControl`, design-011's
  `GroundProgramDefinition` / `GroundProgramInstance` /
  `GroundProgramInput` / `GroundSourceDeclaration` / `GroundProgramTransition` /
  `GroundPrepareContext` / `GroundProgramStatus` / `GroundProgramCacheOptions` /
  `FrozenGroundPresentation` / `GroundPresentation` / `GroundActivationContext`,
  `frameChildrenSource` and its two limits, `GroundFrameChildren*`, `GroundPass` / `GroundFrame`
  / `GroundReflector`, the renderer's `readGroundRendererStatus` and every `GroundRenderer*`
  type, `collectMagnetLevels` / `collectMagnetSources` / `magnetFieldScale` / `resolveMagnet` /
  `MAX_MAGNET_SOURCES` / `MagnetLevel` / `ReadSpatial`; the workspace subpaths
  `@ice/ground/programs/{dot-grid,line-grid,magnet-grid}` (`dotGridGroundProgram`,
  `lineGridGroundProgram`, `magnetGridGroundProgram`) are gone.
  **Three names are REPURPOSED rather than deleted, which is the quieter break:**
  `GroundHostOptions` (`compose/host.ts:91`) and `GroundHostStats` (`:224`) are now the
  ENGINE host's options and instruments — the pair `groundField` and `groundCompose` share —
  and `GroundOptions` (`compose/ground.ts:54`) is `Ground.create`'s. An old import of any of
  the three still COMPILES and means something else, so a stale annotation goes wrong at the
  first field you read rather than at the import. What replaces the factories, one of them:
  **`groundField(opts?)`** — the same engine host `groundCompose` is (one host, two
  factories, D-C2.3), acquiring its OWN WebGPU device, drawing the field, the live portals, the
  flight's second slot and the two overlays under the DOM planes, and NO cards (the DOM draws
  them). Migration:

  | was | now |
  | --- | --- |
  | `ground({ grid, wires, guides, poles, passes, forceWebGL, profile, rendererOverride })` | `groundField({ grid, wires, guides, poles, theme?, config?, grids?, gpu?, onDevice? })` — no WebGL2 fallback, no timestamp profile, no extra `passes` (an overlay is `Ground.create({ overlays })`'s) |
  | `groundHost({ programs, fallback, cache, onProgramFault })` | `groundField(…)` — the canvas type declares its glyph (below); there is no program to prepare, cache, fall back to or quarantine |
  | `layer.reflector.rendererStatus()` / `.rendererProfile()` / `.redraws()`, `layer.device()`, `layer.programs.*` | `layer.field.status()` / `.device()` / `.redraws()` / `.stats()` / `.config()` / `.setTheme()` |
  | `magnetGridGroundProgram({ poles })` | `groundField({ poles })` — a pole flagged `pointer: true` rides the field's analytic cursor (D-C2.2) |

  **The ground is OPAQUE now.** The old canvas cleared to transparent and the page's CSS
  background showed through it; the engine clears to its theme's `canvasBg` and writes the
  bytes the theme and the config name — straight alpha over that ground, in the sRGB swap
  chain, no linear-light compositing and no encode on output (D-C2.6: a configured byte is the
  drawn byte). Pass `theme` (a `GroundTheme` — `themeFrom(name, palette)` over
  `ENGINE_PALETTE[name]` with your page's background as `canvasBg`, or a product's own
  projection); with none, the engine's light or dark theme by `prefers-color-scheme` at the
  mount — light where `matchMedia` is absent, as in Node or a lab (D-C4.4). Pass your own:
  the read is a guess at your page, not knowledge of it. The stratified colours therefore
  CHANGE on screen by the amounts C1 and C1d recorded: a wire at `rgba(120, 132, 145, 0.9)`
  now lands at that colour over the ground rather than lighter, and the line grid's ink
  `[0.75, 0.77, 0.8]` at 85 rather than 157 — lift `lineInk` and the `WiresConfig` colours if
  you want the old look; never a second chain.
- **`presentation.ground` on a canvas type is a FIELD DECLARATION, not a program id**
  (D-C2.4). `{ program: string; wires?; guides? }` became
  `{ glyph?: string; grid?: Partial<GridConfig>; wires?: boolean; guides?: boolean }`: `glyph`
  names the engine's `dot` or `line` or a registered grid program's (`needle`, `mat` —
  `@ice/ground/packs`; an unknown name draws as the dot), `grid` is the same partial the react
  `grid` prop takes and the prop's re-tunes land on top of it. The host resolves it per slot:
  the ROOT slot from the current type at every switch, a live PORTAL's slot from the
  container's inside type (the catalog's binding), and the flight's departed slot keeps the
  config it was drawn with at the cut. A definition still naming `program` throws at
  definition time with the migration in the message; an empty `glyph` is refused by the
  catalog where an empty program id was. A type that declares a ground (any of the four
  fields) requires the `ground` presentation plane to prepare before a flight, as a program id
  did.
- **`GridConfig` loses `spacings`, `fadeOut` and `levelWeight`** (D-C2.1). The ground draws on
  the engine's lattice — a derived decade ladder (`mid = 20·10^k`, fine = mid/10, coarse =
  mid·10) that fades a rung IN by its own cell size and never out — so the classic grid's three
  fixed spacings, its fade-out window and its per-level weights retired with the classic grid.
  `fieldConfigOf` had dropped them silently since B2; a partial naming them is a type error
  now. `DEFAULT_GRID_CONFIG` is `{ dotColor, dotAlpha, fadeIn, dotRadius }`. The magnet block's
  `widgets`, `widgetStrength`, `widgetRadius`, `maxSources` and `fadeZoom` stay declared and
  have no field reader (every on-screen card is a source at strength 1; named as owed).
- **`InfiniteCanvas`'s `GroundLayerFactory` context loses `readSpatial` and `gpu`, gains
  `catalog`.** The magnet grid's broad-phase seam and the snapshot strategy's GPU ledger went
  with the old leg; the engine's catalog is how the ground resolves a portal's inside type. A
  factory written against the old context that reads either field gets `undefined`.
- **`@ice/ground`'s `Pole` gains `pointer?: boolean`** and `FieldFrame.pointer` a
  `strength?: number` (D-C2.2). `localPointerPoles()` flags its poles; `cursorVisualPoles()`
  does not; an app's own `PoleSource` (widgetlab's `haloPoles`) flags the one that is the local
  cursor. The magnet shader's cursor term scales by the strength (`u.flags.z`; 1 by default —
  the oracle's 53 renders are byte-identical).

<!-- design-013 C1d (2026-09-07) -->
- **`GroundTheme` carries a `lineInk`** (design-013 D-C1.4). The engine's new `line` glyph
  paints in a theme role of its own, so the head every pass reads gained one field. `themeFrom`
  fills it from `LINE_GRID.ink[name]` — a host that builds its theme through it needs no
  change; one that writes the object by hand must add the field.

<!-- design-013 B6 (2026-09-07) -->
- **The video kind's contract is a REGISTERED STABLE-TEXTURE HANDLE** (design-013 §9 Q5
  RULED, B6). A live surface's producer no longer publishes a source the compositor samples;
  it states its size once and hands frames over, and the engine copies each ONE time into the
  texture the handle names and closes it. The old shape retained the latest `VideoFrame` and
  re-imported it (`device.importExternalTexture`) on every composite, which is legal only for
  a producer that owns its frames: under a lease protocol the frames are a small pool and a
  held one starves the producer. Migration, on the new profile:

  | was (`CompositorSourceVideo`) | now (`compose.video`, `@ice/ground/compose`) |
  | --- | --- |
  | `sources.register(e, { kind: "video", frame: () => latest, onArrival })` | `compose.video.register(e, { width, height })` once, then `compose.video.arrive(e, frame)` per frame |
  | the consumer retains `latest` and closes the one it replaces | `arrive` owns the frame: it is closed by the copy, by the next arrival that supersedes it, by the demand clamp that refuses it, or by `dispose` — exactly once |
  | `onArrival` wakes the compositor | the copy touches the content residency, which wakes the builder (`WakeReason "content"`) |
  | the source is sampled every composite | the card samples its own stable texture; a frameless frame shows the last good pixels, unchanged |
  | a paused card still handed frames over | `SurfaceDemand paused` ⇒ the arrival is dropped and closed, no copy and no compose frame; an fps bucket is a ceiling on copies |

  `CompositorSourceVideo` itself and the `texture_external` pipeline variant in
  `widget-quad-pass` were UNCHANGED and retired with the old profile at B8 — the ground
  deliberately has none, and the retain-and-import path becomes the rig's own mechanism.
- **`defineWidget({ surface: "video" })` is legal, and a video widget may not carry a
  `component`** (design-013 B6). `WidgetSurfaceKind` used to exclude `video` on the ground
  that it "arrives from a producer, never from `defineWidget`" — but only equip stamps
  `SurfaceKind`, and Band, Demand and Residency all key off it, so the kind was unspeakable
  and a live surface unspawnable. It is declared like any other kind now and equip gives it
  `SurfaceTarget = gpu`. A `component` is refused at definition time: nothing mounts one for
  a non-dom kind but `GLViews`, which takes only `gl`, so it would be silently dead. `chrome`
  is still yours.

<!-- design-013 C0 (2026-09-07) -->

- **The product's GL cards draw on the ground's device** (design-013 §8 Phase C, C0).
  `apps/widgetlab-desktop` built its R3F `<Canvas>` with three's WebGL renderer under the
  composited profile, so `GLViews` refused at mount and every island rendered into targets
  the ground cannot sample — the board's seven GL cards drew nothing. B8 left it owed and
  named one blocker: the environment. `three`'s `PMREMGenerator.fromScene` reads
  `renderer.state.buffers`, which a `WebGPURenderer` has not got ("Cannot read properties of
  undefined (reading 'buffers')"). `three/webgpu` ships its OWN generator with the same
  surface, so the Canvas and the environment both move, and the branch is on the BACKEND
  (`hasWebGpuBackend`), not on the profile — the stratified arm this package's headless tests
  mount is unchanged.
- **`BoardGLCanvas` — the board's GL root as a component** (`apps/widgetlab-desktop/src`),
  so the new `app` rig mounts the SHIPPING wiring rather than a copy of it. It owns the
  Canvas, the environment loader and `<GLViews>`, takes the app-owned device as a prop, and
  LEASES its renderer: R3F disposes a WebGPU renderer nowhere
  (`unmountComponentAtNode` touches only `renderLists`/`forceContextLoss`), so an unmounted
  board canvas would park one on the shared device forever. Disposal is deferred by a task so
  a StrictMode remount re-retains instead of killing a live renderer, and it is safe on an
  injected device — three destroys a device only when it made it.
- **The tray's preview capture needed no change and now says so.** `captureWidgetPreviews`
  builds its own WebGL root on its own canvas and hands THAT renderer to the environment
  factory, so the WebGL `PMREMGenerator` is correct there on both profiles. The App comment
  claiming the whole environment path was WebGL-only was over-broad and is corrected at source.
- **A new rig, `pnpm --filter widgetlab-desktop app`** (`composited-app`): the real demo board
  seeded through the App's own `seedDemoScene`, the seven GL cards each rendering into the
  private target Residency named, and the two lit ones graded against a WebGL control that
  renders THE SAME `Scene` object — not a description of it — with both noise floors read
  first and the environment proved load-bearing by a control with it switched off. The
  seeder is exported for that: every rig page runs inside the Electron shell, where
  `hasDesktopBridge()` is true and `createDemoEngine` leaves seeding to a switchboard join a
  one-window harness never makes.

<!-- design-013 B9 (2026-09-07) — the Phase B review's blockers -->

- **A card is clickable from the moment it exists** (B9, review blocker 1). The ground armed
  its frame pick source at mount and answered `outside` for any card it had no geometry for —
  before its pipelines compiled, before a card's first draw, and for good when `Ground.create`
  rejected — which the router took as a miss: every card unclickable, a tap clearing the
  selection. `FramePickSource.hit` may now return `undefined` ("no geometry"), and
  `pickFrame` keeps the box tier's answer there (`packages/core/test/frame-pick.test.ts`).
- **The clamped oversize destination is refused, never claimed** (blocker 2). Residency clamps
  a Q10 private texture to the device limit uniformly; the L1 copy writes the element's whole
  raster. DomRender now compares `geometry().written` with the destination and counts an
  oversize copy (`DomRenderStats.oversize`) instead of copying past the edge and claiming
  the write — the card draws the plate until its band changes. Projecting the clamp into the
  uv (D11) is owed. A page-array growth the table refuses no longer returns the OLD array to
  a copy that names a layer it lacks; the refused texture is destroyed.
- **A promoted card gets the lift and the hold ONCE** (blocker 3). `DomCompose` wrote
  `scale()`/`opacity` on every card's content element; a `gpu` target's raster baked them and
  the ground applied them again, and the per-frame transform write painted the L1 source
  canvas past DomRender's self-write guard. The writer skips both on `gpu` targets (written
  as empty, so a promotion clears and a demotion restores). `createDomHostWriter` takes an
  `isAlive` predicate and sweeps its entity-keyed store on its own tick.
- **`Retained` cannot leak past a cut** (blocker 4). `publishNavCut` releases the departed
  set (a cut mid-flight ends the flight, and the tick that owned the release never ran for
  an inactive resource), and `startNavFlight` releases the earlier set before pinning the new
  one.
- **The `gl` presentation plane has an owner again** (blocker 5). B8 deleted the retained-quad
  adapter that owned it on the stratified profile and the composited leg never had one, so a
  cross-type enter with any island on the board was gated to a SNAP on both. `GLViews`
  registers `GL_PLANE_ADAPTER` (`@ice/r3f`; prepares instantly, no visual of its own) on both
  profiles: under `composited` the ground's departed slot draws the islands from the
  residency; under `stratified` the islands cut at the switch — their outgoing-quad
  transition is owed.
- **`onPart` reaches the app OUTSIDE the notify.** The compose layer called the app back from
  inside a resource observer, and the app's action is an op — a close button despawns. A
  structural write inside an observer's emit is IGNORED in strata's dev build (a console
  error) and unguarded in prod; the callback now runs on a microtask, after the frame's
  synchronous step has returned.
- **The hover part is attributed to the EXACT hit.** The router writes `PointerPart` from the
  exact pick, but the builder paired it with `Targets` — the dead-band relation — so a pointer
  crossing from card A onto B's close button inside A's 4 px release band lit A's button. It
  pairs with `TouchesExact` now.
- **Picking re-runs while a card's geometry moves under a still pointer.** `FramePickSource`
  gains `live?()`; the picking system runs while the source says its geometry is moving, so a
  close button that reveals under a motionless pointer is hovered when it arrives, not one
  pixel of movement later.
- Also from the review: a `Ground` resolved after its compose layer was disposed (StrictMode,
  HMR) is disposed rather than leaked; an island render whose resolve texture the backend
  had not allocated yet is NOT marked painted — the target is dropped and the next flush
  renders (`IslandRenderStats.unrealised`); the residency's destroy list is drained on every
  roster tick, drawn or not (a hidden canvas no longer mints textures it never destroys);
  `GroundLayerHandle.compositorReflector` (dead since B8) is gone; the boot rig asserts the
  exit cut over the WHOLE frame, as the docs claim (it was, and is, 0 — the check said inset);
  `pnpm run ci` runs `gen:check`, so the committed WGSL/noise modules are the gate's.

<!-- design-013 B8 (2026-09-07) -->

- **THE OLD COMPOSITED LEG IS DELETED** (design-013 §8 B8, §10.8), in one commit, and the
  profile design-013 built beside it takes the name. `compositedProfile` IS the new one now;
  `compositedNextProfile` is gone with the name `"composited-next"`, and
  `PresentationProfileName` is `"stratified" | "composited"` again. A composited app wires
  `ground={groundCompose({ device, theme })}` from `@ice/ground/compose` — the profile refuses
  a `ground()`/`groundHost()` layer BY SHAPE — a ground handle that carries no `compose`
  (`packages/react/src/profiles/composited.ts:79-85`) — which is what makes the swap loud
  instead of a plausible blank screen. By shape, not by name: any layer without the compose
  seam is refused, whatever produced it.
- **`@ice/ground`'s barrel loses the compositor.** Removed: `createCompositorReflector`,
  `createWidgetQuadPass`, `createDomAtlas`, `createDomSourceBinder`, `createWorldQuadFacts`,
  `createLiftDriver`, `resolveGlSource`, `resolveVideoSource`, `createAtlasAllocator` and
  every type they carried (`CompositeTarget`, `CompositeFrame`, `QuadFacts`, `QuadTexture`,
  `WidgetQuadPass*`, `DomAtlas*`, `DomSourceBinder*`, `LiftDriver*`, `AtlasAllocator*`,
  `AtlasSlot`, `AtlasWasteReport`, `SlotResidency` …). `GroundLayer` loses
  `compositorReflector`, `sources`, `domSources` and `groundTargetLive()`; `GroundOptions` and
  `GroundHostOptions` lose `device`, `sources`, `target`, `order`, `atlas`, `lift` and `video`.
  What the barrel IS, now: the stratified ground, unchanged, plus the two kept LEAVES both legs
  share — `hic-adapter` and `instrumentSubmits` (which MOVED from `src/compositor/` to
  `src/submit-instrument.ts` and is exported from `@ice/ground/compose` as well).
- **`@ice/core` loses the compositor SOURCE REGISTRY.** `createCompositorSourceRegistry`,
  `CompositorSource`, `CompositorSourceDom`, `CompositorSourceGl`, `CompositorSourceVideo` and
  `CompositorSourceRegistry` are gone — the meeting point they existed to be is now the world
  itself (`TextureRef`, written by Residency) and, for a live surface, `VideoIngest`'s door.
  `SurfaceKindValue` survives the file and moves to `core/src/surface/contract.ts`; the export
  from `@ice/core` is unchanged. `createDomWidgetsReflector`'s `sources` option goes with it.
- **`@ice/r3f` loses the old pool and the composited arm.** Removed:
  `WebGpuRenderTargetPool`/`WebGpuRenderTargetPoolOpts`, `createIslandSourceBinder` and its
  types (`GlSourcePoolLike`, `IslandSourceBinder`, `IslandSourceBinderOpts`, `SourcesLike`),
  `CompositorBinding` and `GLViews`'s `compositor` prop, `createRetainedQuadTransitionAdapter`
  with `RetainedQuadPool`/`RetainedQuadTransitionOptions`, `PassContext.sources`, and
  `GlFrameStats.retainedQuads`. `WEBGPU_ISLAND_SAMPLES` and `webGpuRenderTargetBytes` now come
  from `./island-target` (the same values). An island under the composited profile is
  `createIslandRender` (B5) and nothing else. The retained-quad transition was the STRATIFIED
  profile's outgoing frame; that profile has none until Phase C moves it onto the ground, where
  a departed frame is the flight's second slot (B7).
- **The old profile's rigs are retired**, and what replaced each:
  `board` → `render` (the promote witness, D7) + the `no-full-board-path` unit test carried onto
  Residency + DomRender · `input` → `input`, PORTED to the new profile (it found two real
  defects; see Fixed) · `demand` → `render`'s bucket ladder (30/10/2 fps) · `app-witness` →
  `islands` + `video`, and `islands` gains the cross-kind z check · `island-parity` → `islands`
  (the same method, tighter numbers, in `docs/benchmarks.md`) · `zoom-drift` → `render`'s drift
  readback, 0 px past the slot by construction under both raster strategies. ACCEPTED LOSSES,
  named: `board`'s atlas-waste report (the M19 A2 allocator bench is the unit witness now),
  `parity`'s S1 A/B (moot — the ground IS the compositor), and `demand`'s boot stagger (DomRender
  has no per-frame copy budget yet — owed).
- **`GroundProgram.transition` is NOT deleted here.** §10.8 listed it; that was a scoping error
  and this is its correction. `packages/ground/src/programs/magnet-grid.ts` declares
  `transition: "snapshot"` and is the shipping STRATIFIED grid, so the three outgoing strategies,
  the snapshot ledger and `renderer.capture()` retire at **C2**, with the grid, when design-011's
  `GroundProgram` contract is reshaped. What `renderer.ts` did lose is the composited leg's
  OFFSCREEN target and blit (`offscreen`, `targetTexture()`, the colour target).
- **`defineWidget({ presentation })`** — retired earlier in this same block; B8 is where the last
  code that could have read it goes.
- **`@vibecook/ice` gains three subpaths**: `./ground/compose`, `./ground/packs` and
  `./ground/engine`. The mat pack's blue-noise tile now SHIPS — generated into
  `src/assets/blue-noise.gen.ts` and exported from the packs entry as `blueNoise()` — because a
  published consumer has `dist/` only and a `?url` import of `assets/blue-noise.rgba` reaches
  nothing (D-B8.1; `packages/ice/tools/audit-pack.mjs` is the standing witness). `@ice/ground`'s
  `gen:check` covers the generated module.

### Added

<!-- design-013 C2 (2026-09-07) -->
- **`groundField` — the stratified profile's ground on the engine** (design-013 §8 C2,
  D-C2.3). One WebGPU canvas on a device the layer acquires itself (`navigator.gpu`, or a
  `gpu` handed in), the same frame builder `groundCompose` runs — for the SOURCES (every
  on-screen card's silhouette bends the lattice, as the old magnet grid's `readSpatial`
  sources did), the live portals with their inside's own field config, the flight's second
  slot (the departed frame's field under the departed camera, in the config it was drawn with
  at the cut — design-006 §9 on the stratified profile for the first time, dual-live, no
  snapshot), the wires and the guides gated by the canvas type — and no card frames in any
  slot. A refused adapter, a failed compile or a lost device is a console error and an
  unavailable layer (`field.status()`), never a throw in the frame; the app steps on with the
  DOM board. `onDevice` hands the device over before the first frame (a rig's
  `instrumentSubmits`). Witnesses: `packages/ground/test/compose/{field-host,field-dirty,
  poles}.test.ts` (the switch, the gates, the re-tune, the portal's inside config, the departed
  config, the refusal, idle-zero and the dirty union on a stub device, D-C2.2's bake count on a
  REAL `Field`), and the desktop `stratified` rig (`pnpm --filter widgetlab-desktop
  stratified`): the real DOM board over the engine's ground, the flight's cut at maxΔ 0
  inside the face and out, a 60-step pointer gesture at 0 bakes, a remote pole at one bake per
  move.
- **Poles on the engine — `packPoles`, `PoleSource`, `localPointerPoles`, `cursorVisualPoles`**
  (`@ice/ground`, `@ice/ground/compose`; D-C2.2). A pole flagged as the local pointer rides the
  field's analytic cursor term with its strength — its motion redraws and never re-bakes the
  atlas; every other pole is a degenerate `FieldSource` (`{ cx, cy, hx: 0, hy: 0, r: 0,
  strength }`, the old `[cx, cy, 0, 0, 0, strength, 0, 0]` record) and its move is one bake.
  `groundCompose({ poles })` takes them too.
- **`ENGINE_PALETTE` / `ENGINE_THEMES`** (`@ice/ground`): the engine's own two themes, for a
  host that projects none and as the base a host overrides a role of (`themeFrom(name, {
  ...ENGINE_PALETTE[name], canvasBg })`). ICE ships no design system, so every role names the
  ICE number it is.
- **`slotFieldConfig` / `mergeGridConfig`** (`@ice/ground`): a canvas type's declaration and
  the `grid` re-tunes onto a slot's `FieldConfig`, and `configureGrid`'s one-level merge on
  the magnet block, as pure functions.
- **The composited profile's per-slot configs, for free**: `groundCompose` resolves the root
  slot from the canvas type at every switch and a portal's slot from its inside type through
  the same host (`GroundComposeContext.catalog`, which `<InfiniteCanvas>` now passes) — the
  desktop board's folder draws its whiteboard's `line` grid inside its face.

<!-- design-013 C1d (2026-09-07) -->
- **`line` — the engine's second built-in glyph** (design-013 §8 C1d, D-C1.4). The classic
  line grid is no longer a three `Object3D` program with its own TSL shader and its own decade
  ladder: it is a `SurfaceGlyph` beside the dot in `fieldShaders`, so `glyph: "line"` draws
  with no app registration. It shades the ENGINE's lattice — the same three rungs, the same
  `fadeIn` window by a rung's own cell — through `lattice/line.ts`'s law, which is the cutting
  mat's mechanism without the mat's material: no gobo, no grain, no colour chain. One device
  pixel wide at every zoom and every rung, in the theme's line ink (`LINE_GRID`, projected from
  the old grid's `GridConfig.dotColor`) at the field config's alpha. A host that wants the
  mat's decade hierarchy passes its own `LineLaw` through `FieldConfig.ext.line`. Pinned by
  three oracle scenes (`line-z0.5` · `line-light-z1` · `line-z6.31`), which `rig:parity`
  renders identically in Chrome and in Dawn, and by `test/compose/line-glyph.test.ts`, which
  drives the real `Field` on a device stub.
- **The old-vs-new line grid, RECORDED** (design-013 D-C2.1). The new glyph's LOD is the
  engine's lattice and not the old ladder, so the two are compared, not reconciled:
  `pnpm --filter widgetlab-desktop line-ab` draws both in one headless Electron page, on one
  device, at zooms 0.5 · 1 · 2.5, each arm captured twice as its own control (maxΔ 0). At zoom
  1 and 2.5 the two ladders coincide — same pitch, same phase to the pixel, the same 14.44 %
  and 5.91 % of the frame inked — and the whole difference is colour and width: three's output
  pass encodes the old grid's ink to sRGB (peak 157) where the new writes the theme's bytes
  (peak 85), and the old line is 0.55·dpr device px of half-width against the new's 0.5. At
  zoom 0.5 they part, as the ruling says they must: the old holds a 20 device px grid at
  27.75 % ink, the new promotes a decade to 200 device px at 2.98 %.
<!-- design-013 C1 (2026-09-07) -->

- **The overlays — wires, guides and the tri-soup on the engine, design-013 C1**
  (2026-09-07). The ground's slot had two passes, the field and the frames, and no room for
  anything else. It has a THIRD now, and it is the app's: an OVERLAY is a named pass with a
  STAGE — `under` (after the field, before the cards) or `over` (after them) — created once
  and spawned per slot, exactly as a grid program's surface pass is.
  `Ground.create({ overlays })` / `groundCompose({ overlays })` register them; each slot's
  data rides `SlotInputs.overlays` by name, the `ext` convention. **With none registered
  nothing changes at all:** all 47 of the oracle's existing renders are byte-identical with
  the seam in place and the two overlays registered on every slot set, which is the seam's
  own witness (`packages/ground/test/compose/overlays.test.ts` records the draw calls and
  compares them to a slot built the old way).
  - **The soup pass** (`compose/overlay.ts`): one WGSL entry — a vertex is `xy` in the
    slot's screen px plus `rgba`, the slot's view maps px → clip, `BLEND_OVER`, no depth,
    `cullMode: "none"`. The `DoubleSide` winding find of 2026-07-16 evaporates: WebGPU culls
    nothing by default, and the oracle's `overlay-soup-z1` scene asserts a clockwise and a
    counter-clockwise triangle both land. Its vertex buffers grow by the old `soup-mesh.ts`
    policy and never shrink, and a frame whose soup did not re-collect re-uploads only the
    uniform. The slot's scissor and its portal CHAIN apply as they do to the field: an
    arriving frame's overlays are clipped to the container's face (`overlay-clip-enter-p0.5`).
  - **Wires and guides** are the compose host's two root-slot overlays (`compose/overlays.ts`),
    collected in SCREEN px under the LIVE camera on frames whose facts or camera moved. The
    dirt is PULLED — a change collector over the same components and tags the old
    `passes/wires.ts` and `passes/guides.ts` armed observers on, one for one — so a still
    board wakes nothing however many frames pass. The GATE is the canvas type's
    (`presentation.ground.wires` / `.guides`, both defaulting to on), read at the mount and on
    every canvas switch. Their look still comes from core's `WiresConfig` /
    `SnapGuidesConfig`, now through `groundCompose({ wires, guides })` — the same partials the
    old `ground({ wires, guides })` and the react props take.
  - **Destination-frame truth** (design-011 §7.3): a nested portal slot carries no overlays
    and neither does a flight's departed slot — they cut at the switch, like the stratified
    islands. The departed frame's wires are OWED (a world-space soup whose widths are
    re-collected per frame).
  - The pure halves — `SoupBuilder`, `collectWires`, `collectGuides` — were COPIED across the
    Phase-C wall into `compose/`, since the new leg may not import the old one.
    `packages/ground/test/overlay-collectors.test.ts` runs both implementations over the same
    world and asserts the soups agree element for element, so the copy cannot drift before C2
    deletes the original.

- **A colour-chain difference between the two grounds, measured** (design-013 C1). The new
  `overlay-parity` rig (`apps/widgetlab-desktop`, one Electron page, headless) draws one
  wires-and-guides world through the OLD `ground()` and through the new `Ground`, predicts
  both from the same triangles on the CPU, and reports each against an A-vs-A control. The
  geometry agrees exactly — neither renderer leaves bare a pixel the raster says carries
  soup, over 110k–135k interior pixels — and the new pass matches the colour its config names
  BYTE FOR BYTE. **The old leg does not, and never did:** three composites the overlays in
  LINEAR light and encodes on output, so a wire at `rgba(120, 132, 145, 0.9)` has always been
  drawn lighter than that, and two translucent layers over one another have been drawn a
  different colour entirely — up to 87/255 apart from the configured value. The old chain is
  reproduced exactly by the rig (deep-band maxΔ 1, the encode's own rounding), so the
  difference is named rather than guessed. C2 settles which chain the stratified profile
  keeps. The rig retires with the old leg.

- **The flight on the ground — design-013, B7** (2026-09-07). Under the composited-next
  profile a nav flight is the ground's SECOND SLOT: the departed frame drawn beside the
  arriving one, from the world, every frame. **The descriptor** (`NavTransition`) now carries
  the departed frame's camera at the cut (`fromX/fromY/fromZ`) and `departedCameraOf(t, cam)`
  is the one rule for what the departed frame renders under — that camera ITSELF at p = 0 and
  while frozen, `outgoingCamera` through the affine otherwise; the DOM's departing plane
  (`PresentationTransitionFrame.outgoingCamera`) reads the same rule, so the two agree to the
  bit. **An enter starts from the live portal's exact camera**: `enterContainer` passes
  `outgoingCamera(M, camPre)` — the camera the container's face was already showing its inside
  under — not the continuity solve's ulp-off twin. **The first tick after the cut holds at
  p = 0** (`NavTransition.ticks`): one product frame is drawn at the exact `c0`, so the cut
  changes no pixel on the ground and the motion begins from a frame that exists. **`Retained`**
  is written at last: `startNavFlight` tags the departed frame's cards (the parent's on enter,
  the inside's on exit) and the tick releases them at the landing, on a gesture's yield and on
  abort — Residency keeps their textures for the flight. **The ground's side**
  (`FrameBuilder.flight`, `compose.stats().outgoing`): the departed frame's cards at rest in
  ITS OWN paint order (`buildOrdinals` of the departed parent — a card raised by a drag stays
  on top as it fades), with their content (`page`/`own` from the residency: the departed slot's
  records carry their textures), its own live portals, the entered container a HOLE the
  arriving slot draws through (one tree, `at`) on enter, the departed inside drawn OVER the
  parent on exit; the arriving frame dressed for its landing, the departed for the cut. The
  compose layer owns the `ground` presentation plane (an adapter that prepares instantly —
  without an owner a cross-type enter was gated to a snap). The `next-boot` rig's nav phase,
  through the real React path: the enter cut changes no pixel on the ground (maxΔ 0 over
  2560×1616 — the rest frame vs the held cut frame), one tree through the folder, both slots
  mid-flight, an exact landing, idle-zero inside, the exit's cut frame pixel-identical to the
  inside at rest (maxΔ 0, whole frame), an exact landing on the saved camera, the round trip
  pixel for pixel — ALL PASS. Two findings on the way, both fixed at source: the vf-frame
  pack's button springs reported settled without SNAPPING (a −1e-31 residue read as "hovered"
  to the shader's sign test — a card at rest must resolve exactly as a still of it does), and
  the builder's sibling-order index follows the CURRENT frame, so the departed frame must
  build its own ordinals. Four core tests (`nav-flight.test.ts`), three ground tests
  (`flight.test.ts` — the flight's `c0` equals `portalAt` on the preview's arrival bit for
  bit, on ICE's own data); design-006 amended (§9). The old ground's three outgoing
  strategies go unused under the new profile (B8 did NOT delete them: `programs/magnet-grid`
  declares `transition: "snapshot"` and is the shipping stratified grid, so design-011's
  `GroundProgram` contract is reshaped at C2 with that grid, not here); Q13 (the zoom-through) is
  not taken here.
- **IslandRender — the island half of composited-next, design-013 B5** (2026-09-07). A
  `gl` island now renders into the PRIVATE target Residency allocated for it, and the
  ground draws that texture as the card's content in `own` mode, on the device three
  already adopts. `createIslandRender({ gl, renderer, bridge, world, content })`
  (`@ice/r3f`) installs itself into the compose handle's `renders.island` slot, so it runs
  in design-013 §6's roster order — after the ECS settles, before GpuCompose's submit —
  and never in R3F's own loop, which stays `frameloop="never"` and presents nothing.
  `<GLViews>` selects that arm by reading the ground's content seam off a new React
  context; nothing about the old composited or stratified profiles changes.

  **Targets are keyed by HANDLE, not by entity.** Residency mints a new handle whenever a
  card's destination changes, so a resize allocates a new target and the old one is
  disposed when the table forgets it (`ContentResidency.onForget`, fired after the frame's
  submit). One authority decides what is sampled — the current `TextureRef` — so the
  **pin-blind-resize class dissolves rather than being fixed**: there is no refcount to be
  blind to. `Retained` (which B7 writes) is honoured by Residency's LRU alone; the old
  pools' `pin`/`isPinned`/`retired` refcounts stayed until B8 deleted that leg with them.

  **The demand clamp the old pass never read** (design-013 D10): `SurfaceDemand.mode ===
  "paused" ` renders nothing at all, and a live card's fps bucket is a ceiling on how often
  it renders — with the animation time still BANKED and delivered whole, so a clamped
  bucket changes cadence and never speed. A destination with no target yet outranks the
  clamp: a card that resized must not show its plate for an interval. Eligibility itself is
  unchanged and now shared — `islandPaintable` is the old pass's own predicate, extracted
  to `island-state.ts` so both legs ask one question. The island target's recipe (4× MSAA,
  depth, the sRGB REQUEST whose ANSWER the compose re-encodes on) moved to
  `island-target.ts` for the same reason.

  New in `@ice/react`: `useSurfaceContent()`, `SurfaceContentContext`, `surfaceContentOf`
  and the structural `ContentSink` / `ContentRenderSlot(s)` / `SurfaceContent` /
  `TextureDescription` mirrors of `@ice/ground/compose` (react may not import ground, and
  `@ice/r3f` imports these rather than restating them). New in `@ice/r3f`:
  `createIslandRender`, `createIslandTarget`, `islandPaintable`, and a
  `<GLViews onIslandRender>` prop for rigs. `GroundComposeStats` gains `runs` — the last
  frame's z-run count, the witness that two own textures really interleave in one pass.

- **DomRender — the pixels move, design-013 B4** (2026-09-07). A promoted DOM card's
  content now reaches the GPU. **`createDomRender`** (`@ice/ground/compose`, filling §6's
  reflector-5 slot `compose.renders.dom` once `Ground.create` resolves) copies the card's L1
  host with HTML-in-Canvas straight into the destination its `TextureRef` names — the page
  array's layer at `origin { x: u0·side, y: v0·side, z: layer }`, or a Q10 oversize card's
  own texture — and tells the content residency it WROTE that destination, so the ground
  draws `page` where it drew the plate. `copyElementToTexture`'s `origin` gained a `z` (the
  array layer); nothing else in the adapter changed.
  - **The L1 source canvas is wired in production** for the first time. The react facade
    builds it when the ground's handle carries the adapter's effects
    (`compose.sourceCanvas`, `null` on a host without the origin trial or without a working
    `layoutsubtree`), resizes its bitmap from the same rect `Viewport` comes from, and hands
    it to the dom reflector, which parents every `gpu`-target host under it and brings it
    back on demotion — portal-preserving, as a drag-lift always was. On a MIXED board the
    canvas is pointer-transparent (`createSourceCanvas({ pointerEvents: "none" })`) and the
    hosts it adopts set `pointer-events: auto` on themselves, so `dom`-target cards under it
    keep their hits.
  - **One `geometry()` call sizes both ends.** DomRender owns the L1 host's box while the
    host is canvas-side and writes `geometry().cssSize` — band space under `band`, live-zoom
    space under `crisp` — with `zoom / band` on the placement matrix; Residency reserved
    `geometry().slotSize` from the same pure function on the same facts. `groundCompose({
    raster })` declares the per-kind strategy once and the profile carries that same function
    to Residency, so the two readers cannot disagree. Measured: **0 px written past the slot**
    at zoom 1.9 under both strategies, where the old leg's binder wrote 40,272.
  - **The demand clamp is carried in behaviour** from the old binder: a paused card is
    PARKED (no copy, no wake, outside `pending` — it costs nothing rather than merely
    uploading nothing, and its plate is honest), a bucket DEFERS to the moment it allows
    (behind, never wrong), 0 copies now. An unpainted host's `InvalidStateError` is counted
    and the debt KEPT. `compose.domRender.stats()` reports `{ copies, dirtied, refused,
    unavailable, parked, deferred, pending, resized, pagesLayers, growths }`.
  - **The page array grows** by realloc + a per-layer `copyTextureToTexture` in one encoder
    + a new realisation, the old array dying at the next `collect` — after the submit
    (D-B4.1).
  - `PresentationProfile.hostsBeforeRoster` (opt-in, composited-next only) runs the dom host
    reflector BEFORE the profile's roster, so a promotion is reparented in the same flush the
    render copies from. `hic-adapter` left both dependency-cruiser wall lists: it is a kept
    leaf imported by both legs, not old leg.
  - Exit — the new `next-render` rig: D7's promote diffs **0 of 70,176 px** on the card's
    interior and again on the way back; S8's parity, redefined, is **0 of 70,176 px** against
    a stratified twin page with an A-vs-A control at 0; idle-zero holds with promoted cards
    (0 submits, 0 copies over 361 frames); an animating card copies 23.3/s against 59.8 paint
    marks/s, a paused one 0. Plus 27 node tests and 11 mutation probes.
- **The content term reads the world — design-013, B4a** (2026-09-07). The trunk B4, B5
  and B6 build on: under the composited-next profile the ground now draws a card from the
  TEXTURE its `TextureRef` names — `page` (the layer and the written rect, through the one
  page-array binding) or `own` (the run's texture, the sRGB pipeline chosen by the texture's
  ACTUAL format) — once a render reflector has realised the handle and written the
  destination; the plate until then (`empty` is never sampled: a fresh slot, a re-slot after
  an eviction, a promoted card whose copy has not landed all draw the plate — a write is owed
  per destination, keyed by the ref's own values). **`ContentResidency`**
  (`@ice/ground/compose`, `compose.residency`): `attach(table)` · `realize(handle, texture,
  { owned? })` — every realisation goes through it, a re-realisation of the same handle
  (a page array that grew, D-B4.1) retires the earlier texture at the next `collect`, after
  the submit · `wrote(entity)` · `touch()` (the dirt latch outside the world; the builder
  wakes on it, `WakeReason "content"`) · `contentOf(entity)` · `pagesView()` (the host
  rebinds `Ground.setPages` when it changes) · `collect()` (the table's drain as the destroy
  list, `onForget` for a producer's own object) · `stats()`. **The profile owns its texture
  table** (`createResidencyStore` at install, attached to the ground, passed to the surface
  infra with the device's `maxTextureDimension2D`, disposed last). **Three render slots**
  (`compose.renders.{dom,island,video}`): the profile registers a forwarder for each in §6's
  order (5–7, before DomCompose and GpuCompose), so a render installed after the mount — the
  ground's DomRender, the r3f island root, a video producer — runs in its place. The frame
  builder journals `SurfaceTarget`/`TextureRef`, emits every card's content term, counts
  `textured`, and names each host entry's `target`. Seven tests on a real engine with the
  surface infra installed; the profile test pins the table's ownership; the oracle's 47
  renders byte-identical; `next-boot` at B3b's numbers. No pixel changes until B4 realises
  the first texture.
- **The DOM boundary — design-014, B3b** (2026-09-07). Under the composited-next profile a
  DOM card's host is CONTENT only: chrome exists once, on the ground. **DomCompose**
  (`groundCompose`'s `compose.domCompose`, registered by the profile just before GpuCompose)
  runs the frame's build and writes each card's content element change-only — `clip-path`
  as a polygon marched from the card program's inner distance field (`CardProgram.inner`,
  recomputed only when `clipKey` says the shape moved: the reveal's ~300 ms, never a pan or
  a lift), the lift on `transform`, the hold's opacity — and GpuCompose draws the same
  geometry. **The router's part channel**: the interaction stack carries a `framePick` slot
  (`FramePickSource { pad, hit }`) the ground fills at mount with its last-drawn geometry
  through the program's `pick()`; `picking` widens the hit past the content rect by the
  chrome's reach and asks the source, writing `PointerPart` on the pointer change-only; a
  recognizer spawned on a part carries `DownPart`, arbitration withholds the move route from
  it (a press on a control never lifts the card), the select behaviour hands the tap over as
  the `PartTap` resource instead of selecting, and `groundCompose({ onPart })` is the app's
  action. A rounded corner's void and a press on the chrome band now pick as drawn: the band
  is a drag handle, the corner is the canvas. **`useChromeOwner()`** (`@ice/react`, from the
  profile's `chromeOwner`: `ground` for composited-next, `dom` otherwise) lets an app's card
  shell render bare under the ground — widgetlab's CardShell and its folder view do, so the
  folder's face is the ground's live portal and its DOM minis retire; the STRATIFIED profile keeps
  its CSS chrome (corrected at B8: the deletion took the old COMPOSITED leg, not the stratified
  one, and widgetlab-desktop keeps a stratified fallback for hosts without WebGPU — CardShell's
  dual path retires with that profile in Phase C). The `next-boot` rig's boundary phase: every card's clip written
  as a polygon; the ring band and the shadow skirt read the same on the page with the DOM
  hosts shown and hidden (chrome once), the title differs (content above), the folder's face
  is the portal; a click on the ground-drawn close button reaches `onPart("close")` and
  neither grabs nor deselects; a drag begun on the band moves the card — ALL PASS. Four core
  tests drive the pick through the full stack. A portal's inside now resolves unrevealed
  (`IDLE`), as an unselected card is. Deferred to B4: the D7 promote witness and the parity
  redefinition (both need content the compositor draws); the P4 resize grips stay DOM chrome.
- **The ground's pack seam — design-014, B3s** (2026-09-07). The ground engine now ships
  only what every infinite canvas needs and what depends on a world fact: the lattice and
  the field bake, the DOT glyph, the slot tree and the compositor, the SHELL card (a
  rounded plate at the card's radius, the §5 shadow, a hairline, the ring on selection —
  which is also the drop cue on the accept tier), and the springs on `Selected` / `Grab` /
  the drop pair. Everything that is a LOOK is a pack an app registers through
  **`@ice/ground/packs`**: `needleGlyph` and `cuttingMat` (grid programs — `instanced`
  over the engine's bake, or `surface` with a pass of its own) and `vfFrame()` (a card
  program — VibeField's composed corners, buttons, delete morph and cast light). Three
  seams and no more: a grid program (`field/program.ts`), a card program
  (`card/program.ts` — the record is a HEAD every program shares plus `ext` tail slots the
  program owns, built per program by `frameStruct`; the pass composes one `card.wgsl`
  that calls the program's `shade_card` below the content and `shade_over` above it, so
  the additive seam law is the engine's), and the theme (a head plus one section per
  pack, `themeFrom(name, palette, grid, packs)`; a pack's colour literals live in its own
  `theme.ts`, a home the literal gate accepts). `Ground.create({ card, grids })` and
  `groundCompose({ card, grids, onPart })` register them; the frame builder resolves
  through the program, journals its extra facts, and lets it report a live spring. The
  engine's default glyph is the DOT (ICE's old-leg `DEFAULT_GRID_MAGNET_CONFIG` keeps the
  needle until B8). Moved out of `@ice/ground/compose` into the packs entry: `resolve`,
  `STYLES`/`PRODUCT`/`composeStyle`, `pick`/`sdInner`, the heat's `HEAT`/`irradiance`,
  and every `mat/*` export with `MAT`, `MAT_GRID`, `NIGHT`, `MAT_LIGHT`; `Frame` /
  `FrameUniforms` became `frameStruct(ext)` / `frameUniformStruct(uext)`; `FieldConfig.mat`
  became `ext.mat` (`withMat`, `matConfigOf`); `stepMotion` lost its button inputs (the
  pack's `stepVfSprings`); `GroundTheme` lost the frame's inks and `matLight`
  (`vfSectionOf(theme)`, `matLightOf(theme)`). Witnesses: the oracle's 44 renders through
  the relocated pack are byte-identical to the pre-fold stash; three new shell scenes are
  the engine card's own baseline; the `next-boot` rig with the packs registered is ALL
  PASS at the same numbers; 380 tests. widgetlab registers all three packs as its own
  choice; VibeField registers them through the pin. The DOM boundary (chrome-less hosts,
  CardShell's retirement) is B3b.
- **The composited-next profile draws the world's cards — B3a, compose in plate mode**
  (design-013 §8 B3, 2026-09-07). `groundCompose()`'s GpuCompose now builds every frame
  from the world through the frame builder (`createFrameBuilder`, `@ice/ground/compose`):
  every widget Active in the nav frame, in sibling order, becomes a card frame over the
  theme's plate and a field source; `Selected` runs the reveal, `Grab` IS the lift (scaled
  by `ChromeSettings.liftScale`, read live), the drop pair `OverlapCandidate` /
  `OverlapRejected` with the recognizer's `DragBounds` is the heat — the springs live in the
  builder, never in the world, and a card out of sight forgets them; a container whose face
  passes the gate carries a live portal from `engine.previews` (the snapshot's
  `resolvedView` IS the flight's arrival: `portalAt()` — new — is `portalOf()` past the
  gate on a solved arrival, bit-identical, so the enter cut stays exact on ICE's own data)
  and its frame is a hole cut to the face. The reflector's dirt is PULLED: a strata change
  collector (`coarse: false`, the attestation core's churn guard already makes) journals the
  facts a build reads, the sibling order's own stamp and two out-of-world wakes (a settings
  write, a preview change) complete it — a Tier-1 `observeQuery` on Position/Size woke every
  frame a selection existed, because the selection chrome declares a Position/Size write and
  that is a column-wide stamp. `compose.stats()`, `compose.wakes()`, `compose.geometryOf(e)`
  and `compose.motionOf(e)` are the instruments; `groundCompose({ cards })` tunes the
  builder; the react `ground` factory's context gains `previews`. The `next-boot` rig grows
  a board phase: 6 real widgets and a folder with 3 inside through `spawnWidget`, pixels
  read back off the ground canvas (a card's centre is `--vf-card`, a gap is
  `--vf-canvas-bg`, the folder's face is its inside's ground — a hole — while its bar is the
  plate), idle-zero with cards on the board and again after a selection settles, the lift on
  Grab (scale 1.05 and back), the heat (presence 1 at the accept tier, the plate under the
  light brighter, fade-out on clear) — ALL PASS. Depth-one portals only (a preview child
  carries no entity — D-B3.2 owed); the DOM hosts still paint their own chrome and the
  folder its DOM preview above the ground — B3b takes the DOM boundary (chrome-less hosts,
  `clip-path`), the router's frame hit test and the redefined parity.
- **`compositedNextProfile` and `groundCompose()` — the NEW composited profile, beside
  the old one** (design-013 §8 B2, 2026-09-07). `<InfiniteCanvas profile={compositedNextProfile}
  ground={groundCompose({ device, theme })}>` boots the ground's own canvas as the L0
  layer on the app-owned device and registers design-013 §6's roster in order — DomRender ·
  IslandRender · VideoIngest · DomCompose (inert stubs holding their place until B3–B6) ·
  GpuCompose, the ground's, last — plus the surface infra set the old profile installs. At
  B2 it draws an EMPTY board (the field under ICE's own defaults, the theme's clear colour)
  on a camera or viewport change and nothing otherwise: the `next-boot` rig
  (`apps/widgetlab-desktop`, `pnpm --filter widgetlab-desktop next-boot`) mounts it through
  the real React path and measures one redraw and one submit at boot, 0 submits over 4 s
  idle, and one frame for a camera write. The profile refuses a device-less engine and the
  old leg's `ground()` layer BY SHAPE (a handle with no `compose`, `composited.ts:79-85`);
  dependency-cruiser walls it from the old profile both
  ways. `groundCompose`'s handle maps the react `grid` prop onto the field
  (`fieldConfigOf`) and takes a new theme (`compose.setTheme`). The old profile is untouched.
- **`@ice/ground/compose` — the ground moves in** (design-013 §8 B1 [GROUND PORT],
  2026-09-07). `vibe-field/draft/ground` enters ICE once, into its final home, as a second
  entry of `@ice/ground` beside the old composited leg — which imports none of it and is
  deleted at B8 (done); dependency-cruiser holds the wall both ways, now as the Phase-C fence.
  What it is: the raw-WebGPU
  engine (`@ice/ground/engine`: device, surface, targets, pipelines, shader composition,
  struct layouts), the magnet field on the decade lattice and the cutting mat with its two
  lights, the SDF card frame with the content term and the §7 heat, the live portal's slot
  tree (the chain, the face, the grown fill), the flight's second slot, the theme's engine
  half, and `Ground` itself — `Ground.create({ device, canvas, ...GROUND_SHADERS })` on a
  device the HOST owns (`acquireCompositorDevice()`). The flight's maths import
  `@ice/kernel`'s `nav-flight` (the copy the draft carried is gone; the ported tests pin the
  kernel's functions to the same numbers). WGSL stays the source under
  `packages/ground/shaders/`; `gen:shaders` writes the string module the entry ships and
  `gen:check` gates its freshness. Wired into NO profile yet — B2 registers the new one.
  With it: the Node oracle (`pnpm --filter @ice/ground oracle` — Dawn through `webgpu@0.4.0`,
  EL8-pinned, run by `tsx` because the kernel's imports are extensionless; 44 scenes and 12
  self-checks) whose renders are byte-identical to a stash taken in the draft before the
  move, and the `groundlab` app (`apps/groundlab`: the tweak-panel lab and thirteen Chrome
  rigs, `pnpm --filter groundlab rig:<name>`). The old barrel is untouched.
- **The presentation facts** (design-013 §5): components `SurfaceKind` ·
  `SurfaceTarget` · `RequestedDemand` · `SurfaceDemand` · `SurfaceBand` ·
  `TextureRef`, the tag `Retained`, the `NO_TEXTURE` sentinel, and
  `effectiveTarget(kind, target)` — the one function every reader of
  `SurfaceTarget` goes through, so a `gl` or `video` surface can only ever
  answer `gpu`. All six are stamped at EQUIP with safe defaults and
  value-written thereafter; no component is added or removed at interaction
  rate. `DragBounds` joins them on the Drag recognizer, written by `dropSystem`.
- **The three standard surface behaviours** — `ice:surface.domAtRest`,
  `ice:surface.alwaysGpu`, `ice:surface.alwaysDom` — exported as `domAtRest`,
  `alwaysGpu`, `alwaysDom`, with `STANDARD_SURFACE_BEHAVIORS` and
  `registerStandardSurfaceBehaviors(runtime)`. `createCanvasEngine` registers
  all three before `opts.behaviors`, so a facade app needs no wiring at all.
  `domAtRest` is the ratified dom default: live DOM at rest, GPU the same frame
  as the grab, back one settle window after the release — and the window now
  expires on `FrameInfo.clock`, the engine's clamped-dt human clock, rather
  than `performance.now()`.
- **`present:infra`** — a twelfth pipeline group, after `present`, so a kind
  behaviour registered long after boot still reaches the clamp in the frame it
  writes. `installSurfaceInfra(engine)` installs the Band and Demand systems
  into it as ONE call returning one remover, and `PresentationProfile.install`
  is where a React profile makes that call.
- **`geometry()`** (`@ice/kernel`) — `(size, band, dpr, zoom, raster)` to
  `{ cssSize, backingScale, rasterSize, slotSize, written, placement }`, the
  one call that gives a copy size and its uv together.
- **`createBehaviorRuntime`** is exported from core, with `BehaviorRuntime`,
  `BehaviorRuntimeOpts`, `BehaviorSession` and `BehaviorPresence`. A facade app
  never names it; an imperative host that drives the raw engine needs a runtime
  to register behaviours into.
- **Residency** (design-013 §4) — the module that replaces "atlasing", and the
  third system of the `present:infra` trio. `createLayerAllocator` seats slots
  in fixed 2048² layers keyed `(entity, band)`; `createTextureTable` is what a
  `TextureRef.texture` handle means (`pages` · `own` · a producer's registered
  `stable` texture), refcounted; `createResidencySystem` is the one writer of
  `TextureRef`, gating allocation on `Visible ∨ Retained` and taking cold keys
  only under budget pressure; `createResidencyStore` builds the pair a host
  installs. `installSurfaceInfra(engine, { residency })` (`ResidencyOptions`)
  installs it, and the React composited profile passes it.
  `DEFAULT_RESIDENCY_BUDGET_BYTES` is 256 MB — **a placeholder until B3
  measures one on a real device.** Allocation is computed purely and written to
  the world; nothing is realised on a GPU and **nothing reads `TextureRef`
  before B3**, by design.
- **`ResidencySystemOptions.maxTextureSize`** (also on `ResidencyOptions`, threaded
  through `installSurfaceInfra`), default 8192 — the floor every WebGPU adapter guarantees
  for `maxTextureDimension2D`. An `own` texture request larger than it on either axis is
  scaled down UNIFORMLY — never refused, never squashed per axis; the compose maps the
  whole texture onto the card — and the clamped size is what the residency budget counts.
  Closes design-013 D11: under `band`, `geometry()` asks for `size × band × dpr`, so a
  2000-unit card at band 16 on a dpr-2 display asked for 64,000²; it is 8192×4096 now.

<!-- design-013 B6 (2026-09-07) -->
- **VideoIngest — a live surface on the composited-next profile, design-013 B6**
  (2026-09-07). `groundCompose`'s handle gains **`compose.video`**
  (`createVideoIngest`, `@ice/ground/compose`), installed at the mount into the profile's
  `video` render slot (§6's reflector 7, before DomCompose and GpuCompose):
  `register(entity, { width, height, srgb? })` mints the stable handle Residency names in the
  card's `TextureRef` (whole uv) and realises an `rgba8unorm` (or `-srgb`) texture with
  `COPY_DST | TEXTURE_BINDING | RENDER_ATTACHMENT` against it; `arrive(entity, source)` queues
  the latest frame (`VideoFrame`, `ImageBitmap`, a canvas, a video element) and closes what it
  supersedes; the reflector copies each queued frame once
  (`copyExternalImageToTexture`, premultiplied, no flip) and says the destination was written,
  which is what wakes the builder; `unregister`, `stats()` (`registered · arrivals · copies ·
  dropped · paused`, with `arrivals === copies + dropped`) and `dispose`. The demand clamp is
  honoured at the door: a paused card's arrival is dropped and closed, and an fps bucket
  allows one copy per `demandIntervalMs`. A registered card whose destination goes away and
  comes back — culled and scrolled back — owes NO new copy: the texture is the producer's, its
  pixels are still in it, and the ingest re-asserts the write (without which a paused live
  surface would draw the plate forever, having no next frame to pay the debt with).
  **Exit rig `next-video`** (`pnpm --filter widgetlab-desktop next-video`): every production is
  one copy and one compose frame (33/33/33 over 181 frames), the fixture's top-left marker
  lands top-left, six distinct liveness colours over eight productions, a paused card at 0
  copies and 0 submits over 181 frames while its producer keeps producing, idle-zero over
  362 frames, and a registered-but-never-fed card on the plate.

### Changed

- **The ported ground's imports lost their `.ts` suffixes** (B2, 2026-09-07 — design-013
  B1's D-B1.1 reversed): every consumer app that typechecks would otherwise need
  `allowImportingTsExtensions`, and a bundled `.d.ts` would carry the suffixes to the
  package's users. The Node oracle already ran through `tsx`, so the suffixes bought
  nothing. 163 specifiers in 43 files; the 44 oracle renders stayed byte-identical.

- **`SurfaceDemand`'s equip default is `live/60/false`** (was `paused/0/false`;
  `RequestedDemand` is unchanged). design-013 D2 chose `paused` to spare "the frame
  between equip and the first clamp", but that frame does not exist — equip's adds land at
  the derive flush and the clamp runs in `present:infra` in the same tick — while the
  default's one real effect is in a host that installs no Demand system, where `paused`
  parked every equipped card forever and `live/60` is exactly the pre-A1a behaviour.
  Breaking only for code that read the stamped value before the first clamp.

### Fixed

<!-- design-013 B8 (2026-09-07) -->

- **A promoted card's L1 host now tracks the camera.** `DomRender`'s `placeHost`
  was reachable only through the copy path, so a card that owed no copy was never
  re-placed and its host stayed where the last copy left it. An L1 host is never
  painted, so nothing LOOKED wrong — but it is the hit-test, focus, caret and IME
  truth for a promoted card, and a pan walked it off the card it belongs to. Found
  by the `input` rig, ported to this profile at B8: **7 of 24 mid-gesture hits
  landed, the host up to 540 px from its card.** DomRender now runs a placement
  pass at the end of every flush over the hosts it owns, change-only. After:
  **24/24, max offset 0.000 px over 120 frames**, and idle-zero unchanged (0
  submits, 0 copies, 0 DOM writes over 361 frames with three promoted cards).
- **…and a pure pan still uploads nothing.** With placement running every frame,
  a 600-frame pan re-uploaded the whole promoted board — 1,404 copies — because
  the placement write raises a paint event naming the host, which
  `changedElements` reports identically to a content edit. `@ice/dom`'s
  `source-canvas.ts` header names the remedy and B8 implements it on this leg: a
  TEMPORAL guard kept by the writer that knows what it wrote. `DomRenderStats`
  gains **`selfDirt`** — the marks dropped as this module's own placement writes.
  After: **0 copies over 600 frames, all 3,606 marks attributed**, and typing
  still reaches the copy path (a filter, not a mute).
- **`promotable()` and `canvasEligible()` are ONE predicate** (`@ice/dom`). They
  disagreed about a `video` card: `promotable` asked the widget definition for
  `!== "gl"` and missed `video` entirely, while `canvasEligible` asked the world
  and excluded both — so a grabbed video widget took the `lifted` branch that
  `canvasEligible` was written to refuse. Reachable since B6 made
  `defineWidget({ surface: "video" })` legal. The one predicate reads the world's
  `SurfaceKind` stamp when it exists and the definition when it does not, which
  neither reader did alone.
- **An `own` texture's `srgb` is the KIND's fact, not a default** (`@ice/core`).
  `ownFor` minted every private handle `srgb: false`, so the table said `false`
  for an island target that IS `-srgb` — a lie that only held because the ground
  reads the texture's actual format rather than the table. `gl` now mints `true`
  and Q10's oversize `dom` slot `false`.

- **A React composited app now DECIDES to promote on drag — the decision half,
  not the pixels.** `infinite-canvas.tsx` built `domWidgets` without a
  `PresentationRegistry` and nothing in `@ice/react` created the policy, so no
  React app had a promotion decision at all; the rigs hand-wired both and were
  the only thing that ever saw one. The standard behaviours are
  engine-registered and the DOM layer reads the world, so there is no decision
  wiring left for an app to forget: a drag flips `SurfaceTarget` to `gpu` and
  every reader sees it. **No pixels move there yet** (errata 2026-09-07: true of
  this entry's commit only — DomRender copies a promoted card's pixels since B4,
  see the B4 entry above). `infinite-canvas.tsx`
  still builds the DOM reflector with no source canvas, so `placementOf` never
  answers `canvas`, no host is reparented, and nothing is composited — the L1
  host path for React lands with design-013 B3/B4. The rigs remain the only
  place a promotion reaches the screen.
- **The old composited leg's demand parking follows the clamp.** When a caller
  passes no `atlas.demand`, `createCompositorWiring` feeds the dom source
  binder from the `SurfaceDemand` component instead of throttling nothing. A
  host that genuinely throttles from elsewhere still passes its own callback.
- **`domAtRest` demotes only what it promoted.** It took ownership of every
  grabbed card whether or not it changed anything, so a card a host had put on
  the GPU by hand came back from its first drag owned — and 250 ms after the
  release was demoted to `dom` for good, since nothing re-promotes a card that
  is not being dragged. Ownership now follows a real change, which is the rule
  the policy this behaviour replaced always had.
- **`domAtRest` refuses a non-dom kind at `init`.** It declared `SurfaceKind` in
  its reads and never looked at it, so a `gl` or `video` widget that named it
  was accepted, presented correctly, and then wrote `dom` on a texture at the
  first demotion — which surfaced as the Band system's dev throw a frame later,
  naming an entity id and no cause. It now refuses exactly as `alwaysDom` does
  (a dev throw naming the widget type; in production a log and no write), and
  never writes the target of a kind it is not for.
- **The behaviour runtime rebuilds its instance snapshot only when membership
  moves.** Every delivery spread the whole instance map into a fresh array, and
  a behaviour that reads a resource delivers every frame — so `domAtRest`,
  attached to every dom widget, paid one O(instances) spread per idle frame for
  a list that had not changed. `ctx.entities()` semantics are unchanged: it is
  still the membership as of phase entry, and a hook that attaches or detaches
  still affects the next frame.
- **Residency review fixes (A3a).** The published atlas layer count now spans the live
  layer ids (`LayerAllocator.layerCount()`, max id + 1 — `retireEmpty()` can leave holes,
  and a card must never name an array index the array does not have); a `world.reset()`
  no longer strands held slots, pinned references or stable registrations (a dead-entity
  sweep on every full walk; `TextureTable.stableOwners()`); an empty layer retires after any
  frame that gave an ATLAS slot back, not only under budget pressure (only an atlas slot
  can empty a layer, and a layer costs its full `layerSize² × bytesPerPixel` from first
  allocation, so retiring an emptied one is what actually returns memory); a producer's `register()` /
  `unregister()` wakes Residency (`TextureTable.revision()`); an unrealised handle is
  forgotten the moment its count reaches zero — only realised handles wait in `drain()`.

## [0.12.0] — 2026-08-31 · a git release point, NOT published to npm

**Install 0.13.0 for everything below.** The cut was real (`903f892`, CI green,
pack dry-run 259 files) and the entry stays rather than being folded upward, but
design-013's Phase A landed before a publish went out and the registry goes
0.11.0 → 0.13.0 in one step. The `WidgetSurface` → `WidgetSurfaceKind` break
below is part of that upgrade.

### Breaking, narrowly

- **`WidgetSurface` is now `WidgetSurfaceKind`.** The `"dom" | "gl"` union that
  types `defineWidget({ surface })` is renamed, because design-012 §11 Q7
  ratifies `WidgetSurface` as the name of the PRESENTATION CONTRACT — the
  per-widget view of kind, current presentation and demand — and the two
  meanings cannot share one name. Migration is ONE identifier: import
  `WidgetSurfaceKind` wherever you imported `WidgetSurface`. A consumer that
  passes `surface: "dom"` to `defineWidget` without ever naming the type is
  unaffected. The union is now DERIVED from the compositor's own kind list
  (`Extract<SurfaceKind, "dom" | "gl">`), so adding a surface kind cannot let
  the two lists silently disagree.

### Added

- **`defineWidget({ presentation })`** — a widget type may declare the mode it
  starts in, or PIN one that policy may not change (design-012 §6.3):
  `{ default?: SurfacePresentation; pin?: SurfacePresentation }`. Refused at
  DEFINITION time when it cannot hold: `live-dom` on a `gl` surface (an island
  has no native paint to fall back to), or a `default` beside a `pin` — the
  latter even when the two AGREE, since a pin has already taken policy out of
  the decision and a `default` beside it reads at the call site as an intent
  that will be honoured. Absent is the ratified default and is right for almost
  every widget; the stratified profile has no promotion and ignores it.
- **`CompositorSourceVideo.onArrival`** — an optional
  `(cb: () => void) => () => void` subscription carried by a registered live
  surface. A producing surface now wakes the compositor BY ITSELF instead of
  compositing only while something else happens to be dirty; the compositor
  holds the subscription and drops it when the source is replaced or removed.
  Optional, and a source that omits it composites exactly as it did before.
- **`@vibecook/ice/r3f/webgpu`** — the WebGPU renderer leg (shared-device
  `WebGPURenderer` adoption) now reaches the published package, mirroring the
  workspace's `@ice/r3f/webgpu`. Deliberately its OWN subpath: importing it
  pulls `three/webgpu`, which must never ride along with plain `./r3f`. Note
  the declared `three >=0.160` peer range is the plain-r3f floor; the device
  injection this subpath performs is verified against three r185 — treat
  ~0.185 as its effective floor.

### Fixed

Fifteen defects from a full-range review (2026-08-31), every fix carrying a
regression test proven red against the pre-fix code. Document integrity: a
legacy schema-2 document now reaches its 2→3 migration instead of gating
read-only on a dependency closure only that migration can satisfy; an envelope
whose optional `rootCanvas` mirror is ABSENT opens healthy (only a PRESENT,
conflicting mirror disagrees); a runtime extension re-arms after a
breaker-rolled-back fault, so its outputs recover on the next dispatch; a
widget spawned into the open frame is selectable before the first `step()`.
Presentation: settle-window demotion returns a card to its DECLARED
`presentation.default` (one grab no longer strips `picture`); despawn clears
the presentation entry, so a recycled entity id no longer inherits
`composited`; a profile refusal in `<InfiniteCanvas>` unwinds cleanly and a
remount reports the real reason instead of "plane already owned"; an adapter
that unregisters while a transition is PREPARING gets its retainer released.
Compositor: one paint on a paused/bucket-0 card no longer spins the compositor
(idle-zero holds for parked demand); a slot the atlas cannot seat is clamped
uniformly and its refusal answered — never a copy across the gutters;
`groundHost` now composites at full parity with `ground()` via one shared
wiring; `ground({ lift })` actually advances the lift and keeps compositing
until the ease settles; the offscreen ground target is disposed with its
layer; the quad pass sweeps bind groups for textures nothing draws;
`freeRect` refuses a double free. Islands: a PINNED render target that
outgrows its size is retired, not destroyed — a nav-crossfade clone keeps its
pixels through the hold.

- **Known issue (composited profile only, confirmed post-cut by a real-GPU
  rig):** a dom card whose live zoom drifts above its atlas band (band
  hysteresis tolerates up to 2×) rasterises larger than its slot, and the
  extent-less copy writes past it — silently into the gutters and the
  neighbouring slot while the raster still fits the page, and as a refused
  (blank) copy when it does not. Reachable by zooming in while a card is
  composited (grabbed, pinned, or resting composited) and then dirtying its
  content. The fix is a pending band-policy ruling; the measurement and the
  options live in `docs/implementation-plan.md` M18. The stratified profile
  is unaffected.
- The entries above are the consumer-visible surface of the design-012
  UNIFIED COMPOSITOR. `docs/implementation-plan.md` M18 carries the whole of
  it — the ladder, the profile model, the measured exits and the standing gaps
  — and `docs/downstream-petitions.md` records what it does and does not ask of
  a consumer. The compositor reaches an app only through the composited
  presentation profile, which a build selects deliberately; a stratified build
  is byte-for-byte the engine it already was.

## [0.11.0] — 2026-08-25

### Changed

- **Grid implementation selection is now build-time.** Classic and magnet
  are independent `GridPassFactory` implementations over the same
  `GridConfig`/`GridPassDeps` contract. The tiny `passes/grid.ts` wiring
  module imports exactly one factory; production currently wires magnet, so
  the classic renderer, material and declarations are unreachable from the
  package entry graph and absent from the runtime bundle. Wiring classic back
  is a single re-export change—there is no runtime renderer switch, retained
  inactive material, or first-toggle compilation path.
- **Magnet is the production grid.** `GridMagnetConfig.enabled` is removed;
  dot/needle remains a live glyph uniform within the one magnet renderer.
  WidgetLab now starts on magnet needle and keeps `?magnet=dot` only as a
  dot-glyph verification preset.

### Fixed

- **Magnet grid: dot glyph is visible on both backends.** The manual
  screen-to-NDC Y flip reversed the dot quad's winding, while the needle's
  reflected orientation basis happened to cancel that flip. Three's default
  `FrontSide` culling therefore rejected every dot before fragment shading.
  The symmetric dot now reflects its local Y to keep both glyph branches
  front-facing (design-010 §10.9).
- **Magnet grid: rest lattice survives zero-source frames.** The TSL builder
  emits site reconstruction at first USE — inside the source loop — so a
  frame with no packed sources (`fadeZoom` valve active, no poles, widgets
  off) garbage-positioned every glyph. `col`/`row`/`screen` are now pinned
  with `.toVar()` before the loop (design-010 §10.9).

## [0.10.0] — 2026-08-25

**The magnet grid — design-010 / M17.** The dot grid's PIXELS become a
field-reactive lattice; its interfaces do not change. Ported from the
vibe-field `draft/magnet-grid` WebGPU experiment (WGSL → TSL) with the
upgrades the experiment lacked: an rbush broad-phase over the ONE spatial
index, N injected poles, and config valves. The classic analytic grid remains
the default renderer — a consumer that never mentions `magnet` is
byte-identical to 0.9.0.

### Added

- **`GridConfig.magnet?: Partial<GridMagnetConfig>`** (+
  `DEFAULT_GRID_MAGNET_CONFIG`): the magnet mode — needle or dot glyphs over
  a superposed field of widget-silhouette SDF sources (rounded rects; a large
  card is a large magnet, needles wrap the silhouette) and injected point
  poles. `configureGrid`/the react `grid` prop deep-merge the `magnet` key one
  level, so partial re-tunes never clobber the block. ABSENCE of the block is
  the off state — the default config deliberately does not carry an explicit
  `enabled: false` (it would ride every consumer that spreads
  `DEFAULT_GRID_CONFIG` into its own grid state and clobber a factory-level
  enable at the configureGrid seam). Perf valves: `maxSources` (≤256,
  largest-screen-area-first; poles never evicted) and `fadeZoom` (the FIELD
  lerps out below a zoom threshold; rest ticks remain — scale 0 also skips
  the spatial query). One read-only storage buffer, `setPBO` on the WebGL2
  fallback — the same node graph compiles on both backends.
- **`GroundOptions.poles` + the `PoleSource` protocol** (`Pole = {x, y,
  strength, space?: "world"|"screen"}`): point sources are INJECTED — the
  grid pass knows no cursor/presence vocabulary, and the cursor effect is
  opt-in by construction. Poles pack as degenerate SDF boxes (half = 0,
  r = 0 reduces exactly to the point-charge formula). Canned wirings:
  `localPointerPoles()` and `cursorVisualPoles()`; apps with their own cursor
  entities write a ~15-line adapter (widgetlab's `?magnet` halo adapter is
  the reference).
- **`GroundContext.readSpatial`**: broad-phase rect reader over the shared
  spatial index (the `readWirePreview` precedent) — the magnet's widget
  sources query viewport ∪ influence-halo instead of walking the document,
  so total document size is irrelevant by construction. The react facade
  wires `stack.index.search` automatically; `SpatialVersion` observation
  wakes re-collects.

### Notes

- Measured (headless, both backends): settled-idle ground redraws are 0 with
  magnet on at +0/+50/+128 widgets; a pointer sweep costs one redraw per
  moved frame. An on-device GPU A-B is still owed before the mode is
  ADVERTISED as default-on anywhere (design-010 §6.4).
- Pole sources that ease (cursor springs) must gate their writing systems
  (`runIf` + `makeVersionGuard`): strata blanket-stamps declared writes on
  every RUN, and an ungated easing system wakes the field's observer every
  tick (design-010 §10.7 — found by this release's redraw instrumentation).

## [0.9.0] — 2026-08-17

**The ephemeral facet byte claim — petition I19.** VibeField's document-room
presence lane fragments ICE presence frames over honestly-lossy 1,150-byte
datagrams, and its probes (PRC4-E22) showed the admission gap: a legal
ephemeral behavior's string/json cells have no byte bound, sixteen at the
per-plugin cap emit a 66 KB presence frame against a 64 KB logical-message
ceiling, and an oversize frame can neither be attributed to its producer nor
dropped without going stale for every OTHER facet riding it. The behavior
declaration — the place that already routes store, write vocabulary, cadence,
and breaker — now carries the producer's own resource claim.

### Added

- **`maxFacetBytes` on `defineBehavior`** (ephemeral only; optional): a hard
  ceiling on the canonical UTF-8 JSON bytes of the behavior's COMPLETE facet
  cell after defaults/merge/serialization — the value placed in the local peer
  blob, deliberately not a wire-frame guess (the host budgets encoding and
  transport headroom on top of the claims it admits, and keeps its independent
  transport cap). Enforced in PRODUCTION at both mint paths: an over-budget
  DEFAULT fails the definition itself — unconditionally, outside the dev-guard
  gate, leaving no residue — and an over-budget `ctx.write` throws BEFORE
  mutating presence, leaving the prior facet intact. In-hook, the throw feeds
  the existing fault ladder (per-entity `onFault` attribution, BF-D18 three
  strikes, I17 withdrawal on quarantine); through the blessed captured-closure
  path the caller gets the same refusal synchronously — the bound cannot be
  bypassed. Identity-bearing: part of the definition signature (a redefinition
  changing only the claim is a DIFFERENT shape) and of `describeBehavior()`
  (absent = no bound attested, so hosts can refuse unattested declarations).
  14 acceptance tests (`behavior-facet-budget.test.ts`), each enforcement
  point mutation-probed.

### Fixed

- **Ephemeral store-routing holes** (the I19 round's audit): the imperative
  `engine.behaviors.attach`/`detach` surface and the durable tx wrapper's
  `tx.attach`/`tx.detach` accepted ephemeral behaviors and wrote their facet
  component through the WORLD — never published, never withdrawn, and
  indistinguishable from a projected remote facet to `ctx.peers()` (a local
  spoof, and a bypass of the claim's two real mint paths). All four now refuse
  with the store-routing rationale; the facet component's only writers are
  `ensureFacet` and `ctx.write`, both presence-routed and both measured.

## [0.8.1] — 2026-08-16

### Changed

- **strata-ecs 0.12.0 → 0.13.0** (published earlier today: petition 11 + the
  d.ts repairs ice 0.8.0's own review surfaced). All six declaring manifests
  move in lockstep — including `apps/*`, the second-copy trap — with the
  single-copy invariants verified (exactly one `strata-ecs@0.13.0` and one
  `loro-crdt@1.13.8` in the lockfile) and the full trace suite green at the
  bump. The `withdrawFacet` cast against the `@internal`-stripped getter is
  RETIRED: deferred facet withdrawal now reads
  `world.inImmediateProjectionUnsafeContext` typed, exactly as petition 11's
  migration note prescribed; the try/catch and the deferral stay (they guard
  the mid-observer-emit boundary — deliberately outside the predicate — and
  teardown-never-throws, not the type). Consumers also pick up strata's
  repaired d.ts (the dangling `LoroDoc`/`ObserverEntityRecord` references)
  transitively.

## [0.8.0] — 2026-08-16

**Facade presence for hosts that own their document lifecycle — petition I18.**
VibeField opens and creates ICE documents from its own checkpoints and journals,
so `docs.join()` — which would introduce a second bootstrap authority — never
runs. But presence entered ONLY through `join({presence})`: the separately
exported `attachPresence(world, …)` creates a real session the facade seam never
sees, so `docs.presence()` stays undefined and every registered ephemeral
behavior stays dormant (PRC4-E13 pinned all seven controls). Document bytes and
live presence are two independent coeffects; this release gives the second one
its own facade door.

### Added

- **`docs.attachPresence(opts): () => void`** — attach facade presence to an
  ALREADY-live document. Requires `docs.current()` (refuses doc-less; refuses a
  duplicate live attachment), creates the session with the existing public
  `attachPresence(world, opts)`, installs the presence publish + remote-cursor
  systems, and exposes the session through `docs.presence()` — the same seam the
  behavior runtime forwards, so a registered ephemeral behavior leaves dormancy
  on the next publish step (one facet, `init` once; pinned). Transport stays the
  caller's: wire `presence().wire.apply(bytes)` inbound and
  `presence().onOutbound(send)` outbound — the standing `PresenceSession`
  contract. Returns an idempotent, IDENTITY-BOUND inverse: it detaches THIS
  attachment — leave tombstones flush through still-subscribed outbound before
  the wiring dies (best-effort per subscriber: one that THROWS forfeits its own
  delivery and those peers fall back to TTL expiry — `PresenceOpts.onFault`
  observes it) — and cannot touch a replacement; `docs.close()` and engine
  disposal run the same teardown automatically. Reattach mints a fresh peer and
  behavior DEFAULTS (a stale value does not survive the detach; pinned).
  `join({presence})` now rides the same internal acquisition and keeps its
  combined document/presence framing.

### Fixed

- **Detaching presence on a still-open document no longer strands ghost remote
  cursors.** `installPresence`'s uninstall removed the remote-cursor derive
  system but not its pooled `CursorVisual` entities — the reaper that would have
  collected them is the system the uninstall just removed. The join path never
  saw the strand because `docs.close()` follows presence teardown with an
  in-place world reset; I18's inverse detaches while the document keeps running,
  which is exactly where a ghost cursor would freeze on canvas. Uninstall now
  reaps the pool (between frames, like every teardown here).
- **Presence systems no longer trip strata's access advisories on a facade
  engine.** The remote-cursor system registers into `present`, not `derive`:
  installed late into `derive` it co-wrote `Position` after the interaction
  stack's readers and co-writers (`cull`, `selectionChrome`), and both advisory
  classes fired on every presence-attached facade engine in dev — row-disjoint
  in truth (cursor entities are the system's own pool), but the
  read-before-write advisory has no attestation opt-out. `present` is also the
  honest phase: cursor visuals are presentation derivation with no in-tick
  consumers — reflectors read them post-notify, same frame either way.
  (design-003 §7's `derive` language covers the LOCAL L4 cursor; remote cursors
  were never phase-pinned.)

### The pre-publish adversarial review (2026-08-16)

Same protocol as 0.7.0 — independent reviewers over the diff, every finding
execution-confirmed against main before fixing, every fix mutation-probed. Four
lifecycle findings and one artifact-wide one, all fixed in this release:

- **A throwing `onOutbound` subscriber during the leave flush aborted every
  teardown path** — inverse, `docs.close()`, engine dispose — leaving a live
  engine behind a "completed" dispose and permanently stranding the presence
  binding (its `detached` flag latched before the throw; the keepalive/throttle
  timers and the wasm store leaked unreclaimably). The canonical subscriber is
  `ws.send`, which throws on a CLOSING socket — exactly the teardown moment;
  the join sugar never saw it because its only subscriber is joinDoc's own
  guarded send. Fixed at three layers, each pinned: per-subscriber fault
  isolation in the fan-out (one bad transport no longer starves later
  subscribers or the binding's timer callbacks), leave contained inside
  `detach()` and the reset-heal microtask, and `releasePresence` clearing its
  fields first then containing both halves — teardown never throws.
- **A same-gap detach→reattach delivered the new peer's `init` before the old
  peer's `dispose`, and the corpse's `ctx.write` landed on the fresh peer** —
  resolving `localPeer` live, the departed instance's farewell value was
  broadcast to every remote as current and never recomputed. Two complementary
  fixes: `writeFacet` refuses when the running hook's instance is not the
  current peer (`hookEntity`, set around every hook call), and `ensureFacet`
  defers the new mint one publish while a prior peer's instance awaits
  departure — dispose-before-init across a swap without touching the
  documented per-deliver hook order; one publish of activation latency in
  exactly that case.
- **A rejected `docs.join` stranded the presence session it acquired** on a
  doc-less engine: live seam, active ephemeral behaviors publishing into a room
  joinDoc had already unsubscribed, and no inverse the caller ever received.
  The join path releases presence on rejection when it still owns the flow;
  supersede semantics unchanged.
- **The inverse could burn itself on a failed teardown** — folded into the
  first fix: `releasePresence` never throws and clears state first, so the
  idempotency latch can no longer strand a live session behind a spent inverse.
- **The published artifact's types were broken on six of seven entry points —
  in every release since 0.2.0.** `tsc` preserves path-mapped specifiers in
  declaration emit, so the shipped d.ts imported unpublished `@ice/*`
  packages: TS2307 for `skipLibCheck: false` consumers, and silent `any`
  across those seams for the `skipLibCheck: true` default — vibe-field
  included. The build now rewrites all specifiers to relative paths as its
  last step and FAILS if any quoted `@ice/*` specifier survives
  (`packages/ice/scripts/fix-dts-specifiers.mjs`); all seven entries verified
  to typecheck standalone under `skipLibCheck: false`. The same sweep found —
  and fixed upstream, in strata 0.13.0 — dangling `LoroDoc`/
  `ObserverEntityRecord` references in strata's own shipped d.ts.

The consolidated second round added three refinements: `remoteCursors` now
attests `orderIndependent: [Position]` (its writes are its own pool's rows —
and suppression of strata's double-writer advisory is conjunctive over ALL
co-writers, so an un-attested engine system would make the warning
unsilenceable for a `present`-phase userland behavior that attests correctly);
presence faults became host-routable via `PresenceOpts.onFault`
(`"outbound" | "leave" | "heal"` — every fault stays contained; this is
observability, never control flow; default remains `console.error`), which
`docs.attachPresence` hosts get with no extra plumbing since they already pass
`PresenceOpts`; and the tombstone-flush wording above was qualified to
best-effort-per-subscriber everywhere it appears. One documented-scope
correction: the "zero access advisories" claim holds for the presence+facade
suites this release touched — the behavior suites' deliberate derive-phase
`Position` co-writers still trip the same two advisory shapes, and durable
behaviors are derive-only so they cannot take the phase-move escape; that
generic ordering/attestation question is recorded as an open post-0.8.0 item
in the implementation plan, not papered over.

### Upstream

- **strata petition 11 filed + landed same day** (strata 0.13.0, unpublished at
  this cut): `world.inImmediateProjectionUnsafeContext` is public API. ICE's
  `withdrawFacet` keeps its typed cast until the pin bump retires it — the cast
  compiles and behaves identically against 0.12.0 and 0.13.0
  (`docs/petitions/petition-11-projection-unsafe-context.md`).
- **strata 0.13.0 also carries the d.ts fixes this review surfaced** (dangling
  `LoroDoc` in the durable/ephemeral entries, `ObserverEntityRecord` dropped
  from tools by a prose `@internal` in a banner comment) plus its own
  build-step resolution guard.

## [0.7.0] — 2026-08-16

**The behavior host contract — petitions I16 + I17.** ICE 0.6.0 shipped
`defineBehavior` and its first real embedder (VibeField's plugin runtime,
PRC-4) immediately proved the framework runs but cannot be GOVERNED by a host
that activates plugin code once per window while creating one engine per
document — and that an ephemeral facet outlives its producer. The gaps were
routing, composition, and one store-lifetime seam, not a new scheduler; every
one was pinned red against the installed 0.6.0 artifact before this release
made it green.

### Added

- **`engine.behaviors.register(B, {orderKey?, ledger?})`** — host policy at the
  one place a host touches a behavior. The keyed lane runs in lexical order
  BEFORE every unkeyed registration (ties and unkeyed keep registration order),
  and both compiled pipeline systems and publish-slot hooks obey the same
  order, so execution no longer depends on parallel plugin activation timing or
  disable/re-enable history. Reordering reinstalls EXECUTION only: node state —
  collectors, instances, guests, data — stays put, and `init` does not re-run
  on unaffected behaviors. `ledger` seeds the driven guest's breaker state, so
  a suspension survives the engine generation that recorded it; changes keep
  streaming out the existing `guests.onLedgerChange` (no second mechanism). An
  empty `orderKey` throws rather than silently sorting first.
- **`createCanvasEngine({ onGuestFault?, onGuestNotice?, onBehaviorFault?,
  onBehaviorLog? })`** — the facade finally forwards the routes that already
  existed underneath it (`EngineOpts` for the guest pair, the behavior
  runtime's own `onFault`/`onLog` for the behavior pair, hook + entity
  provenance preserved). Before this, behavior faults defaulted to
  `console.error` through the only construction path hosts use — and a
  quarantined instance in a derived behavior means part of the document
  silently stops updating, which reads to a user as a broken document.
- **`describeBehavior(B)`** — the canonical, JSON-safe, process-independent
  projection of a behavior declaration: id, store, derived flags, version,
  phase, budget, tick visibility, schema field order with serial prop specs,
  classified reads, write component names, migration sources, and hook presence
  in lifecycle order. No validators, no function identity, no generated
  component ids. Downstream build tools and runtimes compare manifest truth
  against THIS instead of reimplementing ICE's definition identity.
- **Thenable hook returns are faults.** Every `init`/`update`/`changed`/`tick`/
  `dispose` return value is checked at the call boundary: a thenable gets a
  catch observer (a later rejection cannot become unhandled), an attributed
  behavior fault, and — unlike an ordinary single-instance throw, which stays
  quarantined to its instance — a direct guest strike, because an async hook is
  a definition bug every instance will repeat. `dispose` thenables are detected
  and attributed but still swallowed: teardown must not stop teardown. The
  Promise body itself cannot be cancelled; the guarantee is honest detection,
  attribution, quarantine, and suspension — never preemption.

- **Ephemeral facets withdraw when their producer stops (petition I17).** An
  ephemeral behavior's facet is LIVE PUBLICATION — the local peer telling every
  remote peer "this value is current" — so it is now reversed on every edge
  where execution stops: unregister/disposal, guest suspension, and singleton
  quarantine (the edge a host could never cover itself: a singleton's throws
  cannot span instances, so quarantine emits no guest-ledger transition to
  watch). The removal rides the PRESENCE writer, never `world.removeComponent`,
  so remote projections get tombstone truth instead of a TTL wait. Resume
  remints defaults for a value-suspended behavior; a QUARANTINED one stays
  withdrawn until a fresh registration — the quarantine memo lives on the node
  precisely because withdrawal makes the instance depart, and an
  instance-keyed memo would re-mint into an infinite quarantine/remint
  oscillation that never strikes the guest. Presence-less and mid-reset edges
  are quiet no-ops.

### Fixed

- `GuestSpec.phase`'s comment no longer predicts a widening that M13 declined —
  pipeline cadence is reached through `guests.addDriven`, and the publish-only
  value is the settled shape, not a placeholder.

### The pre-publish adversarial review (2026-08-16)

An independent review pass ran against the release candidate before publish;
six findings, all fixed in this release, three of them in the candidate's own
new code:

- **Unregistering from inside a hook is exception-safe again.** Facet
  withdrawal is a STRUCTURAL ephemeral op, illegal mid-tick — the naive call
  threw out of the remover mid-teardown and stranded the node: orphan
  published facet, leaked guest, name permanently unregistrable. Withdrawal
  now DEFERS to the publish slot (the step where eph structural ops are the
  designed legality) whenever the world is mid-tick or mid-walk, and never
  throws (failures route to `onBehaviorFault` as `"withdraw"`). Deferred
  withdrawals flush BEFORE the publish passes, so an
  unregister-then-re-register lands old-facet-out before new-facet-in.
- **Publish behaviors ride ONE stable engine hook the runtime owns.**
  Per-node `onPublish` hooks meant reorder churn invalidated the engine's
  frame snapshot mid-pass — `register()` called from inside a publish hook
  silently cost every not-yet-run publish behavior its whole slot that frame.
  Reorder now touches only the runtime's own ordered list; the engine hook
  never moves.
- **Appending never reorders.** `reorderExecution` reinstalls only the SUFFIX
  that must run after an out-of-order keyed insert; every unkeyed
  registration and every ascending-key registration is a plain append, so
  0.6.0's interleaving with host systems registered between behaviors is
  preserved exactly, and registration cost returns to baseline. The ordering
  contract, stated: behaviors order among THEMSELVES by the keyed lane;
  position relative to host systems is registration order, disturbed only by
  an out-of-order insert — and then only for the suffix.
- **Strikes are bounded per frame.** A thenable hook across N instances
  struck the guest N times in one frame — writing an instance-population
  count into the cumulative `strikes` number hosts PERSIST across engine
  generations (500 instances = 500 strikes, measured). One strike per frame
  per reason now (attribution stays per-instance via `onBehaviorFault`), and
  `guest.fault` is a no-op once suspended, so a runaway pass the breaker
  cannot preempt stops inflating the ledger and spamming its subscribers.
- **`describeBehavior` describes what RUNS.** Reads/writes validation is
  dev-guard-gated, so a production build accepts (and runs) a behavior whose
  unregistered read `partitionReads` silently drops — and `describeBehavior`
  crashed on it. Unclassifiable entries are now skipped to mirror the
  runtime; dev-guard validation still names the authoring error loudly.
- **`BehaviorStatus.quarantined`.** Withdrawal makes a quarantined ephemeral
  singleton DEPART, so `failed` read 0 and the quarantine was invisible —
  indistinguishable from dormant. The node-level flag is now on `list()`.

## [0.6.0] — 2026-08-15

**`defineBehavior` — ICE's second product surface.** The userland API is now a
triad: `defineWidget` gives a widget a FACE, `defineBehavior` gives it LOGIC AND
STATE, `defineTool` gives the canvas INPUT POLICY. Design-009, built on the
0.5.0 guest runtime rather than beside it.

### Added

- **`defineBehavior(name, spec)`** — one named declaration carrying a data
  schema, a REQUIRED store class, and lifecycle hooks the engine runs on a
  curated phase set. `store:` routes everything — where data lives, who sees
  it, what survives, which write vocabulary the hooks receive, at which
  cadence, and how attachment works:

  | `store` | data is | syncs | undo | writes with | phases |
  |---|---|---|---|---|---|
  | `durable` | document truth | every peer; offline-merge | yes (see `derived`) | `ctx.commit` only | `derive` |
  | `runtime` | a session-local rider | no | no | `ctx.write`/`ctx.set`/`ctx.attach` | `simulate`·`derive`·`present`·`publish` |
  | `ephemeral` | THIS peer's presence facet — a SINGLETON on the local peer | live peers; TTL | no | `ctx.write(patch)` + `ctx.peers()` | `publish` |

  The three hook contexts are three TYPES, not one with optional members: a
  durable behavior cannot see `ctx.write` in autocomplete, so "store routes
  everything" is a property of the object rather than a doc claim.
- **Hooks** — `init` · `update` (own data changed, by ANY writer, including a
  remote peer and undo) · `changed` (the reads set moved; once per behavior per
  frame, not per instance) · `tick` (per instance, opt-in) · `dispose`. Change
  delivery rides strata's real change detection, so every behavior is
  collaboration-native with zero author code. The instance list is a SNAPSHOT:
  a hook that attaches or detaches affects the NEXT frame.
- **`derived: true`** bundles three protections that only make sense together —
  output commits forced non-undoable (⌘Z must never un-derive), a DIFFER that
  drops every write already equal to the projection (zero remaining ops opens
  NO transaction), and claim-scoped delivery SUPPRESSION that goes quiet under
  a live gesture and coalesces into one delivery against settled truth.
  Equality is strata's own `valueEquals` — a hand-rolled one drifts on exactly
  the cells reconcile considers settled.
- **`engine.behaviors`** — `attach`/`detach`/`has`/`read`/`list`. Durable
  attachment is deliberately absent: it is a document op and goes through
  `tx.attach` so it syncs and undoes.
- **`defineWidget({ behaviors })`** — pre-attachment, split by store class like
  everything else: durable rides the spawn transaction, runtime is stamped at
  PROJECTION by the equip pass (the only path that also equips a widget
  arriving from a peer or restored from a file), ephemeral is refused.
- **`createBehaviorHarness(B)`** — ships WITH the framework. `claim(e)` fakes a
  gesture (suppression is what authors get wrong); `pair()` gives a second
  engine on one document (convergence bugs are invisible on one peer by
  definition); `commits` records what reached the store, which is how you tell
  "the differ dropped it" from "it never ran".
- **`useBehavior(world, entity, behavior)`** in `@ice/react` — live behavior
  data, `p.json` parsed, read-only by construction.
- **`p.entityKey()`** — the only legal cross-entity reference in durable data.
- **Behavior schema evolution** — `engine.behavior.<name>.<v>` markers with
  their OWN gate compare and the absent-is-not-newer rule. Behaviors ship in
  plugins, so "no local counterpart" is the ordinary state of a shared
  document; folding them into the pack compare would read-only a document
  because a plugin is missing. Behavior version state NEVER affects a document's
  verdict, and a test holds that.
- **`GuardedTxOpts.meta`** — per-commit provenance in-CRDT (strata petition 9).
  Every `ctx.commit` stamps `{behavior, label}`.
- **`guests.addDriven`** — the breaker detached from the scheduler, so behaviors
  running as pipeline systems still share one ledger, one doctor row and one
  frame-wide seam with every hosted guest.

### Behavior worth knowing

- **The stamping tax.** A behavior compiles to up to TWO systems: delivery
  (carrying every declared write, durable targets included) and, only if it
  ticks, a tick system carrying its own component ONLY. strata blanket-stamps a
  ran system's declared writes whether or not it wrote, so a ticking system
  with broad writes would wake every downstream observer every frame. Declare
  minimally.
- **`reads:` is a published surface.** The curated list is a stability promise;
  reading engine internals works but dev-warns. One-tick markers are cleared by
  the publish slot, so ephemeral behaviors can never see them.
- **Registration order is data-flow order.** If B derives from A and A is
  registered first, B sees A's writes the same frame; the other way, next
  frame. The framework will not order for you — devtools shows the order.
- **An ordered relation in `reads:` costs O(instances) per frame.** Sibling
  order never reaches a change collector, so it is polled, and the watch set is
  instances ∪ their parents. Declare one only when you navigate it.
- Scale posture: designed for ≤~2k ticking instances. Beyond that the idiom is
  ONE behavior on a carrier entity iterating its members.

### Fixed

- **The `coarse: false` attestation is now enforced.** It has been an
  engine-wide promise since M6 with nothing holding it; a raw `batch.col()`
  write to a behavior-read component would silently stop every behavior reading
  it from ever waking.

## [0.5.0] — 2026-08-15 · a git release point, NOT published to npm

**Install 0.6.0 for everything below.** The split existed so this half could
ship if the behavior framework slipped; it did not, and 0.6.0 landed the same
day, so the registry goes 0.4.0 → 0.6.0. The commit remains a genuine release
point — its tree contains no `behavior/` — which is why the entry stays rather
than being folded upward.

Two downstream petitions from VibeField, each carrying real bug fixes the field
wants regardless of what they were asked for: the **guest runtime** (I14) and
**animation-integrated writes** (I15). Cut on its own rather than folded into
0.6.0 because its value does not depend on the behavior framework — the
standing fixes below have been live bugs for weeks.

### Added

- **`engine.guests`** — a NAMED slot in the frame contract for work the engine
  did not write (`setFrameInfo → sync → tick → GUESTS → publish → notify →
  reflect`). Guests run before publish so derived state has settled when
  presence I/O reads it, and before notify so the same frame reflects them.
  Three properties the engine owes anything it hosts there: fault ISOLATION (a
  throwing guest never kills the loop, its neighbours or the frame — engine
  systems and publish hooks keep propagating loudly by design), SNAPSHOT
  iteration (a guest that adds or removes guests mid-run skips nobody), and a
  CIRCUIT BREAKER named honestly — a main-thread body cannot be preempted, so
  what the breaker guarantees is that no guest hurts the canvas TWICE
  sustained. The ledger is HOST-INJECTABLE: an engine is per-doc downstream, so
  a registry-local one would reset on every doc switch and hand chronic
  offenders a fresh probation forever. `guests.list()`, per-guest devtools
  lanes, and `EngineOpts.onGuestFault`/`onGuestNotice` — a suspended derived
  guest is a product event a host must be able to route, not a log line.
- **`GuardedTx.move(entity, to, {animateMs})`** — capture, durable final and
  glide in ONE commit, one undo entry, no double-write. Already-tweening
  entities RETARGET rather than restart; `Grab`-held ones are skipped; and
  `animateMs: 0` on an in-flight glide ENDS it (write-then-remove, so the stale
  tween cannot fight the snap it just committed). `ops.arrange` is now a
  pass-through over it — the recipe lives in the primitive it seeded.

### Fixed

- **A throwing publish hook no longer kills the canvas.** `@ice/dom`'s rAF loop
  rescheduled only AFTER `step()`, so one throw anywhere in publish stopped the
  loop permanently — no frames, no recovery, no message. Fixing it also closed
  a latent resurrection in the other direction: a `stop()` called from inside
  the step is re-checked after the body, so the loop cannot outlive its own
  stopper.
- **Self-removing publish hooks and reflectors no longer skip their
  neighbours.** Both loops iterated live arrays, so a splice during iteration
  shifted the next entry past the index.
- **Devtools' "reflect" lane reports for the first time.** It read a phase name
  that has never existed. `FrameTelemetry` gained `reflectMicros` and
  `reflectorMicros`, which are the real source.
- **Undo mid-glide no longer strands a cell permanently.** A glide holds the
  runtime cell away from the document; if the durable value then changed by any
  path other than the move, the tween landed on the stale target, strata's
  `(own, value)` branch advanced the baseline alone and banked NOTHING, and the
  cell was left diverged with an empty held-cell ledger — never reconciling,
  and poisoned against every later remote write. Two chokepoints close it:
  post-seal in `guardedTransaction` (a Position written by any other path
  retargets the tween) and post-history in the facade (undo does not pass
  through the tx path at all).
- `tweenStart` is reaped for entities that die mid-tween, rather than only on
  landing.

### Added, minor

- `makeChurnGuard` is on the barrel — the drain-in-runIf idiom every derived
  consumer outside core would otherwise hand-roll.

## [0.4.0] — 2026-08-09

Three downstream petitions from VibeField land at once: the **focus model**
(design-007 — petitions I1/I4, widget keyboard exclusivity + the wheel cede)
and the **prefab rename migration** (design-008 — petition I5). Both were
adversarially reviewed post-landing; the fixes are folded in below.

### Added

- **Widget keyboard exclusivity — `interaction.keyboard: "shared" |
  "exclusive"`** (+ `keyboardEscape: "release" | "widget"`). While a node
  inside a claiming widget holds browser focus, the engine keymap and the
  adapter's Space pan modifier stand down — keys flow to the widget's own
  handlers. The dom-widgets reflector marks claiming hosts
  `data-canvas-keyboard` (+ `tabindex="-1"`), a capture-phase focus driver
  makes click-anywhere acquire focus (declare a proxy with
  `data-canvas-focus`; natively-focusable content is left to the browser),
  and Escape is the engine-reserved release gesture — blur first, gesture
  cancel on the next unclaimed press — unless the widget declares
  `keyboardEscape: "widget"` (vim-grade terminals). Programmatic focus rides
  the view: `InfiniteCanvasHandle.focus.focusWidget/blurFocus`
  (`attachWidgetFocus` for imperative hosts). The widget input contract is
  three gates, in order: `defaultPrevented` ("preventDefault = handled by
  content" — zero-declaration widgets are covered), the claim standdown
  (before the editable gate, so editable focus proxies keep the Escape
  release), then the unchanged 4-class editable guard. Undeclared widgets
  behave byte-identically.
- **Wheel cede for scrollable widget content.** A plain wheel over a
  scroller-with-room inside a claim / `[data-canvas-interactive]` / editable
  subtree scrolls natively; at the scroll bounds it falls through to canvas
  pan/zoom (the nested-scroll feel — and scroll-chaining can never reach the
  page). ctrl-wheel / trackpad pinch is ALWAYS the canvas's zoom, claimed
  content or not. The ceded fact still lands, flagged with a one-tick
  `WheelHandled` that parks BOTH wheel consumers — recognizer spawn and the
  live recognizer's feed — so a wheel gesture inside its silence window never
  pans from ceded deltas, while a same-tick canvas down is untouched.
- **`keymapOverrides` on `<InfiniteCanvas>`** — the keymap's override surface,
  plumbed through the facade at last. Conditional dispatch belongs inside
  `run()` (read engine state there); the capture-phase `stopPropagation`
  folklore is retired — widgetlab's C-key workaround is deleted as the proof.
  An override bound to Space warns at attach: the adapter owns Space
  (design-003 §4.4) and such an entry is unreachable by construction.
- **Prefab rename migration — `renamedFrom: [{ type, atVersion? }]` on
  `defineWidget`.** Docs written under a prior type id fold in-band, retiring
  offline byte surgery. The declaration registers same-shaped LEGACY group
  components under the old names (projection is name-registry-driven, so old
  cells read like any other value); the version gate stops bricking
  pre-rename docs readOnly and gates them "migrate" instead, with
  `engine.renamed.<old>` tombstones marking dead markers forever (meta has no
  delete); the open-path runner folds under the single-writer law and stamps
  a carried `engine.pack.<new>.<oldV>` so `migrate` version chains compose on
  the new names; and an observer-armed zombie sweep on every writable session
  converges stale pre-rename deliveries — late old-shape entities fold fully
  (chain-folded from `atVersion`), resurrected old cells resolve NEW-WINS.
  Envelope headers self-heal at the next save. No strata changes were needed.

### Fixed

- **Space types into widget fields again.** The adapter preventDefaulted
  Space unconditionally as the pan modifier, eating it inside a widget's own
  `<textarea>`/`<input>` unless the widget stopPropagation'd its keydown.
  Space handling is now ownership-aware: it types in editables, cedes pan
  semantics (while still suppressing page-scroll) under a keyboard claim, and
  pans over canvas as ever.

### Breaking, narrowly

Same class as 0.3.0's `Engine.frame`: engine-constructed types gained required
members, so only hand-rolled implementations are affected — consumers that
merely read them need no change. `WidgetType` gained `keyboard`/
`keyboardEscape`; `DocVersionReport` gained `renamedInDoc`;
`InfiniteCanvasHandle` gained `focus`.

## [0.3.0] — 2026-08-04

One feature: **the frame gate** — the frozen-world mode design-005 §4 named as a
separate concept when stage holds landed in July, and deliberately left unbuilt
until something needed it. Full-window chrome (a control-room overlay that
covers the canvas outright) needed it: a stage hold quiets the compositor but
the engine keeps ticking at display rate for pixels nobody can see.

### Added

- **`engine.frame` / `ce.frame` — freeze the engine, not just its rendering.**
  `frame.freeze(name)` takes a refcounted NAMED freeze and returns an
  idempotent thaw, exactly like `stage.background(name)`. While one is held the
  host loop stops calling `step` entirely: no systems, no publish, no notify,
  no reflectors — and no scheduled rAF, because a stopped engine should leave
  the browser nothing queued. `FrameMode.freezeHolds` mirrors the count into
  the world for inspection; `frame.holds()` names the holders.

  **Which one to reach for**: `stage.background` for chrome that RECEDES the
  canvas (a menu panel over a live board — undo, collab and tweens must still
  land visibly behind it); `frame.freeze` for chrome that COVERS it. A freeze
  under a partial overlay will read as broken, because the canvas becomes a
  photograph until thaw. Stage holds are unchanged and did not stretch.

- **The settle protocol** — `frame.settleWhile(name, busy)`. A freeze does not
  park on the spot; it walks the loop until every registered reporter is quiet
  and then takes one further step, so the frozen image is whole rather than
  half-drawn. `<GLViews>` registers pending first-paints and mid-flight lift
  eases; the facade registers the mid-gesture read. Bounded by `SETTLE_CAP`
  (120 frames) with a dev warning naming whoever wedged it: a bad reporter
  makes a freeze park late, never never.

- **`useFrameFreeze(engine, active, name)`** in `@vibecook/ice/react` — the
  `useStageHold` shape, where the effect cleanup is the thaw, so an overlay
  that unmounts or crashes can never wedge the engine parked.

- **`isMidGesture` / `anyGestureNonTerminal`** are exported from core now. The
  predicate autosave used privately to defer a save (so it never captures a
  half-applied interaction) is the same one the settle needs; one definition,
  so the two cannot drift.

### Behavior worth knowing

- A freeze **cancels active gestures** at the transition. A parked loop never
  reaches `JustEnded`, so a gesture frozen mid-flight would hold runtime edits
  that never commit.
- A thaw **drops whatever input queued while parked**. Adapters never stop
  enqueuing; those facts describe a canvas nobody could interact with and carry
  a `tMs` that is now minutes stale. Same posture as the adapter's window-blur
  cancel (design-003 §8).
- **Remote edits keep landing in the document while frozen** — they simply
  reach the WORLD on thaw. Autosave is event-driven end to end
  (`subscribeOutbound` on each sealed local commit, `subscribeRemote` after
  each `applyRemote`, no polling), so a frozen engine cannot lose a document.
- **Widget-owned animation is outside the gate.** A widget's own CSS animation
  or playing media keeps running; the engine freezes engine-driven pixels.
- Resume rides the existing 64 ms `dt` clamp, so an hour parked advances tweens
  by one ordinary frame instead of teleporting them to their end.

### Breaking

- `Engine` gained a required `frame` member. Constructed engines
  (`createEngine` / `createCanvasEngine`) get it for free and hosts need no
  change — `startRafLoop(engine)` keeps its exact signature and reads the gate
  off the engine it was already handed. Only a hand-rolled `Engine`
  implementation would need updating.

## [0.2.0] — 2026-07-25

Everything since 0.1.0 (2026-07-12): 79 commits spanning M8 (node editor,
containers, nested canvas), M9 (presence, bootstrap, migrations), and M10 (ops
catalog, devtools, docs). Documents written by 0.1.0 migrate on open — see
**Breaking** below.

### Breaking

- **Sibling order replaces scalar z — document schema 2.** `ChildOf` is now an
  ORDERED relation: a frame's children ARE its paint/pick order, converging
  collaboratively through strata's movable-list semantics instead of scalar-z
  arithmetic. `ops.reorder(ids, "top" | "bottom")` is unchanged at the surface;
  what went away underneath is `StackZ` arithmetic, `Grab.z` restore, and the
  `topZ()` scans.

  Migration is automatic and needs no application code: the envelope version
  gate reports `migrate`, and the facade runs `runMigrations` at open — one
  `{undoable: false}` transaction that mints the board root and re-links every
  durable widget in `(z asc, entityKey asc)` order. It is absolute, idempotent,
  and convergent (same document → same sequence), so concurrent migrators agree
  and user undo history survives.

  Forward compatibility is graceful, not fatal: the legacy `StackZ` cells are
  deliberately KEPT, so a 0.1.0 build opening a migrated document still opens it
  read-only and still paints in the right order. Live collaboration on an ordered
  document does require every peer on 0.2.0.

- **Peer requirements**: `@vibecook/strata-ecs` 0.11.0 and `loro-crdt` >= 1.13.8.

### Added

- **`@vibecook/ice/ground` — a new entry point.** The P0 stratum collapses to ONE
  WebGPU canvas (three's `WebGPURenderer` + TSL, automatic WebGL2 fallback)
  hosting the dot grid, wires, and snap-guide passes behind a shared pass
  registry. React takes it as an opaque factory — `<InfiniteCanvas ground={ground(...)}>`
  — so the import walls hold; imperative shells register `layer.reflector`.
- **Node editor**: ports materialized on demand, wires as edge entities with
  endpoint cascade, and a connect tool with preview continuity. Culled endpoints
  still draw.
- **Nested canvas + portal-zoom navigation** (design-006 T1): `ops.enterContainer` /
  `exitContainer` fly the camera along a portal-continuous log-zoom path with a
  closed-form spring, `exitTo` composes multi-level portals from current rects, and
  GL islands go cold for the duration of a flight.
- **Widget tray — insert-by-drag**: a draft ghost the drop adopts, deferred spawn,
  and a morphing bottom toolbar.
- **Widget previews**: a `defineWidget` preview contract, `<WidgetPreview>`, and
  runtime GL preview capture through headless islands.
- **`ops.arrange` — desktop-style Clean Up**: a kernel packer with Blueprint-style
  wire-aware layout, dense packing, bystander obstacles, crossing refinement, and
  band-wrapped chains; commits then glides. Free-slot placement on consume.
- **Comment widget**: a UE-Blueprint comment box (`C`) that claims members by
  spatial sweep, stacks under them, and files into folders as a group.
- **Selection chrome v2**: in-card rounded rings, a lift-wrapping union box on the
  P4 DOM plane, SDF rings at the ground stratum, and pooled snap guides.
- **Cursor halo**: a hover-time `OverInteractive` fact driving a ring → dot morph.
- **Per-widget `Opacity`**: one durable cell, reflected on both the DOM and GL planes.
- **`docs.presence()`**: the inspection seam that lets facade apps wire the devtools
  presence panel — swaps with the document lifecycle, never a sync path.
- **`offerBase`**: re-offer a live session's base after a lossy-transport outage —
  peers re-adopt and Loro dedupes, with no teardown, world reset, or UI flash.
- **Bounded incremental autosave journals**: `storage.append` extends a checkpoint
  with the exact outbound Loro update; `put` replaces and compacts. Falls back to a
  full checkpoint when an append is not acknowledged.
- **Devtools rebuilt** on strata's first-party tools: one draggable dock hosting all
  panels, plus a GL metrics panel (renderer census, virtual-texture/LOD/cull).
- **GL frame profiling**: `<GLViews onFrameStats>` with `stats-gl` GPU timing.
- **Electron example** (`apps/widgetlab-desktop`): an IPC room switchboard with an
  optional truffle/tsnet mesh — serverless multi-window and multi-machine collab.

### Performance

Measured 2026-07-15 on an Apple M1 Max against strata 0.7.0; the bench source in
`packages/core/bench/` is the source of truth and `docs/benchmarks.md` records the
full output.

- **Idle frames stopped scaling with the board.** `activeMembership`, `breakpoint`,
  `cull`, and `widgetMount` all became delta-driven behind real `runIf` churn gates
  (strata 0.7.0 `ChangeCollector`), and `spatialSync` is O(delta) with an
  allocation-free sweep. Idle cost at 100k entities fell from **25.1 ms to 872 µs**
  (flat) and **25.6 ms to 890 µs** (nested); nested-10k is 106 µs.
- **Pan frames skip `breakpoint` entirely** — 1 run per 450 frames, against every
  frame before the gate.
- **GL idle-duty package**: animation rate cap, paint-DPR ceiling, backbuffer AA off.

### Fixed

- Three adversarial review sweeps (10, 7, and 18 findings) hardening the doc-join
  lifecycle, GL click pairing, autosave truth, migration atomicity, FBO accounting,
  read-only truth, transport failure paths, and presence reset.
- **The equip-lag Active flash**: fresh container content anchored to the root for one
  frame and was mass-Visible-tagged, leaving zombies mounted forever — 6,440 phantom
  mounts on a 10k seed, plus polluted archetypes that defeated chunk-level tag
  filtering. Membership now answers container-ness from the widget registry during the
  equip-lag window.
- **Gesture windows measure the clamped engine clock**, not wall time — real clicks
  select again under a throttled or headless rAF.
- **GL composite renders in the engine flush** (reflect-phase advance) — pan no longer
  lags the DOM planes; the advance clock is seconds, and stagger-deferred islands bank
  their `dt`.
- Nav-tick zombies and cross-frame scope leaks (folder ghosts); nav ops own a
  synchronous visibility cut, so no squeezed-scene flash.
- Test rigs that claimed to arm strata's write enforcement but observed nothing — an
  observe-less reflector never arms it, so the assertions were inert.

### Docs

- `docs/benchmarks.md` — per-milestone measured baselines, including the numbers that
  came out badly.
- `docs/strata-petitions.md` + `docs/petitions/` — eight upstream petitions, all landed
  (strata 0.3.0–0.9.0), each recording the engine migration that retired its workaround.
- `docs/api-reference.md` — the curated published surface.

## [0.1.0] — 2026-07-12

First publish: kernel math, the frame contract, the L0–L4 interaction stack, durable
documents with per-gesture undo, the DOM widget runtime, GL islands, and the
`createCanvasEngine` facade.
