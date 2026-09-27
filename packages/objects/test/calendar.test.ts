// The desk calendar's pure half (CALENDAR.md): the month's arithmetic, the Moon, the events and their
// lanes, the sheet's layout.
import { describe, expect, it } from "vitest";
import { CALENDAR, sheetSize } from "../src/calendar/law";
import { cellDay, cellOf, civil, dayNumber, dayOfKey, daysIn, inMonth, isoWeek, isWeekendCol, keyOf, monthGrid, monthIndex, monthOf, phaseJde, phasesBetween, jdToMs, weekday } from "../src/calendar/month";
import { type CalEvent, compareLines, layoutMonth, parseTime } from "../src/calendar/events";
import { cellAt, cellBox, dayBox, lineCapacity, noteSlot, sheetOf } from "../src/calendar/sheet";

const law = CALENDAR;

describe("the month's arithmetic", () => {
  it("numbers days from 1970-01-01 and back, across leap years and centuries", () => {
    expect(dayNumber(1970, 1, 1)).toBe(0);
    expect(dayNumber(2000, 3, 1) - dayNumber(2000, 2, 28)).toBe(2);   // 2000 is a leap year
    expect(dayNumber(1900, 3, 1) - dayNumber(1900, 2, 28)).toBe(1);   // 1900 is not
    for (let n = -800000; n < 800000; n += 997) { const c = civil(n); expect(dayNumber(c.y, c.m, c.d)).toBe(n); }
    expect(keyOf(dayNumber(2026, 9, 24))).toBe("2026-09-24");
    expect(dayOfKey("2026-09-24")).toBe(dayNumber(2026, 9, 24));
  });
  it("knows the weekday (2026-09-24 is a Thursday, 1970-01-01 too)", () => {
    expect(weekday(0)).toBe(4);
    expect(weekday(dayNumber(2026, 9, 24))).toBe(4);
    expect(weekday(dayNumber(2026, 2, 1))).toBe(0);
  });
  it("lays a month in the weeks it spans — four, five or six rows", () => {
    const feb = monthGrid(monthIndex(2026, 2), 0);   // 1 Feb 2026 is a Sunday
    expect(feb.lead).toBe(0); expect(feb.rows).toBe(4); expect(feb.days).toBe(28);
    expect(monthGrid(monthIndex(2026, 2), 1).rows).toBe(5);
    const aug = monthGrid(monthIndex(2026, 8), 0);   // 1 Aug 2026 is a Saturday
    expect(aug.lead).toBe(6); expect(aug.rows).toBe(6);
    const sep = monthGrid(monthIndex(2026, 9), 1);   // a Tuesday
    expect(sep.lead).toBe(1); expect(sep.rows).toBe(5);
    expect(keyOf(cellDay(sep, 0, 0))).toBe("2026-08-31");
    expect(inMonth(sep, cellDay(sep, 0, 0))).toBe(false);
    expect(inMonth(sep, cellDay(sep, 0, 1))).toBe(true);
    expect(cellOf(sep, dayNumber(2026, 9, 24))).toEqual({ row: 3, col: 3 });
    expect(isWeekendCol(sep, 5)).toBe(true); expect(isWeekendCol(sep, 6)).toBe(true); expect(isWeekendCol(sep, 0)).toBe(false);
    expect(isWeekendCol(feb, 0)).toBe(true);
    expect(daysIn(2024, 2)).toBe(29); expect(daysIn(2026, 2)).toBe(28);
    expect(monthOf(monthIndex(2026, 12) + 1)).toEqual({ y: 2027, m: 1 });
    expect(monthOf(monthIndex(2026, 1) - 1)).toEqual({ y: 2025, m: 12 });
  });
  it("numbers ISO weeks", () => {
    expect(isoWeek(dayNumber(2026, 1, 1))).toBe(1);
    expect(isoWeek(dayNumber(2021, 1, 1))).toBe(53);
    expect(isoWeek(dayNumber(2026, 9, 24))).toBe(39);
    expect(isoWeek(dayNumber(2024, 12, 30))).toBe(1);
  });
});

describe("the Moon", () => {
  const minutes = (jde: number, iso: string) => Math.abs(jdToMs(jde) - Date.parse(iso)) / 60000;
  it("puts the principal phases where the almanac does (Meeus 49.a; the 2017 and 2024 eclipses)", () => {
    expect(minutes(phaseJde(-283), "1977-02-18T03:37:42Z")).toBeLessThan(3);
    expect(minutes(phaseJde(Math.round((2017.64 - 2000) * 12.3685)), "2017-08-21T18:30:00Z")).toBeLessThan(15);
    expect(minutes(phaseJde(Math.round((2024.75 - 2000) * 12.3685)), "2024-10-02T18:49:00Z")).toBeLessThan(15);
    expect(minutes(phaseJde(Math.round((2024.79 - 2000) * 12.3685 - 0.5) + 0.5), "2024-10-17T11:26:00Z")).toBeLessThan(15);
  });
  it("marks the days a month's phases fall on — four or five of them, a week apart", () => {
    const utcDay = (ms: number) => Math.floor(ms / 86400000);
    const p = phasesBetween(dayNumber(2024, 10, 1), dayNumber(2024, 10, 31), utcDay);
    expect(p.get(dayNumber(2024, 10, 2))).toBe(0);
    expect(p.get(dayNumber(2024, 10, 17))).toBe(2);
    expect(p.size).toBeGreaterThanOrEqual(4);
    const days = [...p.keys()].sort((a, b) => a - b);
    for (let i = 1; i < days.length; i++) expect((days[i] as number) - (days[i - 1] as number)).toBeGreaterThanOrEqual(6);
  });
});

describe("the events", () => {
  let id = 1;
  const ev = (start: number, end: number, text = "x"): CalEvent => ({ id: id++, start, end, text, seeds: [], seed: 1, ink: "felt", rev: 0 });
  it("reads a time at the head of a line — never a bare number", () => {
    expect(parseTime("9:30 dentist")?.minutes).toBe(570);
    expect(parseTime("3pm call")?.minutes).toBe(900);
    expect(parseTime("3 pm call")?.minutes).toBe(900);
    expect(parseTime("12am")?.minutes).toBe(0);
    expect(parseTime("12pm lunch")?.minutes).toBe(720);
    expect(parseTime("9.30pm x")?.minutes).toBe(1290);
    expect(parseTime("14:00 review")?.minutes).toBe(840);
    expect(parseTime("3 apples")).toBeNull();
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime("13pm")).toBeNull();
    expect(parseTime("9:30dentist")).toBeNull();
    expect(parseTime("dentist 9:30")).toBeNull();
  });
  it("sorts a day's lines: the untimed as written, then the timed by the clock", () => {
    const d = dayNumber(2026, 9, 24);
    const a = ev(d, d, "3pm b");
    const b = ev(d, d, "note");
    const c = ev(d, d, "9am a");
    const e = ev(d, d, "later");
    expect([a, b, c, e].sort(compareLines).map((x) => x.text)).toEqual(["note", "later", "9am a", "3pm b"]);
  });
  it("gives bands lanes that hold across the week, cut at the week's ends", () => {
    const g = monthGrid(monthIndex(2026, 9), 1);
    const d = (n: number) => dayNumber(2026, 9, n);
    const long = ev(d(8), d(16), "trip");
    const short = ev(d(10), d(11), "conf");
    const one = ev(d(10), d(10), "lunch");
    const L = layoutMonth([short, one, long], g.first, g.rows, () => 5);
    const segs = L.spans.filter((s) => s.event === long);
    expect(segs.map((s) => [s.row, s.col0, s.col1, s.head, s.tail])).toEqual([[1, 1, 6, true, false], [2, 0, 2, false, true]]);   // Tue 8 … Sun 13, Mon 14 … Wed 16
    expect(segs[0]?.lane).toBe(0);
    expect(L.spans.find((s) => s.event === short)?.lane).toBe(1);
    const cell10 = L.cells.find((c) => c.day === d(10));
    expect(cell10?.lanes).toBe(2);
    expect(cell10?.shown.map((e) => e.text)).toEqual(["lunch"]);
    expect(L.cells.find((c) => c.day === d(12))?.lanes).toBe(1);
  });
  it("counts what does not fit, giving its last line to the count", () => {
    const g = monthGrid(monthIndex(2026, 9), 1);
    const d = dayNumber(2026, 9, 3);
    const list = [1, 2, 3, 4, 5].map((i) => ev(d, d, `e${i}`));
    const L = layoutMonth(list, g.first, g.rows, () => 3);
    const c = L.cells.find((x) => x.day === d);
    expect(c?.shown.length).toBe(2); expect(c?.hidden).toBe(3);
    const all = layoutMonth(list, g.first, g.rows, () => 5).cells.find((x) => x.day === d);
    expect(all?.shown.length).toBe(5); expect(all?.hidden).toBe(0);
  });
});

describe("the sheet", () => {
  it("is a blotter's size, the grid centred in its margins", () => {
    const { W, H } = sheetSize(law);
    expect(W).toBe(1760); expect(H).toBe(1852);
  });
  it("shares the grid's height among the month's rows", () => {
    for (const [y, m, rows] of [[2026, 2, 4], [2026, 9, 5], [2026, 8, 6]] as const) {
      const L = sheetOf(monthGrid(monthIndex(y, m), 0), law);
      expect(L.rows).toBe(rows);
      expect(L.ch * L.rows).toBeCloseTo(law.grid.height, 9);
    }
  });
  it("finds the day under a point, and a day's cell", () => {
    const L = sheetOf(monthGrid(monthIndex(2026, 9), 1), law);
    const b = dayBox(L, dayNumber(2026, 9, 24));
    expect(b).not.toBeNull();
    const hit = cellAt(L, (b?.x ?? 0) + 10, (b?.y ?? 0) + 10);
    expect(hit && keyOf(hit.day)).toBe("2026-09-24");
    expect(cellAt(L, 5, 5)).toBeNull();
  });
  it("stands a sticky note in a day under its date, even in a six-week month", () => {
    const L = sheetOf(monthGrid(monthIndex(2026, 8), 0), law);   // six rows: the tightest cell
    const c = cellBox(L, 2, 3);
    const s = noteSlot(L, 2, 3, law);
    const half = (law.note.size / 2) * (Math.cos(0.044) + Math.sin(0.044));   // a note turned 2.5°
    expect(s.y - half).toBeGreaterThanOrEqual(c.y + law.print.numeral.baseline + 4);
    expect(s.y + half).toBeLessThanOrEqual(c.y + c.h);
    expect(s.x - half).toBeGreaterThanOrEqual(c.x);
    expect(s.x + half).toBeLessThanOrEqual(c.x + c.w);
    expect(lineCapacity(L, law, false)).toBeGreaterThanOrEqual(6);
    const L5 = sheetOf(monthGrid(monthIndex(2026, 9), 1), law);
    expect(lineCapacity(L5, law, true)).toBe(1);
  });
});

import { coreOf, rollAt, rollPoint, rollState, tangentAt } from "../src/calendar/roll";

describe("the roll", () => {
  const W = 1760;
  const L = 1796;
  const rr = law.roll;
  it("lies flat before it starts, and reaches the rest radius as a whole sheet is wound", () => {
    const R0 = rollState(0, rr, L, W, 0);
    for (const [x, s] of [[0, 0], [880, 900], [W, L]] as const) expect(rollPoint(R0, x, s).z).toBe(0);
    const R1 = rollState(1, rr, L, W, 0);
    expect(rollAt(R1, 400).radius).toBeCloseTo(rr.rest, 6);
    expect(coreOf(rr.rest, rr.tau, L)).toBeGreaterThan(rr.rest * 0.7);
  });
  it("winds without stretching: the spiral's length is the sheet's", () => {
    const R = rollState(0.55, rr, L, W, 0);
    let len = 0;
    let prev = rollPoint(R, 500, R.a);
    const n = 6000;
    for (let i = 1; i <= n; i++) {
      const q = rollPoint(R, 500, R.a + ((L - R.a) * i) / n);
      len += Math.hypot(q.x - prev.x, q.s - prev.s, q.z - prev.z);
      prev = q;
    }
    expect(len / (L - R.a)).toBeCloseTo(1, 2);
  });
  it("is continuous where it leaves the pad, its normal turning from up to the axis", () => {
    const R = rollState(0.3, rr, L, W, 0);
    const a = rollPoint(R, 300, R.a - 1e-3);
    const b = rollPoint(R, 300, R.a + 1e-3);
    expect(Math.hypot(a.x - b.x, a.s - b.s, a.z - b.z)).toBeLessThan(1e-2);
    const top = rollPoint(R, 300, R.a + Math.PI * rollAt(R, 300).radius);
    expect(top.z).toBeCloseTo(2 * rollAt(R, 300).radius, 0);
    expect(top.nz).toBeCloseTo(-1, 1);   // the printed side faces down at the roll's crown: the back is what shows
    for (const s of [R.a + 5, R.a + 60, R.a + 300]) { const q = rollPoint(R, 300, s); expect(Math.hypot(q.nx, q.ns, q.nz)).toBeCloseTo(1, 9); }
  });
  it("lifts the grabbed corner first, the line straightening as it goes", () => {
    const R = rollState(0.02, rr, L, W, -rr.tilt);
    expect(rollPoint(R, W - 1, L - 1).z).toBeGreaterThan(0);
    expect(rollPoint(R, 1, L - 1).z).toBe(0);
    expect(tangentAt(R, 0)).toBeGreaterThan(tangentAt(R, W));
    const later = rollState(0.5, rr, L, W, -rr.tilt);
    expect(Math.abs(later.alpha)).toBe(0);
  });
});

import { bandOf, entryOf, LEVELS, levelFor, TILE, TileCache, tileGrid, tileRect, tilesIn } from "../src/calendar/tiles";
import { buildPad, CMAT, movingGrid, padFrame } from "../src/calendar/pad";
import { MeshWriter, VERTEX_FLOATS } from "@ice/desk/kit";

describe("the print's tiles", () => {
  it("climbs √2 rungs from a quarter texel a unit, the rung at or above the screen's density", () => {
    expect(bandOf(0)).toBe(0.25);
    expect(bandOf(4)).toBeCloseTo(1, 12);
    expect(bandOf(10)).toBeCloseTo(8, 12);
    expect(levelFor(1)).toBe(4);
    expect(levelFor(1.01)).toBe(5);
    expect(levelFor(2)).toBe(6);
    expect(levelFor(0.1)).toBe(0);
    expect(levelFor(100)).toBe(LEVELS - 1);
    for (let d = 0.3; d < 8; d *= 1.17) expect(bandOf(levelFor(d))).toBeGreaterThanOrEqual(d - 1e-9);
  });
  it("counts a sheet's tiles by level, and lays their entries one level after another", () => {
    const g = tileGrid(1760, 1852);
    expect(g.nx[4]).toBe(Math.ceil(1760 / TILE)); expect(g.ny[4]).toBe(Math.ceil(1852 / TILE));
    for (let l = 1; l < LEVELS; l++) expect(g.offset[l]).toBe((g.offset[l - 1] as number) + (g.nx[l - 1] as number) * (g.ny[l - 1] as number));
    expect(entryOf(g, 3, 0, 0)).toBe(g.offset[3]);
    const r = tileRect(6, 2, 3);
    expect(r).toEqual({ x: 256, y: 384, w: 128, h: 128 });
    expect(tilesIn(g, 4, -500, -500, 10, 10)).toEqual([[0, 0]]);
    expect(tilesIn(g, 4, 0, 0, 5000, 5000).length).toBe((g.nx[4] as number) * (g.ny[4] as number));
  });
  it("keeps the tiles a frame touches, gives up the one used longest ago, and says which it gave up", () => {
    const c = new TileCache(2);
    c.tick();
    expect(c.put("a", "1")?.layer).toBe(0);
    expect(c.put("b", "1")?.layer).toBe(1);
    expect(c.put("c", "1")).toBeNull();                 // both touched this frame
    c.tick(); c.get("b", "1");
    const p = c.put("c", "1");
    expect(p?.layer).toBe(0); expect(p?.evicted).toBe("a");
    expect(c.get("a", "1")).toBeNull();
    expect(c.get("b", "2")).toBeNull();                 // stale: its content moved
    expect(c.stale("b")).toBe(1);
    c.drop("c"); expect(c.size).toBe(1);
  });
});

describe("the pad", () => {
  const F = padFrame(law);
  it("stacks its board, its block, the month and the tape, and the roll lies on the pad", () => {
    expect(F.zb).toBeGreaterThan(0);
    expect(F.zt).toBeGreaterThan(F.zb); expect(F.zm).toBeGreaterThan(F.zt); expect(F.zTape).toBeGreaterThan(F.zm);
    expect(F.L).toBe(F.H - F.T);
    const m = buildPad(new MeshWriter(), F, law);
    expect(m.sheetFirst).toBeGreaterThan(0); expect(m.rollFirst).toBeGreaterThan(m.sheetFirst); expect(m.icount).toBeGreaterThan(m.rollFirst);
    expect(m.min[0]).toBeGreaterThanOrEqual(-F.W / 2 - 1e-6); expect(m.max[0]).toBeLessThanOrEqual(F.W / 2 + 1e-6);
    expect(m.max[2]).toBeCloseTo(F.zm + 2 * F.rest, 0);
    // every face of the pad's paper is a sheet material, every other face a solid one
    const mats = (from: number, to: number) => { const s = new Set<number>(); for (let i = from; i < to; i++) s.add(m.vertices[(m.indices[i] as number) * VERTEX_FLOATS + 8] as number); return s; };
    expect([...mats(0, m.sheetFirst)].every((x) => x === CMAT.board || x === CMAT.edge || x === CMAT.tape)).toBe(true);
    expect([...mats(m.sheetFirst, m.rollFirst)]).toEqual([CMAT.base]);
    expect([...mats(m.rollFirst, m.icount)]).toEqual([CMAT.past]);
  });
  it("lays the moving sheet's grid over the unit square", () => {
    const g = movingGrid(4, 3);
    expect(g.vertices.length).toBe(5 * 4 * 2);
    expect(g.indices.length).toBe(4 * 3 * 6);
    expect(Math.max(...g.vertices)).toBe(1); expect(Math.min(...g.vertices)).toBe(0);
  });
});
