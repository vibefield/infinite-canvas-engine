# strata-ecs petitions

Improvement requests from the engine to strata-ecs, each with source-verified
evidence. One file per open petition in `docs/petitions/`.

## Landed

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

House rules for petitions: cite strata source file:line for every
current-behavior claim; state the engine field impact that motivated it;
scope the ask additive-first; record the engine migration that retires the
workaround when it ships.
