// THE MONTH'S TURN at work (CALENDAR.md §4; D3t-c — calendar/turn.ts): the pad shows the month it has laid bare and rolls toward
// the DOCUMENT's month — one turn for a month on or back, several one after another (quicker the further) — while a HAND's turn
// decides at its release (a click takes the whole month, a flick goes where it was flicked, else past a third it goes and short of
// it falls back) and ends where the document does not know yet: `pending`, `rolled` for the hand to commit, held until the document
// says so, rolled back if it refuses. The corner lifts under a pointer near the foot and a turn from a lifted corner starts there.
// And through the kind: a pad mid-turn resolves its two sheets, the marks on the one showing, a press on the sheet in motion.
import type { Entity } from "@ice/core";
import { describe, expect, it } from "vitest";
import { CALENDAR } from "../src/calendar/law";
import { monthIndex } from "../src/calendar/month";
import { padFrame } from "../src/calendar/pad";
import { dragTo, grabMoving, letGo, newRoll, type PadRoll, rollSheets, startTurn, stepRoll } from "../src/calendar/turn";
import { calendarKind, type CalendarGeometry, createPads, partAt } from "../src/calendar/kind";
import { FLUX_REST, type ObjectContext, rectOf, DEFAULT_GRID, MAT_GRID } from "@ice/desk";
import { lampOf } from "../src/paper/paper";
import { CALENDAR_LOOK, PALETTE, PENS, THEMES } from "../oracle/fixtures/vf-theme";
import { must } from "../../desk/test/must";

const law = CALENDAR;
const F = padFrame(law);
const SEP = monthIndex(2026, 9);
/** Step a roll at 60 Hz until it stands (or `n` frames): how many frames it ran. */
function run(r: PadRoll, durable: number, n = 600): number {
  let i = 0;
  while (i < n && stepRoll(r, durable, 1 / 60, law, F)) i += 1;
  return i;
}
/** The sheet point under the tape (`s`) at progress p of a hand's turn: p = (L − s)/(L − rest). */
const sAt = (p: number): number => F.L - p * (F.L - law.roll.rest);

describe("the pad rolls toward the document's month (calendar/turn.ts)", () => {
  it("first seen, it shows the document's month; the month one on: ONE turn up — the next laid bare beneath, the marks on the sheet rolling away", () => {
    const r = newRoll();
    expect(rollSheets(r, SEP, law, F)).toMatchObject({ shown: SEP, base: SEP, moving: null, turning: false });
    stepRoll(r, SEP + 1, 1 / 60, law, F);
    expect(r.turn).toMatchObject({ dir: 1, target: 1, hand: false });
    expect(rollSheets(r, SEP + 1, law, F)).toMatchObject({ shown: SEP, base: SEP + 1, moving: SEP, marksOn: 1, turning: true });
    const frames = run(r, SEP + 1);
    expect(frames).toBeGreaterThan(20);
    expect([r.shown, r.turn, r.pending, r.rolled]).toEqual([SEP + 1, null, null, false]);
    expect(rollSheets(r, SEP + 1, law, F)).toMatchObject({ shown: SEP + 1, base: SEP + 1, moving: null });
  });

  it("the month back: the last month comes DOWN off the roll over the one showing (the marks on the sheet beneath)", () => {
    const r = newRoll();
    rollSheets(r, SEP, law, F);
    stepRoll(r, SEP - 1, 1 / 60, law, F);
    expect(r.turn).toMatchObject({ dir: -1, target: 0 });
    expect(rollSheets(r, SEP - 1, law, F)).toMatchObject({ shown: SEP, base: SEP, moving: SEP - 1, marksOn: 0 });
    run(r, SEP - 1);
    expect(r.shown).toBe(SEP - 1);
  });

  it("several months away: one turn after another, quicker the further — all in fewer frames than one each at the rest's pace", () => {
    const one = newRoll();
    rollSheets(one, SEP, law, F);
    const single = run(one, SEP + 1);
    const r = newRoll();
    rollSheets(r, SEP, law, F);
    stepRoll(r, SEP + 3, 1 / 60, law, F);
    expect(must(r.turn).fast).toBe(2);   // 1 + min(3 − 1, 6) · 0.5
    const frames = run(r, SEP + 3);
    expect(r.shown).toBe(SEP + 3);
    expect(frames).toBeLessThan(3 * single);
  });
});

describe("a month turned BY HAND decides at its release", () => {
  /** A hand on a turn: from where it starts to progress `p` over `steps` frames, then `still` frames standing there (the driver drags every frame). */
  const handTurn = (dir: 1 | -1, p: number, steps: number, still: number): { r: PadRoll; now: number } => {
    const r = newRoll();
    rollSheets(r, SEP, law, F);
    const p0 = dir === 1 ? 0 : 1;
    startTurn(r, dir, 0, law, F, { hand: true, drag: { s: sAt(p0), now: 0 } });
    let now = 0;
    for (let i = 1; i <= steps; i++) { now += 16; dragTo(r, sAt(p0 + ((p - p0) * i) / steps), now, true, law, F); }
    for (let i = 0; i < still; i++) { now += 16; dragTo(r, sAt(p), now, true, law, F); }
    return { r, now: now + 16 };
  };

  it("short of a third it falls back — the month stays, nothing to commit", () => {
    const { r, now } = handTurn(1, 0.2, 20, 20);
    letGo(r, now, law, F);
    expect(must(r.turn).target).toBe(0);
    run(r, SEP);
    expect([r.shown, r.pending, r.rolled]).toEqual([SEP, null, false]);
  });

  it("past a third it goes: the next month laid bare, PENDING for the hand to commit (the pad holds it), the document's word clears it", () => {
    const { r, now } = handTurn(1, 0.4, 20, 20);
    letGo(r, now, law, F);
    expect(must(r.turn).target).toBe(1);
    run(r, SEP);
    expect([r.shown, r.pending, r.rolled]).toEqual([SEP + 1, SEP + 1, true]);
    // the document has not moved yet: the pad holds the month (no turn back)
    stepRoll(r, SEP, 1 / 60, law, F);
    expect([r.shown, r.turn]).toEqual([SEP + 1, null]);
    stepRoll(r, SEP + 1, 1 / 60, law, F);
    expect(r.pending).toBeNull();
  });

  it("a hand's roll committed, then the document's month moves ELSEWHERE (a peer's roll won the race): the pad follows the document, never a month it does not hold (D7 #3)", () => {
    const { r, now } = handTurn(1, 0.4, 20, 20);
    letGo(r, now, law, F);
    run(r, SEP);
    expect([r.shown, r.pending]).toEqual([SEP + 1, SEP + 1]);
    // the document's month arrives as a peer's — two months back — and never as the hand's: the document spoke, the hold is over
    run(r, SEP - 1);
    expect([r.shown, r.pending, r.turn]).toEqual([SEP - 1, null, null]);
    // and nothing shadows the document's later months
    run(r, SEP + 3);
    expect(r.shown).toBe(SEP + 3);
  });

  it("a hand that stopped before letting go threw nothing: a fast pull then a pause falls back like a slow one", () => {
    const { r, now } = handTurn(1, 0.2, 2, 20);
    letGo(r, now, law, F);
    expect(must(r.turn).target).toBe(0);
  });

  it("a click (no move) takes the whole month; a flick goes where it was flicked, however short", () => {
    const r = newRoll();
    rollSheets(r, SEP, law, F);
    startTurn(r, 1, 0, law, F, { hand: true, drag: { s: sAt(0), now: 0 } });
    letGo(r, 40, law, F);
    expect(must(r.turn).target).toBe(1);
    const f = handTurn(1, 0.1, 1, 0);
    letGo(f.r, f.now - 16, law, F);   // released as it moves: 0.1 of the sheet in 16 ms — flicked up
    expect(must(f.r.turn).target).toBe(1);
  });

  it("the roll down by hand: the last month off the roll, a click brings it whole", () => {
    const r = newRoll();
    rollSheets(r, SEP, law, F);
    startTurn(r, -1, 0, law, F, { hand: true, drag: { s: sAt(1), now: 0 } });
    expect(must(r.turn).p).toBe(1);
    letGo(r, 30, law, F);
    run(r, SEP);
    expect([r.shown, r.pending]).toEqual([SEP - 1, SEP - 1]);
  });

  it("the sheet in motion taken mid-turn, and a refused commit: the pad rolls back to the document's month", () => {
    const r = newRoll();
    rollSheets(r, SEP, law, F);
    stepRoll(r, SEP + 1, 1 / 60, law, F);
    expect(grabMoving(r, sAt(0.5), 0)).toBe(true);
    dragTo(r, sAt(0.9), 16, true, law, F);
    expect(must(r.turn).p).toBeCloseTo(0.9, 6);
    const { r: h, now } = handTurn(1, 0.6, 20, 20);
    letGo(h, now, law, F);
    run(h, SEP);
    expect(h.pending).toBe(SEP + 1);
    h.pending = null;   // `Pads.unroll`: the document refused it
    run(h, SEP);
    expect([h.shown, h.pending]).toEqual([SEP, null]);
  });

  it("the corner LIFTS under a pointer near it; a turn from a lifted corner starts where it stood, tilted", () => {
    const r = newRoll();
    rollSheets(r, SEP, law, F);
    r.peekOn = true;
    run(r, SEP, 120);
    expect(r.peek).toBe(1);
    expect(rollSheets(r, SEP, law, F)).toMatchObject({ base: SEP + 1, moving: SEP, turning: false });
    startTurn(r, 1, 0, law, F, { hand: true, drag: { s: sAt(0), now: 0 } });
    expect(must(r.turn).p).toBeCloseTo(law.roll.peek / (F.L - law.roll.rest), 9);
    expect(must(r.turn).tilt).toBe(-law.roll.tilt);
    expect([r.peek, r.peekOn]).toEqual([0, false]);
  });
});

describe("through the kind: a pad mid-turn", () => {
  it("resolves the two sheets from its local, the marks on the one showing; a press on the sheet in motion is `moving`", () => {
    const kind = calendarKind();
    const palette = { ...PALETTE.light, calendars: CALENDAR_LOOK, pens: PENS };
    const look = must(kind.theme)(palette, "light");
    const pads = createPads({ pass: () => undefined });
    const ctx: ObjectContext = {
      entity: 9 as Entity, rect: rectOf({ x: -F.W / 2, y: -F.H / 2 }, { w: F.W, h: F.H }), props: { month: "2026-10", weekStart: 1, tape: "ink", pen: "felt" },
      flux: FLUX_REST, look, theme: THEMES.light, lamp: lampOf(MAT_GRID.plane), view: { camX: -1200, camY: -1000, zoom: 0.42, width: 1200, height: 800, dpr: 2 }, grid: DEFAULT_GRID, dt: 1 / 60, local: pads,
    };
    pads.sheets(9 as Entity, SEP);   // first seen showing September; the document now says October
    kind.resolve(ctx);
    pads.tick?.(0);
    pads.tick?.(100);
    pads.tick?.(200);
    const G = kind.resolve(ctx) as CalendarGeometry;
    expect([G.shown, G.base, G.moving, G.marksOn, G.turning]).toEqual([SEP, SEP + 1, SEP, 1, true]);
    const R = kind.record(G, ctx);
    expect(R.moving?.slot).toBe(1);
    // the sheet in motion under the eye: its tangent line on the sheet, unprojected back through the eye to a desk point
    const roll = must(G.roll);
    const sx = 800;
    const sy = F.T + roll.a + (sx - roll.px) * Math.tan(roll.alpha);
    const x = G.cx - F.W / 2 + sx;
    const y = G.cy - F.H / 2 + sy;
    const f = G.eye.h / (G.eye.h - F.zt - G.lift);
    expect(partAt(G, G.eye.ex + (x - G.eye.ex) * f, G.eye.ey + (y - G.eye.ey) * f)?.part).toBe("moving");
  });
});
