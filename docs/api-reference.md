# API reference (engine v1 · the desk since design-015 D5b)

Curated reference for the published surface. Source of truth: each package's
barrel (`packages/*/src/index.ts`); design citations in the JSDoc. Everything
listed here is importable from the package ROOT — deep imports are
unsupported and wall-checked.

> **design-015 D5b (2026-09-26) — the desk is the one presentation.** `@ice/r3f`, `@ice/ground`,
> dom's world-space half, core's surface infra, the presentation profiles and the React widget
> faces are DELETED; `<InfiniteCanvas>` is `<Desk>`; a widget's face is its `object` kind
> (`@ice/desk`'s `defineObject`). The break list, export by export, is `CHANGELOG.md`
> `## [Unreleased] › ### Removed`. The sections below are amended at their rows; the retired
> packages' sections are reduced to a pointer so the history stays readable.

**What a landing must pass** (design-013 C4, D-C4.11; design-015 D1): `pnpm run ci` (typecheck ·
lint · tests · the import walls · `gen:check`) and **`pnpm run gate:landing`** — the desk's Dawn
oracle, the `apps/desk` build, its twelve rigs (`rig:parity` first: Chrome against the oracle's
bytes, maxΔ 0 asserted per scene) and `pack:audit`.
The landing gate is separate from `ci` because the oracle needs Dawn, which the
CI runner has not been probed for. A RELEASE adds the audit again from the other
side: `packages/ice`'s `prepack` runs `pack:audit`, so `npm publish` measures the
published bytes rather than trusting the last local build.

## @ice/core

### Definition primitives

| Export | Shape | Notes |
|---|---|---|
| `defineWidget(def)` | → `WidgetType` | Props DSL → conflict-group components on a durable prefab; the `object` kind binding (design-015 §5.2 — the FACE, optional: a widget without one is faceless and the desk draws nothing for it) and its `stratum` (`pads` · `sheets` · `things`) and `openable`; `ports`, `container`/`provides`, `interaction`, `renamedFrom`, `behaviors`, `migrate` chain. RETIRED at design-015 D5b and refused at definition (the `presentation` precedent): `surface`, `component`, `chrome`, `animated`, `preview`, `instancePreview`, `sizeMode`, the container's `framePreview`, and the three `ice:surface.*` behaviours that chose where a card presented (`domAtRest` · `alwaysGpu` · `alwaysDom` — the S1 gesture-set promotion with them; `git show c5df2c9:docs/api-reference.md` keeps that row). `@ice/desk`'s `defineObject({ type, kind, size, props, container })` is the typed door. |
| `p` | `p.string/number/boolean/enum/json/entityKey` | Every field defaulted; `p.json` is the conflict-coarse escape hatch; `p.entityKey` is the ONLY legal cross-entity reference in durable data. Standard Schema v1. |
| `defineBehavior(name, spec)` | → `BehaviorHandle` | Logic + state as ONE declaration; `store: "durable" \| "runtime" \| "ephemeral"` is REQUIRED and routes everything. See [Behaviors](#behaviors). |
| `defineTool(def)` / `createDrawTool(type)` | → `Tool` | Pure config: `spawnProfile`, `route {canvasDrag, canvasDragShift, widgetDrag, portDrag}` (`canvasDragShift`: what a shift-drag on the bare canvas does — the desk's `deskSelect` pans on a bare drag and marquees on a shift-drag), `gates`, `cursor`, `shortcut`. Built-ins: `select`, `pan`, `connect`. |
| `definePrefab(id, def)` | → `Prefab` | The base primitive `defineWidget` sugars over; `store: "durable" \| "runtime" \| "ephemeral"`. |
| `defineComponent/Tag/Relation/Resource` | strata wrappers | Record metadata for sovereignty/devtools; catalog in `@ice/core` ships the full engine vocabulary. |

### The facade

```ts
const ce = createCanvasEngine({ widgets?, tools?, canvasTypes?, rootCanvas?, behaviors?, budgets?, settings?, policy?, compositorDevice?, onGuestFault?, onReflectorFault? });
// the desk's preset: createCanvasEngine(DESK_ENGINE) — @vibecook/ice/desk/objects
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
`Opacity`, `ChildOf`, `PrefabId`, `Accepts`, `Provides`,
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

The React face of the desk (design-015 §3): `<Desk>` wraps `@ice/dom`'s `createDeskHost`; the
desk arrives as an OPAQUE layer factory (`layer={deskLayer({ … })}` from `@ice/desk`), so this
package imports neither the desk nor a renderer. The presentation profiles, `WidgetRoot`,
`WidgetPreview`, the surface content seam and the chrome-owner/hidden contexts left at D5b (the
CHANGELOG's `### Removed` lists them).

| Export | Notes |
|---|---|
| `<EngineProvider engine>` | Context root; all hooks require it. |
| `<Desk engine layer keymapOverrides? onReady? className? style?>` | Mounts the desk: `createDeskHost({ container, engine, layer })` + `attachKeymap`. `onReady({ engine, host, layer, focus })`. Unmount disposes the host; the engine outlives it. Children render in the container, above the canvas — screen-space chrome only (§2 law 2). |
| `LayerFactory` / `LayerHandle` / `LayerContext` | Re-exported from `@ice/dom`: the structural seam a layer factory is typed against (`deskLayer` returns one). |
| `useCommit()` | `(fn: (tx: GuardedTx) => void, {undoable?}) => void` — THE write path; one call = one undo step. |
| `useBehavior(world, entity, behavior)` | Live behavior data for one entity; `p.json` fields parsed; `undefined` when unattached (a legitimate render state). READ-ONLY — chrome renders behavior state, never writes it. |
| `useWidgetProps(world, entity, type, group?)` | Tier-3 subscription, json-parsed. |
| `useSelected` / `useBreakpoint` / `useWorldComponent` | Equality-suppressed snapshots (strata `get()` returns fresh objects — the hooks cache by shallow-eq). |
| `useTool()` / `useToolState(id)` | `[id, setTool]` over the `ActiveTool` resource. |
| `useUndoStatus()` | `{canUndo, canRedo}` via the `DurableUndoStatus` resource — survives doc swaps. |
| `usePresencePeers()` | Remote peers (`PresencePeer` × `Not(Local)`), membership-keyed stable snapshots. |
| `attachKeymap(ce, target?, overrides?)` · `nudgeSelection` · `toggleTape` | Defaults: ⌫ delete · ⌘Z/⇧⌘Z · ⌘D · ⌘A · Esc · arrows nudge (one tx/press) · ⏎ opens / enters · tool shortcuts. All resolve to ops; editable targets and keyboard claims skipped. |
| `<SelectionMenu source actions>` · `defaultSelectionActions` · `placeSelectionMenu` · `SELECTION_MENU` · `SELECTION_GLYPHS` · `selectionTaped` | *Marks on the Mat*'s ink bar and the held bar (design-015 §7–§8, D4a/D4b): placed from the desk layer's `selection` anchor. |
| `useCanvasCatalog` / `useCanvasTools` / `useCurrentCanvas` / `useCanvasDiagnostics` / `useFramePreview` · `<FramePreviewBoundary>` | The canvas SDK hooks. |
| `useWorld()` | Escape hatch: read + observe only (DEV-warned). |

## @ice/dom

SCREEN SPACE ONLY (design-015 §3, D-D15): `createCanvasHost(container)` (the styled container —
no planes; `CanvasHost { container, dispose }`) · **`createDeskHost({ container, engine, layer })`**
— the vanilla mount: host → the layer factory (`LayerContext { host, world, framePick, navGeometry,
heldPose, transitions, catalog, readMarquee }`) → reflectors [ the layer's · cursor · remote cursors ]
→ `attachPointerAdapter(host, queue)` → `attachWidgetFocus(host, lookup?)` → the viewport sync
(one layout read, then a ResizeObserver) → `startRafLoop`; `DeskHost { engine, host, layer, focus,
dispose }` · `startRafLoop(engine)` (rAF + the freeze park) · input ownership (`isEditableTarget`,
`keyboardClaimOf`, `wheelCede`, `KEYBOARD_CLAIM_ATTR`, `CLAIM_OWNS_ESCAPE`) · the focus driver
(`attachWidgetFocus`, `FOCUS_PROXY_ATTR`) · `createCursorReflector(host, readCursor)` ·
`createRemoteCursorsReflector(host, world)` (a room's other people). The world-space half — the
content and lifted planes, the plane-transform reflector, the DOM widget hosts and writeback, the L1
source canvas, the Widget Surface contract, measurement, the graybox and chrome reflectors, the GL
route — left at D5b. `<Desk>` wires all of this; direct use is for shells without React.

## @ice/r3f — RETIRED (design-015 D5b, 2026-09-26)

Deleted whole with the `three` and `@react-three/fiber` peers (D-D1): a 3D object is an object
kind with its own pass (the notebook is one). The section this replaced described `createGLBridge`,
`<GLViews>`, `useIslandFrame`, the GL pointer router, the islands and their WebGPU renderer leg —
the CHANGELOG's `### Removed` lists every export, and git history (`git show c5df2c9:docs/api-reference.md`)
keeps the prose.

## @ice/ground — RETIRED (design-015 D5b, 2026-09-26); the desk is `@ice/desk`

The 09-07 engine (the magnet field, the card pass and shell, DomRender · DomCompose · IslandRender ·
VideoIngest, the residency trunk, the copy budget, the shield, the HiC adapter, groundlab) is deleted
whole (D-D3): what it proved carries as law, its `engine/` files ARE the desk's byte for byte (D1),
and its section here is history (`git show c5df2c9:docs/api-reference.md`). The overlay seam
(`overlay` · `soup` · `wires-collect` · `guides-collect`) was not carried as code — the desk's marks
pass draws the guides and the marquee, and a wires pass is owed to the first desk kind with ports.

## @ice/desk

The desk (design-015): every object under the camera drawn by ONE WebGPU renderer FROM THE WORLD;
the DOM in screen space. Entries mirror the umbrella's: **`@ice/desk`** (the root barrel — the
renderer `Ground`/`prepareFrame`/`drawFrame`, `deskLayer(opts)` and its `DeskLayerHandle`, the one
focused editor `createNoteEditor`, the text raster `inkRaster`/`penFaces`, `decodePicture`,
`defineObject`/`objectKindOf`, the kind registry (`paperKind`, `minimatKind`, `notebookKind`,
`boardKind`, `calendarKind`, `photoKind`, …), the builder/pick/ambient/reflector of `compose`,
`instrumentSubmits`, the theme (`themeFrom`, `Palette`, `MAT`, `PAPER`, …), `shaderText`,
`blueNoise`, the mat config `DEFAULT_MAT_CONFIG`/`GLYPHS`, the springs `SPRINGS`) ·
**`@ice/desk/engine`** (the raw-WebGPU engine: `acquire`/`adopt`, the `Surface` type, `compose`/`compile`, pipelines, `Target`/`beginPass`/`readback`, `defineStruct` — the swap chain `surface()` is `@ice/desk`'s, and no pass ships here) · **`@ice/desk/objects`**
(the six reference kinds' world halves: `Note`/`NOTE_TYPE`, `MiniMat`, `Notebook`, `Board`,
`Calendar`, `Photo`, `DESK_OBJECTS`, the typing session, the strokes and pins; the engine preset
`DESK_ENGINE` — `createCanvasEngine(DESK_ENGINE)`: the objects, `deskSelect`/`DeskCanvas`, the wheel
zooming about the pointer, the scale-free zoom, the zoom-through — and the complete default palette
`deskPalette(name)`/`deskTheme(name)`, D7). Walls: `desk = core +
kernel`; nobody imports desk but apps and the umbrella; `desk-dom-free` (only `src/host/*` touches
the DOM); `desk/engine` never imports `desk/objects`. Mount: `<Desk layer={deskLayer({ theme,
palette, objects: [...DESK_OBJECTS], text, docs, blobs })}>` (react) or `createDeskHost` (dom);
`apps/desk/src/App.tsx` is the worked example; `deskPalette`/`deskTheme` are the theme's default. The oracle
(`pnpm --filter @ice/desk oracle`, Dawn in Node) and `apps/desk`'s rigs are the pixel witnesses.

## @ice/devtools

`attachDevtools(engine, {container?, intervalMs?, keyOf?, cellInDoc?,
telemetry?, dock?, observer?, profiler?, presence?, describe?})` → `{observer, profiler, lane, detach}`.
strata's observer + profiler in one draggable dock (the GL metrics panel left at design-015 D5b). Note: arming telemetry permanently arms reactive
stamping (+17–28% on write-heavy paths) — dev builds only.

## @ice/kernel

Pure math, no ECS/DOM: `screenToWorld/worldToScreen/zoomAtPoint/fitCamera` ·
`SpatialIndex` · `computeSnapGuides` · `portAnchor/wireCubic/distanceToCubic` · the easings · the
design-006 flight maths · `layout` · `atlas-pack` (parked). The island helpers, `zoom-bands`,
`eviction`, `surface-geometry` and `lift` left at design-015 D5b; `planeCssTransform` and
`tessellateCubic` at D7.
