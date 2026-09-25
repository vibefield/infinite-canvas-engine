// The ruler's law — pure maths beside lod.ts and line.ts. Two rulers are
// PRINTED on the mat along the viewport's top and left edges (RULER.md): a
// frame line one module in from the edge, a band one module wide inside it,
// ticks standing on the band's inner line at the lattice's own sites, and a
// label in the band's outer half at every site coarse enough to carry one.
// The band is screen-fixed; what moves under it is the lattice, so the ticks
// pan with the grid and the labels read the world coordinate (CSS px at
// zoom 1 — what a card's position is) of the site they stand on.
//
// Five LEVELS of sites, a nested chain on the decade lattice: the fine rung
// (f = 2·10^k), every fifth fine site (5f), the mid rung (m = 10f), every
// fifth mid site (5m), the coarse rung (c = 100f). A site's level is the
// coarsest one it lies on. Every presence is a smoothstep of a PITCH on
// screen — the fine rung's ticks arrive as its pitch passes `ticksFrom`, a
// level's labels as its pitch passes `labelsFrom` — so a decade wrap (the
// fine rung becoming the mid rung at the same pitch) is continuous by
// construction, as the mat's lines are (line.ts): level i at zoom 10·z has
// the pitch level i+2 had at z, and takes its numbers.

import { type Lod, smoothstep } from "./lod";

export interface RulerLaw {
  /** CSS px: the band's width, and the mat's unprinted margin between the viewport's edge and the frame. */
  readonly band: number;
  readonly margin: number;
  /** CSS px: the ticks' lengths — minor · medium · major. */
  readonly tick: readonly [number, number, number];
  /** CSS px: the width of every printed line — the ticks and the frame. */
  readonly line: number;
  /** Ink presence of the frame's lines, the ticks and the labels (1 = the mat's cream, full). */
  readonly alpha: { readonly frame: number; readonly tick: number; readonly label: number };
  /** CSS px of pitch between which the fine rung's ticks (and its fifths) fade in. */
  readonly ticksFrom: readonly [number, number];
  /** CSS px of pitch between which a level's labels fade in. */
  readonly labelsFrom: readonly [number, number];
  /** The text: its size (CSS px — the atlas's em), its inset from the outer line, its gap after the tick. */
  readonly text: { readonly size: number; readonly top: number; readonly gap: number };
  /** The most characters a label may have; a level whose labels would be wider than its pitch carries none. */
  readonly maxChars: number;
}

/** One level of sites, with everything the pass draws for it this frame. */
export interface RulerLevel {
  /** World units between sites. */
  readonly spacing: number;
  /** CSS px between sites. */
  readonly pitch: number;
  /** A site's value is `index · mult · 10^exp` (index = its count from the world origin). */
  readonly mult: 1 | 2;
  readonly exp: number;
  /** CSS px; the label pulls a tick to the major length as it appears. */
  readonly tickLen: number;
  readonly tickAlpha: number;
  readonly labelAlpha: number;
  /** The lattice's wrap period over this spacing — an exact integer (100 · 20 · 10 · 2 · 1). */
  readonly perWrap: number;
}

export type RulerLevels = readonly [RulerLevel, RulerLevel, RulerLevel, RulerLevel, RulerLevel];

const PER_WRAP = [100, 20, 10, 2, 1] as const;
const MULT = [2, 1, 2, 1, 2] as const;
const EXP_OFFSET = [0, 1, 1, 2, 2] as const;
/** The exact ratio between level j's spacing and level i's (j ≥ i): spacings are 2 · [1, 5, 10, 50, 100] · 10^k. */
const UNITS = [1, 5, 10, 50, 100] as const;

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The five levels this frame. `maxAbs` is the largest |value| a label on
 * screen can carry (`labelReach`) — a level whose widest label would not fit
 * its pitch carries none, so labels never overlap whatever the coordinates.
 */
export function rulerLevels(l: Lod, zoom: number, law: RulerLaw, maxAbs = 0): RulerLevels {
  const af = smoothstep(law.ticksFrom[0], law.ticksFrom[1], l.fine * zoom);
  const [minor, medium, major] = law.tick;
  const base = [minor, medium, mix(minor, major, af), mix(medium, major, af), major];
  const tickAlpha = [af, af, 1, 1, 1];
  const out: RulerLevel[] = [];
  for (let i = 0; i < 5; i++) {
    const spacing = l.fine * (UNITS[i] as number);
    const pitch = spacing * zoom;
    const mult = MULT[i] as 1 | 2;
    const exp = l.k0 + (EXP_OFFSET[i] as number);
    let labelAlpha = smoothstep(law.labelsFrom[0], law.labelsFrom[1], pitch);
    // the widest label this level can show on screen, in characters — over the pitch, and the level is mute
    const chars = labelChars(maxAbs, mult, exp);
    if (chars > law.maxChars || chars * law.text.size * ADVANCE_EM + law.text.gap > pitch) labelAlpha = 0;
    out.push({ spacing, pitch, mult, exp, tickLen: mix(base[i] as number, major, labelAlpha), tickAlpha: tickAlpha[i] as number, labelAlpha, perWrap: PER_WRAP[i] as number });
  }
  return out as unknown as RulerLevels;
}

/** A mono glyph's advance as a fraction of its em — the layout's estimate (the atlas carries the measured one; SF Mono is 0.6). */
export const ADVANCE_EM = 0.6;

/** The finest level that carries labels this frame, or -1 — the level the pass lays text out on. */
export function finestLabelled(levels: RulerLevels): number {
  for (let i = 0; i < 5; i++) if ((levels[i] as RulerLevel).labelAlpha > 0) return i;
  return -1;
}

/** The lattice's wrap count of a camera coordinate: `cam = wraps · period + phase`, exact in doubles (lod.ts wraps the phase). */
export const wrapsOf = (cam: number, period: number): number => Math.floor(cam / period);

/**
 * The text of a site's label: `index · mult · 10^exp`, plain digits — no
 * suffixes (a "1k" that reads "1000" at the next zoom would change under the
 * eye), and no trailing zeros in a fraction ("1.0" is "1" at every level, so
 * a label's text never changes while it is visible). ruler.wgsl `ruler_char`
 * is the same arithmetic per character.
 */
export function formatLabel(index: number, mult: 1 | 2, exp: number): string {
  const M = index * mult;
  if (M === 0) return "0";
  const neg = M < 0;
  let digits = String(Math.abs(M));
  let text: string;
  if (exp >= 0) text = digits + "0".repeat(exp);
  else {
    const p = -exp;
    digits = digits.padStart(p + 1, "0");
    const int = digits.slice(0, digits.length - p);
    const frac = digits.slice(digits.length - p).replace(/0+$/, "");
    text = frac ? `${int}.${frac}` : int;
  }
  return neg ? `-${text}` : text;
}

/** How many characters the widest label of magnitude ≤ `maxAbs` takes at this level (the sign included). */
export function labelChars(maxAbs: number, mult: 1 | 2, exp: number): number {
  const index = Math.ceil(maxAbs / (mult * 10 ** exp));
  return Math.max(formatLabel(index, mult, exp).length, formatLabel(-index, mult, exp).length);
}

/** The largest |world coordinate| a label along an axis can show: the far edge of the band's reach. */
export function labelReach(cam: number, zoom: number, span: number): number {
  return Math.max(Math.abs(cam), Math.abs(cam + span / zoom));
}

export interface RulerLabel {
  /** The site's world coordinate and its count from the origin at the finest labelled level. */
  readonly value: number;
  readonly index: number;
  /** CSS px along the axis where the site (its tick) stands. */
  readonly at: number;
  readonly text: string;
  readonly alpha: number;
  /** The site's level — the coarsest it lies on. */
  readonly level: number;
}

/**
 * The labels along one axis this frame, in order — the CPU mirror of what
 * ruler.wgsl lays out, site for site: the finest labelled level's sites from
 * the band's inner corner to the frame's far line, each with the alpha of the
 * coarsest level it lies on. `cam` is the camera's UNWRAPPED coordinate;
 * `span` the attachment's extent along the axis (CSS px).
 */
export function labelsAlong(cam: number, zoom: number, span: number, levels: RulerLevels, law: RulerLaw): RulerLabel[] {
  const lf = finestLabelled(levels);
  const out: RulerLabel[] = [];
  if (lf < 0) return out;
  const L = levels[lf] as RulerLevel;
  const period = (levels[4] as RulerLevel).spacing;
  const wraps = wrapsOf(cam, period);
  const phase = cam - wraps * period;
  const from = law.margin + law.band;
  const to = span - law.margin;
  // the shader's arithmetic exactly: a local count from the wrapped phase, the wrap count folded in as an exact integer
  // a hair of slack at the ends: a site on the corner itself is the shader's `site < lim.x` call, and a float either side of it lists the same sites
  const nLocal0 = Math.ceil((phase + from / zoom) / L.spacing - 1e-9);
  const nLocal1 = Math.floor((phase + to / zoom) / L.spacing + 1e-9);
  for (let n = nLocal0; n <= nLocal1; n++) {
    const index = wraps * L.perWrap + n;
    const at = (n * L.spacing - phase) * zoom;
    if (at < from || at > to) continue;
    let level = lf;
    for (let j = 4; j > lf; j--) { if (index % ((UNITS[j] as number) / (UNITS[lf] as number)) === 0) { level = j; break; } }
    out.push({ value: index * L.spacing, index, at, text: formatLabel(index, L.mult, L.exp), alpha: (levels[level] as RulerLevel).labelAlpha, level });
  }
  return out;
}
