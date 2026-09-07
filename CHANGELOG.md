# Changelog

All notable changes to ICE are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semver](https://semver.org) (pre-1.0: minor versions may break APIs).

## [Unreleased]

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

### Added

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
  folder's face is the ground's live portal and its DOM minis retire; the old profiles keep
  their CSS chrome until B8. The `next-boot` rig's boundary phase: every card's clip written
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
  old leg's `ground()` layer by name; dependency-cruiser walls it from the old profile both
  ways. `groundCompose`'s handle maps the react `grid` prop onto the field
  (`fieldConfigOf`) and takes a new theme (`compose.setTheme`). The old profile is untouched.
- **`@ice/ground/compose` — the ground moves in** (design-013 §8 B1 [GROUND PORT],
  2026-09-07). `vibe-field/draft/ground` enters ICE once, into its final home, as a second
  entry of `@ice/ground` beside the old composited leg — which imports none of it and is
  deleted at B8; dependency-cruiser holds the wall both ways. What it is: the raw-WebGPU
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

- **A React composited app now DECIDES to promote on drag — the decision half,
  not the pixels.** `infinite-canvas.tsx` built `domWidgets` without a
  `PresentationRegistry` and nothing in `@ice/react` created the policy, so no
  React app had a promotion decision at all; the rigs hand-wired both and were
  the only thing that ever saw one. The standard behaviours are
  engine-registered and the DOM layer reads the world, so there is no decision
  wiring left for an app to forget: a drag flips `SurfaceTarget` to `gpu` and
  every reader sees it. **No pixels move there yet.** `infinite-canvas.tsx`
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

## [0.12.0] — 2026-08-31

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
