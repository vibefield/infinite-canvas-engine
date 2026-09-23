// The one place VibeField's card frame motion design lives — the `vf-frame`
// pack's choreography (design-014; the SOCKET since 2026-09-23).
//
// THE SOCKET. The frame is the ring between the card at rest and the card
// lifted: its inner edge is the content's own rounded rect (never cut), its
// outer edge is the content grown by the ring's thickness T on every side, and
// the LIFT is that same growth — a held card rises by T, not by a scale, so the
// lifted card fills the socket exactly and the ring is gone while it moves.
// Selection reveals the ring outward from the content's edge; a grab grows the
// content into it; a release settles the content back and the ring re-emerges;
// a grabbed card that was not selected simply rises, ring and card one edge.
// A style with controls carries EARS — a lobe of chrome per corner, outside the
// content, tangent to its corner arc — which bloom with the reveal and retract
// for the lift, their buttons leaving first.
//
// Every window, easing and constant for the reveal, the lift, the delete, the
// lock and the two buttons is here, and `resolve()` turns a card's motion
// state into the GEOMETRY to draw this frame — the engine's HEAD (geometry.ts
// `ShellGeometry`) plus this pack's ear and button numbers, plain floats. The
// shader never evaluates a curve; the CPU hit-test (sdf.ts) and the tests call
// this same function, so nothing can drift. (Lineage: research/sdf-card/src/
// motion/choreography.js; the engine's card/choreography.ts before design-014;
// the notched reveal before the socket.)
//
// Units are card units (= world units here). reveal r: 0 idle → 1 selected.
// held h: 0 resting → 1 lifted. delete d: 0 → 1 gone.

import { clamp01, easeInCubic, easeInOutCubic, easeOutBack, easeOutCubic, MATERIAL, type Material, mix, type Motion, REST, type ShellGeometry, win } from "../../card/geometry";
import type { Corner4, FrameStyle } from "./sheet";

export type { CardRect, Material, Motion } from "../../card/geometry";
export { MATERIAL, REST, IDLE, win, easeOutCubic, easeInCubic, easeInOutCubic, easeOutBack } from "../../card/geometry";

export const REVEAL = {
  thickness: [0.0, 0.5] as const,            // the ring grows out of the content's edge
  cornerLo: [0.14, 0.18, 0.24, 0.16] as const,   // the ears, TL TR BR BL, scaled by `stagger`
  cornerHi: [0.55, 0.6, 0.8, 0.57] as const,     // BR runs longest: it reads as a sweep
  closeBtn: [0.52, 0.82] as const,           // out-back pop
  lockBtn: [0.48, 0.78] as const,            // a beat earlier: two arrivals, not one
  ring: [0.0, 0.5] as const,                 // the §7 selection ring arrives with the border
};

/** The lift's own windows over `held`: what leaves as the card rises into the socket. */
export const LIFT = {
  buttons: [0.0, 0.35] as const,     // unpressable mid-drag: they go first
  ears: [0.0, 0.6] as const,         // the lobes retract into the ring's corners
};

export const DELETE = {
  buttons: [0.0, 0.3] as const,      // they were just pressed; they go first
  ears: [0.02, 0.3] as const,        // must be gone before the box gets small
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
  /** The ring's width this frame: the thickness at rest, 0 lifted. */
  readonly band: number;
  /** The ears, TL TR BR BL: centres (world), radii (0 = none), and each one's blend into the ring. */
  readonly earX: Corner4; readonly earY: Corner4; readonly earR: Corner4; readonly fillet: Corner4;
  readonly closeC: readonly [number, number];
  readonly closeR: number; readonly closeGlyphW: number; readonly closeGlyphR: number;
  readonly lockC: readonly [number, number];
  readonly lockR: number; readonly lockGlyphScale: number; readonly lockOpen: number; readonly lockSquash: number;
  readonly hoverC: number; readonly hoverK: number;
}
/** The pack's geometry under the name the tests, the oracle and the lab have always used. */
export type Geometry = VfGeometry;

/** The corners' signs, TL TR BR BL. */
const SGN = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;

export function resolve(P: FrameStyle, card: { readonly centre: readonly [number, number]; readonly contentHalf: readonly [number, number]; readonly radius?: number }, m: VfMotion = VF_REST, mat: Material = MATERIAL): VfGeometry {
  const r = m.reveal;
  const d = m.del;
  const h = clamp01(m.held);
  const stagger = m.stagger;
  const T = P.thickness;
  const R = card.radius ?? P.radius;
  const [cx, cy] = card.centre;
  const hx = Math.max(card.contentHalf[0], 1);
  const hy = Math.max(card.contentHalf[1], 1);

  // ---- the socket: the ring arrives with the reveal, the lift fills it ------
  const k = easeOutCubic(win(r, ...REVEAL.thickness));
  const rise = T * h;                    // the lift: the content grows by the ring
  const out = T * Math.max(k, h);        // the outer edge: the revealed socket, or the lifted card
  let half: [number, number] = [hx + out, hy + out];
  let outerR = Math.max(R + out, 0);
  let ih: [number, number] = [hx + rise, hy + rise];
  let radius = Math.max(R + rise, 0);
  let band = out - rise;

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
    const vanish = kBul * kVan;
    half = [half[0] * vanish, half[1] * vanish]; outerR *= vanish;
    ih = [ih[0] * vanish, ih[1] * vanish]; radius *= vanish;
    band = Math.max(half[0] - ih[0], 0);
  }

  // ---- the ears: bloom with the reveal, staggered; retract for the lift and the delete ----
  const retract = 1 - easeOutCubic(win(d, ...DELETE.ears));
  const settle = 1 - easeOutCubic(win(h, ...LIFT.ears));
  const rb = P.btn.radius;
  const ear = P.control > 0 ? rb + P.clearance : 0;
  const offC = (R + rb + P.clearance) / Math.SQRT2;   // the control's centre from the corner arc's, per axis
  const offA = (R + out) / Math.SQRT2;                 // the ring's outer corner, per axis — where an ear grows from
  const cornerAt = (sx: number, sy: number, lo: number, hi: number) => {
    const bloom = ear > 0 ? retract * settle * easeOutCubic(win(r, lo * stagger, hi)) : 0;
    const off = mix(offA, offC, bloom);
    return { x: cx + sx * (hx - R + off), y: cy + sy * (hy - R + off), r: ear * bloom, f: P.fillet * bloom };
  };
  const tl = cornerAt(SGN[0][0], SGN[0][1], REVEAL.cornerLo[0], REVEAL.cornerHi[0]);
  const tr = cornerAt(SGN[1][0], SGN[1][1], REVEAL.cornerLo[1], REVEAL.cornerHi[1]);
  const br = cornerAt(SGN[2][0], SGN[2][1], REVEAL.cornerLo[2], REVEAL.cornerHi[2]);
  const bl = cornerAt(SGN[3][0], SGN[3][1], REVEAL.cornerLo[3], REVEAL.cornerHi[3]);
  const earX: Corner4 = [tl.x, tr.x, br.x, bl.x];
  const earY: Corner4 = [tl.y, tr.y, br.y, bl.y];
  const earR: Corner4 = [tl.r, tr.r, br.r, bl.r];
  const fillet: Corner4 = [tl.f, tr.f, br.f, bl.f];

  // ---- buttons: the lock in the TL ear, the close in the TR ---------------
  const leave = 1 - easeInCubic(win(d, ...DELETE.buttons));
  const gone = 1 - easeInCubic(win(h, ...LIFT.buttons));
  const on = ear > 0 ? 1 : 0;
  // a window not yet open pops EXACTLY 0 (easeOutBack(0) is 1e-15 in floating point): a card at rest resolves as its still does
  const pop = (w: readonly [number, number]) => { const x = win(r, ...w); return x <= 0 ? 0 : Math.min(Math.max(easeOutBack(x), 0), 1.4); };
  const feel = (hv: number, pr: number) => 1 + BUTTON.hoverSwell * hv - BUTTON.pressSquash * pr;
  const bs = on * pop(REVEAL.closeBtn) * feel(m.hoverC, m.pressC) * leave * gone;
  const ls = on * pop(REVEAL.lockBtn) * feel(m.hoverK, m.pressK) * leave * gone;
  const closeC: [number, number] = [tr.x, tr.y];
  const lockC: [number, number] = [tl.x, tl.y];

  // ---- shadow / alpha: the §5 recipe by LIFT, not by selection ------------
  const collapse = mix(1, DELETE.shadowMin, kOut);
  const shadowSigma = mix(mat.shadow.rest.sigma, mat.shadow.lifted.sigma, h) * collapse;
  const shadowOffset = mix(mat.shadow.rest.offset, mat.shadow.lifted.offset, h) * collapse;
  const shadowAlpha = mix(mat.shadow.rest.alpha, mat.shadow.lifted.alpha, h) * kVan;
  // the §7 ring rides the outer edge and fades as the card rises — a moving card is calm
  const ring = retract * easeOutCubic(win(r, ...REVEAL.ring)) * (1 - h);

  return {
    centre: card.centre, half, outerR, ih, radius, scale: 1, band,
    earX, earY, earR, fillet,
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

/** The pack's TAIL, packed in the order frame.wgsl reads it (8 vec4 slots). */
export function tailOf(G: VfGeometry): number[] {
  return [
    ...G.earX, ...G.earY, ...G.earR, ...G.fillet,
    G.closeC[0], G.closeC[1], G.closeR, G.closeGlyphW,
    G.lockC[0], G.lockC[1], G.lockR, G.lockGlyphScale,
    G.closeGlyphR, G.lockOpen, G.lockSquash, G.hoverC,
    G.hoverK, G.band, 0, 0,
  ];
}
/** The tail's slot count — what `CardProgram.ext` declares. */
export const VF_EXT = 8;
