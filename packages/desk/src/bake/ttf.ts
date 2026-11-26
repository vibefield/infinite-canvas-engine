// THE FACE'S FILE, READ (petition I59) — the hand bake's TrueType reader: the outlines (glyf and loca, simple glyphs and
// COMPOSITES, a composite's components kept apart as the PARTS a hand writes one after another — the letter, then its
// accent), the character map (formats 4 and 12), the advances (hmtx under hhea), head and maxp, the face's box (hhea, or
// OS/2's typo numbers under USE_TYPO_METRICS — the rule the browser's text metrics follow, so an atlas lays text where
// the canvas raster laid it), the family and weight (name, OS/2), and pair kerning: GPOS PairPos (formats 1 and 2, through
// Extension lookups) under the `kern` feature of the Latin script (else the default one), or the legacy kern table's
// format 0 when GPOS kerns nothing. TrueType outlines only (a CFF face is refused), no hinting, no GSUB.
//
// Pure TypeScript and Node-safe: the caller hands in the font's bytes. It follows the approach of a small dependency-free
// reader written for baking distance-field atlases (cmap, glyf, hmtx, GPOS pairs), rewritten here; ICE takes no font library.

/** A contour point, font units (y up); `on` = on the curve, else a quadratic's control point. */
export interface FontPoint {
  readonly x: number;
  readonly y: number;
  readonly on: boolean;
}
export type FontContour = readonly FontPoint[];

/** A segment of a contour: a line `[p0, p1]` or a quadratic `[p0, control, p1]` (font units, y up). */
export type FontSegment = readonly [FontPointXY, FontPointXY] | readonly [FontPointXY, FontPointXY, FontPointXY];
export interface FontPointXY {
  readonly x: number;
  readonly y: number;
}

/** One part of a glyph's outline: a SIMPLE glyph's contours, placed by its composite's offset and transform. */
export interface GlyphPart {
  /** The simple glyph it draws (a composite's component, or the glyph itself). */
  readonly id: number;
  readonly contours: readonly FontContour[];
}

/** The face's vertical metrics as its tables hold them, font units (descenders negative). */
export interface FontMetrics {
  readonly hhea: { readonly ascender: number; readonly descender: number; readonly lineGap: number };
  readonly typo?: { readonly ascender: number; readonly descender: number; readonly lineGap: number };
  readonly win?: { readonly ascent: number; readonly descent: number };
  /** OS/2 fsSelection bit 7: the typo numbers are the face's box. */
  readonly useTypoMetrics: boolean;
}

export interface FontFile {
  readonly unitsPerEm: number;
  /** The typographic family (name ID 16, else 1) and the weight class (OS/2, else 400). */
  readonly family: string;
  readonly weight: number;
  /** The face's box, font units above and below the baseline (descent positive): typo under USE_TYPO_METRICS, else hhea. */
  readonly ascent: number;
  readonly descent: number;
  readonly metrics: FontMetrics;
  readonly numGlyphs: number;
  /** The glyph a code point maps to; 0 (.notdef) when the face has none. */
  glyphId(code: number): number;
  /** A glyph's advance, font units. */
  advance(id: number): number;
  /** A glyph's outline as the simple glyphs it is drawn from, in component order (a simple glyph is one part; empty: none). */
  parts(id: number): readonly GlyphPart[];
  /** Is the glyph a composite? */
  composite(id: number): boolean;
  /** The pair kerning between two glyphs, font units (negative tightens). */
  kerning(left: number, right: number): number;
}

const fail = (why: string): never => {
  throw new Error(`ice/bake: ${why}`);
};

/** OS/2 fsSelection bit 7: the typo ascender and descender are the face's box. */
const USE_TYPO_METRICS = 1 << 7;
/** A composite glyph's component flags (the glyf table). */
const ARG_1_AND_2_ARE_WORDS = 1 << 0;
const ARGS_ARE_XY_VALUES = 1 << 1;
const WE_HAVE_A_SCALE = 1 << 3;
const MORE_COMPONENTS = 1 << 5;
const WE_HAVE_AN_X_AND_Y_SCALE = 1 << 6;
const WE_HAVE_A_TWO_BY_TWO = 1 << 7;
const SCALED_COMPONENT_OFFSET = 1 << 11;
const UNSCALED_COMPONENT_OFFSET = 1 << 12;

export function readFont(bytes: Uint8Array): FontFile {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u8 = (o: number): number => view.getUint8(o);
  const i8 = (o: number): number => view.getInt8(o);
  const u16 = (o: number): number => view.getUint16(o);
  const i16 = (o: number): number => view.getInt16(o);
  const u32 = (o: number): number => view.getUint32(o);
  const f2dot14 = (o: number): number => i16(o) / 16384;
  const tag = (o: number): string => String.fromCharCode(u8(o), u8(o + 1), u8(o + 2), u8(o + 3));
  if (bytes.byteLength < 12) fail("the file is too short to be a font");
  const version = u32(0);
  if (version !== 0x00010000 && tag(0) !== "true") fail(`not a TrueType-outline font (its sfnt version is ${JSON.stringify(tag(0))})`);

  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0, n = u16(4); i < n; i++) {
    const record = 12 + i * 16;
    const t = { offset: u32(record + 8), length: u32(record + 12) };
    if (t.offset + t.length > bytes.byteLength) fail(`the ${tag(record)} table runs past the end of the file`);
    tables.set(tag(record), t);
  }
  const need = (name: string): number => tables.get(name)?.offset ?? fail(`the font has no ${name} table`);

  const head = need("head");
  const unitsPerEm = u16(head + 18);
  if (unitsPerEm === 0) fail("head's unitsPerEm is 0");
  const longOffsets = i16(head + 50) === 1;
  const hhea = need("hhea");
  const hheaMetrics = { ascender: i16(hhea + 4), descender: i16(hhea + 6), lineGap: i16(hhea + 8) };
  const numberOfHMetrics = u16(hhea + 34);
  const numGlyphs = u16(need("maxp") + 4);

  let typo: FontMetrics["typo"];
  let win: FontMetrics["win"];
  let useTypoMetrics = false;
  let weight = 400;
  const os2 = tables.get("OS/2")?.offset;
  if (os2 !== undefined) {
    weight = u16(os2 + 4);
    typo = { ascender: i16(os2 + 68), descender: i16(os2 + 70), lineGap: i16(os2 + 72) };
    win = { ascent: u16(os2 + 74), descent: u16(os2 + 76) };
    useTypoMetrics = u16(os2) !== 0xffff && (u16(os2 + 62) & USE_TYPO_METRICS) !== 0;
  }
  const metrics: FontMetrics = { hhea: hheaMetrics, ...(typo === undefined ? {} : { typo }), ...(win === undefined ? {} : { win }), useTypoMetrics };
  // the browser's rule (Skia over FreeType; CoreText reads hhea): typo under USE_TYPO_METRICS, else hhea, else typo, else win
  let box = { ascent: hheaMetrics.ascender, descent: -hheaMetrics.descender };
  if (useTypoMetrics && typo !== undefined) box = { ascent: typo.ascender, descent: -typo.descender };
  else if (box.ascent === 0 && box.descent === 0 && typo !== undefined && (typo.ascender !== 0 || typo.descender !== 0)) box = { ascent: typo.ascender, descent: -typo.descender };
  else if (box.ascent === 0 && box.descent === 0 && win !== undefined) box = { ascent: win.ascent, descent: win.descent };

  // ---- the name table: the typographic family (16), else the family (1); Windows English first, then any Unicode, then Mac Roman
  const family = (() => {
    const name = tables.get("name")?.offset;
    if (name === undefined) return "";
    const count = u16(name + 2);
    const strings = name + u16(name + 4);
    const found = new Map<string, string>();
    for (let i = 0; i < count; i++) {
      const r = name + 6 + 12 * i;
      const platform = u16(r);
      const encoding = u16(r + 2);
      const language = u16(r + 4);
      const id = u16(r + 6);
      const length = u16(r + 8);
      const at = strings + u16(r + 10);
      if (id !== 1 && id !== 16) continue;
      let rank = -1;
      if (platform === 3 && (encoding === 1 || encoding === 10)) rank = language === 0x409 ? 0 : 1;
      else if (platform === 0) rank = 2;
      else if (platform === 1 && encoding === 0) rank = 3;
      if (rank < 0) continue;
      let s = "";
      if (platform === 1) for (let k = 0; k < length; k++) s += String.fromCharCode(u8(at + k));
      else for (let k = 0; k + 1 < length; k += 2) s += String.fromCharCode(u16(at + k));
      const key = `${id}:${rank}`;
      if (!found.has(key)) found.set(key, s);
    }
    for (const id of [16, 1]) for (const rank of [0, 1, 2, 3]) { const s = found.get(`${id}:${rank}`); if (s !== undefined && s !== "") return s; }
    return "";
  })();

  // ---- the advances: the last advance repeats for the glyphs past numberOfHMetrics
  const hmtx = need("hmtx");
  const advance = (id: number): number => (numberOfHMetrics === 0 ? 0 : u16(hmtx + 4 * Math.min(id, numberOfHMetrics - 1)));

  // ---- the outlines
  const loca = need("loca");
  const glyf = need("glyf");
  const locaAt = (id: number): number => (longOffsets ? u32(loca + 4 * id) : 2 * u16(loca + 2 * id));
  const glyphAt = (id: number): number | null => {
    if (id < 0 || id >= numGlyphs) return null;
    const start = locaAt(id);
    const end = locaAt(id + 1);
    return end > start ? glyf + start : null;
  };
  const simpleContours = (at: number, count: number): FontContour[] => {
    const endPoints: number[] = [];
    for (let c = 0; c < count; c++) endPoints.push(u16(at + 10 + 2 * c));
    const points = count > 0 ? (endPoints[count - 1] as number) + 1 : 0;
    let p = at + 10 + 2 * count;
    p += 2 + u16(p);   // past the instructions
    const flags: number[] = [];
    while (flags.length < points) {
      const flag = u8(p++);
      flags.push(flag);
      if (flag & 8) for (let r = u8(p++); r > 0; r--) flags.push(flag);
    }
    const xs: number[] = [];
    const ys: number[] = [];
    for (let k = 0, x = 0; k < points; k++) {
      const flag = flags[k] as number;
      if (flag & 2) { const d = u8(p++); x += flag & 16 ? d : -d; }
      else if (!(flag & 16)) { x += i16(p); p += 2; }
      xs.push(x);
    }
    for (let k = 0, y = 0; k < points; k++) {
      const flag = flags[k] as number;
      if (flag & 4) { const d = u8(p++); y += flag & 32 ? d : -d; }
      else if (!(flag & 32)) { y += i16(p); p += 2; }
      ys.push(y);
    }
    const contours: FontContour[] = [];
    for (let c = 0, k = 0; c < count; c++) {
      const contour: FontPoint[] = [];
      for (; k <= (endPoints[c] as number); k++) contour.push({ x: xs[k] as number, y: ys[k] as number, on: ((flags[k] as number) & 1) === 1 });
      if (contour.length > 0) contours.push(contour);
    }
    return contours;
  };
  const composite = (id: number): boolean => {
    const at = glyphAt(id);
    return at !== null && i16(at) < 0;
  };
  /** A glyph's parts, each placed by the transforms of the composites above it (depth-guarded: a cycle draws nothing more). */
  const partsOf = (id: number, depth: number): GlyphPart[] => {
    const at = glyphAt(id);
    if (at === null || depth > 8) return [];
    const count = i16(at);
    if (count >= 0) {
      const contours = simpleContours(at, count);
      return contours.length > 0 ? [{ id, contours }] : [];
    }
    const out: GlyphPart[] = [];
    let p = at + 10;
    let more = true;
    while (more) {
      const flags = u16(p);
      const component = u16(p + 2);
      p += 4;
      const xy = (flags & ARGS_ARE_XY_VALUES) !== 0;
      let arg1: number;
      let arg2: number;
      if (flags & ARG_1_AND_2_ARE_WORDS) { arg1 = xy ? i16(p) : u16(p); arg2 = xy ? i16(p + 2) : u16(p + 2); p += 4; }
      else { arg1 = xy ? i8(p) : u8(p); arg2 = xy ? i8(p + 1) : u8(p + 1); p += 2; }
      let a = 1;
      let b = 0;
      let c = 0;
      let d = 1;
      if (flags & WE_HAVE_A_SCALE) { a = f2dot14(p); d = a; p += 2; }
      else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) { a = f2dot14(p); d = f2dot14(p + 2); p += 4; }
      else if (flags & WE_HAVE_A_TWO_BY_TWO) { a = f2dot14(p); b = f2dot14(p + 2); c = f2dot14(p + 4); d = f2dot14(p + 6); p += 8; }
      const inner = partsOf(component, depth + 1);
      const place = (x: number, y: number): { x: number; y: number } => ({ x: a * x + c * y, y: b * x + d * y });
      let dx = 0;
      let dy = 0;
      if (xy) {
        dx = arg1;
        dy = arg2;
        // a scaled offset (and not an unscaled one): scaled as FreeType scales it
        if ((flags & SCALED_COMPONENT_OFFSET) !== 0 && (flags & UNSCALED_COMPONENT_OFFSET) === 0) { dx *= Math.sqrt(a * a + c * c); dy *= Math.sqrt(d * d + b * b); }
      } else {
        // point matching: the component's point arg2 lands on the composite's point arg1 (the points placed so far)
        const placed = out.flatMap((q) => q.contours.flat());
        const own = inner.flatMap((q) => q.contours.flat()).map((q) => place(q.x, q.y));
        const anchor = placed[arg1];
        const mine = own[arg2];
        if (anchor !== undefined && mine !== undefined) { dx = anchor.x - mine.x; dy = anchor.y - mine.y; }
      }
      for (const part of inner) {
        out.push({ id: part.id, contours: part.contours.map((contour) => contour.map((q) => { const t = place(q.x, q.y); return { x: t.x + dx, y: t.y + dy, on: q.on }; })) });
      }
      more = (flags & MORE_COMPONENTS) !== 0;
    }
    return out;
  };

  // ---- the character map: a Unicode subtable, format 12 preferred over format 4
  const cmap = need("cmap");
  const glyphId = (() => {
    const candidates: { format: number; offset: number }[] = [];
    for (let i = 0, n = u16(cmap + 2); i < n; i++) {
      const record = cmap + 4 + 8 * i;
      const platform = u16(record);
      const encoding = u16(record + 2);
      const offset = cmap + u32(record + 4);
      if ((platform === 3 && (encoding === 1 || encoding === 10)) || platform === 0) candidates.push({ format: u16(offset), offset });
    }
    const pick = candidates.find((c) => c.format === 12) ?? candidates.find((c) => c.format === 4) ?? fail("the font has no Unicode character map (format 4 or 12)");
    const o = pick.offset;
    if (pick.format === 12) {
      const groups = u32(o + 12);
      return (code: number): number => {
        let lo = 0;
        let hi = groups - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >>> 1;
          const r = o + 16 + 12 * mid;
          if (code < u32(r)) hi = mid - 1;
          else if (code > u32(r + 4)) lo = mid + 1;
          else return u32(r + 8) + code - u32(r);
        }
        return 0;
      };
    }
    const segments = u16(o + 6) / 2;
    const ends = o + 14;
    const starts = ends + 2 * segments + 2;
    const deltas = starts + 2 * segments;
    const ranges = deltas + 2 * segments;
    return (code: number): number => {
      if (code > 0xffff) return 0;
      let lo = 0;
      let hi = segments - 1;
      while (lo < hi) {   // the first segment whose end reaches the code
        const mid = (lo + hi) >>> 1;
        if (u16(ends + 2 * mid) < code) lo = mid + 1;
        else hi = mid;
      }
      if (segments === 0 || u16(ends + 2 * lo) < code) return 0;
      const first = u16(starts + 2 * lo);
      if (first > code) return 0;
      const range = u16(ranges + 2 * lo);
      if (range === 0) return (code + i16(deltas + 2 * lo)) & 0xffff;
      const glyph = u16(ranges + 2 * lo + range + 2 * (code - first));
      return glyph === 0 ? 0 : (glyph + i16(deltas + 2 * lo)) & 0xffff;
    };
  })();

  // ---- pair kerning
  /** A glyph's coverage index, or −1 (format 1: a sorted glyph list; format 2: sorted ranges). */
  const coverageIndex = (o: number, id: number): number => {
    const format = u16(o);
    const n = u16(o + 2);
    let lo = 0;
    let hi = n - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (format === 1) {
        const g = u16(o + 4 + 2 * mid);
        if (g === id) return mid;
        if (g < id) lo = mid + 1;
        else hi = mid - 1;
      } else {
        const r = o + 4 + 6 * mid;
        if (id < u16(r)) hi = mid - 1;
        else if (id > u16(r + 2)) lo = mid + 1;
        else return u16(r + 4) + id - u16(r);
      }
    }
    return -1;
  };
  const classOf = (o: number, id: number): number => {
    const format = u16(o);
    if (format === 1) {
      const first = u16(o + 2);
      return id >= first && id < first + u16(o + 4) ? u16(o + 6 + 2 * (id - first)) : 0;
    }
    let lo = 0;
    let hi = u16(o + 2) - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const r = o + 4 + 6 * mid;
      if (id < u16(r)) hi = mid - 1;
      else if (id > u16(r + 2)) lo = mid + 1;
      else return u16(r + 4);
    }
    return 0;
  };
  const valueSize = (format: number): number => { let n = 0; for (let bit = 0; bit < 8; bit++) if (format & (1 << bit)) n += 2; return n; };
  /** A ValueRecord's XAdvance (bit 2), after its XPlacement and YPlacement when present. */
  const xAdvance = (o: number, format: number): number => (format & 4 ? i16(o + (format & 1 ? 2 : 0) + (format & 2 ? 2 : 0)) : 0);
  /** The PairPos lookups under `kern`, each a list of subtables: the Latin script's default language, else DFLT's, else the first. */
  const pairLookups: number[][] = [];
  const gposTable = tables.get("GPOS")?.offset;
  if (gposTable !== undefined) {
    const gpos = gposTable;
    const scripts = gpos + u16(gpos + 4);
    const features = gpos + u16(gpos + 6);
    const lookups = gpos + u16(gpos + 8);
    const scriptTables = new Map<string, number>();
    for (let i = 0, n = u16(scripts); i < n; i++) scriptTables.set(tag(scripts + 2 + 6 * i), scripts + u16(scripts + 2 + 6 * i + 4));
    const script = scriptTables.get("latn") ?? scriptTables.get("DFLT") ?? [...scriptTables.values()][0];
    const indices = new Set<number>();
    if (script !== undefined) {
      const defaultLang = u16(script);
      const langSys = defaultLang !== 0 ? script + defaultLang : u16(script + 2) > 0 ? script + u16(script + 4 + 4) : 0;
      if (langSys !== 0) {
        for (let k = 0, m = u16(langSys + 4); k < m; k++) {
          const fi = u16(langSys + 6 + 2 * k);
          if (fi >= u16(features)) continue;
          const record = features + 2 + 6 * fi;
          if (tag(record) !== "kern") continue;
          const feature = features + u16(record + 4);
          for (let q = 0, r = u16(feature + 2); q < r; q++) indices.add(u16(feature + 4 + 2 * q));
        }
      }
    }
    for (const index of [...indices].sort((x, y) => x - y)) {
      if (index >= u16(lookups)) continue;
      const lookup = lookups + u16(lookups + 2 + 2 * index);
      const type = u16(lookup);
      const list: number[] = [];
      for (let s = 0, n = u16(lookup + 4); s < n; s++) {
        let sub = lookup + u16(lookup + 6 + 2 * s);
        let subType = type;
        if (type === 9) { subType = u16(sub + 2); sub += u32(sub + 4); }
        if (subType === 2) list.push(sub);
      }
      if (list.length > 0) pairLookups.push(list);
    }
  }
  const pairValue = (sub: number, left: number, right: number): number | null => {
    const coverage = coverageIndex(sub + u16(sub + 2), left);
    if (coverage < 0) return null;
    const format1 = u16(sub + 4);
    const format2 = u16(sub + 6);
    const size1 = valueSize(format1);
    const size2 = valueSize(format2);
    if (u16(sub) === 1) {
      if (coverage >= u16(sub + 8)) return null;
      const set = sub + u16(sub + 10 + 2 * coverage);
      const record = 2 + size1 + size2;
      let lo = 0;
      let hi = u16(set) - 1;
      while (lo <= hi) {   // the pair records are sorted by their second glyph
        const mid = (lo + hi) >>> 1;
        const g = u16(set + 2 + mid * record);
        if (g === right) return xAdvance(set + 2 + mid * record + 2, format1);
        if (g < right) lo = mid + 1;
        else hi = mid - 1;
      }
      return null;
    }
    if (u16(sub) !== 2) return null;
    const class1 = classOf(sub + u16(sub + 8), left);
    const class2 = classOf(sub + u16(sub + 10), right);
    const count1 = u16(sub + 12);
    const count2 = u16(sub + 14);
    if (class1 >= count1 || class2 >= count2) return null;
    return xAdvance(sub + 16 + (class1 * count2 + class2) * (size1 + size2), format1);
  };
  let legacy: Map<number, number> | null = null;
  const kernTable = tables.get("kern")?.offset;
  if (pairLookups.length === 0 && kernTable !== undefined && u16(kernTable) === 0) {
    legacy = new Map();
    for (let t = 0, at = kernTable + 4, n = u16(kernTable + 2); t < n; t++) {
      const length = u16(at + 2);
      const coverage = u16(at + 4);
      // format 0, horizontal, neither minimum nor cross-stream; an override subtable replaces, another adds
      if (coverage >> 8 === 0 && (coverage & 1) === 1 && (coverage & 6) === 0) {
        for (let i = 0, m = u16(at + 6); i < m; i++) {
          const r = at + 14 + 6 * i;
          const key = u16(r) * 65536 + u16(r + 2);
          legacy.set(key, (coverage & 8 ? 0 : (legacy.get(key) ?? 0)) + i16(r + 4));
        }
      }
      if (length === 0) break;
      at += length;
    }
  }
  const kerning = (left: number, right: number): number => {
    if (legacy !== null) return legacy.get(left * 65536 + right) ?? 0;
    let sum = 0;
    // within a lookup the first subtable that covers the pair applies; the lookups add up
    for (const list of pairLookups) {
      for (const sub of list) {
        const value = pairValue(sub, left, right);
        if (value !== null) { sum += value; break; }
      }
    }
    return sum;
  };

  return {
    unitsPerEm, family, weight, ascent: box.ascent, descent: box.descent, metrics, numGlyphs,
    glyphId, advance, composite, kerning,
    parts: (id) => partsOf(id, 0),
  };
}

/**
 * A contour's segments: lines and quadratics, font units. Two off-curve points in a row imply the on-curve point midway; a
 * contour with no on-curve point starts at the midpoint of its first two.
 */
export function contourSegments(points: FontContour): FontSegment[] {
  const expanded: FontPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as FontPoint;
    const q = points[(i + 1) % points.length] as FontPoint;
    expanded.push(p);
    if (!p.on && !q.on) expanded.push({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, on: true });
  }
  const start = expanded.findIndex((p) => p.on);
  if (start < 0) return [];
  const seq = expanded.slice(start).concat(expanded.slice(0, start));
  const segments: FontSegment[] = [];
  const xy = (p: FontPoint): FontPointXY => ({ x: p.x, y: p.y });
  let current = seq[0] as FontPoint;
  for (let k = 1; k <= seq.length;) {
    const p = seq[k % seq.length] as FontPoint;
    if (p.on) {
      if (p.x !== current.x || p.y !== current.y) segments.push([xy(current), xy(p)]);
      current = p;
      k += 1;
    } else {
      const q = seq[(k + 1) % seq.length] as FontPoint;
      segments.push([xy(current), xy(p), xy(q)]);
      current = q;
      k += 2;
    }
  }
  return segments;
}
