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
// (`frame` — a press carries it, a tap selects it); its paper is not taken (a miss — the press falls through to the
// mat and pans, the lab's "not taken"); the days, the entries, the roll and the corner are D3t's parts. Its events
// and pins are data children (calendar/data.ts), read-only here. The colours and the print's presences are the
// product's (`theme()`; the presences set on the root pass by the kind's local — the theme gate).

import type { Entity } from "@ice/core";
import { CalendarEvent, monthOfKey } from "../calendar/data";
import { padFrame, buildPad } from "../calendar/pad";
import { CALENDAR, type CalendarLaw } from "../calendar/law";
import type { CalendarColours } from "../calendar/layout";
import { isWeekendCol, monthGrid } from "../calendar/month";
import { type CalendarDraw, CalendarPass, type SheetDraw } from "../calendar/pass";
import { rollState, type RollState } from "../calendar/roll";
import { CALENDAR_SHADER_FILES, calendarShaders } from "../calendar/shaders";
import { sheetOf } from "../calendar/sheet";
import { type TileGrid, tileGrid } from "../calendar/tiles";
import type { KindProgram, SlotContext } from "../kind";
import type { MatPass } from "../mat/mat-pass";
import { type DeskEye, eyeOf, unproject } from "../notebook/eye";
import { MeshWriter } from "../notebook/mesh";
import { lampDir, type Rigid, rigidOf } from "../notebook/place";
import { type ShaderText, shaderText } from "../shaders";
import { MAT_COLORS, type Palette, type RGB, rgb, type ThemeName, type TokenRef } from "../theme";
import type { MarkFrame } from "../marks/layout";
import { LayeredKind } from "./layer";
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
    create: async (device, format, mat) => new CalendarKind(await CalendarPass.create(device, format, calendarShaders(text(CALENDAR_SHADER_FILES)), mat)),
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
    readonly alpha: CalendarAlpha;
  };
  readonly pens?: Readonly<Record<string, TokenRef>>;
}

/** The calendar's look for a theme, parsed. */
export interface CalendarObjectLook {
  readonly paper: RGB; readonly ink: RGB; readonly muted: RGB; readonly weekend: RGB; readonly hot: RGB; readonly chipboard: RGB;
  readonly tapes: Readonly<Record<string, { readonly cloth: RGB; readonly foil: RGB }>>;
  readonly pens: Readonly<Record<string, RGB>>;
  readonly alpha: CalendarAlpha;
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
}

/** The calendar's own state on one desk: each pad's id and page-table slots, its pinned still; the print's presences on the root pass. */
export interface Pads extends KindLocal {
  pin(e: Entity, pose: PadPose | undefined): void;
  /** The world half's: the pad's id, its slot pair (its base sheet's table is 2k, its moving sheet's 2k + 1) and its pin. */
  state(e: Entity): { readonly id: number; readonly slot: number; readonly pose: PadPose | undefined };
  /** The world half's: the print's presences on the root pass (the product's look). */
  alpha(a: CalendarAlpha): void;
  /** A pad's events as its data children hold them (read-only here — D3t writes them). */
  events(e: Entity): readonly { readonly start: string | null; readonly end: string | null; readonly text: string | null; readonly ink: string | null }[];
}

/** The calendar's `local()`: ids from 1, slot pairs from the lowest free (the pass's tables hold `MAX_CALENDARS` pads). */
export function createPads(host: KindHost): Pads {
  const pads = new Map<Entity, { readonly id: number; readonly slot: number; pose: PadPose | undefined }>();
  const free: number[] = [];
  let nextId = 1;
  let nextSlot = 0;
  let woke = false;
  const state = (e: Entity) => {
    let st = pads.get(e);
    if (st === undefined) { free.sort((a, b) => a - b); st = { id: nextId++, slot: free.shift() ?? nextSlot++, pose: undefined }; pads.set(e, st); }
    return st;
  };
  return {
    pin(e, pose) { state(e).pose = pose; woke = true; },
    state,
    alpha(a) { const k = host.pass(); if (k instanceof CalendarKind && k.alpha !== a) k.alpha = a; },
    events: (e) => host.children?.rows(e, CalendarEvent) ?? [],
    tick() { const w = woke; woke = false; return w; },
    forget(e) { const st = pads.get(e); if (st === undefined) return; free.push(st.slot); pads.delete(e); },
    dispose() { pads.clear(); },
  };
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
    local: (host: KindHost): Pads => createPads(host),
    resolve(ctx: ObjectContext): CalendarGeometry {
      const pads = ctx.local as Pads | undefined;
      const pose = pads?.state(ctx.entity).pose;
      const shown = monthOfKey(stringProp(ctx.props, "month", "")) ?? (monthOfKey("2026-09") as number);
      const weekStart: 0 | 1 = numberProp(ctx.props, "weekStart", 1) === 0 ? 0 : 1;
      let sh: { base: number; moving: number | null; roll: RollState | null; marksOn: 0 | 1 } = { base: shown, moving: null, roll: null, marksOn: 0 };
      const r = pose?.roll;
      if (r !== undefined) sh = r.dir === 1 ? { base: shown + 1, moving: shown, roll: roll(r.p, r.tilt ?? 0), marksOn: 1 } : { base: shown, moving: shown - 1, roll: roll(r.p, r.tilt ?? 0), marksOn: 0 };
      else if ((pose?.peek ?? 0) > 1e-3) sh = { base: shown + 1, moving: shown, roll: roll(((pose?.peek ?? 0) * law.roll.peek) / (F.L - law.roll.rest), -law.roll.tilt), marksOn: 1 };
      const lift = law.lift * ctx.flux.lift;
      const v = ctx.view;
      return {
        shown, weekStart, ...sh, rigid: rigidOf({ cx: ctx.rect.cx, cy: ctx.rect.cy, angle: 0, lift, tiltX: 0, tiltY: 0, zc: 0 }),
        lamp: lampDir(ctx.lamp, ctx.rect.cx, ctx.rect.cy, law.shadow.slopeMax), lift, ring: ctx.flux.ring * ctx.flux.fade,
        eye: eyeOf({ x: v.camX, y: v.camY, zoom: v.zoom }, { width: v.width, height: v.height }, law.eye), cx: ctx.rect.cx, cy: ctx.rect.cy,
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
      return {
        id: st.id, frame: F, mesh, version: 1, rigid: G.rigid, lamp: G.lamp, lift: G.lift, ring: G.ring,
        base: sheetDraw(G.base, G.weekStart, st.slot * 2, law), moving: G.moving !== null ? sheetDraw(G.moving, G.weekStart, st.slot * 2 + 1, law) : null, roll: G.roll, marksOn: G.marksOn,
        sel: [], mark: null, drop: null, caret: null, wipe: null, colours,
      };
    },
    hit(G: CalendarGeometry, wx: number, wy: number): ObjectHit | null {
      // the desk point unprojected at the pad's face (its top sheet, lifted) through the eye; at rest only the tape is the pad's
      const [px, py] = unproject(G.eye, wx, wy, F.zt + G.lift);
      const sx = px - G.cx + F.W / 2;
      const sy = py - G.cy + F.H / 2;
      if (sx < 0 || sy < 0 || sx > F.W || sy > F.H) return null;
      return sy < F.T ? "frame" : null;
    },
    frame: (G: CalendarGeometry): MarkFrame => calendarFrame(G.cx, G.cy, law),
    theme(palette: Palette, _name: ThemeName): CalendarObjectLook {
      const p = palette as CalendarPalette;
      const c = p.calendars;
      const pens = Object.fromEntries(Object.entries(p.pens ?? {}).map(([k, t]) => [k, rgb(t.css)]));
      if (c === undefined) return { paper: [0, 0, 0], ink: [0, 0, 0], muted: [0, 0, 0], weekend: [0, 0, 0], hot: [0, 0, 0], chipboard: [0, 0, 0], tapes: {}, pens, alpha: { rule: 0, head: 0, weekend: 0, outside: 0 } };
      return {
        paper: rgb(c.paper.css), ink: rgb(c.ink.css), muted: rgb(c.muted.css), weekend: rgb(c.weekend.css), hot: rgb(c.hot.css), chipboard: rgb(c.chipboard.css),
        tapes: Object.fromEntries(Object.entries(c.tapes).map(([k, t]) => [k, { cloth: rgb(t.cloth.css), foil: rgb(t.foil.css) }])), pens, alpha: c.alpha,
      };
    },
  };
}
