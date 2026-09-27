// The DESK CALENDAR (CALENDAR.md) as a kind (kind.ts): the pad beneath everything behind the registry's
// door — a thin adapter, the pass and its WGSL as they were. Stratum `pads`, registered `composite`: the
// pass renders every pad into a layer of its own in `prepare` — the sheet in motion, the faces, the past
// roll, the solid, the mat under each (the prototype's `renderLayer` order) — recorded into the frame's
// encoder after the mat's wind, and its one run lays that layer on the mat before the sheets and the
// things (the prototype laid it as a host's `underlays` entry), so every note, board and notebook lies ON
// the calendar. The desk eye is the slot's view's; the law and the print's presences are the host's (the
// presences are the product's look). The PRINT is the host's too: its tiles are a Canvas 2D raster the
// host hands the pass (`kind.pass.uploadTile`, `writeTable`) — a pad whose tables name no tile shows its
// paper and its ruled grid (MISSING = −1). ROOT ONLY (D-D18): a spawned slot's pass draws nothing.
//
// And its WORLD half (kinds/world.ts; D3w): `calendarKind` — a pad becomes a `CalendarDraw` as the lab's `reset`
// + `pose` + `renderLayer` make one: its shown month and week start durable, a still's roll or peek a FLUX pin
// on the kind's own state (never a Grab), its lift the builder's (Grab: CALENDAR.md's 3 units, through the desk
// eye), its ring the selection's, fading with a ghost (the lab's `ring × (1 − fade)`; the pad itself stays whole
// until it is gone — its delete). Its page tables' slots and its id are the kind's, per pad. Its hit unprojects the
// desk point at the pad's face through the SAME desk eye the pass draws with: at rest a pad answers its TAPE
// (`frame` — a press carries it, a tap selects it) and the roll's handles (D3t-c: the roll, the corner, the foot, the
// sheet in motion — parts); its paper is not taken (a miss — the press falls through to the mat and pans, the lab's
// "not taken"; a click there is the days', read at event time); in hand the whole sheet is the pen's `content`. Its
// events and pins are data children (calendar/data.ts). The colours and the print's presences are the product's
// (`theme()`; the presences set on the root pass by the kind's local — the theme gate).
//
// AT WORK (D3t-c): the local (`createPads`) also keeps each pad's PRINT (calendar/print.ts, from its events — tiles
// through calendar/printing.ts and the host's raster), its months TURNING toward the document's month
// (calendar/turn.ts), the MARKS the hand puts on it (days, a line, the caret, a drop — drawn on the sheet as the
// marks' brackets), a DRAFT line, and the notes stuck to it that go with its months (`veils` — not drawn, never picked).

import type { Entity, HeldToolApi } from "@ice/core";
import { calEventOf, CalendarEvent, dayOr, monthKeyOf, monthOfKey, NotePin, PadSelection, PinsNote } from "../calendar/data";
import type { CalEvent } from "../calendar/events";
import { padFrame, buildPad } from "../calendar/pad";
import { CALENDAR, type CalendarLaw } from "../calendar/law";
import type { CalendarColours } from "../calendar/layout";
import { dayIn, isWeekendCol, monthGrid, monthOfDay, phasesBetween, today as todayOf } from "../calendar/month";
import { type CalendarDraw, CalendarPass, type SheetBox, type SheetDraw } from "../calendar/pass";
import { anyIn, type EventLine, onSheet, type PrintLook, printSheet, type SheetPrint } from "../calendar/print";
import { type PinnedSheet, PrintTiles } from "../calendar/printing";
import { rollAt, rollState, type RollState, tangentAt } from "../calendar/roll";
import { dragTo, grabMoving, letGo, newRoll, type PadRoll, rollSheets, startTurn, stepRoll } from "../calendar/turn";
import { CALENDAR_SHADER_FILES, calendarShaders } from "../calendar/shaders";
import { cellAt, dayBox, noteSlot, sheetOf } from "../calendar/sheet";
import { bandOf, GUTTER, levelFor, TILE_TEX, type TileGrid, tileGrid, tileRect, tilesIn } from "../calendar/tiles";
import { caretAt, glyphBox, type HandLaw, HAND } from "../kit/text";
import type { KindProgram, SlotContext } from "../kind";
import type { MatPass, MarkFrame } from "../kit/view";
import { type DeskEye, eyeOf, project, unproject } from "../kit/eye";
import { MeshWriter } from "../kit/mesh";
import { lampDir, type Rigid, rigidOf } from "../kit/place";
import { type ShaderText, shaderText } from "../kit/wgsl";
import { MAT_COLORS, type Palette, type RGB, rgb, type ThemeName, type TokenRef } from "../theme";
import { LayeredKind } from "../kit/layer";
import { type KindHost, type KindLocal, numberProp, type ObjectContext, type ObjectHit, type ObjectKind, stringProp } from "./world";

/** The desk calendar's kind name — its key in the registry and in every slot's `objects`. */
export const CALENDAR_KIND = "calendar";

/** The print's presences over the paper: the day rules, the heading rule, the weekend's wash, a neighbour month's wash. */
export interface CalendarAlpha { readonly rule: number; readonly head: number; readonly weekend: number; readonly outside: number }

/** No print: what the knobs carry while no pad draws (a host sets `alpha` before one does). */
const NO_ALPHA: CalendarAlpha = { rule: 0, head: 0, weekend: 0, outside: 0 };

export class CalendarKind extends LayeredKind<CalendarDraw, CalendarPass> {
  /** The calendar's law — the pad's size, its roll, its eye, its shadow: the host's; `CALENDAR` until one says. */
  law: CalendarLaw = CALENDAR;
  /** The print's presences — the PRODUCT's look (CALENDAR.md §4): a host sets them before a pad draws. */
  alpha: CalendarAlpha | null = null;
  /** The tile grid of the law's sheet (tiles.ts) — the page tables' shape, the host's `writeTable` names the same. */
  private tiles: { readonly law: CalendarLaw; readonly grid: TileGrid } | null = null;

  /** The tile grid the pass's page tables have for the law in force — the one a host hands `kind.pass.writeTable`. */
  get grid(): TileGrid {
    if (this.tiles?.law !== this.law) { const F = padFrame(this.law); this.tiles = { law: this.law, grid: tileGrid(F.W, F.H) }; }
    return this.tiles.grid;
  }

  /** Root only (D-D18): a spawned slot's pass — a mini mat's inside, a flight's departed desk — holds nothing and draws nothing. */
  spawn(_mat: MatPass): CalendarKind { return new CalendarKind(null); }

  /** The pass's own `prepare`, as the prototype's lab called it: the slot's camera, grid, clocks and light, the desk eye over the slot's view, the law, the tile grid, the colours. */
  protected prepareOwn(pass: CalendarPass, s: SlotContext, records: readonly CalendarDraw[]): number {
    if (records.length > 0 && !this.alpha) throw new Error("calendar: the print's presences are the host's look — set the kind's `alpha` before a pad draws");
    const v = s.view;
    const eye = eyeOf({ x: v.camX, y: v.camY, zoom: v.zoom }, { width: v.width, height: v.height }, this.law.eye);
    return pass.prepare(v, s.fadeIn, s.cfg, s.frame, s.light, eye, this.law, this.grid, { cast: MAT_COLORS.cast, select: s.select, alpha: this.alpha ?? NO_ALPHA }, records);
  }
}

/** The desk calendar's program for a host's shader text: its pass made on the root's mat; its pads one composite run, the first stratum. */
export function calendarProgram(text: ShaderText): KindProgram<CalendarDraw> {
  return {
    name: CALENDAR_KIND,
    stratum: "pads",
    composite: true,
    create: async (device, format, mat) => new CalendarKind(await CalendarPass.create(device, format, calendarShaders(text), mat)),
  };
}

// ---------------------------------------------------------------- the world half (D3w)

/**
 * What the calendar's kind takes from the host's palette (CALENDAR.md §4): the paper and the print's inks, the
 * chipboard, the tapes by name (cloth and foil), the print's presences; the pens a caret is drawn in are the note's
 * (`pens`, kinds/paper.ts `PaperPalette`).
 */
export interface CalendarPalette extends Palette {
  readonly calendars?: {
    readonly paper: TokenRef; readonly ink: TokenRef; readonly muted: TokenRef; readonly weekend: TokenRef; readonly hot: TokenRef; readonly chipboard: TokenRef;
    readonly tapes: Readonly<Record<string, { readonly cloth: TokenRef; readonly foil: TokenRef }>>;
    /** The presences; `faint` (a neighbour month's date) and `highlight` (a highlighter's dye) are the PRINT's (D3t-c). */
    readonly alpha: CalendarAlpha & { readonly faint?: number; readonly highlight?: number };
    /** The PRINT's inks (D3t-c): the pencil a past day is ticked in, the highlighters a run of days is banded in. */
    readonly pencil?: TokenRef;
    readonly highlighters?: Readonly<Record<string, TokenRef>>;
  };
  readonly pens?: Readonly<Record<string, TokenRef>>;
}

/** A pencil's tick lies at this presence (CALENDAR.md §2: graphite through a past date, lighter than the ink). */
const PENCIL_ALPHA = 0.55;
/** A colour as the print's Canvas 2D takes it, with a presence — the fixture's `calendarPrint` spelling, byte for byte. */
const cssOf = (c: RGB, a = 1): string => `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${a})`;

/** The calendar's look for a theme, parsed. */
export interface CalendarObjectLook {
  readonly paper: RGB; readonly ink: RGB; readonly muted: RGB; readonly weekend: RGB; readonly hot: RGB; readonly chipboard: RGB;
  readonly tapes: Readonly<Record<string, { readonly cloth: RGB; readonly foil: RGB }>>;
  readonly pens: Readonly<Record<string, RGB>>;
  readonly alpha: CalendarAlpha;
  /** The PRINT's inks as the raster takes them (D3t-c) — absent when the palette names no pencil or highlighters. */
  readonly print?: PrintLook;
}

/** A pad's still, pinned on the kind's own state (a FLUX pin): a month rolling (`dir` +1 up, −1 down, `p` of the way, the roll's tilt) or the corner's peek. */
export interface PadPose {
  readonly roll?: { readonly dir: 1 | -1; readonly p: number; readonly tilt?: number };
  readonly peek?: number;
}

/** A pad as the builder resolved it: what its record draws and its hit reads (the same eye the pass draws with). */
export interface CalendarGeometry {
  readonly shown: number;
  readonly weekStart: 0 | 1;
  readonly base: number;
  readonly moving: number | null;
  readonly roll: RollState | null;
  readonly marksOn: 0 | 1;
  readonly rigid: Rigid;
  readonly lamp: readonly [number, number, number];
  readonly lift: number;
  readonly ring: number;
  readonly eye: DeskEye;
  readonly cx: number;
  readonly cy: number;
  /** In hand (D4b's `ctx.held`): the whole sheet is the pen's surface (`content`), never a miss (D3t-c). */
  readonly held: boolean;
  /** A month in motion (a turn — not the corner's peek): the sheet in motion is what a press takes. */
  readonly turning: boolean;
}

/** The parts of a pad (the prototype's `CalendarHit`): where a point lands on its sheet, the day and the line there. */
export type CalendarPartName = "tape" | "roll" | "moving" | "corner" | "foot" | "day" | "entry" | "sheet";
export interface CalendarPart {
  readonly part: CalendarPartName;
  /** The sheet point: x from its left edge, y from its head (world units). */
  readonly sx: number;
  readonly sy: number;
  /** The day under it (a neighbour month's day in the first or last row counts) — on `day` and `entry`. */
  readonly day?: number;
  /** The line there, as the print laid it — on `entry`. */
  readonly line?: EventLine;
}

/**
 * What a desk point lands on, on a pad as resolved (the prototype's `hit`, through the SAME desk eye the pass draws with, at the
 * face's height): the tape; mid-turn the sheet in motion (within the roll's reach of its tangent line) or the sheet beneath; at
 * rest the roll under the tape, the corner, the foot, a line of writing (the print's own boxes — a band a little taller), a day,
 * or the sheet's paper. Null off the pad. The print is the month shown's (`lines` — none in Node: no lines are hit).
 */
export function partAt(G: CalendarGeometry, wx: number, wy: number, lines: readonly EventLine[] = [], law: CalendarLaw = CALENDAR): CalendarPart | null {
  const F = padFrame(law);
  const [px, py] = unproject(G.eye, wx, wy, F.zt + G.lift);
  const sx = px - G.cx + F.W / 2;
  const sy = py - G.cy + F.H / 2;
  if (sx < 0 || sy < 0 || sx > F.W || sy > F.H) return null;
  if (sy < F.T) return { part: "tape", sx, sy };
  const s = sy - F.T;
  if (G.turning && G.roll !== null) {
    const R = rollAt(G.roll, sx).radius;
    const a = tangentAt(G.roll, sx);
    return { part: Math.abs(s - a) < R * 1.4 + 6 ? "moving" : "sheet", sx, sy };
  }
  if (s < 2 * law.roll.rest + 6) return { part: "roll", sx, sy };
  if (F.W - sx + (F.H - sy) < 150) return { part: "corner", sx, sy };
  if (F.H - sy < law.sheet.foot) return { part: "foot", sx, sy };
  const L = sheetOf(monthGrid(G.shown, G.weekStart), law);
  const cell = cellAt(L, sx, sy);
  if (cell === null) return { part: "sheet", sx, sy };
  const line = lines.find((l) => !l.band && sx >= l.box.x && sx <= l.box.x + l.box.w && sy >= l.box.y && sy <= l.box.y + l.box.h)
    ?? lines.find((l) => l.band && sx >= l.box.x && sx <= l.box.x + l.box.w && sy >= l.box.y - 3 && sy <= l.box.y + l.box.h + 3);
  if (line !== undefined) return { part: "entry", sx, sy, day: cell.day, line };
  return { part: "day", sx, sy, day: cell.day };
}

/** The sheet point (x from its left edge, y from its head) under a desk point, at the pad's face through the eye — unclamped (a finger may leave the pad). */
export function sheetPoint(G: CalendarGeometry, wx: number, wy: number, law: CalendarLaw = CALENDAR): { readonly sx: number; readonly sy: number } {
  const F = padFrame(law);
  const [px, py] = unproject(G.eye, wx, wy, F.zt + G.lift);
  return { sx: px - G.cx + F.W / 2, sy: py - G.cy + F.H / 2 };
}

/** A pad's sheet point (x from its left, y from its head, `z` up) on the screen, CSS px — through the eye the pad was drawn with. */
export function sheetOnScreen(G: CalendarGeometry, sx: number, sy: number, z?: number, law: CalendarLaw = CALENDAR): readonly [number, number] {
  const F = padFrame(law);
  return project(G.eye, G.cx - F.W / 2 + sx, G.cy - F.H / 2 + sy, (z ?? F.zt) + G.lift);
}

/** A day's cell on the month a pad shows (sheet units) — a neighbour month's day in the first or last row counts — or null. */
export function sheetDayBox(G: CalendarGeometry, day: number, law: CalendarLaw = CALENDAR): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null {
  return dayBox(sheetOf(monthGrid(G.shown, G.weekStart), law), day);
}

/** A run of days, an entry, a caret: what the calendar's hand says is marked on a pad (the driver's — objects/calendar-hand.ts). */
export interface PadMarks {
  /** The days selected, first to last (day numbers). */
  readonly days?: readonly [number, number];
  /** The entry selected — an event entity's id, or the draft's (−1). */
  readonly entry?: number;
  /** The day a note held over the pad would stick to. */
  readonly drop?: number;
  /** The entry being WRITTEN (the editor on it): printed whole, its time not set apart, the caret at `index` (`on`: the blink). */
  readonly writing?: { readonly entry: number; readonly index: number; readonly on: boolean };
  /** The newest glyph being written and how far the pen's wipe has come over it (0 … 1 — the hand's clock). */
  readonly wipe?: { readonly entry: number; readonly index: number; readonly t: number };
}

/** An entry being written that the world does not hold yet (a new line: it is spawned when its session ends — D-D3t-c.4). */
export interface PadDraft {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly seeds: readonly number[];
  readonly ink: string;
}

/** The draft's id in a print (never an entity's). */
export const DRAFT_ID = -1;

/** The calendar's own state on one desk: each pad's id and page-table slots, its pinned still, its print and marks; the print's presences on the root pass. */
export interface Pads extends KindLocal {
  pin(e: Entity, pose: PadPose | undefined): void;
  /** The world half's: the pad's id, its slot pair (its base sheet's table is 2k, its moving sheet's 2k + 1) and its pin. */
  state(e: Entity): { readonly id: number; readonly slot: number; readonly pose: PadPose | undefined };
  /** The world half's: the print's presences on the root pass (the product's look). */
  alpha(a: CalendarAlpha): void;
  /** A pad's events as its data children hold them. */
  events(e: Entity): readonly { readonly start: string | null; readonly end: string | null; readonly text: string | null; readonly ink: string | null }[];
  // ---- D3t-c: the print, the marks, the pen
  /** The day the print calls today: the pinned one (a still's), else the clock's. */
  today(): number;
  /** Pin today (a day key) for stills and rigs — null gives it back to the clock. */
  pinToday(key: string | null): void;
  /**
   * Pin the ZONE a day is reckoned in (an IANA name) — today's, and the Moon's phases' local days on the print — for stills and rigs:
   * the committed prints were drawn in one zone, and a scene that holds a live print to them pins it (D7). Null: the pad's own.
   */
  pinZone(zone: string | null): void;
  /** The past days ticked off in pencil (CALENDAR.md Q-4; on by default). */
  ticks(on?: boolean): boolean;
  /** A pad's entries as the print takes them — its events by entity, and the draft being written. */
  entries(e: Entity): readonly CalEvent[];
  /** Month `month`'s print on pad `e` as the last frame laid it (its lines: where each entry landed), or undefined — no raster, or not laid. */
  printOf(e: Entity, month: number): SheetPrint | undefined;
  /** A month's COMMITTED tiles on pad `e` (a still's, a rig's pin): drawn instead of the live print; null takes them back. */
  pinPrint(e: Entity, month: number, sheet: PinnedSheet | null): void;
  /** What the calendar's hand marks on pad `e` this frame (undefined: nothing). */
  mark(e: Entity, marks: PadMarks | undefined): void;
  marksOf(e: Entity): PadMarks | undefined;
  /** The entry being written that the world does not hold yet (null: none). */
  draft(e: Entity, d: PadDraft | null): void;
  draftOf(e: Entity): PadDraft | null;
  /** The print's tiles: resident, still to draw, drawn since the desk began. */
  tiles(): { readonly resident: number; readonly pending: number; readonly drawn: number; readonly starved: number };
  /** The desk's raster reads a live sheet back as a fixture would hold it (level `level`'s tiles, RGBA) — a rig's door; undefined without a raster. */
  readSheet(e: Entity, month: number, level: number): { readonly tiles: ReadonlyMap<string, Uint8Array<ArrayBuffer>>; readonly empty: ReadonlySet<string> } | undefined;
  // ---- D3t-c: the month's turn (calendar/turn.ts) — flux toward the document's month
  /** The sheets in play for pad `e` whose document month is `durable` (the kind's `resolve`): the month laid bare, the one in motion. */
  sheets(e: Entity, durable: number): ReturnType<typeof rollSheets>;
  /** A pad's turning as it stands (a witness): the month laid bare, the turn in flight, the corner's lift, a hand's roll pending. */
  rollOf(e: Entity): { readonly shown: number | null; readonly turn: { readonly dir: 1 | -1; readonly p: number; readonly target: 0 | 1; readonly held: boolean; readonly hand: boolean } | null; readonly peek: number; readonly pending: number | null } | undefined;
  /** The corner lifts while the pointer is near the foot or the corner (the next month shows under it). */
  peek(e: Entity, on: boolean): void;
  /** A hand takes a sheet by `part` (the foot or the corner: up; the roll: down; the sheet in motion) at sheet point (sx, s from under the tape). False when it cannot. */
  grab(e: Entity, part: "foot" | "corner" | "roll" | "moving", sx: number, s: number, now: number): boolean;
  /** The finger at `s`: the moving sheet follows it. */
  dragTo(e: Entity, s: number, now: number, moved: boolean): void;
  /** Let go (or the press was cancelled): the turn decides. */
  letGo(e: Entity, now: number, cancel?: boolean): void;
  /** The hands' finished rolls since the last drain — each a month the document should now hold (the hand commits it). */
  rolled(): readonly { readonly e: Entity; readonly month: number }[];
  /** A hand's roll the document REFUSED (read-only, a pad gone): the pad rolls back to the document's month. A landed roll is released by the roll itself, once the document speaks (turn.ts, D7 #3). */
  unroll(e: Entity): void;
  /** A pad is on this desk (D7 #14): the hand's peek needs the pointer every frame while one is, so the hand never idles then. */
  busy(): boolean;
  /** The notes stuck to its pads that go with their months (D3t-c): not drawn, never picked (`KindLocal.veils`). */
  veils(): ReadonlySet<Entity>;
  /** Draw a pad's print and its marks for this frame (the kind's `record`): the sheets' tiles brought up, the marks' boxes. */
  draw(e: Entity, G: CalendarGeometry, view: ObjectContext["view"], print: PrintLook | undefined): Pick<CalendarDraw, "sel" | "mark" | "drop" | "caret" | "wipe">;
}

interface PadState {
  readonly id: number;
  readonly slot: number;
  pose: PadPose | undefined;
  readonly pinned: Map<number, PinnedSheet>;
  marks: PadMarks | undefined;
  draft: PadDraft | null;
  /** Its months turning (calendar/turn.ts) — flux toward the document's month. */
  readonly roll: PadRoll;
  /** The notes stuck to it that go with its months this frame (not drawn, never picked — `veils`). */
  hidden: ReadonlySet<Entity>;
}

const NO_MARKS: Pick<CalendarDraw, "sel" | "mark" | "drop" | "caret" | "wipe"> = { sel: [], mark: null, drop: null, caret: null, wipe: null };

/** The calendar's `local()`: ids from 1, slot pairs from the lowest free (the pass's tables hold `MAX_CALENDARS` pads); the print's driver. */
export function createPads(host: KindHost, opts: { readonly law?: CalendarLaw; readonly now?: () => number; readonly zone?: string; readonly hand?: HandLaw } = {}): Pads {
  const law = opts.law ?? CALENDAR;
  const clock = opts.now ?? (() => Date.now());
  const hand = opts.hand ?? HAND;
  const F = padFrame(law);
  const pads = new Map<Entity, PadState>();
  const free: number[] = [];
  let nextId = 1;
  let nextSlot = 0;
  let woke = false;
  let todayPin: number | null = null;
  let zonePin: string | null = null;
  /** The day the print last called today, and when the wall clock is next asked whether it turned over (D7). */
  let dayShown: number | null = null;
  let dayCheckAt = Number.NEGATIVE_INFINITY;
  let ticksOn = true;
  let tiles: PrintTiles | null = null;
  let begun = false;
  let lastTick: number | null = null;
  const prints = new Map<string, { key: string; print: SheetPrint }>();
  /** What has LANDED on each object, counted (D7 — `KindLocal.landed`): the held desk copy is made again when a desk object's moves. */
  const landedOf = new Map<Entity, number>();
  const land = (e: Entity): void => { landedOf.set(e, (landedOf.get(e) ?? 0) + 1); };
  // A pad's state is MADE by the draw path only — `sheets`, `draw`, `pin` (a scene's pose), `pinPrint`, the kind's record — and
  // answered to every other door for a pad it knows (`pads.get`): a mark, a draft, a peek or a grab on a pad already forgotten
  // (its delete, its cull) must not re-acquire a slot against MAX_CALENDARS (D7 #10 — the hand marks a pad it saw last frame,
  // the writing drafts on one). A pad culled mid-draft shows its draft again at the next keystroke, not before: the price
  const state = (e: Entity): PadState => {
    let st = pads.get(e);
    if (st === undefined) { free.sort((a, b) => a - b); st = { id: nextId++, slot: free.shift() ?? nextSlot++, pose: undefined, pinned: new Map(), marks: undefined, draft: null, roll: newRoll(), hidden: new Set() }; pads.set(e, st); }
    return st;
  };
  const passOf = (): CalendarPass | undefined => { const k = host.pass(); return k instanceof CalendarKind ? (k.pass ?? undefined) : undefined; };
  const tilesOf = (pass: CalendarPass): PrintTiles => { tiles ??= new PrintTiles({ grid: tileGrid(F.W, F.H), now: clock }); if (!begun) { tiles.begin(pass); begun = true; } return tiles; };
  // THE BUDGET (D6): the print's tile layers are one fixed texture the pass owns, LRU among themselves (tiles.ts `TileCache`) —
  // charged once as resident and kept, so the ledger tells the whole truth of what the caches hold
  let charged = false;
  const chargeTiles = (): void => {
    if (charged || host.budget === undefined) return;
    const pass = passOf();
    if (pass === undefined) return;
    host.budget.charge("calendar", "print tiles", pass.layers * TILE_TEX * TILE_TEX * 4, () => {});
    charged = true;
  };
  // THE CLOCK SEAM (D7): today and the Moon's local days on the pad's own wall clock (`now`) in its zone — the platform's unless the
  // host says (`zone`) or a still pins them (`pinToday`, `pinZone`)
  const zoneNow = (): string | undefined => zonePin ?? opts.zone;
  const todayNow = (): number => todayPin ?? todayOf(clock(), zoneNow());
  const entriesOf = (e: Entity): CalEvent[] => {
    const out: CalEvent[] = [];
    for (const { entity, value } of host.children?.entries?.(e, CalendarEvent) ?? []) { const ev = calEventOf(entity, value); if (ev !== null) out.push(ev); }
    const d = pads.get(e)?.draft ?? null;
    if (d !== null) out.push({ id: DRAFT_ID, start: Math.min(d.start, d.end), end: Math.max(d.start, d.end), text: d.text, seeds: [...d.seeds], seed: 0, ink: d.ink, rev: d.text.length });
    return out;
  };
  /** Month `month`'s print on pad `e` — built again only when what it shows changed (the prototype's `printOf`). */
  const printFor = (e: Entity, st: PadState, month: number, weekStart: 0 | 1, look: PrintLook, writing: number): SheetPrint | undefined => {
    const raster = host.print;
    const h = raster?.hand();
    if (raster === undefined || h === undefined) return undefined;
    const L = sheetOf(monthGrid(month, weekStart), law);
    const g = L.grid;
    const last = g.first + g.rows * 7 - 1;
    const events = entriesOf(e).filter((ev) => onSheet(ev, g));
    const noted: number[] = [];
    for (const p of host.children?.rows(e, NotePin) ?? []) { const d = dayOr(p.day ?? ""); if (d !== undefined && d >= g.first && d <= last && monthOfDay(d) === month) noted.push(d); }
    noted.sort((a, b) => a - b);
    const today = todayNow();
    const style = `${h.face.family}:${h.face.weight}:${raster.version()}:${ticksOn ? 1 : 0}:${lookKey(look)}`;
    const zone = zoneNow();
    const key = `${events.map((ev) => `${ev.id}.${ev.rev}.${ev.start}.${ev.end}`).join(",")}|${weekStart}|${noted.join(",")}|${today}|${zone ?? ""}|${style}|${writing}`;
    const id = `${st.id}:${month}`;
    const hit = prints.get(id);
    if (hit !== undefined && hit.key === key) return hit.print;
    const print = printSheet({
      law, look, sheet: L, events, noted: new Set(noted), today, moons: phasesBetween(g.first, last, (ms) => dayIn(ms, zone)),
      face: h.face, metrics: h.metrics, hand, measure: (f, t) => raster.measure(f, t), ticks: ticksOn, style, plain: writing,
    });
    prints.set(id, { key, print });
    return print;
  };
  /**
   * The notes stuck to pad `e` that go with its months this frame (the prototype's `syncNotes`, each note at its day's slot): a note
   * whose month is not laid bare; mid-turn, one on the sheet in motion once the roll has reached it, one on the sheet beneath until
   * the roll has laid it bare (Q-7: a note steps out of sight as the roll reaches it — it is not wound into the paper).
   */
  const hiddenOf = (e: Entity, G: CalendarGeometry): ReadonlySet<Entity> => {
    const out = new Set<Entity>();
    const ch = host.children;
    if (ch?.entries === undefined || ch.target === undefined) return out;
    for (const { entity: pin, value } of ch.entries(e, NotePin)) {
      const note = ch.target(pin, PinsNote);
      const day = dayOr(value.day ?? "");
      if (note === undefined || day === undefined) continue;
      const m = monthOfDay(day);
      let show = m === G.base && G.moving === null;
      const R = G.roll;
      if (G.moving !== null && R !== null && (m === G.moving || m === G.base)) {
        const L = sheetOf(monthGrid(m, G.weekStart), law);
        const k = day - L.grid.first;
        const slot = noteSlot(L, Math.floor(k / 7), k % 7, law);
        const h = (law.note.size / 2) * 1.05;
        const corners: readonly (readonly [number, number])[] = [[slot.x - h, slot.y - h], [slot.x + h, slot.y - h], [slot.x - h, slot.y + h], [slot.x + h, slot.y + h]];
        show = m === G.moving
          ? corners.every(([x, y]) => y - F.T < tangentAt(R, x) - rollAt(R, x).radius * 1.1)
          : corners.every(([x, y]) => y - F.T > tangentAt(R, x) + rollAt(R, x).radius * 1.25);
      }
      if (!show) out.add(note);
    }
    return out;
  };
  let veilsCache: ReadonlySet<Entity> | null = null;
  /** The marks' boxes on the sheet they are on (the base at rest and rolling down, the moving sheet rolling up). */
  const marksOn = (st: PadState, month: number, weekStart: 0 | 1, print: SheetPrint | undefined): Pick<CalendarDraw, "sel" | "mark" | "drop" | "caret" | "wipe"> => {
    const m = st.marks;
    if (m === undefined) return NO_MARKS;
    const L = sheetOf(monthGrid(month, weekStart), law);
    const sel: SheetBox[] = [];
    if (m.days !== undefined) {
      const [a, b] = m.days[0] <= m.days[1] ? m.days : [m.days[1], m.days[0]];
      for (let d = a; d <= b;) {
        const b0 = dayBox(L, d);
        const col = (((d - L.grid.first) % 7) + 7) % 7;
        const endD = Math.min(b, d + (6 - col));
        const b1 = dayBox(L, endD);
        if (b0 !== null && b1 !== null) sel.push([b0.x + 3, b0.y + 3, b1.x + b1.w - 3, b1.y + b1.h - 3]);
        d = endD + 1;
        if (sel.length >= 6) break;
      }
    }
    let mark: SheetBox | null = null;
    let caret: CalendarDraw["caret"] = null;
    let wipe: CalendarDraw["wipe"] = null;
    const line = (id: number): EventLine | undefined => print?.lines.find((l) => l.event.id === id);
    const selected = m.writing?.entry ?? m.entry;
    if (selected !== undefined) {
      const l = line(selected);
      if (l !== undefined) mark = [l.box.x - 5, l.box.y - 1, l.box.x + l.box.w + 5, l.box.y + l.box.h + 2];
      const w = m.writing;
      if (l !== undefined && w !== undefined) {
        const n = l.layout.positions.length / 2 - 1;
        const cp = caretAt(l.layout, Math.min(Math.max(w.index, 0), n));
        if (w.on) caret = [l.ox + cp.x, l.oy + cp.y - cp.above * 0.8, l.oy + cp.y + cp.below * 0.6, 1.3];
        const wp = m.wipe;
        if (wp !== undefined && wp.entry === selected && wp.t < 1) {
          const gl = l.layout.glyphs.find((q) => q.index === wp.index);
          if (gl !== undefined) { const gb = glyphBox(l.layout, gl); wipe = { box: [l.ox + gb.x0, l.oy + gb.y0, l.ox + gb.x1, l.oy + gb.y1], t: Math.max(wp.t, 0) }; }
        }
      }
    }
    let drop: SheetBox | null = null;
    if (m.drop !== undefined) { const b = dayBox(L, m.drop); if (b !== null) drop = [b.x + 2, b.y + 2, b.x + b.w - 2, b.y + b.h - 2]; }
    return { sel, mark, drop, caret, wipe };
  };
  return {
    pin(e, pose) { state(e).pose = pose; woke = true; },   // a scene's pose, pinned before its first draw (the oracle's, a test's): the draw path's own setup
    sheets: (e, durable) => rollSheets(state(e).roll, durable, law, F),
    rollOf(e) {
      const st = pads.get(e);
      if (st === undefined) return undefined;
      const r = st.roll;
      const t = r.turn;
      return { shown: r.shown, turn: t === null ? null : { dir: t.dir, p: t.p, target: t.target, held: t.drag !== null, hand: t.hand }, peek: r.peek, pending: r.pending };
    },
    peek(e, on) { const r = pads.get(e)?.roll; if (r !== undefined && r.peekOn !== on) { r.peekOn = on; woke = true; } },
    grab(e, part, sx, s, now) {
      const r = pads.get(e)?.roll;
      if (r === undefined) return false;
      let ok: boolean;
      if (part === "moving") ok = grabMoving(r, s, now);
      else if (part === "roll") ok = startTurn(r, -1, 0, law, F, { hand: true, drag: { s, now } });
      else {
        const tilt = part === "corner" || sx > F.W * 0.78 ? -law.roll.tilt : sx < F.W * 0.22 ? law.roll.tilt : 0;
        ok = startTurn(r, 1, tilt, law, F, { hand: true, drag: { s, now } });
      }
      if (ok) woke = true;
      return ok;
    },
    dragTo(e, s, now, moved) { const st = pads.get(e); if (st === undefined) return; dragTo(st.roll, s, now, moved, law, F); woke = true; },
    letGo(e, now, cancel) { const st = pads.get(e); if (st === undefined) return; letGo(st.roll, now, law, F, cancel); woke = true; },
    rolled() {
      const out: { e: Entity; month: number }[] = [];
      for (const [e, st] of pads) if (st.roll.rolled && st.roll.shown !== null) { st.roll.rolled = false; out.push({ e, month: st.roll.shown }); }
      return out;
    },
    unroll(e) { const st = pads.get(e); if (st === undefined) return; st.roll.pending = null; woke = true; },
    busy: () => pads.size > 0,
    state,
    alpha(a) { const k = host.pass(); if (k instanceof CalendarKind && k.alpha !== a) k.alpha = a; },
    events: (e) => host.children?.rows(e, CalendarEvent) ?? [],
    today: todayNow,
    // a pin is its own frame, never a turn of the day: the next look at the wall clock starts afresh
    pinToday(key) { todayPin = key === null ? null : (dayOr(key) ?? null); dayShown = null; woke = true; },
    pinZone(zone) { zonePin = zone; dayShown = null; woke = true; },
    ticks(on) { if (on !== undefined && on !== ticksOn) { ticksOn = on; woke = true; } return ticksOn; },
    entries: (e) => entriesOf(e),
    printOf: (e, month) => { const st = pads.get(e); return st === undefined ? undefined : prints.get(`${st.id}:${month}`)?.print; },
    pinPrint(e, month, sheet) { const st = state(e); if (sheet === null) st.pinned.delete(month); else st.pinned.set(month, sheet); woke = true; },
    mark(e, marks) { const st = pads.get(e); if (st !== undefined && !sameMarks(st.marks, marks)) { st.marks = marks; woke = true; } },
    marksOf: (e) => pads.get(e)?.marks,
    draft(e, d) { const st = pads.get(e); if (st !== undefined && st.draft !== d) { st.draft = d; woke = true; } },
    draftOf: (e) => pads.get(e)?.draft ?? null,
    tiles: () => ({ resident: tiles?.resident() ?? 0, pending: tiles?.pending() ?? 0, drawn: tiles?.drawn() ?? 0, starved: tiles?.starved() ?? 0 }),
    readSheet(e, month, level) {
      const st = pads.get(e);
      const print = st === undefined ? undefined : prints.get(`${st.id}:${month}`)?.print;
      const raster = host.print;
      if (print === undefined || raster === undefined) return undefined;
      const out = new Map<string, Uint8Array<ArrayBuffer>>();
      const empty = new Set<string>();
      const grid = tileGrid(F.W, F.H);
      for (const [tx, ty] of tilesIn(grid, level, 0, 0, F.W, F.H)) {
        const r = tileRect(level, tx, ty);
        const g = GUTTER / bandOf(level);
        if (!anyIn(print, r.x - g, r.y - g, r.w + 2 * g, r.h + 2 * g)) { empty.add(`${tx}:${ty}`); continue; }
        out.set(`${tx}:${ty}`, raster.bytes(print, r.x - g, r.y - g, r.w + 2 * g, r.h + 2 * g, bandOf(level)));
      }
      return { tiles: out, empty };
    },
    veils() {
      if (veilsCache === null) { const all = new Set<Entity>(); for (const st of pads.values()) for (const n of st.hidden) all.add(n); veilsCache = all; }
      return veilsCache;
    },
    draw(e, G, view, look) {
      const st = state(e);
      // the notes stuck to it that go with its months (before the things are drawn: the pads paint first)
      const hidden = hiddenOf(e, G);
      if (hidden.size !== st.hidden.size || [...hidden].some((n) => !st.hidden.has(n))) { st.hidden = hidden; veilsCache = null; }
      const writing = st.marks?.writing?.entry ?? Number.NaN;
      const markMonth = G.marksOn === 1 && G.moving !== null ? G.moving : G.base;
      const pass = passOf();
      let markPrint: SheetPrint | undefined;
      const sheets: [number, number][] = [[G.base, st.slot * 2]];
      if (G.moving !== null) sheets.push([G.moving, st.slot * 2 + 1]);
      for (const [month, slot] of sheets) {
        const pinned = st.pinned.get(month);
        if (pass !== undefined && pinned !== undefined) { const t = tilesOf(pass); t.pin(pass, `${st.id}:${month}`, slot, pinned); t.end(pass); continue; }
        const print = look === undefined ? undefined : printFor(e, st, month, G.weekStart, look, month === markMonth ? writing : Number.NaN);
        if (month === markMonth) markPrint = print;
        if (pass === undefined || print === undefined || host.print === undefined) continue;
        // the sheet in view (sheet units) and the rung the screen wants — the moving sheet a rung softer, as the prototype drew it
        const x0 = view.camX - (G.cx - F.W / 2);
        const y0 = view.camY - (G.cy - F.H / 2);
        const x1 = x0 + view.width / view.zoom;
        const y1 = y0 + view.height / view.zoom;
        if (x1 < 0 || y1 < 0 || x0 > F.W || y0 > F.H) continue;
        const level = levelFor(view.zoom * view.dpr);
        const t = tilesOf(pass);
        const tiles0 = t.drawn();
        t.sheet(pass, host.print, `${st.id}:${month}`, slot, print, { x0, y0, x1, y1 }, month === G.base ? level : Math.max(level - 1, 0), G.moving === null ? 2 : 1);
        if (t.drawn() !== tiles0) land(e);
        t.end(pass);
      }
      return marksOn(st, markMonth, G.weekStart, markPrint);
    },
    /** The budget's ask (D6): the tile texture is the pass's, fixed — always kept. */
    keeps: () => true,
    landed: (e) => landedOf.get(e) ?? 0,
    tick(now) {
      // tiles still to draw are a reason for a frame only while a pad DREW since the last tick: a pad culled (the builder resolves
      // nothing off-screen) or gone leaves its count standing, and a count no frame will ever lower kept the desk awake (D7)
      const drew = begun;
      begun = false;
      chargeTiles();
      // the months turning (their springs on the frame's clock); tiles still to draw: another frame (the marks' clocks — the
      // caret's blink, the wipe — are the hand's: it marks anew)
      const dt = lastTick === null ? 0 : Math.min(Math.max((now - lastTick) / 1000, 0), 0.1);
      lastTick = now;
      let turning = false;
      for (const st of pads.values()) if (st.roll.durable !== null && st.pose === undefined && stepRoll(st.roll, st.roll.durable, dt, law, F)) turning = true;
      // the day turns over (D7): today's ring and its ticks — an unrolled pad's month too — move at midnight; the wall clock is asked
      // about once a second, and a pinned today never turns
      let turned = false;
      const wall = clock();
      if (wall >= dayCheckAt) {
        dayCheckAt = wall + 1000;
        const d = todayNow();
        turned = dayShown !== null && d !== dayShown;
        dayShown = d;
      }
      const w = woke || turning || turned || (drew && (tiles?.pending() ?? 0) > 0);
      woke = false;
      return w;
    },
    forget(e) {
      const st = pads.get(e);
      if (st === undefined) return;
      free.push(st.slot);
      pads.delete(e);
      landedOf.delete(e);
      if (st.hidden.size > 0) veilsCache = null;
      tiles?.drop(st.id, [st.slot * 2, st.slot * 2 + 1]);
      for (const k of [...prints.keys()]) if (k.startsWith(`${st.id}:`)) prints.delete(k);
    },
    dispose() { pads.clear(); prints.clear(); },
  };
}

/** Two marks the same (the local wakes only when they moved). */
function sameMarks(a: PadMarks | undefined, b: PadMarks | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The print look as a key (a changed look is a changed print). */
const lookKeys = new WeakMap<PrintLook, string>();
function lookKey(look: PrintLook): string {
  let k = lookKeys.get(look);
  if (k === undefined) { k = JSON.stringify(look); lookKeys.set(look, k); }
  return k;
}

/** A sheet as the pass draws it (the oracle's `sheetDrawOf`): where its grid is printed, its rows, weekends and days, its table's slot. */
export function sheetDraw(month: number, weekStart: 0 | 1, slot: number, law: CalendarLaw = CALENDAR): SheetDraw {
  const L = sheetOf(monthGrid(month, weekStart), law);
  const g = L.grid;
  let weekends = 0;
  for (let col = 0; col < 7; col++) if (isWeekendCol(g, col)) weekends |= 1 << col;
  return { x0: L.x0, y0: L.y0, cw: L.cw, ch: L.ch, rows: L.rows, weekends, lead: g.lead, days: g.days, slot };
}

/** How far a pad's drawing reaches past its sheet, world units: its lift through the eye and its shadow (the pad lies low), the ring's offset. */
export function calendarReach(law: CalendarLaw = CALENDAR): number {
  const F = padFrame(law);
  const h = F.zTape + law.lift;
  return law.shadow.slopeMax * h + 3 * (law.shadow.sigma0 + law.shadow.perUnit * h) + law.ring.offset + 8;
}

/**
 * A desk calendar's silhouette for the desk's marks (D4a — the brackets, a member's ticks, the tape): its sheet's footprint
 * on the mat, square to it, about the pad's centre, with the sheet's corner. The height's parallax aside, as the print's;
 * the oracle's marks read the same function (oracle/frame.mjs).
 */
export function calendarFrame(cx: number, cy: number, law: CalendarLaw = CALENDAR): MarkFrame {
  const F = padFrame(law);
  return { cx, cy, hx: F.W / 2, hy: F.H / 2, angle: 0, r: law.sheet.radius };
}

/** The bar's ‹ › (D3t-c): the pad's month one on or back — its durable `month`, ONE transaction off the undo stack (a roll is not an edit). */
function turnBy(api: HeldToolApi, d: 1 | -1): void {
  // a pad with no month chosen steps from the platform's month (the bar has no word from the pad's clock; a still spawns its month)
  const m = monthOfKey(stringProp(api.props(), "month", "")) ?? monthOfDay(todayOf());
  api.setProps({ month: monthKeyOf(m + d) }, { undoable: false });
}

/** The bar's today (D3t-c): the hand rolls the pad home and selects today — asked through the pad's selection (`home` bumped). */
function homeOf(api: HeldToolApi): void {
  const cur = api.world.get(api.entity, PadSelection);
  if (cur === undefined) api.world.addComponent(api.entity, PadSelection, { anchor: "", focus: "", entry: 0 as Entity, home: 1 });
  else api.world.edit(api.entity).set(PadSelection, { ...cur, home: (cur.home ?? 0) + 1 });
}

export interface CalendarKindOptions {
  readonly text?: ShaderText;
  /** The calendar's numbers (calendar/law.ts `CALENDAR`) — the engine's unless a host tweaks them. */
  readonly law?: CalendarLaw;
}

/** The desk calendar's kind, whole (kinds/world.ts `ObjectKind`): the program, and the world half on the lab's own pad. */
export function calendarKind(opts: CalendarKindOptions = {}): ObjectKind<CalendarGeometry, CalendarDraw, CalendarObjectLook> {
  const law = opts.law ?? CALENDAR;
  const program = calendarProgram(opts.text ?? shaderText);
  const F = padFrame(law);
  const mesh = buildPad(new MeshWriter(2048, 8192), F, law);
  const roll = (p: number, tilt: number): RollState => rollState(p, { rest: law.roll.rest + 0.6, tau: law.roll.tau }, F.L, F.W, tilt);
  return {
    ...program,
    reach: calendarReach(law),
    // its entries and its pins are cells of its data children (D3t-c): a line typed, a peer's edit, a note stuck — the builder wakes
    reads: { components: [CalendarEvent, NotePin] },
    local: (host: KindHost): Pads => createPads(host, { law }),
    // THE OPENING (design-015 §8, D4b — Q-q): the month comes to the hand laid bare, flat under the pose's camera (the notes stuck
    // to it ride along, as when the pad is carried). Its tools, LIVE on D3t-a's seam (D3t-c): ‹ › turn the month — its durable
    // `month`, ONE transaction off the undo stack (D-D3t-c.5; the kind's local rolls the sheet there) —, today asks the hand to roll
    // home and select today (`PadSelection.home`, the user's fact), and the PEN is the tool in hand: a press on the month is its
    // (the days selected, a line written, a sheet rolled by hand — never a tap that puts the pad down)
    open: {
      extent: (c) => c.rect,
      tools: [
        { id: "month:-1", label: "Previous month", kind: "action", keys: ["ArrowLeft", "PageUp", "["], hint: "←", glyph: "chevron-left", run: (api) => turnBy(api, -1) },
        { id: "month:1", label: "Next month", kind: "action", keys: ["ArrowRight", "PageDown", "]"], hint: "→", glyph: "chevron", run: (api) => turnBy(api, 1) },
        { id: "today", label: "Today", kind: "action", keys: ["t"], hint: "T", glyph: "today", run: (api) => homeOf(api) },
        { id: "pen", label: "The pen", kind: "mode", keys: ["p"], hint: "P", glyph: "pen" },
      ],
      tool: () => "pen",
    },
    resolve(ctx: ObjectContext): CalendarGeometry {
      const pads = ctx.local as Pads | undefined;
      const pose = pads?.state(ctx.entity).pose;
      // no month chosen (the default ''): the month of the pad's today (its clock seam — a still's pinned day), never a literal (D7)
      const shown = monthOfKey(stringProp(ctx.props, "month", "")) ?? monthOfDay(pads?.today() ?? todayOf());
      const weekStart: 0 | 1 = numberProp(ctx.props, "weekStart", 1) === 0 ? 0 : 1;
      let sh: { base: number; moving: number | null; roll: RollState | null; marksOn: 0 | 1 } = { base: shown, moving: null, roll: null, marksOn: 0 };
      const r = pose?.roll;
      let laid = shown;
      let turning = r !== undefined;
      if (r !== undefined) sh = r.dir === 1 ? { base: shown + 1, moving: shown, roll: roll(r.p, r.tilt ?? 0), marksOn: 1 } : { base: shown, moving: shown - 1, roll: roll(r.p, r.tilt ?? 0), marksOn: 0 };
      else if ((pose?.peek ?? 0) > 1e-3) sh = { base: shown + 1, moving: shown, roll: roll(((pose?.peek ?? 0) * law.roll.peek) / (F.L - law.roll.rest), -law.roll.tilt), marksOn: 1 };
      else if (pads !== undefined && pose === undefined) {
        // the months turning (D3t-c): the pad shows the month it has laid bare and rolls toward the document's
        const t = pads.sheets(ctx.entity, shown);
        laid = t.shown;
        turning = t.turning;
        sh = { base: t.base, moving: t.moving, roll: t.roll, marksOn: t.marksOn };
      }
      const lift = law.lift * ctx.flux.lift;
      const v = ctx.view;
      return {
        shown: laid, weekStart, ...sh, rigid: rigidOf({ cx: ctx.rect.cx, cy: ctx.rect.cy, angle: 0, lift, tiltX: 0, tiltY: 0, zc: 0 }),
        lamp: lampDir(ctx.lamp, ctx.rect.cx, ctx.rect.cy, law.shadow.slopeMax), lift, ring: ctx.flux.ring * ctx.flux.fade,
        eye: eyeOf({ x: v.camX, y: v.camY, zoom: v.zoom }, { width: v.width, height: v.height }, law.eye), cx: ctx.rect.cx, cy: ctx.rect.cy,
        held: ctx.held !== undefined, turning,
      };
    },
    record(G: CalendarGeometry, ctx: ObjectContext): CalendarDraw {
      const look = ctx.look as CalendarObjectLook | undefined;
      const tapes = look?.tapes ?? {};
      const tape = tapes[stringProp(ctx.props, "tape", "")] ?? Object.values(tapes)[0];
      const pen = look?.pens[stringProp(ctx.props, "pen", "")] ?? Object.values(look?.pens ?? {})[0];
      if (look === undefined || tape === undefined || pen === undefined) throw new Error("desk/calendar: the pad's colours are the host's — the palette names no `calendars` (or no `pens`) (kinds/calendar.ts `CalendarPalette`)");
      const pads = ctx.local as Pads | undefined;
      pads?.alpha(look.alpha);
      const st = pads?.state(ctx.entity) ?? { id: 1, slot: 0 };
      const colours: CalendarColours = { paper: look.paper, ink: look.ink, muted: look.muted, weekend: look.weekend, hot: look.hot, chipboard: look.chipboard, cloth: tape.cloth, foil: tape.foil, pen };
      // the print (D3t-c): the sheets' tiles brought up to date from the events; the hand's marks on the sheet they are on
      const marks = pads?.draw(ctx.entity, G, ctx.view, look.print) ?? { sel: [], mark: null, drop: null, caret: null, wipe: null };
      return {
        id: st.id, frame: F, mesh, version: 1, rigid: G.rigid, lamp: G.lamp, lift: G.lift, ring: G.ring,
        base: sheetDraw(G.base, G.weekStart, st.slot * 2, law), moving: G.moving !== null ? sheetDraw(G.moving, G.weekStart, st.slot * 2 + 1, law) : null, roll: G.roll, marksOn: G.marksOn,
        ...marks, colours,
      };
    },
    hit(G: CalendarGeometry, wx: number, wy: number): ObjectHit | null {
      // the desk point unprojected at the pad's face (its top sheet, lifted) through the eye. At rest the tape is the pad's (a press
      // carries it, a tap selects it) and the ROLL's handles are parts (the roll under the tape, the corner, the foot, the sheet in
      // motion — a press there rolls, never pans, D3t-c); its paper is not taken — a drag there pans the desk, a click is the days'
      // (host/calendar-input.ts reads it at event time). In hand the whole sheet is the pen's surface (`content`: a press there is
      // the tool's, D3t-a) and the tape the pad's frame.
      const at = partAt(G, wx, wy, [], law);
      if (at === null) return null;
      if (at.part === "tape") return "frame";
      if (G.held) return "content";
      return at.part === "roll" || at.part === "corner" || at.part === "foot" || at.part === "moving" ? at.part : null;
    },
    frame: (G: CalendarGeometry): MarkFrame => calendarFrame(G.cx, G.cy, law),
    theme(palette: Palette, _name: ThemeName): CalendarObjectLook {
      const p = palette as CalendarPalette;
      const c = p.calendars;
      const pens = Object.fromEntries(Object.entries(p.pens ?? {}).map(([k, t]) => [k, rgb(t.css)]));
      if (c === undefined) return { paper: [0, 0, 0], ink: [0, 0, 0], muted: [0, 0, 0], weekend: [0, 0, 0], hot: [0, 0, 0], chipboard: [0, 0, 0], tapes: {}, pens, alpha: { rule: 0, head: 0, weekend: 0, outside: 0 } };
      // the print's inks (D3t-c): the fixture's `calendarPrint` from the same tokens — the pens a line is written in, the pencil, the highlighters
      const print: PrintLook | undefined = c.pencil === undefined || c.highlighters === undefined ? undefined : {
        ink: cssOf(rgb(c.ink.css)), muted: cssOf(rgb(c.muted.css)), faint: c.alpha.faint ?? 0.26, hot: cssOf(rgb(c.hot.css)), pencil: cssOf(rgb(c.pencil.css), PENCIL_ALPHA),
        pens: Object.fromEntries(Object.entries(p.pens ?? {}).map(([k, t]) => [k, cssOf(rgb(t.css))])),
        highlighters: Object.fromEntries(Object.entries(c.highlighters).map(([k, t]) => [k, cssOf(rgb(t.css))])), highlight: c.alpha.highlight ?? 0.62,
      };
      const alpha: CalendarAlpha = { rule: c.alpha.rule, head: c.alpha.head, weekend: c.alpha.weekend, outside: c.alpha.outside };
      return {
        paper: rgb(c.paper.css), ink: rgb(c.ink.css), muted: rgb(c.muted.css), weekend: rgb(c.weekend.css), hot: rgb(c.hot.css), chipboard: rgb(c.chipboard.css),
        tapes: Object.fromEntries(Object.entries(c.tapes).map(([k, t]) => [k, { cloth: rgb(t.cloth.css), foil: rgb(t.foil.css) }])), pens, alpha: c.alpha,
        ...(print !== undefined ? { print } : {}),
      };
    },
  };
}
