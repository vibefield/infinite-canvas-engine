// THE DRAWER (design-017 §5, §7) — where the pegboard sits on screen, in CSS px, and how it moves: widgetlab rev 1's drawer
// (`translate(-50%, 112%) → 0` in 340 ms on `cubic-bezier(0.32,0.72,0,1)`, top radius 22) on the desk. A PURE module: the
// tray pass shades the rect it returns, the flux publishes the same rect to core's hit tests, the tests read both.

import { cubicBezierEase, trayScrollMax } from "@ice/kernel";

/** The drawer's numbers (design-017 §7). Lengths are CSS px; times ms. */
export const DRAWER = {
  /** The pegboard's pitch — the research's unit on screen, chosen by eye for a UI board. */
  pitch: 40,
  /** `min(1120 px, 100 % − 32 px)`, snapped DOWN to whole pitches (its sides a solid border — lattice.ts `PEG.border`, D-K3.1). */
  maxWidth: 1120,
  margin: 16,
  /** ≈ 44 % of the view high, clamped. */
  heightFrac: 0.44,
  minHeight: 220,
  maxHeight: 640,
  /** The top corners' radius (widgetlab rev 1), the rim — the board's cut edge — along the top and the sides, and the finger notch scooped from the rim at the top centre. */
  radius: 22,
  rim: 5,
  notch: { w: 56, h: 8 },
  /** Closed, the drawer's top shows this much of itself; hovered, this much. */
  lip: 12,
  lipHover: 18,
  /** The slide: widgetlab rev 1's curve. */
  slideMs: 340,
  curve: [0.32, 0.72, 0, 1] as const,
  /** Black over the desk at the full slide: widgetlab's 10 % by day, 40 % by night. */
  dim: { day: 0.1, night: 0.4 },
  /**
   * The shadows on the desk: the ROOM's, round the whole outline (what shows above the drawer: it lies over the desk), and the LAMP's,
   * pushed along its ground direction — each the outline's SDF blurred σ, at α.
   */
  shadow: { room: { sigma: 14, alpha: 0.22 }, lamp: { sigma: 18, alpha: 0.18, push: 8 } },
  /** The notch's join with the top edge, smoothed over this many px. */
  notchRound: 3,
  /** The rubber band: its asymptote and stiffness (iOS's curve), how long the scroll input must be quiet before it lets go, the settle's spring. */
  band: { max: 72, c: 0.55, letGoMs: 120, hz: 8 },
  /** The lip's lift spring. */
  liftHz: 7,
  /** A click's slop, the lip's drag-up that opens, the lip's hit pad above what is drawn. */
  slop: 4,
  lipDrag: 10,
  lipPad: 8,
} as const;

/** A rect on screen, CSS px: the drawer's outline box as drawn (its top-left, its width, its FULL height — the part below the view included). */
export interface DrawerRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The drawer's size in a view: whole pitches wide (≤ 1120, ≤ the view − 32), ≈ 44 % of the view high, clamped. */
export function drawerSize(vw: number, vh: number): { readonly w: number; readonly h: number } {
  const P = DRAWER.pitch;
  const w = P * Math.max(2, Math.floor(Math.min(DRAWER.maxWidth, vw - 2 * DRAWER.margin) / P));
  const h = Math.min(DRAWER.maxHeight, Math.max(DRAWER.minHeight, Math.round(DRAWER.heightFrac * vh)));
  return { w, h };
}

/**
 * The drawer as drawn at slide `p` (0 closed … 1 open) with the lip lifted by `lift` (0 … 1): centred on whole CSS px, its
 * bottom flush with the view — closed, only the lip is on screen; open, the whole drawer.
 */
export function drawerRect(vw: number, vh: number, p: number, lift = 0): DrawerRect {
  const { w, h } = drawerSize(vw, vh);
  const lip = DRAWER.lip + (DRAWER.lipHover - DRAWER.lip) * lift;
  const shown = lip + (h - lip) * p;
  return { x: Math.round((vw - w) / 2), y: vh - shown, w, h };
}

/** The slide's ease: widgetlab rev 1's `cubic-bezier(0.32,0.72,0,1)`, the exact curve CSS runs (the kernel's). */
export const slideEase: (t: number) => number = cubicBezierEase(...DRAWER.curve);

/**
 * The rubber band (design-017 §3): what a pull of `stretch` px past an end SHOWS — iOS's curve, `B·(1 − 1/(1 + |s|·c/B))`,
 * signed: ever less per px pulled, never past `B`.
 */
export function band(stretch: number): number {
  const B = DRAWER.band.max;
  const a = Math.abs(stretch);
  return Math.sign(stretch) * B * (1 - 1 / (1 + (a * DRAWER.band.c) / B));
}

/**
 * How far the board scrolls before the band (design-017 §8; K5a — K3's 26-row stub retired): the laid content's foot (`TrayContent.bottom`,
 * board px) plus a pitch, less the face the drawer shows (its height inside the rim) — kernel `trayScrollMax`; 0 with nothing laid.
 */
export function scrollRange(vw: number, vh: number, bottom: number): number {
  const { h } = drawerSize(vw, vh);
  return trayScrollMax(bottom, h - DRAWER.rim, DRAWER.pitch);
}
