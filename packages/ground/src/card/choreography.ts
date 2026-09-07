// The one place the card frame's motion design lives.
//
// Every window, easing and constant for the reveal, the delete, the lock and
// the two buttons is here, and `resolve()` turns a card's motion state into the
// GEOMETRY to draw this frame — plain floats. The shader never evaluates a
// curve; the CPU hit-test and the tests call this same function, so nothing
// can drift. (Lineage: research/sdf-card/src/motion/choreography.js.)
//
// Units are card units (= world units here). reveal r: 0 idle → 1 selected.
// delete d: 0 → 1 gone.

import { LIFT, SHADOW } from "../theme";
import type { Corner4, FrameStyle } from "./sheet";

/** The §5 shadow recipe and the §7 lift numbers, as `resolve()` reads them — theme.ts's by default, a host's tweak otherwise. */
export interface Material {
  readonly shadow: { readonly rest: { readonly sigma: number; readonly offset: number; readonly alpha: number }; readonly lifted: { readonly sigma: number; readonly offset: number; readonly alpha: number } };
  readonly lift: { readonly scale: number; readonly opacity: number };
}
export const MATERIAL: Material = { shadow: SHADOW, lift: LIFT };

export const REVEAL = {
  thickness: [0.0, 0.5] as const,            // the border grows out of nothing
  cornerLo: [0.14, 0.18, 0.24, 0.16] as const,   // TL TR BR BL, scaled by `stagger`
  cornerHi: [0.55, 0.6, 0.8, 0.57] as const,     // BR runs longest: it reads as a sweep
  closeBtn: [0.52, 0.82] as const,           // out-back pop
  lockBtn: [0.48, 0.78] as const,            // a beat earlier: two arrivals, not one
  ring: [0.0, 0.5] as const,                 // the §7 selection ring arrives with the border
};

export const DELETE = {
  buttons: [0.0, 0.3] as const,      // they were just pressed; they go first
  notches: [0.02, 0.3] as const,     // must be gone before the box gets small
  inner: [0.1, 0.52] as const,       // the card goes solid before it shrinks
  outer: [0.2, 0.74] as const,       // collapses to a disc
  bulge: [0.7, 0.94] as const,
  vanish: [0.84, 1.0] as const,
  bulgeAmt: 0.08,
  dotOfBtn: 0.4,                     // dot radius as a fraction of the button
  shadowMin: 0.3,
};

export const BUTTON = { hoverSwell: 0.07, pressSquash: 0.06, glyphDesignR: 35.2 };

export const win = (r: number, lo: number, hi: number) => Math.min(Math.max((r - lo) / Math.max(hi - lo, 1e-4), 0), 1);
export const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;
export const easeInCubic = (x: number) => x * x * x;
export const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
export const easeOutBack = (x: number) => { const c1 = 1.70158; const c3 = c1 + 1; const u = x - 1; return 1 + c3 * u ** 3 + c1 * u ** 2; };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);

export interface Motion {
  readonly reveal: number;
  readonly del: number;
  readonly grow: number;      // 1: content pinned, chrome blooms outward; 0: outer pinned
  readonly stagger: number;
  readonly hoverC: number;    // close button hover 0..1
  readonly pressC: number;
  readonly hoverK: number;    // lock button hover 0..1
  readonly pressK: number;
  readonly lockOpen: number;  // 0 locked .. 1 open
  readonly lockVel: number;   // squash-and-stretch source
  /**
   * §7 lift, 0 resting → 1 held (grab or armed hold). Drives the §5 shadow
   * recipe (resting → lifted) and the 0.75 hold opacity; `lift` below is the
   * scale the host derived from the same number.
   */
  readonly held: number;
  /**
   * Scale about the centre. 1 at rest — an idle card IS its rect. The study's
   * 0.985→1 reveal scale is retired: lift belongs to the host's lift driver
   * (ChromeSettings.liftScale), the one number the DOM card and the compositor
   * quad already share, and it is fed in here so the frame cannot disagree.
   */
  readonly lift: number;
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
  reveal: 1, del: 0, grow: 1, stagger: 1,
  hoverC: 0, pressC: 0, hoverK: 0, pressK: 0, lockOpen: 0, lockVel: 0, held: 0, lift: 1,
  hot: 0, hotTier: 0, hotAt: [0, 0] as const, hotHalf: [0, 0] as const, hotR: 0,
});

export const IDLE: Motion = Object.freeze({ ...REST, reveal: 0 });

export interface CardRect {
  readonly centre: readonly [number, number];
  /** The CONTENT half extents — the widget's own rect. The chrome grows around it. */
  readonly contentHalf: readonly [number, number];
  /** The content's corner radius; the style's `baseR` when absent. */
  readonly radius?: number;
}

/** Resolved geometry: everything the frame shader reads, all in card units. */
export interface Geometry {
  readonly centre: readonly [number, number];
  readonly half: readonly [number, number];
  readonly outerR: number;
  readonly ih: readonly [number, number];
  readonly baseR: Corner4;
  readonly scale: number;
  readonly nw: Corner4; readonly nh: Corner4; readonly rho: Corner4; readonly rfH: Corner4; readonly rfV: Corner4;
  readonly closeC: readonly [number, number];
  readonly closeR: number; readonly closeGlyphW: number; readonly closeGlyphR: number;
  readonly lockC: readonly [number, number];
  readonly lockR: number; readonly lockGlyphScale: number; readonly lockOpen: number; readonly lockSquash: number;
  readonly hoverC: number; readonly hoverK: number;
  readonly shadowSigma: number; readonly shadowOffset: number; readonly shadowAlpha: number;
  readonly frameAlpha: number;
  /** The §7 sole-selection ring's presence, 0..1. */
  readonly ring: number;
  /** The §7 heat as the record carries it: the source's centre xy (card units), presence, tier — `Motion`'s, clamped. */
  readonly hot: readonly [number, number, number, number];
  /** The source's silhouette: half extents xy, corner radius, 0. */
  readonly src: readonly [number, number, number, number];
}

export function resolve(P: FrameStyle, card: CardRect, m: Motion = REST, mat: Material = MATERIAL): Geometry {
  const r = m.reveal;
  const d = m.del;
  const grow = m.grow;
  const stagger = m.stagger;
  const T = P.thickness;
  // The outer box is the content box grown by the thickness — half extents AND
  // corner radius — and `grow` decides which of the two is pinned mid-reveal.
  const R = card.radius ?? P.baseR[0];
  // The revealed outer radius: the ear's, when the style composes one (its
  // centre is the button's); otherwise concentric with the content.
  const Ro = P.outerR ?? R + T;
  const outerHalf: readonly [number, number] = [card.contentHalf[0] + T, card.contentHalf[1] + T];

  // ---- reveal: the border, the card scale -------------------------------
  const k = easeOutCubic(win(r, ...REVEAL.thickness));
  const t = T * k;
  let scale = m.lift;
  const thick = t * scale;
  let half: [number, number] = [Math.max(outerHalf[0] - (T - t) * grow, 2) * scale, Math.max(outerHalf[1] - (T - t) * grow, 2) * scale];
  // grow = 1: the content is pinned, the outer box grows out of it and its
  // corner turns from the card's own radius to the revealed one as the border
  // arrives. grow = 0: the outer box is pinned at its revealed size and radius.
  let outerR = Math.max(mix(R, Ro, mix(k, 1, 1 - grow)), 0) * scale;
  let ih: [number, number] = [Math.max(half[0] - thick, 1), Math.max(half[1] - thick, 1)];
  // The content's corner is the card's own while the content is pinned;
  // concentric with the pinned outer box otherwise.
  let baseR = Math.max(mix(outerR - thick, R * scale, grow), 0);

  // ---- delete: morph into a dot, then leave ----------------------------
  const kIn = easeInCubic(win(d, ...DELETE.inner));
  const kOut = easeInOutCubic(win(d, ...DELETE.outer));
  const kBul = 1 + DELETE.bulgeAmt * Math.sin(Math.PI * win(d, ...DELETE.bulge));
  const kVan = 1 - easeInCubic(win(d, ...DELETE.vanish));
  if (d > 0) {
    const dr = P.btn.radius * DELETE.dotOfBtn;
    ih = [mix(ih[0], 0.6, kIn), mix(ih[1], 0.6, kIn)];
    baseR = mix(baseR, 0.3, kIn);
    half = [mix(half[0], dr, kOut), mix(half[1], dr, kOut)];
    outerR = mix(outerR, dr, kOut);
    const vanish = kBul * kVan;
    half = [half[0] * vanish, half[1] * vanish]; outerR *= vanish;
    ih = [ih[0] * vanish, ih[1] * vanish]; baseR *= vanish;
    scale *= vanish;
  }

  // ---- corners: staggered bloom, retracted early on delete ---------------
  const retract = 1 - easeOutCubic(win(d, ...DELETE.notches));
  const cs = ([0, 1, 2, 3] as const).map((i) => retract * easeOutCubic(win(r, REVEAL.cornerLo[i] * stagger, REVEAL.cornerHi[i])) * scale) as unknown as Corner4;
  const rc = clamp01(r);
  const corner = (a: Corner4): Corner4 => [a[0] * cs[0], a[1] * cs[1], a[2] * cs[2], a[3] * cs[3]];
  const baseFull = (card.radius === undefined ? P.baseR : [R, R, R, R]) as Corner4;
  const baseRs: Corner4 = ([0, 1, 2, 3] as const).map((i) => mix(baseR, baseFull[i] * scale, rc)) as unknown as Corner4;

  // ---- buttons -----------------------------------------------------------
  const leave = 1 - easeInCubic(win(d, ...DELETE.buttons));
  const pop = (w: readonly [number, number]) => Math.min(Math.max(easeOutBack(win(r, ...w)), 0), 1.4);
  const feel = (hv: number, pr: number) => 1 + BUTTON.hoverSwell * hv - BUTTON.pressSquash * pr;
  const bs = pop(REVEAL.closeBtn) * feel(m.hoverC, m.pressC) * leave;
  const ls = pop(REVEAL.lockBtn) * feel(m.hoverK, m.pressK) * leave;
  const inset: readonly [number, number] = [P.btn.insetX * scale, P.btn.insetY * scale];
  const closeC: [number, number] = [card.centre[0] + half[0] - inset[0], card.centre[1] - half[1] + inset[1]];
  const lockC: [number, number] = [card.centre[0] - half[0] + inset[0], card.centre[1] - half[1] + inset[1]];

  // ---- shadow / alpha: the §5 recipe by LIFT, not by selection ------------
  const held = clamp01(m.held);
  const collapse = mix(1, DELETE.shadowMin, kOut);
  const shadowSigma = mix(mat.shadow.rest.sigma, mat.shadow.lifted.sigma, held) * collapse * scale;
  const shadowOffset = mix(mat.shadow.rest.offset, mat.shadow.lifted.offset, held) * collapse * scale;
  const shadowAlpha = mix(mat.shadow.rest.alpha, mat.shadow.lifted.alpha, held) * kVan;
  const ring = retract * easeOutCubic(win(r, ...REVEAL.ring));

  return {
    centre: card.centre, half, outerR, ih, baseR: baseRs, scale,
    nw: corner(P.nw), nh: corner(P.nh), rho: corner(P.rho), rfH: corner(P.rfH), rfV: corner(P.rfV),
    closeC, closeR: P.btn.radius * bs * scale,
    closeGlyphW: P.btn.glyphW * bs * scale, closeGlyphR: P.btn.glyphR * bs * scale,
    lockC, lockR: P.btn.radius * ls * scale,
    lockGlyphScale: (P.btn.radius * ls * scale) / BUTTON.glyphDesignR,
    lockOpen: m.lockOpen, lockSquash: m.lockVel,
    hoverC: m.hoverC, hoverK: m.hoverK,
    shadowSigma, shadowOffset, shadowAlpha,
    frameAlpha: mix(1, mat.lift.opacity, held),
    ring,
    hot: [m.hotAt[0], m.hotAt[1], clamp01(m.hot), clamp01(m.hotTier)],
    src: [m.hotHalf[0], m.hotHalf[1], m.hotR, 0],
  };
}
