# Petition 8 — Ordered relations (sibling sequences on arity-one relations)

**Status: LANDED in strata-ecs 0.8.0 (2026-07-19) — born landed.** Unusually, this petition
originated downstream of us (VibeField's canvas-substrate pre-design, petition S1 in their
numbering), was designed jointly against both codebases, and shipped upstream before this file
was written. This record exists so the engine's petition registry stays complete and so the
migration that retires our workaround is tracked here, per house rules.

## The ask

A relation mode where each target's reverse set is an ordered SIBLING SEQUENCE, with
collaborative convergence owned by strata (CRDT movable list), so consumers stop encoding
order as scalar arithmetic in a component cell.

## Evidence (engine-side, file:line at time of filing)

- `StackZ { z: "f64" }` (packages/core/src/catalog/scene.ts:34) is a single GLOBAL total order
  maintained by hand: `topZ()` scans every StackZ row per drag-claim
  (systems/l3-claim.ts:93-104); `reorder` scans for the extreme and writes `extreme ± step`
  (facade/create-canvas-engine.ts:440-460); duplicate writes `source.z + 1` (:414-418).
- The design-001 fractional-index safety net ("midpoints jittered, scoped rebalance") was
  never built — as-built integer writes mean two peers' concurrent bring-to-front collide on
  identical z and resolve by entity-key tiebreak (deterministic, not intent-preserving).
- Field bug de72a89 (2026-07-17): the comment box's "under its members" invariant, expressed
  as `minZ / 2` float arithmetic, landed ABOVE its members (all seeds at z 0); patched to
  `minZ − 1` plus an O(n) min-scan. Same commit discovered the dom reflector had silently
  painted in MOUNT order — scalar z was spec'd but unimplemented, undetected until then.
- `Grab.z` (catalog/gesture.ts:209) duplicates z per drag purely to restore it on
  cancel/fly-back — a scalar-restore idiom an ordered sequence replaces with placement memory.

## What landed (strata-ecs 0.8.0, additive)

`defineRelation(name, { arity: "one", ordered: true })`; `getReverse` IS sibling order;
`setRelation(child, R, parent, place?)` with `"first" | "last" | { before } | { after }`
(racing anchors degrade to "last" with a dev warning, never a throw); `world.moveRelation`;
`world.orderStamp(parent, R)` (pull-only per-parent order version, for render-ordinal caches);
reorders wake `observeQuery` watches naming R; full `ctx.*` and `tx.*` parity (tx anchors
resolve at record, re-check at seal); order syncs as CRDT movable-list state — concurrent
moves converge with native-move semantics (no duplicates, no loss), one gesture = one undo
step including moves; JSON snapshots round-trip order additively.

**Compatibility (the one non-additive edge):** documents that USE ordered relations require
every collaborator on strata-ecs 0.8.0+ — older builds delete order state on despawn and drop
order updates. Our envelope `engineSchema` gate covers this (the migration below bumps it).

## The migration that retires the workaround (this repo)

Tracked as the ordered-relations migration arc (same-day follow-up commits):

1. NEW machinery: a structural schema-migration hook (the per-prefab runner cannot spawn
   entities, see siblings, or stamp `engine.schema` — a schema-only bump previously left old
   docs read-only forever): reserves a deterministic board-root key in the meta map
   (first-writer-wins), spawns the componentless board-root, rewrites the StackZ ranking into
   per-parent sibling order by `(z asc, key)`, adds root-level ChildOf edges, stamps
   `engine.schema`. Single-writer gated (offline/empty-room open only).
2. `ChildOf` becomes `{ arity: "one", ordered: true }`; paint/pick/drop consume per-frame
   sibling order via local ordinals keyed by `orderStamp`; `reorder(top|bottom)` becomes
   move-to-end/start and gains `above(x)`; duplicate inherits the source's parent and places
   `{ after: source }`; the comment spawn places `"first"`; drag-lift elevates by
   move-to-end and restores via a placement memo (nearest surviving neighbor, never "last").
3. RETIRED: `StackZ`, `Grab.z`, `topZ()` scans, the `minZ − 1` comment-spawn scan, both
   graybox z-seed loops, and design-001's never-built fractional-index debt. Design-doc
   amendments: design-004 §1 "stratified z" amended to the per-frame sibling-order law
   (evidence: de72a89); design-005 §reorder gains `above(x)` as shipped.
