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
| `p` | `p.string/number/boolean/enum/json` | Every field defaulted; `p.json` is the conflict-coarse escape hatch. Standard Schema v1. |
| `defineTool(def)` / `createDrawTool(type)` | → `Tool` | Pure config: `spawnProfile`, `route {canvasDrag, widgetDrag, portDrag}`, `gates`, `cursor`, `shortcut`. Built-ins: `select`, `pan`, `connect`. |
| `definePrefab(id, def)` | → `Prefab` | The base primitive `defineWidget` sugars over; `store: "durable" \| "runtime" \| "ephemeral"`. |
| `defineComponent/Tag/Relation/Resource` | strata wrappers | Record metadata for sovereignty/devtools; catalog in `@ice/core` ships the full engine vocabulary. |

### The facade

```ts
const ce = createCanvasEngine({ widgets?, tools?, budgets?, settings?, policy?, measureQueue? });
// ce: { world, engine, stack, runtime, nav, ops, docs, budgets, step(now), dispose() }
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
