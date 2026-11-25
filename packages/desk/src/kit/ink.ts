// INK YOU CAN EDIT (petition I60): the value every written object of the desk edits, and the verbs over it. An INK is three rows
// with one entry a UTF-16 unit of its text (the layout's own indexing, as the seeds' cell is): the TEXT, each glyph's SEED — its
// hand (text.ts `hashHand`; seeds.ts the cell) — and each glyph's MARK: the pen that wrote it, the highlighter under it, a line
// struck through it or drawn under it. A kind keeps the three in ONE cell (its conflict group `ink: ["text", "seeds", "marks"]`),
// written in one transaction, so a concurrent edit never pairs one peer's words with another's marks; and every verb here carries
// the three together, so a mark never slides off its words.
//
// The VERBS are pure — an ink in, a new ink out, the one handed never touched — and they are what the editor, a menu's act and an
// agent's tool all call: `splice` (every edit comes down to it), `carryInk` (the platform's edit, carried), `mark`, `replace`,
// `lift` and `paste` (the clipboard: the words travel with their marks and are written again in a fresh hand — the seeds never
// travel), `cleanPiece`, `findQuote` (an agent says where by quoting) and `readWriting` (what it reads). The GEOMETRY reads a laid
// `HandLayout` (text.ts) in its note units: the caret index nearest a point, the word and the laid line around an index, a range as
// one rect a line (the selection's wash), and every mark as the strokes a hand makes.
//
// A MARK is one integer, 3 bits a field, low bits first: the PEN (0 the sheet's own, n `PENS[n − 1]`) · the HIGHLIGHTER (0 none,
// n `HIGHLIGHTERS[n − 1]`) · the STRIKE (0 none, 1 in the words' own pen, n ≥ 2 `PENS[n − 2]`) · the UNDERLINE (as the strike). A
// newline always carries 0. The cell keeps the marks as RUNS — `count:mark`, both in base 36, joined by `,`, the unmarked tail left
// off — so an unmarked sheet stores "" and a cell written before the marks existed reads unmarked. A name is kept by its place, so
// the orders of `PENS` and `HIGHLIGHTERS` are part of the format: a name is only ever added at the end. The reader is TOLERANT: a
// malformed run ends the read, a short row pads with 0, a long one is cut to the text, and a field out of range reads 0 — a
// stranger's pen this build has no name for is dropped, never guessed at. The engine keeps no rich text (design-005 §9's scope
// fence): a mark is a closed set — the desk's own pens and highlighters by name, one a glyph — and it lives here, in the desk's kit.

import { encodeSeeds, seedsFor } from "./seeds";
import { HIGHLIGHTERS, type HandLayout, type HandLine, type HighlighterName, PENS, type PenName } from "./text";

// ------------------------------------------------------------------------------------------------------------------ the value

/** An INK: a written object's text and, one entry a UTF-16 unit of it, each glyph's seed and its mark. */
export interface InkValue {
  readonly text: string;
  /** Each glyph's seed — its hand (text.ts `hashHand`; `layoutText`'s `seeds`). */
  readonly seeds: readonly number[];
  /** Each glyph's mark: its pen · highlighter · strike · underline, 3 bits each from the low end (`penOf` …); a newline's is 0. */
  readonly marks: readonly number[];
}

/** The ink as a kind keeps it: three cells in one conflict group — the text, the seeds (seeds.ts `encodeSeeds`), the marks' runs. */
export interface InkCells {
  readonly text: string;
  readonly seeds: string;
  readonly marks: string;
}

/** Words LIFTED for a clipboard: the text and its marks as the cell keeps them — never the seeds (a paste is written again). */
export interface InkPiece {
  readonly text: string;
  readonly marks: string;
}

/**
 * What `mark` changes over a range — one field: the PEN by name (null: the sheet's own); the HIGHLIGHTER by name (null lifts it);
 * a STRIKE or an UNDERLINE (true: in the words' own pen; a pen's name: in that pen; false lifts it); or every field CLEARED.
 */
export type InkChange =
  | { readonly pen: PenName | null }
  | { readonly highlight: HighlighterName | null }
  | { readonly strike: boolean | PenName }
  | { readonly underline: boolean | PenName }
  | { readonly clear: true };

const PEN_AT = 0;
const HIGHLIGHT_AT = 3;
const STRIKE_AT = 6;
const UNDERLINE_AT = 9;
/** One field's bits, and all four fields'. */
const FIELD = 7;
const ALL = (1 << 12) - 1;
/** Each field: where it lies, and the most it holds — a pen, a highlighter, a line in the words' own pen or in one of the pens. */
const FIELDS: readonly (readonly [number, number])[] = [[PEN_AT, PENS.length], [HIGHLIGHT_AT, HIGHLIGHTERS.length], [STRIKE_AT, PENS.length + 1], [UNDERLINE_AT, PENS.length + 1]];
const NEWLINE = 10;
const SPACE = 32;

/** A glyph's pen, read off its mark: 0 the sheet's own, n `PENS[n − 1]`. */
export const penOf = (mark: number): number => (mark >>> PEN_AT) & FIELD;
/** A glyph's highlighter, read off its mark: 0 none, n `HIGHLIGHTERS[n − 1]`. */
export const highlightOf = (mark: number): number => (mark >>> HIGHLIGHT_AT) & FIELD;
/** The line struck through a glyph, read off its mark: 0 none, 1 in the words' own pen, n ≥ 2 `PENS[n − 2]`. */
export const strikeOf = (mark: number): number => (mark >>> STRIKE_AT) & FIELD;
/** The line drawn under a glyph, read off its mark: as `strikeOf`. */
export const underlineOf = (mark: number): number => (mark >>> UNDERLINE_AT) & FIELD;

/** A mark as this build reads it: a field out of range is 0, and no bit lies past the four fields. */
function sane(mark: number): number {
  let out = 0;
  for (const [at, most] of FIELDS) {
    const v = (mark >>> at) & FIELD;
    if (v <= most) out |= v << at;
  }
  return out;
}

/** The ink's marks as the verbs read them: one a unit of its text, each read as this build reads it, a newline's 0. */
function marksOf(ink: InkValue): number[] {
  const n = ink.text.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = ink.text.charCodeAt(i) === NEWLINE ? 0 : sane(ink.marks[i] ?? 0);
  return out;
}

// ------------------------------------------------------------------------------------------------------------------- the cell

/** One run as the cell keeps it: `count:mark`, both base 36 (either case is read). */
const RUN = /^([0-9a-z]+):([0-9a-z]+)$/i;

/** The marks as the cell keeps them: runs of `count:mark`, both in base 36, joined by `,`, the unmarked tail left off — "" for none. */
export function encodeMarks(marks: ArrayLike<number>): string {
  let end = marks.length;
  while (end > 0 && sane(marks[end - 1] as number) === 0) end -= 1;
  const runs: string[] = [];
  for (let i = 0; i < end; ) {
    const m = sane(marks[i] as number);
    let j = i + 1;
    while (j < end && sane(marks[j] as number) === m) j += 1;
    runs.push(`${(j - i).toString(36)}:${m.toString(36)}`);
    i = j;
  }
  return runs.join(",");
}

/**
 * The marks a cell keeps, for `text`: one a UTF-16 unit, the runs index for index and 0 past them. TOLERANT: a malformed run ends
 * the read, a run past the text is cut, a field out of range reads 0, and a newline reads 0 whatever the cell says.
 */
export function decodeMarks(stored: string, text: string): number[] {
  const n = text.length;
  const out = new Array<number>(n).fill(0);
  let at = 0;
  for (const run of typeof stored === "string" && stored !== "" ? stored.split(",") : []) {
    const m = RUN.exec(run);
    if (m === null || at >= n) break;
    const count = Number.parseInt(m[1] as string, 36);
    const mark = sane(Number.parseInt(m[2] as string, 36));
    for (let k = 0; k < count && at < n; k++) out[at++] = mark;
  }
  for (let i = 0; i < n; i++) if (text.charCodeAt(i) === NEWLINE) out[i] = 0;
  return out;
}

/**
 * A kind's three cells read as one ink (`sheetSeed`: the sheet's own `seed`): the seeds through `seedsFor` — a glyph with no stored
 * seed writes the sheet's own hand — and the marks through `decodeMarks`. A cell written before the marks existed reads unmarked.
 */
export function inkOf(cells: { readonly text: string; readonly seeds?: string | undefined; readonly marks?: string | undefined }, sheetSeed: number): InkValue {
  const text = typeof cells.text === "string" ? cells.text : "";
  return {
    text,
    seeds: seedsFor(text, typeof cells.seeds === "string" ? cells.seeds : "", sheetSeed),
    marks: decodeMarks(typeof cells.marks === "string" ? cells.marks : "", text),
  };
}

/** The ink as its three cells — what a kind writes, the three in one transaction (`encodeSeeds`, `encodeMarks`). */
export function inkCells(ink: InkValue): InkCells {
  const n = ink.text.length;
  return { text: ink.text, seeds: encodeSeeds(ink.seeds.length > n ? ink.seeds.slice(0, n) : ink.seeds), marks: encodeMarks(marksOf(ink)) };
}

// ------------------------------------------------------------------------------------------------------------------ the verbs

/** An index into a text `n` long: whole, clamped to [0, n] (NaN reads 0). */
const clampIndex = (i: number, n: number): number => (i >= n ? n : i > 0 ? Math.floor(i) : 0);

/** A range [from, to) given in either order, clamped to a text `n` long. */
function rangeOf(n: number, from: number, to: number): readonly [number, number] {
  const a = clampIndex(from, n);
  const b = clampIndex(to, n);
  return a <= b ? [a, b] : [b, a];
}

/** What arriving letters carry: each field their two neighbours carry the same value in (none at the text's ends, or by a newline). */
function joinOf(left: number, right: number): number {
  let out = 0;
  for (const [at] of FIELDS) {
    const v = (left >>> at) & FIELD;
    if (v !== 0 && v === ((right >>> at) & FIELD)) out |= v << at;
  }
  return out;
}

/**
 * THE SPLICE every edit comes down to: the glyphs of [from, to) leave and `words` arrive. The glyphs before and after keep their
 * seeds and their marks; the arrivals take fresh seeds (`fresh()`, one a unit, in order) and carry a mark's FIELD only where the
 * glyphs on both sides carry the same value in it — a letter typed inside a highlight is highlighted, one at its edge is not; a
 * newline arrives unmarked. The range is clamped to the text, in either order.
 */
export function splice(ink: InkValue, from: number, to: number, words: string, fresh: () => number): InkValue {
  const n = ink.text.length;
  const [a, b] = rangeOf(n, from, to);
  const was = marksOf(ink);
  const joined = joinOf(a > 0 ? (was[a - 1] as number) : 0, b < n ? (was[b] as number) : 0);
  const seeds: number[] = [];
  const marks: number[] = [];
  // in index order — before, the arrivals, after — so `fresh` is asked as `carrySeeds` asks it (a seed the row lacks is fresh too)
  for (let i = 0; i < a; i++) {
    seeds.push(ink.seeds[i] ?? fresh());
    marks.push(was[i] as number);
  }
  for (let i = 0; i < words.length; i++) {
    seeds.push(fresh());
    marks.push(words.charCodeAt(i) === NEWLINE ? 0 : joined);
  }
  for (let i = b; i < n; i++) {
    seeds.push(ink.seeds[i] ?? fresh());
    marks.push(was[i] as number);
  }
  return { text: ink.text.slice(0, a) + words + ink.text.slice(b), seeds, marks };
}

/**
 * The platform's edit CARRIED (the textarea's new value — what typing gives): the common prefix and suffix of the ink's text and
 * `text` keep their seeds and their marks, and the run between them is `splice`d — `carrySeeds` (text.ts) carried to the marks,
 * agreeing with it seed for seed. The new ink, and the arrived range [from, to).
 */
export function carryInk(ink: InkValue, text: string, fresh: () => number): { readonly ink: InkValue; readonly from: number; readonly to: number } {
  const old = ink.text;
  const max = Math.min(old.length, text.length);
  let pre = 0;
  while (pre < max && old[pre] === text[pre]) pre += 1;
  let suf = 0;
  while (suf < max - pre && old[old.length - 1 - suf] === text[text.length - 1 - suf]) suf += 1;
  const words = text.slice(pre, text.length - suf);
  return { ink: splice(ink, pre, old.length - suf, words, fresh), from: pre, to: pre + words.length };
}

/** A pen's number in a mark (1 is `PENS[0]`); a name the kit does not have throws, naming the kit's. */
function penNumber(name: unknown): number {
  const i = (PENS as readonly unknown[]).indexOf(name);
  if (i < 0) throw new Error(`mark: no pen "${String(name)}" (the kit's: ${PENS.join(", ")})`);
  return i + 1;
}

/** A highlighter's number in a mark (1 is `HIGHLIGHTERS[0]`); a name the kit does not have throws, naming the kit's. */
function highlighterNumber(name: unknown): number {
  const i = (HIGHLIGHTERS as readonly unknown[]).indexOf(name);
  if (i < 0) throw new Error(`mark: no highlighter "${String(name)}" (the kit's: ${HIGHLIGHTERS.join(", ")})`);
  return i + 1;
}

/** A line's value in a mark: true is 1 (the words' own pen), a pen's name its number + 1, false and null 0. */
const lineNumber = (v: unknown): number => (v === true ? 1 : v === false || v === null || v === undefined ? 0 : penNumber(v) + 1);

/** A change resolved once, its names checked before any glyph: the bits it keeps and the bits it sets — `(mark & keep) | set`. */
function changeOf(change: InkChange): { readonly keep: number; readonly set: number } {
  const c = change as { readonly pen?: unknown; readonly highlight?: unknown; readonly strike?: unknown; readonly underline?: unknown; readonly clear?: unknown };
  let keep = c.clear === true ? 0 : ALL;
  let set = 0;
  const put = (at: number, v: number): void => {
    keep &= ~(FIELD << at);
    set = (set & ~(FIELD << at)) | (v << at);
  };
  if ("pen" in c) put(PEN_AT, c.pen === null || c.pen === undefined ? 0 : penNumber(c.pen));
  if ("highlight" in c) put(HIGHLIGHT_AT, c.highlight === null || c.highlight === undefined ? 0 : highlighterNumber(c.highlight));
  if ("strike" in c) put(STRIKE_AT, lineNumber(c.strike));
  if ("underline" in c) put(UNDERLINE_AT, lineNumber(c.underline));
  return { keep, set };
}

/**
 * MARK a range: `change` sets one field over every glyph of [from, to) — the pen (by name; null: the sheet's own), the highlighter
 * (by name; null lifts it), a strike or an underline (true: in the words' own pen; a pen's name; false lifts it) — or `{ clear:
 * true }` sets all four to 0; a change naming several fields sets each, `clear` first. A newline stays 0, the text and the seeds
 * are untouched, and the range is clamped, in either order. A name the kit does not have throws (`mark: no pen "…" (the kit's:
 * …)`) before any glyph is read, so a bad name fails over an empty range too.
 */
export function mark(ink: InkValue, from: number, to: number, change: InkChange): InkValue {
  const { keep, set } = changeOf(change);
  const [a, b] = rangeOf(ink.text.length, from, to);
  const marks = marksOf(ink);
  for (let i = a; i < b; i++) if (ink.text.charCodeAt(i) !== NEWLINE) marks[i] = ((marks[i] as number) & keep) | set;
  return { text: ink.text, seeds: ink.seeds, marks };
}

/** REPLACE a range with other words (an agent's edit): `splice` by its name — the rest of the sheet keeps its hand and its marks. */
export function replace(ink: InkValue, from: number, to: number, words: string, fresh: () => number): InkValue {
  return splice(ink, from, to, words, fresh);
}

/** LIFT a range for a clipboard: its words and their marks as the cell keeps them. The seeds stay behind: a paste is written again. */
export function lift(ink: InkValue, from: number, to: number): InkPiece {
  const [a, b] = rangeOf(ink.text.length, from, to);
  return { text: ink.text.slice(a, b), marks: encodeMarks(marksOf(ink).slice(a, b)) };
}

/**
 * PASTE a piece over a range: its text `splice`d in — written in a fresh hand — and its marks laid over the arrivals field by
 * field: a field the piece names wins; one it leaves at 0 keeps what the splice joined, but for the PEN — a word the piece writes
 * in the sheet's own pen lands in the LANDING sheet's own pen, never in the pen of the words it lands among. A piece is read as a
 * stranger's: a text or marks that is not a string reads as empty, a field out of range is dropped, and seeds on it are never read.
 */
export function paste(ink: InkValue, from: number, to: number, piece: InkPiece, fresh: () => number): InkValue {
  const text = typeof piece.text === "string" ? piece.text : "";
  const own = decodeMarks(typeof piece.marks === "string" ? piece.marks : "", text);
  const [a] = rangeOf(ink.text.length, from, to);
  const laid = splice(ink, from, to, text, fresh);
  const marks = laid.marks.slice();
  for (let i = 0; i < text.length; i++) {
    const p = own[i] as number;   // a newline's is 0, as the splice made it
    let m = (marks[a + i] as number) & ~(FIELD << PEN_AT);
    for (const [at] of FIELDS) {
      const v = (p >>> at) & FIELD;
      if (v !== 0) m = (m & ~(FIELD << at)) | (v << at);
    }
    marks[a + i] = m;
  }
  return { text: laid.text, seeds: laid.seeds, marks };
}

/**
 * A piece CLEANED for a sheet: `\r\n` and `\r` read as `\n`, a tab as a space, a character `keep` refuses is dropped, and the text
 * is cut at `max` UTF-16 units — its marks filtered WITH it, so a dropped character never shifts a mark onto the words after it.
 * `keep` is asked of each character as it will land: a whole code point (a pair is never split, by it or by the cut), after the
 * line-end and tab rules.
 */
export function cleanPiece(piece: InkPiece, keep: (ch: string) => boolean, max = 4000): InkPiece {
  const text = typeof piece.text === "string" ? piece.text : "";
  const marks = decodeMarks(typeof piece.marks === "string" ? piece.marks : "", text);
  const cap = max > 0 ? max : 0;
  let out = "";
  const kept: number[] = [];
  for (let i = 0; i < text.length; ) {
    let width = (text.codePointAt(i) as number) > 0xffff ? 2 : 1;
    let ch = text.slice(i, i + width);
    if (ch === "\r") {
      ch = "\n";
      if (text.charCodeAt(i + 1) === NEWLINE) width = 2;
    } else if (ch === "\t") ch = " ";
    if (keep(ch)) {
      if (out.length + ch.length > cap) break;
      out += ch;
      for (let k = 0; k < ch.length; k++) kept.push(ch === "\n" ? 0 : (marks[i + k] as number));
    }
    i += width;
  }
  return { text: out, marks: encodeMarks(kept) };
}

/** Where an agent's QUOTED words are (`findQuote`): their range, or why there is none. */
export type InkQuote = { readonly from: number; readonly to: number } | { readonly error: "missing" } | { readonly error: "ambiguous"; readonly count: number };

/**
 * Words named by QUOTING them (how an agent says where): the range of `quote` in `text`, matched exactly. Without `occurrence` it
 * must be there once — more is `ambiguous`, with how many times; with it (1 the first) the n-th. Not there, an empty quote or no
 * such occurrence is `missing`. Every start counts, overlapping ones too: "aa" is in "aaa" twice.
 */
export function findQuote(text: string, quote: string, occurrence?: number): InkQuote {
  const at: number[] = [];
  if (typeof quote === "string" && quote !== "") for (let i = text.indexOf(quote); i >= 0; i = text.indexOf(quote, i + 1)) at.push(i);
  if (occurrence !== undefined) {
    const i = Number.isInteger(occurrence) && occurrence >= 1 ? at[occurrence - 1] : undefined;
    return i === undefined ? { error: "missing" } : { from: i, to: i + quote.length };
  }
  const first = at[0];
  if (first === undefined) return { error: "missing" };
  if (at.length > 1) return { error: "ambiguous", count: at.length };
  return { from: first, to: first + quote.length };
}

/** A marked run as an agent reads it: its words [from, to) and their marks by name — a line `true` is in the words' own pen. */
export interface InkRun {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly pen?: PenName;
  readonly highlight?: HighlighterName;
  readonly strike?: true | PenName;
  readonly underline?: true | PenName;
}

/** A line's value by name: 1 is true (the words' own pen), n ≥ 2 `PENS[n − 2]`. */
const lineName = (v: number): true | PenName => (v === 1 ? true : (PENS[v - 2] as PenName));

/**
 * What an agent READS: the text, and every MARKED run in it — the longest stretch of one mark, which never crosses a newline, its
 * spaces at either end left off — with its marks by name. Unmarked words are not listed, nor is a run of spaces alone.
 */
export function readWriting(ink: InkValue): { readonly text: string; readonly runs: readonly InkRun[] } {
  const { text } = ink;
  const marks = marksOf(ink);
  const runs: InkRun[] = [];
  for (let i = 0; i < text.length; ) {
    const m = marks[i] as number;
    let j = i + 1;
    while (j < text.length && marks[j] === m) j += 1;
    let a = i;
    let b = j;
    while (a < b && text.charCodeAt(a) === SPACE) a += 1;
    while (b > a && text.charCodeAt(b - 1) === SPACE) b -= 1;
    if (m !== 0 && a < b) {
      const pen = penOf(m);
      const highlight = highlightOf(m);
      const strike = strikeOf(m);
      const underline = underlineOf(m);
      runs.push({
        from: a,
        to: b,
        text: text.slice(a, b),
        ...(pen > 0 ? { pen: PENS[pen - 1] as PenName } : {}),
        ...(highlight > 0 ? { highlight: HIGHLIGHTERS[highlight - 1] as HighlighterName } : {}),
        ...(strike > 0 ? { strike: lineName(strike) } : {}),
        ...(underline > 0 ? { underline: lineName(underline) } : {}),
      });
    }
    i = j;
  }
  return { text, runs };
}

// --------------------------------------------------------------------------------------------------------------- the geometry

/** The sliver past a line's end that a range running to it shows (its newline, or its wrap, selected), em. */
const SLIVER = 0.2;
/**
 * Where a mark's stroke lies off its line's baseline, em, y down (the design's prototype): a highlighter's band centred, and a
 * strike, 0.2 em above it — the x-height's middle — and an underline 0.15 em under it.
 */
const STROKE_Y = { highlight: -0.2, strike: -0.2, underline: 0.15 } as const;
const KINDS = ["highlight", "strike", "underline"] as const;

/**
 * The caret index nearest a point (`x`, `y`, the layout's note units) — where a tap puts the pen, where a drag ends: the note's own
 * scoring (its writing's `caretIndexIn`, which can delegate here). Every caret place, before each index and after the last, scores
 * its distance across plus THREE times its distance down from its line's middle (0.4 of the ascent above the baseline) — lines
 * weigh three times the columns — and the first of equals wins. `length` is the text's: no place past it is scored.
 */
export function indexIn(L: HandLayout, x: number, y: number, length: number): number {
  const P = L.positions;
  const last = Math.min(length, P.length / 2 - 1);
  let best = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i <= last; i++) {
    const score = Math.abs((P[2 * i + 1] as number) - L.ascent * 0.4 - y) * 3 + Math.abs((P[2 * i] as number) - x);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

const isHigh = (c: number): boolean => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff;
/** A letter, a digit, or a letter's mark (a combining accent): a word's. */
const WORDY = /^[\p{L}\p{M}\p{N}]$/u;
/** The two apostrophes a word holds: ' and ’. */
const APOSTROPHE = 0x0027;
const RIGHT_QUOTE = 0x2019;

/** What the unit at `i` is to a double click: a word's (a pair's half reads as its character), a space, a break (a newline, or past the text) or other. */
function unitAt(text: string, i: number): "word" | "space" | "break" | "other" {
  if (i < 0 || i >= text.length) return "break";
  const c = text.charCodeAt(i);
  if (c === NEWLINE) return "break";
  if (c === APOSTROPHE || c === RIGHT_QUOTE) return "word";
  const start = isLow(c) && i > 0 && isHigh(text.charCodeAt(i - 1)) ? i - 1 : i;
  if (WORDY.test(String.fromCodePoint(text.codePointAt(start) as number))) return "word";
  return /\s/.test(text.charAt(i)) ? "space" : "other";
}

/**
 * The WORD around an index (a double click): letters, digits, their marks and apostrophes (' and ’) are a word's; on a space, the
 * run of spaces; on anything else, that one character (a pair whole). The caret just after a word takes that word rather than what
 * follows it; between two newlines, or in an empty text, the empty range at the index.
 */
export function wordAt(text: string, index: number): { readonly from: number; readonly to: number } {
  const n = text.length;
  const i = clampIndex(index, n);
  const right = unitAt(text, i);
  const left = unitAt(text, i - 1);
  const anchor = right === "word" ? i : left === "word" ? i - 1 : right !== "break" ? i : left !== "break" ? i - 1 : -1;
  if (anchor < 0) return { from: i, to: i };
  const unit = unitAt(text, anchor);
  if (unit === "other") {
    const c = text.charCodeAt(anchor);
    if (isHigh(c) && isLow(text.charCodeAt(anchor + 1))) return { from: anchor, to: anchor + 2 };
    if (isLow(c) && anchor > 0 && isHigh(text.charCodeAt(anchor - 1))) return { from: anchor - 1, to: anchor + 1 };
    return { from: anchor, to: anchor + 1 };
  }
  let a = anchor;
  let b = anchor + 1;
  while (a > 0 && unitAt(text, a - 1) === unit) a -= 1;
  while (b < n && unitAt(text, b) === unit) b += 1;
  return { from: a, to: b };
}

/**
 * The laid LINE around an index (a third click): the layout's own [start, end) — a broken line's takes its newline, a wrapped
 * line's its trailing spaces. An index on a line's end is the next line's (the caret there stands at that line's start).
 */
export function lineAt(L: HandLayout, index: number): { readonly from: number; readonly to: number } {
  const i = clampIndex(index, L.positions.length / 2 - 1);
  const last = L.lines.length - 1;
  for (let k = 0; k <= last; k++) {
    const ln = L.lines[k] as HandLine;
    if (i < ln.end || k === last) return { from: ln.start, to: ln.end };
  }
  return { from: i, to: i };
}

/** Where a laid line's writing ends: its first caret place and its width — past its trailing spaces, before its newline. */
const rightOf = (L: HandLayout, ln: HandLine): number => (L.positions[2 * ln.start] as number) + ln.width;

/** A range's WASH on one laid line: the caret's places at the range's ends there, and the caret's height on the line (note units). */
export interface InkSpan {
  readonly line: number;
  readonly x0: number;
  readonly x1: number;
  /** The caret's top and bottom: the baseline less the face's ascent, and plus its descent. */
  readonly y0: number;
  readonly y1: number;
}

/**
 * A range as the rects its WASH draws, one a laid line it touches, from the caret's places: from the caret before its first glyph
 * on the line to the caret after its last, the caret's height tall. A line the range runs to the end of (and that is not the last)
 * shows a sliver past its end, a fifth of an em — its newline or its wrap selected — so an empty line in a range is seen. The range
 * is clamped to the layout's text, in either order; an empty one draws nothing.
 */
export function spansOf(L: HandLayout, from: number, to: number): InkSpan[] {
  const P = L.positions;
  const [a, b] = rangeOf(P.length / 2 - 1, from, to);
  const out: InkSpan[] = [];
  if (a === b) return out;
  for (let k = 0; k < L.lines.length; k++) {
    const ln = L.lines[k] as HandLine;
    const s = Math.max(a, ln.start);
    const e = Math.min(b, ln.end);
    if (s >= e) continue;
    const y = P[2 * s + 1] as number;
    const end = e < ln.end ? (P[2 * e] as number) : rightOf(L, ln);
    const past = e === ln.end && k < L.lines.length - 1;
    out.push({ line: k, x0: P[2 * s] as number, x1: past ? end + SLIVER * L.em : end, y0: y - L.ascent, y1: y + L.descent });
  }
  return out;
}

/** A mark as the STROKE a hand makes: one a laid line for each run of glyphs that share its value (note units, y down). */
export interface MarkStroke {
  readonly line: number;
  readonly kind: "highlight" | "strike" | "underline";
  /**
   * A highlighter's number (n: `HIGHLIGHTERS[n − 1]`), or a line's pen with "the words' own" read as the words': 1 the sheet's own
   * pen, n ≥ 2 `PENS[n − 2]`.
   */
  readonly value: number;
  /** The glyphs it runs over, [from, to), its ends trimmed of spaces: its first glyph's seed is the stroke's own. */
  readonly from: number;
  readonly to: number;
  /** Its ends: the caret's places before its first glyph and after its last. */
  readonly x0: number;
  readonly x1: number;
  /** Its line: a highlighter's band's middle and a strike 0.2 em above the baseline, an underline 0.15 em under it. */
  readonly y: number;
}

/** A glyph's value for a stroke of `kind`: its highlighter; or its line, "in the words' own pen" read as its own (1 for the sheet's). */
function valueAt(kind: MarkStroke["kind"], m: number): number {
  if (kind === "highlight") return highlightOf(m);
  const v = kind === "strike" ? strikeOf(m) : underlineOf(m);
  if (v !== 1) return v;
  const p = penOf(m);
  return p === 0 ? 1 : p + 1;
}

/**
 * Every mark as the STROKES a hand makes over a laid ink (`L` laid from `ink`'s text): for each laid line, each kind in its order —
 * the highlighter's bands, then the lines through, then the lines under — one stroke for each run of glyphs that share its VALUE
 * (the field's, so a highlight runs on across a change of pen), never across a newline, its ends trimmed of spaces. A line "in the
 * words' own pen" takes each word's pen, so it is split where their pen changes — but never at a space between them: a space's own
 * pen is never seen, and it runs on in the run's. Its places are the caret's (`x0`, `x1`), its `y` the stroke's line (`STROKE_Y`'s
 * offsets: −0.2 em for a band's middle and a strike, +0.15 em for an underline).
 */
export function strokesOf(L: HandLayout, ink: InkValue): MarkStroke[] {
  const out: MarkStroke[] = [];
  const { text } = ink;
  const marks = marksOf(ink);
  const P = L.positions;
  const space = (i: number): boolean => text.charCodeAt(i) === SPACE;
  for (let k = 0; k < L.lines.length; k++) {
    const ln = L.lines[k] as HandLine;
    const end = Math.min(ln.end, text.length);
    for (const kind of KINDS) {
      const own = (m: number): number => (kind === "strike" ? strikeOf(m) : kind === "underline" ? underlineOf(m) : 0);
      for (let i = ln.start; i < end; ) {
        const v = valueAt(kind, marks[i] as number);
        if (v === 0 || space(i)) {
          i += 1;
          continue;
        }
        let j = i + 1;
        while (j < end) {
          const m = marks[j] as number;
          if ((space(j) && own(m) === 1 ? v : valueAt(kind, m)) !== v) break;
          j += 1;
        }
        let e = j;
        while (e > i && space(e - 1)) e -= 1;
        out.push({ line: k, kind, value: v, from: i, to: e, x0: P[2 * i] as number, x1: e < ln.end ? (P[2 * e] as number) : rightOf(L, ln), y: (P[2 * i + 1] as number) + STROKE_Y[kind] * L.em });
        i = j;
      }
    }
  }
  return out;
}
