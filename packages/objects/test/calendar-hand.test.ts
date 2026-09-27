// @vitest-environment node
// THE DESK CALENDAR AT WORK — the days and the pen (CALENDAR.md §5; D3t-c), the world halves through a real engine and document:
// writing on a pad is a GESTURE — a NEW line is a draft until its session ends and is then spawned WHOLE as one `desk.event`
// child (one transaction, one undo step; nothing written, nothing spawned), an existing line is written LIVE under the `Editing`
// claim and committed ONCE (nets to nothing: no transaction; written down to nothing: taken off the pad in that transaction),
// Esc takes a session back; the hand marks each pad from the user's `PadSelection` (a run of days, a line, the line being written
// with its caret) and the bar's today (a `home` bump) rolls the pad home — its month, one transaction OFF the undo stack — and
// selects today. And the pad's PARTS through the desk eye (the tape, the roll, the corner, the foot, a line, a day, the paper) —
// at rest the paper is no hit (a drag there pans), in hand the whole sheet is the pen's `content`; the bar's tools are live.
import { ChildOf, createCanvasEngine, Editing, type Entity, type GuardedTx, guardedTransaction, HeldTool, PrefabId } from "@ice/core";
import { describe, expect, it } from "vitest";
import { dayOfKey, keyOf } from "../src/calendar/month";
import { CALENDAR } from "../src/calendar/law";
import { padFrame } from "../src/calendar/pad";
import { printSheet } from "../src/calendar/print";
import { sheetOf } from "../src/calendar/sheet";
import { monthGrid, monthIndex, phasesBetween } from "../src/calendar/month";
import { calendarKind, type CalendarGeometry, createPads, DRAFT_ID, type Pads, partAt } from "../src/calendar/kind";
import { FLUX_REST, type ObjectContext, rectOf, MAT_GRID, DEFAULT_GRID } from "@ice/desk";
import { addEvent, Calendar, CalendarEvent, createCalendarHand, createCalendarWriting, Note, PadSelection } from "../src";
import { lampOf } from "../src/paper/paper";
import { type HandMetrics, HAND } from "@ice/desk/kit";
import { CALENDAR_LOOK, calendarPrint, PALETTE, PENS, THEMES } from "../../desk/oracle/fixtures/vf-theme";
import { must } from "../../desk/test/must";

const day = (k: string): number => dayOfKey(k);
const PAD = padFrame(CALENDAR);

function rig() {
  const ce = createCanvasEngine({ widgets: [Calendar, Note] });
  ce.docs.create();
  const pad = ce.ops.spawnWidget("desk.calendar", { x: -PAD.W / 2, y: -PAD.H / 2, props: { month: "2026-09" }, undoable: false });
  ce.world.sync();
  const pads = createPads({ pass: () => undefined, children: { stamp: () => 0, rows: () => [], entries: (e, c) => ce.world.getReverse(e, ChildOf).flatMap((k) => { const v = ce.world.get(k, c); return v === undefined ? [] : [{ entity: k, value: v }]; }) } });
  pads.sheets(pad, monthIndex(2026, 9));   // the draw path's word: the pad is on the desk (its state is the draw's to make — D7 #10)
  let fresh = 9000;
  const writing = createCalendarWriting({ world: ce.world, docs: ce.docs, pads: () => pads, fresh: () => fresh++ });
  let caret: { index: number; t0: number; wipe: { index: number; t0: number } | null } | null = null;
  const queued: (() => void)[] = [];
  const hand = createCalendarHand({ world: ce.world, docs: ce.docs, pads: () => pads, writing, caret: () => caret, defer: (fn) => queued.push(fn) });
  const session = () => must(ce.docs.current());
  const events = () => ce.world.getReverse(pad, ChildOf).map((k) => ({ k, v: ce.world.get(k, CalendarEvent) })).filter((r) => r.v !== undefined);
  const undoSteps = (): number => { const s = session().store; let n = 0; while (s.canUndo() && n < 50) { s.undo(); n += 1; } for (let i = 0; i < n; i++) s.redo(); return n; };
  const flush = (): void => { while (queued.length > 0) (queued.shift() as () => void)(); ce.world.sync(); };
  return { ce, pad, pads, writing, hand, session, events, undoSteps, flush, setCaret: (c: typeof caret) => { caret = c; } };
}

describe("writing on the calendar is a gesture (objects/calendar-writing.ts)", () => {
  it("a NEW line is a draft — printed through the pad's local, never an entity — until its session ends: then ONE child, whole, ONE undo step", () => {
    const r = rig();
    expect(r.writing.beginNew(r.pad, day("2026-09-02"), day("2026-09-02"), "felt")).toBe(true);
    for (const v of ["1", "11", "11am", "11am h", "11am haircut"]) r.writing.input(v);
    expect(r.events().length).toBe(0);                              // nothing in the document yet
    expect(r.pads.draftOf(r.pad)?.text).toBe("11am haircut");       // the draft the print shows
    expect(r.pads.entries(r.pad).some((e) => e.id === DRAFT_ID && e.text === "11am haircut")).toBe(true);
    const before = r.undoSteps();
    expect(r.writing.commit()).toBe(true);
    r.ce.world.sync();
    const [ev] = r.events();
    expect(r.events().length).toBe(1);
    expect(ev?.v).toMatchObject({ start: "2026-09-02", end: "2026-09-02", text: "11am haircut", ink: "felt" });
    expect(must(ev?.v).seeds?.length).toBeGreaterThan(0);             // the hand's seeds carried from the first key
    expect(r.undoSteps()).toBe(before + 1);
    expect(r.pads.draftOf(r.pad)).toBeNull();
    // the writing goes on, on the entry it became (the claim on it)
    expect(r.writing.current()?.entry).toBe(ev?.k);
    expect(r.ce.world.hasTag(must(ev?.k), Editing)).toBe(true);
    r.writing.end();
    expect(r.ce.world.hasTag(must(ev?.k), Editing)).toBe(false);
    r.session().store.undo();
    r.ce.world.sync();
    expect(r.events().length).toBe(0);                              // ONE ⌘Z takes the whole line back
  });

  it("a draft that nets to nothing spawns nothing; Esc (cancel) takes a draft back", () => {
    const r = rig();
    r.writing.beginNew(r.pad, day("2026-09-03"), day("2026-09-03"), "felt");
    r.writing.input("  ");
    expect(r.writing.commit()).toBe(false);
    r.writing.input("dentist");
    r.writing.cancel();
    expect(r.events().length).toBe(0);
    expect(r.pads.draftOf(r.pad)).toBeNull();
    expect(r.writing.current()).toBeNull();
  });

  it("an EXISTING line is written live under the claim and committed ONCE; nets to nothing — no transaction; down to nothing — taken off the pad", () => {
    const r = rig();
    let e: Entity | undefined;
    r.ce.world.sync();
    guarded(r, (tx) => { e = addEvent(tx, r.pad, { start: "2026-09-17", text: "dentist" }); });
    const entry = must(e);
    const steps0 = r.undoSteps();
    expect(r.writing.beginEntry(r.pad, entry)).toBe(true);
    r.writing.input("dentist 3pm");
    expect((r.ce.world.get(entry, CalendarEvent) as { text: string }).text).toBe("dentist 3pm");           // live
    expect((r.session().store.getComponent(entry, CalendarEvent) as { text: string }).text).toBe("dentist");  // the document: not yet
    expect(r.writing.commit()).toBe(true);
    expect((r.session().store.getComponent(entry, CalendarEvent) as { text: string }).text).toBe("dentist 3pm");
    expect(r.undoSteps()).toBe(steps0 + 1);
    // a session that nets to nothing
    r.writing.input("dentist 3pm!");
    r.writing.input("dentist 3pm");
    expect(r.writing.commit()).toBe(false);
    expect(r.undoSteps()).toBe(steps0 + 1);
    // written down to nothing: the line leaves the pad in the session's one transaction
    r.writing.input("");
    expect(r.writing.commit()).toBe(true);
    r.ce.world.sync();
    expect(r.events().length).toBe(0);
    r.session().store.undo();
    r.ce.world.sync();
    expect(r.events().map((q) => q.v?.text)).toEqual(["dentist 3pm"]);
  });

  it("Esc on an existing line puts its cell back as the session found it — no transaction, the claim lifted", () => {
    const r = rig();
    let e: Entity | undefined;
    guarded(r, (tx) => { e = addEvent(tx, r.pad, { start: "2026-09-17", text: "gym" }); });
    const entry = must(e);
    const steps = r.undoSteps();
    r.writing.beginEntry(r.pad, entry);
    r.writing.input("gym at 7");
    r.writing.cancel();
    expect((r.ce.world.get(entry, CalendarEvent) as { text: string }).text).toBe("gym");
    expect(r.ce.world.hasTag(entry, Editing)).toBe(false);
    expect(r.undoSteps()).toBe(steps);
  });
});

function guarded(r: ReturnType<typeof rig>, fn: (tx: GuardedTx) => void): void {
  guardedTransaction(r.session().store, r.ce.world, fn);
  r.ce.world.sync();
}

describe("the hand marks each pad from the user's selection (objects/calendar-hand.ts)", () => {
  it("a run of days, a line, the line being written with its caret's blink — and nothing once the selection goes", () => {
    const r = rig();
    r.ce.world.addComponent(r.pad, PadSelection, { anchor: "2026-09-11", focus: "2026-09-15", entry: 0 as Entity, home: 0 });
    r.hand.follow(1000);
    expect(r.pads.marksOf(r.pad)).toEqual({ days: [day("2026-09-11"), day("2026-09-15")] });
    r.writing.beginNew(r.pad, day("2026-09-02"), day("2026-09-02"), "felt");
    r.writing.input("hi");
    r.setCaret({ index: 2, t0: 1000, wipe: { index: 1, t0: 1000 } });
    r.hand.follow(1050);
    const m = must(r.pads.marksOf(r.pad));
    expect(m.writing).toEqual({ entry: DRAFT_ID, index: 2, on: true });
    expect(m.wipe?.index).toBe(1);
    expect(m.days).toBeUndefined();                                  // the days give way to the line being written
    r.hand.follow(1000 + 530 + 10);
    expect(r.pads.marksOf(r.pad)?.writing?.on).toBe(false);          // the blink's second phase
    r.writing.cancel();
    r.ce.world.removeComponent(r.pad, PadSelection);
    r.hand.follow(2000);
    expect(r.pads.marksOf(r.pad)).toBeUndefined();
  });

  it("the bar's today (a `home` bump) rolls the pad home — its month, ONE transaction OFF the undo stack — and selects today", () => {
    const r = rig();
    r.pads.pinToday("2026-11-05");
    r.ce.world.addComponent(r.pad, PadSelection, { anchor: "", focus: "", entry: 0 as Entity, home: 0 });
    r.hand.follow(1000);
    const steps = r.undoSteps();
    r.ce.world.edit(r.pad).set(PadSelection, { anchor: "", focus: "", entry: 0 as Entity, home: 1 });
    r.hand.follow(1016);
    r.flush();
    const props = r.ce.world.get(r.pad, Calendar.groups[0]?.component as never) as { month: string };
    expect(props.month).toBe("2026-11");
    expect(r.ce.world.get(r.pad, PadSelection)).toMatchObject({ anchor: "2026-11-05", focus: "2026-11-05" });
    expect(r.undoSteps()).toBe(steps);                               // a roll is not an edit
  });

  it("a hand's roll landed: the tick BEFORE the document echoes it starts no turn back — the hold lasts until the roll hears the document's month move (D7 #3, the gate's lesson)", () => {
    const r = rig();
    const SEP = monthIndex(2026, 9);
    r.pads.sheets(r.pad, SEP);   // the draw path's word: the pad shows the document's month
    // a click on the foot takes the whole month: the turn runs to its end and the month is the hand's to commit
    expect(r.pads.grab(r.pad, "foot", PAD.W / 2, PAD.L, 0)).toBe(true);
    r.pads.letGo(r.pad, 8);
    let t = 8;
    for (let i = 0; i < 600 && r.pads.rollOf(r.pad)?.pending !== SEP + 1; i++) { t += 16; r.pads.tick?.(t); }
    expect(r.pads.rollOf(r.pad)).toMatchObject({ shown: SEP + 1, pending: SEP + 1, turn: null });
    r.hand.follow(t);
    r.flush();   // the commit lands in the document
    expect((r.ce.world.get(r.pad, Calendar.groups[0]?.component as never) as { month: string }).month).toBe("2026-10");
    // the layer's order: the kinds' tick runs BEFORE the draw path refreshes the roll's durable — this tick still hears September
    t += 16;
    r.pads.tick?.(t);
    expect(r.pads.rollOf(r.pad)).toMatchObject({ shown: SEP + 1, turn: null });   // no turn back: the hold stands until the document speaks
    // the draw path brings the document's word; the next tick hears it move and the hold ends
    r.pads.sheets(r.pad, SEP + 1);
    t += 16;
    r.pads.tick?.(t);
    expect(r.pads.rollOf(r.pad)).toMatchObject({ shown: SEP + 1, pending: null, turn: null });
  });

  it("a pad forgotten (its delete): a mark, a draft, a peek, a grab on it re-acquire NO state — the freed slot goes to the next pad (D7 #10)", () => {
    const r = rig();
    const SEP = monthIndex(2026, 9);
    r.pads.sheets(r.pad, SEP);   // the draw path makes its state
    expect(r.pads.state(r.pad).slot).toBe(0);
    r.pads.forget?.(r.pad);
    r.pads.mark(r.pad, { drop: 3 });
    r.pads.draft(r.pad, { start: 3, end: 3, text: "x", seeds: [], ink: "felt" });
    r.pads.peek(r.pad, true);
    expect(r.pads.grab(r.pad, "foot", PAD.W / 2, PAD.L, 0)).toBe(false);
    expect(r.pads.marksOf(r.pad)).toBeUndefined();
    expect(r.pads.draftOf(r.pad)).toBeNull();
    expect(r.pads.rollOf(r.pad)).toBeUndefined();
    const other = r.ce.ops.spawnWidget("desk.calendar", { x: 2000, y: 0, props: { month: "2026-09" }, undoable: false });
    expect(r.pads.state(other).slot).toBe(0);   // the forgotten pad's slot, free again
  });

  it("the hand idles only on a desk with no pad (D7 #14): a pad drawn keeps it following (its peek reads the pointer each frame); a selection wakes it", () => {
    const r = rig();
    expect(r.hand.idle()).toBe(false);   // the rig's pad is on the desk
    r.pads.forget?.(r.pad);
    expect(r.hand.idle()).toBe(true);
    r.ce.world.addComponent(r.pad, PadSelection, { anchor: "2026-09-02", focus: "2026-09-02", entry: 0 as Entity, home: 0 });
    expect(r.hand.idle()).toBe(false);
  });
});

// ---------------------------------------------------------------- the parts, through the desk eye

const METRICS: HandMetrics = { ascent: 0.8, descent: 0.25, advance: (ch) => (ch === " " ? 0.3 : 0.5) };
const kind = calendarKind();
const palette = { ...PALETTE.light, calendars: CALENDAR_LOOK, pens: PENS };
const look = must(kind.theme)(palette, "light");
const view = { camX: -1200, camY: -1000, zoom: 0.42, width: 1200, height: 800, dpr: 2 };
const ctxOf = (over: Partial<ObjectContext> = {}): ObjectContext => ({
  entity: 7 as Entity, rect: rectOf({ x: -PAD.W / 2, y: -PAD.H / 2 }, { w: PAD.W, h: PAD.H }), props: { month: "2026-09", weekStart: 1, tape: "ink", pen: "felt" },
  flux: FLUX_REST, look, theme: THEMES.light, lamp: lampOf(MAT_GRID.plane), view, grid: DEFAULT_GRID, dt: 1 / 60, ...over,
});

describe("a pad's parts through the desk eye (kinds/calendar.ts `partAt`) and its hit", () => {
  const G = kind.resolve(ctxOf()) as CalendarGeometry;
  /** A sheet point as the DESK point the eye puts under it (the inverse of `partAt`'s unprojection at the face). */
  const deskAt = (sx: number, sy: number): readonly [number, number] => {
    const x = G.cx - PAD.W / 2 + sx;
    const y = G.cy - PAD.H / 2 + sy;
    const f = G.eye.h / (G.eye.h - PAD.zt - G.lift);
    return [G.eye.ex + (x - G.eye.ex) * f, G.eye.ey + (y - G.eye.ey) * f];
  };
  const at = (sx: number, sy: number) => { const [x, y] = deskAt(sx, sy); return partAt(G, x, y); };
  const L = sheetOf(monthGrid(monthIndex(2026, 9), 1), CALENDAR);

  it("the tape, the roll under it, the corner, the foot, a day, the paper beside the grid — and nothing off the pad", () => {
    expect(at(800, 20)?.part).toBe("tape");
    expect(at(800, PAD.T + 20)?.part).toBe("roll");
    expect(at(PAD.W - 30, PAD.H - 30)?.part).toBe("corner");
    expect(at(800, PAD.H - 10)?.part).toBe("foot");
    const d = at(L.x0 + 2 * L.cw + 100, L.y0 + 150);
    expect(d?.part).toBe("day");
    expect(d?.day).toBe(day("2026-09-02"));
    expect(at(10, 900)?.part).toBe("sheet");
    const [x, y] = deskAt(-40, 900);
    expect(partAt(G, x, y)).toBeNull();
  });

  it("a line of writing, where the print laid it", () => {
    const ev = { id: 41, start: day("2026-09-02"), end: day("2026-09-02"), text: "haircut", seeds: [], seed: 3, ink: "felt", rev: 0 };
    const print = printSheet({ law: CALENDAR, look: calendarPrint(), sheet: L, events: [ev], noted: new Set(), today: day("2026-09-24"), moons: phasesBetween(L.grid.first, L.grid.first + 41, (ms) => Math.floor(ms / 864e5)), face: { family: "Caveat", weight: 500 }, metrics: METRICS, hand: HAND, measure: (_f, s) => s.length * 6, ticks: true, style: "t" });
    const line = must(print.lines[0]);
    const [x, y] = deskAt(line.box.x + 10, line.box.y + 10);
    const p = partAt(G, x, y, print.lines);
    expect(p?.part).toBe("entry");
    expect(p?.line?.event.id).toBe(41);
  });

  it("the hit AT REST: the tape is the pad's frame, the roll's handles are parts, the paper is no hit (a drag there pans); IN HAND the sheet is `content`", () => {
    const hitAt = (g: CalendarGeometry, sx: number, sy: number) => { const [x, y] = deskAt(sx, sy); return kind.hit(g, x, y); };
    expect(hitAt(G, 800, 20)).toBe("frame");
    expect(hitAt(G, 800, PAD.T + 20)).toBe("roll");
    expect(hitAt(G, PAD.W - 30, PAD.H - 30)).toBe("corner");
    expect(hitAt(G, 800, PAD.H - 10)).toBe("foot");
    expect(hitAt(G, L.x0 + 300, L.y0 + 150)).toBeNull();
    const Gh = kind.resolve(ctxOf({ held: { e: 1, open: true, grow: 1, snap: true } })) as CalendarGeometry;
    expect(Gh.held).toBe(true);
    expect(hitAt(Gh, L.x0 + 300, L.y0 + 150)).toBe("content");
    expect(hitAt(Gh, 800, PAD.H - 10)).toBe("content");
    expect(hitAt(Gh, 800, 20)).toBe("frame");
  });
});

describe("the bar's tools are live (D3t-a's seam — kinds/calendar.ts `open.tools`)", () => {
  it("‹ › turn the month (ONE transaction, off the undo stack), today bumps the hand's `home`, the pen is the mode in hand", () => {
    const r = rig();
    const steps = r.undoSteps();
    r.ce.ops.open(r.pad);
    r.ce.step(16);
    expect(r.ce.world.get(r.pad, HeldTool)?.id).toBe("pen");
    expect(r.ce.ops.useHeldTool("month:1")).toBe(true);
    r.ce.world.sync();
    const month = () => (r.ce.world.get(r.pad, Calendar.groups[0]?.component as never) as { month: string }).month;
    expect(month()).toBe("2026-10");
    r.ce.ops.useHeldTool("month:-1");
    r.ce.ops.useHeldTool("month:-1");
    r.ce.world.sync();
    expect(month()).toBe("2026-08");
    expect(r.undoSteps()).toBe(steps);
    r.ce.ops.useHeldTool("today");
    expect(r.ce.world.get(r.pad, PadSelection)?.home).toBe(1);
    const tools = must(r.ce.catalog.widget("desk.calendar")).heldTools ?? [];
    expect(tools.map((t) => `${t.id}:${t.kind}:${(t.keys ?? []).join("|")}`)).toEqual(["month:-1:action:ArrowLeft|PageUp|[", "month:1:action:ArrowRight|PageDown|]", "today:action:t", "pen:mode:p"]);
    expect(keyOf(day("2026-09-02"))).toBe("2026-09-02");
    expect(r.ce.world.get(r.pad, PrefabId)?.id).toBe("desk.calendar");
  });
});

describe("the marks on the sheet (the local's `draw` → the record's `sel` · `mark` · `caret`)", () => {
  it("a run across a Monday is two boxes, a box a week; the line selected is boxed where the print laid it; the caret at its index", () => {
    const raster = { hand: () => ({ face: { family: "Caveat", weight: 500 }, metrics: METRICS }), version: () => 1, measure: (_f: string, s: string) => s.length * 6, tile: () => ({}) as never, bytes: () => new Uint8Array(0) };
    const rows = [{ entity: 51 as Entity, value: { start: "2026-09-02", end: "2026-09-02", text: "haircut", seeds: "", ink: "felt" } }];
    const pads: Pads = createPads({ pass: () => undefined, print: raster, children: { stamp: () => 0, rows: () => [], entries: ((_e: Entity, _c: unknown) => rows) as never } });
    const ctx = ctxOf({ local: pads });
    const G = kind.resolve(ctx) as CalendarGeometry;
    pads.mark(ctx.entity, { days: [day("2026-09-11"), day("2026-09-15")] });
    let R = kind.record(G, ctx);
    expect(R.sel.length).toBe(2);
    const L = sheetOf(monthGrid(monthIndex(2026, 9), 1), CALENDAR);
    expect(R.sel[0]?.[0]).toBeCloseTo(L.x0 + 4 * L.cw + 3);   // Friday 11 …
    expect(R.sel[1]?.[2]).toBeCloseTo(L.x0 + 2 * L.cw - 3);   // … to Tuesday 15, the next week
    pads.mark(ctx.entity, { entry: 51 });
    R = kind.record(G, ctx);
    const line = must(pads.printOf(ctx.entity, monthIndex(2026, 9))?.lines.find((l) => l.event.id === 51));
    expect(R.mark).toEqual([line.box.x - 5, line.box.y - 1, line.box.x + line.box.w + 5, line.box.y + line.box.h + 2]);
    expect(R.sel).toEqual([]);
    pads.mark(ctx.entity, { entry: 51, writing: { entry: 51, index: 3, on: true } });
    R = kind.record(G, ctx);
    expect(R.caret).not.toBeNull();
    expect(must(R.caret)[0]).toBeGreaterThan(line.ox);
    pads.mark(ctx.entity, { entry: 51, writing: { entry: 51, index: 3, on: false } });
    expect(kind.record(G, ctx).caret).toBeNull();               // the blink's off phase
  });
});
