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

> *design-015 D5b (2026-09-26):* graybox is deleted; the two-tab exit is `apps/desk`'s `rig:two-tab` (desk objects over BroadcastChannel, D5a).

## M6 — Widget runtime, DOM half (design-004 §1–2, §5)

- Real planes P0/P1/P3–P5; hosts + portals-from-one-root + keep-mounted LRU + frozen-hidden subscriptions; measurement path (RO disconnect-on-hide, `MeasuredSize`, effective size); drag-promote portal swap; chrome reflector (pooled nodes, marquee buffer); breakpoints; grid shader.
- `defineWidget` compiler v1: props DSL → group components; capability stamping; `useWidgetProps`/`useBreakpoint`/`useSelected`.
- Demo: card board app (DOM widgets), the v1 playground reborn.

**Exit**: naive widget handlers compose per the pinned contract (native opt-out, stopPropagation boundary, inert-during-drag); cull/re-enter preserves React state within budget.

> *design-015 D5b (2026-09-26):* the DOM widget runtime is deleted — cardboard's `exit-trace` and `cull-reenter` retired WITH their subject (§11.6); the cull stays (`packages/core/test/mount-gate.test.ts`), the mount store, the planes and the React faces do not.

## M7 — GL views (design-004 §3–4)

- Islands + FBO pool with retention decoupled from cull (+ specified fallbacks); neutral composite (`{opacity}`); two-level invalidation; `animated`/`useIslandFrame` contract; router GL path (synchronous point-pick, synthetic events, `surfaceHandled`).
- Demo: mixed DOM+GL board; interactive GL widget internals on touch.

**Exit**: first-tap-on-GL-widget trace green; zero render→ECS writes (asserted by a DEV hook); FBO budget honored under scripted zoom/cull storms.

> *design-015 D5b (2026-09-26):* GL islands are deleted — glboard's `gl-router` retired WITH its subject (§11.6); a 3D object is a desk kind with its own pass (the notebook).

## M8 — Node editor layer (designs 001 §5.3, 003 §5.8, 004 §6–7)

- Ports (on-demand materialization, budgets, light-up staging); wires (P0 pass, pick-below-widgets, connect gesture + preview continuity, endpoint cascade); containers (consume/fly-back full path); nested canvas (activeMembership, nav ops + index rebuild + nav integrity, `NavEntry` stack).

**Exit**: node-graph demo (spawn nodes, wire them, enter a container, delete an endpoint → wire cascades); zero port churn panning with the select tool (measured).

> *design-015 D5b (2026-09-26):* nodeboard is deleted; the cascade and port-churn exits are core tests (`m8-cascade`, `m8-port-churn`, D5a). The string between objects is not yet drawn on the desk (owed to the first kind with ports).

## M9 — Presence & collab polish (design-005 §6.5 + presence catalog)

- Presence publish (publish step), remote cursors + selection summaries, bootstrap kit (hello/snapshot/buffer, reconnect = re-bootstrap), ws-relay adapter, read-only attach mode, migration read-repair path with legacy-schema registration test.

**Exit**: two-machine collab demo over the dumb relay; version-skew test: older pack opens read-only, migrator upgrades via `{ undoable: false }` transactions (strata 0.3.0 — user history survives), both converge.

> *design-015 D5b (2026-09-26):* nodeboard/moodboard are deleted; the collab exit is `apps/desk`'s collab test and `rig:collab` over the ws relay (D5a).

## M10 — API polish, devtools, docs

- Ops catalog + keymap complete; devtools tabs (pointers/recognizers, planes, sovereignty, loop); `<InfiniteCanvas>` config surface + budgets; examples; README; API reference.

**Exit**: a third-party-shaped sample app builds against the published surface only (no deep imports).

> *design-015 D5b (2026-09-26):* moodboard is deleted; the exit is `apps/desk/test/exit-imports.test.ts`, whose THE SURFACE mirrors the umbrella's entries (`@ice/desk` · `/engine` · `/objects`, D5a/D5b).

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

## M12 — Animation-integrated writes (petition I15) · 0.5.0 half 2 — **DONE 2026-08-15**

*(As-built: `tx.move` + both chokepoints, each mutation-probed to red only its own trace;
`ops.arrange` collapsed to a pass-through over it — the recipe now lives in the primitive
it seeded. Two findings beyond the plan: `animateMs: 0` on an ALREADY-tweening entity had
to end the glide (write-then-remove, so the stale tween cannot fight the snap), and the
`tweenStart` memo now clears on destroy/reset rather than only on landing. design-001 §3
carries the erratum — the "accepted divergence window" was never a window.)*

- `GuardedTx.move(entity, to, {animateMs})` — capture `from` at call time, write the final
  inside THIS transaction (inheriting `undoable`), install `TransformTween` + liveWriter
  rewind after commit; already-tweening entities RETARGET (`toX/toY` rewrite), `Grab`-held
  are skipped; `animateMs` 0/absent = snap with no tween attached.
- **The two chokepoints** (the reason this is ICE-only): post-seal in `guardedTransaction`
  — any Position written on a tweening entity without a same-tx `move` retargets that
  tween; and facade `docs.undo()/redo()` — sweep live tweens onto the post-undo durable
  value (undo does not pass through `guardedTransaction`).
- `ops.arrange` reconciled onto retarget (drop the skip-if-tweening filter, keep the Grab
  skip); `tweenStart` memo reaped for entities that die mid-tween.
- Barrel: export `makeChurnGuard`; externalize arrange's write protocol as a documented
  contract (it is the recipe every future consumer copies).

**Exit**: **undo-mid-glide converges** — live lands on the undone Position,
`cellEquals(runtime, baseline)` holds, no stranded-cell DEV warning, and a subsequent
remote write applies (the permanent-divergence case is dead) · the remote-mid-glide
held-cell self-heal is pinned so it cannot regress · a second `arrange` mid-glide re-aims
instead of stranding · one undo entry when undoable, none under `undoable:false` · a
spawn/despawn-mid-tween soak shows no `tweenStart` growth.

## M13 — The behavior framework (design-009) · 0.6.0 — **DONE 2026-08-15**

*(As-built: 9 slices, 67 new traces, full CI green at 525 core tests / 488 modules
walls-clean. Six findings beyond the plan, each one a test catching a design or
implementation gap — listed after the slices.)*

Dependency order; each slice its own commit + traces. **a–d are the novel core** (kept
in-house per the delegation-by-criticality rule); e–i are well-specified once the core
lands.

- **M13a — define + validate + compile**: `defineBehavior` with the §4.1 validation set;
  schema → component through the meta registry (ensure-cached, namespaced); the **SPLIT
  rule** (delivery system carries `access.write` = own + ALL `writes:` targets *including
  durable ones*; a separate tick system carries own-component access only — a ticking
  system with broad declared writes would stamp them every frame); `reads:` PARTITIONED
  (components → access.read + collector; tags → collector only — the id-space trap);
  framework collectors created `coarse: false`; wrap-once-at-registration (copy
  name/access/runIf/query — strata memoizes access per system object).
- **M13b — deliver**: the runtime loop — drain-stash `runIf` (∧ `instances > 0`), the
  §4.3 delivery order, instance-list snapshot, appear/depart via `world.has` over the
  drained set, `data`-snapshot reuse by default, the `ctx.world` WRAPPER (not a
  `ReadonlyWorld` alias — that type keeps `.runtime`), reads-scoped `ctx.query`,
  `orderStamp`/`resourceStamp` polls armed at first registration.
- **M13c — durable class + the differ**: `ctx.commit` through the forwarding session seam
  + `requireWritable`; `tx.setResource` masked; the differ on `valueEquals` (strata
  0.12.0) with structural presence guards (`attach`-when-attached → value-diff,
  `detach`-when-absent dropped, `spawn` under `derived` DEV-throws) and **own-write
  subtraction** (one-frame quiescence, no echo recompute).
- **M13d — suppression**: claim-scoped, INSTANCE-scoped delivery suppression for `derived`
  behaviors; settle-reporter excludes suppressed derives; `deriveDuringGesture` opt-out;
  the dev-warn after N suppressed frames.
- **M13e — runtime class + attach surfaces**: `ctx.write`/`ctx.set` routed through the
  forwarding `liveWriter` (this is what makes the divergence law ARMED rather than
  aspirational); `engine.behaviors.attach/detach/has/read/list`; `defineWidget({behaviors})`
  pre-attach as post-spawn `addComponent` in the spawn tx; **the BF-D6 eligibility
  amendment** — one branch in `guards/guarded-tx.ts` `checkComponent` (guards are opt-OUT,
  so this runs in prod too) + the design-001 errata row.
- **M13f — ephemeral class** (needs M11): the local-peer SINGLETON facet, `ctx.peers()`,
  `ctx.keyOf`/`entityFor`, re-mint through `session.localPeer` on `world.reset` (microtask
  deferred — attach is illegal inside an observer emit).
- **M13g — migration**: `engine.behavior.<name>.<v>` markers, a SEPARATE gate compare with
  **absent-is-not-newer** (folding them into the pack compare would read-only a doc
  because a plugin is missing — the design-008 bricking shape), first-attach stamping,
  a re-entrant runner (plugins install mid-session), newer-data dormancy refusal.
- **M13h — surfaces + docs**: `useBehavior` in `@ice/react`; `createBehaviorHarness`
  (`attach/step/claim/pair`) shipped WITH the framework; the motion cookbook; the curated
  public-component list for `reads:`.
- **M13i — the consumer proof**: the mind-map layout as a `changed`-only derived behavior
  in ICE's own tests against a recorded fixture of the pure layout fn.

**Exit**: design-009 §14 in CI — compiler matrix · lifecycle tables · one-frame
quiescence · differ + structural guards · suppression (incl. instance scope and the
freeze interaction) · two-engine collab convergence with a definition-less peer keeping
cells dormant · the divergence DEV-throw firing through the armed liveWriter · per-entity
throw quarantine before behavior suspension · the anti-brick migration test (a doc with
markers for an uninstalled behavior opens WRITABLE) · mid-session install triggers the
runner · ephemeral singleton across two engines. **MET.**

### As-built deltas (the six findings)

1. **Own-write subtraction subtracts STATE, not entity ids.** The design's wording
   ("subtract the write-set from the NEXT drain") is wrong in the worst way: an id-only
   subtraction DROPS a real external write that lands on the same entity inside the
   window — permanently, since nothing journals it again. The memo snapshots the watched
   state (component values AND tag presence — a components-only version reopened the same
   hole for tag flips) and subtracts only on a full match. Five traces red if it reverts.
2. **`tx.move` IS diffed.** Rev 3 exempted it, reasoning that dropping a move could
   strand a glide easing toward a stale target. Petition I15's two chokepoints already
   make that impossible — every path that moves the durable value retargets live tweens —
   and the exemption was not a small conservatism: the flagship path commits its whole
   layout through `move`, so an undiffed move meant every peer that merely OPENED a
   laid-out document immediately wrote the same layout back to it.
3. **The SPLIT rule trips strata's same-phase writer-pair advisory.** Both compiled
   systems write the own component in one phase. They attest `orderIndependent` on that
   component ONLY (delivery-before-tick is framework-fixed and last-write-wins-safe);
   declared `writes:` targets are never attested, because claiming order-tolerance on the
   engine's behalf is not ours to do.
4. **Two collectors, not one.** "update is about you, changed is about the world" is not
   expressible with a single collector: the delta reports ENTITIES, not which component
   moved, so a merged collector fires `changed` on every own-data write — precisely the
   hook authors put whole-graph work in. The cost of honesty is one extra drain.
5. **Ephemeral re-mint has a dead-handle window.** `presence.localPeer` is re-minted a
   MICROTASK after `world.reset()` (attaching an ephemeral store is illegal inside an
   observer emit). A frame landing inside that window wrote through a dead handle and
   threw from strata's projector — charged by the breaker to a behavior that did nothing
   wrong. The facet path is alive-guarded and skips the frame.
6. **Durable-eligibility is a COMPILE-time refusal, not a definition-time one.** At
   module-eval time the prefab registry may not yet hold the widget whose Position a
   behavior writes, so the §3 static refusal would depend on import order — passing on the
   developer's machine and failing in the bundle.

Also landed with M13, because the framework needed them: `p.entityKey` (the only legal
cross-entity reference in durable data) and `defaultValueOf` as ONE function (three
call sites had their own `spec.kind` chains, each ending in a catch-all `else` that
silently accepted a new spec kind); `GuardedTxOpts.meta` — ICE's first consumption of
strata petition 9, stamping `{behavior, label}` provenance on every `ctx.commit`; and
`guests.addDriven`, the breaker detached from the scheduler, so behaviors running as
pipeline systems still share ONE ledger, one doctor row and one seam total with every
other guest.

## M14 — The behavior host contract (petition I16) · 0.7.0 — **DONE 2026-08-16**

The first real embedder (VibeField PRC-4) proved 0.6.0's framework runs but cannot be
GOVERNED by a host that activates plugin code once per window while creating one engine
per document. Four seams, all routing/composition, none a new scheduler — each pinned
red against the installed 0.6.0 artifact by the petition's probes before landing:

- **M14a — order + ledger at registration**: `behaviors.register(B, {orderKey?, ledger?})`;
  lexical keyed lane before unkeyed; one order for pipeline systems AND publish hooks;
  reorder reinstalls EXECUTION only (install/installExecution split — `init` never re-runs
  on unaffected behaviors, pinned); `ledger` seeds the driven guest so suspensions survive
  generations; empty key throws with no residue.
- **M14b — facade diagnostic routing**: `createCanvasEngine({onGuestFault?, onGuestNotice?,
  onBehaviorFault?, onBehaviorLog?})` forwarding the seams that already existed
  (`EngineOpts` + the behavior runtime's `onFault`/`onLog`), provenance preserved.
- **M14c — `describeBehavior`**: the canonical JSON-safe projection as the ONE
  definition-identity surface (manifest emission + anti-drift downstream).
- **M14d — thenable hook faults**: detection at every hook boundary, catch observer,
  attributed fault, direct guest strike (a thenable is a definition bug — unlike ordinary
  single-instance throws, which stay quarantined); `dispose` detected-but-swallowed.
- **M14e — ephemeral facet withdrawal (petition I17)**: an ephemeral facet is LIVE
  publication, so every producer-stops edge reverses it — unregister/disposal, guest
  suspension (`goCold`), and singleton quarantine (the edge with no ledger transition) —
  through the PRESENCE writer (tombstone truth for remote projections). Quarantine memo
  on the NODE, not the instance (the instance departs after withdrawal — an
  instance-keyed memo re-mints forever without ever striking the guest); resume remints
  only value-suspended facets, quarantined ones wait for a fresh registration.

**Exit**: I16's six controls green as ICE tests + three host-side pins (keyed/unkeyed
lane, empty-key refusal leaves no residue, async-dispose teardown completes) — 9/9 in
`behavior-host-contract.test.ts`, re-derived from PRC-4's proven candidate patch rather
than blind-applied; I17's acceptance as 5 tests in `behavior-ephemeral.test.ts`
(synchronous unregister withdrawal through the presence writer, suspension+quarantine
withdrawal, the no-resume-remint oscillation pin, ledger-seeded suspended-at-birth,
presence-less no-op) · full core suite + walls green. **MET.** Remaining from the same
PRC-4 evidence round, deliberately NOT here: I18 (split presence attach, P2 — a public
facade surface with a real document-bootstrap design question) — deferred to M15.

## M15 — Facade presence attach (petition I18) · 0.8.0 — **DONE 2026-08-16**

The last of the PRC-4 evidence round. A host that owns its document lifecycle
(VibeField: fieldd checkpoints/journals + its own transport) never calls `docs.join()`,
and presence entered ONLY through `join({presence})` — a standalone
`attachPresence(world, …)` session is real but invisible to the facade seam, so
`docs.presence()` stays undefined and registered ephemeral behaviors stay dormant
(PRC4-E13, 7/7 controls). The bootstrap design question resolved to: presence lifetime
⊆ document lifetime, ONE internal acquisition/teardown pair shared by both doors.

- **M15a — `docs.attachPresence(opts): () => void`**: session gate (refuses doc-less),
  duplicate gate, existing `attachPresence(world, opts)` + `installPresence` under the
  hood, seam assignment activates the behavior runtime's per-publish forwarding;
  idempotent IDENTITY-BOUND inverse (a stale inverse cannot detach a replacement);
  `close()`/dispose run the same teardown; leave tombstones flush through
  still-subscribed outbound before wiring dies. `join({presence})` rides the same
  acquisition, framing unchanged.
- **M15b — derived-residue reap**: `installPresence`'s uninstall reaps the remote-cursor
  pool — detaching on a STILL-OPEN document must not strand ghost cursors (the join
  path never saw it; `close()`'s world reset hid the strand).
- **M15c — advisory-clean phase**: the remote-cursor system registers in `present`
  (presentation derivation, no in-tick consumers; reflectors read post-notify same
  frame) — late-installed into `derive` it tripped both strata access advisory classes
  against `cull`/`selectionChrome` on every presence-attached facade engine.

**Exit**: the petition's acceptance list as 8 tests in `facade-presence.test.ts`
(gates + no-residue refusal, create/open attach, dormancy→activation with init-once,
identity-bound idempotent inverse, outbound-live leave on inverse AND `close()`,
dispose teardown with quiet stale inverse, reattach-remints-defaults, ghost-cursor
reap on a still-open doc) · zero access advisories from the PRESENCE systems (the
review measured the full core suite: nothing names `remoteCursors` or phase
`present`; the behavior suites' deliberate derive-phase `Position` co-writers still
trip the same two advisory shapes — see the open item below) · full core suite +
walls green · **plus the pre-publish adversarial review
round** (the M14 protocol): four execution-confirmed lifecycle findings fixed —
throwing-transport teardown aborts, the same-gap swap's init/dispose inversion +
corpse-write, the rejected-join presence strand, the burnable inverse — each
mutation-probed, +4 pinning tests; and the artifact-types defect (unresolvable
`@ice/*` specifiers in the shipped d.ts of every release since 0.2.0) fixed with a
build-step rewrite + guard, mirrored upstream by strata 0.13.0's own d.ts fixes.
**MET.**

**Open item recorded by the review (post-0.8.0, not a release gate):** any system
late-registered into `derive` that writes `Position` trips strata's two access
advisories against the stack's `selectionChrome` (co-writer) and `cull`
(earlier reader) — and DURABLE behaviors are derive-only by design (types.ts), so
unlike the presence system they cannot move phases, and advisory (b) has no
attestation opt-out at all. A VibeField plugin author shipping a durable
`writes: [Position]` behavior sees two dev advisories naming their behavior against
engine internals on every boot. The advisory is partly HONEST (a derive-phase
Position write after `cull`'s read genuinely means one-frame-stale culling for
those rows), so the fix is an ordering/attestation design question — behavior
deliver placement relative to the stack's derive systems, `selectionChrome`
attestation, possibly a read-side attestation petition to strata — that deserves
its own round, likely as design-009 errata + a strata petition candidate.

## M16 — The ephemeral facet byte claim (petition I19) · 0.9.0 — **DONE 2026-08-17**

The first RESOURCE claim on the declaration surface. VibeField's document-room
presence lane fragments ICE frames over lossy 1,150-byte datagrams; PRC4-E22
proved the admission gap on the released 0.8.1 pair (a legal 4 KiB-string
behavior refutes one-datagram delivery; sixteen at the per-plugin cap emit a
66 KB frame against a 64 KB logical cap; `ctx.write` can exceed anything the
manifest promised, after admission; an oversize aggregate frame is
unattributable and dropping it stales every OTHER facet). The behavior
declaration — which already routes store, vocabulary, cadence, breaker —
now carries the producer's own byte claim.

- **M16a — `maxFacetBytes` on `defineBehavior`** (ephemeral-only, optional,
  positive integer): canonical UTF-8 JSON bytes of the COMPLETE facet cell
  after defaults/merge/serialization (schema declaration order IS cell
  construction order — plain `JSON.stringify` is canonical by construction).
  Identity-bearing: definition signature (claim-only change = DIFFERENT shape)
  + `describeBehavior()` (absent = no bound attested; hosts can refuse).
- **M16b — production enforcement at both mint paths**: over-budget DEFAULT
  fails `defineBehavior` itself, unconditionally (the ONE validation outside
  the dev-guard gate; no residue — `ensureFacet` needs no re-measure); an
  over-budget `ctx.write` throws BEFORE mutation, prior facet intact — in-hook
  it feeds the existing ladder (attribution, BF-D18 three strikes, I17
  withdrawal on quarantine), the captured-closure path gets the refusal at the
  caller. Cost: one stringify per write, ONLY for claiming behaviors.
- **M16c — store-routing audit**: `engine.behaviors.attach`/`detach` and
  `tx.attach`/`tx.detach` accepted ephemeral behaviors and world-wrote the
  facet component (a local `ctx.peers()` remote-facet spoof — never published,
  never withdrawn; a bypass of the claim's two real mint paths). All four
  refuse now.

**Exit**: the petition's acceptance list as 14 tests in
`behavior-facet-budget.test.ts` (round-trip + unattested-absent, ensure-cache
identity, ephemeral-only + shape validation, at-bound default publishes /
one-over fails with no residue / in PRODUCTION with guards off, UTF-8-not-UTF-16,
at-bound write publishes / one-over refused-attributed-intact, merged-cell
measure, json-as-serialized, three strikes → quarantine + I17 withdrawal +
no-remint, captured-closure refusal without ladder involvement, both audit
refusal surfaces) · every enforcement point mutation-probed (six probes, each
bit) · full core suite 589 green, `pnpm run ci` walls-clean · design-009 §17
amendment + I19 registry row folded with the code. **MET.**

## M17 — The magnet grid (design-010) — **DONE 2026-08-25**

The dot grid's PIXELS replaced by a field-reactive lattice — its interfaces
untouched. Ported from vibe-field `draft/magnet-grid` (WGSL → TSL) with the
upgrades the experiment lacked: rbush broad-phase, N injected poles, config
valves. The original 0.10.0 build kept classic and magnet as runtime sibling
modes; the 0.11.0 amendment below replaces that facade with build-time
implementation wiring while preserving the same parent-facing seam.

- **M17a — config vocabulary**: `GridConfig.magnet?: Partial<GridMagnetConfig>`
  + `DEFAULT_GRID_MAGNET_CONFIG`; `configure` deep-merges the `magnet` key one
  level. `DEFAULT_GRID_CONFIG` deliberately does NOT carry the block — absence
  is the off state (an explicit `{enabled:false}` rode widgetlab's
  `{...DEFAULT_GRID_CONFIG}` state through the mount-time `configureGrid` and
  clobbered the factory enable; found on the build's FIRST screenshot).
- **M17b — pure collect** (`magnet-collect.ts`, core+kernel only, 16 tests):
  lattice windows + fade/weight CPU-baked per level, 220k instance guard,
  `magnetFieldScale` zoom valve (scale 0 skips the spatial query), source
  packing with poles-first `maxSources` prioritization (largest screen area,
  then viewport-center distance), the 5·reach·√strength halo query, and the
  §5.4 coincidence skip (integer spacing ratios only).
- **M17c — the TSL renderer** (`grid-magnet.ts`): three instanced-quad meshes,
  sites from `instanceIndex` (no position buffer), ONE read-only storage
  buffer (`setPBO(true)` — the same node graph compiles on the WebGL2
  fallback, verified headless), poles as DEGENERATE rounded boxes (half=0,
  r=0 ≡ the point-charge formula), needle/dot glyphs per the draft with dot
  rest radius from `dotRadius[0]`. Classic extracted VERBATIM to
  `grid-classic.ts`; the magnet material builds lazily on first enable.
- **M17d — the seams**: `GroundContext.readSpatial` (facade wires
  `stack.index.search` — the ONE spatial index, O(delta)-maintained;
  `SpatialVersion` observer wakes re-collects) and `GroundOptions.poles`
  (`PoleSource` protocol — `Pole{x,y,strength,space:"world"|"screen"}`; the
  pass knows NO cursor vocabulary). Helpers `localPointerPoles` /
  `cursorVisualPoles`; widgetlab ships the REFERENCE app adapter
  (`cursor/halo-poles.ts`: morph scale → strength, `easeSettle` quiets wakes)
  behind `?magnet` / `?magnet=dot` — the default demo byte-identical.
- **M17e — build-time implementation selection (0.11.0)**: runtime sibling
  mode ownership is removed. `grid-contract.ts` owns the shared
  `GridPassFactory`/config/dependency contract; `grid-classic-pass.ts` and
  `grid-magnet-pass.ts` are complete interchangeable implementations; the
  tiny `grid.ts` wiring re-exports only magnet. `GridMagnetConfig.enabled` and
  the WidgetLab enable toggle are gone. The production `@vibecook/ice` graph
  contains magnet only (classic is absent from JS, source maps and emitted
  declarations); changing one re-export wires classic back with no parent
  changes. Dot/needle remains a uniform within the magnet renderer.

**Exit**: 16 collector tests green (pole degeneracy, halo query, prioritization,
fadeZoom, coincidence skip, MeasuredSize-over-Size) · full `pnpm run ci`
walls-clean (513 modules) · headless verification on BOTH backends: needle
starburst around the halo pole, needles wrapping card silhouettes, dot glyph,
WebGL2-PBO path error-free, classic default visually unchanged with magnet off
· perf A-B MEASURED 2026-08-25 (design-010 §6.4): settled-idle redraws **0**
classic AND magnet at +0/+50/+128 widgets — but only after the redraw counter
exposed the halo systems' ungated blanket stamps (`access.write [Cur]` +
run-every-tick = observer fire every tick, the `version-stamps.ts:7-9` guard
rule violated) — fixed with per-system `makeVersionGuard(PointerVersion)`
`runIf` + a settle-tail latch (`cursor/systems.ts`; **vibe-field's identical
halo systems need the same fix in their port**); sweep = one redraw per moved
frame as estimated; +128-source sweep ~+30% frame mean (the valves' corner),
no cliff · design-010 amendments folded (§10 now records eight corrections).
**MET** — with one honest rider: headless cannot time the GPU, so an
on-device A-B is still owed before a RELEASE advertises the mode, and the
§10.8 hover-flap (pointer parked ON a card redraws at tick rate — pre-existing
widgetlab hover behavior, now visible) is a named widgetlab follow-up.

## M18 — The unified compositor (design-012) — **DONE 2026-08-31**

*(Numbering note: design-011's canvas-types work landed on main without a
milestone entry here; M18 is taken as the next free number, not as a claim that
design-012 followed design-010.)*

Presentation collapses from six planes to two layers plus a thin overlay. ONE
WebGPU canvas on ONE app-owned `GPUDevice` draws the ground programs, every
GPU-presented widget surface, and live video in a single render pass, in
frame-parent sibling order,
with lift and fade as per-quad GPU facts — while a never-painted
`<canvas layoutsubtree>` holds the widget hosts and stays the hit-testing,
focus, caret and accessibility truth. This reopened design-004 §1's locked
"DOM/GL z-interleaving is a NON-GOAL", which was locked because interleaving
was *impossible*; Chromium's HTML-in-Canvas made it possible, and two measured
spikes made it credible before a line was written.

**It is a PRESENTATION PROFILE, not a replacement.** Both profiles implement
one contract: the **composited** profile needs Chromium + `CanvasDrawElement` +
WebGPU, and the **stratified** profile (design-004, unchanged) is the answer
everywhere else. An app selects one by importing that profile and passing it to
`<InfiniteCanvas profile>`, bound once at mount — so the unimported profile
tree-shakes out of the bundle and changing the choice is a rebuild, not a
re-render. The EFFECT is design-010's build-time selection; the MECHANISM is a
recorded deviation from its one-line re-export wiring, taken because two apps
in this repo need two answers. There is no runtime toggle: one profile ships
per packaged app, a capability-probe failure is a loud boot-time refusal rather
than a silent swap, and the profiles never import each other — which
dependency-cruiser enforces.

- **S0 — flag rails, adapter, refusal** (`37b532a`): every HiC symbol confined
  to `ground/src/hic-adapter.ts`; the capability probe wired into preflight; a
  boot that refuses out loud with the flag off. BOTH switch halves are
  load-bearing (command-line `--enable-features`/`--enable-blink-features`
  before `whenReady` AND `enableBlinkFeatures` on the window) — either alone
  reads as "flag set" while the renderer stays dark.
- **The atlas-slot allocator** (`c7624e2` kernel shelf packing, `78e7e4f` the
  paged allocator): pages that grow within device limits, 1–2 px gutters,
  per-slot dirty, slot-mapped LRU, and a waste instrument. Retention has TWO
  doors — `reclaimSlots` returns address space, `reclaimPages` returns memory,
  since pixels commit per PAGE on first write — so any HUD memory number must
  come from the page door.
- **S1 — the device and the skeleton** (`2484072`): the app-owned device
  (`compositorDevice`, renamed off `gpu` because design-011 landed
  `GpuAllocationLedger` there first), three adopting it by injection, the
  compositor reflector and its dirty union, idle-zero instrumented AT
  `queue.submit` so three cannot hide work.
- **GATE ZERO** (`830c242`): the direct `copyElementImageToTexture` proven on
  the PINNED Electron 43.1.1 / Chromium 150 before anything CONSUMED it — and
  it caught S0's adapter already encoding an arity-3 call Chromium REJECTS,
  which had shipped unexercised precisely because S1 deliberately had no
  consumer. An unexercised seam is an unverified seam.
- **S2 — dom surfaces composite** (`6c33804`): L1 hosts, the atlas bound to the
  device, the quad pass's WGSL with analytic rounded-rect AA validated against
  MATHEMATICS (covered area `w·h − (4−π)r²` vs summed composited alpha: 637,450
  measured against 637,452 expected).
- **S3 — camera, write-backs, native input** (`51b065b`): absolute placements
  (the transform REPLACES layout), parking as the default, and every hic-bench
  §3/§5 row as a standing regression — stale hit regions, mid-gesture accuracy,
  and a 600-frame pan that uploads zero bytes.
- **S4 — dirty uploads and demand** (`31b4dd8`): `changedElements`-driven
  per-slot uploads, demand buckets, boot staggering, and a full-board path
  proven absent both behaviourally and by grep.
- **S5 — islands on the shared device** (`6f3a0f8`): r3f renders islands into
  targets on the app-owned device and publishes `gl` sources through core's
  registry, importing no `ground`.
- **The gl leg + the live-React witness** (`2f036fd`): design-012's premise
  executed for the first time — in a real React app, a DOM card at a later
  sibling ordinal COVERS a GL island inside the one pass.
- **S6 — one lift, true z, the tax gone** (`87df06e`): `kernel/lift.ts` holds
  ONE curve read by both profiles so they cannot drift by retyping; the Q5
  presentation policy; zoom bands for dom sources on the islands' kernel
  ladder.
- **S6b — one present** (`8875682`): ground renders its unchanged GroundHost
  and TSL programs into an offscreen target and the compositor draws it as its
  FIRST quad. The `offscreen` flag reaches exactly ONE place — everything above
  ground's renderer runs byte-for-byte as in the stratified profile.
- **S7 — the video kind** (`e3d01d3`): `importExternalTexture` from a retained
  latest, imported INSIDE the reflector's synchronous flush so it never crosses
  an await. A surface is STATE, not an event.
- **S8 — extraction, the owed wiring, docs** (`f37d964` · `1bce632` ·
  `07ed341` · `c11fe2d` · `d9810d7`; SHAs added at land time — the entry was
  written pre-rebase): the Widget Surface contract
  finalised in `core/src/surface/` and answered by both profiles;
  `defineWidget({ presentation: { default?, pin? } })` honoured by the policy
  and by host placement; external-frame arrival made a real dirty source; and
  the naming pass, which answered the two questions parked for it — the
  `ground`↔compositor package rename (NO: this package ships both profiles, and
  `@ice/compositor` would misname it for every stratified app) and the two
  copies of three's backend-texture read (CONVERGED: r3f keeps the island
  vocabulary and delegates the read to core).

**Exit**: a composited text-free 12-card board is **0 of 4,136,960 px**
different from the stratified render of the same board (control 0), and WITH
text **4,682 px / 0.1132 %, maxDelta 6** — design-012 §5's fidelity seam is a
NUMBER, and the two passes are split so a geometry error cannot hide inside an
expected text difference · ONE PRESENT, proven as a count (only the compositor
acquires the target; ground's canvas never presents), at 20,992/20,992 ink px
and maxDelta 2/255 — honestly not bit-identity, since the extra hop is a
decode/encode round trip exact on opaque pixels and ±1–2 levels on AA edges ·
the blit costs **0.1860 ms** over a null-submit control for a 16.5 MB target,
≈2 % of a 120 Hz frame · a dragged DOM card passes UNDER a GL widget at true z
across 9 overlap frames with **0 z-pops**, with a guard pair proving on 5 of 5
frames that the card IS composited where its ordinal puts it ON TOP — the
reciprocal check, without which the rig's first version passed the z-test with
an invisible card · the fixture live surface composites on **24 of 24** painted
frames while productions are outrun 3:1, null control 0/8 · a PRODUCING surface
wakes the compositor by itself — **46 submits for 46 productions across 181
frames**, paused arm 0/181 · IDLE-ZERO HELD AT EVERY RUNG THAT MEASURED IT,
instrumented at `queue.submit` so three cannot hide work — 0 submits across 481
frames at S1, S2 and S6b, 301 frames at S7, and 181 in S8's paused arm · demand
monotonic (unthrottled 47.9 uploads/s → 26.0 at 30 fps → 9.6 at 10 → 2.0 at 2)
with the paint-event column deliberately UNMOVED, because demand throttles
uploads and not paints · orientation MEASURED both ways at every
kind: an island target and an `importExternalTexture` frame both arrive the
compositor's way up, so **no flip is applied for either** — against the
video-is-y-up folklore, and against an inherited instruction that was a
reader-normalisation result mis-relayed as a pipeline one. **MET** — with the
riders below.

**Standing gaps, named rather than closed:**

- **The live-dom↔composited fidelity seam is ACCEPTED, not eliminated.** The
  Q5 default rests cards in `live-dom` and promotes them in motion, so at rest
  a live-dom card paints above ALL GPU-composited content — one stratification
  artifact survives in the rest state, and it replaces a drag-time z-pop that
  no longer exists. The 0.1132 % is the size of the seam it trades against.
- **The §7 deletions are PROFILE-DEAD CODE, not physical removals** (ruled
  during S6). A composited host never enters P3, GLViews' own pass retired at
  S5, and the CSS lift spring paints only in live-dom mode — but the stratified
  profile still needs every one of them, and while one package set ships both
  profiles, keeping them dead may simply stay tree-shaking's job.
- **HiC is an origin trial (M148–M154), not Baseline**, and tokens cannot be
  redeemed by `file://` or custom-scheme apps, so the flag is the only path for
  a packaged app. The composited profile is therefore Chromium/Electron-first
  BY CONSTRUCTION. Pin posture: every Electron bump re-runs the probe, and if
  HiC dies the composited profile dies with a build-time error rather than a
  runtime surprise — the surface contract, the shared device and the live
  surface leg all survive it, because only the `dom` kind's texture source
  depends on HiC.
- **Q4's EMPTY L1 host for gl/video kinds: the RULING STANDS RATIFIED, the
  IMPLEMENTATION IS DEFERRED.** Not a reversal and not a reopening — every
  widget still gets an L1 host in the design, and it becomes its own slice when
  island hit-testing is worth touching. As built today a gl widget's host is
  its DOM chrome in the content plane under the island, in both profiles, so
  card-level hit-testing for gl widgets does not yet run through an L1 host.
  S8 found the sharp edge on the way past: island sources are keyed by ENTITY,
  so promoting a grabbed GL widget would have registered its chrome as a `dom`
  source over the island's own `gl` one. The policy now refuses kinds that have
  no live-dom mode, which is the design's own line (plan §2) rather than a
  special case.
- **Two memory questions are open, and neither is guessed at.** Nobody has
  vmmap'd an undrawn-into `layoutsubtree` backing store (a full-viewport dpr-2
  canvas DECLARES ~21 MB and is never drawn into), and the allocator's
  growth-doubling overshoot is address space whose commitment is unproven,
  since the bench measured never-written textures.
- **Two platform findings whose mechanism was deliberately not guessed**: a
  fresh `WebGPURenderer`'s FIRST island paint differs from every later one, and
  synchronous extra paints do NOT converge it — ONE repaint on a later
  event-loop turn converges it permanently, so a pixel witness must repaint
  once before grading. And the compatibility-mode MSAA gotcha remains untested
  on a host that actually engages compatibility mode.

**FIX WAVE (2026-08-31, same day as close).** A high-effort review of the whole
unpushed range (design-011 + the S0–S8 ladder) confirmed 15 correctness defects;
all 15 landed as 16 commits, `12730e4..428c457`, every fix with a
mutation-checked regression test, full gate green on the merged tree (1,450
tests). Notable for the record, beyond the fixes themselves:

- **The ladder's two falsified exit claims are corrected at source.** "Idle-zero
  holds at every slice" had a hole the rigs never exercised: one HiC paint on a
  paused/bucket-0 card parked dirt inside `pending()` and span the compositor
  every rAF frame (`76d82b3` — parked dirt now waits OUTSIDE pending, on
  demand, not a clock). And `program-host.ts`'s factory-parity promise was
  false: `groundHost` — the factory widgetlab-desktop SHIPPED at the time —
  built a quad pass with none of the four seams and no binder, so its composited
  path drew NOTHING; every rig passed because rigs hand-wired the binder. The
  wiring was extracted (`compositor/wiring.ts`) so both factories called one
  assembly and could not drift (`5a7e328`), and the witness went through the
  factory. *(Errata, design-013 C3, 2026-09-07: past tense throughout now.
  `groundHost`, `program-host.ts` and `compositor/wiring.ts` are all deleted —
  B8 took the old composited leg, C2 took the stratified one. The finding is
  kept for the CLASS it names: a factory whose product no rig exercises without
  hand-wiring around it.)*
- **Two review findings were themselves corrected by the fix discipline.** The
  extension-host rollback strands outputs only in the VALUE-restore shape (a
  component REMOVAL journals the entity back into the collector and
  self-recovers — measured with a probe; the first regression test used the
  wrong shape and passed pre-fix). And the despawn presentation leak is
  sharper than a growing map: a recycled entity id INHERITED the dead widget's
  `composited` and mounted as a canvas child that policy would never demote.
- **One adjudication REFUTED as ratified behavior**: composited-outranks-lifted
  is design-012 §7's retirement of inert-during-drag ("drag is a per-quad GPU
  fact at true z"), not a defect — the misleading unconditional header comment
  now names the contract stratified-only.
- **The pin-blind resize** (`428c457`): both island pools disposed a PINNED
  target on size change while a retained crossfade clone still sampled it —
  reachable during the crossfade hold (~160 ms) AFTER `NavTransition.active`
  flips false. A pinned target is now RETIRED, not disposed — the reviewer's
  shorter hand-back fix was weighed and REFUSED on tree evidence: the caller
  stamps the size it ASKED for into `paintedAt`, so a handed-back old-size
  target goes on record as correctly banded and a Dormant island strands at
  the wrong resolution; and the caller renders into whatever comes back,
  which is the frozen clone's own texture. The pool tests refuse that design
  by assertion (mutation-checked against it applied verbatim). `release()`
  drains the graveyard; retired bytes stay counted because they are still
  allocated — named rider: during the hold the eviction budget sees bytes it
  cannot reclaim and may evict a Dormant island early. Honest accounting was
  chosen over hiding live GPU memory; flip it only if that early eviction
  ever bites.
- **Open, named rather than closed**: (a) the size-agreement question is now
  **CONFIRMED by a real-GPU rig** (2026-08-31, `af23b71`/`6e7694c`; that rig
  retired at B8 — `TMPDIR=/tmp pnpm run render` in widgetlab-desktop is where
  the same drift is measured now, and it reads 0): an L1 host
  rasterises at CSS box × the SOURCE CANVAS's backing-store scale (measured
  flat 2.000× at dpr 2 across zooms, 1.000× against a 1× bitmap — the bitmap
  governs, not devicePixelRatio), so a card whose live zoom drifts above its
  band (`isOutOfBand` tolerates up to 2.0×) writes past its slot SILENTLY —
  at 1.9× drift: 40,272 escaped px, 13,632 into the neighbour, 516 into the
  gutter, control 0/0/0; two witnesses agree to the pixel (probe-raster bbox
  = escaped bbox, 304×183) and the arithmetic closes exactly. Refused=0 —
  no validation error, it corrupts in silence, but ONLY while the oversized
  raster still fits the page: a copy leaving the destination TEXTURE is
  refused outright with 0 px written, which means the fix wave's clampToPage
  path degrades to a BLANK card — a separable liveness bug. Reachability:
  a card is safe at promotion (band ≥ zoom); the drift shape needs zoom to
  RISE while composited — grab-then-zoom-in under the Q5 default, or just
  "zoom in, then type" under a composited pin/restingMode. THE FIX IS A
  RULING, deliberately not taken by the rig: (a) re-band upward at ratio>1
  (restores slot ≥ raster always; ~2–4× atlas bytes — measure on a real
  board first); (b) refuse the copy while oversized (zero memory, but a
  parked drifted card goes content-stale — needs a third hold state);
  (c) size hosts in BAND space, zoom in the placement matrix (free by the
  transform-scale measurement — a host's own transform scale is NOT baked
  into the raster — but @ice/dom would need the binder's held band, a
  cross-package seam the walls forbid); (d) scratch-texture copy +
  downscale blit (policy-free, correct, but a slice). Rig recommendation:
  (a) with the bytes measured, (d) if they bite. Errata landed at source in
  binder/atlas/adapter/source-canvas/writeback headers. (b) the quad pass
  sweeps stale bind groups on a 60-composite retention window because
  nothing lifecycles its textures — an event-driven eviction seam is a
  design call, not a slice.

## M19 — Surface geometry + the ground port (design-013) — **LANDED (Phase A 2026-09-06 · Phase B 2026-09-07, reviewed, B9 the review fixes · Phase C 2026-09-07, C0–C3 · the 0.13.0 cut 2026-09-07, publish pending · C4 the Phase C review fixes 2026-09-08)**

*(Numbering note: next free after M18. design-013 rev 5 was ratified 2026-09-06 with
all eleven questions ruled at their leans; rev 6 folded the ground's heat and live
portals; the Phase A grading decisions D1–D10 are rev 7. The task-grade plan is
`draft/design-013-implementation-plan.md` — local-dev only, like every design doc.)*

Presentation FACTS move into the world as runtime, derived components with exactly one
writer each (design-013 §3 amends design-002 §5 / design-004 §7, bounded by design-001
§7's older law: discrete facts change-only on events; continuous state stays in side
tables). Infra provides mechanisms — the DOM layer, the GPU layer, residency, band, the
demand clamp — and never decides when a card is on which layer; KINDS choose, through the
behaviours door, and the engine ships three standard choices (`ice:surface.domAtRest`,
`alwaysGpu`, `alwaysDom`) as defaults, not laws. The compose step is `draft/ground`'s card
frame pass with a content term — chrome ⊕ content in one fragment — which enters ICE
exactly once, into its final home (Phase B), beside the old composited leg until the new
profile passed the pixel exits — and the old leg was deleted in one commit (B8, 2026-09-07),
which is also where the new profile took the name `composited`.

**The ladder:** A (facts + residency in the world; no renderer touched) → B (the new
composited profile on the raw ground: B1 the move [GROUND PORT] · B2 the profile switch ·
B3 compose · B4 DomRender · B5 IslandRender · B6 VideoIngest · B7 the flight [GROUND
PORT] · B8 the deletion) → C (three leaves the ground: wires/guides/soup/line-grid raw ·
stratified ground · the cut).

**Phase A slices** (each: mutation-probed tests, comments corrected at source, the gate
verbatim, the churn bench before/after):

- **A1a — the vocabulary** (**LANDED 2026-09-06**, `1a34239` + `74a31fa` the grading fix;
  as-built: the TS types `SurfaceDemand`/`SurfaceKind` became `SurfaceDemandValue`/
  `SurfaceKindValue` because a type-only re-export SHADOWS a star-exported value of the same
  name at `core/index.ts` — silent; `geometry()` throws on band 0 (kernel has no dev switch);
  `placement` is CSS px — the plan's device-px fixture was the slip, corrected at grading;
  the Band guard collects `SurfaceTarget` + the Visible/Culled flips, not `Size`. **D2's
  price, measured** (interleaved A/B, 3 pairs, no overlap): the flat-100k membership arm
  +9.2 % zoom / +8.8 % pan — six more components widen the archetype so cull's and
  breakpoint's O(N) walks touch more chunks, ~42 ns per widget per zoom frame; the nested
  arms and the behaviour churn bench are unchanged. Accepted; the lever if a real board
  ever shows it is a lazy attach of the four gpu-only components at first promotion.
  Nothing reads the facts yet.): `SurfaceKind · SurfaceTarget · RequestedDemand ·
  SurfaceDemand · SurfaceBand · TextureRef · Retained` stamped at equip with safe
  defaults (`TextureRef.texture = 0` = no destination); `DragBounds` on the Drag
  recognizer, written change-only by `dropSystem` (the heat's fact); the `present:infra`
  pipeline group (design-002 §2 amendment: behaviour systems register at
  behaviour-registration time, so infra that must run after every kind behaviour needs
  its own settle point); `geometry()` in kernel (raster = CSS box × dpr, ceil; `band`
  sizes the host in band space, `crisp` at the live zoom); the Band and Demand systems
  (the binder's hysteresis rule with ONE writer; `foldDemand` as the clamp);
  `installSurfaceInfra` + `PresentationProfile.install` (a profile IS the system-set it
  installs — Q6's first use).
- **A1b — the door and the deletions** (**LANDED 2026-09-06**, `a8358fb`; as-built: the
  gl-eviction guard survives as `canvasEligible()` in `domWidgets` — equip stamps every gl
  widget `gpu`, so a promote read of the target alone would move every island's chrome host
  under L1 and register a `dom` source over the island's own; `defineWidget` suppresses the
  default for any listed behaviour that writes `SurfaceTarget`, not only `ice:surface.*`;
  `compileBehavior` attests `orderIndependent` on the `ice:surface.*` writes only (strata's
  same-phase advisory printed 213 lines per CI run otherwise — OPEN: a pack's own kind
  behaviour still trips it; the honest fix is an author-facing attestation in design-009);
  `domAtRest`'s side tables are a WeakMap keyed by the generation's signal. Three findings:
  the `FrameInfo` poll makes the delivery WALK O(instances) — 18 µs/frame idle at 10k
  widgets, 165 µs at 100k (D6's "O(grabbed + settling)" is true of the hook body only;
  corrected at source); `alwaysGpu.with({paused:true})` yields `{paused, 60}` — the mode
  governs, nothing uploads; and the S6 drag witness had never witnessed a promotion (the rig
  forced the old registry's value at mount, so the policy never took ownership) — it does
  now. OWED: a live witness for the D7 closure in the REAL React app (the convergence smoke
  has no drag; `composited-app` hand-wires the engine).): the three `ice:surface.*` behaviours
  (settle via the `changed` hook polling `FrameInfo`, expiring on `clock`);
  `defineWidget.presentation` retired onto them (migration table in the CHANGELOG); the
  dom `PresentationRegistry` + policy DELETED; `domWidgets` reads `SurfaceTarget`; the old
  binder's demand callback reads `SurfaceDemand`; rigs rewired. **Finding recorded at
  grading (D7):** the shipping React composited profile had NO promotion —
  `infinite-canvas.tsx` built `domWidgets` without a registry and nothing created the
  policy; only the rigs wired it. A1b closes it by construction (facade-registered
  behaviours; the DOM layer reads the world).
- **A2 — residency** (**LANDED 2026-09-06**, `865f361` · `260762c` · `87c1686` + two landing
  commits; as-built: layer ids are DENSE array indices with lowest-free reuse (the first
  build's monotonic ids were reversed at grading — `TextureRef.layer` is what the shader
  samples, and the stale-index hazard is closed by the system writing `texture = 0` on every
  key it frees); four build corrections — cull must NOT free (`Visible ∨ Retained` gates
  allocation only; the budget, a target flip or death frees — a spec slip in the plan,
  fixed there), death released the reference the `TextureRef` itself held via a side table,
  a refused re-slot no longer leaks a slot, heat has ONE writer (the touch pass; `place()`
  had silently shadowed it); `allocator.layerSize` on the interface; `maxLayers` derived
  from the budget; the guard subscribes to `Camera.zoom` only when a kind rasters `crisp`.
  66 cases: the §6.4 invariant as a 220-op seeded walk checked against the allocator and
  the table with the uv re-derived from the rect; a `ChangeCollector` counts WRITES; the
  12-card rehearsal frame by frame. 51 probes, 13 of them deletions verified at blob
  level. Packing waste 2.24 % on one full layer, 4.16 % on the 100-card board (the paged
  allocator's bound was 12 %). The build left `installSurfaceInfra`'s residency option
  unset in the profile and the rig; wired at landing so the system runs under live
  frames. Nothing reads `TextureRef` until B3.): `core/residency/` — fixed 2048² layers over the kernel
  shelf math (Q10; oversize → own texture; repack NOT ported — layer retirement is the
  memory door), the texture table (u32 handles from 1; the video kind registers a
  stable texture, Q5), the Residency system writing `TextureRef` change-only with one
  LRU over `(entity, band)` honouring `Retained`; GPU realisation deferred to the
  Phase B reflectors. Exit: the §6.4 invariant as a seeded property, and a frame-by-frame
  `TextureRef` timeline under the S6 drag script.
- **A3 — the Phase A review fixes** (**LANDED 2026-09-07**, `9e79425` residency side +
  `65d7fcb` behaviour side; James: "review the phase A implementation first" → two opus
  reviewers plus the orchestrator's pass, every headline claim verified against the code
  before dispatch). Blocker fixed: Residency published `layers().length` while
  `retireEmpty()` leaves holes, so a card could name an array index the array did not have
  (`layerCount()` published). Also: the `world.reset()` leak (dead-entity sweep), the memory
  door that only opened under budget pressure, dead unrealised handles accumulating, a
  register wake, D11 (the device clamp, `maxTextureSize` 8192 uniform), the `SurfaceDemand`
  default → `live/60` (D2 amended — the "frame gap" argument was wrong and `paused` parked
  every card in an unwired host); `domAtRest` owns only what it changed (a hand-held gpu
  target survives a drag), refuses non-dom kinds at init, one `SurfaceTarget` writer per
  widget (definition-time throw), the `ice:` namespace reserved (exact-name attestation +
  an engine-only mark); the idle tax's REAL cause was the behaviour runtime's per-delivery
  instance snapshot spread, not a `full` walk — cached, `domAtRest`'s idle row at 100k
  widgets 164 → 2 µs/frame, flat in N, whole flat-100k idle frame −19.8 %. The CHANGELOG's
  "React now promotes" claim was FALSE (the React composited profile has no source canvas;
  A1b fixed the decision half; pixels move at B3/B4) — corrected with the facade and
  behaviours comments; A2 got its CHANGELOG entry; the api-reference's stale
  `presentation`; bare entities no longer promotable, listed. 48 probes across both
  slices red their own test.)

**Phase B slices** (`vibe-field/draft/ground/FOLD.md` is the ground-side task grading;
its decisions D-B1.1–D-B1.6 stand as the build took them):

- **B1 [GROUND PORT] — the move** (**LANDED 2026-09-07**): `vibe-field/draft/ground` →
  `@ice/ground/compose` (+ `/engine`), wired into no profile. The flight's maths import the
  kernel's `nav-flight` — the ported tests pin them to the same numbers, the witness that the
  two were one. WGSL stays the source with a generated, freshness-gated string module
  (D-B1.3). The oracle lives in the package on Dawn (`webgpu@0.4.0`, Q11) and runs through
  `tsx`: the kernel's extensionless imports rule out raw Node (D-B1.4 as-built). The lab and
  its thirteen Chrome harnesses are `apps/groundlab` and its rigs (D-B1.5); the product's
  palette and the gobo plates are the oracle's fixtures (D-B1.6); dependency-cruiser walls
  both ways between the old leg and the new modules (D-B1.2). The ported code was brought
  to ICE's lint — 122 declarators split, the tests' `!` replaced by a `must()` helper that
  throws, one cast, two parameter locals — and none of it moved a pixel: the 44 oracle
  renders are byte-identical to a stash taken in the draft before the move, Chrome = Node
  44/44 at maxΔ 0, every rig green (nav 18 · portal 16 · mat 16 · panel 10 with 150 rows ·
  content 7 · glow 15), `pnpm run ci` green. `draft/ground` is frozen with a pointer.
  *(B2 addendum: D-B1.1 reversed — the ported imports lost their `.ts` suffixes, 163 in 43
  files, because every consumer app's typecheck and a bundled `.d.ts` would otherwise need
  the flag; the oracle through `tsx` never needed them. 44/44 renders still byte-identical.)*
- **B2 — the profile switch** (**LANDED 2026-09-07**): DESIGN.md first (D-B2.1 — the
  composited profile draws the card's material on the ground; the §7 states as the frame's
  terms; the cutting mat's row and its two lights — written into VibeField's DESIGN.md,
  uncommitted, for James). Then `groundCompose()` in `@ice/ground/compose` — the ground as
  the L0 layer, one canvas, GpuCompose drawing the empty board on camera/viewport change
  and never otherwise — and `compositedProfile` in `@ice/react`, registering §6's
  roster in order (four inert stubs, GpuCompose last), refusing the old leg's ground by
  name, walled from the old profile both ways (D-B2.2 as-built: the name is
  `composited` (B8 shortened the name this slice shipped it under; the CHANGELOG's B8 Breaking
  block records the rename); the rig arm is its own page and script, `boot`, rather than a
  flag on the old rigs — one profile per page, §11 Q2's law). Exit: the `next-boot` rig
  through the REAL React path — one canvas, one redraw, one submit, 0 GPU errors at boot;
  0 submits and 0 redraws over 481 idle frames; one frame for a camera write; the walls
  hold (depcruise clean); `pnpm run ci` green; groundlab parity 44/44 and mat 16/16 on the
  suffix-stripped tree.
- **B3a — compose in plate mode, the ground half** (**LANDED 2026-09-07**): the frame
  builder (`packages/ground/src/compose/frame-inputs.ts`) turns the world into the ground's
  records — Active widgets in sibling order as plate frames and field sources; the reveal
  on `Selected`, the lift on `Grab` × `ChromeSettings.liftScale`, the heat on the drop pair
  + `DragBounds` (D-B3.1 as built: the springs are the builder's flux, never a world fact,
  forgotten when a card leaves sight); a live portal per gated container from
  `engine.previews` (`portalAt` on the snapshot's `resolvedView` ≡ `portalOf` on the
  flight's arrival, bit for bit — the cut stays exact); depth-one (D-B3.2 owed: a preview
  child carries no entity). The dirty union as planned did NOT survive contact: a Tier-1
  `observeQuery` on Position/Size wakes every frame a selection exists (the selection
  chrome's declared write access is a column-wide stamp — 181 redraws over 181 idle
  frames, named by the new `wakes()` instrument) — the dirt is PULLED instead through a
  strata change collector (`coarse: false`), the order index's `stale()`, and two
  out-of-world wakes (0 over 181). Exit: the `next-boot` rig's board phase — 6 widgets + a
  folder with 3 inside, pixels off the ground canvas (a card's plate · the ground in a gap
  · the face a hole · the bar a plate), idle-zero with cards and after a selection settles,
  the lift, the heat lighting the plate and fading out — ALL PASS; 16 builder tests on a
  real engine; the oracle's 44 renders byte-identical after the `portalAt` extraction;
  `pnpm run ci` green. B3b next: DomCompose's chrome-less hosts and `clip-path`, the
  router's `pick()`, `Hover`, the parity redefinition, the D7 witness.
- **B3s — the pack seam** (design-014, **LANDED 2026-09-07**): what is generic stays in
  the engine (the lattice and bake, the dot, the slot tree and compositor, the SHELL card,
  the springs on engine facts); what is a look is a pack the app registers
  (`@ice/ground/packs`: `needleGlyph`, `cuttingMat`, `vfFrame()`). Three seams — a grid
  program, a card program (the record's head + `ext` tail, `card.wgsl`'s `shade_card` /
  `shade_over` contract), the theme's per-pack sections. The six leans ruled (D1 reference
  packs · D2 the ring as the drop cue · D3 `CARD_ABI` · D4 one-release CardShell window ·
  D5 no morph in the shell · D6 hover ignored). As built: the head's geometry is written
  by the program's resolve (the shell's or the pack's), the content binding by the engine.
  Exit: the oracle's 44 renders byte-identical through the relocated pack; three shell
  scenes as the engine card's baseline; `next-boot` ALL PASS with the packs at B3a's
  numbers; 380 tests; groundlab and its rigs through the packs; `pnpm run ci` green.
  B3b next.
- **B3b — the DOM boundary** (design-013 §10.6 Q8, design-014, **LANDED 2026-09-07**): the
  host is content only. DomCompose (the ground's, registered before GpuCompose) runs the
  build and writes each content element's `clip-path` (a polygon marched from the program's
  inner field, recomputed on `clipKey` — the reveal only), the lift on `transform` and the
  hold's opacity; the router's part channel — the stack's `framePick` slot the ground fills,
  `PointerPart` on the pointer, `DownPart` on the recognizer, the move route withheld and the
  tap handed over as `PartTap` → `onPart`; `useChromeOwner()` from the profile's
  `chromeOwner`, widgetlab's CardShell and folder view bare under `ground`. Exit: the
  `next-boot` boundary phase — clips written, chrome once (page pixels equal with the hosts
  shown and hidden at the ring band and the shadow skirt; the title differs; the folder's face
  is the portal), the close button → `onPart("close")` without grab or deselect, a band drag
  moves the card — ALL PASS; 4 core tests through the full stack; `pnpm run ci` green.
  Deferred to B4: D7 and the parity redefinition (they need drawn content); the P4 resize
  grips stay DOM chrome; `Hover` remains unbuilt.
- **B4a — the content term reads the world** (design-013 §4/§5/§10.2, **LANDED 2026-09-07**):
  the trunk B4 ∥ B5 ∥ B6 build on. `ContentResidency` (`compose.residency`) is what a
  `TextureRef` handle IS on the ground's device — `realize` (every realisation; a re-realised
  handle retires its earlier texture at the next `collect`, after the submit — D-B4.1),
  `wrote` (a write owed per destination, keyed by the ref: `empty` is never sampled),
  `touch` (the dirt latch outside the world → `WakeReason "content"`), `contentOf`
  (`page`/`own`/plate; the sRGB variant from the texture's actual format), `pagesView` (→
  `Ground.setPages`), `collect` (the table's drain as the destroy list; `onForget`). The
  profile owns its texture table (attached at install, disposed last) and registers a
  FORWARDER per render slot (`compose.renders.{dom,island,video}`) in §6's order, so a
  render installed after the mount runs in its place. The builder journals
  `SurfaceTarget`/`TextureRef` and emits every card's content term. Exit: 7 residency tests
  on a real engine + the infra; the profile test pins the table's ownership; the oracle's 47
  renders byte-identical; `next-boot` ALL PASS at B3b's numbers; `pnpm run ci` green.
- **B7 — the flight** (design-013 §8 B7, D-B7.1, design-006 §9, **LANDED 2026-09-07**): the
  flight is the ground's second slot. `NavTransition` carries the pre-cut camera;
  `departedCameraOf` is the one rule (the pre-cut camera itself at p = 0 and while frozen)
  read by the ground's departed slot AND the DOM's departing plane; `enterContainer` starts
  from the live portal's exact camera (`outgoingCamera(M, camPre)`); the first tick after the
  cut holds at p = 0 (one product frame IS the cut frame); `Retained` written on the departed
  set and released at the landing/yield/abort; `FrameBuilder.flight` builds the departed
  frame at rest in its own paint order with its content and portals — a hole at the entered
  container (one tree) on enter, the inside over the parent on exit; the compose layer owns
  the `ground` presentation plane. Exit: the `next-boot` nav phase — the enter cut maxΔ 0 over
  the whole canvas, both slots mid-flight, exact landing, idle-zero inside, the exit cut maxΔ 0
  whole frame, exact landing, the round trip pixel for pixel — ALL PASS; 4 core + 3 ground
  tests; the oracle's 47 renders byte-identical; `pnpm run ci` green. Findings: the pack's
  button springs now snap at settle; the departed frame builds its own ordinals.
- **B6 — VideoIngest** (design-013 §6 reflector 7 / §9 Q5, **LANDED 2026-09-07**): the video
  kind's contract becomes a REGISTERED STABLE-TEXTURE HANDLE. A producer states its size once
  (`compose.video.register`) and hands each frame over (`arrive`); the render in the profile's
  `video` slot copies it ONCE (`copyExternalImageToTexture`, premultiplied, no flip) into that
  texture, closes it, and says the destination was written — which is the wake. The old
  retain-and-import path (`compositor/video-source.ts`, the quad pass's `texture_external`
  variant) was untouched here and went with the old profile at B8; the ground deliberately has
  no external variant, and the fixture that used to retain its frames became the RIG's
  producer. The demand clamp bites at the door (paused ⇒ dropped and closed, no copy and no
  frame; a bucket ⇒ one copy per `demandIntervalMs`), and `defineWidget({ surface: "video" })`
  is now legal — only equip stamps `SurfaceKind`, so with the kind unspeakable the card could
  not exist at all (erratum recorded at both sources). FOUND: `collect()`'s written-set sweep
  is right for an atlas slot and wrong for a stable texture (the producer's pixels do not go
  away when a culled card loses its ref), so the ingest re-asserts the write when the same
  destination comes back — without it a PAUSED live surface that scrolls off and back draws
  the plate forever. Exit: `next-video` ALL PASS — 33 productions = 33 arrivals = 33 copies =
  33 submits over 181 frames; 6 distinct liveness colours over 8 productions; the fixture's
  top-left marker top-left on the ground's own pixels (both axes); paused 0 copies / 0 submits
  over 181 frames with the producer still producing (33 dropped by the clamp); idle-zero over
  362 frames; the null control on the plate. 11 ingest tests (16 mutation probes), `pnpm run
- **B5 — IslandRender** (design-013 §8 B5, §6 reflector 6, §9 Q9 path (a), **LANDED
  2026-09-07**): a `gl` island renders into the PRIVATE target Residency named for it, and
  the ground samples it in `own` mode. `createIslandRender` (`@ice/r3f`) installs into the
  compose handle's `renders.island` slot and runs in the roster, never in R3F's loop;
  `<GLViews>` selects that arm from a new `@ice/react` context (`useSurfaceContent`),
  published by `<InfiniteCanvas>` from the same effect that builds the ground — structural
  mirrors both ways, because neither package may import ground. Targets are keyed by
  HANDLE: a resize mints one and the old one dies at `onForget`, after the submit, so the
  pin-blind-resize class has no pin to be blind to. Eligibility is the old pass's own
  predicate, extracted (`islandPaintable`); what is added is the demand clamp (D10) —
  paused renders nothing, a bucket is a ceiling, dt is banked, and a fresh destination
  outranks the clamp. **Exit** (`next-islands`, ALL PASS): two islands and two dom cards on
  a real `<InfiniteCanvas>` + `<Canvas>` + `<GLViews>`; targets 480×320 = `rasterSize`,
  content mode `own` with `srgb: true`, 2 z-runs; the ink at the card's centre and the
  PLATE where the island is transparent, the top-left mark top-left; ground-drawn pixel vs
  the island's own texel maxΔ 0; noise floor 0 on both arms, first-paint transient 0,
  cross-backend 0.1283 % beyond 1/255 (maxΔ 64, all on the one rotated edge); idle-zero 0
  submits / 0 renders over 362 frames; 38 renders in 2.50 s at the 15 fps bucket (263
  clamped) and 0 over 2.51 s paused; a 30-frame resize drag = 31 handles, 30 disposals, 0
  stale targets, 0 GPU errors. 16 r3f tests + 5 react tests, 13 mutation probes; `pnpm run
  ci` green.
- **B4 — DomRender** (design-013 §8 B4, §6 reflector 5, **LANDED 2026-09-07**): a promoted
  DOM card's pixels reach the GPU. `compose/dom-render.ts` copies its L1 host into the
  destination `TextureRef` names (`hic-adapter` reused verbatim, its `origin` grown a `z`
  for the array layer) and calls `residency.wrote`, so the ground draws `page` where it drew
  the plate. The L1 `layoutsubtree` source canvas is wired in PRODUCTION for the first time:
  the facade builds it when the ground's handle carries the adapter's effects
  (`compose.sourceCanvas`), sizes its bitmap from the same rect the `Viewport` resource
  comes from, and `dom-widgets` parents every `gpu`-target host under it. THE SIZE IS ONE
  CALL: the host's CSS box is `geometry().cssSize` and the slot is `geometry().slotSize`
  from the same pure function on the same facts, with the profile carrying the ground's
  `raster` strategy to Residency so the two readers cannot disagree — which is what makes
  the drift exit 0 px by construction rather than a number that came out right. The demand
  clamp is carried in behaviour from the old binder (paused PARKS — no copy, no wake, outside
  `pending`; a bucket DEFERS; 0 copies now), the unpainted-host throw is counted and the debt
  KEPT, and the page array grows by realloc + per-layer copy + a new realisation (D-B4.1).
  Rulings: `hic-adapter` left both wall lists (a kept leaf, imported by both legs);
  `hostsBeforeRoster` on the profile contract puts the dom reflector before the roster for
  this profile only; the L1 canvas is pointer-transparent on a MIXED board and its hosts opt
  back in. Exit — the new `next-render` rig, ALL PASS: D7's promote diffs 0/70,176 px on the
  card's interior and again on the way back; idle-zero holds with promoted cards (0 submits,
  0 copies, 0 paint marks over 361 frames); an animating card copies 23.3/s against 59.8
  paint marks/s and a paused one 0; the drift readback finds 0 px past the slot under BOTH
  raster strategies at zoom 1.9 (the old leg wrote 40,272); S8's parity, redefined, is
  0/70,176 px against a stratified twin page with an A-vs-A control at 0. Plus 27 node tests
  (16 dom-render, 6 L1 placement, 5 mount), 11 mutation probes red, the oracle's 47 renders
  byte-identical, `pnpm run ci` green.

### B8 — the deletion — **LANDED 2026-09-07** (`97c2b48` the carry · `b5400a5` the deletion)
  The old composited leg leaves in one commit and the new profile takes the name. DELETED:
  `ground/src/compositor/*` (10 files), `atlas-allocator.ts`, `renderer.ts`'s offscreen target
  and blit, `GroundLayer`'s composited surface and `GroundOptions`/`GroundHostOptions`'
  `device`/`sources`/`target`/`order`/`atlas`/`lift`/`video`, `react`'s old profile, r3f's
  `webgpu-pool` · `retained-quads` · `webgpu-sources` and the `compositor` binding, core's
  `compositor-registry.ts` whole (`SurfaceKindValue` rehomed into `surface/contract.ts`), the
  quad pass's `texture_external` variant, seven rigs and 16 test files. RENAMED:
  `compositedNextProfile` → `compositedProfile`, `"composited-next"` → `"composited"`, the
  `next-*` rigs to `boot` · `render` · `input` · `islands` · `video`. SCOPING CORRECTION to
  §10.8: `GroundProgram.transition` and the three outgoing strategies STAY — `programs/
  magnet-grid.ts` declares `"snapshot"` and is the shipping stratified grid, so they retire at
  C2 with it. CARRIED, each with a mutation probe: the no-full-board-repaint claim (grep
  re-pointed at `src/compose/`, behaviour re-expressed against Residency + DomRender), the
  quiet-frame ordering claim (a fake `Ground` counting `surface.view()`), the parking LOOP, and
  factory parity (split across the package wall: the mount fills every slot; the profile leaves
  no stub). PORTED: the `input` rig, which FOUND TWO DEFECTS — a settled promoted card's L1 host
  never tracked the camera (7/24 mid-gesture hits landed, the host 540 px out; now 24/24 at
  0.000 px), and once placement ran every frame a pure pan re-uploaded the board (1,404 copies;
  the §4.2 temporal guard now drops 3,606 self-writes and copies 0). ALIGNED: `ownFor` takes the
  kind's sRGB fact; `promotable()` and `canvasEligible()` are one predicate reading both the
  world's stamp and the definition. SHIPPED: `@vibecook/ice` gains `./ground/compose`,
  `./ground/packs`, `./ground/engine`, and the mat's blue-noise tile is generated into the
  bundle. Exit: `pnpm run ci` green · `gen:check` fresh · the oracle's 47 renders byte-identical
  (roll-up sha unchanged) · every rig ALL PASS (`boot`, `render`, `input`, `islands`, `video`,
  `hic:copy-gate`, `smoke`; groundlab's `rig:parity` and `rig:nav` as untouched controls) · the
  pack audit's four answers PASS. OWED: the desktop product's `<Canvas>` still uses three's own
  WebGL renderer, so its GL islands draw nothing under the composited profile — GLViews says so
  loudly; moving it needs the app's `PMREMGenerator`/`RoomEnvironment` environment path, which
  is WebGL-only. Also owed: a per-frame copy budget on DomRender (the old `demand` rig's boot
  stagger).

**Phase C slices.** C0–C3 landed 2026-09-07 in a parallel session, with the 0.13.0 cut on
the same day; their as-built detail is in the CHANGELOG's `[0.13.0]` blocks and in
`draft/design-013-implementation-plan.md` (local-dev only), not as rows here. What IS
recorded here is the review of them and the wave it produced:

- **C4 — the Phase C review fixes** (two blockers: the desktop app's light mode under the
  opaque ground; the departed slot's stale config — and the should-fix list) — **LANDED
  `6a93523` (C4d) · `beb319b` + `2c7fed4` (C4c) · `8debfe7` + `9a232c3` + `1ad0ebd` (C4b) · `7aa9bb5` + `2a47b95` (C4a)**, 2026-09-08. Four builders in parallel off `c5fa789`; landed d → c → b → a (the witnesses first, so every later landing ran `gate:landing`), each with `pnpm run ci`, the seven desktop rigs and the landing gate on the rebased tree, then ci on main.
  **C4a, the ground:** the departed slot's config snapshotted at every canvas-session change
  (D-C4.2), a lost device ENDS the layer (D-C4.3), `groundField()`'s theme defaults from
  `prefers-color-scheme` (D-C4.4), the overlays cache guard that made an ordinary board
  re-collect both soups every painted frame, a refused realise that backs off and an oversize
  refusal that clears its write (D-C4.7's ground half), DomCompose's cache keyed by the
  ELEMENT (D-C4.8), `PoleSource.changed()` off the hot column (D-C4.9), the `line` glyph's
  law in CSS px (D-C4.10), and the B9 halves that had no test. **C4b, core + r3f:** the
  facade re-seeds `Camera` and `Viewport` after a document close (D-C4.5), the coordinator
  answers `ownerOf(plane)` and `<GLViews>` registers only when unowned (D-C4.6),
  IslandRender's backoff. **C4c, the desktop app:** both ground arms take the app's theme,
  the renderer lease drops a resolved renderer that is not the current one and disposes its
  PMREM target (D-C4.12). **C4d, the witnesses and this record** (D-C4.11): the parity
  script asserts per scene and exits with the count, a root `gate:landing` runs the oracle
  → the lab's build → parity → `pack:audit`, `prepack` runs the pack audit so the publish
  itself is gated, and `tsPreCompilationDeps` makes a type-only import an edge. The rule
  the wave exists to end (D-C4.13): every fix carries a test that fails without it, PROVEN
  by reverting the hunk, not asserted.

## M20 — The desk (design-015) — **IN BUILD (planned 2026-09-25 · D1, D2a-core, D2a-render, D2a-world, D3r-a, D3r-b, D2c and D2b LANDED 2026-09-25 · D4a, D3w, four core fixes, D5a, D4b, D5b — THE DELETION — D3t-a, D3t-b, D3t-c, D6 and D7 LANDED 2026-09-26 — THE PROGRAM IS LANDED; the 0.14.0 release cut is James's)**

*(Numbering note: next free after M19. design-015 is ruled in direction by James's
2026-09-25 instruction — "no more dom and r3f widgets, we will have our webgpu object
widget instead … the current widgetlab in ICE will be retired, our cutting mat ground will
be the default" — which also rules vibe-field's thinking-the-desk DK-D1…D10 as leaned and
design-013 Q13 (the zoom-through) on. The task-grade plan is
`draft/design-015-implementation-plan.md` — local-dev only.)*

Every object under the camera is drawn by ONE WebGPU renderer from the world; the DOM
lives only in screen space (the app's chrome, the selection menu and held bar, and at most
one focused editor). A widget becomes an OBJECT KIND — durable props in the document, a GPU
program, a CPU hit mirror, behaviours — declared with `defineObject` (design-005's compiler
without the view). The renderer is `vibe-field/draft/ground`, the prototype that has been
the ground's lab since design-013 B1, moved at its 2026-09-25 snapshot into a new package
`@ice/desk` beside the old ground and proven byte-identical before anything is driven from
the world: the cutting mat (its gobo, its Sun and Moon, its rulers) is the ground; the mini
mat — a small cutting mat with a desk inside it — is the container, entered by the
design-006 flight or the zoom-through; notes, notebooks, whiteboards, calendars and photo
prints are the reference kinds. `packages/r3f`, the 09-07 ground (the magnet field, the card
pass, DomRender/DomCompose/IslandRender/VideoIngest), `packages/dom`'s WORLD-SPACE half (its
screen-space half — the pointer adapter, the loop, the focus model — is the desk host's own and
stays), core's surface infra and residency, the profiles, the widget React binding and ALL NINE
apps (graybox and pointerlab too: they draw DOM under a camera transform) are deleted in one
commit at the end (D5), after `apps/desk` — the new showcase — passes the prototype's harnesses
as rigs; the exit tests those apps carried are ported to `apps/desk` or core, or retired with
their subject, by name (design-015 §11.6).

**The ladder:** D1 the move ∥ D2a-core (the object binding in core) → D2a-render (the kind
registry) → D2a-world (the desk from the world) → D2b mini mats + nav ∥ D2c notes + the text
stack → D3 notebook ∥ whiteboard ∥ calendar ∥ photo ∥ D4a the marks (*Marks on the Mat*) → D4b
the opening (pick it up; the focus blur) → D5 the deletion → D6 performance (persistent
records; the 1,000-object gates) → D7 review.

**Exit (design-015 §11):** the prototype's oracle scenes byte-identical through the move AND
through the world; Chrome = Node at maxΔ 0; the prototype's harnesses pass as `apps/desk`
rigs; idle 0 submits; O(1) pan with no per-entity work; 1,000 mixed objects pan at 120 fps
with JS ≤ 2 ms/frame; no `three`, no DOM under the camera anywhere (grep + depcruise).

- **D1 — the move** (**LANDED 2026-09-25**, `ff76610` the move · `44dad26` Chrome = Node): the
  prototype's 66 source files, 23 of its 25 WGSL files (the retired flat notebook's two stayed
  behind with `src/book`), its blue noise and its oracle as `@ice/desk` + `apps/desk`'s parity
  page. The one code change beyond conformance: the flat notebook's dead `books` slot left
  `ground.ts` (D-D1.1; no host passed it). Conformance was mechanical and proven: 319 multi-
  declarators split with 51 files token-equal to the pre-lint tree, 50 `±Infinity` →
  `Number.±INFINITY`, 93 test `!` → `must()`, six justified `biome-ignore`s where a rewrite
  would move a float or change what an explicit `undefined` means. Exit: the 38 oracle scenes
  sha256-equal to the prototype's renders of the frozen snapshot — four times by the builder,
  once more by the orchestrator at grading — and the 20 checks identical; Chrome = Node at
  maxΔ 0 on all 38 (a one-byte perturbation control reds exactly 1 px); 216 units (the
  prototype's 243 less the 27 that tested the retired flat notebook and the lab's tunables);
  `gate:landing` exit 0. `pnpm run ci`'s test leg reds only on load timeouts outside D1's
  closure (dom's 10k-mount at 16 s vs 5 s, widgetlab-desktop's app-mount — 290 ms alone at load
  343). Owed: `engine/device.ts`'s `surface()` touches the DOM, so `desk-dom-free` is not yet
  true (D2a-world moves it to `desk/host`); the CI-runner Dawn probe (D-B1.4) now covers two
  oracles.
- **D2a-core — the object binding in core** (**LANDED 2026-09-25**, `0cdd5d2` · `ada5846` ·
  `8e57112` · `d4dd78f` · `a3cf6a7` · `ab8b0fc`; built in parallel with D1, rebased over it with
  one CHANGELOG conflict resolved by keeping both blocks): additive, every existing widget path
  unchanged. `defineWidget({ surface: "object", object, stratum })` — a widget that is a GPU
  object (an opaque kind binding, no component, NO surface facts, no mount entry, the ground
  plane alone in a flight — `presentationPlanesOf`); equip stamps `Stratum { band }` and
  `compareStackOrder` ranks it FIRST, so pick order is paint order across kinds (an all-dom board
  pinned identical against a verbatim copy of the old comparator); `Locked` (durable tag) +
  `ops.setLocked` (one transaction; move/resize skip a taped widget, the marquee passes over it);
  the desk's input as settings (`GestureSettings.wheel: "zoom"` = the prototype's
  `exp(−Δy·0.0016)` about the pointer for a plain wheel and a pinch; a one-tick `WheelZoomStep`
  for the zoom-through to read; `ToolRoute.canvasDragShift` so a tool pans the bare mat and
  marquees on shift); CameraLimits [1e-8, 1e8] end to end — which found a real kernel defect:
  `flightCamera`'s equal-zooms test was an absolute 1e-12 on 1/zoom, so at zoom 1e-8 two zooms
  3 ulps apart put the view centre 4× past its endpoints (now relative). Every new behaviour's
  test was proven red by reverting its hunk (a sha-guarded script, never `git checkout`). Exit:
  core 864 → 906, kernel +2; on the rebased tree typecheck · lint · depcruise · gen:check green,
  kernel · core · desk · react · ground · dom (60 s timeout — the known graybox 10k load flake)
  and the widgetlab/widgetlab-desktop/moodboard/nodeboard suites green, `gate:landing` exit 0
  (both oracles, both parity rigs 0 FAILED, the pack audit ALL PASS). Owed: api-reference
  entries (D5's docs pass); kernel `snap.ts`'s world-unit tolerances at extreme zoom; Locked vs
  nudges, `ops.arrange`, resize handles and duplicate (D4a); `NavCamera.zoom` is f32 (D2b).
- **D2a-render — the kind registry** (**LANDED 2026-09-25**, `d064a22` · `a82c40f` · `68d005a`):
  the desk's composition root names no kind. `KindProgram` / `KindPass` (`src/kind.ts`, design-015
  §5.2's render half: `spawn` · `tune` · `prepare(encoder, SlotContext, records, KindExtra)` ·
  `drawRange` · `drawOver`), `SlotInputs.objects` in paint order with a portal's `at` indexing
  it, `drawSlot` walking the strata (pads · sheets · things, whatever order the caller used)
  and each stratum's RUNS of one kind with a per-kind cursor, a sheet with a live inside
  splitting its run (range · child · scissor restore · `drawOver`); the note, the mini mat and
  the whiteboard as kinds (`@ice/desk/kinds`: `paperProgram` · `miniMatProgram` ·
  `boardProgram`, `DESK_KINDS`) over the moved passes with no WGSL change (`BoardPass` gained
  `drawRange`); an unregistered kind is a named error. Exit: the 38 oracle renders sha256-equal
  to D1's — three times by the builder, once by the orchestrator at grading — the 20 checks
  identical, a Dawn error probe clean over registry creation and all 38 frames (the whiteboard's
  passes compiled on Dawn for the first time), Chrome = Node maxΔ 0 twice; desk 216 → 234 units,
  the 18 new ones each red under at least one of 19 deliberate mutations of the walker, the
  kinds and the wall; `pnpm run ci` exit 0 (no load timeout this run) and `gate:landing` exit 0.
  Owed: a depcruise rule for "the root imports no kind" (a unit test reads every import form
  today); `SlotContext.fadeIn`/`cfg` are the grid's UNDRESSED values exactly as the prototype
  passed them (D2b looks at it with the dressing).
- **D2a-world — the desk from the world** (**LANDED 2026-09-25**, `4926b05` · `09ef89d` · `02a3dd7` ·
  `419d7f4`): the desk renders, picks and idles FROM THE ECS WORLD. `ObjectKind` (a `KindProgram` + its
  world half: `resolve` · `record` · `hit` · `reach` · `reads` · `chip?` · `theme?`), `defineObject`
  compiling through core's `defineWidget({ surface: "object" })`, the reference `Note` and `MiniMat`
  objects; `@ice/desk/compose` (DOM-free): the builder (the nav frame's object members by
  `compareStackOrder`, the carried set last, cull by rect ⊕ reach, springs and DELETE GHOSTS as flux —
  a despawned object keeps its last record and fades 220 ms in its paint position —, hover from the
  mouse pointer's `TouchesExact`), the pick source (`undefined` before geometry — B9's blocker —,
  `"outside"` on a miss), the AMBIENT policy (the wind, the mat's clocks and the gobo tilt run while
  touched, then ease still and the desk idles at ZERO submits — D-D9), the reflector (pulled dirt);
  `deskLayer(opts)` (desk/host, with the swap chain moved there — `desk-dom-free` holds but for
  `pictureFrom`'s DOM image types) mounted through `<InfiniteCanvas ground={…} chrome={false}>` (react's
  one change: the `chrome` prop); `apps/desk` is a React 19 desk with `window.__desk`. Built by a fable
  builder that died at its CONTEXT LIMIT mid-sub-slice 3 after committing sub-slice 1; its uncommitted
  ~3,300 lines were frozen by the orchestrator and a fable FINISHER completed them (the builder's
  `pinFlux`/`clearFlux` parity hooks, the handle's shape), fixed what the rigs caught (the six paper
  scenes red at maxΔ 166–201 on exactly note 1's ink box — a raster pinned in the same task as its
  spawn, before `PrefabId` was readable; the idle rig's 15 stray submits — the gobo tilt filter's tail
  kept the reflector live), and rewrote the WIP into honest commits. Exit: `rig:world` — the 20 mat,
  ruler and paper oracle scenes SPAWNED AS ENTITIES and drawn by the real reflector path = the Node
  oracle at maxΔ 0 (re-run by the orchestrator: 20/20); `rig:interact` 24/24 (select + ring without
  overshoot, a mini mat rises on hover, a drag lands where held with ONE undo step, ⌫ fades 220 ms and
  ⌘Z restores, the shift marquee, the wheel zooms exp(−Δ·0.0016) about the pointer, a bare drag pans);
  `rig:idle` 10/10 (0 submits over 240 frames at rest; a touch revives the wind); the desk oracle's 38
  renders sha-equal; desk 274 units (11 mutations red), react 57; `pnpm run ci` exit 0; `gate:landing`
  exit 0 with world · interact · idle added after the desk's parity leg.
- **D3r-a — the photo print's and the whiteboard's render halves** (**LANDED 2026-09-25**, `a614a7e` ·
  `8b27df8` · `bb92096` · `c9d74aa` · `cf6a5c1`, rebased by the orchestrator over D2a-world — the kinds
  barrel, the parity rig's page name, the app's scripts and the CHANGELOG): the print as a `things`
  kind (`photoProgram`; the pass gained `spawn`/`tune`/`drawRange` and the `LIT_ELSEWHERE` override for
  a print inside a mini mat, the root path's bytes unchanged); 12 new Node scenes and 11 checks (photo,
  order across kinds, board, replayed ink, ring, lit — r 0.978 vs an own-lamp control's −0.147);
  `rig:proto-parity` — the same scene staged in the PROTOTYPE's own photo lab and board bench vs the
  desk: 10/10 BYTE-IDENTICAL (which also proves the prototype's separate photo pass equal to the desk's
  single pass); Chrome = Node on 47 of 50 scenes at maxΔ 0 and three inked-board scenes KEPT at maxΔ 1
  on ≤ 16 px — Chrome's Dawn and node-webgpu's compile the board's stamp pass differently on 6 of 2.2 M
  texels (named, measured bounds in the rig). Owed: board ink bit-stability across Dawns; the photo
  fixture's `--check` into `gen:check`; a far-LOD chip for prints (D2b).
- **D3r-b — the notebook's and the calendar's render halves** (**LANDED 2026-09-25**, `8fa752f` …
  `bf8e09e`, seven commits): the real 3D notebook (under the desk eye, its shadow maps and MSAA layer)
  and the desk calendar's pad become kinds — root-only (a spawned slot's pass is null, D-D18) and
  COMPOSITE (`KindProgram.composite`: one run after the rest of its stratum, because the composite
  covers every book or pad at once — the named limit: a thing laid on a notebook draws under it); both
  layers now record into the frame's encoder after the mat's wind, which removes a one-frame wind lag
  the prototype's own submit had (maxΔ 11 on the first frame after a wind change). Exit: 9 new Node
  scenes; Chrome = Node on all 59 scenes (the MSAA resolves and the shadow compares needed no bound);
  `rig:proto-parity` — every book and pad scene BYTE-IDENTICAL to the prototype's own main lab (19 held
  in all); a GPU error-scope probe clean; the cost equal to the prototype's passes where a book or pad
  draws (0.03–0.05 ms more on empty desks — owed to D6). It also found and fixed a defect on main:
  `rig:proto-parity` had thrown since D2a-world renamed the parity page.
- **D2c — the note's text** (**LANDED 2026-09-25**, `2b78d16` · `c7ade1a` · `9b5eda0` · `9b2ad26` ·
  `82b3efe`, rebased by the orchestrator over D3r-b): the note's writing is DATA — one durable `ink` cell
  `{ text, seeds }` (the hand law's per-glyph seeds, base64) — and its ink a CACHE (the `TextRaster` seam;
  the browser's Canvas2D raster in `desk/host`; layout and raster keyed exactly, re-rastered only on an
  edit or a √2 rung crossing, only near the view; the ink pages' page-slot leak across delete/undo
  closed); the ONE focused editor (an invisible platform textarea in screen space, placed each frame by
  translate · rotate over the drawn note — the law's grep pins it); typing as a GESTURE (core's runtime
  `Editing` is a gesture claim; the cell is written live and committed as ONE transaction per session on
  Esc, blur or 1 s idle — ⌘Z undoes a session). Exit: `rig:sticky` 35/35 (the live raster equals the
  committed `ink-note-1` raster byte for byte; the hand-off 0 px; the editor rect = the note's screen rect
  to 0.1 px; IME), `rig:two-tab` 10/10 (a session crosses to another tab when it commits, same seeds),
  37 mutations red; on the combined tree `gate:landing` exit 0 with both rigs added, and `pnpm run ci`
  red ONLY on dom's graybox 10k-mount load flake (5.3 s vs 5 s; 4/4 alone), every later stage run
  separately green.
- **D2b — mini mats, nesting and nav from the world** (**LANDED 2026-09-25**, `f27d9e1` · `4b7fca3` ·
  `c4971cf` · `758ba06`): the prototype's nav conventions on the world. THE NAV GEOMETRY SEAM —
  `stack.navGeometry` beside `framePick`: the desk is the authority on a container's face AS DRAWN
  (through its springs), so a flight starts from the drawn face and the cut is exact; `NavOpts` gains
  `face`/`arrival`/`c0` and `transition: "cut"`, `NavCamera.zoom` is f64; the enter gesture is two
  instant taps (D-D2b.1 — `MultiTap(2)` parks the first tap 280 ms); the ZOOM-THROUGH (a wheel that
  leaves the face covering the view cuts in with no flight, a wheel out cuts out; a touch pinch never
  cuts — D-D2b.5) writes `NavIntent`, applied on the engine's new `afterStep` hook (the raw loop never
  applied it — D-D2b.12), and the cut op states `NavRedress` itself (D-D2b.13). DROP-INTO through the
  portal affine (`interaction.drop`: an object's centre over the drawn FACE decides, it lands at
  `(n − M.o) / M.s` taking the inside's scale, ⌥ keeps it out; view widgets keep their rules). The
  builder per SLOT (root · inside · departed): every container gets its inside — its `ChildOf`
  children as content, a far-LOD `chip` per kind (≤ 64), and past the gate (presence > 0, depth < 4,
  the largest faces first) a LIVE slot built under the inside's camera, recursing; the FLIGHT draws
  the departed desk from the frame's `Retained` widgets with the lamp's handover and holds the cut
  frame at p = 0 (D-D2b.7); the RE-DRESSING after a cut eases 320 ms in log space. Exit: `rig:world`
  38/38 at maxΔ 0 (the minimat, chain and nav scenes added), `rig:portal` 21/21 (THE CUT — the frame
  before the enter and the flight's first frame the same PNG; the zoom-through by a real wheel, in and
  out), `rig:nav` 25/25 (a live flight landing exact to 1e-9; THE PRESS + DOUBLE-CLICK CUT from the
  face as drawn — 2 % larger than the static rect — the same PNG), `rig:interact` 28/28 (drop-into, ⌥,
  the vinyl key); core 908 → 930 and desk 323 → 330 units, each new one proven red. Graded by the
  orchestrator (the builder stopped on the account's rate limit before its own final gate): `pnpm run
  ci` exit 0, `gate:landing` exit 0 with rig:portal and rig:nav added.
- **D4a — the marks and the selection menu** (**LANDED 2026-09-26**, `baa80c0` … `20d9bd7`, thirteen commits —
  nine rebased over D2b by a finisher, four it added): *Marks on the Mat* on the GPU. The MARKS PASS (desk/src/marks; stratum 5, screen px): the
  page's reference drawing re-expressed as ONE instanced draw of SDF records — the pencil's brackets (lock-on 180 ms,
  one ring under 24 px, knobs only where a kind resizes), member ticks under several's union, the vellum marquee
  (live touches, the fold onto the union, tape skipped — Q-g), the laser guides and gap pills from core's snap facts
  (the strike on a new alignment), the masking tape on `Locked` with its 2 px GIVE when a drag meets it, your extent on
  the rulers; drawn once in the ROOT slot after every stratum (an entered mini mat's objects wear them — the root slot
  IS the entered frame). The kinds' own ring RETIRES: a selected object's pixels are the unselected object's, and
  `ObjectKind.frame` names the silhouette the marks go around. The marks' facts are READ (`Selected`, `Locked`,
  `Grab`, `Resizable`, `GuideLine`, `SpacingBar`, the marquee preview, the gestures) and their motion is flux stepped by
  dt (a `marks` wake in the reflector — idle-zero holds). The desk's keys (core): ⌥ at a drag's start leaves a copy
  in the move's one transaction, ⌘ holds the snap off, ⇧ locks an axis (`moveDelta`, shared by the snap and the move),
  ⇧⌘L tapes / lifts (`ops.setLocked`, one transaction); nudges and Clean Up pass tape over. `<SelectionMenu>`
  (@ice/react): ONE screen-space element placed from the desk's anchor 10 px above the marks (flipped under the top
  ruler), away for a gesture, stepping aside while a note is written (D2c's `Editing`), the app's acts first (apps/desk's
  stub Send). Over D2b the marks are the ROOT slot's alone — an entered mini mat's objects wear them (the root slot IS
  the entered frame; a rig row selects a note inside an entered, wheeled mini mat and its brackets stand where the
  entered camera draws it, to 1e-6), the inside and departed slots add none, and the enter clears the selection, so
  D2b's press + double-click cut is compared outside the pre-cut marks' band (maxΔ 0 over 3.8 M px). Exit: 14 marks
  stills in the Node oracle (72 scenes, 55 checks); `rig:parity` 72 — 69 at maxΔ 0 and the 3 named board bounds;
  `rig:world` 38/38 at maxΔ 0 (the brackets from the world = Dawn); `rig:interact` 47/47; `rig:proto-parity` 19
  byte-identical (a selected scene drawn the prototype's way for its bench); idle, portal, nav, sticky, two-tab green;
  core 937, desk 361, react 63 units; ci exit 0; `gate:landing` exit 0 (re-run by the orchestrator). Provisional calls
  (James's to overturn): ⌥ is read twice — at a drag's START it leaves a copy, at the RELEASE it keeps the object out
  of a container (held throughout: both); the chrome belongs to the desk you are on and leaves at a nav cut with it.
  Owed: a dropped object stays `Selected` unseen inside the mini mat (a core fix); the consume path leaves no ⌥ copy;
  a D-D2b.7 cut still whose spring moves at p = 0 (the ring that witnessed it retired); the retired ring spring still
  advances and keeps the desk live (D6).
- **D3w — the whiteboard, the print, the notebook and the desk calendar from the world** (**LANDED 2026-09-26**,
  `7de815d` … `bf30714`, fifteen commits — seven built on `1645f1c` by an opus builder, rebased over D2b + D4a by a
  finisher that added eight integration commits): the four kinds' WORLD halves at rest (`boardKind` · `photoKind` ·
  `notebookKind` · `calendarKind`, per-desk locals; the notebook's and the pad's geometry carries the desk eye, so a
  hit goes through the eye the pass draws with) and their objects (`desk.board`, `desk.photo`, `desk.notebook`,
  `desk.calendar`); their durable data as CHILD ENTITIES — `desk.stroke` (points = base64 LE f32 pairs), `desk.event`,
  `desk.pin` with the reified edge `desk.pins` (a pin carries data, which strata's relations cannot) — read through
  `KindHost.children`, a board's ink REPLAYED from its strokes (the raster a cache); the `BlobStore` seam (sha-256 keys;
  the app's store; ONE decoded `Picture` per blob, dropped with its last print); the print's own CARRY — the kinematic pin
  on the finger, the flick from the last 70 ms capped 4200 u/s, the glide, the Coulomb grip — as flux, committed as ONE
  transaction at rest (a print is not core-movable: core commits a move at release); one set of springs for every kind.
  Over D2b and D4a: the ring retires on all four (brackets from each kind's `frame` — the oracle's marks see books and
  pads as `encode` builds them), a whiteboard RESIZES (*Marks on the Mat* puts knobs on photos and whiteboards; they are core's
  handles, and its ink replays at the new size), the whiteboard, the notebook and the calendar are ROOT objects (`interaction.drop: "never"`, D-D18),
  a print lies inside a mini mat through D2b's inside slot, a taped print answers a drag with the tape's give, and the
  menu stands over each kind. Exit: the desk oracle 74 renders, 56 checks (a selected book and pad as new marks stills); `rig:parity` 74 · 0
  failed · 3 kept; `rig:world` 38 → 61 (58 at maxΔ 0, the three inked boards within D-D3r-a.5's 1-LSB bound); `rig:interact` 47 → 102 (the print's flick lands where `stepPhoto` replayed says, to 1e-6, and one ⌘Z undoes
  carry + glide); parity-by-construction units against the oracle's own `frame.mjs` on a stub device (every board, print,
  book and pad record); desk 361 → 418 units, every new one proven red; `rig:proto-parity` 19 byte-identical; ci exit 0;
  `gate:landing` exit 0 (re-run by the orchestrator). Owed: a print's drop-into (its carry must learn the face) and a
  resize law for prints; a resize read as a lift (a board rises while its knob is dragged — a fact to tell a resize
  from a carry); per-kind ghost durations; the notebook's open state and a standing cover's shadow beyond its reach
  (D4b); the held tools of all four (D3t). Found and fixed separately: a click's release + a coalesced far move armed
  a ghost drag (core, `fix-click`).
- **Core fixes found by the desk's rigs** (**LANDED 2026-09-26**, `9a28a20` · `05f53e3` · `aa46b98` · `5657c14`, built
  by one opus agent, rebased over D3w by the orchestrator): **the coalesced click** — `pointerIngest` folded a tick's
  events past a transition, so a release and a far move in one frame published `WentUp` at the move's point and armed a
  ghost drag that captured the clicked object (D3w's rigs had dodged it with a pause); a pointer's fold now ENDS at its
  transition (the rest of the drain is the next tick's facts, arrival order kept) and a Possible drag fails on its
  release. **The selection stays inside the frame** — membership removes `Selected` with `Active` (a consume's reparent,
  a peer's, an undo that carries a widget away), so a note dropped into a mini mat is no longer selected unseen
  (design-011's `Selected ⇒ Active`, held before only by some consumers). **⌥ into a container** — the consume path
  honours D4a's `LeavesCopy`: the copy at the origin, the original inside, one transaction. **Arbitration per tick** —
  every claimant of a pointer collected across strata's archetype batches before one decision (Pinch > Drag > LongPress
  > Tap had held only within a batch; a LongPress + Drag tie could leave the pointer claimed by a dead recognizer).
  Witnesses: core units (coalesced-release 4, consume-selection 6, consume-copy 3, arbitration-batches 7 — each red on the
  reverted hunk) and rig:interact rows §8b/§8e/§8f, each red on the reverted core. Graded by the orchestrator on the
  combined tip: `pnpm run ci` exit 0 (core 937 → 957 units), `gate:landing` exit 0 (rig:interact 102 → 114, every other leg
  unchanged).
- **D5a — the exit tests and the last harnesses on the desk** (**LANDED 2026-09-26**, `97b51fd` … `78e6b58`, fifteen
  commits, opus): what the nine retiring apps witnessed now lives on the desk, BY NAME (design-015 §11.6). **M5** —
  `rig:two-tab` gains "M5 two-tab convergence" (10 → 19: a spawn, a real drag as ONE commit counted at the
  transport, a delete and its ⌘Z, a mini mat's inside edited — two real tabs on `?room=`); **M8** — `m8-cascade` and
  `m8-port-churn` as core tests over desk objects (its observer now runs from the first frame — nodeboard's had
  attached after boot, so a select tool lighting every port stayed green); **M9** — `apps/desk/test/collab.test.ts`
  (two desk engines over the same in-memory doubles: convergence key for key, presence to `CursorVisual "remote"`, a
  room boot that touches no storage) and `rig:collab` LIVE through the ws relay the rig starts itself (9/9: add,
  real drag, delete converge; each tab shows the other's cursor at the peer's world point through its own camera, to
  0.5 px, before and after a pan); **M10** — `apps/desk/test/exit-imports.test.ts`, THE SURFACE one constant (an
  unused allowance fails too); **M6** (`cardboard exit-trace`, `cull-reenter`) and **M7** (`glboard gl-router`)
  RETIRED with their subject. A room's other people are `@ice/dom`'s remote cursors (the reflector
  `<InfiniteCanvas>` already mounts, now fed by the presence the desk joins with; design-015 §1/§3 keep it) — a GPU
  remote hand in the marks pass was built first on the brief's word, then reverted in its own commit when the
  orchestrator's correction reached the builder (it would have drawn every peer twice). The last prototype
  harnesses: `rig:ruler` 23/23 (held to the same frame bare — the prototype's bar was cleared by the lattice alone),
  the mat's and rulers' ms/frame rows in `rig:cost`, the lattice's zoom sweep as 11 world stills, the tweak panel as
  `apps/desk`'s dev panel (the backtick; `handle.tuneLaw`, `DeskLayerOptions.springs`) with `rig:panel` 13/13; and
  D-D2b.7's witness restored (`rig:nav` §7: a double-click while a lift and a hover are mid-spring — held for 400 ms
  at p = 0, maxΔ 0; red with the hold removed). Exit: rig:parity 85 · 0 · 3 kept, rig:world 72 · 0 · 3 kept,
  interact 114, nav 26, two-tab 19, collab 9, ruler 23, panel 13 (the last three added to gate:landing); core 959,
  desk 418, apps/desk 12 units; ci exit 0; `gate:landing` exit 0 (re-run by the orchestrator). Owed: presence
  carries no nav frame (a peer inside a mini mat is drawn in this desk's frame); the ruler's 1× atlas row and the
  cost bench's "blowing" row.
- **D4b — the opening: pick it up** (**LANDED 2026-09-26**, `26e289e` … `5ed5ca4`, six commits — five by a fable builder on
  `881707e`, rebased by the orchestrator over D5a, plus THE SURFACE's one-line admission of `@ice/desk`): design-015 §8 as
  *Marks on the Mat* v2 draws it — an object is picked up INTO THE HAND with no camera move and the desk behind goes out of
  focus. Core: `Held` (a runtime tag; one writer, `ops.open` / `ops.putDown`; refused for a type that is not `openable`,
  the object-only `defineWidget` word `defineObject` sets from `kind.open`), the user's `HeldView { zoom, panX, panY }`,
  held input routed at the head of `react` (every local pointer handled while held — the camera never hears a held
  gesture) through the pose seam `stack.heldPose`, desk.js's numbers for the held zoom (⌘-wheel / pinch 0.72…3 about the
  pointer), pan and the zoom-out past 0.72× that puts it down and MUTES the rest of that gesture, the double-tap router
  asking `open` before the container test, `HeldIntent` applied after the tick. The kind's `open` binding (`extent`,
  `pose: "camera" | "eye"` — a flat kind's pose IS a camera mapping its extent to the held rect, the notebook rises under
  the desk eye by H·(1 − 1/grow) —, `openness`, `spread` for a portrait phone's single page, `tools` DECLARED for D3t);
  `hold/pose.ts` (the reading size, the pose in log scale, the camera, the frame, the focus) shared by the builder, the
  oracle and the units. The render path (`renderHeldFrame`, shared with the oracle): the desk copied at half dpr and
  dual-Kawase-blurred ONCE per settled desk, cross-faded by e with an 8 % dim, the hand drawn as its own bare slot through
  the reading light by night — a composite-level override, the kinds' bytes untouched; e = 0 is the rest path.
  `<SelectionMenu>` travels to the foot and becomes the held bar (Send · the kind's tools, dim until D3t · Done); ⏎ opens,
  Esc puts down first, the desk's keys go quiet in hand; apps/desk walks its objects with Tab. Exit: seven `hold-*` oracle
  stills (the rest frame at e = 0 byte for byte; the hand's reach bounded; identical twice) Chrome = Node and FROM THE
  WORLD at maxΔ 0 (rig:parity 92 · 0 · 3 kept, rig:world 79 · 0 · 3 kept); `rig:open` 38/38 in `gate:landing` (the camera IDENTICAL after every open/put-down; idle-zero in hand —
  0 submits in 600 ms; the copy + blur 0.28–0.39 ms once, 0 per still held frame; every way back incl. the muted zoom-out;
  Tab → ⏎ → Esc with the selection back); core 971, desk 437, react 67 units; ci exit 0; `gate:landing` exit 0 (re-run by
  the orchestrator on the rebased tip). Rulings D-D4b.1–.12 (in the code). Owed: a two-finger pinch in hand, the phone's
  touch pan/zoom, a cancelled `HeldPress` read as a release, the Kawase σ calibration, the held frame's cost (the open
  spread's — D6), and every tool (D3t).
- **D5b — the deletion: the hybrid goes, the desk is the one presentation** (**LANDED 2026-09-26**, `f287e7f` the code —
  676 files, −87,647 lines — and `3eb8209` the docs; a fable builder): design-015 §1's retire table, area by area against
  its estimates — dom's WORLD-SPACE half (2,251 lines: the planes, the source canvas and `layoutsubtree`, the widget
  surfaces, measurement, the dom-widgets/writeback/graybox/plane-transform/chrome reflectors, the adapter's GL route; the
  screen-space half stays — host, pointer adapter, loop, input ownership, focus, cursor and remote cursors — and no DOM
  element carries a camera transform any more), `packages/r3f` whole (`three`, `@react-three/*`, `stats-gl`, the fiber
  patch, electron and truffle leave the workspace — 80 fewer packages resolve), `packages/ground` whole with groundlab
  (nothing carried as code: the desk already had the submit instrument, its marks pass draws the guides and the marquee,
  and the wires' overlay seam waits for the first kind that declares a port), core's surface infra (3,259: `Retained` and a
  slimmed `acquireCompositorDevice` kept) and the widget runtime's VIEW half (`surface`/`component`/`chrome`/`animated`/
  `preview`/`instancePreview`/`sizeMode`/`framePreview` refused at definition; a widget's face is its optional `object`
  binding; the mount store cull-only; every effective size is `Size`), kernel's island helpers, react's profiles/portals/
  previews, devtools' GL panel, and ALL NINE legacy apps (38,801 lines; their exit tests ported by D5a or retired by
  name). `<InfiniteCanvas>` became `<Desk engine layer>` by deletion over `createDeskHost` in dom (the desk typed
  structurally — `LayerFactory`); the umbrella's entries are `.` · `/kernel` · `/dom` · `/desk` · `/desk/engine` ·
  `/desk/objects` · `/react` · `/devtools`, and `@ice/desk`'s workspace exports now MIRROR them (the subpaths fold into the
  root, so M10's SURFACE is the published shape); the walls `no-three`, `desk-dom-free`, desk/engine never imports
  desk/objects, nobody imports desk or devtools; the lockfile's change proven by a control install; the CHANGELOG's 0.14.0
  BREAK LIST (no version bump — the release cut is James's); design-004/005 amended at their sections. Exit: the oracle's
  92 renders SHA-EQUAL before and after (the deletion moved no pixel); every desk rig at main's count (parity 92 · 0 · 3,
  world 79 · 0 · 3, interact 114, open 38, nav 26, two-tab 19, collab 9, ruler 23, panel 13, idle, portal, sticky);
  pack:audit — 278 modules from 8 entries, 0 edges to three; ci exit 0 (kernel 113, core 771, dom 57, react 33, desk 437,
  devtools 10, apps/desk 12 — the retired suites went with their subjects); `gate:landing` exit 0 (re-run by the
  orchestrator). Flagged for James: the committed Lusion gobo plates (study-only licence; absent from the published dist,
  present in the repo as oracle fixtures). Owed: a desk wires pass with the first kind that declares ports; the M3 baseline
  re-measured on the stress rig (D6); a peer's nav frame in presence.
- **D3t-a — the held bar's tools, the whiteboard in hand, the print's owed carry** (**LANDED 2026-09-26**, `78e978d` …
  `eaf5ce6`, seven commits by an opus builder, rebased by the orchestrator over D5b): the held bar's tools are LIVE and
  generic — core's `HeldToolDef` (a `mode` sets the runtime `HeldTool { id, prev }` on the object in hand, an `action` runs
  its op, keys route only while held), declared by the kind and carried by `defineObject`; held input answers a PART and a
  press on the content with a mode in hand is the tool's. `desk.stroke` v2 carries each sample's time with a v1 → v2
  migration — and data children are now version-tracked at all (`defineWidget({ data })`: the catalog stamps, gates and
  migrates them by their own chain; D3w's strokes had never been). The whiteboard in hand: the pen lays LIVE wet ink and
  the lift is ONE stroke entity the ink adopts (no replay), the marker taken up as the board opens and drawn by the board's
  pass in the ink's frame, the eraser and its pen end, inks 1–4, tips, ⌘⌫ wipes, and undo in hand IS the document's. The
  print's owed carry: Esc puts it back, a press catches it mid-glide where it is DRAWN, a carried print paints above its
  siblings, the wheel twists it (`wheelTurns`, `PressWheel`). The tool in hand is marked in cream — *Marks on the Mat*
  retired `--hot` on the desk. Exit: oracle stills of the pen in hand (hovering, wet, dry) Chrome = Node (the ink rows
  within D-D3r-a.5's 1-LSB bound); rig:open 38 → 68, rig:two-tab 19 → 26 (a stroke by hand in A arrives on B's board with
  the same 23 times), rig:interact 114 → 123; 23 red proofs; core 787, desk 460, react 36 units; ci exit 0; `gate:landing`
  exit 0 (re-run by the orchestrator on the rebased tip: parity 95 · 0 · 6 kept, world 82 · 0 · 6 kept). Owed: coalesced
  pointer samples and pen pressure; a cancelled press read as a lift; a peer's stroke mid-draw shifting the live seed;
  tip and wipe without bar slots; wet ink keeps the desk drawing 7.2 s after a stroke (the law's).
- **D3t-b — the notebook in hand** (**LANDED 2026-09-26**, `f3d7c17` … `abd06ff`, seven commits, opus): page strokes are
  DATA — `desk.stroke` v3 adds `page` (sheet i's recto 2i + 1, verso 2i + 2; a v2 stroke migrates to 0), a notebook
  stroke's path in page units with D3t-a's `times`, the prototype's fountain-pen law over the samples; the page raster is
  pure arithmetic (the prototype's Canvas2D stroke re-expressed, so the desk and the Node oracle share it byte for byte)
  and the eight ink layers are a CACHE — LRU over the pages in view, a page replayed when its strokes change, the live
  stroke's final segments drawn once with only the touched rectangle uploaded, the lifted stroke ADOPTED. Writing in hand
  samples the pointer through the same desk eye the risen book is drawn with; the lift is ONE child in one transaction.
  The turns are PARTS (core: a press on a named part is `HeldPress` "part" and never a tap that puts down): a page's
  outer 30 % takes the sheet (drag) or turns it (click), the keys and the bar count turns the hand follows (a run fans),
  the fore-edge corner peeks, a completed turn writes `spread` off the undo stack, a portrait phone turns page by page.
  Found and fixed: an undo in hand left the undone ink on its page (nothing woke the desk for a held book's children);
  two dots on one spot in two pens shared an identity. Exit: three new oracle stills (a written spread, a sheet mid-turn
  carrying its writing, by night) at maxΔ 0 in rig:parity (98 · 0 · 6 kept) and FROM THE WORLD (85 · 0 · 6 kept);
  rig:open 68 → 103, rig:two-tab 26 → 33 (a stroke by hand in A on B's page, a turn in A turns B's copy); 25 red proofs;
  core 788, desk 483 units; ci exit 0; `gate:landing` exit 0 (re-run by the orchestrator). For James: the turn zone is
  the prototype's and the brief's 30 % where design-015 §6's table says 16 %. Owed: the turn zone's cursor (core has no
  part-cursor seam), the two-finger leaf-through, the bar's page numbers, ⌘Z of an out-of-view page not turning to it,
  pen pressure and coalesced samples, the last pen not durable, the eight layers' CPU copies (5.6 MB each).
- **D3t-c — the desk calendar at work** (**LANDED 2026-09-26**, `88ecf68` … `8905845`, seven commits: four by an opus
  builder that died at its context limit in the last step, three by an opus finisher from the frozen WIP; rebased by the
  orchestrator over D3t-b): the calendar's PRINT from its events (the prototype's display list moved whole; the tiles a
  cache keyed by content, so an edit redraws only its cell's tiles); the days at rest and in hand — a click selects a day
  (brackets on the cell), ⇧-click a run, a line written through the ONE editor lands as ONE `desk.event` child (its text and
  seeds one cell; a draft until its session spawns it whole — never empty), a band over a run, a line selected and ⌫;
  THE ROLL by the foot, the corner, the roll, a pull or a flick, the keys and the held bar, `t` for today (the month a
  TARGET moved off the undo stack — a roll is not an edit); notes STUCK to days (one transaction and a glide into the day's
  slot; riders move with the pad by the same delta; veiled while their month is rolled away; unstuck when carried off; a
  pin dies with its note and comes back with it on ⌘Z); where CALENDAR.md leaned the camera in, the pad is picked up.
  Exit: three oracle stills pin the COMMITTED print (a month with entries and a band, mid-roll, a stuck note) — maxΔ 0 in
  rig:parity and FROM THE WORLD, whose new leg holds the LIVE print to the committed bytes (0 of 4.06 M / 4.33 M differ);
  rig:open gains §13 (52 rows — 155 in all), rig:two-tab a line written in A arriving on B's pad with A's seeds (39 in
  all); rig:parity 101 · 0 · 6 kept, rig:world 88 · 0 · 6 kept; found and
  fixed: a blank print pin kept an owner's old entries, and ⇧-click never made a run; core 793, desk 527 units; ci exit 0;
  `gate:landing` exit 0 (re-run by the orchestrator). Rulings D-D3t-c.1–.6. Owed: the committed print follows the local
  time zone (the live-print leg reds elsewhere — pin the zone); D4a's menu clamps over a selected pad's foot at 0.42 (a
  product call); `t`/`p` are tool keys before "just typing" can start a line; a double-click inside a run writes one day.
- **D6 — performance** (**LANDED 2026-09-26**, `2a248fc` … `93eca2c`, five commits: the instruments by a fable builder that
  died at its context limit with steps 2–5 uncommitted, frozen by the orchestrator, finished by a fable finisher): the
  per-entity-work counter and `rig:stress` (1,002 mixed objects) FIRST, with the prototype-form BEFORE table; then PERSISTENT
  RECORDS per design-015 §4.3 (`engine/records.ts`: a slot allocator, change-only writes by object identity, an index-buffer
  draw list re-sorted only on order — the builder REUSES a row unless its facts, flux, look/theme/grid or its slot's zoom (a
  `rezoom` kind) moved); the CULL through the spatial index with hysteresis; the retired ring SPRING removed (it had kept the
  desk live 667 ms after every selection); one RASTER BUDGET (an LRU ledger, 192 MB) over the board inks (evicted to their
  strokes, replayed on return), the notebook's pages and the calendar's tiles; a board's ink wakes only while drawn. Exit
  (medians over 7 rounds, load recorded): a PAN over 1,002 objects queries and sorts 0 of them, visits 211, writes 0.38
  records a frame (the entrants), 1.07 ms JS (was 1.38) and 3.25 ms JS + GPU; a drag of 50 3.14 ms; one raster per edit; the
  pick-up's blur 0.67 ms once and 0 per held frame; idle 0 submits — the counters' gates asserted by `rig:stress` in
  `gate:landing` (a 3-round leg); the oracle's 101 renders SHA-EQUAL to main's own; ci exit 0 (desk 545); `gate:landing` exit 0
  (re-run by the orchestrator). NOT MET, with its numbers: idle main-thread 2.07 ms/s against §11.4's ≤ 0.1 — the kinds'
  POLLED `tick(now)` and the followers run each tick; meeting it needs REGISTERED WAKES (a kind says when it is next live) — a
  design change, owed. Also owed: composites remade every drawn build, `rezoom` on any zoom delta (a quantised band), a
  restless kind remaking its whole kind on an edit, a live eviction → replay witness.
- **D7 — the review and its fix wave** (**LANDED 2026-09-26**, FW-B `73e1454` … `afcdeb2`, FW-C … `f294076`, FW-A `225791b` … `a3b12ae`):
  three read-only reviewers over the whole range (`ff76610^..f7db939`) — the law in code, the renderer and the kinds, the
  surface/docs/tests — returned 36 verified findings (no P0; four P1), and three fix builders closed ALL of them, each fix
  with a test that failed with its hunk reverted. THE LAW (FW-A): every desk writer now asks the version gate's read-only
  verdict before it commits (the writer's gate); a note sticks and unsticks at the LANDING inside the move's own transaction
  (core's new `docs.extendCommits` — one undo step, and Esc keeps the pin); a rolled month waits for the document to speak;
  no tap writes while an object is in hand; `Held` is scoped to the frame; the calendar lease goes through the facade's
  chokepoints; no kind state for a dead pad; the put-down flight picks where it is drawn; no double-tap during a flight;
  stroke seeds stored (`desk.stroke` v4) — and THE KIND-DRIVERS SEAM: a kind DECLARES its drivers in `defineObject`, deskLayer
  wires them generically (a third-party openable kind gets its driver), and `desk-seam-never-imports-a-kind` fires. THE
  RENDERER (FW-B): the held desk copy made once under the default ambient too; the layered passes' state per render target
  (0 allocations per held frame with a second notebook); idle-zero in hand for the board and the pad; a per-kind cap's drop
  counted and said, never silent; ink landings (not drying) refresh the copy; ONE clock seam for the calendar's today and
  time zone (`PRINT_ZONE` pinned; rig:world green under Asia/Tokyo); a "degraded" status on a GPU error; three keep-awakes
  gone. THE SURFACE (FW-C): the published quickstart RUNS (the default palette and the `DESK_ENGINE` preset ship in
  `@vibecook/ice/desk/objects`; core seeds the root canvas type's default tool); a COMMITTED PIXEL GOLDEN
  (`oracle/shas.json`, asserted by the gate; `ORACLE_BLESS=1` re-blesses); the rigs see faults the engine contains
  (`window.__desk.faults`, console errors); M10 held to the umbrella's exports (oracle staging behind `rig.html`); one GPU
  device per engine; dead settings and exports removed and named in the break list; every doc contradiction fixed and
  pinned by `check-docs`; `pack:audit` reading dist/ in eight rows; vacuous units, rig sleeps and lint blind spots fixed.
  Graded by the orchestrator per landing: ci exit 0 and `gate:landing` exit 0 on each tip, the golden 101/101 byte for byte
  across FW-B and FW-A. NOT MET and owed: §11.4's idle main-thread ≤ 0.1 ms/s (2.07–2.56 measured — registered wakes); a
  relation-only reparent leaves `Selected`/`Held` standing; a kind-declared input lease behind the seam's two DOM exceptions.

## M21 — The kit and the pegboard (design-016) — **LANDED (planned 2026-09-26 · K1, K2, K4a, K3, K4b, K6a, K5a, K6b, K5b and K7a LANDED 2026-09-27 · K-H, K8a, K7b, K8b and K9 — the review and its four fix builders — LANDED 2026-09-28; the 0.14.0 release cut, now carrying M20 and M21, is James's)**

*(Numbering note: next free after M20. James's five asks of 2026-09-26 — "we do need the dynamic rulers, do port them from
ground demo"; "do we have proper profiler on webgpu part?"; "how is our multi objects performance? are you utilizing best
practices like instancing to push the overall performance to production grade?"; "in original ICE vision, the engine
itself provide SDKs and all actual widgets are implemented on top of SDKs, so that future vibefield side will further
extend all sorts of new object widgets with plugins"; and a widget tray that is his SDF pegboard
(`research/sdf-pegboard`) sliding up as a bottom drawer, the kinds sitting in it, its pattern scrolling without end. The
design is `draft/design-016-the-kit-and-the-pegboard.md` (five recons over `c949a98`, the laws K-L1…K-L6, the ladder),
the tray's `draft/design-017-the-pegboard-tray.md`, the landing log `draft/design-016-implementation-plan.md` —
local-dev only.)*

The desk becomes an SDK the built-in kinds are only the first users of, and it gets measured on the GPU. The ENGINE had the
ground demo's rulers byte for byte but the product never printed them; ICE read nothing from the GPU; notes, mini mats and
marks were already instanced from persistent records, but prints and boards drew one object per draw, the books redrew
full-canvas MSAA layers every frame, every kind re-uploaded the slot's view block (≈ 36 KB a frame), and memory had no
ceiling for pictures; the world contract was plugin-grade but every kind reached private internals (172 imports) and each
other (57), and the SDK and the built-ins shipped as one. M21 turns the rulers on, builds the GPU profiler (extending
`@ice/devtools`), makes a public render kit and moves the kinds onto it and into their own package, opens the lists a
plugin kind could not join, takes prints/boards/books/zoom/idle to the 10,000-object gates, and adds the pegboard tray —
drawn by the desk, its specimens the kinds' own draws, taking one through core's `insertByDrag`.

- **K1 — the rulers, on** (**LANDED 2026-09-27**, `356377c` … `b46fcd3`): the product mounts `DESK_GRID` (the engine's
  grid with the print on; the engine's default stays off — RULER.md §5); `u` toggles the print through the panel's params
  (key, panel and saved desk agree; `PARAMS_VERSION` 2; the panel applies itself at install); the glyph atlas follows the
  device's ratio and the panel's text size; the panel at the demo's parity. Found and fixed on the way: a ratio-only
  change (another display, the browser's zoom, an emulated ratio) left the desk drawing at the old ratio until a window
  resize — the host now reads the ratio before each step (`startRafLoop(engine, beforeStep?)`). rig:ruler 23 → 37 rows on
  the product as it boots; the owed 1× atlas row paid. RULER.md §8's seven calls stand as built (design-016 §9 C-6).
- **K2 — the GPU profiler** (**LANDED 2026-09-27**, eleven commits → `b2d50cd`, rebased over K1): `timestamp-query` on
  both device paths; `instrumentPasses` (draws/instances by kind, pipelines, bind groups, every labelled pass timed,
  resolved inside the frame's own command buffers, a never-waiting readback ring), the memory ledger, `handle.profiler()`
  (the SPAN as headline, `busy`, p50/p95/max, the quantisation flag, a Perfetto capture), per-kind cost by ablation with an
  A/A control; `@ice/devtools` gains the `gpu` slot (a structural mirror the app's typecheck holds); apps/desk mounts the
  dock on `~`, its code a lazy chunk. `rig:gpu` (17) joins the gate. Measured: a pan-end frame = 51 draws, 29 pipelines,
  52 bind groups (prints cut the note run into 7); 243 MB live (one notebook 164 MB; the calendar kind 42.4 MB with no
  calendar on the desk) — K6/K7's inputs.
- **K3 — the pegboard and the drawer** (**LANDED 2026-09-27**, nine commits → `4d679f5`; the builder died at its
  context limit after its look fixes, an opus finisher rebased it onto the kit): `Tray` in the world, `trayInput`
  beside the hand's, the board shaded in closed form (0.22 ms), the research's HOME lamp through the slots, `a` and the
  lip, `rig:tray` 24, four tray stills (golden 105). Graded: ci 0; gate red once on rig:open's GPU-timing row (2.00 vs
  1.5 ms under load — 0.80/0.84 alone, equal to main interleaved), every other leg green.
- **K4b — the package split** (**LANDED 2026-09-27**, eight commits → `c79031e`, rebased by its builder over K3):
  `@ice/objects` (the six kinds, one folder each, compiled against the desk's public entries only); a kind declares its
  DOM half (`defineObject({ host })`) and the seam's four exceptions are gone; the oracle and the golden in
  `packages/objects/oracle`; per-package shader text; five new walls; pack:audit's ninth question (the desk's built
  entries carry no kind).
- **K6a — residency and instancing** (**LANDED 2026-09-27**, five commits → `e91f5e4`): prints and boards instanced
  from shared arrays (a thumbnail layer always resident, details by screen size in pool slots, all under the ONE raster
  budget, 256 MB); boards at their zoom rung; the books' big textures made on first use. Mixed stress desk: memory
  904 → 351 MB, draws 55 → 42; 20 × 4096² pictures 1,942 → 78.8 MB. Graded: ci 0, gate:landing 0 (stress 31/0).
- **K5a — the specimens on the pegboard** (**LANDED 2026-09-27**, seven commits → `2b583fe`, rebased by its builder
  over K6a): the tray entry a kind declares, the kernel's lattice law, `Specimen` entities under the tray, each drawn by
  its own kind in its own slot on an SDF accessory; a plugin fixture kind appears by its entry alone; rig:tray 34, golden
  106. Graded: ci 0, gate:landing 0.
- **K6b — zoom without a stall** (**LANDED 2026-09-27**, six commits → `d6b8472`, rebased by its builder over K5a): the
  rung law (`ObjectKind.rung`), one frame raster queue (4 ms a turn, nearest first, the old raster standing), board replays
  queued; `zoom-written` worst frame 192.84 → 5.81 ms, 0 frames over 8 ms. Graded: ci 0; gate red once at rig:gpu's A/A
  timing row under load (0.26 vs a 0.084 ms floor) — alone 20/0 twice; every other leg green.
- **K5b — taking one off the pegboard** (**LANDED 2026-09-27**, eight commits → `f161099`, rebased by its builder over
  K6b): the lifted copy, the hand-off to `insertByDrag` at |Δ| 0, one create/selected/undo step, every cancel writes nothing;
  the specimens' faces (`tray.local`) and label tape; the order-dependent tray still attributed (the board's pen materials)
  and fixed. Graded: ci 0; gate red once at rig:stress's K6b boards row (a CDP-round-trip race main has too; K7a fixes it)
  — rig:stress alone 35/0, then 34/1 on K2's A/A timing row; every other leg green.
- **K7a — the books' layers, registered wakes, allocation** (**LANDED 2026-09-27**, eight commits → `83fc760`; its builder
  died at its context limit after five, an opus finisher added the allocation work, the A/B and two rebases): the loop
  SLEEPS at rest (engine 0.000 ms/s — the M20 idle gate met), the books' layers at their box and reused by content, the
  allocation measured truthfully and halved (223 KB/frame — the 64 KiB gate still MISS). Graded: ci 0; gate red at
  rig:interact's laser rows (main fails them identically at load ≥ 190 — 2 of 3 each) and once at rig:open's calendar
  double-click (1 of 5 at load 205; main 2 of 2) — every other leg green.
- **K-H — the gate tells the truth under load** (**LANDED 2026-09-28**, ten commits → `59d055a`): timing rows WARM and
  judged on the minimum over rounds; the A/A paired against its own spread; every Chrome and the relay on their own ports;
  fetch retries; the laser rows paced (their red was a slow drag turning into a long press); one-batch double-clicks; a
  progress watchdog. Three back-to-back gates green at load 55–175; four deliberate regressions red every time; the
  calendar double-click soaked 80/80 on the sleeping loop and before it — no regression. Graded: ci 0, gate:landing 0.
- **K8a — plugin parity, the open seams** (**LANDED 2026-09-28**, fourteen commits → `a2e0028`, rebased over K5b, K7a
  and K-H; a fixer proved a two-tab red a harness race main shares, 2 of 30, and fixed the row): services by typed key, the desk's ONE editor leased through declared text parts, placement and accepts by
  provides-keys, chip finishes, the container's own face law, plugin glyphs, kind-declared menu acts, `pinAsset`.
- **K7b — scale** (**LANDED 2026-09-28**, seven commits → `c31c61e`, rebased by its builder over K-H and K8a): `rig:scale`
  (10k, mixed order, real pictures; its light run in the gate), ONE flat-card pipeline composed from the kinds' own
  `CardMaterial`s (ON by default, D-K7b.2), the far LOD (greeked notes, no rasters below 48 px). Zoom 0.2: draws 674 → 19,
  memory inside its budget; pan JS 2.30 ms and the 10k budget still MISS. Graded: ci 0, gate:landing 0 (sixteen rigs).
- **K8b — the desk clock, a third-party kind in its own package** (**LANDED 2026-09-28**, ten commits → `0742477`,
  rebased by its builder over K7b): `examples/desk-clock` imports only the published entries (a unit + a cruiser rule
  prove it), its own WGSL, a registered wake per second, a tray entry, a menu act, an opening, a chip; mounted in apps/desk;
  the oracle's kind list open (golden 111); `rig:clock` (11) and `dts:check` in the gate. D-K8b.1 records drivers vs
  `defineBehavior`. Graded: ci 0, gate:landing 0 (seventeen rigs).
- **K9 — the review and its fix wave** (**LANDED 2026-09-28**): three read-only lenses over `c949a98..7a7602f` (law ·
  render · surface) — 29 findings, none P0, seven P1 — then four fix builders, each graded and landed in turn: FW-B
  (`6aa5768` — the app's lifetime under StrictMode, rig:lifetime, the theme, device loss, the fail screen, the plugin-wake
  docs), FW-A (`2c138fc` — the desk inert to the pick under the drawer, the app's keys, Tab, the double-tap on the events'
  own times, the tool letters), FW-D (`6a0c66f` — the layer cap, the thumbnail residency, card isolation, the carry, far→near,
  and a board re-asking a raster every frame, found by its own gate), FW-C (the tray: the drop zone as drawn, the wheel
  latch, the scroll clamp, the band, cursors, refused kinds, a room row). `gate:landing` is eighteen rigs + `pack:audit` +
  `dts:check`.

**M21 as landed.** James's five asks, answered: the rulers print on the product's desk (K1); the WebGPU desk has a GPU
profiler in `@ice/devtools` (K2); many objects draw as instanced runs — one flat-card pipeline composed from the kinds'
own materials, residency under one budget, a far LOD, zoom without a stall, a desk that sleeps at rest (K4a, K6a, K6b, K7a,
K7b); the engine is an SDK the six built-ins are only the first users of — the public render kit, `@ice/objects` compiled
against the published entries alone, plugin parity for every seam, and a third-party desk clock in its own package (K4a,
K4b, K8a, K8b); the widget tray is his SDF pegboard — a drawer drawn by the desk, the kinds hanging on it, taken off by a
drag (K3, K5a, K5b). Still MISSED and owed: rig:scale's pan JS ≤ 2 ms and the budget at the full 10,000 (board thumbnails
at scale); a pan's allocation ≤ 64 KiB (223–237 KB/frame); rig:stress's queue-turn row (:832) not yet load-proof; a 10k
rig:scale run under the new rows; a picture that never loads is not marked (D-K9-b.3); a taken print is blank (D-K5b.6);
rig:tray over 60 s on this host; strata's durable ChildOf placement O(n²) (a petition); a Loro wasm `unreachable` on a 5th
re-stage of 3,000 objects. James's calls: the tray key `a`, the desk inert under the drawer, drag-out only, the drawer's
size, the lip; the label tape vs the chips (`TRAY_TAG_STYLE`); the card ON by default (D-K7b.2); a tray clock shows the
shop's 10:10:30 and jumps to live time at the hand-off (D-K8b.4); RULER.md's seven calls as built; and M20's five.

**Exit:** design-016 §6's gates on `rig:stress` and a new `rig:scale` (10,000 objects, mixed order, real pictures) with
the load beside every number; the committed golden byte-identical through every refactor; every built-in kind compiling
against the public entries alone and a third-party kind in its own package on the desk and in the tray; the tray's
witnesses (design-017 §10); ci + `gate:landing` exit 0 on every landing, graded by the orchestrator on the exact SHA.

## M22 — The tray, refined (design-018) — **LANDED 2026-09-28 (R2, then R1 rebased over it, then R3 — the holes' fade — R4 — the header — and R5 — the veil; the 0.14.0 release cut, now carrying M20, M21 and M22, is James's)**

James's visual refine round on M21's pegboard tray (2026-09-28, verbatim in design-018 §0): the border "too thick and
unnatural"; no finger notch — "we should have a dom button that toggles this tray, let's keep things simple"; a "subtle
fade out" where a scroll hard-clipped the specimens; peg holes that feel "on top of the cutting mat"; and category filters
like VibeField's widget tray. Designed in `draft/design-018-the-tray-refined.md`; two builders from `9b0a8fa`, each
graded by the orchestrator on the exact SHA (`pnpm run ci` + `gate:landing`: eighteen rigs, golden 112, pack:audit,
dts:check — all exit 0).

- **R2 — the button and the filters** (**LANDED 2026-09-28**, `e35fb55`): the lip's INPUT retires (`Tray.lip`, `TrayPress`
  `lip`, `TRAY_INPUT`'s lip numbers — a shut drawer takes no press, the bottom centre is the desk's); `Tray.category` ("" all)
  lays only its entries, zeroes the scroll and falls back to all when its last entry goes; `trayCategories` lists what the
  CURRENT frame can hang (D-R2.1); the built-in ids `paper` · `surfaces` · `things`; the desk handle's tray door gains
  `category()`, `categories()`, `anchor()` and a `subscribe()` that fires after a frame that moved what the bar reads, never
  at rest; `<TrayBar>` in `@ice/react` — one pill in the selection menu's ink, at the view's foot shut, riding the drawer's
  top edge open with its chips and a close ×, stepping aside while an object is in hand; its clicks never reach the desk
  (`tapHit` answers no object for an `OverInteractive` pointer, D-R2.8 — the same exposure closed for the menu); the rigs
  that hold the page's pixels to the renderer's hide it through the desk's door (world, nav, portal, sticky, ruler, open,
  and tray's pixel rows). rig:idle: 0 engine steps at rest with the bar showing.
- **R1 — the board** (**LANDED 2026-09-28**, `fef69a2`, rebased over R2 — tray.mjs's lip rows unioned; R2's door test counted the slide on the wall's clock and raced the host's load once R1's shut drawer began its slide a frame later, so the mount got its own frame clock): shut, the drawer
  rests wholly off the view and draws nothing (tray draws in a shut frame 2 → 0); the cream rim, the finger notch and the
  lip's drawing retire — the edge is a 1.5 px arris in the face's own material (D-R1.1) under a faint inner shadow on the
  edges that face the lamp (D-R1.2), the corners 10; the holes SEE THE DESK — premultiplied shadow over the frame as drawn,
  the board lying on the mat (`PEG.thick` 0.10, `gap` 0.03: 0.13 pitch of height, the outline's own lamp push, D-R1.5), the
  plaster retired — so a hole shows the mat's green, its grid and its leaves, or whatever lies under the drawer, in the
  board's shadow (the densest ×0.70 of the dimmed desk, the mat's own leaf ×0.63 by day, D-R1.4); specimens FADE into the
  board over 28 px at the top edge through a feather on the portal chain (`PortalClip.feather`, `clips[i].z`) — every kind
  with no code of its own, the notebook and the calendar at the kit's layered composite (group opacity, D-R1.6), the
  accessories and the tags on the same ramp; the five tray stills re-blessed, the other 107 byte-identical; the drawer's GPU
  cost unchanged (bare 0.240 → 0.234 ms, K-H interleaved).
- **R3 — the holes fade too** (**LANDED 2026-09-28**, `3b9f352`; James on M22 as landed: "the edge fade should also fade the peg
  hole as well"): within the specimens' 28 px band a hole CLOSES into the plain face by their ramp (`tray_board` scales its opening
  by `w`; its fillet flattens by the same share), so the board is whole at the edge; D-R1.7's row peeking under the edge at rest is
  gone with it. rig:tray (e) reads the opening 0.13 · 0.41 · 0.72 · 0.95 at 6 · 12 · 18 · 24 px against the ramp's 0.12 · 0.39 ·
  0.71 · 0.94 (R1's shader: 1.00 throughout); the five tray stills re-blessed again, the other 107 byte-identical.
- **R4 — the header** (**LANDED 2026-09-28**, `72bfd23`, rebased over R3's record; James: "make the fade stronger and more gap,
  and design the filters nicely at that empty safe top space instead"): a CLEAR band `DRAWER.header` 48 px under the edge where no
  specimen, accessory, tag or hole shows, then the content fades in over `DRAWER.fade` 32 (the face clip starts at the band's foot
  with its feather; the tray's `fade` uniform carries (F, H) for the holes and the accessories; the tags' ramp likewise); the lay's
  first line at 2 pitches (kernel `TRAY_SPACING.top` 0.5 → 2), so nothing laid is faded at rest; the pose seam carries `head`, so
  core never picks a specimen hidden under it (D-R4.3). The filters leave the pill for the band as LABEL TAPE — the specimens' own
  tag language (`MARKS.label`), centred, the chosen one cream tape, dimmed by night as the GPU tags are (D-R4.5) — and the pill
  stays the drawer's handle ("Objects" / "× Objects"). rig:tray 72/0: the fade's quarters from the band's foot, the holes' opening
  0 through it then the ramp (0.16 · 0.51 · 0.86 against 0.16 · 0.50 · 0.84), the chips inside the band by their rects, a rest row.
- **R5 — the veil** (**LANDED 2026-09-28**, `185b8c2`; James: "at the edge fading, somehow the holes are displayed on top of
  objects"): R1–R4 faded a specimen by turning it transparent, so the holes behind it showed through it in the ramp. Now nothing fades
  see-through: the specimens, accessories and tags are opaque to the face clip (no feather; `tagFadeOf` retired), and the tray lays a
  VEIL last — the plain board, `tray_drawer`'s own pixel with every hole closed, whole in the header and fading out over its ramp — so
  a specimen and the holes behind it fade into the board together. rig:tray (f): inside the note across the ramp, pixels over a hole
  and over the face one colour a row (worst |Δ| 1.0; R4's feather 33.8); 73/0; rig:gpu counts the drawer's THREE draws (the veil
  one instance); the five tray stills re-blessed again.

**M22 as landed.** The five asks: the border is a board's edge, not a frame; the notch and the lip are gone and a DOM
pill toggles the drawer; content dissolves into the board at the top edge; the holes show the cutting mat under the board
in the board's own shadow (the orchestrator's call over baking the mat's colour — see design-018 §3); the chips filter the
board by category. James's calls, each one line: the hole style (see-through; "baked" not built, D-R1.3); the board's
height (`PEG.gap` / `thick`); the corner radius 10; the fade band 28; the inner shadow (D-R1.2); the bar's word "Objects", its
glyph and the chips' ids. (D-R1.7, the row of holes peeking under the edge at rest, closed with R3.) Owed: the desk's hover still rises under DOM chrome (l1-pick does not read
`OverInteractive`); an accessory's shadow darkens the holes it falls on; rig:tray takes ≈ 137 s; a lamp push configured to
0 would make `normalize(shadow.zw)` NaN.

## M23 — The 0.15.0 asks (petitions I20–I25) — **IN BUILD (I23 LANDED 2026-10-02)**

VibeField's desk migration (track DK, `vibe-field/draft/thinking-desk-migration.md` §8 A4 — the covers DK-15, the thumbnails
DK-4, "Send to…" DK-14) files six asks against the desk for 0.15.0; each is built in a worktree off `main` behind the 0.14.0 cut
and graded on the exact SHA (`pnpm run ci` + `gate:landing`: the Dawn oracle at 113 stills, nineteen rigs, pack:audit, dts:check).
Their status rows live in `docs/downstream-petitions.md`; what each built is here.

- **I23 — the capture door** (**LANDED 2026-10-02**; DK-D25, James: "frozen desk should be still and consume no render time at
  all, do it properly" — the covers take a STILL of the parked desk and blur it once, and this door is where the still comes from):
  `handle.capture({ rect?, scale? }) → Promise<ImageBitmap | undefined>` — the LAST PRESENTED frame (the same camera, theme, marks,
  hand and tray), `rect` in CSS px of the view, `scale` on the view's dpr. The route inside is the petition's lean, measured: a
  ONE-OFF redraw of that frame's inputs — every view in the tree at the scaled dpr (`scaledInputs`) — into a readable still through
  `encodeFrame` (now the one encoding of a frame: the swap chain's, the capture's, the Node oracle's), `copyTextureToBuffer` +
  `mapAsync`, an ImageBitmap from the bytes; the per-frame path gains no copy (the 112 committed stills are byte-identical, and the
  capture's own scene `capture-desk-z1` joins the golden: at 1× the capture's sha IS the frame's, at 0.25× the frame drawn at dpr 0.5
  to the byte, a rect its crop). On the showcase at 1200 × 800 @ 2 with the loop parked: 2400 × 1600 in 30 ms the first time, 28–29
  warm; 600 × 400 (0.25×) in 4 ms, 2.5 warm; 0 engine steps, 0 redraws, one submit, the ledger's `capture` line made and gone
  (rig:capture, the nineteenth rig; the oracle still staged from the world at maxΔ 0 on 3,840,000 px). Not chosen:
  `createImageBitmap(canvas)` on the host's element (nothing promises the displayed bitmap is the frame the world shows, nor what it
  holds while `degraded`) and keeping a copy of every frame (a per-frame cost on an idle-zero desk). Honest `undefined` — never a
  throw — while `failed` or `degraded`, before the first frame, or when the device is lost mid-copy; captures serialize, an equal one
  in flight is shared. Owed, said plainly: a capture of a HELD frame at another scale remakes the hold's desk copy (the hold pass's
  targets refit to the still's size, and the next frame remakes it again — one copy each way; at the view's size the copy stands); the
  marks and the tray are the frame's as drawn (a host hides what it will not show by its own doors before the call); the capture's
  render pass keeps the frame's label (its encoder is `capture`, so the GPU profiler reports it as loose work, never a frame). Found by
  the oracle's quarter check and fixed before landing: the first build scaled the root view alone, and a live inside's lattice drew
  against the frame's dpr.
- **I20 — the hand's reserves and the held bar's travel, host-settable** (**BUILT 2026-10-02**, branch `i20-22-host-options`; DK-12,
  MC-D4 — VibeField's tools in hand under its head): `deskLayer({ hold: { top, band, travelMs } })`, read at the mount, each `HOLD`'s
  when absent. The reserves reach the one reading fit (`readingTarget(…, reserves)`, the builder's `hold`); the travel reaches the bar
  through the anchor (`HeldAnchor.travelMs`, only when set), the bar being the host's (DK-D23) — `<SelectionMenu>` honours it. Decided
  in the build: a phone's ONE-PAGE decision stays on the phone's own numbers — the notebook's kind and its leaf ask
  `readingTarget(…, true).single` themselves, and a host's band would otherwise split their word from the hand's in a short portrait
  window (400 × 480 at band 100); `topPhone`/`marginPhone` untouched, the band shared as it always was. Measured: rig:open §14 — the fit
  116.000 / 100.000, the bar's travel 549.6 ms on the page's clock (two transform runs: the bar measures its width again once its tools
  are in, as it always has).
- **I21 — the pegboard lay's foot inset, host-settable** (**BUILT 2026-10-02**, branch `i20-22-host-options`; DK-13, FC-D3/MC-D7 — the
  pegboard rises behind VibeField's line): `deskLayer({ tray: { foot } })`, read at the mount. Built as the HEADER's mirror, not as a
  lay change (the migration plan's lean had the kernel's lay take it; where things hang does not move — only what shows and how far
  the board scrolls): the face's clip and the tags' scissor end at the foot's line; the veil's second quad, in its one draw (the drawer's
  three draws and their instances hold with the foot on — the unit's witness; rig:gpu runs without), lays the plain board over the foot
  and feathers it over `DRAWER.fade`; the
  range grows by the foot (`scrollRange`, core's clamp); and core's pose seam names it (`TrayScreenFrame.foot`), so a specimen under the
  line is never hovered or taken — R4's rule mirrored (the strip between the foot's line and a host's line would otherwise take a
  hidden specimen). The oracle's new still `tray-foot` holds the foot to its bare board and the rest to its footless twin byte for
  byte; the 113 committed stills are byte-identical; rig:parity and rig:world (from the world, on `rig.html?trayFoot=88`) maxΔ 0.
- **I22 — a kind's word in hand** (**BUILT 2026-10-02**, branch `i20-22-host-options`; DK-12, MC-D9 ruled readouts): `open.readout` —
  a string, or a function of its held tools' read side and its desk state — surfaced as `HeldAnchor.readout`, recomposed with the
  anchor (every frame drawn while held), so a word that follows a motion (a clock's second) moves with its frames and asks no wake of
  its own. Decided in the build: the readout reads the kind's `local` beside what the acts read (the petition named the acts' world,
  entity and props) — a notebook's turn lands in the document a microtask after the frame that starts it, and a word read off the
  document alone published "Page 1" over a turning sheet for a frame (the unit's red); "Page N" counts the reader's turns (‹ ›, "Next
  page"), not the folio of a spread's left page. The notebook and the calendar declare theirs, the example's clock its time; a throw is
  contained at the kind's boundary and said once — I24 owns the rest.

## Release cut & downstream

**0.5.0 = M11 + M12** (guest runtime, `tx.move`, the three standing fixes) — vibe-field
consumes immediately for the fixes alone; the door's W2b adapter can land against it.
**0.7.0 = M14** (SHIPPED 2026-08-16) — the host contract PRC-4b/4c gate on; vibe-field's
pin advances from the 0.6.0 floor and the behaviors adapter proceeds against released
types.
**0.8.0 = M15** (SHIPPED 2026-08-16) — facade presence attach; the ephemeral profile's
engine-side gate for doc-lifecycle-owning hosts. Rode beside strata 0.13.0 (petition
11, publicized guard getter) — independent releases, both published 2026-08-16.
**0.8.1 = the strata pin bump** (CUT 2026-08-16, same day) — strata 0.12.0 → 0.13.0
across all six declaring manifests, the `withdrawFacet` cast retired for the typed
getter, single-copy invariants + full trace suite green. Chore-grade release so
vibe-field's pin advance lands on whole types on both sides.
**0.9.0 = M16** (CUT 2026-08-17, publish pending) — the I19 facet byte claim. Cut by
the vibe-field session at James's ask (CI re-verified green at the cut, pack dry-run
0.9.0/197 files); on publish, vibe-field's consume advances the exact pin to 0.9.0,
adds `maxFacetBytes` to its strict descriptor, imposes the aggregate window budget,
builds the two-engine remote-tombstone witness, then retires
`behavior-store-unsupported`.
**0.11.0 = M17** (SHIPPED 2026-08-25; this row backfilled at the 0.12.0 cut — the S8
coda flagged that skipping it had become precedent) — build-time grid selection
(`GridPassFactory`); magnet is the production grid.
**0.12.0 = M18 + the fix wave** (CUT 2026-08-31, publish pending) — the unified
compositor behind the presentation-profile contract, plus the same-day 15-defect fix
wave (`12730e4..428c457`). The umbrella gains `./r3f/webgpu` at the cut (the S5 leg
had no published subpath — caught by the cut's own export audit). On publish,
vibe-field's exact pin advances 0.11.0 → 0.12.0 (the pin bump MUST read the 0.12.0
CHANGELOG: the `WidgetSurface`→`WidgetSurfaceKind` type break, and preflight's
PIN_EXPECTATIONS row moves with the pin — the 0.10.0 bump missed it and verify was
red for a day); its consumption arc is the `video` kind via `presentLatest()`
(copy-once/LSF-D8, never retain-the-VideoFrame), and the composited profile reaches
it only with the Electron `CanvasDrawElement` flag rails.
**0.13.0 = design-013** (CUT 2026-09-07, publish pending) — surface geometry: the
presentation FACTS in the world behind the behaviours door (Phase A), the ground as the
COMPOSITOR with the old composited leg deleted (Phase B), and the stratified ground moved
onto the same engine with `three` struck from `@ice/ground` (Phase C). This is the FIRST
PUBLISH SINCE 0.11.0 — 0.12.0 was cut (`903f892`) and never published, so one publish
carries both and the CHANGELOG's `[0.13.0]` head says which breaks come from which. The
umbrella gains `./ground/compose`, `./ground/packs` and `./ground/engine` (B8); the pack
grows 259 → 317 files, the growth entirely ground types (31 → 63) plus core's residency
and surface-behaviour tree. The `three` peer STAYS, optional, floor raised
`>=0.160.0` → `>=0.185.0` for `three/webgpu` and C0's `PMREMGenerator` path — it exists
for the GL islands alone now, and `pack:audit` + the `three-only-in-r3f` depcruise rule
are the two witnesses — both of them RUN at C4: the audit on every publish (`prepack`) and
the rule on every `pnpm run ci`, with `tsPreCompilationDeps` on so a type-only `three`
import is an edge the rule can see.

On publish, vibe-field's pin advance is a MIGRATION, not a version edit, and it is FOUR
breaks, not three. (1) `ground()` → `groundField()` — and because the ground is OPAQUE now,
the call must carry a `theme` whose `canvasBg` IS the page's background; with none it takes
the engine's light or dark theme by `prefers-color-scheme` at the mount (D-C4.4), which is
a guess, not the product's colour. (2) `PoleSource` gains `Pole.pointer` for the local
cursor. (3) `localPointerPoles` is screen-space (design-013 §C4 defers it out of Phase C).
(4) **`GridConfig` loses `spacings`, `fadeOut` and `levelWeight`** — which vibe-field
projects into ICE's config today. Verified read-only 2026-09-08: the three keys are declared
on `WorldGridAppearance` (`packages/field-app/src/field/canvas-appearance.ts:20-25`) with the
product's values at `:54-59`, and `canvasGridConfig` spreads `values.worldGrid` into a
`GridConfig` at `:84-92`; they are written and parsed by the appearance document
(`packages/field-app/src/appearance/product-appearance-document.ts:33-38` and `:133-138` —
note the path, `src/appearance/`, not `src/field/appearance/`), edited by Studio's tweak
panel (`design-system/tweaks/VisualTweakControls.tsx:118-190`) and shown by its ground
workbench (`design-system/CanvasGroundWorkbench.tsx:51`), asserted by three tests
(`test/canvas-appearance.test.ts`, `test/visual-tweak-document.test.ts`,
`test/visual-tweak-controls.test.tsx`), and named as the ground projection's numbers in
`DESIGN.md:65-67`. The SPREAD is what makes this the dangerous one: a fresh `GridConfig`
literal is a type error at the pin bump, a spread is a silent drop.

**And the pin lives in THREE places**, which move together or not at all:
`scripts/preflight.mjs:57-61` (the PIN_EXPECTATIONS row — the 0.10.0 bump missed it and
verify was red for a day), `pnpm-workspace.yaml:92` (the override every package resolves
through, since the packages ask for `"*"`), and `pnpm-workspace.yaml:169`
(`minimumReleaseAgeExclude`, or the install refuses a same-day publish). All three verified
present 2026-09-08. Verified too: vibe-field already installs `three` 0.185.1 and
`@react-three/fiber` 9.6.1, so the raised peer floor costs it nothing.

**0.14.0 = M20 + M21 + M22** (CUT 2026-10-02, publish pending) — the desk (design-015: one
WebGPU renderer draws every object under the camera from the world, the DOM in screen space
only, the hybrid deleted whole at D5b), the kit and the pegboard (design-016/017: the public
render kit, the six kinds in `@ice/objects` compiled against the published entries alone,
plugin parity, the third-party desk clock, the pegboard tray) and the tray refined
(design-018). This is the FIRST PUBLISH SINCE 0.11.0 — neither 0.12.0 nor 0.13.0 was
published (npm's `latest` is 0.11.0), so one publish carries three cuts; the CHANGELOG's
`[0.14.0]` head says so, and `[0.13.0]` is re-headed a git release point as `[0.12.0]` was.
The umbrella loses `./r3f`, `./r3f/webgpu` and the four `./ground*` entries and gains
`./desk`, `./desk/engine`, `./desk/objects` and `./desk/kit` — nine entries; the `three` and
`@react-three/fiber` peers and `stats-gl` are struck, and `pack:audit` (nine questions now,
over every entry) fails on any edge to them. The pack goes 317 → 387 files: d.ts 274 → 350
(`@ice/ground`'s 63 and `@ice/r3f`'s 20 out, `@ice/desk`'s 99 and `@ice/objects`' 81 in),
entry bundles 11 → 9, shared chunks 9 → 8. On publish, vibe-field's pin advance is not a
version edit: it is the desk migration, track DK (`vibe-field/draft/thinking-desk-migration.md`).
VibeField REPLACES its integration rather than adapting it — the host mount (`CanvasStage` +
`InfiniteCanvasGround` → `<Desk layer={deskLayer(…)}>` on `DESK_ENGINE`), its widgets re-cut
as object kinds, its plugin door re-cut around `defineObject` — in one cutover on a landing
branch (`desk/landing`), its pre-desk documents dropped rather than converted (DK-D13). The
exact pin still moves in its three places together: `scripts/preflight.mjs:80-84`,
`pnpm-workspace.yaml:92` and `:195` (re-read 2026-10-02 — two of the 0.13.0 row's line numbers
above are stale). Per DK-D12, 0.14.0 is published as it stands and the asks (petitions
I20–I25) follow as 0.15.0, with exact-pinned `0.15.0-desk.N` prereleases on `next` while the
branch consumes them.

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
