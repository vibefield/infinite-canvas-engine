// The desk's WRITING (design-015 §6.1; D2c) — the paper kind's own state on one desk: every note's
// hand LAYOUT, where its INK lives (the pen's run or the raster's pages), the pen's moments, the wipe and the
// editor's CARET. Flux, never a world fact (design-015 §2.3): the facts are the note's durable cells (its text
// and its seeds — seeds.ts — its seed, its size); what is drawn from them is cached here, per entity, keyed so
// that nothing is redone on a frame.
//
// TWO ROADS, per sheet (petition I59 — the desk's pen; kit/hand-run.ts, kit/hand.wgsl):
//
// - THE PEN, when the desk lends its hand's faces (`HAND_FACES`) and the note's face is among them: the sheet's
//   words are a GLYPH RUN (`handRun` — a few numbers a glyph and a grid over its writing) in the kind's run store,
//   read by the note's own shader with the face's baked atlas, so they are sharp at every zoom with no raster per
//   zoom rung. The layout is laid by the face's own metrics (`handMetricsOf` — the very advances its ink was baked
//   at); each glyph's MOMENT is asked of the desk's one pen clock (`createPenClock`, kit/pen-clock.ts — keyed by the
//   glyph's seed, so an edit around a glyph never writes it again): a glyph the note's own typing wrote is written
//   as TYPED, the rest as they ARRIVE (a paste, a peer, an undo), and a sheet's first look writes nothing (a desk
//   opening, a face landing). The run is built and written only when the layout or the moments change — never on a
//   pan, a zoom or a redraw; while the pen moves, only its time moves (`NoteRuns.at`, the pass's knobs) and the
//   kind asks a frame with no record remade (`KindHost.redraw`). While the face is still on its way the sheet waits
//   BLANK, as a sheet waits for its font — never a stand-in hand that re-writes itself when the face lands.
// - THE RASTER (today's road, below) when no faces are lent, the note's face is not lent or would not load, the run
//   would name a glyph the face lacks (an emoji, CJK — `run.missing`), or the device holds no more runs.
// A PINNED raster (a parity still's committed ink, `pin`) wins over both and is never re-rastered.
//
// The raster road, as it was:
// - the LAYOUT (text.ts `layoutText`, pure) is keyed by the face, the text raster's version (a face
//   landing re-lays every note — the prototype's `fontVersion`), the hand's law, the sheet's size, the
//   note's seed, and the text with its seeds — the "text revision" is the content itself, so two equal
//   writings share a layout and an undo that restores a text restores its layout;
// - the RASTER (the host's `TextRaster`) is keyed by that layout, the BAND and the pen's bleed. The band
//   is the prototype's √2 ladder with hysteresis (paper.ts `rasterBand`): re-rastered on an edit or a
//   rung crossing only, never on a pan or a wobble. Only a note within `marginPx` (200) CSS px of the
//   view pays for a raster; one further out keeps what it has.
// - its PAGES are the paper pass's shelves (pages.ts): a raster of the same size is redrawn in its own
//   rect; a new size frees the old rect first; a note that leaves the desk for good (`forget` — its ghost
//   faded, a nav cut) frees its rect, so a delete leaks no page slot and an undo that respawns re-rasters.
//   Pages full ⇒ the rasters no one drew in the last two frames are evicted, oldest first; still full ⇒
//   the sheet draws BLANK, honestly, and `stats().blanks` says so.
//
// - THE QUEUE (K6b, design-016 §6 — the desk's frame raster queue, `KindHost.rasters`): a raster at another BAND (a rung
//   crossed) or a note's FIRST (it came on screen holding none, the face landed) is ASKED, not drawn in the frame that asked — a
//   zoom across a rung asked it of every note near the view at once (193 ms: 108 notes). The queue lays it in its turn, under the
//   frame's budget: first what shows nothing (a blank sheet), then what shows its ink magnified (a band short of the screen's),
//   then what shows it minified (a band past it — the pages' room), the nearest the view's centre first within each; meanwhile the
//   raster it holds STANDS, scaled by the pass (a rung is √2: a magnified stand-in is at most one rung soft until its turn), and
//   the new one is found room BEFORE the old is let go. Laid, the note's record is remade (`remake`) — the record says where its
//   ink is. A raster whose WORDS moved (an edit, a resize) is laid at once, in the frame that asked: the ink never lags the caret.
//   Without a queue (a bare host, the tests) every raster is laid at once, as before.
//
// Without a text raster (the Node oracle) nothing is rastered live: the pinned rasters only (and the pen, when faces are lent).
//
// The WIPE (110 ms — the raster road's; the pen's moments replace it on the pen road) and the CARET (blink 530 ms) are the
// editor's flux, clocked by the frame's `now` (`tick`, once a tick, before the draw): `tick` answers whether a frame is wanted —
// every tick while a wipe runs, once per blink phase while the caret stands, once when a face lands or the editor moves.
//
// THE MARKS (petition I60 — "Editing the Ink"): a sheet's words are an INK (kit/ink.ts — its text, each glyph's seed and each glyph's
// mark: the pen that wrote it, a highlighter under it, a line through it, one under it — the note's `marks` cell beside its text and
// seeds). On the pen's road the run is built FROM THE INK (`handRun({ ink, marked, wash })`): each glyph in its own pen, and a marks
// section the kit's `ink_marks` reads beside `hand_ink` — the highlighters, the strokes through and under the words, and the
// selection's WASH. The marks' moments are the same pen clock's (`clock.marks`, after the frame's `look`): a mark made here, by a peer
// or by an agent is drawn once from when it is seen — a highlighter's band, a line pulled through, a word re-inked in its new pen along
// its own path — and a desk opening draws nothing. The run is built again only when its layout, its moments or its marks' moments
// change; the SELECTION is flux and rewrites the wash ALONE (`inkWash`, `NoteRuns.wash` — the marks' head and a texel a laid line: never
// the run rebuilt, never stored), cleared when the lease ends. A sheet on the RASTER road keeps its letters in the sheet's pen (the
// raster's) and draws its strokes and its wash over the raster from a run that carries the marks section alone (no glyphs, no pen's
// moments: every mark on the paper at once) — while the desk lends its faces (the run is built against the note's face).
//
// Where the WRITING LIES (petition I60 — a drag across the words selects them, a second click takes a word, a third a line): the
// caret index on the sheet under a world point (`indexAt` — none off the sheet), the word or the laid line around an index
// (`rangeAt`, the pure `wordRange` and `lineRange`), all from what was last drawn. The editor's SELECTION is flux here as the caret is
// (`select`, `selectionOf`): the platform's field holds it, it is never stored or synced, and the note draws it as the wash. Where a
// RANGE of the words lies (`rangeBox` — the selection menu comes to the words selected): the union of their glyph boxes, placed on the
// sheet as last drawn, the box of the turned corners for a sheet at its tilt.

import type { Entity } from "@ice/core";
import { type KindHost, rasterPriority } from "@ice/desk";
import { type View, HAND, HAND_WEIGHT, caretAt, createPenClock, encodeMarks, glyphBox, glyphOf, type HandAtlas, type HandFaces, type HandLaw, type HandLayout, handMetricsOf, type HandRun, handRun, type InkValue, type InkWash, inkOf, inkWash, layoutText, type MarkStroke, type PenClock, type PenHow, type PenKey, type PenMarks, type PenMoment, type RangeBox, spansOf, strokesOf, type TextRange, type TextRaster, type TextUnit, seedsFor } from "@ice/desk/kit";
import { PAPER } from "./theme";
import type { PaperInstance } from "./layout";
import type { InkRect, UvRect } from "./pages";
import { INK_PAGE } from "./paper-pass";
import { type PaperGeometry, localOf, rasterBand, sdPaper, worldOf } from "./paper";

/** The pages a writing allocates in — the root paper pass (paper-pass.ts) satisfies it. */
export interface InkPages {
  alloc(w: number, h: number): InkRect | null;
  free(r: InkRect): void;
  write(r: InkRect, bytes: Uint8Array<ArrayBuffer>): UvRect;
  /** Every rect forgotten (the shelves carved afresh); `clear` zeroes the texels too. */
  reset(clear?: boolean): void;
  /** Give back the layers' trailing empty rows (pages.ts `trim`). */
  trim?(): number;
}

/**
 * Where a pen-road sheet's writing lives on the GPU (petition I59) — the root paper pass's `runs` (paper-pass.ts) satisfies it: the
 * kind's run store (kit/hand-gpu.ts `HandRuns`, shared by its slots), the face its pass binds, and the pen's time its knobs carry.
 */
export interface NoteRuns {
  /** Note `key`'s run written (in its own room while it fits): its BASE — what its record hands `hand_ink` — or −1 when the device holds no more. */
  write(key: PenKey, run: HandRun): number;
  /** Note `key`'s room given back (it left the desk, or left the pen road). */
  free(key: PenKey): void;
  /** The face every pen-road sheet of the kind is read in — one a pass (`handAtlasGpu`), handed once it has landed. */
  face(atlas: HandAtlas): void;
  /** The pen's time, ms on the desk's clock: every slot's knobs carry it (`penNow`), and the run's moments are read against it. */
  at(ms: number): void;
  /**
   * Note `key`'s selection WASH rewritten in the run it holds (petition I60 — kit/hand-gpu.ts `HandRuns.wash`: the marks' head and a texel
   * a laid line, the rest untouched). False when it holds no run, or one with no room for it.
   */
  wash?(key: PenKey, wash: InkWash): boolean;
}

/** The hand's law as theme.ts states it (`HAND`) — the engine's unless a host says. */
export const DEFAULT_HAND_LAW: HandLaw = HAND;
/** The default face — Caveat medium (STICKY.md §3; the app ships the file). */
export const DEFAULT_FACE = "caveat";
/** The pen's bleed, note units — a faint stroke under each glyph (STICKY.md §3). */
export const DEFAULT_BLEED = 0.3;

export interface WritingOptions {
  /** The ink pages — the root paper pass once the ground is made; `undefined` before (a sheet waits). */
  readonly pages: () => InkPages | undefined;
  /** The host's text raster (desk/host/ink.ts); absent — the Node oracle — nothing is rastered live. */
  readonly text?: TextRaster | undefined;
  /**
   * THE PEN (petition I59): the hand's faces the desk lends (`HAND_FACES` — the app's baked atlases, or `handFacesOf` in Node). A
   * sheet in a face among them that has landed writes with the pen; absent, every sheet takes the raster road.
   */
  readonly faces?: HandFaces | undefined;
  /** The pen's room on the GPU — the root paper pass's `runs` once the ground is made; `undefined` before (a pen-road sheet waits). */
  readonly runs?: () => NoteRuns | undefined;
  /** The builder's door to DRAW AGAIN with no record remade (`KindHost.redraw`): asked while the pen moves. Absent, the records are remade. */
  readonly redraw?: (() => void) | undefined;
  /** The desk's pen clock — this writing's own unless a host (a test) hands one. */
  readonly clock?: PenClock;
  readonly hand?: HandLaw;
  readonly face?: string;
  readonly bleed?: number;
  /**
   * The pen's weight, em (petition I59 — the kit's `HAND_WEIGHT`, the desk's: the outline moved outward by it, so the pen lays the
   * canvas raster's ink); 0, the face's own outline. The pen's road's alone: the raster lays the face as the canvas draws it.
   */
  readonly weight?: number;
  /** K7b — the far LOD's low edge (theme.ts `PAPER.far`), CSS px of the sheet's longer side: under it no raster is held or asked (the note greeks). */
  readonly far?: number;
  /** A typed glyph's wipe, ms (theme.ts `HAND.wipeMs`) — the raster road's. */
  readonly wipeMs?: number;
  /** The caret's blink, ms (theme.ts `PAPER.caret.blinkMs`). */
  readonly blinkMs?: number;
  /** Only a note within this many CSS px of the view pays for a raster (the prototype's 200). */
  readonly marginPx?: number;
  /**
   * The builder's word on what is DRAWN (D6, persistent records — `KindHost.drawn`): the paint rank of a note in the root slot this
   * frame, undefined when it is not drawn. With it, "drawn" means the builder's set, not the last `draw` call (a reused record makes
   * none): the eviction spares what is on screen and `noteAt` ranks by paint order. Absent, the writing counts its own draws.
   */
  readonly drawn?: ((e: Entity) => number | undefined) | undefined;
  /** The desk's frame raster queue (K6b, `KindHost.rasters`): a new band or a first raster is asked there; absent, laid at once. */
  readonly queue?: KindHost["rasters"];
  /** The builder's door (K6b, `KindHost.remake`): a note's record remade once the queue laid its raster. */
  readonly remake?: KindHost["remake"];
}

/** What a note draws with this frame — the paper kind's record takes it whole. */
export interface NoteInk {
  readonly raster?: { readonly layer: number; readonly uv: UvRect };
  /** The pen road's (petition I59): where the sheet's run lives in the kind's run store. */
  readonly pen?: PaperInstance["pen"];
  readonly wipe?: PaperInstance["wipe"];
  readonly caret?: PaperInstance["caret"];
}

/** Where a note's ink lives and what it was drawn at — the rigs' witness (the raster road's). */
export interface NoteRasterInfo {
  readonly band: number;
  readonly w: number;
  readonly h: number;
  readonly layer: number;
  readonly x: number;
  readonly y: number;
  readonly pinned: boolean;
}

/**
 * The road a sheet took at its last draw (petition I59): the PEN; the RASTER; WAITING for its face (blank); PINNED (a still's
 * committed raster, over both).
 */
export type NoteRoad = "pen" | "raster" | "waiting" | "pinned";

/** A pen-road sheet's run, as last written — the raster's `NoteRasterInfo`'s twin (petition I59). */
export interface NotePenInfo {
  /** Its base in the kind's run store (the record's). */
  readonly base: number;
  /** The glyphs it lays, and its size in vec4s. */
  readonly glyphs: number;
  readonly length: number;
  /** The face it is read in (`PEN_FACES`' name) and that face's atlas. */
  readonly face: string;
  readonly atlas: HandAtlas;
  /** The run itself, as built (`handRun`) — what `handInkAt` and `inkMarksAt` read on the CPU (with `wash` laid in: `washRun`). */
  readonly run: HandRun;
  /** The selection's wash written into the store's copy since the run was built (petition I60); undefined — the run's own. */
  readonly wash?: InkWash;
  /** The road the run serves: the PEN's (its words and its marks), or the RASTER's (its marks alone, over the raster's letters). */
  readonly road: "pen" | "raster";
  /** The ink it was built from, and its strokes (petition I60). */
  readonly ink: InkValue;
  readonly strokes: readonly MarkStroke[];
  /** The clock's marks it was built with (`PenClock.marks`); undefined on the raster's road (every mark on the paper at once). */
  readonly marked: PenMarks | undefined;
}

export interface WritingStats {
  /** Notes holding a raster now (pinned included). */
  readonly resident: number;
  readonly pinned: number;
  /** Layouts laid and rasters drawn since the mount — the "re-rasters on an edit or a rung only" instrument. */
  readonly layouts: number;
  readonly rasters: number;
  /** Rasters refused because the pages were full (the sheet drew blank). */
  readonly blanks: number;
  /** Rasters evicted to make room. */
  readonly evicted: number;
  /** Notes whose raster is asked of the queue and not laid yet (K6b) — each draws what it holds meanwhile. */
  readonly queued: number;
  /** How many sheets take each road now (petition I59) — a pinned one is counted in `pinned`, in none of these. */
  readonly roads: { readonly pen: number; readonly raster: number; readonly waiting: number };
  /** Glyph runs built since the mount — the pen's "built on a layout or a moment change only" instrument. */
  readonly runs: number;
  /** Sheets the pen is writing now: a glyph not yet whole at the last tick, or a mark still being drawn (the raster's wipe's twin, petition I59). */
  readonly moving: number;
  /** Washes rewritten alone since the mount (petition I60 — a selection change: never a run built). */
  readonly washes: number;
}

export interface Writing {
  /** The frame's clock, once a tick before the draw: does the writing want a frame now? */
  tick(now: number): boolean;
  /**
   * When the writing is next live (K7a — `KindLocal.due`): now while a frame is owed, a wipe runs on a drawn note or the pen
   * moves; the pen's next start while one waits; the caret's next blink phase while it stands; never otherwise — a face landing
   * is the text raster's (or the faces') wake, an edit the editor's. A desk at rest with a caret standing takes one frame a blink
   * phase, and none without one.
   */
  due(now: number): number;
  /**
   * What note `e` draws with this frame: its ink (pinned, the pen's run or the raster), the raster's wipe, the caret. A `fading`
   * note (a delete ghost) draws only the ink it already holds — never a new layout, run or raster, no marks.
   */
  draw(e: Entity, props: Readonly<Record<string, unknown>>, rect: { readonly cx: number; readonly cy: number; readonly w: number; readonly h: number }, view: View & { readonly dpr: number }, geometry: PaperGeometry, fading?: boolean): NoteInk;
  /**
   * The band note `e` asks at `zoom` × `dpr` (K6b — the paper kind's RUNG): its raster's band under the ladder's hysteresis, the one
   * `draw` would raster at; 0 when it asks none (an empty sheet, a pinned still, no text raster, the pen's road — its record reads no
   * zoom). The note's record reads the zoom through this alone, so a zoom within the band remakes nothing.
   */
  bandOf(e: Entity, props: Readonly<Record<string, unknown>>, rect: { readonly w: number; readonly h: number }, zoom: number, dpr: number): number;
  /**
   * Note `e`'s RUNG at `zoom` × `dpr` (K6b — the paper kind's `rung`): without a queue, the band it asks (`bandOf` — its record,
   * remade at a crossing, rasters it at once); with one, the band of the raster it HOLDS — what its record shows — the band the zoom
   * asks being ASKED of the queue here, `px` (screen px from the view's centre) its order: a crossing remakes no record, the raster's
   * landing does (`remake`).
   */
  rungOf(e: Entity, props: Readonly<Record<string, unknown>>, rect: { readonly w: number; readonly h: number }, zoom: number, dpr: number, px: number): number;
  /** The note's layout as last drawn (undefined before, for a still, or while the face loads). */
  layoutOf(e: Entity): HandLayout | undefined;
  rasterOf(e: Entity): NoteRasterInfo | undefined;
  /** The road note `e` took at its last draw (petition I59); undefined before its first. */
  roadOf(e: Entity): NoteRoad | undefined;
  /** Note `e`'s run as last written on the pen road (petition I59 — the raster's `rasterOf`'s twin); undefined off it. */
  penOf(e: Entity): NotePenInfo | undefined;
  /** The pen's time the slots draw at, ms: the clock's now while a glyph is being written or waits, else held at the last moment written. */
  penTime(): number;
  /** Pin a committed raster (r8 rows) on a note — allocated NOW, in call order (the oracle's texels). */
  pin(e: Entity, bytes: Uint8Array<ArrayBuffer>, size: { readonly w: number; readonly h: number }): boolean;
  isPinned(e: Entity): boolean;
  /** The editor's caret: on note `e` before glyph `index`, its blink restarted at `now`; `undefined` lifts it. */
  caret(e: Entity | undefined, index?: number, now?: number): void;
  /** The caret as drawn: its note, its index, whether it shows. */
  caretOf(): { readonly entity: Entity; readonly index: number; readonly on: boolean } | undefined;
  /**
   * The note's own typing wrote on `e` (`index` — one glyph typed, at that index; `undefined` — a paste, a commit, a space or a
   * break: the words arrive whole). On the PEN's road it is the typing's word to the clock: the sheet's next look writes a typed
   * glyph as typed and the rest as they arrive. On the raster's, the pen's wipe from `now` over a typed glyph.
   */
  wrote(e: Entity, index: number | undefined, now: number): void;
  wipeOf(e: Entity): { readonly index: number; readonly t0: number } | undefined;
  /** What has LANDED on the note, counted — its raster laid or its run written, its wipe let go (D7 — `KindLocal.landed`); never the pen or the wipe running. */
  landed(e: Entity): number;
  /** The caret index nearest a world point on a drawn note — where a tap puts the pen. */
  caretIndexAt(e: Entity, wx: number, wy: number): number | undefined;
  /**
   * The caret index nearest world point (wx, wy) ON note `e`'s sheet as last drawn (petition I60 — where a press or a drag across its
   * writing lands): undefined off the sheet, before its first draw, or while the face loads.
   */
  indexAt(e: Entity, wx: number, wy: number): number | undefined;
  /** The WORD (`wordRange`) or the LAID LINE (`lineRange`) around caret index `index` of note `e` as last drawn — undefined before its first draw (petition I60). */
  rangeAt(e: Entity, index: number, unit: TextUnit): TextRange | undefined;
  /**
   * Where the words [from, to) of note `e` LIE in the world as last drawn (petition I60 — the selection menu comes to the words): the
   * union of their glyph boxes (`rangeBoxIn`), placed on the sheet — for a sheet at its tilt, the box of the turned corners. Held in
   * order (`from` > `to` is the same range); undefined for an empty range, before its first draw, or while the face loads.
   */
  rangeBox(e: Entity, from: number, to: number): RangeBox | undefined;
  /**
   * The editor's SELECTION on note `e` (petition I60): its range, held in order (`from` ≤ `to`); `undefined` lifts it. Flux: told with the
   * caret, never stored; drawn as the WASH, rewritten alone in the run the note holds (`NoteRuns.wash`) and a frame asked (`redraw`).
   */
  select(e: Entity | undefined, from?: number, to?: number): void;
  /** The selection as told: its note and its range. */
  selectionOf(): { readonly entity: Entity; readonly from: number; readonly to: number } | undefined;
  /** The topmost note drawn last frame under a world point. */
  noteAt(wx: number, wy: number): Entity | undefined;
  /** The note left the desk for good: its rect back to the pages, its run's room back to the store, its moments forgotten. */
  forget(e: Entity): void;
  /** Every raster and run forgotten, the clock's moments too, and the pages carved afresh (a scene reload). */
  reset(): void;
  stats(): WritingStats;
  dispose(): void;
}

interface Raster {
  readonly rect: InkRect;
  readonly uv: UvRect;
  readonly band: number;
  /** The layout it drew (identity: a new layout is a new writing), absent for a pinned still. */
  readonly layout: HandLayout | undefined;
  readonly bleed: number;
}

/** A sheet's run as written — the pen's (its words and marks) or the raster's (its marks alone) — and what it was built with. */
interface Pen {
  readonly road: "pen" | "raster";
  readonly atlas: HandAtlas;
  /** The layout it was built over (identity). */
  readonly layout: HandLayout;
  readonly moments: readonly PenMoment[];
  readonly ink: InkValue;
  /** The marks it was built with, as the cell writes them (a new marking is a new run). */
  readonly marks: string;
  readonly strokes: readonly MarkStroke[];
  readonly marked: PenMarks | undefined;
  readonly run: HandRun;
  readonly base: number;
  /** The wash the store holds for it (`undefined` — the one built in), and the spans it was laid from, as a key. */
  wash: InkWash | undefined;
  washKey: string;
}

interface Entry {
  text: string;
  seeds: string;
  seed: number;
  w: number;
  h: number;
  /** What the layout was laid by: the text raster's version (the raster road) or the face's atlas (the pen's) — part of its key. */
  by: number | HandAtlas | undefined;
  layout: HandLayout | undefined;
  keyed: boolean;
  raster: Raster | null;
  pinned: boolean;
  /** The road it took at its last draw (petition I59). */
  road: NoteRoad | undefined;
  /** The pen road's run; null off the pen, and for a sheet the pen has nothing to lay on (empty, spaces). */
  pen: Pen | null;
  /** The layout the clock last looked at and a run was built for (identity: a new layout is a new look and a new run); undefined off the pen. */
  looked: HandLayout | undefined;
  /** The glyphs' moments of that look (petition I59). */
  moments: readonly PenMoment[];
  /** The marks the clock last looked at, over `looked` (as the cell writes them), its strokes and its answer (petition I60). */
  inked: string | undefined;
  strokes: readonly MarkStroke[];
  marked: PenMarks | undefined;
  /** The last "does the text hold a glyph the face lacks?" verdict, and the text and face it was found for. */
  lacks: { readonly text: string; readonly atlas: HandAtlas; readonly lacks: boolean } | undefined;
  /** The band asked of the queue and not laid yet (K6b); 0 = nothing asked. */
  want: number;
  /** The note's run for the queue, made once. */
  run: (() => "done" | "wait") | undefined;
  /** The render it was last drawn in, and its place in that render's paint order. */
  drawnAt: number;
  order: number;
  geometry: PaperGeometry | undefined;
}

/** The queue's name for the paper's asks (K6b) — the kind's. */
const OWNER = "paper";

const str = (props: Readonly<Record<string, unknown>>, name: string): string => { const v = props[name]; return typeof v === "string" ? v : ""; };
const num = (props: Readonly<Record<string, unknown>>, name: string): number => { const v = props[name]; return typeof v === "number" && Number.isFinite(v) ? v : 0; };

/**
 * Does `text` hold a glyph the face lacks (petition I59)? Every character `layoutText` lays as a glyph — all but a space and a
 * break, by its UTF-16 unit, so an emoji's surrogates are two — that `handRun` would name missing.
 */
function lacksIn(text: string, atlas: HandAtlas): boolean {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (ch === " " || ch === "\n") continue;
    if (glyphOf(atlas, ch.codePointAt(0) ?? 0) === undefined) return true;
  }
  return false;
}

/** A WORD's character (petition I60): a letter (its marks with it), a digit or an apostrophe, straight or typographer's. */
const WORDISH = /[\p{L}\p{M}\p{N}'’]/u;

/**
 * The WORD around caret index `index` (a double click — petition I60): the run of letters, digits and apostrophes it stands in, or
 * the one it stands just after; in a gap between words, the one character after the index; at a line break or the end, none.
 */
export function wordRange(text: string, index: number): TextRange {
  const n = text.length;
  const i = Math.min(Math.max(index, 0), n);
  const word = (k: number): boolean => k >= 0 && k < n && WORDISH.test(text[k] as string);
  let a = i;
  if (!word(a) && word(a - 1)) a -= 1;
  if (!word(a)) return a < n && text[a] !== "\n" ? { from: a, to: a + 1 } : { from: i, to: i };
  let from = a;
  let to = a + 1;
  while (word(from - 1)) from -= 1;
  while (word(to)) to += 1;
  return { from, to };
}

/** The LAID LINE around caret index `index` (a third click — petition I60): the layout's line it stands on, without the break that ends it. */
export function lineRange(L: HandLayout, text: string, index: number): TextRange {
  const i = Math.min(Math.max(index, 0), text.length);
  let line: { readonly start: number; readonly end: number } | undefined;
  for (const l of L.lines) {
    if (l.start > i) break;
    line = l;
  }
  if (line === undefined) return { from: i, to: i };
  const to = line.end > line.start && text[line.end - 1] === "\n" ? line.end - 1 : line.end;
  return { from: line.start, to };
}

/** The caret index nearest a point in a note's own units (the prototype's `caretIndexAt`): lines weigh three times the columns. */
export function caretIndexIn(L: HandLayout, nx: number, ny: number, length: number): number {
  let best = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i <= length; i++) {
    const px = L.positions[2 * i] as number;
    const py = L.positions[2 * i + 1] as number;
    const score = Math.abs(py - L.ascent * 0.4 - ny) * 3 + Math.abs(px - nx);
    if (score < bestScore) { bestScore = score; best = i; }
  }
  return best;
}

/**
 * The box the words [from, to) take in a layout, note units from the sheet's top-left (petition I60 — where the selection menu comes
 * to): the union of their glyph boxes (`glyphBox`, what the ink can reach) and, for a space or a break, which lay no glyph, their own
 * cell — from the caret's place before it to the next on its line (a break ends its line: no width there), the face's box tall. Held in
 * order; undefined for an empty range.
 */
export function rangeBoxIn(L: HandLayout, from: number, to: number): { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number } | undefined {
  const length = L.positions.length / 2 - 1;
  const a = Math.max(0, Math.min(from, to));
  const b = Math.min(length, Math.max(from, to));
  if (b <= a) return undefined;
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  const take = (l: number, t: number, r: number, d: number): void => { x0 = Math.min(x0, l); y0 = Math.min(y0, t); x1 = Math.max(x1, r); y1 = Math.max(y1, d); };
  const inked = new Set<number>();
  for (const g of L.glyphs) {
    if (g.index < a || g.index >= b) continue;
    const q = glyphBox(L, g);
    take(q.x0, q.y0, q.x1, q.y1);
    inked.add(g.index);
  }
  for (let i = a; i < b; i++) {
    if (inked.has(i)) continue;
    const x = L.positions[2 * i] as number;
    const y = L.positions[2 * i + 1] as number;
    const next = L.positions[2 * i + 2] as number;
    take(x, y - L.ascent, L.positions[2 * i + 3] === y ? Math.max(next, x) : x, y + L.descent);
  }
  return x1 >= x0 ? { x0, y0, x1, y1 } : undefined;
}

export function createWriting(opts: WritingOptions): Writing {
  const law = opts.hand ?? DEFAULT_HAND_LAW;
  const face = opts.face ?? DEFAULT_FACE;
  const bleed = opts.bleed ?? DEFAULT_BLEED;
  const weight = opts.weight ?? HAND_WEIGHT;
  /** K7b: the note is FAR — under the far LOD's low edge on screen — and holds and asks no raster (its writing is greeked). */
  const far = (rect: { readonly w: number; readonly h: number }, zoom: number): boolean => Math.max(rect.w, rect.h) * zoom < (opts.far ?? 0);
  const wipeMs = Math.max(opts.wipeMs ?? HAND.wipeMs, 1);
  const blinkMs = Math.max(opts.blinkMs ?? PAPER.caret.blinkMs, 60);
  const marginPx = opts.marginPx ?? 200;
  const text = opts.text;
  const faces = opts.faces;
  const clock = opts.clock ?? createPenClock();
  const redraw = opts.redraw;
  const entries = new Map<Entity, Entry>();
  const wipes = new Map<Entity, { index: number; t0: number }>();
  /** The note's own typing's word on a pen-road sheet, for its next look (`wrote`): typed, or arrived. */
  const told = new Map<Entity, PenHow>();
  const landedOf = new Map<Entity, number>();
  const land = (e: Entity): void => { landedOf.set(e, (landedOf.get(e) ?? 0) + 1); };
  let focus: { entity: Entity; index: number; t0: number } | undefined;
  /** The editor's selection as told (petition I60) — flux, as the caret is. */
  let selection: { readonly entity: Entity; readonly from: number; readonly to: number } | undefined;
  let now = 0;
  let ticks = 0;
  let render = 0;
  let renderTick = -1;
  let order = 0;
  let dirty = false;
  let seenVersion = text?.version() ?? 0;
  let seenFaces = faces?.version() ?? 0;
  let lastPhase: boolean | undefined;
  let layouts = 0;
  let rasters = 0;
  let blanks = 0;
  let evicted = 0;
  let runsBuilt = 0;
  let washes = 0;
  /**
   * The latest moment the clock has handed out (a glyph's start + its duration, ms): the pen's time is the clock's `now` up to it and
   * held there after — once every glyph is whole the time no longer matters, so a frame at rest writes no knob.
   */
  let horizon = 0;
  const penTime = (): number => Math.min(now, horizon);
  const reach = (moments: readonly PenMoment[]): void => { for (const m of moments) if (m.start > Number.NEGATIVE_INFINITY) horizon = Math.max(horizon, m.start + m.dur); };
  /** …and the marks' (petition I60): each re-ink's and each stroke's end. */
  const reachMarks = (m: PenMarks): void => { reach(m.reinks); reach(m.strokes); };

  const phaseAt = (t: number): boolean => (focus === undefined ? false : Math.floor(Math.max(0, t - focus.t0) / blinkMs) % 2 === 0);

  const queue = opts.queue;
  const remake = opts.remake;
  const release = (pages: InkPages | undefined, en: Entry): void => {
    if (en.raster === null) return;
    pages?.free(en.raster.rect);
    en.raster = null;
    pages?.trim?.();
    queue?.wake(OWNER);   // room made: a note held for it tries again
  };
  /** Note `e` off the pen's road (or gone): its run's room given back and its moments forgotten — back on it, its first look writes nothing. */
  const dropPen = (e: Entity, en: Entry | undefined): void => {
    if (en !== undefined && en.pen !== null) { opts.runs?.()?.free(e); en.pen = null; }
    if (en !== undefined) { en.looked = undefined; en.moments = []; en.inked = undefined; en.strokes = []; en.marked = undefined; }
    clock.forget(e);
  };
  /** Note `e`'s marks-only run let go (the raster's road: no marks and no selection any more, or off that road). */
  const dropLines = (e: Entity, en: Entry): void => {
    if (en.pen !== null && en.pen.road === "raster") { opts.runs?.()?.free(e); en.pen = null; }
  };

  /** The wash note `e` shows over layout `L`: the selection's spans when it is on `e` (petition I60), else none. */
  const washOf = (e: Entity, L: HandLayout): readonly ReturnType<typeof spansOf>[number][] => (selection !== undefined && selection.entity === e && selection.to > selection.from ? spansOf(L, selection.from, selection.to) : []);
  const keyOf = (spans: readonly ReturnType<typeof spansOf>[number][]): string => spans.map((q) => `${q.line}:${q.x0}:${q.x1}:${q.y0}:${q.y1}`).join(",");
  /**
   * The run note `e` holds built and written (petition I59, I60): over `L` in `atlas`, with its moments, its ink, its strokes and their
   * moments, and the selection's wash as it stands. Its base, or −1 (the device holds no more); null when it lays nothing.
   */
  const build = (e: Entity, en: Entry, R: NoteRuns, road: "pen" | "raster", atlas: HandAtlas, L: HandLayout, ink: InkValue, marks: string, strokes: readonly MarkStroke[], moments: readonly PenMoment[], marked: PenMarks | undefined): number | null => {
    const spans = washOf(e, L);
    // the raster's road: the marks section alone — no glyph laid (its letters are the raster's, in the sheet's pen), every mark at once
    const over = road === "pen" ? L : { ...L, glyphs: [] };
    const built = handRun(over, atlas, { moments, epoch: now, bleed, weight, ink, strokes, ...(marked !== undefined ? { marked } : {}), wash: spans });
    runsBuilt += 1;
    if (road === "pen" && built.glyphs === 0) {
      // nothing inked (an empty sheet, a sheet of spaces): no run written — and the clock has seen the sheet, so its first glyph is
      if (en.pen !== null) { R.free(e); en.pen = null; }
      return null;
    }
    const base = R.write(e, built);
    if (base < 0) return -1;
    R.face(atlas);
    R.at(penTime());
    en.pen = { road, atlas, layout: L, moments, ink, marks, strokes, marked, run: built, base, wash: undefined, washKey: keyOf(spans) };
    land(e);
    return base;
  };
  /** The WASH of note `e` rewritten alone in the run it holds (petition I60) — never the run rebuilt — and a frame asked. */
  const rewash = (e: Entity): void => {
    const p = entries.get(e)?.pen;
    if (p === null || p === undefined || p.run.marks === undefined) { if (p === null && entries.get(e)?.road === "raster") dirty = true; return; }
    const spans = washOf(e, p.layout);
    const key = keyOf(spans);
    if (key === p.washKey) return;
    const w = inkWash(p.run, spans);
    if (opts.runs?.()?.wash?.(e, w) !== true) { dirty = true; return; }
    p.wash = w;
    p.washKey = key;
    washes += 1;
    if (redraw !== undefined) redraw(); else dirty = true;
  };

  const drawn = opts.drawn;
  /** Not on screen this frame: the builder's word when it gives one (D6), else not drawn in the last two renders. */
  const offScreen = (e: Entity, q: Entry): boolean => (drawn !== undefined ? drawn(e) === undefined : q.drawnAt < render - 1);
  /** Room for a `w × h` raster: the pages' own, else what no one drew in the last two frames, oldest first. */
  const room = (pages: InkPages, w: number, h: number): InkRect | null => {
    const got = pages.alloc(w, h);
    if (got !== null) return got;
    const stale = [...entries.entries()].filter(([e, q]) => q.raster !== null && !q.pinned && offScreen(e, q)).map(([, q]) => q).sort((a, b) => a.drawnAt - b.drawnAt);
    for (const q of stale) {
      release(pages, q);
      evicted += 1;
      const r = pages.alloc(w, h);
      if (r !== null) return r;
    }
    return null;
  };

  /** The band a note asks at `zoom` × `dpr`: the ladder's, with the hysteresis around the band its raster holds, capped at the page. */
  const askBand = (en: Entry | undefined, w: number, h: number, zoom: number, dpr: number): number => rasterBand(zoom, dpr, en?.raster?.band ?? 0, INK_PAGE / Math.max(w, h, 1));

  /** Does `t` hold a glyph the face lacks — the entry's last verdict while its text and face stand. */
  const lacks = (en: Entry | undefined, t: string, atlas: HandAtlas): boolean => {
    const c = en?.lacks;
    if (c !== undefined && c.text === t && c.atlas === atlas) return c.lacks;
    const v = lacksIn(t, atlas);
    if (en !== undefined) en.lacks = { text: t, atlas, lacks: v };
    return v;
  };
  /**
   * THE ROAD a sheet of text `t` takes now (petition I59): pinned over both; the PEN when the note's face is lent and has landed
   * and holds every glyph; WAITING while that face is on its way; else the RASTER.
   */
  const roadFor = (en: Entry | undefined, t: string): NoteRoad => {
    if (en?.pinned === true) return "pinned";
    if (faces === undefined) return "raster";
    const atlas = faces.face(face);
    if (atlas === undefined) return faces.loading?.(face) === true ? "waiting" : "raster";
    return lacks(en, t, atlas) ? "raster" : "pen";
  };

  const near = (rect: { readonly cx: number; readonly cy: number; readonly w: number; readonly h: number }, view: View): boolean => {
    const m = marginPx / view.zoom;
    const r = Math.hypot(rect.w, rect.h) / 2;
    return rect.cx + r >= view.camX - m && rect.cx - r <= view.camX + view.width / view.zoom + m && rect.cy + r >= view.camY - m && rect.cy - r <= view.camY + view.height / view.zoom + m;
  };

  /**
   * Lay note `e`'s ink at `band` for its layout `L` on a `w × h` sheet: in its own rect when the size is the same, else a new one.
   * `keep` (the queue's run): the new rect is found BEFORE the old is let go — no room, and the old raster stands; else (the frame
   * that asked) the old goes first and no room draws the sheet blank, honestly. False: no room.
   */
  const lay = (e: Entity, en: Entry, pages: InkPages, T: TextRaster, L: HandLayout, w: number, h: number, band: number, keep: boolean): boolean => {
    const pw = Math.max(1, Math.ceil(w * band));
    const ph = Math.max(1, Math.ceil(h * band));
    const r = en.raster;
    let at: InkRect | null = r !== null && r.rect.w === pw && r.rect.h === ph ? r.rect : null;
    if (at === null && keep) {
      at = room(pages, pw, ph);
      if (at === null) return false;
      release(pages, en);
    } else if (at === null) {
      release(pages, en);
      at = room(pages, pw, ph);
      if (at === null) { blanks += 1; return false; }
    }
    const bmp = T.raster(L, face, { w, h }, band, bleed);
    en.raster = { rect: at, uv: pages.write(at, bmp.bytes), band, layout: L, bleed };
    rasters += 1;
    land(e);
    return true;
  };

  /** The band note `e` asks (`bandOf`): 0 for an empty sheet, a pinned still, no text raster, the pen's road or a sheet waiting for its face. */
  const bandAsked = (e: Entity, props: Readonly<Record<string, unknown>>, rect: { readonly w: number; readonly h: number }, zoom: number, dpr: number): number => {
    const en = entries.get(e);
    const t = str(props, "text");
    if (text === undefined || en?.pinned === true || t.length === 0 || far(rect, zoom)) return 0;
    if (roadFor(en, t) !== "raster") return 0;   // the pen's record reads no zoom (petition I59)
    return askBand(en, rect.w, rect.h, zoom, dpr);
  };

  /** Nothing owed to the queue for `e` any more (its band came back, its words moved, it left): its ask withdrawn. */
  const unask = (e: Entity, en: Entry): void => {
    if (en.want === 0) return;
    en.want = 0;
    queue?.drop(OWNER, e);
  };

  /**
   * The queue's turn for note `e` (K6b): its ink laid at the band it last asked — the old raster standing until the new one has
   * room — and its record remade. No room: it waits, held until a raster is let go. Nothing owed any more: done.
   */
  const run = (e: Entity): "done" | "wait" => {
    const en = entries.get(e);
    const pages = opts.pages();
    const L = en?.layout;
    if (en === undefined || en.want === 0 || en.pinned || pages === undefined || text === undefined || L === undefined) { if (en !== undefined) en.want = 0; return "done"; }
    if (!lay(e, en, pages, text, L, en.w, en.h, en.want, true)) {
      if (en.raster === null) blanks += 1;
      return "wait";
    }
    en.want = 0;
    remake?.(e);
    return "done";
  };

  /** Ask the queue for note `e`'s raster at `band`: its tier by what it shows meanwhile, the nearest the view's centre (`px`) first within it. */
  const ask = (e: Entity, en: Entry, band: number, px: number, Q: NonNullable<KindHost["rasters"]>): void => {
    en.want = band;
    const shows = en.raster === null ? "nothing" : en.raster.band < band ? "magnified" : "minified";
    en.run ??= () => run(e);
    Q.ask(OWNER, e, rasterPriority(shows, px), en.run);
  };

  /** The caret index nearest a world point on note `e` as last drawn (`caretIndexAt`; on its sheet only, `indexAt`). */
  const caretIndexNear = (e: Entity, wx: number, wy: number): number | undefined => {
    const en = entries.get(e);
    const L = en?.layout;
    const G = en?.geometry;
    if (en === undefined || L === undefined || G === undefined) return undefined;
    const [qx, qy] = localOf(G, wx, wy);
    return caretIndexIn(L, qx / G.scale + en.w / 2, qy / G.scale + en.h / 2, en.text.length);
  };

  /** The caret note `e` draws over its layout `L`, when the editor's is on it. */
  const caretOn = (e: Entity, L: HandLayout | undefined): NoteInk["caret"] => (focus !== undefined && focus.entity === e && L !== undefined ? { ...caretAt(L, focus.index), on: phaseAt(now) } : undefined);

  /** The layout re-laid when one of its inputs moved — the text, its seeds, the seed, the size, and what it is laid by. */
  const relay = (en: Entry, t: string, s: string, seed: number, rect: { readonly w: number; readonly h: number }, by: number | HandAtlas, metrics: () => Parameters<typeof layoutText>[3] | undefined): void => {
    if (en.keyed && en.text === t && en.seeds === s && en.seed === seed && en.w === rect.w && en.h === rect.h && en.by === by) return;
    const m = metrics();
    en.layout = m === undefined ? undefined : layoutText(t, { w: rect.w, h: rect.h }, law, m, seed, seedsFor(t, s, seed));
    en.text = t; en.seeds = s; en.seed = seed; en.w = rect.w; en.h = rect.h; en.by = by; en.keyed = true;
    if (en.layout !== undefined) layouts += 1;
  };

  /**
   * THE PEN's draw (petition I59, I60): the layout by the face's own metrics; the moments asked of the clock when the layout is new,
   * the marks' moments after them when the layout or the marks are new (`clock.marks`), and the run built from the ink and written only
   * then; the record told the run's base. Undefined: the device holds no more runs — the raster road.
   */
  const penDraw = (e: Entity, en: Entry, atlas: HandAtlas, t: string, s: string, m: string, seed: number, rect: { readonly w: number; readonly h: number }, how: PenHow, pages: InkPages | undefined): NoteInk | undefined => {
    // off the raster's road: its raster let go, its ask withdrawn, its wipe retired (the pen's moments write a typed glyph)
    release(pages, en);
    unask(e, en);
    wipes.delete(e);
    if (en.pen !== null && en.pen.road !== "pen") { opts.runs?.()?.free(e); en.pen = null; }
    relay(en, t, s, seed, rect, atlas, () => handMetricsOf(atlas));
    const L = en.layout as HandLayout;
    const caret = caretOn(e, L);
    const R = opts.runs?.();
    if (R === undefined) return caret === undefined ? {} : { caret };   // the pass not made yet: nothing to write into, the sheet waits
    let fresh = false;
    if (en.looked !== L) {
      en.looked = L;
      en.moments = clock.look(e, { layout: L, seeds: seedsFor(t, s, seed), atlas, now, how });
      reach(en.moments);
      en.inked = undefined;
      fresh = true;
    }
    const ink = inkOf({ text: t, seeds: s, marks: m }, seed);
    const marks = encodeMarks(ink.marks);
    if (en.inked !== marks) {
      // THE MARKS' look (petition I60), after the frame's `look`: a mark new to it drawn from now, none at its first
      en.inked = marks;
      const strokes = strokesOf(L, ink);
      en.marked = clock.marks(e, { layout: L, ink, strokes, atlas, now });
      en.strokes = strokes;
      reachMarks(en.marked);
      fresh = true;
    }
    if (fresh) {
      const base = build(e, en, R, "pen", atlas, L, ink, marks, en.strokes, en.moments, en.marked);
      if (base === -1) { dropPen(e, en); return undefined; }
    }
    const pen = en.pen === null ? {} : { pen: { base: en.pen.base, marks: true } };
    return { ...pen, ...(caret !== undefined ? { caret } : {}) };
  };

  /**
   * THE RASTER's marks (petition I60): a sheet on the raster road that carries a mark or the selection draws them over its raster from a
   * run that holds the marks section alone, built against the note's face (none lent: no marks drawn there) — every mark on the paper at
   * once, rebuilt when its layout or its marks move. Its base for the record, or undefined (nothing to draw, or no room).
   */
  const rasterMarks = (e: Entity, en: Entry, L: HandLayout | undefined, t: string, s: string, m: string, seed: number): NotePenInfo["base"] | undefined => {
    const atlas = faces?.face(face);
    const R = opts.runs?.();
    const ink = inkOf({ text: t, seeds: s, marks: m }, seed);
    const marked = ink.marks.some((v) => v !== 0);
    const selected = selection !== undefined && selection.entity === e && selection.to > selection.from;
    if (L === undefined || atlas === undefined || R === undefined || (!marked && !selected)) { dropLines(e, en); return undefined; }
    const marks = encodeMarks(ink.marks);
    const p = en.pen;
    if (p !== null && p.road === "raster" && p.layout === L && p.marks === marks && p.atlas === atlas) return p.base;
    const base = build(e, en, R, "raster", atlas, L, ink, marks, strokesOf(L, ink), [], undefined);
    if (base === null || base < 0) { dropLines(e, en); return undefined; }
    return base;
  };

  const entryOf = (e: Entity): Entry => {
    let en = entries.get(e);
    if (en === undefined) {
      en = { text: "", seeds: "", seed: 0, w: 0, h: 0, by: undefined, layout: undefined, keyed: false, raster: null, pinned: false, road: undefined, pen: null, looked: undefined, moments: [], inked: undefined, strokes: [], marked: undefined, lacks: undefined, want: 0, run: undefined, drawnAt: -1, order: 0, geometry: undefined };
      entries.set(e, en);
    }
    return en;
  };

  return {
    due(t) {
      if (dirty || (text !== undefined && text.version() !== seenVersion) || (faces !== undefined && faces.version() !== seenFaces)) return t;
      for (const e of wipes.keys()) if (drawn === undefined || drawn(e) !== undefined) return t;
      // the pen: now while a glyph is being written (or has just finished — one frame to draw it whole), its next start while one waits
      const pen = clock.due(t);
      if (pen <= t) return t;
      // the first phase boundary after the LAST tick (`now`): the caret it drew stands until then
      const caret = focus === undefined ? Number.POSITIVE_INFINITY : focus.t0 + (Math.floor(Math.max(0, now - focus.t0) / blinkMs) + 1) * blinkMs;
      return Math.min(pen, caret);
    },

    tick(t) {
      now = t;
      ticks += 1;
      let want = dirty;
      dirty = false;
      if (text !== undefined && text.version() !== seenVersion) { seenVersion = text.version(); want = true; }
      // a face landed (or was found missing): every sheet takes its road again (petition I59)
      if (faces !== undefined && faces.version() !== seenFaces) { seenFaces = faces.version(); want = true; }
      // a wipe runs on the clock whether or not its note is drawn (D7): a frame for it while it runs — and once as its time is up, to
      // draw it done — only for a note on screen (the builder's word, when it gives one); a note panned off or never drawn again
      // asked a frame every tick forever, its wipe let go only by a draw that never came
      for (const [e, wp] of wipes) {
        if (t - wp.t0 >= wipeMs) { wipes.delete(e); land(e); }
        if (drawn === undefined || drawn(e) !== undefined) want = true;
      }
      const phase = focus === undefined ? undefined : phaseAt(t);
      if (phase !== lastPhase) { lastPhase = phase; want = true; }
      // THE PEN moved since the last tick: the run holds every moment, so only its time moves — the frame drawn again with no record
      // remade (`KindHost.redraw`); a host without the door has the records remade instead
      if (clock.tick(t)) { if (redraw !== undefined) redraw(); else want = true; }
      opts.runs?.()?.at(penTime());
      return want;
    },

    draw(e, props, rect, view, G, fading = false) {
      if (renderTick !== ticks) { renderTick = ticks; render += 1; order = 0; }
      // a delete ghost keeps what it has and asks for nothing: after a reset it fades blank, never re-rastered
      if (fading) {
        const q = entries.get(e);
        if (q?.pen !== null && q?.pen !== undefined && q.pen.road === "pen") return { pen: { base: q.pen.base, marks: true } };
        const r = q?.raster;
        return r === null || r === undefined ? {} : { raster: { layer: r.rect.layer, uv: r.uv } };
      }
      const en = entryOf(e);
      en.drawnAt = render;
      en.order = ++order;
      en.geometry = G;
      const pages = opts.pages();
      if (en.pinned) { en.road = "pinned"; return en.raster === null ? {} : { raster: { layer: en.raster.rect.layer, uv: en.raster.uv } }; }
      const t = str(props, "text");
      const s = str(props, "seeds");
      const m = str(props, "marks");
      const seed = num(props, "seed");
      // the typing's word for this sheet's next look, heard once (petition I59): a glyph typed, else the words arrive
      const how: PenHow = told.get(e) ?? "arrived";
      told.delete(e);
      let road = roadFor(en, t);
      if (road === "waiting") {
        // the face is on its way: the sheet waits BLANK — no stand-in hand that would re-write itself when it lands
        release(pages, en);
        unask(e, en);
        dropPen(e, en);
        wipes.delete(e);
        en.layout = undefined; en.keyed = false; en.by = undefined;
        en.road = road;
        return {};
      }
      if (road === "pen") {
        const ink = penDraw(e, en, faces?.face(face) as HandAtlas, t, s, m, seed, rect, how, pages);
        if (ink !== undefined) { en.road = road; return ink; }
        road = "raster";   // the device holds no more runs: this sheet's raster, honestly
      }
      // THE RASTER — today's road
      en.road = road;
      if (en.pen !== null && en.pen.road === "pen") dropPen(e, en);
      else { en.looked = undefined; en.moments = []; en.inked = undefined; en.strokes = []; en.marked = undefined; clock.forget(e); }
      const version = text?.version() ?? 0;
      relay(en, t, s, seed, rect, version, () => text?.metrics(face));
      const L = en.layout;
      // the raster: none for an unwritten sheet; else at the band the view asks, redrawn on a new layout or a rung only
      if (t.length === 0 || L === undefined || text === undefined || far(rect, view.zoom)) { release(pages, en); unask(e, en); }
      else if (pages !== undefined && near(rect, view)) {
        const band = askBand(en, rect.w, rect.h, view.zoom, view.dpr);
        const r = en.raster;
        // its WORDS moved under the raster it holds (an edit, a resize): laid in this frame — the ink never lags the caret
        if (r !== null && (r.layout !== L || r.bleed !== bleed)) { unask(e, en); lay(e, en, pages, text, L, rect.w, rect.h, band, false); }
        // none yet, or another band (a rung crossed): the queue's (K6b) — what it holds stands until its turn; without one, at once
        else if (r === null || r.band !== band) {
          if (queue !== undefined) ask(e, en, band, Math.hypot(rect.cx - (view.camX + view.width / (2 * view.zoom)), rect.cy - (view.camY + view.height / (2 * view.zoom))) * view.zoom, queue);
          else lay(e, en, pages, text, L, rect.w, rect.h, band, false);
        } else unask(e, en);   // nothing owed: the zoom came back to the band it holds
      }
      // the pen's wipe over the newest glyph, and the caret
      let wipe: NoteInk["wipe"];
      const wp = wipes.get(e);
      if (wp !== undefined && L !== undefined) {
        const g = L.glyphs.find((q) => q.index === wp.index);
        const u = (now - wp.t0) / wipeMs;
        if (g === undefined || u >= 1) { wipes.delete(e); land(e); }
        else wipe = { ...glyphBox(L, g), t: Math.max(0, u) };
      }
      const caret = caretOn(e, L);
      // its marks and its wash over the raster (petition I60), from a run of the marks alone
      const lines = far(rect, view.zoom) ? undefined : rasterMarks(e, en, L, t, s, m, seed);
      return {
        ...(en.raster !== null ? { raster: { layer: en.raster.rect.layer, uv: en.raster.uv } } : {}),
        ...(lines !== undefined ? { pen: { base: lines, marks: true, words: false } } : {}),
        ...(wipe !== undefined ? { wipe } : {}),
        ...(caret !== undefined ? { caret } : {}),
      };
    },

    bandOf: (e, props, rect, zoom, dpr) => bandAsked(e, props, rect, zoom, dpr),

    rungOf(e, props, rect, zoom, dpr, px) {
      const band = bandAsked(e, props, rect, zoom, dpr);
      const en = entries.get(e);
      // no queue, or nothing laid out to raster yet (a record not made, the face loading): the record's own draw asks, at once
      if (queue === undefined || band === 0 || en?.layout === undefined) return band;
      const held = en.raster?.band ?? 0;
      if (band !== held) ask(e, en, band, px, queue);
      else unask(e, en);
      return held;
    },

    layoutOf: (e) => entries.get(e)?.layout,
    rasterOf(e) {
      const r = entries.get(e)?.raster;
      if (r === null || r === undefined) return undefined;
      return { band: r.band, w: r.rect.w, h: r.rect.h, layer: r.rect.layer, x: r.rect.x, y: r.rect.y, pinned: entries.get(e)?.pinned === true };
    },
    roadOf: (e) => entries.get(e)?.road,
    penOf(e) {
      const p = entries.get(e)?.pen;
      return p === null || p === undefined ? undefined : { base: p.base, glyphs: p.run.glyphs, length: p.run.length, face, atlas: p.atlas, run: p.run, ...(p.wash !== undefined ? { wash: p.wash } : {}), road: p.road, ink: p.ink, strokes: p.strokes, marked: p.marked };
    },
    penTime,

    pin(e, bytes, size) {
      const pages = opts.pages();
      if (pages === undefined) return false;
      const en = entryOf(e);
      unask(e, en);
      release(pages, en);
      dropPen(e, en);
      const at = pages.alloc(size.w, size.h);
      dirty = true;
      if (at === null) { en.pinned = false; return false; }
      en.raster = { rect: at, uv: pages.write(at, bytes), band: 0, layout: undefined, bleed };
      en.pinned = true;
      return true;
    },
    isPinned: (e) => entries.get(e)?.pinned === true,

    caret(e, index = 0, t = now) {
      if (e === undefined) { if (focus !== undefined) { focus = undefined; dirty = true; } return; }
      focus = { entity: e, index, t0: t };
      dirty = true;
    },
    caretOf: () => (focus === undefined ? undefined : { entity: focus.entity, index: focus.index, on: phaseAt(now) }),

    wrote(e, index, t) {
      // the pen's road: the typing's word to the clock, for the sheet's next look — its record is remade by the cell the input wrote
      if (entries.get(e)?.road === "pen") { told.set(e, index === undefined ? "arrived" : "typed"); return; }
      if (index === undefined) wipes.delete(e);
      else wipes.set(e, { index, t0: t });
      dirty = true;
    },
    wipeOf: (e) => wipes.get(e),
    landed: (e) => landedOf.get(e) ?? 0,

    caretIndexAt: (e, wx, wy) => caretIndexNear(e, wx, wy),

    indexAt(e, wx, wy) {
      const G = entries.get(e)?.geometry;
      if (G === undefined || sdPaper(G, wx, wy) >= 0) return undefined;   // off the sheet as drawn
      return caretIndexNear(e, wx, wy);
    },

    rangeAt(e, index, unit) {
      const en = entries.get(e);
      if (en === undefined || !en.keyed) return undefined;
      if (unit === "word") return wordRange(en.text, index);
      return en.layout === undefined ? undefined : lineRange(en.layout, en.text, index);
    },

    rangeBox(e, from, to) {
      const en = entries.get(e);
      const L = en?.layout;
      const G = en?.geometry;
      if (en === undefined || L === undefined || G === undefined) return undefined;
      const b = rangeBoxIn(L, from, to);
      if (b === undefined) return undefined;
      // note units (from the sheet's top-left) → the sheet's own frame (about its centre, at the hold's scale) → the world, turned: the
      // box of the four corners
      let x0 = Number.POSITIVE_INFINITY;
      let y0 = Number.POSITIVE_INFINITY;
      let x1 = Number.NEGATIVE_INFINITY;
      let y1 = Number.NEGATIVE_INFINITY;
      for (const [nx, ny] of [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]] as const) {
        const [wx, wy] = worldOf(G, (nx - en.w / 2) * G.scale, (ny - en.h / 2) * G.scale);
        x0 = Math.min(x0, wx); y0 = Math.min(y0, wy); x1 = Math.max(x1, wx); y1 = Math.max(y1, wy);
      }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    },

    select(e, from = 0, to = from) {
      const was = selection?.entity;
      selection = e === undefined ? undefined : { entity: e, from: Math.min(from, to), to: Math.max(from, to) };
      // the WASH rewritten alone where the selection was and where it is (petition I60): never a run built
      if (was !== undefined) rewash(was);
      if (e !== undefined && e !== was) rewash(e);
    },
    selectionOf: () => selection,

    noteAt(wx, wy) {
      let best: Entity | undefined;
      let bestOrder = -1;
      for (const [e, en] of entries) {
        // the builder's word on what is drawn and in what order (D6), else this writing's own draws of the last render
        const order = drawn !== undefined ? drawn(e) : en.drawnAt === render ? en.order : undefined;
        if (order === undefined || en.geometry === undefined || order <= bestOrder) continue;
        if (sdPaper(en.geometry, wx, wy) < 0) { best = e; bestOrder = order; }
      }
      return best;
    },

    forget(e) {
      const en = entries.get(e);
      if (en !== undefined) { unask(e, en); release(opts.pages(), en); }
      dropPen(e, en);
      entries.delete(e);
      wipes.delete(e);
      told.delete(e);
      landedOf.delete(e);
      if (focus?.entity === e) { focus = undefined; dirty = true; }
      if (selection?.entity === e) selection = undefined;
    },

    reset() {
      queue?.clear(OWNER);
      const R = opts.runs?.();
      for (const [e, en] of entries) if (en.pen !== null) R?.free(e);
      entries.clear();
      wipes.clear();
      told.clear();
      clock.clear();
      opts.pages()?.reset(true);
      dirty = true;
    },

    stats() {
      let resident = 0;
      let pinned = 0;
      let queued = 0;
      const roads = { pen: 0, raster: 0, waiting: 0 };
      for (const [e, en] of entries) {
        if (en.raster !== null) resident += 1;
        if (en.pinned) pinned += 1;
        if (en.want !== 0 && queue?.has(OWNER, e) !== false) queued += 1;
        if (en.road === "pen" || en.road === "raster" || en.road === "waiting") roads[en.road] += 1;
      }
      return { resident, pinned, layouts, rasters, blanks, evicted, queued, roads, runs: runsBuilt, moving: clock.writing(now), washes };
    },

    dispose() {
      queue?.clear(OWNER);
      entries.clear();
      wipes.clear();
      told.clear();
      clock.clear();
      focus = undefined;
      selection = undefined;
    },
  };
}
