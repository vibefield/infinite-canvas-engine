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

## Petition 5 (M7 field finding): Strata System Execution Semantics

Strata currently conflates system execution with query iteration. A scheduled
system body is invoked once per visited archetype — including empty results —
so its execution count depends on the world's archetype history rather than
the schedule. This is especially dangerous when a per-archetype callback
performs global work: effects such as camera updates are repeated silently,
and singleton-anchor systems require manual guards to approximate
once-per-frame behavior.

### Principles

- **P1 — Scheduling and iteration are orthogonal.** Scheduling determines how
  often a system runs; queries determine what data it observes.
- **P2 — Top-level system invocation has stable cardinality.** A system
  dispatched once by a schedule has exactly one top-level invocation,
  independent of archetype count or world-shape history. (`runIf` composes:
  a skipped dispatch is zero invocations and stamps nothing — the existing
  contract.)
- **P3 — Iteration granularity must be explicit.** Per-entity, per-batch, and
  per-archetype execution are distinct concepts and must be visible in the
  API or lexical structure. The current fused chunk-style body survives as an
  explicitly per-batch form — it is the right ergonomics for pure per-row
  transforms and the fast SoA path; it just may no longer be the only form,
  nor ambiguous about its cardinality.
- **P4 — Ordinary queries expose current logical results, not empty storage
  structure.** Empty RESULTS — empty archetypes AND zero-match row-filtered
  chunks — produce no ordinary work items unless explicitly requested.
  (Narrow reading matters: truly empty archetypes are already skipped; the
  live leak is the zero-match filtered chunk, see evidence.)
- **P5 — Effect scope aligns with execution scope.** Global effects belong to
  system scope; batch effects to batch scope; entity effects to entity
  scope. Enforceable only once P2 gives system scope a real home; then a DEV
  assert can flag world-global writes from inside per-batch bodies.

Summary: make cardinality explicit — the scheduler owns system cardinality,
the query owns data cardinality, and code structure reveals effect
cardinality.

### Evidence (verified 0.3.0 `runtime-store.ts`)

`archetypeMatchesQuery` (:1466) narrows by COMPONENTS only — tags are row
filters — so a tag-only query's `buildMatches` (:1458) returns EVERY
archetype, a list the creation hook grows forever. `runQuery` (:1413) skips
truly empty archetypes (:1425) but, on the row-filtered path, calls
`fillMatchedRows` and then invokes the body EVEN WHEN ZERO ROWS MATCHED
(:1436-1439 — no `count === 0` check). Every side-effectful body anchored on
a tag therefore runs once per non-empty archetype in the world.

**Field impact**: `cameraControl`/`cameraInertia` (tag-only `CanvasSurface`
anchor, no `b.count` guard) integrated wheel pan, zoom, and inertia
N-archetypes× per frame, growing with shape diversity over a session. Masked
for months (the drag pan's delta-memo is idempotent under re-execution; no
trace asserted exact magnitudes); caught 2026-07-10 by the wheel-pan
direction trace (engine commit 87bb4b5). Second occurrence of the class
(M4: `pointerIngest`/`spatialSync`).

**Explicitly NOT in scope**: making tags archetype-defining. Row-level tags
are the right call — interaction-rate tag flips (GestureActive,
Visible/Culled, one-tick Just* markers) MUST NOT migrate rows between
tables. The principles fix cardinality semantics, not the tag model.

### Minimal conforming implementation (PR-sized, additive)

1. **P4 now — skip zero-match chunks**: `if (!dense && count === 0)
   continue;` before the `fn(...)` at :1439. A body can do nothing row-wise
   with an empty chunk; anything relying on empty invocations is the anchor
   abuse this petition exists to kill. Retires the engine-wide
   `if (b.count === 0) return` house guard as a correctness requirement.
2. **P2's first landing — queryless tick systems**:
   `defineTickSystem(body, { name, access, runIf })`, body runs exactly once
   per tick in its phase slot. Deletes the singleton-anchor idiom outright —
   even with (1), the idiom stays fragile-by-convention: a second entity
   carrying the anchor tag in a different shape silently doubles the body.

### Roadmap (the full P1/P3 form, pre-1.0 window)

A canonical once-per-dispatch system form with iteration inside
(`ctx.query(q).each(batch => …)`), the existing chunk-style definer kept and
NAMED as the per-batch granularity. Constraint carried from today's design:
the enforcement chokepoints — `access` charging, `stampWrites`, the
`beginSystemAccess` window — stay keyed to SYSTEM IDENTITY across inner
queries (already true for inner `world.query` col() reads — the spatialSync
precedent); P1 promotes that attribution to the load-bearing mechanism.

**Engine migration when shipped**: convert the anchor systems
(pointerIngest, spatialSync, cameraControl, cameraInertia, widgetMount
reconcile) to tick systems; drop the count guards; the wheel-pan magnitude
trace pins correctness across the change.
