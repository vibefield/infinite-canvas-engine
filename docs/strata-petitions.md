# strata-ecs petitions

Improvement requests from the engine to strata-ecs, each with source-verified
evidence. One file per open petition in `docs/petitions/`.

## Landed (strata-ecs 0.3.0, 2026-07-09)

Both original petitions shipped upstream, additive, no breaking changes:

1. **Per-relation/tag membership versioning** → per-tag/relation observer
   precision for row-filtered `observeQuery`. Retires change-only writes as a
   *correctness* requirement (they remain stamp-volume hygiene; design-002 §4
   updated). Original ask: membership shared ONE global version counter, so a
   row-filtered Tier-1 observer woke on ANY tag/relation churn anywhere.
2. **Origin-tagged application commits** → `doc.transaction(fn, { undoable:
   false })` (history hooks skip it; pending redo survives). Retires the
   `clearHistory()` migration workaround (design-005 §6.4 updated). Original
   ask: application transactions could not mark themselves undo-exempt.

## Open candidates

| # | Title | Field finding | File |
|---|-------|---------------|------|
| 3 | Advisory-noise opt-outs: same-phase writer-pair attestation + embedder meta commits | M4/M5/M6 | [petitions/petition-3-advisory-noise.md](petitions/petition-3-advisory-noise.md) |
| 4 | DEV write hook / public write version (retires the render write trap's mutator shadows) | M7 | [petitions/petition-4-dev-write-hook.md](petitions/petition-4-dev-write-hook.md) |
| 5 | Strata System Execution Semantics (P1–P5: scheduling/iteration orthogonality; zero-match chunk skip + tick systems as the minimal step) | M7 | [petitions/petition-5-system-execution-semantics.md](petitions/petition-5-system-execution-semantics.md) |

House rules for petitions: cite strata source file:line for every
current-behavior claim; state the engine field impact that motivated it;
scope the ask additive-first; record the engine migration that retires the
workaround when it ships.
