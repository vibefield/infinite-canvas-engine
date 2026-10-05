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
oracle, the `apps/desk` build, its twenty rigs (`rig:parity` first: Chrome against the oracle's
bytes, maxΔ 0 asserted per scene), `pack:audit` and the desk clock's `dts:check`.
The landing gate is separate from `ci` because the oracle needs Dawn, which the
CI runner has not been probed for. A RELEASE adds the audit again from the other
side: `packages/ice`'s `prepack` runs `pack:audit`, so `npm publish` measures the
published bytes rather than trusting the last local build.

## @ice/core

### Definition primitives

| Export | Shape | Notes |
|---|---|---|
| `defineWidget(def)` | → `WidgetType` | Props DSL → conflict-group components on a durable prefab; the `object` kind binding (design-015 §5.2 — the FACE, optional: a widget without one is faceless and the desk draws nothing for it) and its `stratum` (`pads` · `sheets` · `things`) and `openable`; `ports`, `container`/`provides`, `interaction`, `renamedFrom`, `behaviors`, `migrate` chain, and a `tray` entry (design-017 §8, K5a — `{ label, props?, take?, local?, hang: { w, h, pegs, accessory }, order?, category? }`: the object's specimen on the pegboard tray, an object's only; validated at definition; K-L2 — a plugin kind declares the same, and the catalog's widgets that carry one ARE the tray's contents; design-018 §6: `category` is the entry's CHIP on the tray's bar — the built-ins file under `paper` (the note, the print, the notebook, the calendar) and `surfaces` (the mini mat, the whiteboard), the example clock under `things`; a plugin's string is its own chip or joins one it names, and an entry with none is laid under All alone. K5b: `props` is the specimen's FACE; `take` what one taken off the tray is made with — absent the widget's defaults, `"face"` the face's props, or a record (`trayTakeProps` reads it); `local: true` draws the specimen, and a copy lifted off it, with its kind's desk state, for a face that lives there — a note's writing, a print's pictures, a pad's print); `heldTools` (each a `mode`/`action` with keys and a `HeldGlyph` — a name of the bar's set or its own drawing `{ path, fill? }`, design-016 K8a) and `menu` (K8a — `MenuActionDef { id, label, glyph?, keys?, run(api) }`: the acts the selection menu shows for a selection all of whose types declare them, run by `ops.runMenuAction`; `menuActionsFor(entities, menuOf)` is the shared rule). RETIRED at design-015 D5b and refused at definition (the `presentation` precedent): `surface`, `component`, `chrome`, `animated`, `preview`, `instancePreview`, `sizeMode`, the container's `framePreview`, and the three `ice:surface.*` behaviours that chose where a card presented (`domAtRest` · `alwaysGpu` · `alwaysDom` — the S1 gesture-set promotion with them; `git show c5df2c9:docs/api-reference.md` keeps that row). `@ice/desk`'s `defineObject({ type, kind, size, props, container })` is the typed door. |
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
  zoomToFit/zoomTo/panTo · enterContainer/exitContainer · cancelActiveGestures ·
  open/putDown/useHeldTool · runMenuAction(id)`. `runMenuAction` (design-016 K8a) runs a SELECTION
  MENU act: each selected object's type that declares `id` (`defineWidget({ menu })`) runs its op
  over its own selected objects; false when none declares it.
  Every op is one engine-owned write path (one tx / one resource write).
- The pegboard tray's facts (design-017 §2, design-018 §5–§6) are a view's, never synced — world-taking ops beside `ce.ops`:
  `openTray` (refused with an object in hand; gestures in flight cancel) · `closeTray` · `toggleTray` · `scrollTray(world, px)` ·
  `setTrayCategory(world, id)` — the drawer lays only that category's entries ("" all), the board starts again at its top, and a
  category the frame hangs none of falls back to all — and the reads `trayOpen` · `trayCategory` · `trayCategories` →
  `{ id, label, count }[]` (what the CURRENT frame hangs, in the lay's order; the label is the id capitalized) · `trayEntryCount`.
  A shut drawer takes no pointer (design-018 §5 retired the lip's handle): a host opens it by a key or its DOM bar (`<TrayBar>`). An
  open one picks no specimen within its header (design-018 R4 — the renderer's word, the pose frame's `head`): a press there is the board's.
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
| `<Desk engine layer keymapOverrides? onReady? className? style?>` | Mounts the desk: `createDeskHost({ container, engine, layer })` + `attachKeymap`. `onReady({ engine, host, layer, focus })`, once per mount — it may return a cleanup, run when that mount ends, before the host goes (StrictMode's discarded development mount included: what `onReady` starts, its cleanup undoes). Unmount disposes the host; the engine outlives it. Children render in the container, above the canvas — screen-space chrome only (§2 law 2). |
| `LayerFactory` / `LayerHandle` / `LayerContext` | Re-exported from `@ice/dom`: the structural seam a layer factory is typed against (`deskLayer` returns one). `LayerHandle.cursors?` is the layer's word on the room's other people (petition I26): `false`, the host mounts no remote cursors. |
| `useCommit()` | `(fn: (tx: GuardedTx) => void, {undoable?}) => void` — THE write path; one call = one undo step. |
| `useBehavior(world, entity, behavior)` | Live behavior data for one entity; `p.json` fields parsed; `undefined` when unattached (a legitimate render state). READ-ONLY — chrome renders behavior state, never writes it. |
| `useWidgetProps(world, entity, type, group?)` | Tier-3 subscription, json-parsed. |
| `useSelected` / `useBreakpoint` / `useWorldComponent` | Equality-suppressed snapshots (strata `get()` returns fresh objects — the hooks cache by shallow-eq). |
| `useTool()` / `useToolState(id)` | `[id, setTool]` over the `ActiveTool` resource. |
| `useUndoStatus()` | `{canUndo, canRedo}` via the `DurableUndoStatus` resource — survives doc swaps. |
| `usePresencePeers()` | Remote peers (`PresencePeer` × `Not(Local)`), membership-keyed stable snapshots. A host that draws them itself mounts the desk with `deskLayer({ cursors: false })` (petition I26), and the desk's remote cursors stay off. |
| `attachKeymap(ce, target?, overrides?)` · `nudgeSelection` · `toggleTape` | Defaults: ⌫ delete · ⌘Z/⇧⌘Z · ⌘D · ⌘A · Esc · arrows nudge (one tx/press) · ⏎ opens / enters · tool shortcuts. All resolve to ops; editable targets and keyboard claims skipped. |
| `<SelectionMenu source actions>` · `defaultSelectionActions` · `placeSelectionMenu` · `SELECTION_MENU` · `SELECTION_GLYPHS` · `selectionTaped` | *Marks on the Mat*'s ink bar and the held bar (design-015 §7–§8, D4a/D4b): placed from the desk layer's `selection` anchor. K8a: the anchor's `menu` puts a selection's KIND ACTS first (`SelectionMenuAct` — a type's `defineWidget({ menu })`, run by `ops.runMenuAction`); a held tool's or an act's glyph is a name of `SELECTION_GLYPHS` or its own drawing (`SelectionGlyph` `{ path, fill? }`), and a name the set lacks is marked missing (its initial, `data-glyph-missing`), never drawn as the ellipsis. |
| `<TrayBar source label? keys?>` · `placeTrayBar` · `TRAY_BAR` · `TRAY_BAR_GLYPHS` · `DESK_TAPE` | The pegboard drawer's HANDLE and its FILTERS (design-018 §5–§6, R4), the menu's sibling: two islands under one root. `source` is the desk handle's `tray` door, read structurally (`TrayBarSource` — `anchor()`, `subscribe()`, `toggle()`, `category(id?)`). THE PILL, in the desk's ink (the same `--ice-menu-*` custom properties, declared on its own root — an app re-points both islands alike): shut, a 40 px pill 16 px above the view's foot — the pegboard glyph and "Objects", titled "Objects (A)", `aria-expanded`; out, it rides the drawer's top edge as "× Objects", its bottom at `min(vh − 16, drawer.y − 10)`. THE CATEGORY CHIPS (R4) lie in the drawer's clear HEADER (the anchor's `drawer.header`) as LABEL TAPE — the specimens' own tags, `DESK_TAPE`'s custom properties (the tape, its raised capitals, the chosen cream, the mono face) — All, then the drawer's categories, the chosen one cream tape with ink letters; `aria-pressed`, a `role="toolbar"`; centred on the drawer and in the band, following the slide and fading in over its last part (`smoothstep(0.6, 1, p)`), scrolling inside the band past its width (each end fading where more lies beyond), stepping back by night by the anchor's `night` as the tags do. `placeTrayBar(anchor)` → `{ y, head: { x, y, w, h, opacity } | null }`. Both are written each frame the desk publishes (no render per frame, no rAF of its own) and step aside in hand and with nothing to offer. The pill and the chips' toolbar are `data-canvas-interactive`: the tray's input never takes their downs (a chip never closes the drawer) and the desk's tap lends nothing under them — the header's bare board beside them stays the drawer's. Enter/Space act on a focused button, ←/→/Home/End walk the chips; a pointer's click leaves no focus (Space still pans). |
| `useCanvasCatalog` / `useCanvasTools` / `useCurrentCanvas` / `useCanvasDiagnostics` / `useFramePreview` · `<FramePreviewBoundary>` | The canvas SDK hooks. |
| `useWorld()` | Escape hatch: read + observe only (DEV-warned). |

## @ice/dom

SCREEN SPACE ONLY (design-015 §3, D-D15): `createCanvasHost(container)` (the styled container —
no planes; `CanvasHost { container, dispose }`) · **`createDeskHost({ container, engine, layer })`**
— the vanilla mount: host → the layer factory (`LayerContext { host, world, framePick, pickAt, navGeometry,
heldPose, transitions, catalog, readMarquee }` — `pickAt` the interaction stack's exact pick out of the tick, what a press at a
screen point would touch, which the desk's `handle.pick` answers through, petition I27) → reflectors [ the layer's · cursor · remote cursors — none when the
layer's handle says `cursors: false`, petition I26 ]
→ `attachPointerAdapter(host, queue)` → `attachWidgetFocus(host, lookup?)` → the viewport sync
(one layout read, then a ResizeObserver) → `startRafLoop`; `DeskHost { engine, host, layer, focus,
dispose }` · `startRafLoop(engine)` (rAF + the freeze park) · input ownership (`isEditableTarget`,
`keyboardClaimOf`, `wheelCede`, `KEYBOARD_CLAIM_ATTR`, `CLAIM_OWNS_ESCAPE`) · the focus driver
(`attachWidgetFocus`, `FOCUS_PROXY_ATTR`) · `createCursorReflector(host, readCursor)` ·
`createRemoteCursorsReflector(host, world)` (a room's other people). The world-space half — the
content and lifted planes, the plane-transform reflector, the DOM widget hosts and writeback, the L1
source canvas, the Widget Surface contract, measurement, the graybox and chrome reflectors, the GL
route — left at D5b. `<Desk>` wires all of this; direct use is for shells without React.
**A secondary button never acts** (petition I28): the adapter enqueues every press with its PointerEvent `buttons`, and only a
PRIMARY press — the left button, a touch, a pen's tip or its eraser end — is a gesture to the interaction stack, so a secondary
(right) or middle press is a POINT whose position, exact pick (`handle.pick`) and hover move with it while nothing selects, drags,
enters, opens or works a part (in the hand too), the middle button keeping only its pan (of the bare mat, and of an object in hand
brought close), and `contextmenu`, which the adapter never listens to, is the host's.

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
renderer `Ground`/`prepareFrame`/`drawFrame`, `deskLayer(opts)` and its `DeskLayerHandle` (`handle.editor()`
is the desk's ONE focused editor — the desk makes it at every mount, whatever kinds are registered, K8a; `status()` says whether
it draws and `onStatus(listener)` hears each move — a device lost after the boot included, K9 — and `status().faults` (petition I24:
`readonly { kind, reason }[]`, absent while none) names the KINDS the desk draws as MISSING, contained per kind — refused at create, or
quarantined at three strikes; the state stays `ready`, each kind said once (Plugin parity, below, says what a kind's author can expect);
`due(now).kinds[kind]` is `KIND_MISSING` (−1) for one; `setTheme(theme, palette?)` re-dresses the desk, and beside it
`capture({ rect?, scale? }) → Promise<ImageBitmap | undefined>` is THE CAPTURE DOOR (petition I23): the desk as the LAST PRESENTED frame showed it — the same
camera, theme, marks, hand and tray — as a bitmap of `rect` (CSS px of the view; the whole view when absent) at the view's dpr × `scale` (1; a thumbnail asks
0.25), drawn ONCE MORE from that frame's inputs into a readable still and read back (never a copy kept of every frame, never a frame: no redraw, no wake, the
memory ledger's own `capture` line while the still lives); taken under `engine.frame.freeze` it is the parked frame, live the most recent; `undefined`, never
a throw, while `status()` is `failed` or `degraded`, before the first frame or when the device is lost mid-copy; and `pick({ x, y }) → PickResult | null` is THE
DESK'S PICK (petition I27 — a host's right-click selects the object under the pointer first): the object at a point (CSS px of the view — a pointer event's
client point less the container's rect) as the desk's own pick resolves it — the interaction stack's exact pick, the body a press's `TouchesExact` is written by
(`createDeskHost` hands it to the layer as `LayerContext.pickAt`), so the answer is what a primary click there selects. `PickResult { entity, type, canvas,
part }`: the topmost object by stratum and sibling order through its kind's mirror on the last frame's geometry, its `type` (`PrefabId` — `engine.catalog.widget(type)`),
the `canvas` it lies in (the board root, or the container entered), its kind's `part` there (`""` the object itself; a named part — the calendar's roll — is the
kind's, which a click works and does not select). On a live mini mat's face it is the mini mat: the inside's objects are no members of the frame (a click there
selects the mini mat; `ops.setSelection` takes none of them) — entered, they pick with the mini mat as their canvas. Synchronous and read-only: no redraw, no
wake, no write — it never selects (the host does, `ops.setSelection([entity])`). `null` over the bare mat and its rulers (printed on it), on chrome with no type
(a resize handle), while an object is in hand or the pegboard drawer is out (the desk inert to the pointer), before the first frame, and while `status()` is
`pending` or `failed` (`degraded` picks: the desk still draws, a click still selects); a point that is not two finite numbers throws.
`packages/desk/test/pick.test.ts` and rig:interact's pick row (ten points of a showcase, a right-click's point against a primary click's selection) hold it;
`handle.tray` is the pegboard drawer's door — `open`/`close`/`toggle`/`isOpen`/`scroll`/`state`/`pin`, and since design-018 §5–§6 `category(id?)`, `categories()`, `anchor()` (`TrayAnchor`: the drawer as the last frame drew it — its `header`, the clear band under its edge, included — the view, the theme's `night`, the hand, the entries, the chips) and `subscribe(listener)`, told after each frame that moved what `anchor()` says and never at rest), the text raster `inkRaster`/`penFaces`, `decodePicture`,
the kind CONTRACT — `defineObject`/`objectKindOf`/`driversOf`/`hostOf`, `ObjectKind`, `KindProgram`, `KindHost`,
`ObjectHost` (a kind's DOM half, declared: `lend` · `text` · `mount` — design-016 K4b, K8a) —, the builder/pick/ambient/reflector
of `compose`, `instrumentSubmits`, the GPU profiler (design-016 K2: `createGpuProfiler` — the layer's `handle.profiler()`, unarmed until
`arm()` — `instrumentPasses`, `instrumentMemory` under `deskLayer({ gpuLedger: true })`, `ablateKinds`/`withoutKind`,
`traceOf`; `packages/devtools/README.md` says what each number means), the theme (`themeFrom`, `Palette`, `MAT`, …), `shaderText`
(the desk's WGSL: the kit, the mat, the hold, the marks), `blueNoise`, `createStill` (petition I30 — one still of a desk on the
caller's device, no canvas: Plugin parity, below), the mat config `DEFAULT_MAT_CONFIG`/`GLYPHS`, the springs
`SPRINGS`, the zoom band `ZOOM_MIN`/`ZOOM_MAX`) · **`@ice/desk/engine`** (the raw-WebGPU engine: `acquire`/`adopt`, the
`Surface` type, `compose`/`compile`, pipelines, `Target`/`beginPass`/`readback`, `defineStruct` — the swap chain `surface()` is
`@ice/desk`'s, and no pass ships here) · **`@ice/desk/kit`** (the render kit a kind's pass is written against besides the engine:
the slot's view and its mat, the lamp, `kitWgsl`, a container's inside, the service keys a kind lends and uses). The desk names no kind.
The kit's `portal` piece — `portal_cover`, a fragment's cover through the slot's chain of faces — honours a face's top FEATHER
(design-018 §4, R4: the pegboard tray's face carries one, its top the foot of the drawer's clear header, so its specimens dissolve into the board below it; every kind
that multiplies by `portal_cover` fades with no code of its own). A LAYERED kind (its objects drawn into a target of its own, laid in
one composite) keeps the contract as one object: the kit's composite lays the layer through the slot's chain (`layerComposite`, its
bindings `layerCompositeLayout(device, label)`, and `BoxTargets(device, label, layoutComp, samples, view)` — `view` the slot's view
block, `MatPass.view`).

**The kit's WGSL (petition I31)** — what `kitWgsl(names, own, text?)` composes before a kind's own text, in this order, each piece
once however many of its names are asked. Every function, struct and const in them carries a `///` block naming each parameter
with its units and range and saying its answer (`/// →`); `shaderText(KIT_WGSL_FILES)` hands their text with the blocks in it,
`check-docs` holds every declaration to one and pack:audit holds the SHIPPED text to the same. THE CONVENTIONS: world units — one
is one CSS px at zoom 1, x right and y DOWN; CSS px = (world − `u.cam.xy`) · zoom, origin the attachment's top-left; device px =
CSS px · dpr, a fragment's `@builtin(position).xy`; zoom = `mat_zoom(u)` (CSS px per world unit) and dpr = `mat_dpr(u)` (the
attachment's own — below 1 for a thumbnail); the lamp's desk in metres, y up; colours 0..1, sRGB-encoded unless a parameter says
LINEAR.
- **`view`** — `MatUniforms`, the slot's view block, bound as `u` at `@group(0) @binding(0)`: the camera (`cam` — the world point
  at the attachment's top-left, the zoom, the dpr), the view (`view` — its CSS size, the grain's clock, the objects' opacity), the
  lattice, the gobo, the night, the portal chain, the rulers, the light; its JSDoc lists every field with its units.
- **`portal`** (portal.wgsl) — `portal_cover(p_css, u.portals, u.clips, dpr)` → [0, 1]: the cover through the slot's chain of
  faces (1 everywhere at the root, a one-device-px ramp on each edge, a face's top feather) — what every kind multiplies its
  output by; `portal_cover_one`, `portal_cover_grown` and `portal_sd` its parts.
- **`sdf`** (primitives.wgsl) — exact signed distances in the units given, negative inside: `sdf_box`, `sdf_round_box` (its CPU
  mirror is `sdRoundBox`), `sdf_circle`, `sdf_segment` (unsigned), `sdf_rounded_x`; the fillets `op_union_round` and
  `op_isect_round`.
- **`light`** (mat/mat.wgsl; `lamp`, `gobo`, `night` and `noise` name it too) — `mat_zoom` and `mat_dpr`; the noise `hash12` and
  `value_noise` → [0, 1); the sRGB curve both ways (`srgb_to_linear`, `night_encode`), `rgb2hsb` and `hsb2rgb`; the gobo —
  `desk_of(u, world)` (world → the desk, metres), `sample_gobo` → [0, 1] (1 = lit), `lit_desk` and `lit_gobo` (under the light
  the slot is lit by); the day's chain `shade_mat(u, albedo, gobo)` (sRGB in, sRGB out — exactly `albedo` where lit) and the
  night's `night_mat(u, albedo, gobo, noise)` (LINEAR in, sRGB out); `mat_colour`, the MAT's (one albedo into both chains — a
  kind with an sRGB colour splits it as the book's `nb_colour` does); the lattice's `line_coverage`, `grid2`, `line_weight` and
  `mat_albedo`.
- **`ruler`** (mat/ruler.wgsl) — `ruler_ink(u, screen, frag, glyph_tex, samp)` → the rulers' ink coverage, 0..1 (the frame, the
  ticks, the numerals); `ruler_band` and the label arithmetic (`ruler_label`, `ruler_label_len` …).
- **`book`** (kit/book.wgsl over `NbUniforms` and `NbBook`, after `light`) — the 3D kit, a world with HEIGHT (z up off the
  desk): the desk eye `nb_clip` (perspective from an eye above the view's centre — exactly the slot's map at z = 0) and
  `nb_desk_at`; the PCSS shadow `nb_shadow` → [0, 1]; the colour chain `nb_colour`; noise with gradients (`nb_hash`, `nb_vn`,
  `nb_fbm`); the cloth (`nb_cloth`), the paper (`nb_paper`, `nb_ruling`), the cover (`nb_design`, `nb_cover_g`,
  `nb_cover_albedo`), a board's inside and edge (`nb_endpaper`, `nb_board`), a stack's edge (`nb_edge`).
- The composite (kit/composite.wgsl — `LAYER_COMPOSITE_FILE`, composed by `layerComposite`) — a layered kind's resolved,
  premultiplied layer laid through the slot's chain.
- `defineStruct` (`@ice/desk/engine`) — `FieldType`'s JSDoc gives each type's alignment and size (`vec3f` 16 and 12 — a scalar
  after it rides in its tail; `mat4x4f` column-major; `array<vec4f, N>` at stride 16) and `defineStruct`'s the placement: each
  field at its alignment, the struct rounded up to 16 so one record is a legal uniform member and storage element alike.

**The host's chrome on the desk (petitions I20, I21, I26)** — beside `grid` (the root's mat config — its rulers, its gobo; `configureMat`
live), `deskLayer` takes the numbers a host's own chrome sets, read at the mount, each the desk's own when absent: **`hold: { top?,
band?, travelMs? }`** — the held object's reading fit keeps `top` CSS px under the view's top (56; a phone keeps its 60) and `band`
above its foot (72), and the held bar travels `travelMs` (M1; 340) — the bar being the host's, the selection's anchor carries it
(`anchor().held.travelMs`, present only when set; `<SelectionMenu>` follows it); **`tray: { foot? }`** — the pegboard's laid content
ends `foot` CSS px above the board's bottom edge (0), the header's mirror: the face's clip and the tags end there, the veil lays the
plain board over the foot and feathers it, the scroll's range grows by it so the last line is still reached, and core never hovers or
takes a specimen there (the pose seam's `TrayScreenFrame.foot`); the board runs to its edge. A malformed number throws at the mount.
And **`cursors?: boolean`** (petition I26; `true` when absent) — a host that draws the room's people itself (VibeField, each by face,
from `usePresencePeers`) passes `false`, and the host the layer is mounted in (`createDeskHost`, `<Desk>`) mounts no remote cursors:
no plane, no reflector. The layer says it on its handle (`DeskLayerHandle.cursors`, read at the mount), where the host reads it
(`@ice/dom`'s structural `LayerHandle.cursors?`); the presence session, core's derived hands (`CursorVisual "remote"`),
`usePresencePeers` and the OS cursor are untouched. Their reflector is the desk host's one OBSERVING reflector (the desk's and the OS
cursor's are `always`), so it is what arms the world's reactive layer — and strata's dev access enforcement with it — at the mount;
with it off, the world arms at the host's own first observer (`usePresencePeers` is one).

**The kind set — fixed for a layer's life (petition I25)** — a desk draws its objects by the kinds it was MOUNTED with: the
catalog's object types and `deskLayer({ objects })`, read once at the mount and compiled there (`Ground.create`). Registering a type
after the mount adds no kind. Under `createDeskHost`/`<Desk>` the catalog is the engine's, which `createCanvasEngine` builds once; a
catalog a host hands a layer itself (the context's structural `catalog`) is read at the mount alone. An object of a type whose kind
the desk was not mounted with wears the missing face (petition I24's, pickable by its box), the desk says so once a type on the
console ("… remount to draw it"), and the tray hangs no specimen of it. A host that changes its kinds — a plugin enabled, updated or
removed — REMOUNTS the layer on a new generation (a new factory: `<Desk>` disposes the mount and mounts the new one; `createDeskHost`
is disposed and made again), on a new engine when its catalog changes: the desk resolves an object's type through the engine's
catalog, and on one engine a remount compiles that catalog's kinds again (VibeField's generation is both, its B4 remount; making
the engine and reopening the document are the host's cost, not counted here). What a remount costs, measured by `rig:remount` — the
showcase (the six kinds and the clock, one of each) remounted five times a run, ten runs, on an Apple M1 Max (macOS 26, Chrome 154
headless, 1200 × 800 @ 2): the device in hand 4–6 ms, the passes compiled 34–52 ms, the first frame presented 92–124 ms after the
mount (each run's medians 4.3–5.4 / 35–40 / 100–113 ms) — two runs under another landing gate's load (14–21) included. The page's
first mount, cold, is 30–38 / 173–210 / 188–236 ms at load 5–14, and 45–102 / 215–274 / 245–301 ms under that load: a COLD mount
past 250 ms, which no remount came near (≤ 124 ms). A remount compiles the same programs again, warm (a fifth of the cold compile here); a
plugin whose program changed pays that program's cold compile on top (not measured). A host veils it or not on these; each mount
reads its own off `perf().boot` (`DeskLayerBoot`: `device`, `compiled` — the status `ready` —, `presented` — the first frame's GPU
work done —, ms since the mount, each absent until it happens). A document survives a remount untouched — the layer holds
no document state: it draws what it reads from the world, the document is the engine's, and a typing session open at the unmount
commits as it ends (the editor's lease ends with the desk). Proven by `packages/desk/test/kind-set.test.ts` (no commit across an
unmount and the next mount, the snapshot byte for byte; the next generation draws the same objects), by
`packages/objects/test/note-session.test.ts` (the session open at the editor's dispose commits once) and by `rig:remount` (the
showcase's document across five remounts, its snapshot's sha-256 unchanged, no outbound commit). Nothing outlives its generation:
the memory ledger reads zero after each unmount, a generation with a kind refused at create and one quarantined included. The door —
a kind replaced on a live desk (`handle.kinds.replace`) — is deferred: a remount's first frame is within 250 ms here.

**Plugin parity (design-016 K-L2, K8a)** — whatever a built-in kind does, a plugin kind declares the same way, and no list in the
engine names a kind:
- **When your kind is compiled** (petition I25): at the layer's mount — a desk's kinds are the set it was mounted with, and a host
  that registers, updates or removes one remounts the desk (the kind set, above).
- **Services**, an open registry by typed key (`@ice/desk/kit`: `serviceKey<T>(name)`, `service(key, value)`, `Services`): the host
  lends `TEXT_RASTER`, `PICTURE_DECODER`, `BLOB_STORE` (`deskLayer({ text, blobs })`) and more by key (`deskLayer({ services })`);
  an object's DOM half lends what only a browser makes (`defineObject({ host: { lend: (h) => [service(KEY, value)] } })` — the
  calendar's `PRINT_RASTER`), handed a `LendHost` (`use` + `wake`: a service whose work lands later wakes the sleeping loop, K7a);
  any kind's world half `use`s one (`KindHost.use?.(KEY)`), a DOM half too (`ObjectDomHost.use`). Keys match by NAME; a name lent
  twice is a mount error. The desk's own doors (`pass`, `children`, `drawn`, `budget`, `rasters`, `remake`, `wake`) stay
  `KindHost` fields — never lent. Every seam wakes the sleeping loop where it changes something visible: the editor's lease
  (`compose.wake`), a lent service's landing (`LendHost.wake`), a menu act's writes (the document's outside door).
- **Text input**: the ONE focused editor is the DESK's (`handle.editor(): DeskEditor`, `ObjectDomHost.editor`), made whatever kinds
  are registered; a kind declares its TEXT PARTS (`host: { text: (h) => TextPart[] }`) — a part with `tap` the desk routes every
  tap to (`TextTap`: the world point, the stack's exact hit), answering an `EditorLease` (`part`, `label`, `value`, `input`,
  `keydown`, `caret`, `place` → `EditorPlace`, `idle`, `ended`, `live`); a part without one is leased by the kind's own half at
  event time (`h.editor.lend(lease)`). The note's body (`NOTE_BODY`) and the calendar's day line (`CALENDAR_LINE`) are two such parts.
- **Placement by provides-keys** (`@ice/desk`): `DESK_OBJECT` (the desk canvas places what provides it), `CONTAINABLE` (the mini
  mat holds what provides it), `PINNABLE` (the calendar pins it to a day — `KindDriverHost.provides(key)`).
- **Chips and containers**: a kind's `chip()` names its `finish` (`ChipFinish`, open — the kit's `PAPER_FINISH`/`VINYL_FINISH`, or
  a preference list); a container kind declares `faceLaw: FaceLaw { radius, chips, finishes }` — its face's corner, its chip cap,
  the finishes it draws; a chip in none of them is left out and counted (`BuildWork.unchipped`).
- **Held-tool glyphs**: `HeldGlyph` — a name of the bar's set or the tool's own drawing (`{ path, fill? }`); the held bar marks an
  unknown name missing (its initial, `data-glyph-missing`), never drawing another glyph.
- **Words in hand** (petition I22): a kind's `open.readout` — a string, or `(ctx: HeldReadoutContext) => string | undefined` reading what
  its held tools' acts read (`world`, `entity`, `props()`) and its desk state (`local`) — is carried on the selection's anchor as
  `held.readout`, recomposed with it (every frame drawn while held), for a host's bar to print; none, "" or a non-string — no word; a
  throw is caught at the kind's boundary and said once. The notebook says its page ("Page 2"), the calendar its month ("September"), and
  the example's desk clock (`examples/desk-clock`) the time its hands show — a plugin's word, declared as a built-in's.
- **Menu acts**: `defineObject({ menu })` (core's `MenuActionDef`) — the anchor's `menu` carries a selection's shared acts
  (`withKindActs`), the React menu shows them first and runs `ops.runMenuAction`.
- **Tray entries and their chips** (design-017 §8, design-018 §6): `defineObject({ tray: { label, hang, category?, … } })` hangs a
  kind on the pegboard, and its `category` is its chip on the tray's bar — a plugin's string is its own chip, or joins a built-in's
  (`paper`, `surfaces`) or the example clock's (`things`) by naming it; none, and it is laid under All alone. The chips list what
  the CURRENT frame hangs (inside a container that takes none of a category there is no chip for it; a category left empty falls
  back to All).
- **Stills**: `handle.pinAsset(entity, asset)` — a kind's own asset (`ctx.asset`) in the shape the kind defines. And a kind
  author's PIXEL PROOF without a desk layer (petition I30): `createStill({ device, format, size, dpr, objects, theme?, palette?,
  camera?, stage }) → Promise<Still { width, height, rgba, dispose() }>` draws ONE frame of a desk on YOUR device — Dawn in Node
  (`acquire({ gpu: create([]) })`, `acquire` from `/desk/engine`, `create` from the `webgpu` package) or a browser's — with no canvas.
  `format` is `rgba8unorm` or `bgra8unorm` (the bytes come back RGBA either way, rows top-down, tight, alpha as drawn); `size` is CSS
  px and the still `round(width × dpr) × round(height × dpr)`; `objects` are your object types (`defineObject`'s — each one's kind is
  compiled on the still's desk; a type with no desk kind throws); `theme` is `light` (the default) or `dark`; `palette` is what your
  kind's `theme()` reads (`STILL_PALETTE`, the desk's own tokens, when absent — extend it with your kind's roles); `camera` is ICE's
  (the world point at the top-left, the zoom) and, absent, puts the world's origin at the still's centre at zoom 1.
  `stage({ engine, world, pinAsset, pinFlux })` lays the still's world — `engine` is core's `createCanvasEngine({ widgets: objects })`
  with its document open: `engine.ops.spawnWidget(type, { x, y, w?, h?, props?, parent?, undoable: false })` (the TOP-LEFT, world
  units — a CSS px at zoom 1), `pinAsset(e, asset)` your kind's asset for the still (`ctx.asset` — pin anything time- or host-dependent:
  a still never reads a wall clock), `pinFlux(e, { lift })` a held lift. The desk's builder makes the frame from that world and it is
  read back. A still is its facts and its pins: your kind is handed no `local`, there are no marks, hand or tray, and the mat lies at
  rest, lit whole. Everything made for it is released before the promise settles (the memory ledger at zero); a malformed option throws
  at the call, and the promise rejects when your kind is refused at create (the compiler's line in the reason), a GPU error is raised,
  your stage or your world half throws, or the device is lost. Stills on one device are drawn in turn. Hold `rgba` to a golden of your
  own (a sha-256 is Dawn's bytes on the host that blessed it): `examples/desk-clock/test/still.ts` (the stage) and
  `test/still.dawn.test.ts` (Dawn, the golden, the dials' pixels against the bare mat, the ledger) are the worked recipe — `pnpm still`.
- **Wakes — a desk at rest takes no step** (design-015 §2.4, design-016 K7a): the loop sleeps unless something is due, and a
  kind that does not say when it is due pays the whole desk's idle. `KindLocal.due(now)` — asked after each of the kind's ticks:
  `now` while a motion runs, a later time (a caret's blink, a layer let go), `Infinity` until a fact, an input or a wake moves
  it. **Absent while `tick` is declared, the kind is due EVERY frame and the desk never sleeps** — every frame ticks every kind
  and asks every driver; nothing is submitted, so no submit count shows it (the desk layer says it once a page on the console,
  naming the kind). `KindHost.wake()` — something landed outside a frame (a picture decoded, a tile printed, a detail
  fetched): the kind is ticked at the next frame and a sleeping loop wakes for it; never called, the arrival shows only when
  something else wakes the desk. `KindPass.idleAt(ms)` — when a layered pass's `idle(ms)` next lets a device target go (the
  tray's slots, K5a): absent, the release waits for a step taken anyway, so a desk asleep since the drawer shut keeps that
  memory. (`LendHost.wake`, above, is the same word for a lent service.)
- **A kind's logic: its desk state, drivers, or a behavior (D-K8b.1)** — design-015 §5.2 planned `behaviors: [noteTyping]` on core's
  `defineBehavior`; as built, the desk's hands-on logic is desk-local DRIVERS. A plugin kind uses the same three the built-ins use,
  each for its own kind of state (design-015's law: facts in the world, flux outside it):
  1. its **desk state** — `ObjectKind.local(host)` → `KindLocal` (`tick`, `due`, `landed`, `forget`) — for what it DRAWS from flux
     and WHEN the desk must wake for it: per desk, never in the document, never polled (`due` is the registered wake, K7a). The desk
     clock is this alone: its hands read the host's clock, `due` is the wall's next second (or minute) a drawn clock needs;
  2. **drivers** — `defineObject({ drivers })` → a `KindDriver` made per desk from `KindDriverHost`, ticked before the kinds' clocks
     — for what FOLLOWS INPUT on one desk (a pen, a carry, a leaf, a typing session): the hand onto the kind's flux, writing facts only
     through the document's doors at the gesture's end. Desk-local because that flux is per view (two desks on one document have two
     pens) and because a driver reads the builder (geometry as drawn, the hand), which core's systems never see;
  3. **`defineBehavior`** — core's (design-009), passed through `defineObject({ behaviors })` as for any widget — for logic whose STATE
     IS A FACT the world must sync, undo or keep across views (`store: "durable"` data riding the object, `"runtime"` state every peer
     projects). Not for typing: a typing session's live text is flux written under the gesture's claim and committed whole at its end
     (design-015 §6.1, D2c) — a behavior's durable store would sync every keystroke — so `noteTyping` stays a driver, and the plan's
     `behaviors: [noteTyping]` is superseded. In short: drawn from time or a device → `local` with `due`; worked by hand → `drivers`;
     durable or peer-shared logic → `behaviors`.
- **When a kind breaks — contained per kind (petition I24)**: a plugin kind runs in the renderer's realm on the host's device, and its
  fault is its own — said once, drawn as missing, never the desk down. What its author can expect:
  1. **At create** — its pass is made beside every other kind's, each in an error scope of its own. If its `create` rejects (a WGSL
     that will not compile: the engine's `compile` throws) or raises a GPU error while it is made (a pipeline that fails validation),
     the kind is REFUSED: the rest of the desk boots, `status()` is `ready` with `faults: [{ kind, reason }]` — the compiler's first
     line in the reason — and the device's uncaptured-error handler never hears it (the desk is not `degraded` for it).
  2. **Per frame** — a throw out of its world half (`resolve`, `record` and what a remake asks with them — `face`, `frame`, `rung`,
     `landed` —, `chip`, `hit`, `lifted`, `veils`, its desk state's `tick` and `due`) is caught at the kind: a STRIKE, said on the
     console (`console.warn`: the call, the entity, the error) and never to the host; the frame goes on without that object (its
     record reset and made afresh next time; a `hit` that throws is a miss — the pick goes on to the object under it). The THIRD
     strike quarantines the kind (design-009 §16's ladder). What the selection's anchor asks of it — `open.readout` (I22) and
     `open.swatches` — is caught at the CALL, never a strike: no word, or the slots without their swatches, said once a page (the
     anchor is read at the host's rate and only while the object is in hand, and it draws nothing of the desk).
  3. **Missing** — refused or quarantined, the kind is MISSING for the desk's life: nothing of it is called again; its passes are
     swapped out of every slot and their `dispose` called, its desk state's `dispose` called and let go (no tick, no `due`), its
     drivers parked, its raster asks dropped and charges forgotten — the memory ledger counts none of it. Its objects wear the desk's
     MISSING FACE — a faint hatched card the size of the object's box, square to the mat, no text, picked by its box as the object
     itself (selected, moved, deleted as any object), never opened. An object whose type has NO kind on this desk (a type no catalog
     here holds, or one declared without an `object`) wears the same face. Said ONCE: the status moves with the kind named
     (`onStatus`; a kind refused at the boot rides the boot's own `ready`) and one `console.error`; `due(now).kinds[kind]` is
     `KIND_MISSING`. A kind whose card material the flat card composes turns the card off when it is quarantined (each material kind
     then draws its own runs — the same pixels, more draws) until the desk is mounted again.
  Not caught, said plainly: a throw out of a kind's PASS per frame (`prepare`, `drawRange`, `aux`) is the frame's (the reflector's
  fault: that frame skipped), its mount-time calls (`theme`, `local`, the drivers' factory, a DOM half) are the mount's, and what
  core's ops ask of it at an act (`open.tool` at the pickup, a held tool's `run`) is the op's caller's. The
  worked broken kind is the clock's fault fixture (`examples/desk-clock`: `brokenClockKind`, `DeskClockBroken`, `DeskClockFaulty`).

**The worked third-party kind (design-016 K8b)** — `examples/desk-clock` (`@ice-examples/desk-clock`, private, never published): an
analogue desk clock in a package of its own that imports ICE only as `@vibecook/ice`, `@vibecook/ice/desk`, `/desk/kit` and
`/desk/engine` — its own WGSL (`kitWgsl(["view", "portal", "sdf", "light"])`), its pass, durable props, a registered wake, a tray
entry, a menu act and held tools with their own glyphs, a word in hand (its time, I22), a chip, a round pick, a still's time through `pinAsset` — registered by
apps/desk beside the six (`c`, `s`) and drawn in the golden through the oracle's OPEN kind list (`createOracleDesk({ objects })`; a
scene's `objects: [{ type, x, y, props, asset }]`). Its walls: `test/imports.test.ts` and the cruiser rule
`examples-import-only-the-published-entries` (the published entries only, never `/desk/objects`), and `dts:check` — it compiles against
the umbrella's BUILT `.d.ts` (`skipLibCheck: false`) and every name it imports is declared there; `rig:clock` witnesses it live. Its
STILL (petition I30) is the first third-party still through the door: `test/still.ts` lays three dials through `createStill`, Dawn
draws them (`pnpm still`, in gate:landing after the oracle — not in `test`: CI runs no Dawn) and `test/still.golden.json` holds them, by
day and by night; `dts:check` compiles the still beside `src/`.

**`@ice/objects`** is `@vibecook/ice/desk/objects` (design-016 K4b: the six reference kinds' own package, built on the three desk
entries alone, exactly as a plugin kind is): `Note`/`NOTE_TYPE`, `MiniMat`, `Notebook`, `Board`, `Calendar`, `Photo`,
`DESK_OBJECTS`; the kinds' programs and world halves (`paperKind`, `minimatKind`, `notebookKind`, `boardKind`, `calendarKind`,
`photoKind`, …, `DESK_KINDS`) and specs (`PAPER`, `MINIMAT`, `BOARD`, `BOOK`); their DOM halves' makers (`createNoteBody` —
the note's text part, `NOTE_BODY` —, `createCalendarInput` — `CALENDAR_LINE` —, `printRaster` — each object declares its own,
`defineObject({ host })`); the mini mat's act `VINYL_ACT`; their `shaderText` (theirs and the
kit's); the typing session, the strokes and pins; the engine preset `DESK_ENGINE` — `createCanvasEngine(DESK_ENGINE)`: the
objects, `deskSelect`/`DeskCanvas` (which places every object that provides `@ice/desk`'s `DESK_OBJECT` and names no type — the six declare it as a plugin kind does; K5b, K8a), the wheel zooming about the pointer, the scale-free zoom, the zoom-through — and the complete
default palette `deskPalette(name)`/`deskTheme(name)`, D7. Walls: `desk = core + kernel`; nobody imports desk but apps, the
objects and the umbrella; `desk-dom-free` (only `src/host/*` touches the DOM); the desk never imports the objects; the objects
import the desk's three entries and core/kernel alone, no kind another. Mount: `<Desk layer={deskLayer({ theme,
palette, objects: [...DESK_OBJECTS], text, docs, blobs })}>` (react) or `createDeskHost` (dom);
`apps/desk/src/App.tsx` is the worked example; `deskPalette`/`deskTheme` are the theme's default. The oracle
(`pnpm --filter @ice/objects oracle`, Dawn in Node — it draws the six kinds on the desk) and `apps/desk`'s rigs are the pixel
witnesses.

## @ice/devtools

`attachDevtools(engine, {container?, intervalMs?, keyOf?, cellInDoc?,
telemetry?, dock?, observer?, profiler?, presence?, describe?, gpu?})` → `{observer, profiler, lane, gpuFrame, detach}`.
strata's observer + profiler in one draggable dock (the GL metrics panel left at design-015 D5b), and since design-016 K2 the
WebGPU desk's `gpu` slot: `gpuFrame(frame, stats)` takes the structural mirrors `GpuPanelFrame`/`GpuPanelStats` of desk's
`GpuFrameReport`/`GpuProfileStats` and reports the host lanes `desk flush`/`encode`/`gpu`; `createGpuPanel` alone for a custom
shell (packages/devtools/README.md: opening it — `~` in apps/desk — and what each number means). Note: arming telemetry permanently arms reactive
stamping (+17–28% on write-heavy paths) — dev builds only.

## @ice/kernel

Pure math, no ECS/DOM: `screenToWorld/worldToScreen/zoomAtPoint/fitCamera` ·
`SpatialIndex` · `computeSnapGuides` · `portAnchor/wireCubic/distanceToCubic` · the easings · the
design-006 flight maths · `layout` · the pegboard tray's lattice law (`PEG_LATTICE`, `TrayHang`, `hangError`, `layTray`, `TRAY_SPACING` — its first line 2 pitches down, under the drawer's header and its fade (design-018 R4) — `trayScrollMax` — design-017 §8, K5a; `specimenFit` — a specimen's scale and its object's rect in its hang, K5b) · `atlas-pack` (parked). The island helpers, `zoom-bands`,
`eviction`, `surface-geometry` and `lift` left at design-015 D5b; `planeCssTransform` and
`tessellateCubic` at D7.
