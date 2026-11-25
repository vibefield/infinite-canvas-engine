// THE BAKE (petition I59): a TrueType face in, an `ice-hand/1` atlas out (kit/hand-atlas.ts is the format and its reader).
// For every code point of the glyph set the face maps: its pen derived (derive.ts — the skeleton, the habits, the face's
// corrections), its field over its rect, the rects packed on shelves (pack.ts), the face's pair kerning among the set, its
// box, its source's SHA-256; the inkless by rule (`HAND_INKLESS`, the soft hyphen) an advance of 0 and nothing else. Pure
// TypeScript and Node-safe: the caller hands in the font's bytes and writes the two files
// (`text` → `<name>.hand.json`, `bin` → `<name>.hand.bin`; apps/desk/tools/bake-hand.mjs is the CLI). The same bytes in are
// the same bytes out, on every host and every run.

import { HAND_ATLAS_FORMAT, type HandAtlasGlyph, type HandAtlasJson } from "../kit/hand-atlas";
import { correctionsFor, HAND_CORRECTIONS, type HandCorrection } from "./corrections";
import { deriveGlyph, edgeRange, type GlyphField, type GlyphPen, glyphField, SKELETON_PX, strokeLists } from "./derive";
import { packRects } from "./pack";
import { sha256Hex } from "./sha256";
import { readFont } from "./ttf";

/**
 * The glyph set a hand is baked for: printable ASCII (U+0020–U+007E), Latin-1 (U+00A0–U+00FF), and the typographer's marks a
 * note is written with — ‘ ’ ‚ “ ” „ – — … • € ™. A face bakes every one it maps (`HAND_INKLESS` inkless); `bakeHand` reports
 * the rest as `missing`.
 */
export const HAND_GLYPH_SET: readonly number[] = (() => {
  const out: number[] = [];
  for (let c = 0x0020; c <= 0x007e; c++) out.push(c);
  for (let c = 0x00a0; c <= 0x00ff; c++) out.push(c);
  out.push(0x2013, 0x2014, 0x2018, 0x2019, 0x201a, 0x201c, 0x201d, 0x201e, 0x2022, 0x2026, 0x20ac, 0x2122);
  return out;
})();

/**
 * The code points baked INKLESS whatever the face draws for them — an advance of 0, no rect, no strokes, kerning nothing: the
 * soft hyphen (U+00AD). A browser draws one only at a line break it makes there and measures it at no width mid-line (the
 * canvas raster's `measureText`); the hand's `layoutText` breaks a line only at a space or a newline (and by glyph inside a
 * word longer than its line), never at a soft hyphen, so it never draws one. A face that maps none still reports it `missing`.
 */
export const HAND_INKLESS: readonly number[] = [0x00ad];
const INKLESS = new Set(HAND_INKLESS);

/** The atlas's texels an em unless a bake asks for another. */
export const HAND_EM = 64;

export interface BakeHandOptions {
  /** The font file's name, recorded as the atlas's `source.file`. */
  readonly file: string;
  /** The face's family and weight — read from the font (name ID 16, else 1; the OS/2 weight class) unless given. */
  readonly family?: string;
  readonly weight?: number;
  /** Texels per em (`HAND_EM`, 64). */
  readonly em?: number;
  /** The code points to bake (`HAND_GLYPH_SET`); a few make a fast bake for a test. */
  readonly codes?: Iterable<number>;
  /** The corrections to apply where they name the face (`HAND_CORRECTIONS`); [] bakes what the derivation finds alone. */
  readonly corrections?: readonly HandCorrection[];
}

export interface BakedHand {
  /** The atlas's json, and its canonical text — what `<name>.hand.json` holds (`handAtlasText`). */
  readonly json: HandAtlasJson;
  readonly text: string;
  /** `<name>.hand.bin`: `width × height × 2` bytes. */
  readonly bin: Uint8Array;
  /** The code points asked for that the face does not map. */
  readonly missing: readonly number[];
  /** Corrections that named the face but no longer fit what was derived — refused whole (corrections.ts). */
  readonly refused: readonly string[];
}

/** Bake a face's hand: its TrueType bytes in, the atlas out (module comment). Throws for a file that is not a TrueType font. */
export function bakeHand(ttf: Uint8Array, opts: BakeHandOptions): BakedHand {
  const face = readFont(ttf);
  const upm = face.unitsPerEm;
  const family = opts.family ?? face.family;
  const weight = opts.weight ?? face.weight;
  const em = opts.em ?? HAND_EM;
  if (!Number.isInteger(em) || em < 8 || em > 1024) throw new Error(`ice/bake: em must be a whole number of texels from 8 to 1024 (got ${em})`);
  const codes = [...new Set(opts.codes ?? HAND_GLYPH_SET)].filter((c) => Number.isInteger(c) && c >= 0 && c <= 0x10ffff).sort((a, b) => a - b);
  const fixes = correctionsFor(opts.corrections ?? HAND_CORRECTIONS, family, weight);
  const r5 = (v: number): number => +v.toFixed(5) || 0;

  const missing: number[] = [];
  const applied = new Set<string>();
  const refused = new Set<string>();
  const baked: { code: number; id: number; advance: number; pen: GlyphPen | null; field: GlyphField | null; kerns: boolean }[] = [];
  for (const code of codes) {
    if (INKLESS.has(code)) {
      const id = face.glyphId(code);
      if (id === 0) missing.push(code);
      else baked.push({ code, id, advance: 0, pen: null, field: null, kerns: false });
      continue;
    }
    const d = deriveGlyph(face, code, fixes);
    if (d === null) { missing.push(code); continue; }
    if (d.pen !== null) {
      for (const id of d.pen.applied) applied.add(id);
      for (const id of d.pen.refused) refused.add(id);
    }
    baked.push({ code, id: face.glyphId(code), advance: d.advance, pen: d.pen, field: d.pen === null ? null : glyphField(d.pen, upm, em), kerns: true });
  }

  const inked = baked.filter((b) => b.field !== null);
  const packed = packRects(inked.map((b) => ({ w: (b.field as GlyphField).w, h: (b.field as GlyphField).h })));
  const bin = new Uint8Array(packed.width * packed.height * 2);
  const glyphs: Record<string, HandAtlasGlyph> = {};
  let n = 0;
  for (const b of baked) {
    const advance = r5(b.advance / upm);
    if (b.field === null || b.pen === null) { glyphs[b.code] = { advance, length: 0, strokes: [] }; continue; }
    const f = b.field;
    const [x, y] = packed.at[n++] as readonly [number, number];
    for (let j = 0; j < f.h; j++) bin.set(f.bytes.subarray(j * f.w * 2, (j + 1) * f.w * 2), ((y + j) * packed.width + x) * 2);
    glyphs[b.code] = { advance, rect: [x, y, f.w, f.h], origin: [f.origin[0], f.origin[1]], length: +(b.pen.total / SKELETON_PX).toFixed(4), strokes: strokeLists(b.pen) };
  }

  // the pair kerning among the baked glyphs, the pairs the face kerns (em, to 1e-5); an inkless-by-rule glyph kerns nothing
  const kerning: Record<string, number> = {};
  for (const l of baked) {
    for (const r of baked) {
      if (!l.kerns || !r.kerns) continue;
      const k = face.kerning(l.id, r.id);
      if (k === 0) continue;
      const v = r5(k / upm);
      if (v !== 0) kerning[`${l.code},${r.code}`] = v;
    }
  }

  const json: HandAtlasJson = {
    format: HAND_ATLAS_FORMAT, family, weight, em, range: edgeRange(em),
    ascent: r5(face.ascent / upm), descent: r5(face.descent / upm),
    width: packed.width, height: packed.height, glyphs, kerning,
    source: { file: opts.file, sha256: sha256Hex(ttf) },
    corrections: fixes.map((f) => f.id).filter((id, i, all) => applied.has(id) && all.indexOf(id) === i),
  };
  return { json, text: handAtlasText(json), bin, missing, refused: [...refused] };
}

/**
 * An atlas's json as `<name>.hand.json` holds it: the face's fields on the first line, then one glyph a line, one left
 * glyph's kerning a line, and the source and the corrections — so a correction's diff is the glyph it changed. It parses back
 * to the json it was made from; the bytes depend on the json alone.
 */
export function handAtlasText(json: HandAtlasJson): string {
  const { format, family, weight, em, range, ascent, descent, width, height } = json;
  const head = JSON.stringify({ format, family, weight, em, range, ascent, descent, width, height });
  const lines = [`${head.slice(0, -1)},"glyphs":{`];
  const codes = Object.keys(json.glyphs).sort((a, b) => Number(a) - Number(b));
  codes.forEach((c, i) => lines.push(`${JSON.stringify(c)}:${JSON.stringify(json.glyphs[c])}${i < codes.length - 1 ? "," : ""}`));
  lines.push(`},"kerning":{`);
  const byLeft = new Map<number, string[]>();
  const pairs = Object.keys(json.kerning).map((k) => k.split(",").map(Number) as [number, number]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  for (const [l, r] of pairs) {
    const row = byLeft.get(l) ?? [];
    row.push(`"${l},${r}":${JSON.stringify(json.kerning[`${l},${r}`])}`);
    byLeft.set(l, row);
  }
  const rows = [...byLeft.values()];
  rows.forEach((row, i) => lines.push(`${row.join(",")}${i < rows.length - 1 ? "," : ""}`));
  lines.push(`},"source":${JSON.stringify(json.source)},"corrections":${JSON.stringify(json.corrections)}}`);
  return `${lines.join("\n")}\n`;
}
