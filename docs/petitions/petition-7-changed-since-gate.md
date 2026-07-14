# Petition 7 — Changed-since gate for eager derivation systems (candidate; 2026-07-13 perf audit)

## Field impact

The engine's eager derivation systems — the ones that maintain module-side
caches FROM component data and therefore cannot version-guard on their own
output — walk every matched row every frame to discover that nothing
changed. Measured on widgetlab's 18-widget board (strata profiler, per-frame,
idle still scene):

| system | idle cost | what it derives |
|---|---|---|
| `spatialSync` | ~15µs | kernel SpatialIndex from Position+Size |
| `cull` | ~10–20µs | Visible/Culled from Camera × AABBs |
| `breakpoint` | ~12–15µs | size-tier tags from effective size |
| `widgetMount` | ~10µs | mount-store membership |
| `wireSync` | ~5µs | wire AABBs from endpoint anchors |

~50–60µs/frame of pure "confirm nothing happened", every frame, forever —
0.6% of a 120Hz frame budget at N=18, but the walks are O(N): at the
~2–3k-widget DOM ceiling (memory: dom-plane-scale-ceiling) they become
milliseconds-class main-thread load on completely still scenes.

Per-system caches with compare-and-skip (spatialSync's last-known AABB map)
bound the WORK per row but not the WALK: the row visit itself — `col()`
reads, `batch.entity(row)`, cache lookup — is the residual cost.

## Today (verified 0.6.0)

- The change-detection substrate already records everything needed: per-
  (archetype, component) value stamps at every write chokepoint, the
  per-archetype rows-version (`lastStructuralFrame`,
  `core/archetype.ts:42`), and per-id tag/relation membership versions
  (`core/stamps.test.ts:1-8` enumerates the substrate).
- Stamps are written AT WRITE TIME (immediate path stamps synchronously —
  `core/stamps.test.ts:77`), so a mid-frame reader would be frame-exact.
- But the only consumer is the reactive layer, which polls them "at a single
  settled point per frame" (`core/reactive.ts:2-4`) — observers fire at
  notify, one boundary LATE for a system that must react to writes made
  earlier in the SAME frame (an observer-armed dirty flag would make
  spatialSync's index stale for the picking system on the first frame of
  every gesture — exactly the down-frame precision design-003 §3 engineered
  around).
- The stamps live behind `world.runtime`, the `@internal` seam
  (`core/stamps.test.ts:8`) — no public synchronous read surface exists.
- **Stamping is OPT-IN**: every stamp site is behind the `reactiveOn` gate
  (`core/runtime-store.ts:227/:240/:591/:785` — value, resource, rows-version
  and membership stamps alike), flipped one-way by the first `observe*`
  registration (`core/runtime-store.ts:195-199`). The gate exists for cause:
  always-on stamping benched at **+17–28% on migrate-heavy scenarios**
  (`core/runtime-store.ts:190-192`). A world that never registers an
  observer records NOTHING — a naive changed-since reader there would see
  frozen counters and report "no change" forever, which is silent
  wrongness, not degradation.

## Ask (additive)

A synchronous changed-since primitive for systems, in whichever shape fits
strata's plan-cache architecture best:

1. **Query-level** (preferred): `ctx.query(q).changedSince(token, { cols })`
   → boolean + a new opaque token; true when any matched archetype's
   structural stamp, any listed column stamp, or any membership-relevant
   tag/rel stamp moved past `token`. One O(#archetypes) stamp sweep replaces
   the O(#rows) walk; the token is the system's private cursor.
2. **Batch-level** alternative: `batch.changed({ cols }, token)` so a system
   can skip UNCHANGED CHUNKS while still walking changed ones (finer, but
   callers keep more bookkeeping).

Either retires the full-walk pattern: `spatialSync` (and cull/breakpoint/
widgetMount/wireSync) open with `if (!changed) return` and cost ~0 on still
frames, with same-frame exactness the observer path cannot give.

**Arming semantics (required — the `reactiveOn` gate must stay honest):**
acquiring a changed-since cursor is a change-detection SUBSCRIPTION and must
arm `enableReactive()` exactly like `observe*` registration does — the
caller opts into the write-path stamping cost knowingly. It must never read
through an unarmed gate (frozen counters ⇒ silent "no change"). For this
engine the trade is strictly favorable: production always arms reactivity
anyway (Tier-3 props observers, reflector observes, presence), so the
stamping cost is already paid and the read surface is pure profit; and the
+17–28% figure is a migrate-heavy synthetic — interaction-rate frames write
a handful of cells (zero when idle, which is exactly when the walk-skip
pays).

## Workaround until then

Constant-factor trims only (landed with this petition): nav gating moved
from per-row `hasTag` into query tags (archetype-level filtering), and the
membership sweep generation-stamped instead of allocating a `seen` Set +
`gone` array per frame. Idle cost is walk-bound and stays O(N).
