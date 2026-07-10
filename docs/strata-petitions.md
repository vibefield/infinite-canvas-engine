# strata-ecs petitions — BOTH LANDED in strata-ecs 0.3.0 (2026-07-09)

Kept as the record of two improvement requests surfaced by the engine design reviews; both shipped upstream, additive, no breaking changes:
1. → `doc.transaction(fn, { undoable: false })` (history hooks skip it; pending redo survives) — retires the `clearHistory()` migration workaround (design-005 §6.4 updated).
2. → per-tag/relation observer precision for row-filtered `observeQuery` — retires change-only writes as a *correctness* requirement (they remain stamp-volume hygiene; design-002 §4 updated).

Original petitions below.

## 1. Per-relation/tag membership versioning

**Today** (verified `runtime-store.ts` `bumpTagRel`, `reactive.ts` row-filtered wake): tag/relation membership shares ONE global version counter; a row-filtered Tier-1 `observeQuery` wakes on ANY tag/relation churn anywhere in the world, regardless of whether its own watched membership moved. Writer `runIf`-gating cannot quiet it.

**Consequence for editors**: interaction-rate relations (hover targets, drop targets, gesture claims) must be written strictly change-only, and precision-sensitive reflectors must avoid row-filtered queries — a discipline, not a guarantee.

**Ask**: version membership per tag/relation (or per small groups), so row-filtered observers wake only when a membership they actually watch moved. Even a coarse per-registry-id counter array would eliminate the world-wide wakes.

## 2. Origin-tagged application commits (un-undoable engine transactions)

**Today** (verified `loro-snapshot.ts` UndoManager config): `excludeOriginPrefixes: [META_ORIGIN]` exists for strata's own meta writes, but application transactions cannot mark themselves undo-exempt. The engine's document migrations (read-repair at open) must run as normal transactions and then call `doc.clearHistory()` — correct, but it nukes the whole stack rather than excluding one commit.

**Ask**: allow `doc.transaction(fn, { origin })` (or an `undoable: false` option) whose commits are excluded from the UndoManager via the existing origin-prefix mechanism. Migrations, format upgrades, and janitorial transforms could then run without destroying user history.

## Petition 3 (candidate, M4/M6 field finding): same-phase writer-pair advisory opt-out

`validatePipelineAccess` warns when two systems in one phase declare the same
write column ("moveBehavior"/"resizeBehavior" × Position). Ours are
route-exclusive by design (design-003 §5 co-locates them; a recognizer is
RoutedMove xor RoutedResize), so the advisory fires on every armed boot as
permanent noise. Ask: a `SystemAccess.orderIndependent?: readonly Component[]`
hint (or a pipeline-level suppression) so deliberate co-located writers can
attest disjointness. Also from M5: a warn-suppression (or official tag) for
foreign META_ORIGIN commits — the engine's write-once meta stamps trip the
"untagged writer" warn once per peer.

## Petition 4 (candidate, M7 field finding): DEV write hook / public write version

**Today** (verified `world.ts`, `observe.ts`, `runtime-store.ts` 0.3.0):
`WorldObserver` exposes spawn/destroy/tick/phase callbacks but no
value/tag/relation WRITE hook, and the per-component version counters
(`componentMaxFrame`) are private. The M7 exit criterion "zero render→ECS
writes, DEV-asserted" therefore ships as own-property shadows over the world
instance's 14 public mutators for the duration of the GL render pass
(`@ice/r3f` `dev-write-trap.ts`) — exact and prod-free, but it patches the
world object. **Ask**: either a DEV-only `WorldObserver.onWrite?(kind)`
(synchronous, fired from the mutator chokepoints) or a public monotonic
`world.writeVersion()`; the trap then becomes observation-only
(begin/end snapshot compare) with zero patching.

## Petition 5 (candidate, M7 field finding): zero-match chunk skip + first-class tick systems

**Field impact**: `cameraControl`/`cameraInertia` (tag-only `CanvasSurface`
anchor, no `b.count` guard) ran once per archetype per frame — wheel pan,
zoom, and inertia integrated N-archetypes× per frame in real worlds, growing
with shape diversity over a session. Masked for months because the drag pan's
delta-memo is idempotent under re-execution and no trace asserted exact
magnitudes; caught 2026-07-10 by the wheel-pan direction trace (engine commit
87bb4b5). Second occurrence of this class (M4: `pointerIngest`/`spatialSync`).

**Today** (verified 0.3.0 `runtime-store.ts`): `archetypeMatchesQuery`
(:1466) narrows by COMPONENTS only — tags are row filters — so a tag-only
query's `buildMatches` (:1458) returns EVERY archetype, a list the creation
hook grows forever. `runQuery` (:1413) skips truly empty archetypes (:1425
`arch.count === 0`) but, on the row-filtered path, calls
`fillMatchedRows` and then invokes the body EVEN WHEN ZERO ROWS MATCHED
(:1436-1439 — no `count === 0` check). Every side-effectful body anchored on
a tag therefore runs once per non-empty archetype in the world.

**Explicitly NOT the ask**: making tags archetype-defining. Row-level tags
are the right call for this engine — interaction-rate tag flips
(GestureActive, Visible/Culled, one-tick Just* markers) MUST NOT migrate rows
between tables. We endorse that design; no refactor wanted.

**Ask (two additive, scoped changes)**:
1. **Skip zero-match chunks**: `if (!dense && count === 0) continue;` before
   the `fn(...)` at :1439. A body can do nothing row-wise with an empty
   chunk; anything relying on empty invocations is the anchor abuse this
   petition exists to kill. Retires the engine-wide `if (b.count === 0)
   return` house guard as a correctness requirement.
2. **First-class once-per-tick systems**: the anchor idiom exists ONLY
   because `defineSystem` requires a query — whole-frame aggregates
   (ingest, spatial sync, camera control, mount reconcile) must cosplay as
   entity systems. A `defineTickSystem(body, { name, access, runIf })`
   (queryless; body runs exactly once per tick in its phase slot) deletes
   the idiom and its footgun outright. Even with ask 1, the anchor idiom
   stays fragile-by-convention: a second entity carrying the anchor tag in
   a different shape silently doubles the body again.

**Engine migration when shipped**: convert the anchor systems
(pointerIngest, spatialSync, cameraControl, cameraInertia, widgetMount
reconcile) to tick systems; drop the count guards; the wheel-pan magnitude
trace pins correctness across the change.
