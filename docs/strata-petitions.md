# strata-ecs petitions

Improvement requests from the engine to strata-ecs, each with source-verified
evidence. One file per open petition in `docs/petitions/`.

## Landed

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
| 6 | Public entity introspection (`world.componentsOf`/`tagsOf` — promote the existing internal readers) | M10 devtools | [petitions/petition-6-entity-introspection.md](petitions/petition-6-entity-introspection.md) |

House rules for petitions: cite strata source file:line for every
current-behavior claim; state the engine field impact that motivated it;
scope the ask additive-first; record the engine migration that retires the
workaround when it ships.
