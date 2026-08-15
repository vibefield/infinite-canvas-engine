# Implementation Plan

**infinite-canvas-engine (v3) · 2026-07-09**
Source designs: the reviewed series in `draft/` (local-dev branch; present-but-untracked on main — see CLAUDE.md). This plan expands design-005 §10 into milestones with exit criteria. Sequencing principle: **riskiest-first on gray boxes** — the frame contract and interaction stack (where v1 died) are proven against synthetic input and colored rectangles before any React/R3F/CRDT surface area is added.

---

## M0 — Bootstrap (repo, tooling, walls)

- pnpm workspace; packages `kernel` / `core` / `dom` / `react` / `r3f` / `devtools` (design-002 §6); TS strict; vitest; tsup.
- **dependency-cruiser rules from day one**: kernel imports nothing; core imports strata-ecs + kernel only (no react/dom/three); one-direction chain dom → react → r3f; devtools → core.
- Pin `@vibecook/strata-ecs` (pre-1.0); CI = typecheck + lint + test + dep-cruise (the merge gate).
- HMR-safe schema/prefab boot-kit skeleton (globalThis guard + `import.meta.hot.invalidate` — the strata reference pattern).
- File the two strata petitions early so upstream can consider them while we build: per-relation/tag versioning (design-002 §4 caveat); origin-tagged engine commits (un-undoable migrations without `clearHistory`, design-005 §10). *(Both LANDED upstream in strata 0.3.0, 2026-07-09 — see docs/strata-petitions.md.)*

**Exit**: empty packages build + import-wall violations fail CI.

## M1 — Kernel (pure math, ported)

Port from v1 (`../infinite-canvas/packages/infinite-canvas/src/`) with their tests: coordinate module (screen/world/local + zoom-around-point + THE Y-flip — one module, L13), `computeSnapGuides` (alignment + equal-spacing + merge), RBush `SpatialIndex` (O(log n) removal), `ZoomBands` + hysteresis, port-anchor + bezier + segment-distance hit math, eviction policy + fboPixelSize (the pure slices); the stateful FBO pool + ResourceRegistry land in M7 (r3f).

**Exit**: kernel suite green; zero deps; property tests on coordinate round-trips and snap merge rules.

## M2 — Core data model (design-001)

- Sovereignty registry + `definePrefab` (+ validation set from design-005 §1) + `defineDoc`-free pure components (catalog from design-001 §5, incl. the reconciled additions).
- Engine helpers: PhaseSet + `Just*` markers; version-stamp resources; `setSelection`; cascade-destroy walk.
- DEV guards: per-cell gesture guard (incl. the `TransformTween` claim); tx-eligibility validation; eid-in-durable definition-time check.

**Exit**: a write-path matrix test (every §2 rule of design-001 exercised: draft cells free, doc cells claimed-only, tx eligibility throws, riders die on despawn).

## M3 — Frame contract on a gray-box demo (design-002)

- Engine loop `setFrameInfo → sync → tick → publish → notify → reflect`; phase-group pipeline (~10 strata phases incl. `ctl:*` sub-phases); reflector registry with per-reflector dirty sets + fault isolation; `planeTransform` + a gray-box DOM reflector (colored divs, world units).
- Gray-box demo app: 10k rectangles, pan/zoom.

**Exit (measured, not asserted)**: O(1) pan (one transform write per plane per frame); churn budget of design-001 §7 verified under a scripted drag; run/skip telemetry visible; reactivity-tax baseline recorded.

## M4 — Interaction stack (design-003) — the crucible

- L0 adapters/ingest/lifecycle; L1 picking (dual-pick, plane-priority, `runIf` version guards); L2 recognizers (spawn profiles, per-kind specs, integrity via `requiredWatches`, arbitration + `ClaimedBy`, routing); `ctl:claim` systems; L3 behaviors (select/move + snap + drop/consume/fly-back, resize, marquee incl. LongPress-tail touch path, camera + inertia); cancellation matrix; access-declaration table enforced.
- **The red-team frame traces become the regression suite**: scripted synthetic pointers assert tick-by-tick outcomes (drag claim-frame first-move, quick tap, shift-tap single toggle, pinch suspension, escape one-tick cancel, remote-despawn-mid-drag survivor commit, mid-pan wheel-zoom cursor-lock, snap non-oscillation).

**Exit**: all traces green on the gray-box; two concurrent synthetic drags produce two independent commits… (commits stubbed until M5 — trace asserts runtime state + commit intents).

## M5 — Durable integration (designs 001 §3/§6 + 005 §6 core)

- Doc kit core: create/attach/detach/switch on one world; gesture commit protocol live (one tx per gesture, liveness guards); undo/redo + selection history hooks; autosave kit; envelope + version gate (marker keys, read pre-attach).
- Divergence tests against a simulated second peer (BroadcastChannel): remote edit to a dragged cell held then released on commit/cancel; per-gesture undo steps; fly-back reconvergence.

**Exit**: two-tab demo — concurrent drags converge per strata semantics; undo restores selection; corrupt autosave quarantines instead of bricking boot.

## M6 — Widget runtime, DOM half (design-004 §1–2, §5)

- Real planes P0/P1/P3–P5; hosts + portals-from-one-root + keep-mounted LRU + frozen-hidden subscriptions; measurement path (RO disconnect-on-hide, `MeasuredSize`, effective size); drag-promote portal swap; chrome reflector (pooled nodes, marquee buffer); breakpoints; grid shader.
- `defineWidget` compiler v1: props DSL → group components; capability stamping; `useWidgetProps`/`useBreakpoint`/`useSelected`.
- Demo: card board app (DOM widgets), the v1 playground reborn.

**Exit**: naive widget handlers compose per the pinned contract (native opt-out, stopPropagation boundary, inert-during-drag); cull/re-enter preserves React state within budget.

## M7 — GL views (design-004 §3–4)

- Islands + FBO pool with retention decoupled from cull (+ specified fallbacks); neutral composite (`{opacity}`); two-level invalidation; `animated`/`useIslandFrame` contract; router GL path (synchronous point-pick, synthetic events, `surfaceHandled`).
- Demo: mixed DOM+GL board; interactive GL widget internals on touch.

**Exit**: first-tap-on-GL-widget trace green; zero render→ECS writes (asserted by a DEV hook); FBO budget honored under scripted zoom/cull storms.

## M8 — Node editor layer (designs 001 §5.3, 003 §5.8, 004 §6–7)

- Ports (on-demand materialization, budgets, light-up staging); wires (P0 pass, pick-below-widgets, connect gesture + preview continuity, endpoint cascade); containers (consume/fly-back full path); nested canvas (activeMembership, nav ops + index rebuild + nav integrity, `NavEntry` stack).

**Exit**: node-graph demo (spawn nodes, wire them, enter a container, delete an endpoint → wire cascades); zero port churn panning with the select tool (measured).

## M9 — Presence & collab polish (design-005 §6.5 + presence catalog)

- Presence publish (publish step), remote cursors + selection summaries, bootstrap kit (hello/snapshot/buffer, reconnect = re-bootstrap), ws-relay adapter, read-only attach mode, migration read-repair path with legacy-schema registration test.

**Exit**: two-machine collab demo over the dumb relay; version-skew test: older pack opens read-only, migrator upgrades via `{ undoable: false }` transactions (strata 0.3.0 — user history survives), both converge.

## M10 — API polish, devtools, docs

- Ops catalog + keymap complete; devtools tabs (pointers/recognizers, planes, sovereignty, loop); `<InfiniteCanvas>` config surface + budgets; examples; README; API reference.

**Exit**: a third-party-shaped sample app builds against the published surface only (no deep imports).

---

# Post-v1 — the behavior framework train (M11–M13)

**Added 2026-08-15.** Source designs: `draft/design-009-behavior-framework.md` (rev 3,
reviewed — the BF-D decisions) + the two ICE petitions it compiles onto
(`vibe-field/draft/petitions/I14-ice-guest-runtime.md`, `I15-ice-tx-move.md`). Upstream
prerequisites **DONE**: strata 0.12.0 (petitions 9+10 — `transaction(fn,{meta})`,
`valueEquals`, `world.resourceStamp`) is pinned and CI-green as of the same day.

Sequencing principle, inherited from M0–M10 and from the strata round: **riskiest-first,
and bundle the release, not the fate.** M11 and M12 are independently valuable (each
carries real bug fixes the field wants regardless of the framework), so they cut as
**ICE 0.5.0** even if M13 slips; M13 cuts as **0.6.0**. Nothing in M13 may begin before
M11's breaker exists — the framework's whole safety story is "compiled onto that
substrate, never a second runtime" (BF-D12).

## M11 — The guest runtime (petition I14) · 0.5.0 half 1 — **DONE 2026-08-15**

*(As-built: 44 new traces, every fix mutation-probed — reverting it reds its own test and
nothing else. Full CI green at 856 tests / 472 modules. design-002 §1.1 carries the
as-built amendment. Two findings beyond the plan: the rAF fix also closed a latent
`stop()`-during-step resurrection, and `EngineOpts` gained `onGuestFault`/`onGuestNotice`
because a suspended derived guest is a product event a host must be able to route.)*

- **M11a — the standing fixes** (ship-alone-able): a throwing publish hook must not kill
  the `@ice/dom` rAF loop (reschedule-before-step or wrapped step); snapshot iteration for
  the publish-hook loop AND `reflectors.flushAll()` (both iterate live arrays today —
  a self-removing hook silently skips its neighbor); devtools' dead `"reflect"` lane
  (reads a phase name that has never existed).
- **M11b — `engine.guests`**: `add({id, make, budgetMs?, phase?, ledger?}) → Disposable`
  with `make({world, signal}) → {run(frame), dispose?}`; a NAMED sub-step in the frame
  contract (`tick → guests → publish hooks → notify → reflect`) so derived state settles
  before presence I/O reads it; per-guest fault domain; deterministic add-order.
  `phase?` accepts the publish slot in 0.5.0; pipeline-group values are wired in M13a.
- **M11c — the circuit breaker, built once**: `performance.now()` bracket per guest (never
  engine-wide telemetry); ladder = >30 of the last 120 over budget · 3 consecutive ≥4× ·
  2 consecutive >50 ms (first invocation per generation warmup-exempt) · throw = max
  strike, 3 consecutive throws suspend · thenable return = dev-throw + prod strike; seam
  cap `min(budgetMs, 8)` with the worst offender suspended first; dev-leniency (devtools
  attached ⇒ timing strikes log, never suspend); **host-injectable ledger** (seed in,
  strike/suspension events out — engines are per-doc downstream, so an ICE-internal
  ledger would silently reset every doc switch).
- **M11d — observability**: `frame.settleWhile("guest-derive", …)`; per-guest devtools
  profiler lanes; `engine.guests.list()` (id, status, last/p95 ms, strikes, suspension).

**Design delta**: design-002 §1 gains the guest sub-step (amend the doc with the code).

**Exit (traced, not asserted)**: a throwing guest never kills the loop, its neighbors, or
the rAF loop — the rAF-death case is pinned as a regression trace · add/remove from
inside a `run()` skips nobody (same trace for reflectors) · each ladder rule fires on a
hostile fixture, warmup exemption and dev-leniency proven separately · an injected ledger
keeps a suspended guest suspended across engine dispose→recreate · a freeze taken
mid-guest-work settles through owed work and parks without walking `SETTLE_CAP` ·
devtools reports per-guest lanes and a non-undefined reflect lane · **every existing M3–M10
trace stays green** (the frame contract changed shape).

## Release cut & downstream

**0.5.0 = M11 + M12** (guest runtime, `tx.move`, the three standing fixes) — vibe-field
consumes immediately for the fixes alone; the door's W2b adapter can land against it.
**0.6.0 = M13** (SHIPPED as-built 2026-08-15) — vibe-field then re-cuts `contributes.behaviors` + `ctx.canvas.behaviors`
(spec §8.8/§12.7 → v0.4) and the mind-map pack builds on behaviors. Each ICE release: pin
assertions (one strata, one loro, **including `apps/*` declarations**), full `pnpm run ci`,
and the design amendments folded in the same commit as the code that earns them.

## Post-v1 risks

- **The frame contract changes shape in M11** — the M3–M10 trace suite is the guard; a red
  trace there outranks any new feature.
- **`coarse: false` is an engine-wide LAW, not a local option** (M13a): it attests that no
  raw `batch.col()` write touches behavior-read components. A future engine system that
  breaks it silently degrades every behavior's precision — needs the rule documented at the
  attestation site and, ideally, a lint.
- **The behavior compiler is the novel surface**; its SPLIT and access derivation are what
  the review broke twice. Traces before ergonomics.
- **Ephemeral is gated on M11** and on presence being attached — a presence-less engine
  leaves those behaviors dormant, honestly.
- **Two conflicting sources of truth for durable behavior schema** (manifest vs code)
  arrive with the field re-cut, not here — BF-D13 names build-time manifest generation as
  the anti-drift seam; decide it before third-party authoring, not after.

---

## Cross-cutting

- **Tests-as-traces**: every red-team frame trace and every design "Exit" metric lives in CI; a design amendment requires updating its trace.
- **Benchmarks**: churn budget, pan O(1), pick latency, reactivity tax — tracked per milestone against the M3 baseline.
- **Risks**: strata pre-1.0 drift (pinned; upgrade PRs re-run the full trace suite) · ~~global tag/rel version over-fire~~ (RESOLVED upstream in 0.3.0 — per-tag/relation observer precision; change-only writes remain stamp-volume hygiene) · access-declaration omissions (DEV throws early by design) · R3F version coupling in the router/islands (isolate in `r3f` package; the synthetic-event dispatcher is the only R3F-internal-adjacent code).
- **Definition of "engine v1 done"**: M10 exit + the scope fence of design-005 §9 intact (nothing snuck in). *(MET 2026-07-11. M11+ is post-v1 work — the scope fence still binds: the behavior framework is a new AUTHORING surface over existing mechanics, and it adds no layout engine, rich text, comments, or permissions.)*
