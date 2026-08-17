# Petition 11 — Publicize `world.inImmediateProjectionUnsafeContext`

**Filed:** 2026-08-16 · **Status:** LANDED in strata 0.13.0 (2026-08-16, same-day —
strata commit `8b22221`; npm publish pending at filing). The ask was implemented
exactly as scoped: the `@internal` tag came off the existing getter (the dts build's
`stripInternal` was the whole stripping mechanism), the doc comment was rewritten for
layer/framework authors, and `docs/api.html` + the devwrite-matrix classification
comment moved with it. Zero runtime change by construction — the property was always
on the prototype; only the shipped `.d.ts` changes. · **Scope:** additive, one word
removed, no new API surface.

Evidence pinned at strata-ecs 0.12.0 / ICE 0.7.0 (2026-08-16). Line numbers cited
against the strata tree at the 0.13.0 cut.

## The field impact that motivates it

ICE 0.7.0's petition-I17 work (withdraw ephemeral behavior facets on every
producer-stops edge) has withdrawal call sites that can land MID-TICK: an unregister
issued from inside a hook, a `goCold` from a driven guest's `runIf`, a singleton
quarantine landing inside the delivery pass. A structural ephemeral op at such a
moment throws by design (strata's projector guard), and the 0.7.0 pre-publish review's
finding 1 showed the throw escaping a remover mid-uninstall and stranding the node
with an orphan published facet. The fix defers withdrawal to the publish slot — but
deciding WHETHER to defer needs the guard's own predicate: "would a structural layer
op throw right now?". That predicate exists as `world.inImmediateProjectionUnsafeContext`,
is present in the 0.12.0 runtime JS, and its own doc comment says the layers consult
"a plain boolean" — but the `@internal` tag strips it from the emitted `.d.ts`, so ICE
ships a typed cast with `?? false` degradation
(`packages/core/src/behavior/runtime.ts:742-744`, `withdrawFacet`).

A cast against a stripped member is exactly the kind of coupling the one-version law
exists to prevent becoming invisible: it compiles against every strata version whether
or not the property exists, so a rename upstream would degrade silently to the
`?? false` path (safe here only because the deferred op is ALSO try/catch-wrapped —
a discipline the public getter's doc now states for everyone).

## Current behavior (source-verified, at 0.12.0)

- The getter exists and is the canonical predicate: `iterationDepth > 0 || ticking`
  (`src/core/world.ts:724` at the 0.13.0 cut; was `:719` at 0.12.0). Its consumers are
  strata's own layers: the ephemeral attach path refuses to attach through it
  (`src/ephemeral/attach.ts:133`) and hands it to the store as `isIterating`
  (`src/ephemeral/attach.ts:214`); the durable binding refuses identically
  (`src/durable/binding.ts:196`); the ephemeral store documents it as the structural
  mutators' iteration guard (`src/ephemeral/ephemeral-store.ts:122, :578`).
- The stripping mechanism is `stripInternal: true` in the dts tsup config
  (`tsup.config.ts`, dts entry) — removing `@internal` IS the publicization.
- The devwrite matrix already classifies the getter as a pure read
  (`src/devwrite-matrix.test.ts:927`), so no `WriteKind`/ReadonlyWorld question opens.
- Deliberate boundary, stated rather than papered over: the predicate does NOT cover
  the mid-observer-emit case — the stores guard that separately (the store's
  `inObserverEmitActive`, matching `sync()`'s DEV in-emit assert). A caller deferring
  on this getter alone must still keep the deferred op exception-safe. ICE's deferred
  jobs are try/catch-wrapped and route to `onFault`, so this boundary costs nothing.

## The ask (as landed)

Remove the `@internal` tag from the getter; keep the name and semantics byte-identical.
No alias, no rename — ICE already calls it by this name through the cast, and the name
is honest for the audience that needs it (layer and framework authors).

## Engine migration that retires the workaround

On the next strata pin bump (0.12.0 → 0.13.0, all package.json declarations incl.
`apps/*`, full trace suite per the upgrade ritual): delete the cast in
`packages/core/src/behavior/runtime.ts` `withdrawFacet` and read the getter directly;
keep the try/catch and the deferral logic unchanged (they guard the in-emit boundary
and teardown-never-throws, not the type). The `?? false` degradation retires with the
cast — under a typed getter it is unreachable.
