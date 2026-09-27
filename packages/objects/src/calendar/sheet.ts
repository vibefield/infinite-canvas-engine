// A month's SHEET — where everything on it goes (CALENDAR.md §3). Pure. Sheet coordinates are world
// units from the sheet's top-left corner, y down the pad: the tape covers the head, the roll of the
// months before lies under it, then the month's name, the weekdays, the grid, the foot. The grid's
// height is fixed and a month's rows share it — four, five or six weeks, taller cells in a shorter
// month (the "dynamic" layout a system calendar has, printed). A cell holds its date at the top
// left, the week's bands in lanes under it, the day's lines, and — at its foot — the sticky note
// stuck to that day, if one is.

import type { CalendarLaw } from "./law";
import { sheetSize } from "./law";
import { cellDay, type MonthGrid } from "./month";

export interface Box { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

export interface SheetLayout {
  readonly W: number;
  readonly H: number;
  readonly grid: MonthGrid;
  /** The grid's top-left, a cell's size. */
  readonly x0: number;
  readonly y0: number;
  readonly cw: number;
  readonly ch: number;
  readonly rows: number;
  /** Where the title band and the weekday row start. */
  readonly titleY: number;
  readonly weekdaysY: number;
}

export function sheetOf(g: MonthGrid, law: CalendarLaw): SheetLayout {
  const { W, H } = sheetSize(law);
  const s = law.sheet;
  const titleY = s.tape + s.rollZone;
  const weekdaysY = titleY + s.title;
  const y0 = weekdaysY + s.weekdays;
  return { W, H, grid: g, x0: s.margin, y0, cw: law.grid.cw, ch: law.grid.height / g.rows, rows: g.rows, titleY, weekdaysY };
}

export const cellBox = (L: SheetLayout, row: number, col: number): Box => ({ x: L.x0 + col * L.cw, y: L.y0 + row * L.ch, w: L.cw, h: L.ch });

/** The cell under a sheet point, with its day — or null off the grid. */
export function cellAt(L: SheetLayout, x: number, y: number): { readonly row: number; readonly col: number; readonly day: number } | null {
  const col = Math.floor((x - L.x0) / L.cw);
  const row = Math.floor((y - L.y0) / L.ch);
  if (col < 0 || col > 6 || row < 0 || row >= L.rows) return null;
  return { row, col, day: cellDay(L.grid, row, col) };
}

/** A day's cell on this sheet (a neighbour month's day in the first or last row counts), or null. */
export function dayBox(L: SheetLayout, day: number): Box | null {
  const i = day - L.grid.first;
  if (i < 0 || i >= L.rows * 7) return null;
  return cellBox(L, Math.floor(i / 7), i % 7);
}

/** Where a sticky note stuck to a day sits: centred across the cell, its foot `gap` above the cell's. */
export function noteSlot(L: SheetLayout, row: number, col: number, law: CalendarLaw): { readonly x: number; readonly y: number } {
  const b = cellBox(L, row, col);
  return { x: b.x + b.w / 2, y: b.y + b.h - law.note.gap - law.note.size / 2 };
}

/** How many lines of writing a cell holds (bands included) — fewer when a note hangs at its foot. */
export function lineCapacity(L: SheetLayout, law: CalendarLaw, noted: boolean): number {
  const h = law.hand;
  const bottom = noted ? L.ch - law.note.gap - law.note.size - 2 : L.ch - 8;
  return Math.max(0, Math.floor((bottom - h.top) / h.pitch));
}

/** The i-th line's box in a cell (a band's lane or a day's line). */
export function lineBox(L: SheetLayout, row: number, col: number, i: number, law: CalendarLaw): Box {
  const b = cellBox(L, row, col);
  const h = law.hand;
  return { x: b.x + h.pad, y: b.y + h.top + i * h.pitch, w: b.w - 2 * h.pad, h: h.pitch };
}

/** A band's box in its week row: from its first column to its last, in its lane. */
export function bandBox(L: SheetLayout, row: number, col0: number, col1: number, lane: number, law: CalendarLaw): Box {
  const h = law.hand;
  const y = L.y0 + row * L.ch + h.top + lane * h.pitch + (h.pitch - h.band) / 2;
  return { x: L.x0 + col0 * L.cw + 5, y, w: (col1 - col0 + 1) * L.cw - 10, h: h.band };
}
