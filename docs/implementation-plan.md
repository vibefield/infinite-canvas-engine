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

## Cross-cutting

- **Tests-as-traces**: every red-team frame trace and every design "Exit" metric lives in CI; a design amendment requires updating its trace.
- **Benchmarks**: churn budget, pan O(1), pick latency, reactivity tax — tracked per milestone against the M3 baseline.
- **Risks**: strata pre-1.0 drift (pinned; upgrade PRs re-run the full trace suite) · ~~global tag/rel version over-fire~~ (RESOLVED upstream in 0.3.0 — per-tag/relation observer precision; change-only writes remain stamp-volume hygiene) · access-declaration omissions (DEV throws early by design) · R3F version coupling in the router/islands (isolate in `r3f` package; the synthetic-event dispatcher is the only R3F-internal-adjacent code).
- **Definition of "engine v1 done"**: M10 exit + the scope fence of design-005 §9 intact (nothing snuck in).
