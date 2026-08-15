# Petition 10 — Framework primitives: export the canonical value equality + a public per-resource frame stamp

**Filed:** 2026-08-14 · **Status:** OPEN (ratified as design-009 BF-D20; on the behavior
framework's CRITICAL PATH — the differ and resource-reads are refused at definition until
this lands) · **Scope:** additive, two small exports, zero cost when unused.

Evidence pinned at strata-ecs 0.11.0 by the design-009 rev-3 adversarial review
(2026-08-14). Re-check line numbers on posting if the repo moved.

## The field impact that motivates it

ICE's `defineBehavior` framework (design-009) ships a **differ**: a `derived` behavior's
transactional writes are compared against current projected values and equal writes are
dropped, so deterministic derived writers (collaborative layout) quiesce and converge
without wire echo. The differ's equality MUST be strata's own — a hand-rolled comparison
drifts on exactly the cases strata canonicalizes (f32 fround, NaN, ±0), and a differ that
disagrees with reconcile's equality re-emits ops forever on cells reconcile considers
settled. Separately, behaviors declare `reads: [Camera, Viewport]`-class resource
dependencies for change-driven hooks — and resources currently have NO change-detection
path at all.

## Current behavior (source-verified)

- **The equality primitives exist and are exactly right, but are unreachable.**
  `canon(C, v)` = decode∘coerce∘encode — "the value as it reads back through C's
  columns", including `Math.fround` for f32 via a typed-array scratch
  (`src/substrate/canon.ts:25-45, 57-64`). `cellEquals` = field-wise `scalarEquals` over
  canonical values (`:107-116`); `scalarEquals` (`:98-100`) is documented as "the unique
  predicate that unifies NaN AND collapses ±0" — a NaN cell compares equal to itself and
  never strands (`:92-96`). BUT: `src/substrate/index.ts` declares itself an internal
  barrel; the root `src/index.ts` exports only `./core`; the package `exports` map has no
  `"./substrate"` entry and `files:["dist"]` blocks deep imports. No consumer outside
  strata can reach them.
- **Resources have no change path.** `setResource` never touches the changes sink — the
  exhaustive `changesSink` call-site list is `src/core/runtime-store.ts:830, :884,
  :1027-1029, :1093, :1200, :1323, :1330`; no resource site exists. Resources cannot
  enter `CollectOptions` (components + tags only, `src/core/changes.ts:73-94`) and cannot
  enter `SystemAccess` (`src/core/system.ts:210-211`). The only frame-stamp is
  `resourceFrame(id)`, marked `@internal` and living on `RuntimeStore`, not `World`
  (`src/core/runtime-store.ts:642-644`).
- **The precedent for the pull shape already shipped:** `world.orderStamp(parent, rel)`
  is public (`src/core/world.ts:386-388`), monotonic, dormant until first read, two Map
  lookups per poll — exactly the polling contract a framework `runIf` wants.

## The ask (two additive exports; pins settled 2026-08-14 pre-flight)

1. **`valueEquals(c: Component, a: unknown, b: unknown): boolean`** on the root barrel —
   canonical COMPONENT-cell equality as reconcile itself judges it, implemented over the
   existing `canon` + `cellEquals`. **Export the wrapper ONLY, not the trio** (settled:
   smaller frozen surface; widening later is additive). Scope settled by design-009
   rev 3.1: the differ compares COMPONENT cells only — behavior commits MASK
   `tx.setResource` (the resource-write fence is mechanical), so NO resource-equality
   sibling ships now; a canonResource-based sibling rides the `singleton`-behavior
   design round when earned (resources skip column coercion — component equality would
   be wrong for them; the inverted-§2.1 trap, named so nobody reuses it). Documented
   caveat: this is the CELL equality (±0 equal, NaN equal), deliberately different from
   Tier-3's `Object.is`-based shallowEqual on signed zero — one sentence so nobody
   "fixes" the divergence.
2. **`world.resourceStamp(res: Resource): number`** — a public, **monotonic per-WRITE
   counter behind its own armed flag — the literal `orderStamp` mechanics** (settled:
   NOT an exposure of the existing frame-based `resourceFrame`, which collapses
   same-frame writes and misbehaves in a never-reactive world). Dormant until first
   read, cheap poll, cleared on `world.reset`, DEV-warn-and-0 on an unregistered
   resource. Pull-based change detection for resources without touching
   `CollectOptions`, `SystemAccess`, or the sink dispatch path — free until used, per
   the house grain.

## Compatibility

Purely additive: one new root export + one new World method. No wire, no doc format, no
observer semantics change. `setResource`'s stamp bump is a counter increment behind the
same armed-check pattern `orderStamp` uses.

## Engine adoption (what it unblocks)

design-009's differ imports `valueEquals` (no hand-rolled equality, ever — BF-D20);
`reads:` resource entries arm a `resourceStamp` poll in the behavior's `runIf` (the
`orderStamp` registration-armed pattern, same caveats). Until this lands, ICE refuses
resource-reads behaviors at definition with a message naming this petition, and the
differ cannot ship. The parked NaN probe (vibe-field spec §27.15) closes on adoption:
NaN-equality is handled at the canon layer.

## Acceptance sketch

`valueEquals(Position, {x: 0.1, y: -0}, {x: Math.fround(0.1), y: 0})` is true through
the f32 path and matches `cellEquals` on every fixture strata's own reconcile suite
uses; a NaN-valued cell compares equal to itself; `world.resourceStamp(Camera)` is 0
before any write, bumps on every `setResource(Camera, …)`, survives armed across frames,
resets with the world; a poll loop over N resources costs Map lookups only; ICE's
behavior differ adopts it and deletes its definition-time refusal.
