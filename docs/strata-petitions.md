# strata-ecs petitions

Improvement requests from the engine to strata-ecs, each with source-verified
evidence. One file per open petition in `docs/petitions/`.

## Landed

**strata-ecs 0.12.0 (2026-08-14)** — petitions 9 + 10, both additive, one release (the
"bundle the release, not the fate" sequencing held; no breaking changes, loro peer range
unchanged):

9. **Per-commit user metadata** → `transaction(fn, { meta })`, multiplexed into strata's
   own commit message beside the anti-coalescing tag, surfacing as `batch.meta` in ONE
   canonical shape on both local-echo and remote batches. As-built deltas worth carrying
   downstream: the cap is enforced IN CODE at entry (throw >1KB, dev-warn >256B) and the
   RECEIVE side sanitizes too (oversize/malformed/non-record/`__proto__` reads as absent);
   undo/redo self-commits carry none; a meta-less commit is byte-identical to 0.11.0.
   **Two honesty notes that bind ICE's provenance story:** a SHALLOW at-rest save keeps
   only the compaction boundary's message, so per-commit provenance below the boundary is
   erased with the history it annotates (provenance has a horizon = the compaction epoch —
   the D29′ "stated horizon" law applies verbatim); and a commit whose events net to
   nothing emits NO batch, so its meta never reaches consumers (which is exactly what the
   design-009 differ produces on a no-op derive — correct, and worth knowing).
   Engine adoption: ICE threads `meta` through `guardedTransaction` (8 caller sites) with
   the behavior framework's `ctx.commit`; VibeField's door stamps `{plugin, label}`.
10. **Framework primitives** → `valueEquals(c, a, b)` on the root barrel (canonical
    COMPONENT-cell equality — NaN equal, ±0 collapsed, `undefined` = cell-absent; the
    source carries the inverted-§2.1 warning that resources must NOT reuse it) +
    `world.resourceStamp(res)` (monotonic per-WRITE counter — not the reactive frame
    stamp — bumped by `setResource`, effective `removeResource`, and `world.reset()` for
    every held resource; **arming is WORLD-WIDE**: the first read of ANY resource starts
    collection for all, and polling never arms reactivity). Engine adoption: the
    design-009 differ imports `valueEquals` (no hand-rolled equality, ever) and
    `reads: [<resource>]` behaviors arm a `resourceStamp` poll — both were REFUSED at
    definition until this landed; the refusals retire with the ICE build.

**strata-ecs 0.8.0 (2026-07-19)** — petition 8, additive (born landed — originated as
VibeField's S1, designed jointly, shipped upstream first):

8. **Ordered relations** → `defineRelation(name, { arity: "one", ordered: true })`: sibling
   sequences with collaborative convergence (CRDT movable list, native-move semantics),
   placement on `setRelation`, `moveRelation`, `orderStamp`, tx parity, undo-integrated.
   Retires `StackZ` scalar-z arithmetic, `Grab.z` restore, `topZ()` scans, and design-001's
   never-built fractional-index debt (see `petitions/petition-8-ordered-relations.md` for the
   engine migration record). Compatibility: ordered docs need all peers on 0.8.0+ — the
   envelope `engineSchema` gate covers it.

**strata-ecs 0.3.0 (2026-07-09)** — both original petitions, additive:

1. **Per-relation/tag membership versioning** → per-tag/relation observer
   precision for row-filtered `observeQuery`. Retires change-only writes as a
   *correctness* requirement (they remain stamp-volume hygiene; design-002 §4
   updated). Original ask: membership shared ONE global version counter, so a
   row-filtered Tier-1 observer woke on ANY tag/relation churn anywhere.
2. **Origin-tagged application commits** → `doc.transaction(fn, { undoable:
   false })` (history hooks skip it; pending redo survives). Retires the
   `clearHistory()` migration workaround (design-005 §6.4 updated). Original
   ask: application transactions could not mark themselves undo-exempt.

**strata-ecs 0.4.0 + 0.5.0 (2026-07-11)** — petitions 3–5, engine migrated same day (see each file's LANDED header for what shipped vs asked):

| # | Title | Landed in | Engine adoption | File |
|---|-------|-----------|-----------------|------|
| 3 | Advisory-noise opt-outs: `orderIndependent` attestation + `metaTransaction` | 0.4.0 | move/resize attest Position; stampEngineMeta → store.metaTransaction (store-first order) | [petitions/petition-3-advisory-noise.md](petitions/petition-3-advisory-noise.md) |
| 4 | DEV write hook (`world.devOnWrite` + WriteKind + ReadonlyWorld) | 0.4.0 | render write trap = persistent hook + armed flag; mutator shadows deleted | [petitions/petition-4-dev-write-hook.md](petitions/petition-4-dev-write-hook.md) |
| 5 | System Execution Semantics (P1–P5): `defineTickSystem`, attributed `ctx.query`, zero-match chunk skip | 0.5.0 | 8 anchor systems → tick systems; all `b.count === 0` guards deleted | [petitions/petition-5-system-execution-semantics.md](petitions/petition-5-system-execution-semantics.md) |

## Open candidates

| # | Title | Field finding | File |
|---|-------|---------------|------|
| 6 | ~~Public entity introspection~~ **LANDED in 0.9.0 (2026-07-19)**: `world.componentsOf(e)`/`world.tagsOf(e)` exhaustive readers, exactly as asked — and the promotion hardened them (a stale handle used to raw-TypeError in `componentsOf` and silently read the recycled slot's bits in `tagsOf`; both now generation-guarded `[]`). Pinned in ICE (94a6adc). Engine adoption: N/A-for-now — the original target (M10 devtools sovereignty eligible-set probe) was DELETED in the devtools rebuild (85ccb56) one commit after this petition was recorded; the wrapped strata observer already lists an entity's cells exhaustively, and the ICE-specific present-but-not-eligible anomaly badge is deferred until strata's observer grows an entity-detail annotation hook (future petition candidate, not filed) | M10 devtools | [petitions/petition-6-entity-introspection.md](petitions/petition-6-entity-introspection.md) |
| 7 | ~~Change detection for eager derivation systems~~ **LANDED in 0.7.0 (2026-07-14)**: opt-in pull-based `ChangeCollector` (`world.changes.collect`; exact entity journal + coarse raw-write fallback with per-collector `coarse:false` attestation). Engine adoption: spatialSync is O(delta) — idle 103→0.8µs, one-mover 98→6µs at N=2000 | 2026-07-13 perf audit — spatialSync/cull/breakpoint walk all rows every frame to confirm nothing changed | [petitions/petition-7-changed-since-gate.md](petitions/petition-7-changed-since-gate.md) · [rec](petitions/petition-7-recommendation.md) |
| — | *(none open — 9 and 10 landed in 0.12.0, see Landed above)* | | |
| 11? | Publicize `world.inImmediateProjectionUnsafeContext` (drop the `@internal` that strips it from the d.ts) — candidate, not yet filed formally | ICE 0.7.0's deferred facet withdrawal (I17, review finding 1) needs "is a structural eph op legal right now"; the getter EXISTS in the 0.12.0 runtime and its own doc-comment says "the layer consults a plain boolean", but the type is stripped, so ICE ships a safe cast (`runtime.ts`, `withdrawFacet`) with `?? false` degradation. One-word change (remove `@internal`) or a public alias | ICE behavior runtime, 2026-08-16 | — |

**Considered and NOT filed (2026-08-13, recorded so it is not re-walked):** dev-mode schema
epochs ("redefine a name with a new shape; fresh internal id; live worlds keep functioning")
— REFUTED as sketched by the door rev-3 review: queries/systems hold id-keyed handles and
would coast, but durable fact translation, Loro cell keys (`comp:<name>`), the tx overlay
seed, snapshot import/export, and baseline lookups all resolve through strata's
PROCESS-GLOBAL by-name maps, so redefinition flips them mid-flight in the SAME live world —
a durable-attached world corrupts rather than coasts. Also against strata's stated grain
("a name is defined exactly once per process"), and the documented globalThis-cache +
full-reload HMR discipline already buys the dev loop with zero library change. If the wart
ever earns the depth, the two honest shapes are per-world registry epochs (deep) or a
guarded dev-only redefine-when-fully-detached — a future petition needs its own design
round, not this sketch.

House rules for petitions: cite strata source file:line for every
current-behavior claim; state the engine field impact that motivated it;
scope the ask additive-first; record the engine migration that retires the
workaround when it ships.
