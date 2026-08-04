# Changelog

All notable changes to ICE are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semver](https://semver.org) (pre-1.0: minor versions may break APIs).

## [0.3.0] — 2026-08-04

One feature: **the frame gate** — the frozen-world mode design-005 §4 named as a
separate concept when stage holds landed in July, and deliberately left unbuilt
until something needed it. Full-window chrome (a control-room overlay that
covers the canvas outright) needed it: a stage hold quiets the compositor but
the engine keeps ticking at display rate for pixels nobody can see.

### Added

- **`engine.frame` / `ce.frame` — freeze the engine, not just its rendering.**
  `frame.freeze(name)` takes a refcounted NAMED freeze and returns an
  idempotent thaw, exactly like `stage.background(name)`. While one is held the
  host loop stops calling `step` entirely: no systems, no publish, no notify,
  no reflectors — and no scheduled rAF, because a stopped engine should leave
  the browser nothing queued. `FrameMode.freezeHolds` mirrors the count into
  the world for inspection; `frame.holds()` names the holders.

  **Which one to reach for**: `stage.background` for chrome that RECEDES the
  canvas (a menu panel over a live board — undo, collab and tweens must still
  land visibly behind it); `frame.freeze` for chrome that COVERS it. A freeze
  under a partial overlay will read as broken, because the canvas becomes a
  photograph until thaw. Stage holds are unchanged and did not stretch.

- **The settle protocol** — `frame.settleWhile(name, busy)`. A freeze does not
  park on the spot; it walks the loop until every registered reporter is quiet
  and then takes one further step, so the frozen image is whole rather than
  half-drawn. `<GLViews>` registers pending first-paints and mid-flight lift
  eases; the facade registers the mid-gesture read. Bounded by `SETTLE_CAP`
  (120 frames) with a dev warning naming whoever wedged it: a bad reporter
  makes a freeze park late, never never.

- **`useFrameFreeze(engine, active, name)`** in `@vibecook/ice/react` — the
  `useStageHold` shape, where the effect cleanup is the thaw, so an overlay
  that unmounts or crashes can never wedge the engine parked.

- **`isMidGesture` / `anyGestureNonTerminal`** are exported from core now. The
  predicate autosave used privately to defer a save (so it never captures a
  half-applied interaction) is the same one the settle needs; one definition,
  so the two cannot drift.

### Behavior worth knowing

- A freeze **cancels active gestures** at the transition. A parked loop never
  reaches `JustEnded`, so a gesture frozen mid-flight would hold runtime edits
  that never commit.
- A thaw **drops whatever input queued while parked**. Adapters never stop
  enqueuing; those facts describe a canvas nobody could interact with and carry
  a `tMs` that is now minutes stale. Same posture as the adapter's window-blur
  cancel (design-003 §8).
- **Remote edits keep landing in the document while frozen** — they simply
  reach the WORLD on thaw. Autosave is event-driven end to end
  (`subscribeOutbound` on each sealed local commit, `subscribeRemote` after
  each `applyRemote`, no polling), so a frozen engine cannot lose a document.
- **Widget-owned animation is outside the gate.** A widget's own CSS animation
  or playing media keeps running; the engine freezes engine-driven pixels.
- Resume rides the existing 64 ms `dt` clamp, so an hour parked advances tweens
  by one ordinary frame instead of teleporting them to their end.

### Breaking

- `Engine` gained a required `frame` member. Constructed engines
  (`createEngine` / `createCanvasEngine`) get it for free and hosts need no
  change — `startRafLoop(engine)` keeps its exact signature and reads the gate
  off the engine it was already handed. Only a hand-rolled `Engine`
  implementation would need updating.

## [0.2.0] — 2026-07-25

Everything since 0.1.0 (2026-07-12): 79 commits spanning M8 (node editor,
containers, nested canvas), M9 (presence, bootstrap, migrations), and M10 (ops
catalog, devtools, docs). Documents written by 0.1.0 migrate on open — see
**Breaking** below.

### Breaking

- **Sibling order replaces scalar z — document schema 2.** `ChildOf` is now an
  ORDERED relation: a frame's children ARE its paint/pick order, converging
  collaboratively through strata's movable-list semantics instead of scalar-z
  arithmetic. `ops.reorder(ids, "top" | "bottom")` is unchanged at the surface;
  what went away underneath is `StackZ` arithmetic, `Grab.z` restore, and the
  `topZ()` scans.

  Migration is automatic and needs no application code: the envelope version
  gate reports `migrate`, and the facade runs `runMigrations` at open — one
  `{undoable: false}` transaction that mints the board root and re-links every
  durable widget in `(z asc, entityKey asc)` order. It is absolute, idempotent,
  and convergent (same document → same sequence), so concurrent migrators agree
  and user undo history survives.

  Forward compatibility is graceful, not fatal: the legacy `StackZ` cells are
  deliberately KEPT, so a 0.1.0 build opening a migrated document still opens it
  read-only and still paints in the right order. Live collaboration on an ordered
  document does require every peer on 0.2.0.

- **Peer requirements**: `@vibecook/strata-ecs` 0.11.0 and `loro-crdt` >= 1.13.8.

### Added

- **`@vibecook/ice/ground` — a new entry point.** The P0 stratum collapses to ONE
  WebGPU canvas (three's `WebGPURenderer` + TSL, automatic WebGL2 fallback)
  hosting the dot grid, wires, and snap-guide passes behind a shared pass
  registry. React takes it as an opaque factory — `<InfiniteCanvas ground={ground(...)}>`
  — so the import walls hold; imperative shells register `layer.reflector`.
- **Node editor**: ports materialized on demand, wires as edge entities with
  endpoint cascade, and a connect tool with preview continuity. Culled endpoints
  still draw.
- **Nested canvas + portal-zoom navigation** (design-006 T1): `ops.enterContainer` /
  `exitContainer` fly the camera along a portal-continuous log-zoom path with a
  closed-form spring, `exitTo` composes multi-level portals from current rects, and
  GL islands go cold for the duration of a flight.
- **Widget tray — insert-by-drag**: a draft ghost the drop adopts, deferred spawn,
  and a morphing bottom toolbar.
- **Widget previews**: a `defineWidget` preview contract, `<WidgetPreview>`, and
  runtime GL preview capture through headless islands.
- **`ops.arrange` — desktop-style Clean Up**: a kernel packer with Blueprint-style
  wire-aware layout, dense packing, bystander obstacles, crossing refinement, and
  band-wrapped chains; commits then glides. Free-slot placement on consume.
- **Comment widget**: a UE-Blueprint comment box (`C`) that claims members by
  spatial sweep, stacks under them, and files into folders as a group.
- **Selection chrome v2**: in-card rounded rings, a lift-wrapping union box on the
  P4 DOM plane, SDF rings at the ground stratum, and pooled snap guides.
- **Cursor halo**: a hover-time `OverInteractive` fact driving a ring → dot morph.
- **Per-widget `Opacity`**: one durable cell, reflected on both the DOM and GL planes.
- **`docs.presence()`**: the inspection seam that lets facade apps wire the devtools
  presence panel — swaps with the document lifecycle, never a sync path.
- **`offerBase`**: re-offer a live session's base after a lossy-transport outage —
  peers re-adopt and Loro dedupes, with no teardown, world reset, or UI flash.
- **Bounded incremental autosave journals**: `storage.append` extends a checkpoint
  with the exact outbound Loro update; `put` replaces and compacts. Falls back to a
  full checkpoint when an append is not acknowledged.
- **Devtools rebuilt** on strata's first-party tools: one draggable dock hosting all
  panels, plus a GL metrics panel (renderer census, virtual-texture/LOD/cull).
- **GL frame profiling**: `<GLViews onFrameStats>` with `stats-gl` GPU timing.
- **Electron example** (`apps/widgetlab-desktop`): an IPC room switchboard with an
  optional truffle/tsnet mesh — serverless multi-window and multi-machine collab.

### Performance

Measured 2026-07-15 on an Apple M1 Max against strata 0.7.0; the bench source in
`packages/core/bench/` is the source of truth and `docs/benchmarks.md` records the
full output.

- **Idle frames stopped scaling with the board.** `activeMembership`, `breakpoint`,
  `cull`, and `widgetMount` all became delta-driven behind real `runIf` churn gates
  (strata 0.7.0 `ChangeCollector`), and `spatialSync` is O(delta) with an
  allocation-free sweep. Idle cost at 100k entities fell from **25.1 ms to 872 µs**
  (flat) and **25.6 ms to 890 µs** (nested); nested-10k is 106 µs.
- **Pan frames skip `breakpoint` entirely** — 1 run per 450 frames, against every
  frame before the gate.
- **GL idle-duty package**: animation rate cap, paint-DPR ceiling, backbuffer AA off.

### Fixed

- Three adversarial review sweeps (10, 7, and 18 findings) hardening the doc-join
  lifecycle, GL click pairing, autosave truth, migration atomicity, FBO accounting,
  read-only truth, transport failure paths, and presence reset.
- **The equip-lag Active flash**: fresh container content anchored to the root for one
  frame and was mass-Visible-tagged, leaving zombies mounted forever — 6,440 phantom
  mounts on a 10k seed, plus polluted archetypes that defeated chunk-level tag
  filtering. Membership now answers container-ness from the widget registry during the
  equip-lag window.
- **Gesture windows measure the clamped engine clock**, not wall time — real clicks
  select again under a throttled or headless rAF.
- **GL composite renders in the engine flush** (reflect-phase advance) — pan no longer
  lags the DOM planes; the advance clock is seconds, and stagger-deferred islands bank
  their `dt`.
- Nav-tick zombies and cross-frame scope leaks (folder ghosts); nav ops own a
  synchronous visibility cut, so no squeezed-scene flash.
- Test rigs that claimed to arm strata's write enforcement but observed nothing — an
  observe-less reflector never arms it, so the assertions were inert.

### Docs

- `docs/benchmarks.md` — per-milestone measured baselines, including the numbers that
  came out badly.
- `docs/strata-petitions.md` + `docs/petitions/` — eight upstream petitions, all landed
  (strata 0.3.0–0.9.0), each recording the engine migration that retired its workaround.
- `docs/api-reference.md` — the curated published surface.

## [0.1.0] — 2026-07-12

First publish: kernel math, the frame contract, the L0–L4 interaction stack, durable
documents with per-gesture undo, the DOM widget runtime, GL islands, and the
`createCanvasEngine` facade.
