# Petition 7 — Change detection for eager derivation systems (candidate; 2026-07-13 perf audit)

> **ADOPTED SHAPE (2026-07-14)**: the maintainer-side review
> ([petition-7-recommendation.md](petition-7-recommendation.md)) proposes an
> opt-in pull-based **ChangeCollector** instead of the boolean changed-since
> gate originally asked below. ENDORSED — see the final section for why it
> strictly subsumes the original ask and the engine's adoption notes. The
> sections in between are kept as the motivating evidence.

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

## Original ask (additive; superseded by the adopted shape below)

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

## Adopted shape (2026-07-14) — opt-in pull-based ChangeCollector

The maintainer recommendation
([petition-7-recommendation.md](petition-7-recommendation.md)): an exact
entity journal for writes strata can identify (edit/set, add/remove,
destroy, projection — the `doWriteCells`/migration chokepoints already
receive the entity), a **conservative per-archetype fallback** for raw
typed-array writes, a `reset` marker, per-collector epoch deduplication over
packed entity handles, and **pull** semantics: `collector.drain()` is
callable INSIDE the pipeline (`world.changes`, not `world.reactive` — a
different scheduling contract from the notify boundary).

**Why this supersedes the boolean gate:**

1. **It fixes interaction, not just idle.** `changedSince` collapses to
   "walk everything" the moment ONE entity moves — at the 2–3k ceiling a
   single-widget drag would still cost a ms-class walk per gesture frame,
   which is when the budget matters most. `drain()` is O(delta): one moved
   widget ⇒ one upsert.
2. **Same-frame exactness holds.** Pull-inside-the-pipeline sees exactly
   what today's full walk sees (everything written before the react phase);
   the design-003 §3 down-frame pick precision is untouched.
3. **The arming question (this file's 2026-07-13 amendment) is answered
   more strictly**: collectors get their OWN gate rather than riding
   `reactiveOn` — one UI `observeValue` must not tax every component write
   with journal checks. Dormant-until-attached is preserved.
4. **It retires spatialSync's private machinery entirely.** The last-known
   AABB cache, compare-and-skip and generation sweep exist only because the
   system cannot know WHICH entities changed. With a collector over
   `[Position, Size]` + `tags: [Active, WidgetEquipped]` + lifecycle, the
   body becomes: drain → per entity `isIndexable ? upsert : remove` → bump
   `SpatialVersion` if the delta was non-empty; `reset` routes to the
   existing nav `clearCaches()` rebuild.
5. **The exact/coarse hybrid fits this engine's laws.** Absolute writes via
   `ctx.*` and doc projection are both EXACT-path — the engine would see
   nearly pure exact deltas; the coarse fallback stays a safety net. And the
   `touch()` posture is right: forgetting it produces over-work, never stale
   state (unlike a SpatialDirty tag, where forgetting corrupts).

Also endorsed: rejecting a `Changed(Position)` query filter (Bevy's
looks-O(changed)-runs-O(all-matches) footgun; EnTT-style named collectors
make the cost visible), deferring exact query-deltas (entered/exited) in
favor of consumer-side `isIndexable` rechecks, and NOT introducing
fixed-size chunking (strata's archetype IS its chunk).

**Engine adoption notes (asks for the implementation):**

- **drain() allocation contract**: internal buffers reused across drains,
  returned arrays valid only until the next `drain()` — a per-frame drain
  must not be per-frame garbage.
- **Opaque coarse regions**: `ChangeRegion` should expose "iterate batches
  of this region" without leaking a live archetype/query handle.
- **Tags in v1 config are load-bearing for spatialSync** (`Active` /
  `WidgetEquipped` flips change the indexable set); resources can stay on
  the existing stamps (`cull`'s Camera dependency — and engine-side, cull
  may eventually query the rbush by viewport instead of walking at all).
- The original boolean gate needs no separate API: `drain()` emptiness IS
  `changedSince`.

## Validation spike (2026-07-14) — every load-bearing claim tested

Behavior pins are committed as `packages/core/test/strata-boundary-pins.test.ts`
(they re-run at every strata upgrade); benches ran once in node (vitest,
dev build, reactivity unarmed in the bench worlds) and are recorded here.

| # | Claim | Method | Result |
|---|-------|--------|--------|
| S1 | Stamping is opt-in, armed one-way by the first `observe*`; writes never arm | pinned test | **CONFIRMED** |
| S2 | Observers are one boundary LATE for mid-frame consumers (an observer-armed gate would give stale picks; pull-based `drain()` is required) | pinned test: react-phase system sees `flag=false` for a same-frame input-phase write while `world.get` sees the new value | **CONFIRMED** |
| S5 | "Production always arms reactivity" | pinned test: headless `createCanvasEngine` + doc + widget + steps | **CORRECTED** — the headless core facade does NOT arm; arming comes from the dom/react layers (the dom-widgets reflector registers observers at construction). True for browser apps, false for headless cores — added support for the collector's SEPARATE gate |
| S3 | The idle walk is O(N) | bench, N=100/500/2000 | **CONFIRMED with corrected magnitude**: 13.6µs → 31µs → **103µs** idle at N=2000 (node). The earlier "milliseconds-class at 2–3k" was ~10× overstated for node; ms territory needs ~10k+ entities or browser+DEV-enforcement multipliers (browser DEV measured ~3–5× node at small N). Still a constant burn worth removing |
| S4 | The boolean gate collapses to a full walk during interaction; a collector is O(delta) | bench: one entity moving per frame among N=2000 | **CONFIRMED**: full walk **98.3µs/frame** vs simulated exact-journal **~1.0µs/frame** (~100×); journal idle early-outs to ~0 |
| — | `doWriteCells` receives the entity (exact journal implementable); conservative declared-write stamping exists | source | **CONFIRMED**: `core/runtime-store.ts:1129` (`doWriteCells(e, c, encoded)`), `:663` (`stampWrites(q, comps)` — "after a system runs, stamp its access.write set") |
| — | +17–28% always-on stamping cost; Bevy `Changed<T>` iterates all matches | cite-only (strata's own bench comment `runtime-store.ts:190-192`; Bevy docs) | not re-validated |

Net: the adopted-shape endorsement stands on all structural claims; two
overstatements corrected above (S5 scope, S3 magnitude). The interaction-
time argument (S4) is the strongest measured result and is the collector's
decisive advantage over the original boolean ask.
