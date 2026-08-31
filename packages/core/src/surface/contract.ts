/**
 * The Widget Surface contract (design-012 §6, plan §3) — FINALISED at S8.
 *
 * Plain types and pure functions, in `core`, so both presentation profiles and
 * every surface kind speak one vocabulary without importing each other. S4 took
 * the half it needed (`SurfaceDemand`, because demand is what stops
 * self-animating DOM from free-running); this is the whole of it.
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
 *     widget-type registry, its presentation in the dom layer's registry, its
 *     demand in whatever the app throttles from. Inventing an owner for them
 *     would have meant a fourth place that can disagree with the other three.
 *     The contract is therefore the QUESTION SET both profiles must be able to
 *     answer, and `dom/widget-surfaces.ts` answers it twice.
 *
 * ── Why demand governs DOM at all ─────────────────────────────────────────
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
import type { SurfaceKind } from "./compositor-registry";

/** Where a widget's pixels come from right now (design-012 §6.3). */
export type SurfacePresentation = "live-dom" | "composited" | "picture";

/**
 * The buckets demand is quantised to. Quantised rather than continuous so a
 * surface cannot creep upward one frame at a time, and so two surfaces asking
 * for "about 30" land on the same cadence instead of beating against it.
 */
export type SurfaceFpsBucket = 0 | 2 | 5 | 10 | 15 | 30 | 60;

export interface SurfaceDemand {
  /** `paused` keeps the last good picture and uploads nothing (§6.2). */
  readonly mode: "live" | "paused";
  /** Upload cadence ceiling. 0 means "only when something else forces it". */
  readonly fpsBucket: SurfaceFpsBucket;
  /** Under direct interaction: never throttled below its bucket. */
  readonly interactive: boolean;
}

/** Live at display rate — what a surface gets when nobody has said otherwise. */
export const DEFAULT_SURFACE_DEMAND: SurfaceDemand = {
  mode: "live",
  fpsBucket: 60,
  interactive: false,
};

/** A surface that is off-screen, or showing a retained picture. */
export const PAUSED_SURFACE_DEMAND: SurfaceDemand = {
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
export function demandIntervalMs(demand: SurfaceDemand): number {
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
  wanted: SurfaceDemand,
  facts: { readonly visible: boolean; readonly interactive?: boolean },
): SurfaceDemand {
  if (!facts.visible) return PAUSED_SURFACE_DEMAND;
  const interactive = facts.interactive === true || wanted.interactive;
  if (interactive && wanted.mode === "live") {
    return { mode: "live", fpsBucket: wanted.fpsBucket === 0 ? 60 : wanted.fpsBucket, interactive: true };
  }
  return { ...wanted, interactive };
}

// --- Declared presentation policy (design-005 amendment; §6.3 "may pin") -----

/**
 * What a widget TYPE declares about how it wants to present — `defineWidget`'s
 * `presentation` field (design-012 §6.3: "a widget type may pin either mode").
 *
 * `default` moves the STARTING mode; policy may still promote and demote from
 * it. `pin` fixes the mode and takes policy out of the decision entirely — the
 * text-editor card that must keep its native caret through a drag, and the
 * always-composited card that must keep true z at rest, are the two shapes it
 * exists for.
 */
export interface SurfacePresentationDecl {
  readonly default?: SurfacePresentation;
  readonly pin?: SurfacePresentation;
}

/** A declaration resolved against its kind's legal modes; `pin` absent = free. */
export interface ResolvedSurfacePresentation {
  readonly default: SurfacePresentation;
  readonly pin: SurfacePresentation | undefined;
}

/**
 * The Q5 default, by kind. `dom` rests in `live-dom` (native caret, selection
 * and threaded scroll while the user reads and types); every other kind has no
 * live-dom mode at all — a GL island and a live surface ARE GPU textures, and
 * plan §2 gives them empty L1 hosts precisely because there is nothing to paint
 * natively.
 */
export function defaultPresentationFor(kind: SurfaceKind): SurfacePresentation {
  return kind === "dom" ? "live-dom" : "composited";
}

/** Can a surface of this kind present this way at all? See the note above. */
export function presentationIsLegal(kind: SurfaceKind, mode: SurfacePresentation): boolean {
  return kind === "dom" || mode !== "live-dom";
}

/**
 * Why this declaration cannot stand, or `null`. Returns a message rather than
 * throwing so the caller can name the widget type in it — `defineWidget` knows
 * the type, this module does not.
 */
export function surfacePresentationDeclError(
  kind: SurfaceKind,
  decl: SurfacePresentationDecl,
): string | null {
  for (const [field, mode] of [
    ["default", decl.default],
    ["pin", decl.pin],
  ] as const) {
    if (mode !== undefined && !presentationIsLegal(kind, mode)) {
      return `presentation.${field} is "${mode}", which a "${kind}" surface has no mode for`;
    }
  }
  // A pin IS the mode, so a default beside it is either redundant or a
  // contradiction. Both are worth refusing: the redundant one because it reads
  // as an intent policy will honour, and the contradictory one because it is
  // two answers to one question.
  if (decl.pin !== undefined && decl.default !== undefined) {
    return decl.default === decl.pin
      ? `presentation declares pin "${decl.pin}" and the same default — a pin already fixes the mode, so drop the default`
      : `presentation declares pin "${decl.pin}" and default "${decl.default}" — a pin fixes the mode, so the default can never apply`;
  }
  return null;
}

/** Resolve a declaration (possibly absent) into the two facts policy reads. */
export function resolveSurfacePresentation(
  kind: SurfaceKind,
  decl: SurfacePresentationDecl | undefined,
): ResolvedSurfacePresentation {
  const pin = decl?.pin;
  return {
    default: pin ?? decl?.default ?? defaultPresentationFor(kind),
    pin,
  };
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
  readonly kind: SurfaceKind;
  /** CURRENT, never declared (plan §3). In the stratified profile, derived. */
  readonly presentation: SurfacePresentation;
  /** The demand it is under right now. */
  readonly demand: SurfaceDemand;
  /** Ask for a different one. What honours it is the profile's business. */
  setDemand(demand: SurfaceDemand): void;
}

/** The per-entity lookup. `undefined` = not a widget this view knows. */
export interface WidgetSurfaceView {
  get(entity: Entity): WidgetSurface | undefined;
}

/**
 * The seams a profile must supply to answer the contract. Every one of them is
 * a READ THROUGH, never a captured value: presentation changes under the
 * policy's feet, and a surface object that snapshotted it would be answering
 * about the frame it was made in.
 */
export interface WidgetSurfaceSeams {
  /** The entity's surface kind, or `undefined` if it is not a widget. */
  readonly kindOf: (entity: Entity) => SurfaceKind | undefined;
  readonly presentationOf: (entity: Entity) => SurfacePresentation;
  readonly demandOf: (entity: Entity) => SurfaceDemand;
  /**
   * Where a demand request goes. Optional: a profile with nothing that reads
   * demand must say so by omitting it, and callers then get a surface whose
   * `setDemand` throws rather than one that silently accepts and forgets.
   */
  readonly requestDemand?: (entity: Entity, demand: SurfaceDemand) => void;
}

export function createWidgetSurfaceView(seams: WidgetSurfaceSeams): WidgetSurfaceView {
  return {
    get(entity) {
      const kind = seams.kindOf(entity);
      if (kind === undefined) return undefined;
      return {
        kind,
        get presentation() {
          return seams.presentationOf(entity);
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
