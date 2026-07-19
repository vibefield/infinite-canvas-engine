# Petition 6 — Public entity introspection (LANDED in strata-ecs 0.9.0, 2026-07-19)

> **LANDED (readers)**: exactly the primary ask — `world.componentsOf(e): Component[]` /
> `world.tagsOf(e): Tag[]` promoted to the public `World` surface (the
> `inspect()` alternative was not needed). The promotion HARDENED the readers:
> before it, a stale handle made `componentsOf` throw a raw TypeError
> (`archetypesById[NO_ARCHETYPE]` deref) and `tagsOf` silently read the
> recycled slot's live bits; both are now generation-guarded and read `[]`
> for dead/stale/identity-only handles, mirroring `has`/`hasTag`. Pure reads,
> iteration-safe, not reactive (poll; pair with `world.reactive` for wakes).
> Shipped in the 0.9.0 npm publish; ICE pinned it in `94a6adc`.
>
> **ADOPTION (superseded — there is no probe to retire)**: this header
> originally asserted a devtools migration that CANNOT happen as written. The
> named target — the M10 hand-rolled @ice/devtools SOVEREIGNTY panel's
> eligible-set + `world.has()` probe — no longer exists: it was DELETED in the
> devtools rebuild (`85ccb56`, "rebuild on strata's first-party tools") ONE
> commit after this petition was recorded (`2f65cf5`). @ice/devtools now WRAPS
> strata's `attachObserver`, whose observer panel ALREADY lists a selected
> entity's cells exhaustively — so the readers' devtool win is delivered by
> strata's own observer and there is nothing in ICE to switch. The one
> ICE-specific piece that did NOT survive the rebuild is the
> present-but-not-eligible ANOMALY BADGE (a prefab-eligibility overlay on the
> cell list): strata's observer exposes no per-cell annotation seam
> (`EntityDescription` is `{label, color, phase}`; `ObserverOptions` carries no
> entity-detail hook), so ICE cannot decorate the observer's cells. That badge
> is DEFERRED until strata's observer grows an entity-detail annotation /
> extension hook — a FUTURE PETITION CANDIDATE, not yet filed. The original
> petition follows; its "Engine migration when shipped" section is retained
> for provenance but is now moot.

## Field impact

The @ice/devtools SOVEREIGNTY tab shows a selected entity's component list
with doc/runtime badges (design-005 §4). The exhaustive list exists inside
strata — `RuntimeStore.componentsOf(e)` / `tagsOf(e)`
(`core/runtime-store.ts:1721/:1732`) — but the only route to it is
`world.runtime`, which is `@internal` (`core/world.ts:627-630`) and absent
from the exported `World` type: consuming it fails typecheck, and reaching
through a cast would couple the panel to a seam documented as
projection-internal.

The panel therefore falls back to iterating the entity's PREFAB-declared
eligible set and probing `world.has(e, c)` — correct for the badge use case,
but structurally incomplete: runtime cells attached BEYOND a prefab's
declared set are invisible, and tags don't list at all. A devtool that
silently under-reports an entity's actual shape is the wrong kind of wrong.

## Today (verified 0.5.0)

- `componentsOf`/`tagsOf` exist, correct and cheap (archetype column walk) —
  just unexported at the `World` surface.
- No alternative: `schemaMeta` iteration over ALL registered components ×
  `has()` probes is O(registry) per entity and still misses nothing only if
  every component flows through the engine's defineComponent wrapper (raw
  strata definitions escape).

## Ask (additive, trivial)

Promote the two readers to the public `World` surface:

```ts
world.componentsOf(e: Entity): Component[]
world.tagsOf(e: Entity): Tag[]
```

Read-only, no reactivity interaction, no new state — the `World` methods
delegate to the existing store readers exactly like `has`/`get` do. (If a
narrower posture is preferred: a `world.inspect(e)` returning
`{ components, tags }` marked dev-oriented in the JSDoc.)

## Engine migration when shipped

devtools' sovereignty detail switches from the eligible-set probe to the
exhaustive readers; beyond-prefab runtime cells and tags become visible;
the eligible-set comparison then UPGRADES the badge logic (present-but-not-
eligible = a highlighted anomaly instead of an invisible one).
