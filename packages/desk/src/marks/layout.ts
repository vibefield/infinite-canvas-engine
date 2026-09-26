// The MARKS' LAYOUT — pure (design-015 §7, stratum 5; D4a). What the desk's chrome draws this frame, as
// the records the marks pass shades (shaders/marks/marks.wgsl): *Marks on the Mat*'s reference drawing
// code (vibe-field/draft/desk-chrome/chrome.js — `drawSelection` · `drawMember` · `drawUnion` ·
// `drawMarquee` · `drawGuides` · `flare` · `pill` · `drawRulerBand`) re-expressed as a list of SDF
// primitives, number for number (theme.ts `MARKS`), in SCREEN px: the marks keep their size at every
// zoom — they are the desk's chrome, not its objects. The one exception is the TAPE, the object's own
// attachment, which zooms with it and is moonlit by night (desk.css `.obj-tape`).
//
// A MarksInput is what the desk says about the frame — the objects' frames ON SCREEN with their marks'
// clocks, several's union, the vellum, the laser's guides and gaps, the tape, your extent on the rulers
// — assembled from the world by the builder (compose/marks.ts) or from a scene by the oracle. Paint
// order is chrome.js's: the tape (it lies on its object, under every pencil stroke), each object's
// marks, the union, the vellum, the laser, your extent on the rulers. A light mark (the laser's bloom,
// its wall-to-wall lines, the flares, the rulers' laser ticks) is flagged: the pass ADDS it.

import { defineStruct } from "../engine/struct";
import { GLYPH_PAD, GLYPHS, type GlyphAtlasMeta, NO_GLYPHS } from "../mat/layout";
import { cssColor, MARKS, type RGBA } from "../theme";
import { easeLift } from "./ease";

/** One mark, as the shader reads it — see each field's use per kind in marks.wgsl. */
export const MarkStruct = defineStruct("Mark", [
  ["shape", "vec4f"],   // kind, flags (1 = light: added), width (CSS px), reach (a bracket's) · a tape's fibre period (object units)
  ["centre", "vec4f"],  // x, y (CSS px), angle (rad), corner radius (CSS px) · a flare's radius · a tape's presence
  ["half", "vec4f"],    // half extents (CSS px) · a segment's or a bar's end B · a glyph cell's size; z, w: a flare's stop · a tape's sheen (top, foot)
  ["colour", "vec4f"],  // straight sRGB and alpha, the presence folded in
  ["aux", "vec4f"],     // a dotted line's period · a bar's tick · a flare's core (rgba) · a glyph's cell and halo · a tape's units, saturate, brightness, fibre alpha
  ["quad", "vec4f"],    // the screen rect the mark may paint: x0, y0, x1, y1 (CSS px)
]);

/** The pass's block: the view (CSS px, dpr) and the glyph atlas (width, height in texels, texels per CSS px, cell width in texels). */
export const MarksUniformsStruct = defineStruct("MarksUniforms", [
  ["view", "vec4f"],
  ["atlas", "vec4f"],
]);

/** The primitives (marks.wgsl's `MARK_*`). */
export const MARK = { stroke: 0, fill: 1, brackets: 2, segment: 3, bar: 4, flare: 5, glyph: 6, tape: 7 } as const;
/** A mark of light: added, never painted over. */
export const LIGHT = 1;

export type V4 = readonly [number, number, number, number];
export interface MarkRecord {
  readonly shape: V4;
  readonly centre: V4;
  readonly half: V4;
  readonly colour: V4;
  readonly aux: V4;
  readonly quad: V4;
}

/** A screen rect, CSS px. */
export interface MarkBox { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }

/** An object's silhouette as the marks go around it: its centre, half extents, turn and corner — world units from a kind (`frame`), CSS px on screen. */
export interface MarkFrame {
  readonly cx: number;
  readonly cy: number;
  readonly hx: number;
  readonly hy: number;
  readonly angle: number;
  readonly r: number;
}

/**
 * One object's marks: `brackets` (a sole selection — `t` the lock-on's LINEAR progress 0..1, eased here on
 * `--vf-ease-lift`; `alpha` its presence, 0 when it has left) or `member` (one of several, or touched by the
 * vellum: quiet ticks at `alpha`); `knobs` where it resizes and nothing moves it.
 */
export interface MarkObject {
  readonly frame: MarkFrame;
  readonly style: "brackets" | "member";
  readonly t: number;
  readonly alpha: number;
  readonly knobs: boolean;
}
/** Several's union: the members' screen box (the frames' extents), its lock-on and presence. */
export interface MarkUnion { readonly box: MarkBox; readonly t: number; readonly alpha: number }
/** The vellum being drawn: its screen rect, what it touches (the count by the cursor), the cursor. */
export interface MarkMarquee { readonly rect: MarkBox; readonly count: number; readonly pointer: { readonly x: number; readonly y: number } | null }
/** A laser guide (kernel `SnapGuide` on screen): its line's `at`, edge or centre, the span it is bright over (the aligned objects' extent), the aligned corners (flares). */
export interface MarkGuide {
  readonly axis: "x" | "y";
  readonly at: number;
  readonly type: "edge" | "center";
  readonly span: readonly [number, number];
  readonly points: readonly (readonly [number, number])[];
}
/** An equal gap (core `SpacingBar` on screen): along `axis` from → to at `perp`, its size in WORLD units (the number). */
export interface MarkBar { readonly axis: "x" | "y"; readonly from: number; readonly to: number; readonly perp: number; readonly gap: number }
/** A taped object's tape: its frame on screen, CSS px per object unit (the zoom, the lift), each strip's press (0..1, linear), the tape's presence. */
export interface MarkTape { readonly frame: MarkFrame; readonly units: number; readonly press: readonly [number, number]; readonly alpha: number }
/** Your extent on the rulers: the selection's screen box, its world edges, and the rulers' margin and band (CSS px). */
export interface MarkRuler { readonly sel: MarkBox; readonly world: MarkBox; readonly margin: number; readonly band: number }

export interface MarksInput {
  readonly view: { readonly width: number; readonly height: number; readonly dpr: number };
  /** The Moon is up: the tape is moonlit and the vellum cooler; the pencil and the laser are light and do not change. */
  readonly night: boolean;
  readonly tape: readonly MarkTape[];
  readonly objects: readonly MarkObject[];
  readonly union: MarkUnion | null;
  readonly marquee: MarkMarquee | null;
  readonly guides: readonly MarkGuide[];
  readonly bars: readonly MarkBar[];
  /** A new alignment's strike, 1 … 0 over 160 ms: the bloom and the flares at up to 1.8×. */
  readonly strike: number;
  readonly ruler: MarkRuler | null;
}

/** A frame with nothing marked. */
export const NO_MARKS = (view: MarksInput["view"], night = false): MarksInput => ({ view, night, tape: [], objects: [], union: null, marquee: null, guides: [], bars: [], strike: 0, ruler: null });

// ---------------------------------------------------------------- inks, parsed once (theme.ts is their one home)

const I = MARKS.inks;
const INK = {
  pencil: cssColor(I.pencil.css),
  keyline: cssColor(I.keyline.css),
  paper: cssColor(I.paper.css),
  laser: cssColor(I.laser.css),
  laserLine: cssColor(I.laserLine.css),
  laserCore: cssColor(I.laserCore.css),
  ink: cssColor(I.tray.css),
  white: cssColor(I.white.css),
  tape: cssColor(I.tape.css),
  vellumDay: cssColor(I.vellumDay.css),
  vellumNight: cssColor(I.vellumNight.css),
};

/** A colour at `a` times its own alpha. */
const at = (c: RGBA, a: number): V4 => [c[0], c[1], c[2], c[3] * a];
const clamp = (x: number, a: number, b: number): number => Math.min(Math.max(x, a), b);
const Z4: V4 = [0, 0, 0, 0];

/** The screen box a turned box (half extents grown by `pad`) covers. */
function turnedQuad(cx: number, cy: number, hx: number, hy: number, angle: number, pad: number): V4 {
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  const ex = c * hx + s * hy + pad;
  const ey = s * hx + c * hy + pad;
  return [cx - ex, cy - ey, cx + ex, cy + ey];
}

/** A point of a frame's own (turned) axes, on screen. */
function onScreen(f: MarkFrame, x: number, y: number): readonly [number, number] {
  const c = Math.cos(f.angle);
  const s = Math.sin(f.angle);
  return [f.cx + c * x - s * y, f.cy + s * x + c * y];
}

// ---------------------------------------------------------------- the primitives

type Out = MarkRecord[];

function box(out: Out, kind: number, cx: number, cy: number, hx: number, hy: number, angle: number, r: number, width: number, colour: V4, reach = 0, flags = 0): void {
  if (colour[3] <= 0) return;
  out.push({ shape: [kind, flags, width, reach], centre: [cx, cy, angle, r], half: [hx, hy, 0, 0], colour, aux: Z4, quad: turnedQuad(cx, cy, hx, hy, angle, width / 2 + 1.5) });
}

function segment(out: Out, a: readonly [number, number], b: readonly [number, number], width: number, colour: V4, flags = 0, period = 0): void {
  if (colour[3] <= 0) return;
  const pad = width / 2 + 1.5;
  out.push({ shape: [MARK.segment, flags, width, 0], centre: [a[0], a[1], 0, 0], half: [b[0], b[1], 0, 0], colour, aux: [period, 0, 0, 0], quad: [Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad, Math.max(a[0], b[0]) + pad, Math.max(a[1], b[1]) + pad] });
}

function bar(out: Out, a: readonly [number, number], b: readonly [number, number], tick: number, width: number, colour: V4, flags = 0): void {
  const pad = width / 2 + tick + 1.5;
  out.push({ shape: [MARK.bar, flags, width, 0], centre: [a[0], a[1], 0, 0], half: [b[0], b[1], 0, 0], colour, aux: [tick, 0, 0, 0], quad: [Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad, Math.max(a[0], b[0]) + pad, Math.max(a[1], b[1]) + pad] });
}

/** A light mark with its keyline (chrome.js `strokeMark`): the cast 2 px wider underneath, then the ink. */
function keyed(draw: (width: number, colour: V4) => void, width: number, ink: RGBA, a: number): void {
  draw(width + MARKS.keyline.grow, at(INK.keyline, a));
  draw(width, at(ink, a));
}

// ---------------------------------------------------------------- selection (chrome.js `drawSelection`, `drawMember`, `drawUnion`)

/** A bracket's reach: never over 30 % of the frame's side, never under its corner + 2 (chrome.js `bracketsPath`). */
export const bracketReach = (reach: number, X: number, Y: number, R: number): number => Math.max(Math.min(reach, MARKS.select.share * 2 * X, MARKS.select.share * 2 * Y), R + MARKS.select.minOverR);

/** A sole selection's frame at lock-on progress `t`: how far out it stands (6 at rest, 8 further as it arrives), its corner, its presence at `alpha`. */
export function selectionGeometry(f: MarkFrame, t: number, alpha: number): { readonly gap: number; readonly X: number; readonly Y: number; readonly R: number; readonly a: number; readonly collapsed: boolean } {
  const S = MARKS.select;
  const e = easeLift(clamp(t, 0, 1));
  const gap = S.gap + (1 - e) * S.arrive;
  const X = f.hx + gap;
  const Y = f.hy + gap;
  return { gap, X, Y, R: Math.min(f.r + gap, S.radiusMax), a: alpha * clamp(t * S.rise, 0, 1), collapsed: Math.min(f.hx, f.hy) * 2 < S.collapse };
}

function selection(out: Out, f: MarkFrame, t: number, alpha: number, knobs: boolean, dpr: number): void {
  if (alpha <= 0.001) return;
  const S = MARKS.select;
  const g = selectionGeometry(f, t, alpha);
  const { X, Y, R, a } = g;
  if (g.collapsed) {
    // far out: under 24 px on screen the brackets become one ring
    keyed((w, c) => box(out, MARK.stroke, f.cx, f.cy, X, Y, f.angle, R, w, c), S.stroke, INK.pencil, a);
    return;
  }
  box(out, MARK.stroke, f.cx, f.cy, X, Y, f.angle, R, 1 / dpr, at(INK.pencil, S.hair * a));
  const L = bracketReach(S.reach, X, Y, R);
  keyed((w, c) => box(out, MARK.brackets, f.cx, f.cy, X, Y, f.angle, R, w, c, L), S.stroke, INK.pencil, a);
  if (!knobs) return;
  const k = R * (1 - Math.SQRT1_2);
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const [x, y] = onScreen(f, sx * (X - k), sy * (Y - k));
    box(out, MARK.fill, x, y, S.knob + 1, S.knob + 1, 0, S.knob + 1, 0, at(INK.keyline, (S.knobShadow / INK.keyline[3]) * a));
    box(out, MARK.fill, x, y, S.knob, S.knob, 0, S.knob, 0, at(INK.paper, a));
    box(out, MARK.stroke, x, y, S.knob, S.knob, 0, S.knob, S.knobStroke, at(INK.pencil, a));
  }
}

function member(out: Out, f: MarkFrame, alpha: number): void {
  if (alpha <= 0.001) return;
  const M = MARKS.member;
  const a = alpha * M.alpha;
  const X = f.hx + M.gap;
  const Y = f.hy + M.gap;
  const R = Math.min(f.r + M.gap, M.radiusMax);
  const L = bracketReach(M.reach, X, Y, R);
  keyed((w, c) => box(out, MARK.brackets, f.cx, f.cy, X, Y, f.angle, R, w, c, L), M.stroke, INK.pencil, a);
}

/** Several's union: square to the mat, 10 out (the selection's frame is 6 out, so the box grows by 4), corner 4. */
function union(out: Out, u: MarkUnion, dpr: number): void {
  if (u.alpha <= 0.001) return;
  const grow = MARKS.union.gap - MARKS.select.gap;
  const f: MarkFrame = { cx: (u.box.x0 + u.box.x1) / 2, cy: (u.box.y0 + u.box.y1) / 2, hx: (u.box.x1 - u.box.x0) / 2 + grow, hy: (u.box.y1 - u.box.y0) / 2 + grow, angle: 0, r: MARKS.union.radius };
  selection(out, f, u.t, u.alpha, false, dpr);
}

// ---------------------------------------------------------------- numbers (chrome.js `pill`) — the rulers' mono atlas

/** The atlas's metrics in CSS px: one character's advance, the cell, the pad, the ascent and descent over the baseline. */
function metrics(atlas: GlyphAtlasMeta): { readonly advance: number; readonly cellW: number; readonly cellH: number; readonly pad: number; readonly ascent: number; readonly descent: number; readonly live: boolean } {
  const s = atlas.scale;
  return {
    advance: atlas.advance / s, cellW: atlas.cellW / s, cellH: atlas.cellH / s, pad: GLYPH_PAD / s,
    ascent: (atlas.baseline - GLYPH_PAD) / s, descent: (atlas.cellH - atlas.baseline - GLYPH_PAD) / s,
    live: atlas.count > 0,
  };
}

/** How wide a string sets in the atlas, CSS px (10 px mono: a 6 px advance before an atlas is here). */
export function textWidth(text: string, atlas: GlyphAtlasMeta): number {
  const m = metrics(atlas);
  return text.length * (m.live ? m.advance : MARKS.pill.size * 0.6);
}

/**
 * A string from the atlas, its baseline's start at (x, y), turned `angle` about that point; every cell on a whole
 * device px (a glyph samples its texels 1:1 where the atlas was made at the view's ratio). `halo` > 0: the
 * coverage dilated that far instead (a label's keyline — chrome.js's 3 px stroked text).
 */
function text(out: Out, s: string, x: number, y: number, angle: number, colour: V4, atlas: GlyphAtlasMeta, dpr: number, halo = 0): void {
  const m = metrics(atlas);
  if (!m.live || colour[3] <= 0) return;
  const c = Math.cos(angle);
  const sn = Math.sin(angle);
  const snap = (v: number): number => Math.round(v * dpr) / dpr;
  for (let i = 0; i < s.length; i++) {
    const cell = GLYPHS.indexOf(s[i] as string);
    if (cell < 0 || cell >= atlas.count) continue;
    // the cell's top-left in the text's own frame, then its centre on screen
    const lx = i * m.advance - m.pad;
    const ly = -(m.ascent + m.pad);
    const ox = angle === 0 ? snap(x + lx) - x : lx;
    const oy = angle === 0 ? snap(y + ly) - y : ly;
    const cx = x + c * (ox + m.cellW / 2) - sn * (oy + m.cellH / 2);
    const cy = y + sn * (ox + m.cellW / 2) + c * (oy + m.cellH / 2);
    out.push({ shape: [MARK.glyph, 0, 0, 0], centre: [cx, cy, angle, 0], half: [m.cellW, m.cellH, 0, 0], colour, aux: [cell, halo, 0, 0], quad: turnedQuad(cx, cy, m.cellW / 2, m.cellH / 2, angle, halo + 1.5) });
  }
}

/** Where a string's baseline sits for it to be centred on `y` (Canvas2D's "middle": the font box's middle). */
function middleBaseline(y: number, atlas: GlyphAtlasMeta): number {
  const m = metrics(atlas);
  return y + (m.ascent - m.descent) / 2;
}

/** A number the desk states: a rounded pill 8 wider than its text and 15 tall, the text centred in it (chrome.js `pill`). */
export function pillBox(x: number, y: number, s: string, align: "center" | "left" | "right", atlas: GlyphAtlasMeta): MarkBox {
  const P = MARKS.pill;
  const w = Math.ceil(textWidth(s, atlas)) + P.pad;
  const h = P.height;
  const px = Math.round(align === "center" ? x - w / 2 : align === "left" ? x : x - w);
  const py = Math.round(y - h / 2);
  return { x0: px, y0: py, x1: px + w, y1: py + h };
}

function pill(out: Out, x: number, y: number, s: string, fill: RGBA, ink: RGBA, align: "center" | "left" | "right", atlas: GlyphAtlasMeta, dpr: number): void {
  const b = pillBox(x, y, s, align, atlas);
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  box(out, MARK.fill, b.x0 + w / 2, b.y0 + h / 2, w / 2, h / 2, 0, MARKS.pill.radius, 0, at(fill, 1));
  text(out, s, b.x0 + w / 2 - textWidth(s, atlas) / 2, middleBaseline(b.y0 + h / 2 + 0.5, atlas), 0, at(ink, 1), atlas, dpr);
}

// ---------------------------------------------------------------- the vellum (chrome.js `drawMarquee`)

function marquee(out: Out, m: MarkMarquee, night: boolean, dpr: number, atlas: GlyphAtlasMeta): void {
  const Q = MARKS.marquee;
  const x0 = Math.min(m.rect.x0, m.rect.x1);
  const x1 = Math.max(m.rect.x0, m.rect.x1);
  const y0 = Math.min(m.rect.y0, m.rect.y1);
  const y1 = Math.max(m.rect.y0, m.rect.y1);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hx = (x1 - x0) / 2;
  const hy = (y1 - y0) / 2;
  box(out, MARK.fill, cx, cy, hx, hy, 0, 0, 0, at(night ? INK.vellumNight : INK.vellumDay, 1));
  box(out, MARK.stroke, cx, cy, hx, hy, 0, 0, 1 / dpr, at(INK.pencil, Q.edge));
  if (x1 - x0 > Q.minSide && y1 - y0 > Q.minSide) {
    const r = 0.01;
    const L = bracketReach(Q.reach, hx, hy, r);
    keyed((w, c) => box(out, MARK.brackets, cx, cy, hx, hy, 0, r, w, c, L), MARKS.select.stroke, INK.pencil, 1);
  }
  if (m.count > 0 && m.pointer !== null) pill(out, m.pointer.x + Q.count[0], m.pointer.y + Q.count[1], String(m.count), INK.pencil, INK.ink, "left", atlas, dpr);
}

// ---------------------------------------------------------------- the laser (chrome.js `drawGuides`, `flare`)

function laser(out: Out, guides: readonly MarkGuide[], bars: readonly MarkBar[], strike: number, view: MarksInput["view"], atlas: GlyphAtlasMeta): void {
  const L = MARKS.laser;
  const dpr = view.dpr;
  const boost = 1 + clamp(strike, 0, 1) * L.strike;
  for (const g of guides) {
    const dotted = g.type === "center";
    const period = dotted ? L.dotted.period : 0;
    const along = (a: number, b: number): [readonly [number, number], readonly [number, number]] => (g.axis === "x" ? [[g.at, a], [g.at, b]] : [[a, g.at], [b, g.at]]);
    const span = g.axis === "x" ? view.height : view.width;
    // a laser level's line runs wall to wall, faint; light, so it is added
    const [w0, w1] = along(0, span);
    const [wide, wideA] = L.wall[0];
    const [thin, thinA] = L.wall[1];
    segment(out, w0, w1, wide, at(INK.laser, wideA), LIGHT, period);
    segment(out, w0, w1, 1 / dpr + thin, at(INK.laser, thinA), LIGHT, period);
    // bright between the objects it aligns
    const [a, b] = along(g.span[0], g.span[1]);
    for (const [w, al] of L.bloom) segment(out, a, b, dotted ? w * L.dotted.bloom : w, at(INK.laser, Math.min(1, al * boost)), LIGHT, period);
    segment(out, a, b, dotted ? L.dotted.line : L.line, at(INK.laserLine, L.alpha), 0, period);
    segment(out, a, b, dotted ? L.dotted.core : L.core, at(INK.laserCore, L.alpha), 0, period);
    for (const [x, y] of g.points) {
      const F = L.flare;
      out.push({ shape: [MARK.flare, LIGHT, 0, 0], centre: [x, y, 0, F.radius], half: [F.stop, 0, 0, 0], colour: at(INK.laser, F.mid), aux: [INK.laserCore[0], INK.laserCore[1], INK.laserCore[2], Math.min(1, F.core * boost)], quad: [x - F.radius - 1, y - F.radius - 1, x + F.radius + 1, y + F.radius + 1] });
    }
  }
  for (const b of bars) {
    const B = L.bar;
    const horizontal = b.axis === "x";
    const A: readonly [number, number] = horizontal ? [b.from, b.perp] : [b.perp, b.from];
    const Z: readonly [number, number] = horizontal ? [b.to, b.perp] : [b.perp, b.to];
    bar(out, A, Z, B.tick, B.bloom[0], at(INK.laser, B.bloom[1]), LIGHT);
    bar(out, A, Z, B.tick, B.line, at(INK.laserLine, L.alpha));
    const mx = (A[0] + Z[0]) / 2;
    const my = (A[1] + Z[1]) / 2;
    const label = String(Math.round(b.gap));
    const len = Math.hypot(Z[0] - A[0], Z[1] - A[1]);
    if (len > B.pillFrom) pill(out, mx, my, label, INK.laser, INK.white, "center", atlas, dpr);
    else pill(out, horizontal ? mx : mx + B.off[0], horizontal ? my - B.off[1] : my, label, INK.laser, INK.white, "center", atlas, dpr);
  }
}

// ---------------------------------------------------------------- your extent on the rulers (chrome.js `drawRulerBand`)

function ruler(out: Out, R: MarkRuler, guides: readonly MarkGuide[], view: MarksInput["view"], atlas: GlyphAtlasMeta): void {
  const K = MARKS.ruler;
  const dpr = view.dpr;
  const m = R.margin;
  const inner = R.margin + R.band;
  const W = view.width;
  const H = view.height;
  const { sel } = R;
  // the top band, clipped to [inner, W − m]: the wash, the two edges, the edge coordinates
  const tx0 = Math.max(sel.x0, inner);
  const tx1 = Math.min(sel.x1, W - m);
  if (tx1 > tx0) box(out, MARK.fill, (tx0 + tx1) / 2, m + R.band / 2, (tx1 - tx0) / 2, R.band / 2, 0, 0, 0, at(INK.pencil, K.wash));
  for (const x of [Math.round(sel.x0) + 0.5, Math.round(sel.x1) - 0.5]) if (x >= inner && x <= W - m) segment(out, [x, m], [x, inner], 1, at(INK.pencil, K.edge));
  const lx = String(Math.round(R.world.x0));
  const rx = String(Math.round(R.world.x1));
  const label = (s: string, x: number, y: number, angle: number, inside: boolean): void => {
    if (!inside) return;
    text(out, s, x, y, angle, at(INK.keyline, K.label.haloAlpha / INK.keyline[3]), atlas, dpr, K.label.halo);
    text(out, s, x, y, angle, at(INK.pencil, 1), atlas, dpr);
  };
  const lw = textWidth(lx, atlas);
  const inTop = (x0: number, x1: number): boolean => x0 >= inner && x1 <= W - m;
  label(lx, sel.x0 - K.label.gap - lw, inner - K.label.lift, 0, inTop(sel.x0 - K.label.gap - lw, sel.x0 - K.label.gap));
  label(rx, sel.x1 + K.label.gap, inner - K.label.lift, 0, inTop(sel.x1 + K.label.gap, sel.x1 + K.label.gap + textWidth(rx, atlas)));
  // the left band, clipped to [inner, H − m]: the same, its labels turned a quarter (reading down)
  const ty0 = Math.max(sel.y0, inner);
  const ty1 = Math.min(sel.y1, H - m);
  if (ty1 > ty0) box(out, MARK.fill, m + R.band / 2, (ty0 + ty1) / 2, R.band / 2, (ty1 - ty0) / 2, 0, 0, 0, at(INK.pencil, K.wash));
  for (const y of [Math.round(sel.y0) + 0.5, Math.round(sel.y1) - 0.5]) if (y >= inner && y <= H - m) segment(out, [m, y], [inner, y], 1, at(INK.pencil, K.edge));
  const ty = String(Math.round(R.world.y0));
  const by = String(Math.round(R.world.y1));
  const tw = textWidth(ty, atlas);
  const inLeft = (y0: number, y1: number): boolean => y0 >= inner && y1 <= H - m;
  label(ty, inner - K.label.lift, sel.y0 - K.label.gap - tw, Math.PI / 2, inLeft(sel.y0 - K.label.gap - tw, sel.y0 - K.label.gap));
  label(by, inner - K.label.lift, sel.y1 + K.label.gap, Math.PI / 2, inLeft(sel.y1 + K.label.gap, sel.y1 + K.label.gap + textWidth(by, atlas)));
  // where a guide stands, the laser ticks the ruler
  for (const g of guides) {
    if (g.axis === "x" && g.at > inner && g.at < W - m) segment(out, [g.at, m + K.tick.inset], [g.at, inner - 1], K.tick.width, at(INK.laser, K.tick.alpha), LIGHT);
    if (g.axis === "y" && g.at > inner && g.at < H - m) segment(out, [m + K.tick.inset, g.at], [inner - 1, g.at], K.tick.width, at(INK.laser, K.tick.alpha), LIGHT);
  }
}

// ---------------------------------------------------------------- the tape (desk.css `.obj-tape`)

/** The two strips on screen: centre, half extents, turn, presence — each pressed from 1.22× on `--vf-ease-lift`. */
export function tapeStrips(t: MarkTape): { readonly cx: number; readonly cy: number; readonly hx: number; readonly hy: number; readonly angle: number; readonly alpha: number }[] {
  const T = MARKS.tape;
  const u = t.units;
  const f = t.frame;
  const turn = (T.turn * Math.PI) / 180;
  // in the object's frame: 5 over its top edge and 20 past each side, 60 × 17 (object units)
  const ox = f.hx - (T.w / 2 - T.past) * u;
  const oy = -f.hy + (T.h / 2 - T.over) * u;
  return ([[-1, -turn], [1, turn]] as const).map(([side, spin], i) => {
    const p = clamp(t.press[i] ?? 1, 0, 1);
    const e = easeLift(p);
    const s = 1 + (T.press - 1) * (1 - e);
    const [cx, cy] = onScreen(f, side * ox, oy);
    return { cx, cy, hx: (T.w / 2) * u * s, hy: (T.h / 2) * u * s, angle: f.angle + spin, alpha: t.alpha * clamp(e, 0, 1) };
  });
}

function tape(out: Out, t: MarkTape, night: boolean): void {
  const T = MARKS.tape;
  const [sat, bright] = night ? [T.night.saturate, T.night.brightness] : [1, 1];
  for (const s of tapeStrips(t)) {
    if (s.alpha <= 0.001) continue;
    out.push({ shape: [MARK.tape, 0, 0, T.fibre.every], centre: [s.cx, s.cy, s.angle, s.alpha], half: [s.hx, s.hy, T.sheen[0], T.sheen[1]], colour: at(INK.tape, 1), aux: [t.units, sat, bright, T.fibre.alpha], quad: turnedQuad(s.cx, s.cy, s.hx, s.hy, s.angle, 1.5) });
  }
}

// ---------------------------------------------------------------- the frame's marks

/** Every mark this frame, in paint order, for the pass. `atlas` = the rulers' glyph atlas (the numbers; none = no numbers). */
export function layoutMarks(input: MarksInput, atlas: GlyphAtlasMeta = NO_GLYPHS): MarkRecord[] {
  const out: MarkRecord[] = [];
  const dpr = input.view.dpr;
  for (const t of input.tape) tape(out, t, input.night);
  for (const o of input.objects) {
    if (o.style === "member") member(out, o.frame, o.alpha);
    else selection(out, o.frame, o.t, o.alpha, o.knobs, dpr);
  }
  if (input.union !== null) union(out, input.union, dpr);
  if (input.marquee !== null) marquee(out, input.marquee, input.night, dpr, atlas);
  if (input.guides.length > 0 || input.bars.length > 0) laser(out, input.guides, input.bars, input.strike, input.view, atlas);
  if (input.ruler !== null) ruler(out, input.ruler, input.guides, input.view, atlas);
  return out;
}

/** The screen box of the frames (each turned frame's extent) — several's union, the menu's anchor. */
export function framesBox(frames: readonly MarkFrame[]): MarkBox | null {
  if (frames.length === 0) return null;
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const f of frames) {
    const [qx0, qy0, qx1, qy1] = turnedQuad(f.cx, f.cy, f.hx, f.hy, f.angle, 0);
    x0 = Math.min(x0, qx0); y0 = Math.min(y0, qy0); x1 = Math.max(x1, qx1); y1 = Math.max(y1, qy1);
  }
  return { x0, y0, x1, y1 };
}

/** A world frame under a camera (`Camera.x/y` = the view's world top-left), CSS px — the marks' one conversion. */
export function frameOnScreen(f: MarkFrame, cam: { readonly x: number; readonly y: number; readonly zoom: number }): MarkFrame {
  const z = cam.zoom;
  return { cx: (f.cx - cam.x) * z, cy: (f.cy - cam.y) * z, hx: f.hx * z, hy: f.hy * z, angle: f.angle, r: f.r * z };
}

/** The box the marks around a selection occupy on screen — the brackets' (6 out) or the union's (10 out): the selection menu's anchor. */
export function selectionBox(frames: readonly MarkFrame[]): MarkBox | null {
  const b = framesBox(frames);
  if (b === null) return null;
  const g = frames.length > 1 ? MARKS.union.gap : MARKS.select.gap;
  return { x0: b.x0 - g, y0: b.y0 - g, x1: b.x1 + g, y1: b.y1 + g };
}
