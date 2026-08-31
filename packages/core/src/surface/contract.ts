/**
 * The Widget Surface contract's DATA half (design-012 §6, plan §3).
 *
 * Plain types and pure functions, in `core`, so both presentation profiles and
 * every surface kind speak one vocabulary without importing each other. The
 * interface itself is finalised at S8; what S4 needs — and what this file
 * therefore commits to — is `SurfaceDemand`, because demand is what stops
 * self-animating DOM from free-running.
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
