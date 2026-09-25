// The MINI MAT's law — pure: no GPU (MINIMAT.md). A mini mat on the desk is an
// axis-aligned rect of the mat's own vinyl; `resolveMiniMat` turns it and its
// motion (held · hovered · selected · fading) into the GEOMETRY the pass draws
// and the hit test reads. Its FACE is the cutting area inside the printed
// border — the rect its inside shows through (the portal, MINIMAT.md §3), and
// what a flight into it is built on. `chipOf` lays one of its children out on
// the face as the far LOD draws it (§5): the child's footprint mapped through
// the inside's embedding, in the host's world. The lamp is the desk's one lamp
// (paper.ts `lampOf`): the shadow falls away from it, the cut edge catches it.

import { type FadeIn, lod } from "../lattice/lod";
import { dressScale } from "../mat/grid";
import { type LineLaw, lineWeight } from "../lattice/line";
import type { CameraState, PortalAffine, Rect } from "../nav/flight";
import { clipOf, type PortalClip } from "../nav/portal";
import type { Lamp } from "../paper/paper";
import { sdRoundBox } from "../sdf";
import { GLYPHS } from "../mat/layout";
import { MINIMAT, type RGB } from "../theme";

/** The mini mat's numbers (theme.ts `MINIMAT`) — the engine's unless a host tweaks them. */
export interface MiniMatLaw {
  readonly size: { readonly w: number; readonly h: number };
  readonly radius: number;
  readonly margin: number;
  readonly thick: number;
  readonly lift: { readonly height: number; readonly scale: number };
  readonly hover: number;
  readonly shadow: {
    readonly penumbra: { readonly sigma0: number; readonly sigmaPerHeight: number; readonly alpha: number };
    readonly contact: { readonly sigma: number; readonly alpha: number; readonly reach: number };
    readonly slopeMax: number;
  };
  readonly edge: { readonly width: number; readonly light: number; readonly dark: number };
  readonly print: {
    readonly frame: number; readonly tick: number; readonly width: number; readonly ticks: readonly [number, number, number];
    readonly digits: { readonly cap: number; readonly gap: number; readonly top: number };
    readonly labelsFrom: readonly [number, number];
    readonly name: { readonly cap: number; readonly tracking: number };
    readonly legible: readonly [number, number];
  };
  readonly ring: number;
  readonly chips: { readonly max: number; readonly minPx: number; readonly greekPx: number; readonly greekAlpha: number; readonly greekWeight: number };
  readonly gate: readonly [number, number];
}
export const DEFAULT_MINIMAT_LAW: MiniMatLaw = MINIMAT;

export interface MiniMatRect {
  /** World centre, in the frame of the desk it lies on. */
  readonly cx: number; readonly cy: number;
  /** The sheet, world units. */
  readonly w: number; readonly h: number;
}

/** What moves: the hold's lift (0..1), the hover's rise (0..1), the selection ring's presence (0..1), the presence itself (1 … 0 gone). */
export interface MiniMatMotion { readonly held: number; readonly hover: number; readonly ring: number; readonly fade: number }
export const MINIMAT_REST: MiniMatMotion = { held: 0, hover: 0, ring: 0, fade: 1 };

export interface MiniMatGeometry {
  readonly centre: readonly [number, number];
  /** Half extents as drawn (the hold's scale applied). */
  readonly half: readonly [number, number];
  /** The die-cut corner and the printed border, as drawn. */
  readonly radius: number;
  readonly margin: number;
  /** The sheet's underside off the desk (the hold's and the hover's rise) and its thickness, world units. */
  readonly lift: number;
  readonly thick: number;
  readonly scale: number;
  /** The shadow's ground offset per unit of height, world axes — away from the lamp, capped. */
  readonly slope: readonly [number, number];
  /** The unit direction to the lamp, world axes (x right, y down the screen, z off the desk). */
  readonly lamp: readonly [number, number, number];
  readonly ring: number;
  readonly alpha: number;
}

export function resolveMiniMat(r: MiniMatRect, m: MiniMatMotion, law: MiniMatLaw, lamp: Lamp): MiniMatGeometry {
  const scale = 1 + (law.lift.scale - 1) * m.held;
  const dx = lamp.x - r.cx;
  const dy = lamp.y - r.cy;
  const h = Math.max(lamp.h, 1e-6);
  const len = Math.hypot(dx, dy, h);
  let sx = -dx / h;
  let sy = -dy / h;
  const s = Math.hypot(sx, sy);
  const cap = law.shadow.slopeMax;
  if (s > cap) { sx *= cap / s; sy *= cap / s; }
  return {
    centre: [r.cx, r.cy], half: [(r.w / 2) * scale, (r.h / 2) * scale],
    radius: law.radius * scale, margin: law.margin * scale,
    lift: law.lift.height * Math.max(m.held, law.hover * m.hover), thick: law.thick, scale,
    slope: [sx, sy], lamp: [dx / len, dy / len, h / len],
    ring: m.ring, alpha: m.fade,
  };
}

/** The sheet's signed distance at a world point. */
export const sdMiniMat = (G: MiniMatGeometry, wx: number, wy: number): number => sdRoundBox(wx - G.centre[0], wy - G.centre[1], G.half[0], G.half[1], G.radius);

/** The FACE — the cutting area inside the printed border, world units: what the inside shows through. */
export function faceOf(G: MiniMatGeometry): Rect {
  const hx = Math.max(G.half[0] - G.margin, 1e-3);
  const hy = Math.max(G.half[1] - G.margin, 1e-3);
  return { x: G.centre[0] - hx, y: G.centre[1] - hy, width: 2 * hx, height: 2 * hy };
}
/** The face's corners: square, as a mat's printed cutting area is. */
export const FACE_RADIUS = 0;

export type MiniMatHit = "face" | "border" | "outside";
/** What is under a world point: the face (the inside's window), the border (the sheet round it), or nothing. */
export function pickMiniMat(G: MiniMatGeometry, wx: number, wy: number): MiniMatHit {
  if (sdMiniMat(G, wx, wy) >= 0) return "outside";
  const F = faceOf(G);
  return wx >= F.x && wx <= F.x + F.width && wy >= F.y && wy <= F.y + F.height ? "face" : "border";
}

/** How far the shadow can reach past the sheet, world units — the vertex quad's pad (the slab's sweep and its penumbra). */
export function shadowReach(G: MiniMatGeometry, law: MiniMatLaw = DEFAULT_MINIMAT_LAW): number {
  const top = G.lift + G.thick;
  const p = law.shadow.penumbra;
  return Math.hypot(G.slope[0], G.slope[1]) * top + 2.5 * (p.sigma0 + p.sigmaPerHeight * top) + 2.5 * law.shadow.contact.sigma;
}

/** The face on screen under a camera — the portal's clip. */
export const faceClip = (G: MiniMatGeometry, cam: CameraState): PortalClip => clipOf(faceOf(G), FACE_RADIUS, cam);

// ---------------------------------------------------------------- the far LOD (MINIMAT.md §5)

/** The lattice a face shows at the far LOD — the inside's three rungs, their presences and half-widths. */
export interface FaceLattice {
  /** Fine, mid, coarse spacing, inside units. */
  readonly rungs: readonly [number, number, number];
  /** Each rung's line presence. */
  readonly weights: readonly [number, number, number];
  /** Each rung's line half-width, DEVICE px. */
  readonly widths: readonly [number, number, number];
}

/**
 * The lattice a face draws at the far LOD: the inside's three rungs at the zoom it is seen at
 * (`insideZoom` — M.s × the host camera's zoom: the live inside's own camera zoom), each rung's
 * line weight by the mat's line law under the fade-in window DRESSED for the inside's arrival
 * (`lodZoom`, floored — mat/grid.ts `dressScale`), exactly as the live inside dresses its mat —
 * so the face and the live inside draw the same lines, and the one fades into the other unseen.
 */
export function faceLattice(insideZoom: number, fadeIn: FadeIn, law: LineLaw, lodZoom?: number): FaceLattice {
  const s = dressScale(insideZoom, lodZoom);
  const win: FadeIn = s === 1 ? fadeIn : [fadeIn[0] * s, fadeIn[1] * s];
  const l = lod({ camX: 0, camY: 0, zoom: insideZoom, width: 1, height: 1 });
  const w = [l.fine, l.mid, l.coarse].map((sp) => lineWeight(sp * insideZoom, win, law));
  const at = (i: number) => w[i] as { readonly halfWidth: number; readonly alpha: number };
  return { rungs: [l.fine, l.mid, l.coarse], weights: [at(0).alpha, at(1).alpha, at(2).alpha], widths: [at(0).halfWidth, at(1).halfWidth, at(2).halfWidth] };
}

/** What a child is, to the face that draws it small: a sheet of paper (a note), or a mini mat of its own. */
export type ChipKind = "paper" | "mat";

/** One child as the face's far LOD draws it, in the CHILD's frame (the inside's world). */
export interface ChildShape {
  readonly kind: ChipKind;
  readonly cx: number; readonly cy: number;
  /** Half extents, the tilt (radians), the corner radius — the child's own. */
  readonly hx: number; readonly hy: number;
  readonly angle: number;
  readonly radius: number;
  /** Its colour: the paper's, or the vinyl's. */
  readonly colour: RGB;
  /** How far it stands off the face, child units — what its contact shadow is cast from. */
  readonly height: number;
  /** A note's writing, GREEKED: the pen's colour, the text's left edge and em (note units from the sheet's top-left), and each line's baseline and width. */
  readonly writing?: { readonly ink: RGB; readonly x0: number; readonly em: number; readonly lines: readonly { readonly y: number; readonly width: number }[] } | undefined;
  /** A mini mat's printed border, child units. */
  readonly margin?: number | undefined;
}

/** The most lines of a note's writing a chip greeks. */
export const CHIP_LINES = 6;

/** A chip as the pass takes it: the child mapped into the HOST's world through the inside's embedding `M` (host = o + child · s). */
export interface Chip {
  readonly kind: ChipKind;
  readonly centre: readonly [number, number];
  readonly half: readonly [number, number];
  readonly cos: number; readonly sin: number;
  readonly radius: number;
  readonly colour: RGB;
  readonly height: number;
  /** Greeked lines in the chip's own frame, host units: x from, x to, the stroke's centre y — at most CHIP_LINES. */
  readonly lines: readonly (readonly [number, number, number])[];
  /** The lines' stroke half-thickness, host units, and their ink. */
  readonly stroke: number;
  readonly ink: RGB;
  /** A mini mat chip's border, host units. */
  readonly margin: number;
}

/** A child through the embedding: its footprint scaled by `M.s` about the host's origin; a note's lines greeked at `weight` × the line pitch (MINIMAT.chips). */
export function chipOf(c: ChildShape, M: PortalAffine, weight: number = MINIMAT.chips.greekWeight): Chip {
  const s = M.s;
  const w = c.writing;
  const hx = c.hx * s;
  const hy = c.hy * s;
  const lines: [number, number, number][] = [];
  let stroke = 0;
  if (w?.lines.length) {
    // the note's frame is its top-left in note units; the chip's is its centre in host units. A line's
    // stroke sits on the x-height's middle (0.32 em over the baseline — a hand's x-height is ~0.45 em).
    stroke = 0.5 * weight * w.em * s;
    for (const L of w.lines.slice(0, CHIP_LINES)) {
      if (!(L.width > 0.5)) continue;
      lines.push([(w.x0 - c.hx) * s, (w.x0 + L.width - c.hx) * s, (L.y - 0.32 * w.em - c.hy) * s]);
    }
  }
  return {
    kind: c.kind, centre: [M.ox + c.cx * s, M.oy + c.cy * s], half: [hx, hy], cos: Math.cos(c.angle), sin: Math.sin(c.angle),
    radius: c.radius * s, colour: c.colour, height: c.height * s, lines, stroke, ink: w?.ink ?? c.colour, margin: (c.margin ?? 0) * s,
  };
}

// ---------------------------------------------------------------- the print's words (MINIMAT.md §2)

/** The most characters of a NAME the border prints. */
export const NAME_CHARS = 32;

/** A name as the atlas's glyph indices (mat/layout.ts `GLYPHS`): capitals, a letter it lacks printed as a space; at most NAME_CHARS. */
export function nameGlyphs(name: string, glyphs: string = GLYPHS): number[] {
  const space = glyphs.indexOf(" ");
  return [...name.toUpperCase()].slice(0, NAME_CHARS).map((ch) => { const i = glyphs.indexOf(ch); return i >= 0 ? i : space; });
}

/**
 * Glyph indices packed four to a float (6 bits each, base 64 — an integer under 2²⁴, exact in
 * an f32), NAME_CHARS / 4 floats: what the record's `name` carries. The shader unpacks slot k
 * as `(u32(f[k / 4]) >> (6 · (k % 4))) & 63`.
 */
export function packGlyphs(indices: readonly number[]): number[] {
  const out = new Array<number>(NAME_CHARS / 4).fill(0);
  indices.slice(0, NAME_CHARS).forEach((g, k) => { out[k >> 2] = (out[k >> 2] as number) + (g & 63) * 64 ** (k & 3); });
  return out;
}

/** Which rung of the face's lattice the ruler numbers, and how: its spacing (inside units), the label's `mult · 10^exp` per site index, and the presence of the sites it numbers that the next rung does not. */
export interface Numerals { readonly spacing: number; readonly mult: number; readonly exp: number; readonly fade: number }

/**
 * The ruler's numerals at the zoom the inside is seen at (`insideZoom`): the finest of the face's rungs
 * whose sites are `from[0]` CSS px apart on screen, its own sites fading in by `from` and every tenth
 * (the next rung's) at full — the rulers' law (RULER.md), on three rungs. A spacing is 2·10^k (lod.ts),
 * so a site's value is `index · 2 · 10^k`. Null = no rung is far enough apart to number.
 */
export function numeralsOf(L: FaceLattice, insideZoom: number, from: readonly [number, number]): Numerals | null {
  for (const spacing of L.rungs) {
    const pitch = spacing * insideZoom;
    if (pitch < from[0]) continue;
    const exp = Math.round(Math.log10(spacing / 2));
    const t = Math.min(Math.max((pitch - from[0]) / Math.max(from[1] - from[0], 1e-6), 0), 1);
    return { spacing, mult: 2, exp, fade: t * t * (3 - 2 * t) };
  }
  return null;
}

/** Is a chip worth drawing at a zoom — its short side at least `minPx` CSS px? */
export const chipVisible = (ch: Chip, zoom: number, minPx: number = MINIMAT.chips.minPx): boolean => 2 * Math.min(ch.half[0], ch.half[1]) * zoom >= minPx;
