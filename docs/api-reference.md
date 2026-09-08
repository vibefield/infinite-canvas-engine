# API reference (engine v1)

Curated reference for the published surface. Source of truth: each package's
barrel (`packages/*/src/index.ts`); design citations in the JSDoc. Everything
listed here is importable from the package ROOT — deep imports are
unsupported and wall-checked.

**What a landing must pass** (design-013 C4, D-C4.11): `pnpm run ci` (typecheck ·
lint · tests · the import walls · `gen:check`), the desktop rigs, and
**`pnpm run gate:landing`** — the Dawn oracle, the lab's build, `rig:parity`
(Chrome against the oracle's bytes, maxΔ 0 asserted per scene) and `pack:audit`.
The landing gate is separate from `ci` because the oracle needs Dawn, which the
CI runner has not been probed for. A RELEASE adds the audit again from the other
side: `packages/ice`'s `prepack` runs `pack:audit`, so `npm publish` measures the
published bytes rather than trusting the last local build.

## @ice/core

### Definition primitives

| Export | Shape | Notes |
|---|---|---|
| `defineWidget(def)` | → `WidgetType` | Props DSL → conflict-group components on a durable prefab; `surface: "dom" \| "gl"` (the `WidgetSurfaceKind` union); `ports`, `container`/`provides`, `interaction`, `animated`, `migrate` chain. Where a card presents is chosen through `behaviors: [alwaysDom \| alwaysGpu \| alwaysGpu.with({ paused: true })]` — a definition naming none gets its kind's default (`domAtRest` for `dom`, `alwaysGpu` otherwise), exactly one behaviour may write `SurfaceTarget`, and the retired `presentation` field throws (migration table in the CHANGELOG). |
| `p` | `p.string/number/boolean/enum/json/entityKey` | Every field defaulted; `p.json` is the conflict-coarse escape hatch; `p.entityKey` is the ONLY legal cross-entity reference in durable data. Standard Schema v1. |
| `defineBehavior(name, spec)` | → `BehaviorHandle` | Logic + state as ONE declaration; `store: "durable" \| "runtime" \| "ephemeral"` is REQUIRED and routes everything. See [Behaviors](#behaviors). |
| `defineTool(def)` / `createDrawTool(type)` | → `Tool` | Pure config: `spawnProfile`, `route {canvasDrag, widgetDrag, portDrag}`, `gates`, `cursor`, `shortcut`. Built-ins: `select`, `pan`, `connect`. |
| `definePrefab(id, def)` | → `Prefab` | The base primitive `defineWidget` sugars over; `store: "durable" \| "runtime" \| "ephemeral"`. |
| `defineComponent/Tag/Relation/Resource` | strata wrappers | Record metadata for sovereignty/devtools; catalog in `@ice/core` ships the full engine vocabulary. |

### The facade

```ts
const ce = createCanvasEngine({ widgets?, tools?, behaviors?, budgets?, settings?, policy?, measureQueue? });
// ce: { world, engine, behaviors, stack, runtime, nav, ops, docs, stage, frame,
//       budgets, step(now), dispose() }
```

- `ce.ops` — `setTool · spawnWidget · deleteSelection · duplicateSelection ·
  setSelection/clearSelection/selectAll · reorder(ids, "top"|"bottom") ·
  zoomToFit/zoomTo/panTo · enterContainer/exitContainer · cancelActiveGestures`.
  Every op is one engine-owned write path (one tx / one resource write).
- `ce.docs` — `create() · open(bytes) · join(channel, {presence?, seed?}) ·
  attachPresence(opts) · presence() · current() · close() · undo() · redo() ·
  autosave(storage)`. `attachPresence` (petition I18, 0.8.0) is presence for
  hosts that own their document lifecycle: requires a live document, refuses a
  duplicate, exposes the session through `docs.presence()` (the seam the
  behavior runtime reads — a registered ephemeral behavior leaves dormancy on
  the next publish step), and returns an idempotent, identity-bound inverse
  (leave tombstones flush through still-subscribed outbound — best-effort per
  subscriber: a throwing transport forfeits its own delivery and those peers
  fall back to TTL, observable via `PresenceOpts.onFault`; `close()`/dispose
  run the same teardown). Transport is the caller's: `presence().wire.apply`
  inbound, `presence().onOutbound(send)` outbound.
- `settings` seeds live-tunable resources: `GestureSettings`,
  `PointerSettings`, `CameraLimits`, `SnapConfig` (resource first, reviewed
  constants as fallback).
- Doc-less by construction; ops that need a document throw with guidance.

### Documents & collab

| Export | Notes |
|---|---|
| `createDocSession(world)` / `openDocSession(world, bytes)` | Under the facade; open NEVER throws — quarantine is a return value. Version gate: `ok / readOnly / migrate / reject`. |
| `runMigrations` | Read-repair at open (facade runs it on `migrate`): per-type chains in ONE `{undoable:false}` tx; concurrent migrators converge. |
| `joinDoc(world, channel, opts)` | §6.5 bootstrap: hello → buffer → snapshot-as-causal-base → drain; 800 ms silence ⇒ seeder. Reconnect = re-join. |
| `broadcastChannelByteChannel(name)` / `webSocketByteChannel(ws)` | `ByteChannel` adapters; anything carrying `Uint8Array` works. |
| `startAutosave` / `restoreAutosave` | Debounce 800 ms, 10 s max-wait, gesture-deferred, quarantine-on-incompatible. |
| `attachPresence` / `installPresence` | Ephemeral peer facets: `PresenceInfo`, `PresenceCursor`, `SelectionSummary`; remote peers project as `Not(Local)`. `installPresence` registers the remote-cursor system in `present` (0.8.0) and its uninstall reaps the pooled cursor entities — detaching on a live document must not strand ghosts. Facade hosts should prefer `docs.attachPresence` (it feeds the behavior runtime's seam; a raw `attachPresence(world, …)` session is real but invisible to `docs.presence()`). |
| `guardedTransaction(store, world, fn, {undoable?})` | Eligibility-guarded tx — the primitive under `useCommit` and every op. |
| `cascadeDestroy(tx, world, root)` | Containment recursion + wire cascade, one tx. |

### Behaviors

The second product surface: `defineWidget` gives a widget a FACE, `defineBehavior`
gives it LOGIC AND STATE, `defineTool` gives the canvas INPUT POLICY.

```ts
const Layout = defineBehavior("myplugin:layout", {
  store: "durable",          // REQUIRED — see the routing table below
  derived: true,             // output is computed, not authored
  schema: { gapX: p.number({ default: 120 }) },
  phase: "derive",
  reads:  [Position, ChildOf],
  writes: [Position],
  on: { init, update, changed, tick, dispose },
});
```

**Names are `<namespace>:<name>`**, and the namespace is what a plugin host
validates against the declaring plugin id. **`ice:` is RESERVED for the engine's
own behaviours** — it carries the compiler's `orderIndependent` attestation on
declared writes and an exemption from the published-read-surface warning, so
`defineBehavior` refuses any name in it.

**`store:` routes everything.** It is the load-bearing word of every declaration:

| `store` | data is | syncs | undo | write vocabulary | phases | attachment |
|---|---|---|---|---|---|---|
| `durable` | document truth (a named cell on the entity) | every peer; offline-merge | yes (see `derived`) | `ctx.commit(label, fn)` ONLY | `derive` | `tx.attach`/`tx.detach`, or `defineWidget({behaviors})` |
| `runtime` | a session-local rider | no | no | `ctx.write` / `ctx.set` / `ctx.attach` / `ctx.detach`, plus `ctx.commit` | `simulate` · `derive` · `present` · `publish` | `engine.behaviors.attach`, hook-side `ctx.attach`, or `defineWidget({behaviors})` |
| `ephemeral` | THIS peer's presence facet — an implicit SINGLETON on the local peer entity | live peers, while present; TTL | no | `ctx.write(patch)` (no entity — the instance IS the peer) + `ctx.peers()` | `publish` | none; presence-less engines leave it dormant |

**Hooks**, delivered in this order at the behavior's phase, every frame:
`init` (appeared) → `update` (own data changed, by ANY writer — including a
remote peer and an undo) → `changed` (the reads set moved; ONCE per behavior,
not per instance) → `tick` (per instance; opt-in cost) → `dispose` (departed).
The instance list is a SNAPSHOT: a hook that attaches or detaches affects the
NEXT frame.

**`maxFacetBytes`** (ephemeral only, optional — petition I19): the behavior's
own resource claim — a hard ceiling on the canonical UTF-8 JSON bytes of its
COMPLETE facet cell after defaults/merge/serialization. Enforced in production
at both mint paths: an over-budget default fails `defineBehavior` itself (no
residue), and an over-budget `ctx.write` throws BEFORE mutating presence — the
prior facet stays intact, and in-hook the throw rides the ordinary fault
ladder (three strikes quarantine the singleton and withdraw the facet).
Identity-bearing: part of the definition signature and of `describeBehavior()`
(absent = no bound attested), so plugin hosts can require a claim at admission
and budget their transport around the sum of admitted claims.

**`derived: true`** bundles three protections: output commits are forced
non-undoable (⌘Z must never un-derive), a DIFFER drops every write that already
equals the projection (a commit with zero remaining ops opens no transaction at
all), and delivery is SUPPRESSED for instances under a live gesture claim —
coalescing into one delivery against settled truth when the claim clears.
`deriveDuringGesture: true` opts out.

**Motion cookbook.** "How do I animate?" is every author's first question, and
the answer depends on what is moving:

| You want | Use | Why |
|---|---|---|
| Presentation motion (a hover lift, a pulse, a spring) | the behavior's OWN `runtime` data, composed by the face | It is not document truth. Nobody else should see it, and it must not enter undo or the wire. |
| Document geometry that ends somewhere specific | `tx.move(e, to, { animateMs })` inside `ctx.commit` | ONE commit owns the capture, the durable final, and the glide. Retargets a glide in flight rather than restarting it. |
| Per-frame writes to a durable cell | **nothing — this is refused** | The divergence law: durable cells are written live only under a gesture claim or a tween grant, and the framework does not mint a third. A `tick` hook that writes one throws through the armed live writer. |

**`reads:` is a published surface.** The curated list — `Position`, `Size`,
`MeasuredSize`, `Opacity`, `ChildOf`, `PrefabId`, `Accepts`, `Provides`,
`Selected`, `Selectable`, `Movable`, `Resizable`, `Solid`, `Container`,
`Visible`, `Culled`, `Camera`, `CameraLimits`, `Viewport` — is a stability
promise. Reading anything else works but dev-warns: recognizers, claims and
gesture bookkeeping are engine vocabulary and change with the interaction stack.
One-tick markers (`WentDown`, `Just*`) are already cleared by the publish slot,
so ephemeral behaviors can never see them.

**Testing.** `createBehaviorHarness(B)` ships with the framework:
`{ world, engine, step(n), spawn(), attach, detach, instances(), commits,
claim(e), pair(), sync() }`. `claim(e)` fakes a live gesture (suppression is
what authors get wrong); `pair()` gives a second engine on the same document
(convergence bugs are invisible on one peer by definition).

**Runtime surface.** `ce.behaviors` — `register(B, {orderKey?, ledger?}?) ·
attach(e, B, data?) · detach(e, B) · has(e, B) · read(e, B) · list()`. Durable
attachment is deliberately absent: it is a document op and goes through
`tx.attach` so it syncs and undoes. Every behavior appears in
`ce.engine.guests.list()` under `behavior:<name>`, sharing one circuit breaker
with every other guest.

**Host contract (0.7.0, petition I16).** Everything a multi-generation host
(one engine per document, plugin code activated once) needs to govern behaviors
it did not write:

- `register(B, {orderKey?, ledger?})` — the keyed lane runs in lexical
  `orderKey` order BEFORE every unkeyed registration; ties and the unkeyed lane
  keep registration order. Re-registering an earlier key reorders execution
  only — collectors, instances, guests and data stay put, and `init` does NOT
  re-run on unaffected behaviors. `ledger` seeds the driven guest's breaker
  state (strikes/suspension persisted by the host across engine generations);
  changes stream out the existing `guests.onLedgerChange`. Ordering vs HOST
  systems, stated: appending (any unkeyed registration; ascending keys — what
  a manifest-ordered host produces) NEVER moves anything, so behaviors keep
  their registration-order interleaving with host `addSystems` calls; only an
  out-of-order keyed insert reinstalls its suffix, which then sits after any
  host systems registered meanwhile. Publish-phase behaviors run from ONE
  stable runtime-owned engine hook, so registering from inside a publish hook
  never costs another behavior its slot.
- `createCanvasEngine({ onGuestFault?, onGuestNotice?, onBehaviorFault?,
  onBehaviorLog? })` — the first pair forwards the `EngineOpts` routes through
  the facade; the behavior pair carries hook + entity provenance. Unrouted,
  faults still reach the console — but a suspended derived behavior means part
  of the document silently stops updating, so hosts SHOULD route these.
- `describeBehavior(B)` — the canonical JSON-safe projection (id, store,
  flags, version, phase, budget, schema with prop specs, classified reads,
  write names, migration sources, hook presence in lifecycle order; no
  functions, no generated component ids, no process state). Build-time manifest
  emission and runtime anti-drift compare against THIS, never a hand-rolled
  serialization.
- Thenable hook returns are FAULTS: detected at the call boundary, attributed
  `(behavior, hook, entity)`, observed so a later rejection cannot go
  unhandled, and escalated straight to the guest strike ladder (an async hook
  is a definition bug — every instance would do it). The continuation cannot be
  cancelled; the guarantee is honest detection, not preemption.
- Ephemeral facets WITHDRAW when their producer stops (I17): unregister,
  suspension, and singleton quarantine all remove the published facet through
  the presence writer (remote tombstone truth, no TTL wait). Resume remints a
  value-suspended facet with declared defaults; a quarantined one returns only
  with a fresh registration. One registration disposer is therefore the
  complete reversible effect for all three store classes — with their
  different data lifetimes intact (durable cells stay document truth, runtime
  riders stay dormant in-world).

**Scale posture.** Designed for ≤~2k ticking instances. Beyond that, the idiom
is ONE behavior on a carrier entity iterating its members — the mind-map shape.

### Extension seams

`ce.engine.addSystems(phase, ...systems)` (11 fixed phases; `defineTickSystem`
for once-per-frame work) · `ce.engine.registerReflector(def)` (post-notify,
the only output writers) · `ce.engine.onPublish(hook)` (presence I/O slot) ·
`ce.engine.enableTelemetry()` / `reflectorNames()` (devtools feed).

## @ice/react

**Presentation profiles (design-012 §3; design-013 §8):** `stratifiedProfile` and
`compositedProfile`. The composited one is the ground's — `<InfiniteCanvas
ground={groundCompose({ device, theme })} profile={compositedProfile}>`, the ground itself the
compositor (`@ice/ground/compose`). It refuses a device-less engine, a missing ground and a
`groundField()` layer BY SHAPE — a `GroundFieldHandle` carries no `compose`, so there is no
GpuCompose to register — rather than rendering a plausible screen that is quietly the
stratified one; it installs the surface infra set (Band · Demand · Residency) and
registers §6's roster: DomRender · IslandRender · VideoIngest · DomCompose · GpuCompose. An app
imports exactly one profile and passes it to `<InfiniteCanvas profile={…}>`; the other
tree-shakes out. (B8, 2026-09-07: the old composited leg and its profile are deleted, and
`compositedProfile` took this name.)

**`useChromeOwner()`** — `"ground"` under the composited profile, `"dom"` otherwise. A card
shell renders bare under the ground (the plate, ring, shadow, lift and glow are drawn there);
under the stratified profile it draws its own CSS chrome. That branch does NOT retire in
Phase C, contrary to what this line said before C3 (2026-09-07): C2 moved the stratified
ground onto the same engine rather than deleting the profile, so the ground draws no cards
under it and the CSS chrome stays the fallback.


| Export | Notes |
|---|---|
| `<EngineProvider engine>` | Context root; all hooks require it. |
| `<InfiniteCanvas engine measureQueue? onReady?>` | Mounts planes P0–P5, adapters, reflectors, keymap, rAF loop, WidgetRoot. Unmount detaches; the engine outlives it. GL islands + devtools attach app-side via `onReady` (import walls). |
| `useCommit()` | `(fn: (tx: GuardedTx) => void, {undoable?}) => void` — THE widget write path; one call = one undo step. |
| `useBehavior(world, entity, behavior)` | Live behavior data for one entity; `p.json` fields parsed; `undefined` when unattached (a legitimate render state). READ-ONLY — faces render behavior state, never write it. |
| `useWidgetProps(world, entity, type, group?)` | Tier-3 subscription, json-parsed, frozen while the widget is hidden. |
| `useSelected` / `useBreakpoint` / `useWorldComponent` | Equality-suppressed snapshots (strata `get()` returns fresh objects — the hooks cache by shallow-eq). |
| `useTool()` / `useToolState(id)` | `[id, setTool]` over the `ActiveTool` resource. |
| `useUndoStatus()` | `{canUndo, canRedo}` via the `DurableUndoStatus` resource — survives doc swaps. |
| `usePresencePeers()` | Remote peers (`PresencePeer` × `Not(Local)`), membership-keyed stable snapshots. |
| `attachKeymap(ce, target?, overrides?)` | Defaults: ⌫ delete · ⌘Z/⇧⌘Z · ⌘D · ⌘A · Esc · arrows nudge (one tx/press) · tool shortcuts. All resolve to ops; editable targets skipped. |
| `useWorld()` | Escape hatch: read + observe only (DEV-warned). |

## @ice/dom

`createCanvasHost(container)` · `createPlanes(host)` · adapters
(`attachPointerAdapter(host, queue, {glRoute?})`, `attachMeasureAdapter`,
`wireMeasurement`) · reflectors (`createPlaneTransformReflector`,
`createGridReflector`, `createWiresReflector`, `createDomWidgetsReflector`,
`createChromeReflector`, `createCursorReflector`,
`createRemoteCursorsReflector`) · `startRafLoop` · `createSourceCanvas(container, effects,
opts?)` — the L1 `<canvas layoutsubtree>` whose immediate children are `gpu`-target hosts
(`effects` is the HiC adapter's injected `{markAsSourceCanvas, onPaint, changedElements}`;
`opts.onDirty(hosts, event)` is the per-slot dirty latch; **`opts.pointerEvents: "auto" |
"none"`** — `"none"` for a MIXED board, where `dom`-target cards live under this canvas and
the hosts it adopts set `pointer-events: auto` themselves; `resize(w, h, dpr)` must be called
on every viewport change, the bitmap being what paint records are recorded against).
`createDomWidgetsReflector` parents a host by `effectiveTarget(SurfaceKind, SurfaceTarget)`
when a `sourceCanvas` is present; `hostFor(e)` is the inner portal target and
`hostElementFor(e)` the outer host the copy addresses. `<InfiniteCanvas>` wires
all of this; direct use is for custom shells.

## @ice/r3f

`createGLBridge(engine | canvasEngine, {transitions?, gpu?, devAssertRenderWrites?})` (a `CanvasEngine` supplies both seams; the options override) · `<GLViews engine bridge
store>` (mount inside an R3F `<Canvas frameloop="demand">` on the P2 plane) ·
`useIslandFrame(cb)` / `useIslandInvalidate()` (the ONLY sanctioned island
animation paths) · `createGLPointerRouter({world, bridge, index})` → the
adapter's `glRoute`. Zero render→ECS writes, DEV-enforced via
`world.devOnWrite`.

**The `gl` presentation plane** (design-013 C4, D-C4.6). The coordinator answers
**`ownerOf(plane): string | undefined`** — the id of whatever owns that plane, or `undefined`
when it is free. `<GLViews>` consults it and **registers the `gl` plane only when it is
unowned**, so a second `<GLViews>` on one engine neither throws nor takes the plane from the
first; `register` still throws on a plane already owned, which inside an effect used to unmount
the tree. `createGLBridge` **defaults `transitions` from the engine it is handed**, so a bridge
built without the option still registers its adapter — glboard's did not, and a cross-type
enter with an island snapped.

## @ice/ground

**`@ice/ground/compose` IS this package's main entry** (design-013; the ground became the
compositor at B8, 2026-09-07). Everything under that heading below is what a composited app
uses. This root barrel is the STRATIFIED ground, which is the SAME engine since C2
(2026-09-07): one internal host in two modes, sharing the canvas, the builder, the overlays,
the poles and the flight. three's `WebGPURenderer`, TSL, `ground()`, `groundHost` and
design-011's program contract were deleted with the old leg, and C3 struck `three` from the
package's dependencies entirely — the whole non-r3f graph is three-free and the pack audit
measures it. `instrumentSubmits` and the HiC adapter's exports are exported from both entries.

`groundField(opts?)` → an opaque factory for the react `ground` prop (or call it with the
mount context in imperative shells and register `layer.reflector`). It acquires its OWN
WebGPU device (`gpu`/`onDevice` override and observe it) and draws, under the DOM planes, the
field, the live portals, the flight's second slot, the wires and the snap guides — and NO
cards: the DOM draws those under this profile. `groundField({ grid, wires, guides, poles,
theme?, config?, grids?, gpu?, onDevice? })`; `configureGrid` re-tunes live (the react `grid`
prop forwards here), `layer.field` is the handle (`status` · `device` · `redraws` · `stats` ·
`config` · `setTheme`). There is no WebGL2 fallback, no timestamp profile and no extra
`passes` — an overlay is `Ground.create({ overlays })`'s. **The ground is OPAQUE**: it clears
to its theme's `canvasBg` and writes the bytes the theme and the config name, so a host
projects its page background into the theme (`themeFrom(name, palette)` over
`ENGINE_PALETTE[name]`). **With no `theme`, the mount reads `prefers-color-scheme`** and takes
the engine's light or dark theme accordingly, falling back to light where `matchMedia` is
absent (Node, a lab) — D-C4.4. That is a guess at the page, not knowledge of it: a product with
its own background passes `theme` and gets its own bytes. Before C4 the default was
`ENGINE_THEMES.light` unconditionally, so a dark app porting `ground()` → `groundField()`
verbatim got a white viewport.

**`@ice/ground/compose`** — the ground as design-013's compositor: the magnet field and the
cutting mat, the SDF card frame with its content term and the heat, the live portal's slot
tree and the flight's second slot. `Ground.create({ device, canvas, field, frames, fill })` on a device the
host owns (`acquireCompositorDevice().device`; `GROUND_SHADERS` supplies the three shader
sets); `ground.render(inputs)` draws one frame — the root slot, a nested slot per live
portal, a flight's departed slot — and returns its stats; `prepareFrame` / `drawFrame` /
`SlotPool` are the seams the oracle drives. `resolve()` turns a card's rect and motion into
the `Geometry` the frame records and `pick()` hit-tests alike; `portalOf()` gives a
container's face its camera (`outgoingCamera`, the flight's exact `c0`); `themeFrom(name,
palette, grid)` builds the `GroundTheme` the passes read — the palette is the host's,
`ENGINE_GRID` and the mat's `MAT_LIGHT` are the engine's own. `@ice/ground/engine` is the
raw-WebGPU boilerplate alone. **`groundCompose({ device, theme, config?, maxDpr? })`** (B2)
is the ground as a LAYER: a factory with the shape of the react `ground` prop, returning a
handle whose `compose.gpuCompose` reflector the `compositedProfile` registers last (after
the renders, design-013 §6); `configureGrid` maps the react `grid` prop onto the field
(`fieldConfigOf`), `compose.setTheme` swaps the host's projection, `compose.redraws()` is the
churn instrument, `compose.available()` says whether the pipelines compiled. **B3a — the
world's cards**: GpuCompose builds each frame through **`createFrameBuilder(world, opts)`**,
the `FrameBuilder` — `build(cam, vp, dtSeconds, theme, config)` returns the `{ sources,
frames, portals, stats }` `Ground.render` takes (Active widgets in sibling order as plate
frames and field sources; the reveal on `Selected`, the lift on `Grab` × the live
`ChromeSettings.liftScale`, the heat on `OverlapCandidate`/`OverlapRejected` + the
recognizer's `DragBounds`; a live portal per gated container from the preview store, its
children at rest under the flight's exact camera); `changed()` PULLS the world's dirt (a
change collector, `coarse: false`, plus the sibling order's stamp — call it every frame);
`observe(wake)` arms the out-of-world wakes (`ChromeSettings`, a container's preview);
`live()` while a spring still moves; `geometryOf(e)`, `motionOf(e)`, `stats()`, `wakes()`.
`groundCompose({ cards })` passes the builder's options (`style`, `material`, `motion`,
`liftScale`, `sourceStrength`, `radius`, `faceRadius`, `gate`, `portalCap`); the mount
context's `previews` (`engine.previews`, which the react facade passes) feeds the portals;
the handle adds `compose.stats()`, `compose.wakes()`, `compose.geometryOf(e)`,
`compose.motionOf(e)`. **`portalAt(K, radius, arrival, cam, vp, gate?)`** is `portalOf`
past the gate on an arrival already solved (the preview's `resolvedView`) — the same
record, bit for bit. **The pack seam (design-014, B3s)**: the engine's ground is the dot
grid and the SHELL card; a look is a pack. **`@ice/ground/packs`** exports `needleGlyph`
and `cuttingMat` (`GlyphProgram`s — `instanced` over the engine's bake, or `surface` with
its own `SurfacePass`; the mat's config and clocks ride `FieldConfig.ext.mat` /
`FieldFrame.ext.mat` via `withMat` / `withMatFrame`, its light the theme's `mat` section
via `matLightOf`, its plates through `matPassOf(field)`) and `vfFrame(opts?)` (a
`CardProgram`: `resolve(ctx)` → a `VfGeometry`, `tail(G)`, `uniformValues(theme)`,
`pick(G, x, y)`, `source(w, h, lift, radius)`, plus `style` and `heat` settable, and
`springsOf(key)` / `setLocked(key, locked)` for its own buttons and lock). Register them
with `Ground.create({ card, grids })` or `groundCompose({ card, grids, onPart })`; omit
them and the shell draws. The record is a HEAD (`ShellGeometry` + the content binding,
`FRAME_HEAD_BYTES` = 144) plus the program's `ext` slots, built by `frameStruct(ext)`;
`frameUniformStruct(uext)` likewise; `CARD_ABI` pins the head. The theme is a head
(`canvasBg · fieldInk · card · hairline · select · shadow`) plus `packs[name]`, built by
`themeFrom(name, palette, grid, packs)`. `ENGINE_GRID.glyph` is `"dot"`. **The DOM boundary
(design-014, B3b)**: `groundCompose({ onPart })` — the app's action for a tap on a card
program's PART (`close`, `lock` …); the handle's `compose.domCompose` reflector (present when
the mount context carries `hosts`) writes each DOM card's content element from the same
geometry the ground draws — `clip-path` marched from `CardProgram.inner` (`clipPathOf`,
`createDomHostWriter`, `compose.domWrites()` the instrument), the lift on `transform`, the
hold's opacity; `CardProgram.inner(G, x, y)` and `clipKey(G)` are the two optional hooks a
program provides for it. The ground registers a `FramePickSource` on the interaction stack's
`framePick` slot (core: `InteractionStack.framePick`; `picking` writes `PointerPart` on the
pointer, recognizers carry `DownPart`, a part tap lands in the `PartTap` resource). In
`@ice/react`, `PresentationProfile.chromeOwner` (`dom` | `ground`) reaches widgets as
`useChromeOwner()`; an app's card shell renders bare under `ground`. **The flight (design-013, B7)**: a nav
flight is the ground's second slot — `FrameBuilder.flight(cam, vp, theme, config)` builds the departed
frame from the `NavTransition` resource (`{ present, outgoing, lodZoom }` for `Ground.render`), the host
passes it and reports `compose.stats().outgoing` and `compose.lastInputs()`; the compose layer owns the
`ground` presentation plane when the mount context carries `transitions`. In core, `NavTransition`
carries the pre-cut camera (`fromX/fromY/fromZ`) and `ticks`; `departedCameraOf(t, cam)` is the one rule
for the departed frame's camera (the pre-cut camera itself at p = 0 and while frozen); an enter starts
from the live portal's exact camera and holds its first tick at p = 0; `Retained` is written on the
departed frame's cards for the flight. **A live surface (design-013 B6,
§9 Q5)**: the handle's **`compose.video`** is the producer's door — `register(entity, {
width, height, srgb? })` claims the STABLE TEXTURE Residency names in that card's
`TextureRef` (a `video` widget: `defineWidget({ surface: "video", component: null })`, whose
pixels are the producer's and whose `component` is therefore refused), `arrive(entity,
source)` hands over a `VideoFrame` / `ImageBitmap` / canvas / video element and OWNS it from
then on (closed by the copy, by the arrival that supersedes it, by the demand clamp that
refuses it, or by `dispose` — once, never twice), `unregister`, `stats()` (`registered ·
arrivals · copies · dropped · paused`, and `arrivals === copies + dropped`). The copy is a
queue op in the profile's `video` render slot (§6's reflector 7, before GpuCompose's submit),
one per arrival, premultiplied and unflipped, and it wakes the frame through the content
residency — never a retained frame re-imported per composite. `SurfaceDemand` bites at the
door: paused drops, and a bucket allows one copy per `demandIntervalMs`. The witness is the
`video` rig. **DomRender (design-013 B4)**: `compose.residency` is the content residency (B4a) and `compose.renders.dom` is §6's
reflector-5 slot; the ground fills it with **`createDomRender({ device, world, residency,
hosts, raster?, now?, copy? })`** once `Ground.create` resolves — HiC copies a promoted card's
L1 host into the layer its `TextureRef` names (`origin = { x: u0·side, y: v0·side, z: layer }`;
`copyElementToTexture`'s `origin` grew the `z`), then `residency.wrote(e)`. Two more doors on
`ContentResidency` (design-013 C4, D-C4.7): **`unwrote(e)`** CLEARS a card's standing write, and
**`revision()`** is the texture table's revision — it moves when a handle is realised, evicted or forgotten (a NEW handle for the entity is the other retry key). Together they are
the backoff: a refused `realize` skips that entity until `revision()` moves rather than
allocating, rendering and destroying a full target every frame; and an oversize card that copied
once and then grew past the device limit inside its band calls `unwrote(e)`, so it draws the
PLATE instead of its stale raster stretched to the new box. It also OWNS the L1
host's geometry while the host is canvas-side: the box is `geometry().cssSize` and the
placement matrix carries `zoom / band`. `compose.domRender.stats()` → `{ copies, dirtied,
refused, unavailable, parked, deferred, pending, resized, pagesLayers, growths }`.
**`groundCompose({ raster })`** declares the per-kind raster strategy ONCE — the profile
carries the same function to Residency, so the slot and the host box come from one call — and
**`compose.sourceCanvas`** is `{ effects, onDirty } | null`: what the react facade needs to
build the L1 `<canvas layoutsubtree>` (null when `probeHic` finds no trial, or no
`layoutsubtree`). The mount context's `hosts` gained `hostOf(entity)` (the OUTER host, beside
`contentOf`). The pixel witnesses are the package's oracle
(`pnpm --filter @ice/ground oracle`) and the `groundlab` app's rigs; the design record is
`vibe-field/draft/ground/{README,COMPOSE,GLOW,PORTAL,MAT,FOLD}.md`.

**The magnet grid (design-010, 0.10.0; build-time wiring in 0.11.0; ONE implementation
since design-013 C2)**: the `GridPassFactory` seam and its classic/magnet pair went with the
old leg. The engine's field IS the magnet field, and the glyph is a per-canvas-type
declaration (`presentation.ground = { glyph: "dot" | "line", grid, wires, guides }`) rather
than a build-time re-export. Selecting classic is design-013's owed `classic-line` glyph, not
a rewiring. **The `line` glyph's width is a law in CSS px**, scaled by dpr at upload (design-013
C4, D-C4.10) — the same weight on every monitor, which is the old grid's unit and D-C1.4's
intent. Read literally, C1's one-device-pixel rule made the line 1 CSS px on a 1× monitor and
0.5 on retina, and at dpr 1 the peak alpha swung 0.42 → 0.31 with sub-pixel phase: a shimmer
under a pan. `lineInk` stays the theme's bytes — its brightness is a colour choice, not this
defect. The cutting mat's own line law is separate and untouched.

`grid.magnet?: Partial<GridMagnetConfig>` live-tunes the field and is deep-merged one level by
`configureGrid`. SIX of its keys map onto the engine's field: `glyph: "dot"|"needle"` ·
`reach` (CSS px at influence 0.5) · `polarity` · `alwaysAlign` · `needleLength`/`needleWidth`.
The rest — `widgets`/`widgetStrength`/`widgetRadius`, `maxSources`, `fadeZoom` — are the old
magnet grid's vocabulary and have **no field reader** since C2 (every on-screen card is a
source at strength 1); they stay declared, and core's doc comments say so at each key. There
is no `GroundContext.readSpatial` any more: the frame builder reads the cards from the world.

**`PoleSource`** (`groundField({ poles })` / `groundCompose({ poles })`): injected point
sources — the field knows no cursor vocabulary. `{read(world) => Pole[], subscribe(world,
wake)}` with `Pole = {x, y, strength, space?: "world"|"screen", pointer?: boolean}`. A pole
flagged `pointer` rides the field's ANALYTIC cursor term (D-C2.2) — its motion redraws but
never re-bakes the source buffer, and the first flagged pole in read order wins; every other
pole packs as a degenerate SDF box (≡ a point charge). The same packed set goes to every slot,
because a screen point is slot-invariant. Canned wirings: `localPointerPoles()` (the local
pointer entity, a SCREEN-space pole on `PointerScreen` since C2 — `PointerWorld` is rewritten
every tick and lags the spawn by one) · `cursorVisualPoles()` (presence cursor entities —
remote collaborators drive the field). Sources that ease should GATE their
writing systems (`runIf` + `makeVersionGuard`) — strata blanket-stamps
declared writes on every run, and an ungated easing system wakes the field's
observer every tick (design-010 §10.7).

**`changed?(world): boolean`** (optional, design-013 C4, D-C4.9) — a PULLED dirt check the host
drains every tick, beside the frame builder's own. A source that can answer "did my poles move
since you last asked?" from the world should implement it and skip `subscribe`'s wake:
`cursorVisualPoles()` uses it, over its own `coarse: false` collector on `Position`, because a
Tier-1 observer on `Position` is a subscription to the hot column every declared writer stamps —
it woke the ground on EVERY frame a remote cursor existed. `subscribe` stays, and stays right,
for a source whose dirt is not in the world at all (a halo's ease, a clock).

## @ice/devtools

`attachDevtools(engine, {container?, intervalMs?, keyOf?, cellInDoc?,
telemetry?})` → `{detach}`. Tabs: pointers/recognizers · planes ·
sovereignty · loop. Note: arming telemetry permanently arms reactive
stamping (+17–28% on write-heavy paths) — dev builds only.

## @ice/kernel

Pure math, no ECS/DOM: `screenToWorld/worldToScreen/zoomAtPoint/
planeCssTransform/worldToIsland/islandToWorld/compositeCameraFrustum` ·
`SpatialIndex` · `computeSnapGuides` · `portAnchor/wireCubic/distanceToCubic` ·
`selectBand/isOutOfBand/fboPixelSize` · `selectEvictions/computeIslandPhase`.
