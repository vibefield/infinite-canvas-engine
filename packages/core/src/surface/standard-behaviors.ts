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
import { Active, Culled, MeasuredSize } from "../catalog/camera-derived";
import { Grab } from "../catalog/gesture";
import { Position, Size } from "../catalog/scene";
import { Selected } from "../catalog/selection-presence";
import { ChromeSettings } from "../catalog/settings-resources";
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
  /** Entities THIS behaviour promoted for a GESTURE — it demotes only what it promoted. */
  readonly owned: Set<Entity>;
  /** Of `owned`, the cards whose demand this behaviour PAUSED for the gesture (the stills) — restored at demotion. */
  readonly stills: Set<Entity>;
  /**
   * THE SHIELD (S4, 2026-09-23): the dom cards this behaviour lifted because a SELECTED card's chrome
   * reaches over them (`ChromeSettings.selectionReach`) — live at their own cadence, never stills —
   * and, per card, the clock reading its release expires at once the overlap ends.
   */
  readonly shielded: Set<Entity>;
  readonly shieldRelease: Map<Entity, number>;
  /**
   * THE NEED'S CACHE (review, 2026-09-23): the shield's need as last computed, whether it is stale,
   * and the reach it was computed under. `changed` fires every frame (`FrameInfo` is a polled read)
   * and the need walks every selected and every dom card, so it is computed at most once per change
   * — never once per frame, and never on a frame that does not read it (a held drag).
   */
  lastNeed: ReadonlySet<Entity> | undefined;
  needDirty: boolean;
  lastReach: number;
  /**
   * The `FrameInfo.clock` reading the GESTURE's settle window expires at; `null` while a card is
   * grabbed or nothing is owned. One window for the whole set (2026-09-09): the set was promoted
   * together for one reason, the z-order under a drag, and comes back together.
   */
  settleAt: number | null;
}
const settleTables = new WeakMap<AbortSignal, SettleState>();

function settleState(ctx: RuntimeBehaviorCtx<Record<string, unknown>>): SettleState {
  const signal = ctx.signal;
  let state = settleTables.get(signal);
  if (state === undefined) {
    state = { owned: new Set<Entity>(), stills: new Set<Entity>(), shielded: new Set<Entity>(), shieldRelease: new Map<Entity, number>(), lastNeed: undefined, needDirty: true, lastReach: 0, settleAt: null };
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
 * ── The gesture set (2026-09-09) ──────────────────────────────────────────
 * A grab promotes THE BOARD, not the card: every dom card carrying this
 * behaviour goes to the GPU together, because a lifted card the ground draws
 * would otherwise sit UNDER every resting card the DOM still paints above the
 * canvas (design-012 §6.3's rest-state artifact, which must not appear in the
 * middle of a drag — overlap and stacking would read wrong for the whole
 * gesture). And the set goes as STILLS: each promoted card's demand is paused
 * for the gesture, so it takes one picture at promotion (DomRender's still
 * rule) and holds it, and the drag costs the board no copies at all after the
 * pickup. The grabbed card is a still too: nothing inside it changes while it
 * is carried, and the lift is the ground's. One settle window after the last
 * release the whole set comes back to the live DOM and every card's own
 * cadence ask is restored. `promoteBoard: false` keeps the old one-card
 * promotion; `stillWhileGrabbed: false` keeps a card live at its bucket.
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
    /** A grab promotes every dom card of this behaviour (the gesture set), not only the grabbed one. */
    promoteBoard: p.boolean({ default: true }),
    /** A card this behaviour holds on the GPU for a gesture is a STILL: one picture at promotion, held until the demotion. */
    stillWhileGrabbed: p.boolean({ default: true }),
    ...demandSchema,
  },
  reads: [Grab, SurfaceKind, PrefabId, FrameInfo, Selected, Position, Size, MeasuredSize, ChromeSettings, Active, Culled],
  writes: [SurfaceTarget, RequestedDemand],
  on: {
    init(e, data, ctx) {
      // A card joining the behaviour may already sit under a selected card's plate: the shield's
      // need is recomputed (its cache, review 2026-09-23).
      settleState(ctx).needDirty = true;
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
      // A still keeps its pause through a schema write; the restore at demotion reads the cell.
      if (settleState(ctx).stills.has(e)) return;
      projectDemand(ctx, e, "live", data);
    },
    changed(ctx) {
      const state = settleState(ctx);
      const clock = ctx.world.getResource(FrameInfo)?.clock ?? 0;
      // THE SHIELD'S NEED — the gesture's demotion hands a card the shield still wants straight
      // over, rather than dropping it to the DOM for one frame and lifting it again. LAZY AND
      // CACHED (review, 2026-09-23): this hook fires every frame (`FrameInfo` is a polled read),
      // and the need walks every selected and every dom card, so it used to be paid on every
      // frame of a held drag, where nothing reads it. It is computed only where it is read — the
      // settle's hand-off and the shield phase — and only when something it reads has changed
      // since the last computation: `ctx.changes()` names every journaled entity of this
      // behaviour's reads (a Position/Size/MeasuredSize write, a Selected/Culled/Active flip, a
      // death) and `full` the rebuilds; `init`/`dispose` dirty it for instance churn; the reach
      // is the one input outside the journal, so it is compared by value.
      const ch = ctx.changes();
      const reach = ctx.world.getResource(ChromeSettings)?.selectionReach ?? 0;
      if (ch.full || ch.changed.length > 0 || ch.removed.length > 0 || reach !== state.lastReach) {
        state.needDirty = true;
        state.lastReach = reach;
      }
      const needOf = (): ReadonlySet<Entity> => {
        if (state.needDirty || state.lastNeed === undefined) {
          state.lastNeed = shieldNeed(ctx, reach);
          state.needDirty = false;
        }
        return state.lastNeed;
      };

      // THE GESTURE: ANY grab on the board (S4, 2026-09-23). The ground draws a lifted card beneath
      // every resting host the DOM still paints above the canvas, whatever KIND the lifted card is —
      // an island carried over dom cards rode under them (2026-09-23) because only a grab on one of
      // this behaviour's own cards used to count. So every `Grab` carrier is the trigger; the SET
      // is still this behaviour's dom cards alone.
      //
      // NON-DOM KINDS NEVER ENTER THE SET (D5, A3b fix 2): `owned` is populated from this
      // behaviour's dom cards alone and `settling` from `owned`, so an island that got this
      // behaviour by mistake reaches neither loop below and nothing writes `dom` on it. `init`
      // already refused it loudly in dev; this is the same refusal holding in a production build.
      const grabbed = new Set<Entity>();
      let anyGrab = false;
      let board = false;
      ctx.query({ all: [Grab] }).each((e) => {
        anyGrab = true;
        const cell = cellOf(ctx, e);
        if (cell !== undefined && kindOf(ctx, e) === "dom") {
          grabbed.add(e);
          if (cell.promoteBoard !== false) board = true;
        } else {
          // a grab on a card that is not ours — an island, a video, a card another behaviour
          // owns — lifts the board: it is exactly the card the DOM would otherwise paint over
          board = true;
        }
      });

      if (anyGrab) {
        // A grab inside the window cancels the pending demotion — for the whole set.
        state.settleAt = null;
        // THE GESTURE SET: the grabbed cards, and — unless every grabbed instance opted
        // out — every dom card of this behaviour in the world. Walked while grabbed and
        // written change-only, so a held drag writes nothing after its first frame.
        const set = new Set<Entity>(grabbed);
        if (board) {
          ctx.query({ all: [domAtRest] }).each((e) => {
            if (kindOf(ctx, e) === "dom") set.add(e);
          });
        }
        for (const e of set) {
          // OWN ONLY WHAT THIS BEHAVIOUR CHANGED (A3b fix 1) — the old policy's rule,
          // restored, now for the set: a card a host put on the GPU by hand (the composited
          // rig's static probe) is not this behaviour's to bring back, nor to pause. A card
          // the SHIELD holds is already on the GPU and stays the shield's: live, not a still.
          // Reading the target rather than consulting `owned` keeps the write CHANGE-ONLY: a
          // `ctx.set` per card per frame would stamp `SurfaceTarget` through the whole drag
          // and wake every observer on it. `SurfaceTarget` is this behaviour's own write
          // target, read back rather than declared in `reads:`: declaring it would put our
          // own writes into our own wake set.
          if (ctx.world.get(e, SurfaceTarget)?.target !== "gpu") {
            ctx.set(e, SurfaceTarget, { target: "gpu" });
            state.owned.add(e);
          }
          // THE STILL: one picture at promotion, held for the gesture (DomRender's still
          // rule copies a paused card once when the world names its destination). Only a
          // card this behaviour promoted, only once per gesture, and only if its instance
          // did not opt out. A grabbed card the SHIELD already holds is not a still either
          // (review, 2026-09-23): it was lifted live and is carried live, at its cadence —
          // `owned` never names it, so `stillWhileGrabbed` does not reach it.
          if (state.owned.has(e) && !state.stills.has(e) && cellOf(ctx, e)?.stillWhileGrabbed !== false) {
            const asked = ctx.world.get(e, RequestedDemand);
            ctx.set(e, RequestedDemand, {
              mode: "paused",
              fpsBucket: asked?.fpsBucket ?? 60,
              interactive: asked?.interactive ?? false,
            });
            state.stills.add(e);
          }
        }
        return;
      }

      if (state.owned.size > 0) {
        if (state.settleAt === null) {
          // The window opens at the LAST release, gesture-wide, on the longest settle any
          // owned instance asks for.
          let settle = 0;
          for (const e of state.owned) settle = Math.max(settle, settleMsOf(ctx, e));
          state.settleAt = clock + settle;
        } else if (clock >= state.settleAt) {
          for (const e of state.owned) {
            // A card that despawned mid-settle needs no demotion: its components
            // died with it, and writing one would throw on a dead handle.
            if (!ctx.world.isAlive(e)) continue;
            if (state.stills.has(e)) {
              const cell = cellOf(ctx, e);
              projectDemand(ctx, e, "live", {
                requestedFps: cell?.requestedFps ?? (domAtRest.defaults.requestedFps as number),
                interactive: cell?.interactive ?? (domAtRest.defaults.interactive as boolean),
              });
            }
            // the shield takes over a card it still needs: on the GPU it stays, live
            if (needOf().has(e)) {
              state.shielded.add(e);
              continue;
            }
            ctx.set(e, SurfaceTarget, { target: "dom" });
          }
          state.owned.clear();
          state.stills.clear();
          state.settleAt = null;
        }
        // the shield waits for the gesture to settle: its cards are the gesture's meanwhile
        return;
      }

      // THE SHIELD (S4): a selected card's chrome — the frame the ground draws around it — reaches
      // `selectionReach` past its rect, BENEATH every resting host the DOM paints above the canvas.
      // The dom cards it overlaps go to the GPU, live at their own cadence, while it shows; they come
      // back one settle window after the overlap ends, so clicking around a board does not flap them.
      const need = needOf();
      for (const e of need) {
        state.shieldRelease.delete(e);
        if (state.shielded.has(e)) continue;
        if (ctx.world.get(e, SurfaceTarget)?.target !== "gpu") {
          ctx.set(e, SurfaceTarget, { target: "gpu" });
          state.shielded.add(e);
        }
      }
      for (const e of state.shielded) {
        if (need.has(e)) continue;
        if (!ctx.world.isAlive(e)) {
          state.shielded.delete(e);
          state.shieldRelease.delete(e);
          continue;
        }
        const at = state.shieldRelease.get(e);
        if (at === undefined) {
          state.shieldRelease.set(e, clock + settleMsOf(ctx, e));
          continue;
        }
        if (clock < at) continue;
        state.shieldRelease.delete(e);
        state.shielded.delete(e);
        ctx.set(e, SurfaceTarget, { target: "dom" });
      }
    },
    dispose(e, ctx) {
      const state = settleState(ctx);
      state.owned.delete(e);
      state.stills.delete(e);
      state.shielded.delete(e);
      state.shieldRelease.delete(e);
      state.needDirty = true;
    },
  },
});

/**
 * A card's world rect: its position and, PER AXIS, its measured size when the DOM has one, its
 * declared size otherwise — the rule `systems/chrome.ts` and the retier apply (review, 2026-09-23:
 * this took the measurement only when both axes were measured).
 */
function rectOf(ctx: RuntimeBehaviorCtx<Record<string, unknown>>, e: Entity): { x: number; y: number; w: number; h: number } | undefined {
  const p = ctx.world.get(e, Position);
  if (p === undefined) return undefined;
  const m = ctx.world.get(e, MeasuredSize);
  const s = ctx.world.get(e, Size);
  const w = m !== undefined && m.w > 0 ? m.w : (s?.w ?? 0);
  const h = m !== undefined && m.h > 0 ? m.h : (s?.h ?? 0);
  if (!(w > 0) || !(h > 0)) return undefined;
  return { x: p.x, y: p.y, w, h };
}

/**
 * The codebase's NON-MEMBER signature (the 2026-07-17 field bug; `systems/chrome.ts` and
 * `l3-claim.ts` apply it for the same reason): a widget of ANOTHER nav frame is Culled without
 * Active, and its coordinates are that frame's — frame-local numbers that can overlap this one's.
 * Viewport-culled members are Culled ∧ Active and count; a bare membership-less world (a rig)
 * carries neither tag.
 */
function otherFrame(ctx: RuntimeBehaviorCtx<Record<string, unknown>>, e: Entity): boolean {
  return ctx.world.hasTag(e, Culled) && !ctx.world.hasTag(e, Active);
}

/**
 * TEST-ONLY witness (review, 2026-09-23; deliberately NOT on the barrel, like
 * `__resetBehaviorsForTests`): how many times the shield's need has been computed in this
 * process. A test reads it across a held drag and across a resting selection to pin the cache.
 */
let shieldComputes = 0;
export function __shieldComputesForTests(): number {
  return shieldComputes;
}

/**
 * The dom cards a selected card's chrome reaches over (S4): every SELECTED card's rect grown by
 * `reach` (`ChromeSettings.selectionReach`) on every side, against every dom card of this
 * behaviour that is not itself selected (a selected card sits inside its own chrome, on top of
 * it). Empty when the reach is 0 — a host with no such chrome shields nothing. Cards of ANOTHER
 * nav frame count on neither side (review, 2026-09-23): a selection that rode a nav transition
 * stays Selected inside a folder, and its plate must not lift the folder's own cards whose
 * frame-local rects happen to overlap it — nor the reverse.
 */
function shieldNeed(ctx: RuntimeBehaviorCtx<Record<string, unknown>>, reach: number): Set<Entity> {
  shieldComputes += 1;
  const need = new Set<Entity>();
  if (!(reach > 0)) return need;
  const plates: { x0: number; y0: number; x1: number; y1: number }[] = [];
  ctx.query({ all: [Selected] }).each((s) => {
    if (otherFrame(ctx, s)) return;
    const r = rectOf(ctx, s);
    if (r !== undefined) plates.push({ x0: r.x - reach, y0: r.y - reach, x1: r.x + r.w + reach, y1: r.y + r.h + reach });
  });
  if (plates.length === 0) return need;
  ctx.query({ all: [domAtRest] }).each((d) => {
    if (otherFrame(ctx, d) || kindOf(ctx, d) !== "dom" || ctx.world.hasTag(d, Selected)) return;
    const r = rectOf(ctx, d);
    if (r === undefined) return;
    for (const p of plates) {
      if (r.x < p.x1 && p.x0 < r.x + r.w && r.y < p.y1 && p.y0 < r.y + r.h) {
        need.add(d);
        break;
      }
    }
  });
  return need;
}

/** The instance's cell — the truth an `update` writes; nothing here caches a copy of it. */
interface DomAtRestCell {
  readonly settleMs?: number;
  readonly promoteBoard?: boolean;
  readonly stillWhileGrabbed?: boolean;
  readonly requestedFps?: number;
  readonly interactive?: boolean;
}
function cellOf(ctx: RuntimeBehaviorCtx<Record<string, unknown>>, e: Entity): DomAtRestCell | undefined {
  return ctx.world.get(e, domAtRest.component) as DomAtRestCell | undefined;
}

/**
 * The instance's own `settleMs`, read from its cell rather than cached beside
 * it: the cell is the truth an `update` writes, and a cached copy is one more
 * thing that can disagree with it.
 */
function settleMsOf(ctx: RuntimeBehaviorCtx<Record<string, unknown>>, e: Entity): number {
  const held = cellOf(ctx, e)?.settleMs;
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
