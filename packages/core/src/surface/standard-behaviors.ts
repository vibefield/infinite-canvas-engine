/**
 * The three STANDARD surface behaviours — the door, shipped through it
 * (design-013 §0, §5, D6; plan §2 A1b.1).
 *
 * ── Why these are behaviours and not a policy ──────────────────────────────
 * design-013 §0 is the whole reason this file exists: *infra provides
 * mechanisms; kinds choose*. The DOM layer, the GPU layer, residency, band and
 * the demand clamp are mechanisms with invariants; WHEN a card should present
 * on which layer is a per-kind CHOICE, and a choice belongs in userland
 * vocabulary. So the engine ships defaults — through the same `defineBehavior`
 * door any pack uses — rather than laws. A kind that wants something else
 * writes its own behaviour; nothing here is privileged except that the facade
 * registers it (D7) and `defineWidget` attaches one when a definition named
 * none.
 *
 * The one writer of `SurfaceTarget` and `RequestedDemand` on an entity is that
 * entity's kind behaviour (§5's table). Infra reads them; nothing else writes
 * them. The old `PresentationRegistry` + `createPresentationPolicy` pair this
 * replaces was a session-local map beside the world with an app-wired policy
 * on top, which is how the shipping React composited profile ended up with no
 * promotion at all (D7 — `infinite-canvas.tsx` built `domWidgets` without a
 * registry, and only the rigs hand-wired both). There is no wiring to forget
 * now: the facts are world facts and the behaviours are engine-registered.
 *
 * ── The names ──────────────────────────────────────────────────────────────
 * `ice:surface.domAtRest` · `ice:surface.alwaysGpu` · `ice:surface.alwaysDom`,
 * spelled ONCE in `standard-behavior-names.ts` and read from there by both this
 * file and the compiler's attestation, so the two cannot drift. Dots are legal
 * in a behaviour name (`define-behavior.ts`'s NAME_RE), and `ice:` is the
 * engine's own namespace — RESERVED since A3b: `defineEngineBehavior` is the
 * only door into it, and a pack that names itself there is refused.
 *
 * `picture` is NOT a mode (§5): it is `alwaysGpu.with({ paused: true })` — a
 * GPU target whose demand is paused, so the last good picture stays on screen
 * and nothing is uploaded again.
 */
import type { Entity } from "@vibecook/strata-ecs";
import { defineEngineBehavior } from "../behavior/define-behavior";
import type { AnyBehaviorDef, RuntimeBehaviorCtx } from "../behavior/types";
import type { BehaviorRuntime } from "../behavior/runtime";
import { Grab } from "../catalog/gesture";
import { RequestedDemand, SurfaceKind, SurfaceTarget } from "../catalog/surface";
import { FrameInfo } from "../engine/frame-info";
import { devGuardsEnabled } from "../guards/dev";
import { PrefabId } from "../schema/prefab";
import { p } from "../widget/props";
import { toFpsBucket } from "./contract";
import { STANDARD_SURFACE_BEHAVIOR_NAMES } from "./standard-behavior-names";

const [DOM_AT_REST, ALWAYS_GPU, ALWAYS_DOM] = STANDARD_SURFACE_BEHAVIOR_NAMES;

/** The demand fields every standard behaviour carries — a kind's cadence ask. */
const demandSchema = {
  /** Upload cadence ceiling this kind wants while live. Rounded DOWN to a bucket. */
  requestedFps: p.number({ default: 60 }),
  /** Under direct interaction: never throttled below its bucket. */
  interactive: p.boolean({ default: false }),
};

/** The kind's request, projected out of its behaviour data (§5's two components). */
function projectDemand(
  ctx: RuntimeBehaviorCtx<Record<string, unknown>>,
  e: Entity,
  mode: "live" | "paused",
  data: { readonly requestedFps: number; readonly interactive: boolean },
): void {
  ctx.set(e, RequestedDemand, {
    mode,
    fpsBucket: toFpsBucket(data.requestedFps),
    interactive: data.interactive,
  });
}

/** The widget type behind an entity, for a message a developer can act on. */
function typeNameOf(ctx: RuntimeBehaviorCtx<Record<string, unknown>>, e: Entity): string {
  const id = ctx.world.get(e, PrefabId)?.id;
  return typeof id === "string" ? id : `entity ${e}`;
}

/**
 * The entity's surface kind. ABSENT reads as `dom` — a hand-built entity in a
 * rig that carries a behaviour but never went through equip is not a thing to
 * refuse, and `dom` is the permissive answer that leaves it alone.
 */
function kindOf(ctx: RuntimeBehaviorCtx<Record<string, unknown>>, e: Entity): string {
  return ctx.world.get(e, SurfaceKind)?.kind ?? "dom";
}

/**
 * THE D5 REFUSAL, shared by the two behaviours that can only mean `dom`.
 *
 * A `gl` island and a `video` surface ARE GPU textures: they have no live-DOM
 * mode to fall back to, and design-012 plan §2 gives them empty L1 hosts
 * precisely because there is nothing to paint natively. So a behaviour that
 * would write `dom` on one is an authoring error, and in dev it throws naming
 * the widget type — because the alternative is a card that never bands, never
 * allocates and draws plate-only forever with nothing to explain why. Worse
 * for `domAtRest` specifically: the `dom` it writes at DEMOTION trips the Band
 * system's own dev throw a frame later, which names an entity id and no cause.
 *
 * In production it logs and leaves the target alone: `effectiveTarget` coerces
 * every read, so the card presents correctly regardless — production coerces
 * and never blanks.
 *
 * @returns true when the kind was refused and the caller must not write.
 */
function refuseNonDomKind(
  ctx: RuntimeBehaviorCtx<Record<string, unknown>>,
  e: Entity,
  behavior: string,
): boolean {
  const kind = kindOf(ctx, e);
  if (kind === "dom") return false;
  const message = `ice: behavior "${behavior}" is attached to "${typeNameOf(ctx, e)}", whose surface kind is "${kind}" — a "${kind}" surface has no live-DOM mode (design-013 D5). Attach ice:surface.alwaysGpu instead.`;
  if (devGuardsEnabled()) throw new Error(message);
  ctx.log(message);
  return true;
}

// --- ice:surface.domAtRest ---------------------------------------------------

/**
 * Per-generation side tables, keyed by the generation's own AbortSignal.
 *
 * The plan says "module-level Maps keyed by entity, cleared on `ctx.signal`
 * abort", and a bare module-level Map is one engine's worth of state on a
 * PROCESS-GLOBAL definition: two engines in one process (the behaviour
 * harness's `pair()`, a rig beside a product, two mounted canvases) hand out
 * entity handles from two different worlds, and those handles collide. One
 * engine's `owned` set would then answer for the other's cards, and either
 * engine's teardown would clear both. `ctx.signal` is per generation per
 * engine, so keying the tables by it keeps the module-level shape and makes
 * the state actually private. A WeakMap so a disposed generation's tables go
 * with it even if the abort listener never runs.
 */
interface SettleState {
  /** Entities THIS behaviour promoted — it demotes only what it promoted. */
  readonly owned: Set<Entity>;
  /** entity → the `FrameInfo.clock` reading its settle window expires at. */
  readonly settling: Map<Entity, number>;
}
const settleTables = new WeakMap<AbortSignal, SettleState>();

function settleState(ctx: RuntimeBehaviorCtx<Record<string, unknown>>): SettleState {
  const signal = ctx.signal;
  let state = settleTables.get(signal);
  if (state === undefined) {
    state = { owned: new Set<Entity>(), settling: new Map<Entity, number>() };
    settleTables.set(signal, state);
    // `dispose` runs for every instance BEFORE the signal aborts (§4.3), so
    // this only ever clears what a torn-down generation left behind.
    signal.addEventListener(
      "abort",
      () => {
        settleTables.delete(signal);
      },
      { once: true },
    );
  }
  return state;
}

/**
 * THE DOM DEFAULT (design-012 §11 Q5, re-read by design-013 §0 as the standard
 * behaviour the engine ships for dom kinds rather than as a law): live DOM at
 * rest, GPU while grabbed, back one settle window after the release.
 *
 * ── Why demotion is debounced and promotion is not ────────────────────────
 * (Carried verbatim from `dom/src/presentation-policy.ts`, the file this
 * behaviour replaces — the reasoning is measured and did not change with the
 * mechanism.)
 *
 *   Promotion must be INSTANT: it happens on pickup, and the first composited
 *   frame may already lag one paint event (~1.7 ms), which the gesture masks.
 *   Waiting would put that lag in the middle of a drag instead.
 *
 *   Demotion must WAIT. A drop is not the end of motion — inertia is still
 *   settling, and design-004's gesture protocol can re-grab within a frame or
 *   two (a drag that continues after a momentary release, a snap that
 *   retargets). Demoting on the release edge would promote and demote
 *   repeatedly through one user gesture, and every one of those transitions
 *   costs a slot free and a re-copy. One settle window collapses the whole
 *   burst into a single decision.
 *
 *   The window is TIME, not frames: the cost being avoided is
 *   re-rasterisation, which is paid in milliseconds and does not get cheaper
 *   on a fast display.
 *
 * ── What changed with the mechanism ───────────────────────────────────────
 * The window expires on `FrameInfo.clock` — the engine's accumulated CLAMPED
 * dt, design-002 §1 — and not on `performance.now()` as the old policy did.
 * `now` cannot be trusted for HUMAN timing windows: under throttling (occluded
 * window, headless BeginFrame control, software rendering) rAF timestamps lag
 * wall time by 100s of ms to seconds, so a settle measured against them
 * expires at a moment that has nothing to do with what the user saw. `clock`
 * is monotonic and advances by the clamped dt, which is the same clock every
 * gesture window in the engine already uses.
 *
 * The settle rides the `changed` hook, which polls `FrameInfo` — ONCE per
 * behaviour per frame, O(grabbed + settling) — never a per-instance `tick`.
 * A `tick` would be N instances per frame for a decision that concerns the
 * handful of cards under a gesture.
 */
export const domAtRest = defineEngineBehavior(DOM_AT_REST, {
  store: "runtime",
  phase: "present",
  schema: {
    /**
     * How long after the last release before a card demotes, in ms. 250 is
     * long enough to swallow a re-grab and the tail of an inertial settle,
     * short enough that a dropped card is back on the native text path before
     * anyone reaches for it.
     */
    settleMs: p.number({ default: 250, min: 0 }),
    ...demandSchema,
  },
  reads: [Grab, SurfaceKind, PrefabId, FrameInfo],
  writes: [SurfaceTarget, RequestedDemand],
  on: {
    init(e, data, ctx) {
      // The cadence ask is legitimate whatever the kind is, so it lands before
      // the refusal below can stop this hook (`alwaysDom`'s order, same
      // reason).
      projectDemand(ctx, e, "live", data);
      // ATTACHING THIS TO A NON-DOM KIND IS REFUSED (D5, A3b fix 2). It used
      // to be accepted silently — this behaviour declared `SurfaceKind` in its
      // reads and never looked at it — and the card then presented correctly
      // right up to its first drop, when the demotion wrote `dom` on a texture
      // and the Band system's dev throw fired a frame later naming an entity
      // id. Refused here, the message names the widget type instead.
      refuseNonDomKind(ctx, e, DOM_AT_REST);
      // The TARGET is deliberately untouched: equip already stamped the kind's
      // safe default (D2), and writing it again here would make the first
      // frame of every card a promote/demote decision instead of a fact.
    },
    update(e, data, _prev, ctx) {
      projectDemand(ctx, e, "live", data);
    },
    changed(ctx) {
      const state = settleState(ctx);
      const clock = ctx.world.getResource(FrameInfo)?.clock ?? 0;

      // The grabbed INSTANCES — the self term keeps the walk to this
      // behaviour's own cards, and `Grab` carriers are few either way.
      //
      // NON-DOM KINDS ARE FILTERED OUT HERE (D5, A3b fix 2), and this is the
      // only place they need to be: `owned` is populated from this set alone
      // and `settling` from `owned`, so an island that got this behaviour by
      // mistake reaches neither loop below and nothing writes `dom` on it.
      // `init` already refused it loudly in dev; this is the same refusal
      // holding in a production build, where the throw is a log.
      const grabbed = new Set<Entity>();
      ctx.query({ all: [Grab, domAtRest] }).each((e) => {
        if (kindOf(ctx, e) === "dom") grabbed.add(e);
      });

      for (const e of grabbed) {
        // A re-grab inside the window cancels the pending demotion, whether or
        // not this behaviour still owns the card.
        state.settling.delete(e);
        // OWN ONLY WHAT THIS BEHAVIOUR CHANGED (A3b fix 1) — the old policy's
        // rule, restored. There, ownership followed the return of
        // `presentation.set(...)`, which was true only on a REAL change; here
        // the same question is asked of the world. A card a host put on the
        // GPU by hand (the composited rig's static probe does exactly that) is
        // therefore not this behaviour's to bring back, and used to be: one
        // drag was enough to make it `owned`, and 250 ms after the release it
        // was demoted to `dom` for good, with nothing to say why.
        //
        // Reading the target rather than consulting `owned` also keeps the
        // write CHANGE-ONLY: a `ctx.set` per grabbed card per frame would
        // stamp `SurfaceTarget` through the whole drag and wake every observer
        // on it. And a card demoted by hand MID-drag is re-promoted, which is
        // what the old policy did too — the state that decides is the world's,
        // not a memo of what we did last.
        //
        // `SurfaceTarget` is this behaviour's own write target, read back
        // rather than declared in `reads:`: declaring it would put our own
        // writes into our own wake set.
        if (ctx.world.get(e, SurfaceTarget)?.target === "gpu") continue;
        ctx.set(e, SurfaceTarget, { target: "gpu" });
        state.owned.add(e);
      }

      for (const e of state.owned) {
        if (grabbed.has(e) || state.settling.has(e)) continue;
        state.settling.set(e, clock + settleMsOf(ctx, e));
      }

      if (state.settling.size === 0) return;
      for (const [e, due] of state.settling) {
        if (clock < due) continue;
        state.settling.delete(e);
        state.owned.delete(e);
        // A card that despawned mid-settle needs no demotion: its components
        // died with it, and writing one would throw on a dead handle.
        if (ctx.world.isAlive(e)) ctx.set(e, SurfaceTarget, { target: "dom" });
      }
    },
    dispose(e, ctx) {
      const state = settleState(ctx);
      state.owned.delete(e);
      state.settling.delete(e);
    },
  },
});

/**
 * The instance's own `settleMs`, read from its cell rather than cached beside
 * it: the cell is the truth an `update` writes, and a cached copy is one more
 * thing that can disagree with it.
 */
function settleMsOf(ctx: RuntimeBehaviorCtx<Record<string, unknown>>, e: Entity): number {
  const cell = ctx.world.get(e, domAtRest.component);
  const held = cell?.settleMs;
  return typeof held === "number" ? held : (domAtRest.defaults.settleMs as number);
}

// --- ice:surface.alwaysGpu ---------------------------------------------------

/**
 * A kind that presents on the GPU and stays there — the only mode a `gl` or
 * `video` surface HAS, and the right answer for a dom card that must hold true
 * z or a WGSL effect at rest.
 *
 * `alwaysGpu.with({ paused: true })` is the old `picture` mode: the target is
 * still `gpu`, and the demand clamp folds a paused request to a paused
 * effective demand, so the retained picture stays and nothing re-uploads. That
 * is the whole of what `picture` was — §5's "picture is not a mode".
 */
export const alwaysGpu = defineEngineBehavior(ALWAYS_GPU, {
  store: "runtime",
  phase: "present",
  schema: {
    /** Keep the last good picture and upload nothing (the old `picture`). */
    paused: p.boolean({ default: false }),
    ...demandSchema,
  },
  writes: [SurfaceTarget, RequestedDemand],
  on: {
    init(e, data, ctx) {
      writeGpuTarget(e, data, ctx);
    },
    update(e, data, _prev, ctx) {
      writeGpuTarget(e, data, ctx);
    },
  },
});

function writeGpuTarget(
  e: Entity,
  data: { readonly paused: boolean; readonly requestedFps: number; readonly interactive: boolean },
  ctx: RuntimeBehaviorCtx<Record<string, unknown>>,
): void {
  ctx.set(e, SurfaceTarget, { target: "gpu" });
  projectDemand(ctx, e, data.paused ? "paused" : "live", data);
}

// --- ice:surface.alwaysDom ---------------------------------------------------

/**
 * A kind that never leaves the live DOM — the text-heavy card whose caret
 * latency, native selection or internal scroller must survive a drag
 * (design-012 §5's "fidelity, stated": composited text is grayscale-AA and
 * there is no threaded scrolling inside the canvas). It never composites, so
 * it also never gains true z.
 *
 * ATTACHING IT TO A NON-DOM KIND IS REFUSED (D5) — see `refuseNonDomKind`,
 * which `domAtRest` shares: the two behaviours that can write `dom` refuse the
 * same kinds with the same words.
 */
export const alwaysDom = defineEngineBehavior(ALWAYS_DOM, {
  store: "runtime",
  phase: "present",
  schema: { ...demandSchema },
  reads: [SurfaceKind, PrefabId],
  writes: [SurfaceTarget, RequestedDemand],
  on: {
    init(e, data, ctx) {
      // The cadence ask is legitimate whatever the kind is, so it lands before
      // the refusal below can stop this hook.
      projectDemand(ctx, e, "live", data);
      // Refused ⇒ leave the target: equip's default is already the only legal
      // one for that kind.
      if (refuseNonDomKind(ctx, e, ALWAYS_DOM)) return;
      ctx.set(e, SurfaceTarget, { target: "dom" });
    },
    update(e, data, _prev, ctx) {
      projectDemand(ctx, e, "live", data);
    },
  },
});

// --- registration ------------------------------------------------------------

/**
 * The three, in the order a host registers them. `defineWidget` consults this
 * list when deciding whether a definition already chose its own surface
 * behaviour (see `define-widget.ts` — the check is broader than the list, and
 * says why).
 */
export const STANDARD_SURFACE_BEHAVIORS: readonly AnyBehaviorDef[] = [
  domAtRest,
  alwaysGpu,
  alwaysDom,
];

/**
 * Register the engine's standard surface behaviours into a behaviour runtime,
 * BEFORE the app's own (D7): `createCanvasEngine` calls this at runtime
 * creation, so a React composited app DECIDES to promote on drag with no
 * wiring at all. An imperative host that builds its own runtime calls it
 * directly — one line, and a boot that forgets it gets cards that never
 * promote, which the drag witness catches.
 *
 * **ERRATUM 2026-09-06 (A3b):** this comment used to end "…promotes on drag
 * with no wiring at all", which is more than A1b delivered. The DECISION half
 * is world-driven and engine-registered — `SurfaceTarget` flips on the grab in
 * a React app, and every reader sees it. The PIXELS do not move there yet:
 * `infinite-canvas.tsx` builds the DOM reflector with no source canvas, so
 * `placementOf` never answers `canvas` and no host is reparented. The L1 host
 * path for React lands with design-013 B3/B4.
 *
 * Returns ONE remover that unregisters all three.
 */
export function registerStandardSurfaceBehaviors(runtime: BehaviorRuntime): () => void {
  const removers = STANDARD_SURFACE_BEHAVIORS.map((b) => runtime.register(b));
  return () => {
    for (const remove of removers) remove();
  };
}
