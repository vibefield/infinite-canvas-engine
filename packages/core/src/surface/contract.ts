/**
 * The Widget Surface contract (design-012 §6, plan §3) — FINALISED at S8.
 *
 * Plain types and pure functions, in `core`, so both presentation profiles and
 * every surface kind speak one vocabulary without importing each other. S4 took
 * the half it needed (`SurfaceDemandValue`, because demand is what stops
 * self-animating DOM from free-running); this is the whole of it.
 *
 * ── ERRATA 2026-09-06 (A1a, design-013 D3) — the demand type was `SurfaceDemand`
 * design-013 §5 gives that name to the COMPONENT the Demand system writes, and
 * a value and a type of one name re-exported from two modules collide at
 * `core/index.ts` (the explicit type export shadows the star-exported value, so
 * the component vanishes from the package surface without a compile error). The
 * plain shape is therefore `SurfaceDemandValue` and the component keeps the
 * design's name. `foldDemand`, `toFpsBucket`, `demandIntervalMs` and the two
 * constants are unchanged apart from the type they name — the clamp the Demand
 * system runs is this one, verbatim, not a second implementation.
 *
 * ── WHAT S8 FINALISED, AND WHERE IT DEPARTS FROM PLAN §3 ──────────────────
 * Plan §3 sketched `WidgetSurface` as `{ kind, presentation, setDemand }` and
 * noted that `present()` is profile-internal. Both survive. Two deltas, each
 * recorded here rather than only in the ledger:
 *
 *  1. `demand` is READABLE, not only writable. A surface that can be told its
 *     demand and cannot be asked for it makes every consumer keep a shadow copy
 *     of what it just set — which is how two answers to one question start.
 *  2. The interface is a VIEW built over seams (`createWidgetSurfaceView`)
 *     rather than an object each widget owns. Nothing in either profile has a
 *     per-widget object to hang it on: a composited widget's kind lives in the
 *     widget-type registry, its target in the world, its demand in whatever
 *     the app throttles from. Inventing an owner for them would have meant a
 *     fourth place that can disagree with the other three. The contract is
 *     therefore the QUESTION SET both profiles must be able to answer, and
 *     `dom/widget-surfaces.ts` answers it twice.
 *
 * ── ERRATA 2026-09-06 (A1b, design-013 §5, D5) — the presentation family ───
 * This module used to own `SurfacePresentation` (`live-dom | composited |
 * picture`), the `defineWidget({ presentation })` declaration and its
 * resolver. All of it is DELETED. Where a card presents is now the world's
 * `SurfaceTarget` (`dom | gpu`), written by the entity's kind behaviour and
 * read by every consumer through `effectiveTarget` (`catalog/surface.ts`);
 * `picture` was never a third place for pixels to come from but a paused
 * demand on a GPU target, which `SurfaceDemand` already says. The delta above
 * therefore reads "its target in the world" where it once said "its
 * presentation in the dom layer's registry" — that registry is gone, and with
 * it the class of defect where a map beside the world disagrees with the
 * world.
 *
 * ── Why demand governs DOM at all ─────────────────────────────────────────
 * hic-bench §5 measured the idle paint-event floor by content type, each arm
 * with its own null control:
 *
 *   static board, nothing focused        0 events/s
 *   one focused <input> (caret blinking) 4 events/s
 *   one playing <video>                 60.8 events/s
 *   one CSS-keyframe card              239.9 events/s
 *   paused / blurred (controls)          0 events/s
 *
 * Every rate is 2 events per invalidation tick, and self-animating content
 * raises them BY ITSELF — no `requestPaint` polling anywhere. So a single CSS
 * keyframe card would upload its slot ~240 times a second forever, and a board
 * with a few of them would spend its whole upload budget on animation nobody
 * asked to be re-rasterised at display rate.
 *
 * The doctrine (design-012 §4) is therefore the same one that governs live
 * video: per-surface upload throttling to a demanded bucket, and guidance that
 * continuous animation belongs in WGSL effects rather than CSS keyframes.
 * Note what is NOT claimed: throttling uploads does not stop the paint events.
 * Chromium still raises them; the compositor simply declines to re-copy. The
 * paint cost stays, the GPU bandwidth does not.
 */

import type { Entity } from "@vibecook/strata-ecs";

/**
 * The surface kinds a card's pixels can come from.
 *
 * ── WHERE THIS LIVES, AND WHY IT IS NOT `SurfaceKind` ─────────────────────
 * Moved here at B8 (design-013 §8) from `surface/compositor-registry.ts`, the
 * old composited leg's producer seam, which the deletion took whole. It was
 * always plain surface vocabulary rather than registry machinery, and this
 * file is where the rest of that vocabulary lives.
 *
 * The name keeps its 2026-09-06 erratum: design-013 §5 gives `SurfaceKind` to
 * the COMPONENT that carries a card's kind in the world, and `core/index.ts`
 * re-exports both. A type-only re-export and a star-exported value of one name
 * do not merge there — TypeScript's explicit export SHADOWS the star's, so the
 * component would be silently unreachable from `@ice/core` while the type
 * resolved fine: a build that compiles and a symbol that is gone. The plain
 * union is therefore `SurfaceKindValue`, exactly as the plain demand type is
 * `SurfaceDemandValue`, and for the same reason. The component is the world
 * fact; this is the value shape its `kind` field takes.
 */
export type SurfaceKindValue = "dom" | "gl" | "video";

/**
 * The buckets demand is quantised to. Quantised rather than continuous so a
 * surface cannot creep upward one frame at a time, and so two surfaces asking
 * for "about 30" land on the same cadence instead of beating against it.
 */
export type SurfaceFpsBucket = 0 | 2 | 5 | 10 | 15 | 30 | 60;

export interface SurfaceDemandValue {
  /** `paused` keeps the last good picture and uploads nothing (§6.2). */
  readonly mode: "live" | "paused";
  /** Upload cadence ceiling. 0 means "only when something else forces it". */
  readonly fpsBucket: SurfaceFpsBucket;
  /** Under direct interaction: never throttled below its bucket. */
  readonly interactive: boolean;
}

/** Live at display rate — what a surface gets when nobody has said otherwise. */
export const DEFAULT_SURFACE_DEMAND: SurfaceDemandValue = {
  mode: "live",
  fpsBucket: 60,
  interactive: false,
};

/** A surface that is off-screen, or showing a retained picture. */
export const PAUSED_SURFACE_DEMAND: SurfaceDemandValue = {
  mode: "paused",
  fpsBucket: 0,
  interactive: false,
};

const BUCKETS: readonly SurfaceFpsBucket[] = [0, 2, 5, 10, 15, 30, 60];

/**
 * Round a wanted rate DOWN to a bucket — never up. Asking for 24 fps yields
 * 15, not 30: demand is a ceiling that a surface must justify, and rounding up
 * would let a caller buy a rate it did not ask for.
 */
export function toFpsBucket(fps: number): SurfaceFpsBucket {
  let chosen: SurfaceFpsBucket = 0;
  for (const bucket of BUCKETS) {
    if (bucket <= fps) chosen = bucket;
  }
  return chosen;
}

/**
 * The minimum gap between uploads this demand allows, in ms.
 * `Infinity` when the surface is paused or its bucket is 0 — nothing is owed.
 */
export function demandIntervalMs(demand: SurfaceDemandValue): number {
  if (demand.mode === "paused" || demand.fpsBucket === 0) return Number.POSITIVE_INFINITY;
  return 1000 / demand.fpsBucket;
}

/**
 * Fold a surface's own wish together with what the engine knows about it.
 * Visibility folds to paused AT THE SOURCE (design-012 §4), which is what makes
 * an off-screen animating card genuinely free rather than merely cheap.
 *
 * Interaction wins over a low bucket but never over invisibility: a card being
 * typed into while scrolled off-screen still has no pixels anyone can see.
 */
export function foldDemand(
  wanted: SurfaceDemandValue,
  facts: { readonly visible: boolean; readonly interactive?: boolean },
): SurfaceDemandValue {
  if (!facts.visible) return PAUSED_SURFACE_DEMAND;
  const interactive = facts.interactive === true || wanted.interactive;
  if (interactive && wanted.mode === "live") {
    return { mode: "live", fpsBucket: wanted.fpsBucket === 0 ? 60 : wanted.fpsBucket, interactive: true };
  }
  return { ...wanted, interactive };
}

// --- The surface itself ------------------------------------------------------

/**
 * ONE widget's presentation surface, as both profiles can answer it.
 *
 * The five contracts design-012 §6 names — a presentation source, in-bounds
 * input, canvas-delegation, demand-ish lifecycle, retention — are not five
 * methods here, and deliberately so. Three of them are already law elsewhere
 * and adding a second statement of them would create a second truth:
 *
 *  - in-bounds input is NATIVE at the card level (§11 Q4: every widget has an
 *    L1 host, the platform hit-tests it, and the router narrowed to
 *    within-island 3D raycasts). A `routeInput` here would have no caller.
 *  - canvas-delegation is §6.1's boundary, which is enforced by what the widget
 *    system does NOT hand across it, not by a method.
 *  - retention is the SOURCE's (§6.4): the compositor samples a retained
 *    latest and neither caches nor closes. `video-source.ts` is that seam.
 *
 * What is left is what a caller genuinely has to ask a widget: what kind of
 * pixels it has, where they are coming from right now, and what rate it is
 * being held to.
 */
export interface WidgetSurface {
  /** The kind its pixels come in — the widget type's declared surface. */
  readonly kind: SurfaceKindValue;
  /**
   * Which layer presents it RIGHT NOW — current, never declared (plan §3).
   *
   * As of design-013 A1b this is the world's `SurfaceTarget`, read through
   * `effectiveTarget` so a `gl` or `video` kind can only ever answer `gpu`.
   * The old three-valued `SurfacePresentation` is retired: `live-dom` is
   * `dom`, `composited` is `gpu`, and `picture` was never a mode at all —
   * it is `gpu` with a paused demand, which `demand` below already says.
   */
  readonly target: "dom" | "gpu";
  /** The demand it is under right now. */
  readonly demand: SurfaceDemandValue;
  /** Ask for a different one. What honours it is the profile's business. */
  setDemand(demand: SurfaceDemandValue): void;
}

/** The per-entity lookup. `undefined` = not a widget this view knows. */
export interface WidgetSurfaceView {
  get(entity: Entity): WidgetSurface | undefined;
}

/**
 * The seams a profile must supply to answer the contract. Every one of them is
 * a READ THROUGH, never a captured value: the target changes under the kind
 * behaviour's feet, and a surface object that snapshotted it would be
 * answering about the frame it was made in.
 */
export interface WidgetSurfaceSeams {
  /** The entity's surface kind, or `undefined` if it is not a widget. */
  readonly kindOf: (entity: Entity) => SurfaceKindValue | undefined;
  /** The layer it presents on now — through `effectiveTarget`, never raw. */
  readonly targetOf: (entity: Entity) => "dom" | "gpu";
  readonly demandOf: (entity: Entity) => SurfaceDemandValue;
  /**
   * Where a demand request goes. Optional: a profile with nothing that reads
   * demand must say so by omitting it, and callers then get a surface whose
   * `setDemand` throws rather than one that silently accepts and forgets.
   */
  readonly requestDemand?: (entity: Entity, demand: SurfaceDemandValue) => void;
}

export function createWidgetSurfaceView(seams: WidgetSurfaceSeams): WidgetSurfaceView {
  return {
    get(entity) {
      const kind = seams.kindOf(entity);
      if (kind === undefined) return undefined;
      return {
        kind,
        get target() {
          return seams.targetOf(entity);
        },
        get demand() {
          return seams.demandOf(entity);
        },
        setDemand(demand) {
          const request = seams.requestDemand;
          if (request === undefined) {
            throw new Error(
              `ice: setDemand on entity ${entity} — this profile wired no demand consumer, so accepting it would be a silent no-op.`,
            );
          }
          request(entity, demand);
        },
      };
    },
  };
}
