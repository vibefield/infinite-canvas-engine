// The card's GENERIC geometry and motion — what every card program shares
// (design-014, the pack seam). A card program (`program.ts`) turns a card's
// rect and its motion into the record's HEAD: the outer box, the inner box,
// the shadow, the ring, the opacity, the two heat vectors. The engine's own
// program is the SHELL — a rounded plate with a hairline, a soft shadow and a
// selection ring, `resolveShell` below; VibeField's composed corners, buttons
// and choreography are a pack (`packs/vf-frame`) that resolves the same head
// and fills its own tail.
//
// Units are card units (= world units). `Motion` is the engine's springs as
// plain numbers (`motion.ts` runs them): reveal 0 idle → 1 selected; del 0 → 1
// gone (a pack's morph — the shell ignores it, D5); held/lift from `Grab`;
// hover from a hover fact (none in ICE yet: 0); the heat's presence, tier and
// source from the drop pair. Every easing a pack's choreography wants is here
// once, so the shell and a pack cannot drift on a curve.

import { LIFT, SHADOW } from "../theme";

/** The §5 shadow recipe and the §7 lift numbers, as a program reads them — theme.ts's by default, a host's tweak otherwise. */
export interface Material {
  readonly shadow: { readonly rest: { readonly sigma: number; readonly offset: number; readonly alpha: number }; readonly lifted: { readonly sigma: number; readonly offset: number; readonly alpha: number } };
  readonly lift: { readonly scale: number; readonly opacity: number };
}
export const MATERIAL: Material = { shadow: SHADOW, lift: LIFT };

export const win = (r: number, lo: number, hi: number) => Math.min(Math.max((r - lo) / Math.max(hi - lo, 1e-4), 0), 1);
export const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;
export const easeInCubic = (x: number) => x * x * x;
export const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
export const easeOutBack = (x: number) => { const c1 = 1.70158; const c3 = c1 + 1; const u = x - 1; return 1 + c3 * u ** 3 + c1 * u ** 2; };
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);

export interface Motion {
  readonly reveal: number;
  readonly del: number;
  readonly grow: number;      // 1: content pinned, chrome blooms outward; 0: outer pinned
  readonly stagger: number;
  /**
   * §7 lift, 0 resting → 1 held (grab or armed hold). Drives the §5 shadow
   * recipe (resting → lifted) and the 0.75 hold opacity; `lift` below is the
   * scale the host derived from the same number.
   */
  readonly held: number;
  /**
   * Scale about the centre. 1 at rest — an idle card IS its rect. The host's lift
   * driver's number (ChromeSettings.liftScale), fed in here for the SHELL, which
   * scales by it, and so does VibeField's shell (packs/vf-frame), which un-reveals
   * its chrome as the card scales. A pack may lift another way; it cannot disagree
   * with the DOM host either way: the DOM boundary writes the host's transform from
   * the resolved inner box (`ih`), never from a number of its own.
   */
  readonly lift: number;
  /** A hover fact's presence, 0..1 — 0 until ICE has one. The shell ignores it (D6); a pack may not. */
  readonly hover: number;
  /**
   * §7 the overlap HEAT (GLOW.md) — the light a lifted card casts on this one.
   * `hot` is the light's presence 0..1 (a spring on the drop signal), `hotTier`
   * 0 reject … 1 accept, and the SOURCE is the lifted card's silhouette in card
   * units — centre `hotAt`, half extents `hotHalf`, corner radius `hotR` — held
   * on clear so the fade-out has a place.
   */
  readonly hot: number;
  readonly hotTier: number;
  readonly hotAt: readonly [number, number];
  readonly hotHalf: readonly [number, number];
  readonly hotR: number;
}

export const REST: Motion = Object.freeze({
  reveal: 1, del: 0, grow: 1, stagger: 1, held: 0, lift: 1, hover: 0,
  hot: 0, hotTier: 0, hotAt: [0, 0] as const, hotHalf: [0, 0] as const, hotR: 0,
});

export const IDLE: Motion = Object.freeze({ ...REST, reveal: 0 });

export interface CardRect {
  readonly centre: readonly [number, number];
  /** The CONTENT half extents — the widget's own rect. A pack's chrome grows around it. */
  readonly contentHalf: readonly [number, number];
  /** The content's corner radius; the program's default when absent. */
  readonly radius?: number;
}

/**
 * The record's HEAD, resolved: everything the engine's pass reads for every
 * program — the outer silhouette (`half`, `outerR`), the interior (`ih`, the
 * content's corner `radius`), the shadow, the whole-card alpha, the ring, the
 * hover presence, and the heat's two vectors. `scale` is the lift the numbers
 * already carry (a host that needs the DOM transform reads it).
 */
export interface ShellGeometry {
  readonly centre: readonly [number, number];
  readonly half: readonly [number, number];
  readonly outerR: number;
  readonly ih: readonly [number, number];
  readonly radius: number;
  readonly scale: number;
  readonly shadowSigma: number; readonly shadowOffset: number; readonly shadowAlpha: number;
  readonly frameAlpha: number;
  /** The §7 sole-selection ring's presence, 0..1. */
  readonly ring: number;
  readonly hover: number;
  /** The §7 heat as the record carries it: the source's centre xy (card units), presence, tier — `Motion`'s, clamped. */
  readonly hot: readonly [number, number, number, number];
  /** The source's silhouette: half extents xy, corner radius, 0. */
  readonly src: readonly [number, number, number, number];
}

/** The shell's resting corner radius when a card carries none — widgetlab's CardShell radius, the engine's own demo card. */
export const SHELL_RADIUS = 22;

/**
 * The SHELL — the engine's card: the content rect IS the card (no chrome
 * band), rounded at its radius, scaled by the lift, with the §5 shadow by
 * lift, the §7 opacity by lift, and a ring that fades in with the reveal.
 * No delete morph (D5), no hover effect (D6).
 */
export function resolveShell(card: CardRect, m: Motion = REST, mat: Material = MATERIAL): ShellGeometry {
  const scale = m.lift;
  const R = card.radius ?? SHELL_RADIUS;
  const half: readonly [number, number] = [Math.max(card.contentHalf[0], 1) * scale, Math.max(card.contentHalf[1], 1) * scale];
  const radius = Math.max(R, 0) * scale;
  const held = clamp01(m.held);
  return {
    centre: card.centre, half, outerR: radius, ih: half, radius, scale,
    shadowSigma: mix(mat.shadow.rest.sigma, mat.shadow.lifted.sigma, held) * scale,
    shadowOffset: mix(mat.shadow.rest.offset, mat.shadow.lifted.offset, held) * scale,
    shadowAlpha: mix(mat.shadow.rest.alpha, mat.shadow.lifted.alpha, held),
    frameAlpha: mix(1, mat.lift.opacity, held),
    ring: clamp01(m.reveal),
    hover: clamp01(m.hover),
    hot: [m.hotAt[0], m.hotAt[1], clamp01(m.hot), clamp01(m.hotTier)],
    src: [m.hotHalf[0], m.hotHalf[1], m.hotR, 0],
  };
}
