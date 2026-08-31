# Benchmarks

This file records the engine's per-milestone benchmark baselines — the
cross-cutting "Benchmarks" line in `docs/implementation-plan.md` ("churn
budget, pan O(1), pick latency, reactivity tax — tracked per milestone
against the M3 baseline"). Each milestone section below is added once that
milestone's exit criteria require a measured (not asserted) number, and
prior sections are left in place as the historical baseline.

Numbers here are measured on one developer machine, not CI-gated — they
exist to catch regressions by eye across milestones, not to assert a
threshold in a test. The bench source is the single source of truth; this
file is its recorded output.

## T2 — legacy ground vs typed GroundHost CPU proxy (2026-08-26)

**Machine**: arm64 macOS 26.5.2, Node v26.5.0.

Source: `packages/ground/bench/ground-host-parity.test.ts`
(`pnpm --filter @ice/ground bench`). Three fresh invocations; each invocation
uses seven alternating long-block repeats and the same magnet collector with a
no-op renderer.

| phase | legacy range | typed range | median paired delta | redraw parity |
| --- | ---: | ---: | ---: | ---: |
| idle | 0.464–0.492 µs/frame | 0.466–0.487 µs/frame | -1.0% | 0 / 0 |
| camera motion | 2.040–2.181 µs/frame | 2.050–2.174 µs/frame | +0.4% | 70,000 / 70,000 |

This isolates JavaScript orchestration/collection only. It is not a WebGPU or
WebGL2 result and does not establish the near-zero-regression release claim.
The hardware matrix and production-browser procedure live in
`docs/t2-release-evidence.md`.

## M8 — nested-canvas membership at scale (2026-07-15)

**Machine**: Apple M1 Max (arm64), Node v24.14.1, `@vibecook/strata-ecs` 0.7.0.

Source: `packages/core/bench/membership-scale.test.ts` (`pnpm --filter @ice/core run bench`).
Context: the container-model design discussion ("relations in one doc vs doc-per-container",
2026-07-15) stress-tested the one-doc model at 10⁵ rows and found `activeMembership`
implemented as an ungated full scan — design-004 §7 specifies `runIf: nav-change ∨ ChildOf
churn`. The gate landed the same day (petition-7 ChangeCollector, the spatialSync shape;
Position is the reparent churn-signal because frame-local coordinates make every real
reparent co-write it — see `nav/nested-canvas.ts`).

Tree shapes: `flat-100k` = 100,000 root leaves; `nested-10k/100k` = 10/100 root folder
chains × depth 8 × 125 leaves per folder. Real facade pipeline (`createCanvasEngine`),
headless, telemetry armed. µs = median.

### activeMembership per idle frame (the gate's target)

| shape | before | after | |
| --- | --- | --- | --- |
| flat-100k | 3,251.8 µs | **3.0 µs** | ~1,080× |
| nested-10k | 1,626.4 µs | **0.6 µs** | ~2,700× |
| nested-100k | 19,031.6 µs | **3.8 µs** | ~5,000× |

**Verdict: the design-004 §7 gate holds at scale.** An idle frame costs one collector
drain + one nav-frame compare; drag frames journal Position but skip on the
membership-inputs cache (O(1) per dragged entity); reparents/container-flips reclassify
only the re-anchored subtree; nav changes resweep classification but keep the input
caches (a nav-only resweep — rebuilding them cost +80 ms at 100k on the first cut).

### Whole idle frame + nav + attach (context numbers, after the gate)

| shape | frame µs | enter ms | exit ms | attach ms | envelope | seed ms |
| --- | --- | --- | --- | --- | --- | --- |
| flat-100k | 25,057 | — | — | 3,177 | 9.2 MB | 62,242 |
| nested-10k | 2,561 | 10.2 | 5.7 | 323 | 1.0 MB | 2,026 |
| nested-100k | 25,577 | 99.9 | 48.1 | 3,550 | 10.3 MB | 119,141 |

- **The idle frame at 100k is still ~25 ms — and telemetry now names the owners:**
  `breakpoint` ≈ 18.5 ms, `widgetMount` ≈ 4.0 ms, `cull` ≈ 1.9 ms per idle frame —
  three more ungated O(N)-per-tick derive systems. They are the next gating targets
  (same churn-signal treatment: breakpoint ← Size/zoom-band churn, cull ← camera/
  spatial versions, mount ← Active/Visible churn). At 10k total idle frame is 2.6 ms.
  *(Gated the same day — see the second pass below.)*
- **enter/exit at 100k+800** (99.9/48.1 ms; baseline 46.4/47.0): exit is at parity;
  enter's extra is dominated by the OTHER ungated systems reacting to the zoom-to-fit
  camera write (breakpoint recomputes all 100k zoom-dependent classes) plus a cold
  nav-sweep path — once per user click, expected to shrink when breakpoint/cull gate.
- **attach-projection is ~3.2–3.9 s at 100k rows** (docs.open → full-doc projection;
  ~0.3–0.5 s at 10k). One-time per board open. This is the honest cost of the
  "one doc per board, whole doc projects at attach" model at pathological size — the
  10k-row number is the realistic-board posture. Envelope ≈ 100 B/row.
- Membership-gate consistency is pinned by `test/trace/nav.test.ts` ("gated membership
  delta paths"): same-tick spawn classification, reparent + drag-out, container-ness
  flip re-anchoring, container reparent (DFS stops at container children), container
  despawn (orphan resweep insurance), and 20-idle-tick flip-free stability under an
  armed observer.

### Second pass (same day): breakpoint / cull / widgetMount gates + the flash fix

The three systems named above got the same treatment, through a REAL `runIf`
(`helpers/churn-guard.ts` — drain-in-runIf with a same-frame stash; `breakpoint`
declares `access.write` and a run-but-early-out would blanket-stamp it, per
helpers/version-stamps.ts). Triggers: breakpoint ← zoom compare ∨
Size/MeasuredSize/Active churn (query now ACTIVE-scoped — tiers drive rendered
content; frozen-while-hidden per design-004 §2); cull ← camera/viewport window
compare ∨ Position/Size/MeasuredSize/Active churn; widgetMount ← Visible/Culled
flips + destroys (LRU recency stamped at the flip — same eviction order).
The bench also gained camera-churn scenarios and a REAL `Viewport` (without one,
cull/mount take their headless early-return and measure nothing).

**Benching the gates found a real correctness bug (the flash):** membership
classifies on the projection frame, but equip stamps `Container` one flush later
— fresh container CONTENT anchored to root for one frame, cull mass-Visible-
tagged it in the very flush membership corrected it (change-only writes let the
conflict through), and the zombies stayed mounted forever: **6,440 phantom
mounts on a 10k-board seed**, plus polluted archetypes that defeated chunk-level
tag filtering for every Active-scoped query. Fixed at the root: membership
answers container-ness from the WIDGET REGISTRY (via PrefabId) during the
equip-lag window (`isContainerForMembership`, nav/nested-canvas.ts). Pinned by
`test/mount-gate.test.ts` ("container content never flash-mounts").

| idle µs/frame | before gates | after gates + flash fix |
| --- | --- | --- |
| flat-100k | 25,057 | **872** |
| nested-10k | 2,561 | **106** |
| nested-100k | 25,577 | **890** |

Remaining idle tail at 100k: widgetEquip 262 µs, marquee 207 µs, cursorSync 207 µs.

| camera-churn µs/frame (150-frame gestures) | zoom | pan |
| --- | --- | --- |
| flat-100k (everything Active — the O(N) ceiling) | 64,610 (bp 21,047 · cull 40,812) | 42,072 (bp SKIPPED · cull 40,817) |
| nested-10k | 460 | 276 |
| nested-100k | 4,367 (bp 1,720 · cull 1,726 · mount 8) | 2,616 (bp skipped · cull 1,711) |

- **Pan frames skip breakpoint entirely** (1 run vs 450) — pre-gate every pan
  frame paid the full scan.
- **Clean tag partitions restored chunk-level query filtering**: nested-100k
  camera frames dropped from 33/19 ms (first gated run, zombie archetypes) to
  4.4/2.6 ms — Active-scoped queries skip non-active CHUNKS wholesale, exactly
  the l1-pick "nav gating rides the walk queries at archetype level" contract.
  Corollary: a FLAT all-Active 100k board cannot skip anything — its ~40 ms
  camera frames are the honest O(N) ceiling; containers (or a future
  index-driven cull) are the structural mitigation.
- nav enter/exit at nested-100k: 30/33 ms (was 144/68 with zombies; 46/47 at
  the pre-gate baseline).
- widgetMount: 4.0 ms every idle frame → 8–51 µs, only on flip frames.

## M3 baseline (2026-07-09)

**Machine**: Apple M1 Max (arm64), Node v24.14.1, `@vibecook/strata-ecs` 0.3.0.

### Reactivity tax

Source: `packages/core/bench/reactivity-tax.test.ts` (`pnpm --filter @ice/core run bench`).

Measures strata-ecs's always-armed reactivity stamping overhead in
isolation: two identical 10,000-entity worlds run the same write-heavy
`simulate` system (`pos += vel` over raw typed-array columns, one declared
`access.write` column) for 100 warmup frames + 500 timed frames, repeated 5
times, taking the median. Scenario A never registers an observer (stays
unarmed for its whole life); scenario B registers one `observeQuery` before
stepping (arms stamping for the world's whole life — a one-way gate,
design-002 §4).

| scenario | µs/frame | overhead |
| --- | --- | --- |
| A — unarmed | 15.40 | — |
| B — armed | 15.59 | +1.3% |

Run-to-run variance across five separate invocations put the overhead
between +0.4% and +3.0%, with scenario A holding flat at ~15.4 µs/frame.

**design-002 §4 budget**: always-armed stamping is budgeted at **+17–28% on
write/migration-heavy workloads** (strata's own benchmark for the ungated
path, cited in `draft/design-002-frame-contract.md` §4). The measured
+1–3% here is well under that budget — expected, since this scenario is
narrower than the budget's case: no archetype migrations occur (only value
writes on an already-stable archetype) and only one column on one query is
observed, whereas the budget's "write/migration-heavy" figure includes
structural churn. This baseline should be revisited once the gray-box
demo's scripted-drag harness (M3, see below) exercises real migration
churn — that is the workload the §4 budget describes.

### Pan O(1) (M3 demo)

Source: `apps/graybox` scripted harness (`pnpm --filter graybox test`, or the
`p` hotkey in the running demo). 10,000 Position+Size entities, 150 scripted
camera translations, headless happy-dom. The counters are the signal
(happy-dom understates real-browser DOM cost; frame µs is the ECS tick from
engine telemetry).

| frames | plane transform writes | gray-box style writes | frame µs (median / mean) |
| --- | --- | --- | --- |
| 150 | **150** (expect 150) | **0** (expect 0) | 0.25 / 0.55 |

**Verdict: O(1) pan holds** — exactly one transform write per plane per
moving frame, independent of node count; a camera move never touches a
widget style (the gray-box query observes Position/Size only, which a pan
never stamps). The pan-frame tick is near-empty (~0.25 µs) because no
system runs — `runIf` gating skips everything and a skipped system stamps
nothing (design-002 §4).

### Churn budget under scripted drag (M3 demo)

Source: same harness (`d` hotkey). One entity dragged per frame through the
honest in-tick path — a `simulate` system with `access: { write: [Position] }`,
`runIf`-gated, `ctx.edit().set(Position)` — camera untouched.

| frames | gray-box style writes | plane transform writes | node-count delta | frame µs (median / mean) |
| --- | --- | --- | --- | --- |
| 150 | **150** (expect 150) | **0** (expect 0) | **0** (expect 0) | 62.1 / 76.5 |

**Verdict: the design-001 §7 budget holds** — per drag frame: value writes
on one entity, ONE DOM style write (the reflector's change-only geometry
cache suppresses the other 9,999), zero plane writes (camera static), zero
enter/exit (no migrations, no tag flips). The ~62 µs tick is the demo drag
system scanning all 10k rows to move one — deliberately naive; M4's real
behaviors iterate the live `Drags` edges instead. Run-to-run: the delegated
build measured pan 0.21/0.39 µs and drag 59.96/72.15 µs on the same machine —
counters identical, µs within noise.
