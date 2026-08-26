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
