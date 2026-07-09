# strata-ecs petitions (ready to file upstream)

Two non-blocking improvement requests surfaced by the engine design reviews. Change-only write discipline and `clearHistory()` cover us meanwhile — these would remove the workarounds.

## 1. Per-relation/tag membership versioning

**Today** (verified `runtime-store.ts` `bumpTagRel`, `reactive.ts` row-filtered wake): tag/relation membership shares ONE global version counter; a row-filtered Tier-1 `observeQuery` wakes on ANY tag/relation churn anywhere in the world, regardless of whether its own watched membership moved. Writer `runIf`-gating cannot quiet it.

**Consequence for editors**: interaction-rate relations (hover targets, drop targets, gesture claims) must be written strictly change-only, and precision-sensitive reflectors must avoid row-filtered queries — a discipline, not a guarantee.

**Ask**: version membership per tag/relation (or per small groups), so row-filtered observers wake only when a membership they actually watch moved. Even a coarse per-registry-id counter array would eliminate the world-wide wakes.

## 2. Origin-tagged application commits (un-undoable engine transactions)

**Today** (verified `loro-snapshot.ts` UndoManager config): `excludeOriginPrefixes: [META_ORIGIN]` exists for strata's own meta writes, but application transactions cannot mark themselves undo-exempt. The engine's document migrations (read-repair at open) must run as normal transactions and then call `doc.clearHistory()` — correct, but it nukes the whole stack rather than excluding one commit.

**Ask**: allow `doc.transaction(fn, { origin })` (or an `undoable: false` option) whose commits are excluded from the UndoManager via the existing origin-prefix mechanism. Migrations, format upgrades, and janitorial transforms could then run without destroying user history.
