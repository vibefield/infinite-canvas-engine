// @vitest-environment node
// NOTES STUCK TO DAYS (CALENDAR.md §5; D3t-c) through a real engine, document and builder: a note let go over a day of the month
// laid bare STICKS — one transaction: its pin (a data child of the pad, its edge to the note) and the note at its day's slot, the note
// gliding there from where it was let go (a tween: the document already holds the slot); carried off by itself it is UNSTUCK (one
// transaction), riding its carried pad it is not; while carried over a pad, the day it would stick to is marked. It GOES WITH ITS
// MONTH: a note of a month the pad does not show is veiled — not drawn, never picked (`outside`) — and comes back when its month is
// laid bare again; in hand, the notes the pad shows ride along in the hand's own slot and leave the desk behind.
import { Camera, CancelRequest, ChildOf, createCanvasEngine, type Entity, Grab, guardedTransaction, HeldView, NO_MODS, Position, PrefabId, schemaMeta, TransformTween, Viewport } from "@ice/core";
import { describe, expect, it } from "vitest";
import { dayOfKey, monthGrid, monthIndex } from "../src/calendar/month";
import { sheetOf } from "../src/calendar/sheet";
import { CALENDAR } from "../src/calendar/law";
import { padFrame } from "../src/calendar/pad";
import { createDeskBuilder, createPickSource, DEFAULT_GRID } from "@ice/desk";
import { worldChildren } from "../../desk/src/compose/children";
import { calendarKind, createPads, type Pads } from "../src/calendar/kind";
import { paperKind } from "../src/paper/kind";
import { Calendar, createCalendarHand, createCalendarWriting, daySlot, Note, NotePin, PadSelection, pinNote, PinsNote } from "../src";
import { CALENDAR_LOOK, PALETTE, PENS, SURFACES, THEMES } from "../oracle/fixtures/vf-theme";
import { must } from "../../desk/test/must";

const VP = { width: 1200, height: 800, dpr: 2 };
const F = padFrame(CALENDAR);
const palette = { ...PALETTE.light, papers: { yellow: SURFACES.note }, pens: PENS, calendars: CALENDAR_LOOK };
const LOOKS = new Map<string, unknown>([["paper", must(paperKind().theme)(palette, "light")], ["calendar", must(calendarKind().theme)(palette, "light")]]);
const CAM = { x: -1300, y: -950, zoom: 0.42 };

function desk() {
  const ce = createCanvasEngine({ widgets: [Note, Calendar] });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: VP.width, h: VP.height, dpr: VP.dpr });
  let now = 0;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  // the pad centred at (0, 0), September 2026 from Monday
  const pad = ce.ops.spawnWidget("desk.calendar", { x: -F.W / 2, y: -F.H / 2, props: { month: "2026-09" }, undoable: false });
  const pads: Pads = createPads({ pass: () => undefined, children: worldChildren(ce.world) });
  const locals = new Map([["calendar", pads]]);
  const builder = createDeskBuilder(ce.world, { objects: [Note, Calendar], locals });
  let clock = 0;
  const build = (hold?: { e: number }) => { clock += 16; pads.tick?.(clock); builder.changed(); return builder.build(CAM, VP, 1 / 60, THEMES.light, DEFAULT_GRID, LOOKS, hold !== undefined ? { hold } : {}); };
  const session = () => must(ce.docs.current());
  const note = (cx: number, cy: number): Entity => { const n = ce.ops.spawnWidget("desk.note", { x: cx - 100, y: cy - 100, props: { seed: 7 }, undoable: false }); ce.world.sync(); return n; };
  /** Stick a note to a day as the hand does: its pin and the note at the day's slot, one transaction. */
  const stickTo = (n: Entity, day: string): void => {
    const s = daySlot(0, 0, day);
    guardedTransaction(session().store, ce.world, (tx) => { pinNote(tx, pad, n, day); tx.edit(n).set(Position, { x: s.x - 100, y: s.y - 100 }); });
    ce.world.sync();
  };
  step(2);
  return { ce, world: ce.world, step, pad, pads, builder, build, session, note, stickTo };
}

const drawnIds = (b: { objects: readonly { kind: string; record: unknown }[] }): string[] => b.objects.map((o) => o.kind);

describe("a note GOES WITH ITS MONTH (the pad's local veils it)", () => {
  it("a note of a month the pad does not show is veiled — not drawn, never picked — and back when its month is laid bare", () => {
    const d = desk();
    const sep = d.note(0, 0);
    const oct = d.note(400, 0);
    d.stickTo(sep, "2026-09-24");
    d.stickTo(oct, "2026-10-08");
    d.step();
    const b = d.build();
    expect(drawnIds(b).filter((k) => k === "paper").length).toBe(1);
    expect(d.builder.veiled(oct)).toBe(true);
    expect(d.builder.veiled(sep)).toBe(false);
    const pick = createPickSource(d.builder);
    const at = daySlot(0, 0, "2026-10-08");
    expect(pick.hit(oct, at.x, at.y)).toBe("outside");
    // the document turns the pad to October: it rolls (the local's turn), and once laid bare the notes trade places
    d.ce.ops.setWidgetProps(d.pad, { month: "2026-10" });
    d.step();
    const OCT = monthIndex(2026, 10);
    let frames = 0;
    while (frames < 400 && !(d.pads.rollOf(d.pad)?.shown === OCT && d.pads.rollOf(d.pad)?.turn === null)) { d.build(); frames += 1; }
    expect(frames).toBeGreaterThan(10);   // it ROLLED there
    d.build();
    expect(d.builder.veiled(oct)).toBe(false);
    expect(d.builder.veiled(sep)).toBe(true);
  });

  it("mid-roll, one note at a time: on the sheet rolling away, a note shows until the roll reaches it; on the sheet beneath, once laid bare (Q-7)", () => {
    const d = desk();
    const top = d.note(0, 0);     // 3 September, the first week: the roll has not reached it
    const foot = d.note(0, 0);    // 28 September, the last: rolled over already
    const bare = d.note(0, 0);    // 26 October, laid bare beneath
    const under = d.note(0, 0);   // 1 October, still under September
    d.stickTo(top, "2026-09-03");
    d.stickTo(foot, "2026-09-28");
    d.stickTo(bare, "2026-10-26");
    d.stickTo(under, "2026-10-01");
    d.pads.pin(d.pad, { roll: { dir: 1, p: 0.55 } });
    d.build();
    expect([top, foot, bare, under].map((n) => d.builder.veiled(n))).toEqual([false, true, false, true]);
  });

  it("in hand the notes it shows ride along in the hand's slot (and leave the desk behind); a veiled one stays out of both", () => {
    const d = desk();
    const sep = d.note(0, 0);
    const oct = d.note(400, 0);
    d.stickTo(sep, "2026-09-24");
    d.stickTo(oct, "2026-10-08");
    d.build();
    d.ce.ops.open(d.pad);
    d.step();
    const b = d.build({ e: 1 });
    const held = must(b.held);
    expect(held.inputs.riders?.map((r) => r.kind)).toEqual(["paper"]);
    expect(drawnIds(b).includes("paper")).toBe(false);   // out of the desk behind while in hand
    expect(d.world.get(d.pad, HeldView)).toBeDefined();
    expect(oct).toBeDefined();
  });
});

describe("the hand sticks and unsticks (objects/calendar-hand.ts) — at the LANDING, inside the move's own transaction (D7 #2)", () => {
  function rig() {
    const d = desk();
    const queued: (() => void)[] = [];
    const writing = createCalendarWriting({ world: d.world, docs: d.ce.docs, pads: () => d.pads });
    const hand = createCalendarHand({
      world: d.world, docs: d.ce.docs, pads: () => d.pads, writing, caret: () => null, defer: (fn) => queued.push(fn),
      geometryOf: (e) => d.builder.geometryOf(e), isPad: (e) => e === d.pad, isNote: (e) => d.world.get(e, PrefabId)?.id === "desk.note",
    });
    const flush = (): void => { while (queued.length > 0) (queued.shift() as () => void)(); d.world.sync(); };
    const undoSteps = (): number => { const s = d.session().store; let n = 0; while (s.canUndo() && n < 50) { s.undo(); n += 1; } for (let i = 0; i < n; i++) s.redo(); d.world.sync(); return n; };
    const pinsOf = () => d.world.getReverse(d.pad, ChildOf).filter((k) => d.world.has(k, NotePin)).map((k) => ({ pin: k, day: d.world.get(k, NotePin)?.day, note: d.world.getRelation(k, PinsNote) }));
    /** Carry a note as the drop MARKS see it — core's rider on it, one frame of the hand (the marks read the runtime, never a transaction). */
    const carry = (n: Entity): void => { const p = must(d.world.get(n, Position)); d.world.addComponent(n, Grab, { x: p.x, y: p.y, w: 200, h: 200, parent: 0 as Entity, prev: 0 as Entity, ord: 0 }); hand.follow(0); };
    const putBack = (n: Entity): void => { d.world.removeComponent(n, Grab); hand.follow(0); };
    // core's OWN drag through the stack (the landing is core's move intent): the builder's camera; screen = (world − cam) · zoom; the box tier picks by rect
    d.world.setResource(Camera, { x: CAM.x, y: CAM.y, zoom: CAM.zoom, gesturing: false });
    const sx = (wx: number): number => (wx - CAM.x) * CAM.zoom;
    const sy = (wy: number): number => (wy - CAM.y) * CAM.zoom;
    const mouse = (kind: "down" | "move" | "up", x: number, y: number, buttons: number): void => { d.ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: NO_MODS }); };
    /** A frame as the layer runs it: core's step, then the hand. */
    const frame = (n = 1): void => { for (let i = 0; i < n; i++) { d.step(); hand.follow(0); } };
    /** The pointer's world point, moved a frame at a time. */
    let at = { x: 0, y: 0 };
    const move = (wx: number, wy: number, buttons: number): void => { at = { x: wx, y: wy }; mouse("move", sx(wx), sy(wy), buttons); frame(); };
    /** Press a note at its centre and carry its CENTRE to (cx, cy) in six moves; the button stays down. */
    const carryTo = (n: Entity, cx: number, cy: number): void => {
      const p = must(d.world.get(n, Position));
      const x0 = p.x + 100;
      const y0 = p.y + 100;
      move(x0, y0, 0);
      mouse("down", sx(x0), sy(y0), 1); frame();
      for (let i = 1; i <= 6; i++) move(x0 + ((cx - x0) * i) / 6, y0 + ((cy - y0) * i) / 6, 1);
      // core measures a drag from the move that made it one (past its slop), so the note trails the pointer: the residual brings its centre to (cx, cy)
      const q = must(d.world.get(n, Position));
      move(at.x + (cx - (q.x + 100)), at.y + (cy - (q.y + 100)), 1);
    };
    /** Let go where the pointer is: core's move commits at the release — and the landing inside it. */
    const letGo = (): void => { mouse("up", sx(at.x), sy(at.y), 0); frame(3); flush(); };
    /** Esc: core restores the note where the carry began and commits nothing. */
    const esc = (): void => { d.world.setResource(CancelRequest, { active: true }); frame(2); mouse("up", sx(at.x), sy(at.y), 0); frame(2); flush(); };
    d.build();
    return { ...d, hand, flush, undoSteps, pinsOf, carry, putBack, carryTo, letGo, esc };
  }

  it("let go over a day of the month laid bare, a note STICKS — its pin and the note at the day's slot land IN the move's transaction: ONE undo step for the whole drop; it glides there", () => {
    const r = rig();
    const n = r.note(1100, 300);
    r.build();
    const steps = r.undoSteps();
    const s17 = daySlot(0, 0, "2026-09-17");
    r.carryTo(n, s17.x + 30, s17.y - 40);
    expect(r.pinsOf()).toEqual([]);   // nothing is written while it is carried
    r.letGo();
    expect(r.pinsOf().map((p) => [p.day, p.note])).toEqual([["2026-09-17", n]]);
    expect(r.session().store.getComponent(n, Position)).toEqual({ x: s17.x - 100, y: s17.y - 100 });   // the document: at the slot
    expect(r.world.get(n, TransformTween)).toMatchObject({ toX: s17.x - 100, toY: s17.y - 100 });        // the note: gliding there
    expect(r.undoSteps()).toBe(steps + 1);
    r.session().store.undo();
    r.world.sync();
    expect(r.pinsOf()).toEqual([]);
    expect(r.session().store.getComponent(n, Position)).toEqual({ x: 1000, y: 200 });   // ONE ⌘Z: unpinned, back where the carry began
  });

  it("carried over a day, the day it would stick to is marked on the pad — merged with the days selected on it; a carry that never lands writes nothing", () => {
    const r = rig();
    const n = r.note(1100, 300);
    r.build();
    r.carry(n);
    const s17 = daySlot(0, 0, "2026-09-17");
    r.world.edit(n).set(Position, { x: s17.x - 100 + 30, y: s17.y - 100 - 40 });
    r.hand.follow(0);
    expect(r.pads.marksOf(r.pad)?.drop).toBe(dayOfKey("2026-09-17"));
    r.world.addComponent(r.pad, PadSelection, { anchor: "2026-09-02", focus: "2026-09-02", entry: 0 as Entity, home: 0 });
    r.hand.follow(0);
    expect(r.pads.marksOf(r.pad)).toMatchObject({ days: [dayOfKey("2026-09-02"), dayOfKey("2026-09-02")], drop: dayOfKey("2026-09-17") });
    r.world.removeComponent(r.pad, PadSelection);
    r.putBack(n);
    r.flush();
    expect(r.pinsOf()).toEqual([]);
  });

  it("let go off the pad, or on a neighbour month's day printed on the sheet, nothing sticks", () => {
    const r = rig();
    const n = r.note(1100, 300);
    r.build();
    r.carryTo(n, 1300, 300);
    r.letGo();
    expect(r.pinsOf()).toEqual([]);
    // 31 August heads September's grid (row 0, column 0), printed faint: not a day of the month laid bare
    const L = sheetOf(monthGrid(monthIndex(2026, 9), 1), CALENDAR);
    const gx = -F.W / 2 + L.x0 + L.cw / 2;
    const gy = -F.H / 2 + L.y0 + L.ch / 2;
    r.carryTo(n, gx, gy);
    r.letGo();
    expect(r.pinsOf()).toEqual([]);
  });

  it("carried off by itself, a stuck note keeps its pin until it is let go; Esc puts it back on its day with the pin alive — a cancelled carry commits nothing", () => {
    const r = rig();
    const n = r.note(0, 0);
    r.stickTo(n, "2026-09-24");
    r.build();
    const steps = r.undoSteps();
    const s24 = daySlot(0, 0, "2026-09-24");
    r.carryTo(n, 1300, 300);
    expect(r.pinsOf().length).toBe(1);   // the pin outlives the carry: nothing is written in the hand
    r.esc();
    expect(r.pinsOf().map((p) => [p.day, p.note])).toEqual([["2026-09-24", n]]);
    expect(r.world.get(n, Position)).toEqual({ x: s24.x - 100, y: s24.y - 100 });
    expect(r.undoSteps()).toBe(steps);
  });

  it("let go off every day, it is UNSTUCK in the move's own step — one ⌘Z puts it back on its day; moved to another day, one ⌘Z puts it back on the first", () => {
    const r = rig();
    const n = r.note(0, 0);
    r.stickTo(n, "2026-09-24");
    r.build();
    const s24 = daySlot(0, 0, "2026-09-24");
    let steps = r.undoSteps();
    r.carryTo(n, 1300, 300);
    r.letGo();
    expect(r.pinsOf()).toEqual([]);
    const off = must(r.session().store.getComponent(n, Position));
    expect(off.x).toBeCloseTo(1200, 3);   // where it was let go (the screen's float, through the camera at zoom 0.42)
    expect(off.y).toBeCloseTo(200, 3);
    expect(r.undoSteps()).toBe(steps + 1);
    r.session().store.undo();
    r.world.sync();
    expect(r.pinsOf().map((p) => [p.day, p.note])).toEqual([["2026-09-24", n]]);
    expect(r.session().store.getComponent(n, Position)).toEqual({ x: s24.x - 100, y: s24.y - 100 });
    // and from one day to another: the old pin and the new land in the move's step
    steps = r.undoSteps();
    const s10 = daySlot(0, 0, "2026-09-10");
    r.carryTo(n, s10.x + 5, s10.y + 5);
    r.letGo();
    expect(r.pinsOf().map((p) => [p.day, p.note])).toEqual([["2026-09-10", n]]);
    expect(r.session().store.getComponent(n, Position)).toEqual({ x: s10.x - 100, y: s10.y - 100 });
    expect(r.undoSteps()).toBe(steps + 1);
    r.session().store.undo();
    r.world.sync();
    expect(r.pinsOf().map((p) => [p.day, p.note])).toEqual([["2026-09-24", n]]);
  });
});

describe("the pin's lifecycle with its note, and the notes riding the pad (core's `dependent` edge and `riders`, declared by the calendar)", () => {
  it("a stuck note deleted takes its pin in the same transaction; one ⌘Z brings both back", () => {
    const d = desk();
    const n = d.note(0, 0);
    d.stickTo(n, "2026-09-24");
    expect(schemaMeta.relation(PinsNote)?.dependent).toBe(true);
    const pins = () => d.world.getReverse(d.pad, ChildOf).filter((k) => d.world.has(k, NotePin));
    d.ce.ops.setSelection([n], "replace");
    d.ce.ops.deleteSelection();
    d.world.sync();
    expect([d.world.isAlive(n), pins().length]).toEqual([false, 0]);
    d.session().store.undo();
    d.world.sync();
    expect(pins().length).toBe(1);
    expect(d.world.isAlive(must(d.world.getRelation(must(pins()[0]), PinsNote)))).toBe(true);
  });

  it("the pad carried: the notes stuck to it ride with it — the same delta, the same transaction", () => {
    const d = desk();
    const n = d.note(0, 0);
    d.stickTo(n, "2026-09-24");
    const n0 = must(d.world.get(n, Position));
    d.ce.world.setResource(Camera, { x: -1300, y: -950, zoom: 0.42, gesturing: false });
    const mouse = (kind: "down" | "move" | "up", x: number, y: number, buttons: number): void => { d.ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: NO_MODS }); };
    // the pad's tape on screen at zoom 0.42 (the box tier picks the pad by its rect: no renderer here)
    const tx = (0 + 1300) * 0.42;
    const ty = (-F.H / 2 + 20 + 950) * 0.42;
    mouse("move", tx, ty, 0); d.step();
    mouse("down", tx, ty, 1); d.step();
    for (let i = 1; i <= 6; i++) { mouse("move", tx + 10 * i, ty + 5 * i, 1); d.step(); }
    mouse("up", tx + 60, ty + 30, 0); d.step(3);
    const p1 = must(d.world.get(d.pad, Position));
    const n1 = must(d.world.get(n, Position));
    const dx = p1.x + F.W / 2;
    expect(dx).toBeGreaterThan(20);
    expect(n1.x - n0.x).toBeCloseTo(dx, 9);
    expect(n1.y - n0.y).toBeCloseTo(p1.y + F.H / 2, 9);
    expect(d.world.getReverse(d.pad, ChildOf).filter((k) => d.world.has(k, NotePin)).length).toBe(1);   // riding its pad, never unstuck
  });
});
