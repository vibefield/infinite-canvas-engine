# Downstream petitions (inbound)

Asks filed AGAINST this engine by its consumers — the inbound twin of
`docs/strata-petitions.md` (which records what ice asks OF strata). Before this
file existed, inbound asks lived only in the consumer's repo and were invisible
from here; I5 sat unrecorded for 17 days. House rules mirror the outbound ones:
evidence with file:line, field impact stated, additive-first, workaround
retirement recorded. Source of truth for the full petition texts stays the
consumer's repo (VibeField: `vibe-field/draft/petitions/`, I-series).

| ID | From | Title | Status |
|---|---|---|---|
| I1 | VibeField | Widget input-exclusivity — `defaultPrevented` gating + keyboard claim | **IMPLEMENTED 2026-08-09** — design-007 rev 2 as-built: `interaction.keyboard: "shared" \| "exclusive"` + `keyboardEscape: "release" \| "widget"`, `data-canvas-keyboard` marker + focus driver (`attachWidgetFocus`, `InfiniteCanvasHandle.focus`), keymap/adapter standdown behind ONE shared predicate family, Stage-1 `defaultPrevented` gate, facade `keymapOverrides` (the widgetlab C-key capture-phase hack is deleted — the migration proof). Undeclared widgets byte-identical. |
| I4 | VibeField | Wheel opt-out for scrollable widget content | **IMPLEMENTED 2026-08-09** — rides the same landing: dynamic `wheelCede` (scroller-with-room inside claim/`data-canvas-interactive`/editable subtrees; at-bounds falls through to canvas — nested-scroll feel), ctrl/pinch ALWAYS canvas zoom, one-tick `WheelHandled` gating BOTH wheel consumers (spawn `Not(WheelHandled)` + feed-as-silence — the feed gate was found at implementation; rev 1's spawn-only fix was insufficient). The wrapper `stopPropagation('wheel')` rule retires; unmodified `overflow:auto` content (mille's tree) scrolls natively. |
| I5 | VibeField | First-class prefab RENAME migration (type → type) | **IMPLEMENTED 2026-08-09** — design-008 as-built (same-day design + build): `renamedFrom` on `defineWidget`, gate aliasing + `engine.renamed.<old>` tombstones (un-bricks the readOnly classification; meta cannot delete, so old markers are skipped, never removed), the open-path runner under the single-writer law (fold → tombstone + carried `engine.pack.<new>.<oldV>` marker → the M9 chain composes on new names), and the observer-armed zombie sweep on every writable session (resurrections drop new-wins, late old-shape entities fold + chain from `atVersion`, id-zombies rewrite). **No strata petition was needed** — see below. VibeField's offline wrapper retires on adoption. |

## I5 — prefab rename migration (resolved)

**The ask** (full text: `vibe-field/draft/petitions/I5-ice-rename-migration.md`):
an in-band, engine-owned TYPE rename in the M9 family, running under the
single-writer law through ordinary `store.transaction()` traffic, stamping pack
markers and a tombstone so replicas converge through normal CRDT delivery —
retiring VibeField's offline pre-attach Loro surgery (sound only
single-replica).

**Resolution (design-008, as-built same day):** the feared blocker — strata
never projects unknown component names, so the old `comp:<old>:<group>` cells
looked unreachable in-band — dissolved on source verification: projection is
NAME-REGISTRY-driven (strata `componentsByName`), not prefab-driven, so
`renamedFrom` simply registers same-shaped LEGACY components under the old
names and the old cells project like any other value. No raw-cell ops, **no
strata petition #9**. The convergence half landed as designed: the tombstone's
real job is the deterministic engine-level sweep (an `observeQuery` +
between-frames microtask fold on every writable peer); "zero zombies" is a
sweep property, not a CRDT freebie, and the one true-conflict case (a stale
edit resurrecting a cell beside a post-rename cell) resolves NEW-WINS —
deterministic, and the only rule that never clobbers post-rename work.

Carried limitations (design-008 §9): read-only pre-rename docs render nothing
for old types until a writable open folds them; `definePrefab`-direct ids and
group regrouping across a rename keep their named seams.
