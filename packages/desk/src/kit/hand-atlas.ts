// THE HAND'S ATLAS — `ice-hand/1` (petition I59): a face's handwriting baked once from its outlines (the baker is
// `@vibecook/ice/desk/bake`, packages/desk/src/bake/) into a small field a kind's fragment shader reads — the ink's edge and
// the moment the pen reaches each texel — beside the pen's own path through every glyph. Two files a face:
//
//   <name>.hand.json   the face's box, each glyph's advance, its rect in the atlas, the pen's origin in that rect, the pen's
//                      path (its length, and its strokes in the order a hand writes them), the face's pair kerning, the source
//                      font and the corrections the bake applied
//   <name>.hand.bin    raw RG8 rows, row 0 at the top, `width × height × 2` bytes: R the signed distance to the ink's edge
//                      (128 = the edge, larger = inside, `range` em across 0..255), G the ARRIVAL (0..255 = 0..1 along the
//                      glyph's whole writing: the moment the nib first covers the texel; where strokes cross, the first to
//                      reach it). Texels outside every glyph's rect are 0, 0.
//
// This module is the format's types, its constants and its TOLERANT reader — pure: no DOM, no GPU, no file (the host
// fetches the two files and hands them in) — and the layout's metrics read off an atlas, so a sheet lays its words by the
// very advances and kerning its ink was baked at. A field the reader does not know is ignored; a field it needs that is
// missing or malformed refuses the atlas with an error that names it, never a half-read atlas.

import type { HandMetrics } from "./text";

/** The format's name, the json's `format`. */
export const HAND_ATLAS_FORMAT = "ice-hand/1";

/** R at the ink's edge: larger is inside. A texel's distance is `(R − 128) / 255 × range` em. */
export const HAND_ATLAS_EDGE = 128;

/**
 * The pen's path as `length` counts it: the strokes' own lengths, plus `HAND_PEN_LIFT` em for each lift between two strokes
 * and `HAND_PEN_DOT` em for each dot (a stroke of one point — the nib's tap, which the arrival fills from its centre out).
 * The arrival (G) runs along that same path, so a stroke's start is reached at (the path before it) / `length`.
 */
export const HAND_PEN_LIFT = 0.1;
export const HAND_PEN_DOT = 0.08;

/** One glyph of the atlas. An inkless glyph (the space, the no-break space) has an advance and nothing else to draw. */
export interface HandAtlasGlyph {
  /** The pen's advance past the glyph, em. */
  readonly advance: number;
  /** Its texels in the atlas, `[x, y, w, h]` (row 0 at the top); absent for an inkless glyph. */
  readonly rect?: readonly [number, number, number, number];
  /** The pen's origin — on the baseline, the glyph's x = 0 — in texels from the rect's top-left; with `rect` only. */
  readonly origin?: readonly [number, number];
  /** The pen's whole path through the glyph, em (lifts and dots counted — `HAND_PEN_LIFT`, `HAND_PEN_DOT`); 0 when inkless. */
  readonly length: number;
  /** The pen's path, stroke by stroke in written order: `[x0, y0, x1, y1, …]` em from the origin, y down; one point is a dot. */
  readonly strokes: readonly (readonly number[])[];
}

/** The `<name>.hand.json` of `ice-hand/1`. */
export interface HandAtlasJson {
  readonly format: typeof HAND_ATLAS_FORMAT;
  readonly family: string;
  readonly weight: number;
  /** Texels per em. */
  readonly em: number;
  /** The em the R channel's 0..255 spans (128 = the edge). */
  readonly range: number;
  /** The face's own box, em above and below the baseline (`HandMetrics.ascent` / `descent`). */
  readonly ascent: number;
  readonly descent: number;
  /** The atlas's texels. */
  readonly width: number;
  readonly height: number;
  /** By code point, decimal. */
  readonly glyphs: Readonly<Record<string, HandAtlasGlyph>>;
  /** Pair kerning by `"<left code point>,<right code point>"`, em (negative tightens); a pair absent is 0. */
  readonly kerning: Readonly<Record<string, number>>;
  /** The font file the atlas was baked from, and its bytes' SHA-256 (hex). */
  readonly source: { readonly file: string; readonly sha256: string };
  /** The ids of the corrections the bake applied to what it derived (bake/corrections.ts). */
  readonly corrections: readonly string[];
}

/** An atlas read: the json's fields, checked, and the texels beside them. */
export interface HandAtlas extends HandAtlasJson {
  /** `width × height × 2` bytes: R the edge, G the arrival (module comment). */
  readonly bin: Uint8Array;
}

const MAX_CODE = 0x10ffff;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const whole = (v: unknown): v is number => Number.isInteger(v);
/** A decimal code point key: digits only, no leading zero, a code point. */
const codeKey = (k: string): boolean => /^(0|[1-9]\d*)$/.test(k) && Number(k) <= MAX_CODE;

/** One glyph's fields, checked against the atlas's size, or the reason it cannot be drawn. */
function readGlyph(key: string, v: unknown, width: number, height: number): HandAtlasGlyph | string {
  const at = `glyph ${key}`;
  if (!isObject(v)) return `${at} is not an object`;
  if (!finite(v.advance)) return `${at}: advance is not a number`;
  const strokes = v.strokes;
  if (!Array.isArray(strokes)) return `${at}: strokes is not a list`;
  const out: (readonly number[])[] = [];
  for (let s = 0; s < strokes.length; s++) {
    const st: unknown = strokes[s];
    if (!Array.isArray(st) || st.length < 2 || st.length % 2 !== 0 || !st.every(finite)) return `${at}: stroke ${s} is not a list of x, y pairs`;
    out.push(st.slice() as number[]);
  }
  if (v.rect === undefined) {
    if (out.length > 0) return `${at}: strokes without a rect`;
    if (v.length !== undefined && !(finite(v.length) && v.length >= 0)) return `${at}: length is not a number`;
    return { advance: v.advance, length: finite(v.length) ? v.length : 0, strokes: out };
  }
  const r = v.rect;
  if (!Array.isArray(r) || r.length !== 4 || !r.every(whole)) return `${at}: rect is not [x, y, w, h] in whole texels`;
  const [x, y, w, h] = r as [number, number, number, number];
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > width || y + h > height) return `${at}: rect [${r.join(", ")}] leaves the ${width} × ${height} atlas`;
  const o = v.origin;
  if (!Array.isArray(o) || o.length !== 2 || !o.every(finite)) return `${at}: origin is not [x, y]`;
  if (!finite(v.length) || v.length < 0) return `${at}: length is not a number`;
  return { advance: v.advance, rect: [x, y, w, h], origin: [o[0] as number, o[1] as number], length: v.length, strokes: out };
}

/**
 * Read an `ice-hand/1` atlas: its parsed json and its texels. Refuses — `{ error }`, naming the field — a wrong format, a
 * missing or malformed field the atlas needs, a glyph whose rect leaves the atlas, and a bin that is not exactly
 * `width × height × 2` bytes; ignores a field it does not know. The atlas it answers holds copies of the json's fields
 * (a later change to the parsed json is not the atlas's) and the bin it was handed.
 */
export function readHandAtlas(json: unknown, bin: Uint8Array): HandAtlas | { readonly error: string } {
  if (!isObject(json)) return { error: "the atlas's json is not an object" };
  if (json.format !== HAND_ATLAS_FORMAT) return { error: `not an ${HAND_ATLAS_FORMAT} atlas (its format is ${JSON.stringify(json.format) ?? "absent"})` };
  if (typeof json.family !== "string") return { error: "family is not a string" };
  if (!finite(json.weight)) return { error: "weight is not a number" };
  if (!finite(json.em) || json.em <= 0) return { error: "em is not a positive number" };
  if (!finite(json.range) || json.range <= 0) return { error: "range is not a positive number" };
  if (!finite(json.ascent) || !finite(json.descent)) return { error: "ascent and descent are not numbers" };
  const { width, height } = json;
  if (!whole(width) || !whole(height) || width <= 0 || height <= 0) return { error: "width and height are not whole positive texels" };
  if (!(bin instanceof Uint8Array)) return { error: "the bin is not bytes" };
  if (bin.length !== width * height * 2) return { error: `the bin is ${bin.length} bytes; a ${width} × ${height} RG8 atlas is ${width * height * 2}` };
  if (!isObject(json.glyphs)) return { error: "glyphs is not an object" };
  const glyphs: Record<string, HandAtlasGlyph> = {};
  for (const [key, v] of Object.entries(json.glyphs)) {
    if (!codeKey(key)) return { error: `glyph key ${JSON.stringify(key)} is not a decimal code point` };
    const g = readGlyph(key, v, width, height);
    if (typeof g === "string") return { error: g };
    glyphs[key] = g;
  }
  if (!isObject(json.kerning)) return { error: "kerning is not an object" };
  const kerning: Record<string, number> = {};
  for (const [key, v] of Object.entries(json.kerning)) {
    const m = /^(\d+),(\d+)$/.exec(key);
    if (m === null || !codeKey(m[1] as string) || !codeKey(m[2] as string)) return { error: `kerning key ${JSON.stringify(key)} is not "<code point>,<code point>"` };
    if (!finite(v)) return { error: `kerning ${key} is not a number` };
    kerning[key] = v;
  }
  const src = json.source;
  if (!isObject(src) || typeof src.file !== "string" || typeof src.sha256 !== "string") return { error: "source is not { file, sha256 }" };
  const corrections = json.corrections;
  if (!Array.isArray(corrections) || !corrections.every((c) => typeof c === "string")) return { error: "corrections is not a list of ids" };
  return {
    format: HAND_ATLAS_FORMAT, family: json.family, weight: json.weight, em: json.em, range: json.range,
    ascent: json.ascent, descent: json.descent, width, height, glyphs, kerning,
    source: { file: src.file, sha256: src.sha256 }, corrections: corrections.slice() as string[], bin,
  };
}

/** An atlas's lookups, made once: glyphs by code point, kerning by pair. */
interface Index {
  readonly glyphs: ReadonlyMap<number, HandAtlasGlyph>;
  readonly kerning: ReadonlyMap<number, number>;
}
const indexes = new WeakMap<HandAtlasJson, Index>();
const pairKey = (a: number, b: number): number => a * (MAX_CODE + 1) + b;
function indexOf(atlas: HandAtlasJson): Index {
  let ix = indexes.get(atlas);
  if (ix === undefined) {
    const glyphs = new Map<number, HandAtlasGlyph>();
    for (const [k, g] of Object.entries(atlas.glyphs)) glyphs.set(Number(k), g);
    const kerning = new Map<number, number>();
    for (const [k, v] of Object.entries(atlas.kerning)) {
      const [a, b] = k.split(",");
      kerning.set(pairKey(Number(a), Number(b)), v);
    }
    ix = { glyphs, kerning };
    indexes.set(atlas, ix);
  }
  return ix;
}

/** The atlas's glyph for a code point, or undefined when the face has none (a sheet with such a glyph keeps the raster road). */
export function glyphOf(atlas: HandAtlasJson, code: number): HandAtlasGlyph | undefined {
  return indexOf(atlas).glyphs.get(code);
}

/**
 * The layout's metrics (kit/text.ts `HandMetrics`) read off the atlas: its ascent and descent, each glyph's baked advance and
 * the baked pair kerning — so `layoutText` places the glyphs exactly where their ink was baked to sit. A character is read by
 * its first code point; one the atlas lacks advances 0 and kerns 0 (ask `glyphOf` first).
 */
export function handMetricsOf(atlas: HandAtlasJson): HandMetrics {
  const ix = indexOf(atlas);
  return {
    ascent: atlas.ascent,
    descent: atlas.descent,
    advance: (ch) => ix.glyphs.get(ch.codePointAt(0) ?? -1)?.advance ?? 0,
    kern: (a, b) => ix.kerning.get(pairKey(a.codePointAt(0) ?? 0, b.codePointAt(0) ?? 0)) ?? 0,
  };
}
