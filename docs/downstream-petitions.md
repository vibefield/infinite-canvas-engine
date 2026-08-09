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
| I5 | VibeField | First-class prefab RENAME migration (type → type) | **RECORDED 2026-08-09, design pending** — see below. Filed by VibeField 2026-07-23 at its C2 id ratification; urgency P2 (before VibeField's replica-everywhere). |

## I5 — prefab rename migration (the open one)

**The ask** (full text: `vibe-field/draft/petitions/I5-ice-rename-migration.md`):
an in-band, engine-owned TYPE rename in the M9 family —
`registerPrefabRename(oldType, newType)` or a `renames` field beside `migrate` —
running under the single-writer law through ordinary `store.transaction()`
traffic, stamping pack markers and a tombstone so replicas converge through
normal CRDT delivery. The M9 runner (`doc/migrate.ts`) folds VERSIONS of one
type; nothing handles a type rename, and `defineWidget` throws on duplicate
types (define-widget.ts:279), so alias-by-double-registration is impossible by
design. VibeField ships an interim offline pre-attach Loro surgery
(`migrate-type-renames.ts`: fold journal → rewrite `comp:PrefabId` values,
`comp:<type>:<group>` cell names, `engine.pack.<type>.<v>` markers, envelope
`prefabVersions` → one snapshot) that is empirically verified but SOUND ONLY
SINGLE-REPLICA.

**Why this needs a design pass, not a weekend runner — the crux:** strata never
projects unknown component names (binding.ts "unknown component — never
projected"; the as-built note in `doc/migrate.ts` header). Post-rename, the OLD
type's `comp:<old>:<group>` cells are exactly that — unknown to a build that
registers only the new id — so an in-band runner CANNOT read the old values
through the world. It needs one of:

- **legacy component registration** — derivable when the rename is prop-pure
  (same groups under the old names); composition with `migrate` version chains
  complicates the shapes; or
- **raw-cell operations inside a transaction** — reading/moving unprojected
  cells at the durable layer, which strata does not expose today (a candidate
  **strata petition #9**).

Plus the convergence half: a stale replica's increments to deleted old cells can
resurrect them (concurrent map set-vs-delete), so the tombstone marker's real
job is a deterministic engine-level zombie sweep every current build applies on
sight — the acceptance sketch's "zero zombies" is a sweep property, not a CRDT
freebie. Envelope `prefabVersions` keys follow at the next checkpoint.

**Trigger:** design before VibeField's replica-everywhere phase gets a date.
Until then the offline wrapper is sound for its single-holder P0 world.
