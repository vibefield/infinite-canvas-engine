# API reference (engine v1)

Curated reference for the published surface. Source of truth: each package's
barrel (`packages/*/src/index.ts`); design citations in the JSDoc. Everything
listed here is importable from the package ROOT — deep imports are
unsupported and wall-checked.

## @ice/core

### Definition primitives

| Export | Shape | Notes |
|---|---|---|
| `defineWidget(def)` | → `WidgetType` | Props DSL → conflict-group components on a durable prefab; `surface: "dom" \| "gl"`; `ports`, `container`/`provides`, `interaction`, `animated`, `migrate` chain. |
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
  current() · close() · undo() · redo() · autosave(storage)`.
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
| `attachPresence` / `installPresence` | Ephemeral peer facets: `PresenceInfo`, `PresenceCursor`, `SelectionSummary`; remote peers project as `Not(Local)`. |
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
  changes stream out the existing `guests.onLedgerChange`.
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

**Scale posture.** Designed for ≤~2k ticking instances. Beyond that, the idiom
is ONE behavior on a carrier entity iterating its members — the mind-map shape.

### Extension seams

`ce.engine.addSystems(phase, ...systems)` (11 fixed phases; `defineTickSystem`
for once-per-frame work) · `ce.engine.registerReflector(def)` (post-notify,
the only output writers) · `ce.engine.onPublish(hook)` (presence I/O slot) ·
`ce.engine.enableTelemetry()` / `reflectorNames()` (devtools feed).

## @ice/react

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
`createRemoteCursorsReflector`) · `startRafLoop`. `<InfiniteCanvas>` wires
all of this; direct use is for custom shells.

## @ice/r3f

`createGLBridge(engine, {devAssertRenderWrites?})` · `<GLViews engine bridge
store>` (mount inside an R3F `<Canvas frameloop="demand">` on the P2 plane) ·
`useIslandFrame(cb)` / `useIslandInvalidate()` (the ONLY sanctioned island
animation paths) · `createGLPointerRouter({world, bridge, index})` → the
adapter's `glRoute`. Zero render→ECS writes, DEV-enforced via
`world.devOnWrite`.

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
