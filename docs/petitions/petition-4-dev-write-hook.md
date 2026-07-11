# Petition 4 — DEV write hook (LANDED in strata-ecs 0.4.0, 2026-07-11)

> **LANDED**: Option A, better than asked — `world.devOnWrite(cb)` is
> pre-mutation with throws PROPAGATING (a clean veto), fired from chokepoints
> downstream of bound references, covering routes the shadows missed (doc
> transactions, sync drains, undo echoes) and any future mutator; plus
> `ReadonlyWorld`/`WorldMutatorName` as the compile-time half. Engine
> migrated: the render write trap is one persistent registration + an armed
> flag; the 14 mutator shadows are deleted; `enabled` remains the app-side
> production gate per the 0.4.0 dev-mode note. Original petition below.

## The problem being solved

M7's exit criterion: **zero render→ECS writes, DEV-asserted** (design-004 §3
fix 3 — v1 wrote `R3FRenderState` from inside `useFrame`; the engine bans the
whole class). The subtlety is ATTRIBUTION, not detection:

- Out-of-tick writes are LEGAL in general. DOM handlers, app ops, doc
  transactions all mutate the world outside `tick()` by design (design-002
  §3). So "did anything write between frames?" is the wrong question.
- The ban applies to one specific execution window: the GL render pass —
  `runCompositorPass` plus every `useIslandFrame` callback it invokes. A
  write THERE is a law violation; the same write one microtask later is
  fine.

So the assert must scope to a begin/end window and, ideally, point at the
offending call site.

## What strata offers today (verified 0.3.0) — nothing usable

- `WorldObserver` (`core/observe.ts:38-59`) exposes
  onSpawn/onDestroy/onReset/onTickStart/onSystemRun/onPhaseFlush/onTickEnd —
  **no value/tag/relation write callback**.
- The per-component write versions exist internally
  (`runtime-store.ts` `componentMaxFrame`, bumped via `stampComponent` /
  `bumpComponentMax`) but are **private**, and they only stamp while
  reactivity is armed.
- Access enforcement (`beginSystemAccess`) is scoped to the RUNNING SYSTEM
  during `tick()` — the render pass runs outside the tick, so it has no
  system identity to enforce against.

## What the engine ships instead (the workaround)

`@ice/r3f` `dev-write-trap.ts`: for the duration of the pass,
`begin()` installs OWN-PROPERTY SHADOWS over the world instance's 14 public
mutators (`spawn, destroy, addComponent, removeComponent, addTag, removeTag,
setRelation, addRelation, removeRelation, setResource, updateResource, edit,
import, reset`) that throw with a message naming the law; `end()` deletes
the shadows in a `finally`, so the prototype methods resurface. Off in
production (flag), exact attribution in DEV (the throw's stack points at the
widget code that wrote).

It works — the M7 trace suite pins it — but it is honest to name its flaws:

1. **Capture bypass**: a method reference taken BEFORE `begin()` skips the
   shadow — `const grab = world.addTag.bind(world)` (or a destructured
   method held in a closure) still writes during the pass undetected.
   Nothing in the engine does this today; nothing PREVENTS it either.
2. **List drift**: the 14 names are hardcoded. A new mutator added upstream
   silently escapes the trap until we notice.
3. **Instance patching is inherently invasive**: it breaks if strata ever
   freezes/seals world instances, and it is the kind of monkey-patching the
   engine bans elsewhere (we allow it here only because it is our own
   dependency's instance, DEV-only, and scoped to a `finally`).

## Ask (two options, either retires the trap)

**Option A — DEV write hook (preferred: exact attribution).**
A callback fired synchronously from the mutator chokepoints, DEV-only:

```ts
world.devOnWrite((kind /* "component" | "tag" | "relation" | "resource" | "structural" */) => { ... })
```

Important contract detail: ordinary `WorldObserver` callbacks are
throw-swallowed (`world.ts:514` — "callbacks must not throw"), which would
neuter a veto-style assert. So this should either be a DISTINCT hook whose
throws propagate to the mutator's caller, or take a return-veto form. Fired
pre-mutation, it gives the engine exactly what the shadow trap gives —
a throw with the offender's stack — with zero patching and no capture
bypass (the chokepoint is inside strata, downstream of any bound method).

**Option B — public monotonic write version (coarse, trivial).**

```ts
world.writeVersion(): number  // bumps on ANY mutation, always (not gated on reactivity arming)
```

The trap becomes observation-only: snapshot at `begin()`, compare at
`end()`, throw "something wrote during the render pass" if it moved.
Detects reliably (no capture bypass), but cannot point at the call site —
the developer gets "a write happened", then has to bisect. Fine as a
fallback; Option A is worth the extra surface.

## Engine impact when shipped

`dev-write-trap.ts` drops the mutator shadows for the hook (A) or the
version compare (B); the M7 "ECS write inside useIslandFrame throws" trace
pins behavior across the swap; the same primitive also becomes available for
future law-windows (e.g. asserting reflectors never write ECS — design-002
§8's deferred DEV enforcement).
