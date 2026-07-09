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
