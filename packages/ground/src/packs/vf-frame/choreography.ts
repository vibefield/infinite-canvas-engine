// The one place VibeField's card frame motion design lives — the `vf-frame`
// pack's choreography (design-014; the SHELL since 2026-09-23).
//
// THE SHELL. Around the content: a well in the card's own surface, its corners
// notched into bays for the controls, and a rim of solid chrome — the plate.
// The content is never cut. SELECTION reveals the shell outward from the
// content's edge: the well and the rim grow out of it, the bays bloom into the
// well's corners (staggered), the buttons pop. THE LIFT UN-REVEALS IT: as the
// card scales up (the host's lift scale, `Motion.lift`), the shell shrinks back
// into the card's edge — the buttons first (gone over the first eighth, before
// the rim has shrunk under them), then the bays, then the well and the rim — so
// at the end of the lift the shell's outer edge IS the lifted card's silhouette
// and nothing shows while the card moves. A release plays it
// forward again; a grabbed card that was not selected simply scales.
//
// Every window, easing and constant for the reveal, the lift, the delete, the
// lock and the two buttons is here, and `resolve()` turns a card's motion
// state into the GEOMETRY to draw this frame — the engine's HEAD (geometry.ts
// `ShellGeometry`: the plate's silhouette, the content's box) plus this pack's
// well, corner and button numbers, plain floats. The shader never evaluates a
// curve; the CPU hit-test (sdf.ts) and the tests call this same function, so
// nothing can drift. (Lineage: research/sdf-card/src/motion/choreography.js;
// the engine's card/choreography.ts before design-014; the notched content
// before the shell.)
//
// Units are card units (= world units here). reveal r: 0 idle → 1 selected.
// held h: 0 resting → 1 lifted. delete d: 0 → 1 gone.

import { clamp01, easeInCubic, easeInOutCubic, easeOutBack, easeOutCubic, MATERIAL, type Material, mix, type Motion, REST, type ShellGeometry, win } from "../../card/geometry";
import { type Corner4, cornersOf, type FrameStyle } from "./sheet";

export type { CardRect, Material, Motion } from "../../card/geometry";
export { MATERIAL, REST, IDLE, win, easeOutCubic, easeInCubic, easeInOutCubic, easeOutBack } from "../../card/geometry";

export const REVEAL = {
  thickness: [0.0, 0.5] as const,            // the well and the rim grow out of the content's edge
  cornerLo: [0.14, 0.18, 0.24, 0.16] as const,   // the bays, TL TR BR BL, scaled by `stagger`
  cornerHi: [0.55, 0.6, 0.8, 0.57] as const,     // BR runs longest: it reads as a sweep
  closeBtn: [0.52, 0.82] as const,           // out-back pop
  lockBtn: [0.48, 0.78] as const,            // a beat earlier: two arrivals, not one
  ring: [0.0, 0.5] as const,                 // the §7 selection ring arrives with the rim
};

/** The lift's own windows over `held`: the un-reveal, in the order things leave. */
export const LIFT = {
  // Gone over the first eighth of the lift, easing OUT: the rim shrinks with an ease-out too, and a
  // button that lingered (an ease-in over [0, 0.35], before the review of 2026-09-23) rode the
  // shrinking rim over the content for two frames per grab — 8.7 px over it at h 0.2, its centre
  // inside it at h 0.3, and `pick` still answered "close" there. With this window the close
  // button's disc clears the content by 17.7 px at its nearest over the whole lift.
  buttons: [0.0, 0.12] as const,     // unpressable mid-drag: they go first
  bays: [0.0, 0.6] as const,         // the notches close
  shell: [0.0, 1.0] as const,        // the well and the rim shrink back into the card's edge
};

export const DELETE = {
  buttons: [0.0, 0.3] as const,      // they were just pressed; they go first
  bays: [0.02, 0.3] as const,        // must be gone before the box gets small
  inner: [0.1, 0.52] as const,       // the card goes solid before it shrinks
  outer: [0.2, 0.74] as const,       // collapses to a disc
  bulge: [0.7, 0.94] as const,
  vanish: [0.84, 1.0] as const,
  bulgeAmt: 0.08,
  dotOfBtn: 0.4,                     // dot radius as a fraction of the button
  shadowMin: 0.3,
};

export const BUTTON = { hoverSwell: 0.07, pressSquash: 0.06, glyphDesignR: 35.2 };

/** The engine's motion plus this pack's own springs: the two buttons' hover and press, the lock's state. */
export interface VfMotion extends Motion {
  readonly hoverC: number;    // close button hover 0..1
  readonly pressC: number;
  readonly hoverK: number;    // lock button hover 0..1
  readonly pressK: number;
  readonly lockOpen: number;  // 0 locked .. 1 open
  readonly lockVel: number;   // squash-and-stretch source
}

export const VF_REST: VfMotion = Object.freeze({ ...REST, hoverC: 0, pressC: 0, hoverK: 0, pressK: 0, lockOpen: 0, lockVel: 0 });
export const VF_IDLE: VfMotion = Object.freeze({ ...VF_REST, reveal: 0 });

/** Resolved geometry: the engine's head, and everything this pack's shader reads from its tail, all in card units. */
export interface VfGeometry extends ShellGeometry {
  /** The shell's presence this frame: 1 revealed at rest, 0 idle or lifted. */
  readonly shell: number;
  /** The well: its half extents and its own corner radius (the bays cut into it). */
  readonly wellHalf: readonly [number, number];
  readonly wellR: number;
  /** The bays, TL TR BR BL: the notch's width and height, its concave radius, its fillet — 0 = no bay. */
  readonly nw: Corner4; readonly nh: Corner4; readonly rho: Corner4; readonly rf: Corner4;
  readonly closeC: readonly [number, number];
  readonly closeR: number; readonly closeGlyphW: number; readonly closeGlyphR: number;
  readonly lockC: readonly [number, number];
  readonly lockR: number; readonly lockGlyphScale: number; readonly lockOpen: number; readonly lockSquash: number;
  readonly hoverC: number; readonly hoverK: number;
}
/** The pack's geometry under the name the tests, the oracle and the lab have always used. */
export type Geometry = VfGeometry;

export function resolve(P: FrameStyle, card: { readonly centre: readonly [number, number]; readonly contentHalf: readonly [number, number]; readonly radius?: number }, m: VfMotion = VF_REST, mat: Material = MATERIAL): VfGeometry {
  const r = m.reveal;
  const d = m.del;
  const h = clamp01(m.held);
  const lift = m.lift;
  const stagger = m.stagger;
  const R = card.radius ?? P.radius;
  const [cx, cy] = card.centre;
  const hx = Math.max(card.contentHalf[0], 1);
  const hy = Math.max(card.contentHalf[1], 1);
  const { ear, bay, notch } = cornersOf(P);
  const on = P.control > 0 ? 1 : 0;

  // ---- the content: the card itself, scaled by the lift ------------------
  let ih: [number, number] = [hx * lift, hy * lift];
  let radius = Math.max(R * lift, 0);

  // ---- the shell: revealed by selection, UN-REVEALED by the lift ----------
  const k = easeOutCubic(win(r, ...REVEAL.thickness));
  const shell = k * (1 - easeOutCubic(win(h, ...LIFT.shell)));
  const M = (P.well + P.band) * shell;
  let half: [number, number] = [ih[0] + M, ih[1] + M];
  // the plate's corner: the content's own while the shell is in, the ear's (centred on the control) revealed;
  // concentric with the well when there is no control to centre on
  const Ro = on ? ear : R + P.well + P.band;
  let outerR = Math.max(mix(radius, Ro, shell), 0);
  const wm = P.well * shell;
  let wellHalf: [number, number] = [ih[0] + wm, ih[1] + wm];
  let wellR = Math.max(radius + wm, 0);

  // ---- delete: morph into a dot, then leave ----------------------------
  const kIn = easeInCubic(win(d, ...DELETE.inner));
  const kOut = easeInOutCubic(win(d, ...DELETE.outer));
  const kBul = 1 + DELETE.bulgeAmt * Math.sin(Math.PI * win(d, ...DELETE.bulge));
  const kVan = 1 - easeInCubic(win(d, ...DELETE.vanish));
  if (d > 0) {
    const dr = Math.max(P.btn.radius, 4) * DELETE.dotOfBtn;
    ih = [mix(ih[0], 0.6, kIn), mix(ih[1], 0.6, kIn)];
    radius = mix(radius, 0.3, kIn);
    half = [mix(half[0], dr, kOut), mix(half[1], dr, kOut)];
    outerR = mix(outerR, dr, kOut);
    // the well closes to nothing as the plate collapses, so the dot the card leaves wears the
    // CHROME (the reference's dot) — a well that followed the plate left a dot in the card's own
    // surface, five levels over the dark ground (review, 2026-09-23)
    wellHalf = [mix(wellHalf[0], 0, kOut), mix(wellHalf[1], 0, kOut)];
    wellR = mix(wellR, 0, kOut);
    const vanish = kBul * kVan;
    half = [half[0] * vanish, half[1] * vanish]; outerR *= vanish;
    wellHalf = [wellHalf[0] * vanish, wellHalf[1] * vanish]; wellR *= vanish;
    ih = [ih[0] * vanish, ih[1] * vanish]; radius *= vanish;
  }

  // ---- the bays: staggered bloom into the well's corners; closed by the lift and the delete ----
  const retract = 1 - easeOutCubic(win(d, ...DELETE.bays));
  const closed = 1 - easeOutCubic(win(h, ...LIFT.bays));
  const bloomAt = (lo: number, hi: number) => on * retract * closed * easeOutCubic(win(r, lo * stagger, hi));
  const cs: Corner4 = [
    bloomAt(REVEAL.cornerLo[0], REVEAL.cornerHi[0]), bloomAt(REVEAL.cornerLo[1], REVEAL.cornerHi[1]),
    bloomAt(REVEAL.cornerLo[2], REVEAL.cornerHi[2]), bloomAt(REVEAL.cornerLo[3], REVEAL.cornerHi[3]),
  ];
  const scaled = (v: number): Corner4 => [v * cs[0], v * cs[1], v * cs[2], v * cs[3]];
  const nw = scaled(notch);
  const nh = scaled(notch);
  const rho = scaled(bay);
  const rf = scaled(P.fillet);

  // ---- buttons: inset `ear` from the plate's outer corners — the lock TL, the close TR ----
  const leave = 1 - easeInCubic(win(d, ...DELETE.buttons));
  const gone = 1 - easeOutCubic(win(h, ...LIFT.buttons));   // out, like the rim they sit on (review, 2026-09-23)
  // a window not yet open pops EXACTLY 0 (easeOutBack(0) is 1e-15 in floating point): a card at rest resolves as its still does
  const pop = (w: readonly [number, number]) => { const x = win(r, ...w); return x <= 0 ? 0 : Math.min(Math.max(easeOutBack(x), 0), 1.4); };
  const feel = (hv: number, pr: number) => 1 + BUTTON.hoverSwell * hv - BUTTON.pressSquash * pr;
  const bs = on * pop(REVEAL.closeBtn) * feel(m.hoverC, m.pressC) * leave * gone;
  const ls = on * pop(REVEAL.lockBtn) * feel(m.hoverK, m.pressK) * leave * gone;
  const rb = P.btn.radius;
  const closeC: [number, number] = [cx + half[0] - ear, cy - half[1] + ear];
  const lockC: [number, number] = [cx - half[0] + ear, cy - half[1] + ear];

  // ---- shadow / alpha: the §5 recipe by LIFT, not by selection ------------
  const collapse = mix(1, DELETE.shadowMin, kOut);
  const shadowSigma = mix(mat.shadow.rest.sigma, mat.shadow.lifted.sigma, h) * collapse * lift;
  const shadowOffset = mix(mat.shadow.rest.offset, mat.shadow.lifted.offset, h) * collapse * lift;
  const shadowAlpha = mix(mat.shadow.rest.alpha, mat.shadow.lifted.alpha, h) * kVan;
  // the §7 ring rides the plate's outer edge and leaves with the shell — a moving card is calm
  const ring = retract * easeOutCubic(win(r, ...REVEAL.ring)) * (1 - h);

  return {
    centre: card.centre, half, outerR, ih, radius, scale: lift, shell,
    wellHalf, wellR, nw, nh, rho, rf,
    closeC, closeR: rb * bs,
    closeGlyphW: P.btn.glyphW * bs, closeGlyphR: P.btn.glyphR * bs,
    lockC, lockR: rb * ls,
    lockGlyphScale: (rb * ls) / BUTTON.glyphDesignR,
    lockOpen: m.lockOpen, lockSquash: m.lockVel,
    hoverC: m.hoverC, hoverK: m.hoverK,
    shadowSigma, shadowOffset, shadowAlpha,
    frameAlpha: mix(1, mat.lift.opacity, h),
    ring,
    hover: clamp01(m.hover),
    hot: [m.hotAt[0], m.hotAt[1], clamp01(m.hot), clamp01(m.hotTier)],
    src: [m.hotHalf[0], m.hotHalf[1], m.hotR, 0],
  };
}

/** The pack's TAIL, packed in the order frame.wgsl reads it (9 vec4 slots). */
/** The tail's slot count — what `CardProgram.ext` declares. */
export const VF_EXT = 9;
// ONE tail, reused (review, 2026-09-23): the frame pass consumes a tail the moment it is handed
// one (`frameValues` → the record view), so the 36 numbers are written into the same array every
// call — a fresh array with four spreads per card per frame was the pass's largest allocator on a
// pan (23 MB over 3 s at 96 cards). A caller that keeps a tail across calls must copy it.
const TAIL: number[] = new Array<number>(4 * VF_EXT).fill(0);
export function tailOf(G: VfGeometry): number[] {
  const t = TAIL;
  t[0] = G.nw[0]; t[1] = G.nw[1]; t[2] = G.nw[2]; t[3] = G.nw[3];
  t[4] = G.nh[0]; t[5] = G.nh[1]; t[6] = G.nh[2]; t[7] = G.nh[3];
  t[8] = G.rho[0]; t[9] = G.rho[1]; t[10] = G.rho[2]; t[11] = G.rho[3];
  t[12] = G.rf[0]; t[13] = G.rf[1]; t[14] = G.rf[2]; t[15] = G.rf[3];
  t[16] = G.wellHalf[0]; t[17] = G.wellHalf[1]; t[18] = G.wellR; t[19] = G.shell;
  t[20] = G.closeC[0]; t[21] = G.closeC[1]; t[22] = G.closeR; t[23] = G.closeGlyphW;
  t[24] = G.lockC[0]; t[25] = G.lockC[1]; t[26] = G.lockR; t[27] = G.lockGlyphScale;
  t[28] = G.closeGlyphR; t[29] = G.lockOpen; t[30] = G.lockSquash; t[31] = G.hoverC;
  t[32] = G.hoverK; t[33] = 0; t[34] = 0; t[35] = 0;
  return t;
}
