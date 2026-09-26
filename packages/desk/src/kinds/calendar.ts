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

import { padFrame } from "../calendar/pad";
import { CALENDAR, type CalendarLaw } from "../calendar/law";
import { type CalendarDraw, CalendarPass } from "../calendar/pass";
import { CALENDAR_SHADER_FILES, calendarShaders } from "../calendar/shaders";
import { type TileGrid, tileGrid } from "../calendar/tiles";
import type { KindProgram, SlotContext } from "../kind";
import type { MatPass } from "../mat/mat-pass";
import { eyeOf } from "../notebook/eye";
import type { ShaderText } from "../shaders";
import { MAT_COLORS } from "../theme";
import { LayeredKind } from "./layer";

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
