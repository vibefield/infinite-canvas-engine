// THE PRINT FROM THE EVENTS (CALENDAR.md §2–§3, §6; D3t-c): the prototype's display list (calendar/print.ts, moved whole) laid
// from a pad's events — a line on its day, a timed line's time set apart, a band across a run, today's ring, the pencil's ticks,
// the room a stuck note takes — each cell KEYED by what it shows, so an edit moves one cell's key and no other; an event entity
// as the print takes it (its seed holds while it is written, its rev follows its cell); and the TILES as a cache of the print
// (calendar/printing.ts): the coarse levels for the whole sheet and the view's for what is in view, a tile nothing prints in
// marked empty and never drawn, an edit redrawing only the tiles over its cell, the frame's budget, a committed sheet pinned
// (the oracle's and a rig's) naming its one level. And the product's print inks through the kind's theme = the fixture's.
import type { Entity } from "@ice/core";
import { describe, expect, it } from "vitest";
import { calEventOf } from "../src/calendar/data";
import type { CalEvent } from "../src/calendar/events";
import { CALENDAR } from "../src/calendar/law";
import { dayOfKey, monthGrid, monthIndex, phasesBetween } from "../src/calendar/month";
import { printSheet, type PrintInputs, type SheetPrint } from "../src/calendar/print";
import { contentOf, type PinnedSheet, type PrintPass, type PrintRaster, PrintTiles, type TileSource } from "../src/calendar/printing";
import { cellAt, sheetOf } from "../src/calendar/sheet";
import { EMPTY, entryOf, levelFor, MISSING, TILE_TEX, tileGrid } from "../src/calendar/tiles";
import { calendarKind } from "../src/kinds";
import { encodeSeeds } from "../src/paper/seeds";
import type { HandMetrics } from "../src/paper/text";
import { HAND } from "../src/theme";
import { CALENDAR_LOOK, calendarPrint, PALETTE, PENS } from "../oracle/fixtures/vf-theme";
import { must } from "./must";

const METRICS: HandMetrics = { ascent: 0.8, descent: 0.25, advance: (ch) => (ch === " " ? 0.3 : 0.5) };
const MEASURE = (font: string, s: string): number => { const px = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10); return s.length * px * 0.55; };
const SEP = monthIndex(2026, 9);
const day = (k: string): number => dayOfKey(k);
let serial = 1;
const ev = (start: string, text: string, over: Partial<CalEvent> = {}): CalEvent => ({ id: serial++, start: day(start), end: day(start), text, seeds: [], seed: 5, ink: "felt", rev: 0, ...over });

function inputs(events: readonly CalEvent[], over: Partial<PrintInputs> = {}): PrintInputs {
  return {
    law: CALENDAR, look: calendarPrint(), sheet: sheetOf(monthGrid(SEP, 1), CALENDAR), events, noted: new Set(), today: day("2026-09-24"),
    moons: phasesBetween(day("2026-08-31"), day("2026-10-11"), (ms) => Math.floor(ms / 86400000)), face: { family: "Caveat", weight: 500 },
    metrics: METRICS, hand: HAND, measure: MEASURE, ticks: true, style: "test", ...over,
  };
}
/** The cell key of a day on the sheet. */
const keyOfDay = (p: SheetPrint, k: string): string => { const i = day(k) - p.sheet.grid.first; return p.keys[i] as string; };

describe("the print from the events (calendar/print.ts — the prototype's display list)", () => {
  it("a line on its day: in its cell under the date, its hand laid; a timed line's time set apart; a band across a run, a segment a week", () => {
    const line = ev("2026-09-02", "haircut");
    const timed = ev("2026-09-02", "11am dentist");
    const band = { ...ev("2026-09-11", "holiday"), end: day("2026-09-15"), ink: "yellow" };
    const p = printSheet(inputs([line, timed, band]));
    const L = p.sheet;
    const l1 = must(p.lines.find((l) => l.event === line));
    const cell = must(cellAt(L, l1.box.x + 1, l1.box.y + 1));
    expect(cell.day).toBe(day("2026-09-02"));
    expect(l1.band).toBe(false);
    expect(l1.box.y).toBeGreaterThan(L.y0 + cell.row * L.ch + CALENDAR.hand.top - 1);
    expect(l1.layout.glyphs.map((g) => g.ch).join("")).toBe("haircut");
    // the untimed line first, then the timed one — whose layout is what follows its time
    const l2 = must(p.lines.find((l) => l.event === timed));
    expect(l2.box.y).toBeGreaterThan(l1.box.y);
    expect(l2.layout.glyphs.map((g) => g.ch).join("")).toBe("dentist");
    expect(l2.ox).toBeGreaterThan(l2.box.x);   // after the time, written a size smaller
    // the band: Fri 11 … Tue 15 crosses a Monday — two segments, each in its week's row
    const segs = p.lines.filter((l) => l.event === band);
    expect(segs.length).toBe(2);
    expect(segs.every((s) => s.band)).toBe(true);
    expect(segs.map((s) => s.day)).toEqual([day("2026-09-11"), day("2026-09-14")]);
  });

  it("each cell is KEYED by what it shows: an edit moves its own cell's key and no other; the sheet's own key is the last", () => {
    const a = ev("2026-09-02", "haircut");
    const b = ev("2026-09-17", "call mum");
    const p0 = printSheet(inputs([a, b]));
    const p1 = printSheet(inputs([{ ...a, text: "haircut 2", rev: 1 }, b]));
    expect(p0.keys.length).toBe(p0.sheet.rows * 7 + 1);
    const moved = p0.keys.map((k, i) => (k !== p1.keys[i] ? i : -1)).filter((i) => i >= 0);
    expect(moved).toEqual([day("2026-09-02") - p0.sheet.grid.first]);
    expect(keyOfDay(p0, "2026-09-02")).toContain(`e${a.id}.0`);
    expect(keyOfDay(p1, "2026-09-17")).toBe(keyOfDay(p0, "2026-09-17"));
  });

  it("today is ringed in hot, a past day ticked off in pencil (not with the ticks off), a neighbour's day printed faint", () => {
    const p = printSheet(inputs([]));
    expect(keyOfDay(p, "2026-09-24")).toContain("today");
    expect(keyOfDay(p, "2026-09-10")).toContain("past");
    expect(keyOfDay(p, "2026-09-25")).not.toContain("past");
    expect(keyOfDay(printSheet(inputs([], { ticks: false })), "2026-09-10")).not.toContain("past");
    expect(keyOfDay(p, "2026-08-31")).toMatch(/:0(,|$)/);   // Monday 31 August heads the grid, not the month's own
  });

  it("a note stuck to a day takes its cell's foot: fewer lines fit, the last one given to the count ('+N more')", () => {
    const k = "2026-09-08";   // a five-week month: 302 tall — four lines free, one under a note
    const many = ["one", "two", "three", "four", "five"].map((t) => ev(k, t));
    const free = printSheet(inputs(many));
    const noted = printSheet(inputs(many, { noted: new Set([day(k)]) }));
    const shown = (p: SheetPrint) => p.lines.filter((l) => l.day === day(k)).length;
    expect(shown(free)).toBeGreaterThan(shown(noted));
    expect(noted.hidden.get(day(k))).toBe(many.length - shown(noted));
    expect(keyOfDay(noted, k)).toContain("note");
  });
});

describe("an event entity as the print takes it (calendar/data.ts `calEventOf`)", () => {
  it("its days as day numbers (a run inclusive, either way round), its seeds decoded; a cell whose days are not days is no entry", () => {
    const e = must(calEventOf(41 as Entity, { start: "2026-09-15", end: "2026-09-11", text: "trip", seeds: encodeSeeds([1, 2, 3, 4]), ink: "green" }));
    expect([e.id, e.start, e.end, e.text, e.ink]).toEqual([41, day("2026-09-11"), day("2026-09-15"), "trip", "green"]);
    expect(e.seeds).toEqual([1, 2, 3, 4]);
    expect(must(calEventOf(42 as Entity, { start: "2026-09-02", end: "", text: "x", seeds: "", ink: null })).end).toBe(day("2026-09-02"));
    expect(calEventOf(43 as Entity, { start: "2026-09-31", end: null, text: "", seeds: null, ink: null })).toBeNull();
    expect(calEventOf(44 as Entity, { start: "someday", end: null, text: "", seeds: null, ink: null })).toBeNull();
  });

  it("its own seed holds while it is written (made from its days and its ink); its rev follows the whole cell", () => {
    const row = { start: "2026-09-02", end: "2026-09-02", text: "hair", seeds: "", ink: "felt" };
    const a = must(calEventOf(1 as Entity, row));
    const b = must(calEventOf(1 as Entity, { ...row, text: "haircut" }));
    expect(b.seed).toBe(a.seed);
    expect(b.rev).not.toBe(a.rev);
    expect(must(calEventOf(9 as Entity, row)).seed).toBe(a.seed);   // the same entry on another peer: the same hand
  });
});

/** A pass that records what the driver hands it. */
function fakePass(layers = 160) {
  const uploads: number[] = [];
  const written: number[] = [];
  const tables = new Map<number, Int32Array>();
  const pass: PrintPass = {
    layers,
    uploadTile: (layer) => { uploads.push(layer); },
    writeTileBytes: (layer, bytes) => { expect(bytes.byteLength).toBe(TILE_TEX * TILE_TEX * 4); written.push(layer); },
    writeTable: (slot, _grid, table) => { tables.set(slot, table.slice()); },
  };
  return { pass, uploads, written, tables };
}
/** A raster that counts its tiles and spends `cost` ms of a fake clock on each. */
function fakeRaster(clock: { t: number }, cost = 0.2): PrintRaster & { drawn: number } {
  const r = {
    drawn: 0,
    hand: () => ({ face: { family: "Caveat", weight: 500 }, metrics: METRICS }),
    version: () => 1,
    measure: MEASURE,
    tile(): TileSource { r.drawn += 1; clock.t += cost; return {} as TileSource; },
    bytes: () => new Uint8Array(TILE_TEX * TILE_TEX * 4),
  };
  return r;
}

describe("the print's tiles, a cache of the print (calendar/printing.ts)", () => {
  const grid = tileGrid(1760, 1852);
  const whole = { x0: 0, y0: 0, x1: 1760, y1: 1852 };

  it("the coarse levels for the whole sheet and the view's for what is in view — a tile nothing prints in is EMPTY and never drawn; again: nothing drawn", () => {
    const clock = { t: 0 };
    const { pass, uploads, tables } = fakePass();
    const raster = fakeRaster(clock);
    const tiles = new PrintTiles({ grid, now: () => clock.t, budgetMs: 1e9 });
    const p = printSheet(inputs([ev("2026-09-02", "haircut")]));
    tiles.begin(pass);
    tiles.sheet(pass, raster, "1:24320", 0, p, whole, 4);
    tiles.end(pass);
    const t0 = must(tables.get(0));
    const want = [0, 1, 2, 3, 4].reduce((n, l) => n + (grid.nx[l] as number) * (grid.ny[l] as number), 0);
    const named = [...t0].filter((v) => v !== MISSING).length;
    expect(named).toBe(want);                          // every tile of levels 0–4 is named: a layer or EMPTY
    expect(uploads.length).toBe(raster.drawn);
    expect(uploads.length).toBe([...t0].filter((v) => v >= 0).length);
    expect([...t0].filter((v) => v === EMPTY).length).toBeGreaterThan(0);   // the paper between the words costs nothing
    // the next frame, the same print: every tile resident — nothing drawn, the table untouched
    tables.clear();
    tiles.begin(pass);
    tiles.sheet(pass, raster, "1:24320", 0, p, whole, 4);
    tiles.end(pass);
    expect(raster.drawn).toBe(uploads.length);
    expect(tables.size).toBe(0);
  });

  it("an entry edited redraws only the tiles over its cell (their content moved); the rest stay", () => {
    const clock = { t: 0 };
    const { pass } = fakePass();
    const raster = fakeRaster(clock);
    const tiles = new PrintTiles({ grid, now: () => clock.t, budgetMs: 1e9 });
    const a = ev("2026-09-02", "haircut");
    const p0 = printSheet(inputs([a]));
    tiles.begin(pass);
    tiles.sheet(pass, raster, "1:24320", 0, p0, whole, 4);
    const n0 = raster.drawn;
    const p1 = printSheet(inputs([{ ...a, text: "haircut at 3", rev: 7 }]));
    tiles.begin(pass);
    tiles.sheet(pass, raster, "1:24320", 0, p1, whole, 4);
    const redrawn = raster.drawn - n0;
    // the tiles over 2 September's cell at levels 0–4: at most a handful each, far fewer than the sheet
    expect(redrawn).toBeGreaterThan(0);
    expect(redrawn).toBeLessThan(12);
    const L = p0.sheet;
    const b = { x: L.x0 + 2 * L.cw, y: L.y0, w: L.cw, h: L.ch };
    expect(contentOf(p0, b.x, b.y, b.w, b.h)).not.toBe(contentOf(p1, b.x, b.y, b.w, b.h));
    expect(contentOf(p0, L.x0 + 5 * L.cw, L.y0 + 3 * L.ch, 10, 10)).toBe(contentOf(p1, L.x0 + 5 * L.cw, L.y0 + 3 * L.ch, 10, 10));
  });

  it("the frame's budget: past it, the rest wait (pending — the desk asks for another frame) and draw on the frames after", () => {
    const clock = { t: 0 };
    const { pass } = fakePass();
    const raster = fakeRaster(clock, 1);
    const tiles = new PrintTiles({ grid, now: () => clock.t, budgetMs: 6 });
    const p = printSheet(inputs([ev("2026-09-02", "haircut")]));
    tiles.begin(pass);
    tiles.sheet(pass, raster, "1:24320", 0, p, whole, 4);
    expect(raster.drawn).toBeLessThanOrEqual(7);
    expect(tiles.pending()).toBeGreaterThan(0);
    let frames = 1;
    while (tiles.pending() > 0 && frames < 100) { tiles.begin(pass); tiles.sheet(pass, raster, "1:24320", 0, p, whole, 4); frames += 1; }
    expect(tiles.pending()).toBe(0);
    expect(frames).toBeGreaterThan(5);
  });

  it("a COMMITTED sheet (the oracle's, a rig's pin): its table names its one level — a layer per tile, EMPTY where nothing prints — the rest MISSING", () => {
    const { pass, written, tables } = fakePass();
    const tiles = new PrintTiles({ grid });
    const bytes = new Uint8Array(TILE_TEX * TILE_TEX * 4);
    const pinned: PinnedSheet = { level: 2, tiles: new Map([["0:0", bytes], ["1:2", bytes]]), empty: new Set(["3:3"]) };
    tiles.begin(pass);
    tiles.pin(pass, "1:24320", 1, pinned);
    tiles.end(pass);
    const t = must(tables.get(1));
    expect(written.length).toBe(2);
    expect(t[entryOf(grid, 2, 0, 0)]).toBe(written[0]);
    expect(t[entryOf(grid, 2, 1, 2)]).toBe(written[1]);
    expect(t[entryOf(grid, 2, 3, 3)]).toBe(EMPTY);
    expect([...t].filter((v) => v !== MISSING).length).toBe(3);
    // pinned again next frame: nothing written twice
    tiles.begin(pass);
    tiles.pin(pass, "1:24320", 1, pinned);
    expect(written.length).toBe(2);
  });

  it("the rung a screen wants: the density's, at or above it", () => {
    expect(levelFor(0.42 * 2)).toBe(4);
    expect(levelFor(1 * 2)).toBe(6);
    expect(levelFor(0.25)).toBe(0);
  });
});

describe("the product's print inks through the kind's theme = the fixture's `calendarPrint` (parity by construction)", () => {
  it("the pens a line is written in, the pencil at 55 %, the highlighters, the presences", () => {
    const kind = calendarKind();
    const palette = { ...PALETTE.light, calendars: CALENDAR_LOOK, pens: PENS };
    const look = must(kind.theme)(palette, "light");
    expect(look.print).toEqual(calendarPrint());
  });
});
