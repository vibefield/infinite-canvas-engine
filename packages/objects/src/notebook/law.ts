// The NOTEBOOK's law — every number the 3D notebook is made of (NOTEBOOK.md), with
// where it came from. Pure: no GPU, no colour (the colours are the host's —
// lab/theme.ts `NOTEBOOK_LOOK`, by token, the one law the theme gate keeps).
//
// World units are the desk's: a CSS px at zoom 1 (the note's scale — theme.ts
// PAPER.size 200 = 3″, so one unit ≈ 0.38 mm and this A6-ish book is 180 × 252).
// Axes: x right, y down the screen, z up off the mat, toward the eye.

import { PHYSICS } from "@ice/desk/kit";

export interface NotebookLaw {
  /** The case: the cover's width × height, a board's thickness, its fore-edge corner radius. */
  readonly cover: { readonly width: number; readonly height: number; readonly board: number; readonly radius: number };
  /** The text block: sheets and their thickness; the squares (the case's overhang past the pages); the joint (the gap between the spine and the first page when closed); a page's fore-edge corner radius. */
  readonly block: { readonly sheets: number; readonly sheet: number; readonly square: number; readonly joint: number; readonly radius: number };
  /** The quarter binding: the spine band's width on the face; the spine's bulge when closed. */
  readonly spine: { readonly band: number; readonly bulge: number };
  /**
   * The GUTTER, open: every sheet is bound at one line and rises from it to its own height in the
   * stack. A sheet leaves the binding at `entry0 + entryPer · rise` radians (at most `entryMax`) and
   * bends flat — so a thick stack climbs steeply out of the valley and a thin one barely dips, and
   * the upper sheets' fore-edges are drawn in toward the gutter more than the lower ones' (the fan
   * a real open notebook shows). `dip` is the least a page falls into the valley even when its
   * stack is thin (the binding pulls every page down).
   */
  readonly gutter: { readonly entry0: number; readonly entryPer: number; readonly entryMax: number; readonly dip: number };
  /**
   * The desk EYE: the camera stays top-down, but what rises off the mat is seen from a point above
   * the view's centre, so a lifted book grows and a standing cover keystones — the desk plane
   * itself maps exactly as the ortho camera maps it. The eye stands `k` view-diagonals up (a fixed
   * field of view when zoomed out), never nearer than `min` world units (the perspective of a book
   * held close stays a book's, not a fish-eye's).
   */
  readonly eye: { readonly k: number; readonly min: number };
  /** The lamp's shading: the sky's share where the lamp is blocked or faced away, and how far a face turned toward it may brighten over a flat one. */
  readonly light: { readonly ambient: number; readonly cap: number };
  /**
   * The SHADOW — the desk's one law (the note's, PAPER.shadow, and the photo's): a penumbra σ at
   * contact that grows per unit of height between the caster and the receiver; its darkness on
   * the mat; the slope's cap (a book far from the lamp keeps a finite shadow). Plus a CONTACT term
   * (ambient occlusion where the case meets the mat) that lets go as the book rises.
   */
  readonly shadow: {
    readonly sigma0: number; readonly perUnit: number; readonly alpha: number; readonly slopeMax: number;
    readonly contact: { readonly sigma: number; readonly alpha: number; readonly reach: number };
  };
  /** How much of the leaves' dapple a page takes (1 = the mat's own) — the palm must not blind the writing. */
  readonly dapple: { readonly page: number; readonly cover: number };
  /** The lift: a held book rises `held` units and tilts into its motion (radians per unit of CSS px/s, capped). Opening, it rises `open` units while the cover stands, and settles as it lands. Under the pointer a closed book rises `hover` — an invitation to pick it up. */
  readonly lift: { readonly held: number; readonly open: number; readonly hover: number; readonly tiltPer: number; readonly tiltMax: number };
  /** The springs (Hz, damping ratio): the cover's swing, a sheet's root and its free edge, the lift, the tilt, the corner's peek, the ring. */
  readonly springs: {
    readonly cover: readonly [number, number]; readonly root: readonly [number, number]; readonly edge: readonly [number, number];
    readonly lift: readonly [number, number]; readonly tilt: readonly [number, number]; readonly peek: readonly [number, number];
    readonly ring: readonly [number, number];
  };
  /** A sheet's bend: how its angle travels from the root to the free edge (1 = a circular arc; more = the edge curls most). */
  readonly bend: number;
  /** The corner's peek on hover: the free edge's lift (rad) and the twist that keeps it to one corner; the zone that invites it (units from the corner). */
  readonly peek: { readonly angle: number; readonly twist: number; readonly zone: number };
  /** A page's outer share that turns it on a click (the rest of the page is for the pen). */
  readonly turnZone: number;
  /** The flutter as a book lands open: the first sheets' kick (rad/s), falling off by sheet. */
  readonly flutter: { readonly kick: number; readonly sheets: number };
  /** The paper: fibre and mottle (±/255), the tooth's relief, the cockle (units), the ruling (units). */
  readonly paper: { readonly fibre: number; readonly mottle: number; readonly tooth: number; readonly cockle: number; readonly pitch: number; readonly dot: number; readonly margin: number };
  /** The cloth: the weave's pitch (units), its relief, the sheen (blinn exponent, strength). */
  readonly cloth: { readonly pitch: number; readonly relief: number; readonly sheen: readonly [number, number] };
  /** The selection ring on the mat around a selected book: offset from the footprint, width (CSS px). */
  readonly ring: { readonly offset: number; readonly width: number };
}

export const NOTEBOOK: NotebookLaw = {
  cover: { width: 180, height: 252, board: 2.4, radius: 8 },
  block: { sheets: 64, sheet: 0.19, square: 3.2, joint: 5, radius: 5.5 },
  spine: { band: 30, bulge: 2.6 },
  gutter: { entry0: 0.32, entryPer: 0.055, entryMax: 1.2, dip: 2.2 },
  eye: { k: 1.15, min: 1250 },
  light: { ambient: 0.46, cap: 1.28 },
  // PAPER.shadow's slope cap and contact σ; the growth is the photo's (0.36/unit, not the note's 0.75 — a
  // standing cover is 180 up, and at the note's rate its shadow would blur into the mat)
  shadow: { sigma0: 1.4, perUnit: 0.3, alpha: 0.55, slopeMax: PHYSICS.shadow.slopeMax, contact: { sigma: 1.3, alpha: 0.45, reach: 3 } },
  dapple: { page: 0.35, cover: 1 },
  lift: { held: 30, open: 20, hover: 3.5, tiltPer: 0.00011, tiltMax: 0.11 },
  springs: {
    cover: [1.12, 0.74], root: [1.9, 0.78], edge: [2.6, 0.62],
    lift: [2.2, 0.8], tilt: [2.8, 0.55], peek: [4, 0.7], ring: [4, 1],
  },
  bend: 1.6,
  peek: { angle: 0.3, twist: 0.3, zone: 42 },
  turnZone: 0.3,
  flutter: { kick: 2.4, sheets: 3 },
  paper: { fibre: 3 / 255, mottle: 4 / 255, tooth: 0.55, cockle: 0.35, pitch: 10, dot: 0.42, margin: 9 },
  cloth: { pitch: 0.9, relief: 0.35, sheen: [14, 0.07] },
  ring: { offset: 5, width: 1.5 },
};
