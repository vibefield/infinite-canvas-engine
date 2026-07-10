# strata-ecs petitions — BOTH LANDED in strata-ecs 0.3.0 (2026-07-09)

Kept as the record of two improvement requests surfaced by the engine design reviews; both shipped upstream, additive, no breaking changes:
1. → `doc.transaction(fn, { undoable: false })` (history hooks skip it; pending redo survives) — retires the `clearHistory()` migration workaround (design-005 §6.4 updated).
2. → per-tag/relation observer precision for row-filtered `observeQuery` — retires change-only writes as a *correctness* requirement (they remain stamp-volume hygiene; design-002 §4 updated).

Original petitions below.

## 1. Per-relation/tag membership versioning

**Today** (verified `runtime-store.ts` `bumpTagRel`, `reactive.ts` row-filtered wake): tag/relation membership shares ONE global version counter; a row-filtered Tier-1 `observeQuery` wakes on ANY tag/relation churn anywhere in the world, regardless of whether its own watched membership moved. Writer `runIf`-gating cannot quiet it.

**Consequence for editors**: interaction-rate relations (hover targets, drop targets, gesture claims) must be written strictly change-only, and precision-sensitive reflectors must avoid row-filtered queries — a discipline, not a guarantee.

**Ask**: version membership per tag/relation (or per small groups), so row-filtered observers wake only when a membership they actually watch moved. Even a coarse per-registry-id counter array would eliminate the world-wide wakes.

## 2. Origin-tagged application commits (un-undoable engine transactions)

**Today** (verified `loro-snapshot.ts` UndoManager config): `excludeOriginPrefixes: [META_ORIGIN]` exists for strata's own meta writes, but application transactions cannot mark themselves undo-exempt. The engine's document migrations (read-repair at open) must run as normal transactions and then call `doc.clearHistory()` — correct, but it nukes the whole stack rather than excluding one commit.

**Ask**: allow `doc.transaction(fn, { origin })` (or an `undoable: false` option) whose commits are excluded from the UndoManager via the existing origin-prefix mechanism. Migrations, format upgrades, and janitorial transforms could then run without destroying user history.

## Petition 3 (candidate, M4/M6 field finding): same-phase writer-pair advisory opt-out

`validatePipelineAccess` warns when two systems in one phase declare the same
write column ("moveBehavior"/"resizeBehavior" × Position). Ours are
route-exclusive by design (design-003 §5 co-locates them; a recognizer is
RoutedMove xor RoutedResize), so the advisory fires on every armed boot as
permanent noise. Ask: a `SystemAccess.orderIndependent?: readonly Component[]`
hint (or a pipeline-level suppression) so deliberate co-located writers can
attest disjointness. Also from M5: a warn-suppression (or official tag) for
foreign META_ORIGIN commits — the engine's write-once meta stamps trip the
"untagged writer" warn once per peer.
