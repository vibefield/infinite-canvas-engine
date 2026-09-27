// THE REGISTERED WAKES (K7a — design-016 §6, design-015 §2.4 idle-zero): each kind says when it is next live (`KindLocal.due`) and
// a desk at rest asks none of them. Mounted as a host mounts it — the desk layer on a fake device over an engine with the six
// objects, the engine's frame gate handed in — and stepped as the SLEEPING loop steps it (a step, then `nextStep`). The counters are
// the layer's own (`perf().kindTicks`, `driverAsks`): a step a registered time alone starts (`frame.settled()`) asks no driver and
// ticks no kind but one due; and each kind's `due` answers now while it moves, a time when it has one, never at rest.

import { closeTray, type Entity, openTray } from "@ice/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LAYER_IDLE_MS } from "@ice/desk/kit";
import type { BoardInk } from "../src/board/kind";
import type { Pads } from "../src/calendar/kind";
import type { Books } from "../src/notebook/kind";
import type { Writing } from "../src/paper/writing";
import type { Prints } from "../src/photo/kind";
import { type DeskMount, mountDesk } from "./desk-mount";

const KINDS = ["paper", "board", "photo", "notebook", "calendar"] as const;

describe("the kinds' registered wakes (K7a): nothing is polled at rest", () => {
  let desk: DeskMount;
  const ids: Record<string, Entity> = {};
  beforeAll(async () => {
    desk = await mountDesk();
    ids.note = desk.ce.ops.spawnWidget("desk.note", { x: 100, y: 100 });
    ids.board = desk.ce.ops.spawnWidget("desk.board", { x: 400, y: 100 });
    ids.print = desk.ce.ops.spawnWidget("desk.photo", { x: 700, y: 100 });
    ids.book = desk.ce.ops.spawnWidget("desk.notebook", { x: 300, y: 500 });
    ids.pad = desk.ce.ops.spawnWidget("desk.calendar", { x: 900, y: 500 });
  });
  afterAll(() => { desk?.dispose(); });
  const step = (): boolean => desk.step();
  const toSleep = (cap = 400): number => desk.toSleep(cap);
  const ticks = (): Record<string, number> => ({ ...desk.handle.perf().kindTicks });

  it("the desk drew its objects, then the loop sleeps; at rest a step asks no driver and ticks no kind", () => {
    expect(desk.handle.status().state).toBe("ready");
    expect(toSleep()).toBeLessThan(400);
    expect(desk.handle.redraws()).toBeGreaterThan(0);
    for (const k of KINDS) expect(ticks()[k] ?? 0, `${k} ticked while the desk was busy`).toBeGreaterThan(0);
    // the steps a sleeping loop takes when a registered time comes (or a stray one): SETTLED — each kind asked only if due
    const t0 = ticks();
    const asks0 = desk.handle.perf().driverAsks;
    for (let i = 0; i < 20; i++) {
      desk.ce.engine.step(performance.now());
      expect(desk.ce.engine.frame.settled()).toBe(true);
      desk.ce.engine.frame.nextStep(performance.now());
    }
    expect(ticks(), "no kind ticked at rest").toEqual(t0);
    expect(desk.handle.perf().driverAsks, "no driver asked at rest").toBe(asks0);
    // …and every kind says so itself: nothing due now
    const now = performance.now();
    const due = desk.handle.due(now);
    for (const k of KINDS) expect(due.kinds[k] ?? Number.NaN, `${k} due at rest`).toBeGreaterThan(now);
    expect(due.following).toEqual([]);
  });

  it("paper: a caret standing is due at its next blink — never before — and ticked there once", async () => {
    const writing = desk.handle.local("paper") as Writing;
    const t = performance.now();
    writing.caret(ids.note as Entity, 0, t);
    desk.ce.engine.frame.wake("editor");   // the note's editor wakes the loop with it (its DOM half's `wake`)
    expect(writing.due(performance.now())).toBeLessThanOrEqual(performance.now());   // the caret placed: a frame now
    step();
    const blink = writing.due(performance.now());
    expect(blink).toBeGreaterThan(performance.now());
    expect(blink - t).toBeLessThanOrEqual(530 + 1);
    toSleep();
    const before = ticks().paper ?? 0;
    // a settled step before the blink ticks nothing
    desk.ce.engine.step(performance.now());
    desk.ce.engine.frame.nextStep(performance.now());
    expect(ticks().paper ?? 0).toBe(before);
    await new Promise((r) => setTimeout(r, Math.max(0, blink - performance.now()) + 5));
    desk.ce.engine.step(performance.now());
    expect(desk.ce.engine.frame.settled()).toBe(true);
    expect(ticks().paper ?? 0).toBe(before + 1);
    writing.caret(undefined);
    step();
    expect(writing.due(performance.now())).toBe(Number.POSITIVE_INFINITY);
    toSleep();
  });

  it("board: a pen moving is due now; at rest never", () => {
    const ink = desk.handle.local("board") as BoardInk;
    ink.moving(ids.board as Entity);   // (the pen driver's word, inside a step it follows in)
    expect(ink.due(performance.now())).toBeLessThanOrEqual(performance.now());
    // its frame, then the one its draw's asks are answered in (the residency's step), then never
    let n = 0;
    while (ink.due(performance.now()) <= performance.now() && n < 10) { step(); n += 1; }
    expect(n).toBeLessThanOrEqual(3);
    expect(ink.due(performance.now())).toBe(Number.POSITIVE_INFINITY);
    toSleep();
  });

  it("photo: a print in a hand leads — due every frame until it rests — then never", () => {
    const prints = desk.handle.local("photo") as Prints;
    const t = performance.now() / 1000;
    prints.hold(ids.print as Entity, 700, 100, t);
    expect(prints.due(performance.now())).toBeLessThanOrEqual(performance.now());
    prints.drop(ids.print as Entity, t + 0.016);
    let n = 0;
    while (prints.due(performance.now()) <= performance.now() && n < 600) { step(); n += 1; }
    expect(n).toBeLessThan(600);
    expect(prints.due(performance.now())).toBe(Number.POSITIVE_INFINITY);
    toSleep();
  });

  it("notebook: its layer made, it is due to let it go LAYER_IDLE_MS after it was last drawn; a stir is due now", () => {
    const books = desk.handle.local("notebook") as Books;
    books.stir(ids.book as Entity);
    expect(books.due(performance.now())).toBeLessThanOrEqual(performance.now());
    toSleep();
    const at = books.due(performance.now());
    if (at !== Number.POSITIVE_INFINITY) {
      expect(at).toBeGreaterThan(performance.now());
      expect(at - performance.now()).toBeLessThanOrEqual(LAYER_IDLE_MS);
    }
  });

  it("calendar: a peek is due now; at rest only its layer's let-go or the day's turn at midnight", () => {
    const pads = desk.handle.local("calendar") as Pads;
    pads.peek(ids.pad as Entity, true);
    expect(pads.due(performance.now())).toBeLessThanOrEqual(performance.now());
    pads.peek(ids.pad as Entity, false);
    toSleep();
    const at = pads.due(performance.now());
    expect(at).toBeGreaterThan(performance.now());
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    expect(at - performance.now()).toBeLessThanOrEqual(Math.max(LAYER_IDLE_MS, midnight.getTime() - Date.now()) + 1000);
  });
});

describe("the tray's layers under the sleeping loop (K7a over K5a)", () => {
  let desk: DeskMount;
  beforeAll(async () => { desk = await mountDesk(); });
  afterAll(() => { desk?.dispose(); });

  it("the drawer shut, its notebook's and calendar's layers go at a registered TIME — the last tray draw + LAYER_IDLE_MS — never by a tick the sleeping loop no longer takes", async () => {
    expect(desk.toSleep()).toBeLessThan(400);
    expect(desk.handle.due(performance.now()).tray).toBe(Number.POSITIVE_INFINITY);   // nothing drawn in the tray: nothing to let go
    // the drawer's slide runs on the clock (340 ms): stepped while it moves, its composite specimens asking their slots' passes made —
    // which land between frames (their pipelines are made asynchronously)
    const slide = async (): Promise<void> => { const end = performance.now() + 500; while (performance.now() < end) { desk.step(); await new Promise((r) => setTimeout(r, 8)); } };
    openTray(desk.ce.world);
    expect(desk.step()).toBe(false);   // the drawer on its way keeps the reflector's frame owed (`tray.live()`): due now, no sleep mid-slide
    await slide();
    expect(desk.toSleep()).toBeLessThan(400);   // the drawer out, its specimens drawn through their own slots' passes, at rest
    expect(desk.handle.tray.state().specimens.map((q) => q.type)).toEqual(expect.arrayContaining(["desk.notebook", "desk.calendar"]));
    closeTray(desk.ce.world);
    await slide();
    expect(desk.toSleep()).toBeLessThan(400);   // shut, at rest: the loop sleeps…
    const shut = performance.now();
    const due = desk.handle.due(shut);
    // …until the tray's layers are due to go — the desk's only registered time (nothing on the desk)
    expect(due.tray).toBeGreaterThan(shut);
    expect(due.tray - shut).toBeLessThanOrEqual(LAYER_IDLE_MS);
    expect(due.at).toBe(due.tray);
    // at that time one step lets them go, and nothing is due after
    await new Promise((r) => setTimeout(r, due.tray - performance.now() + 20));
    desk.step();
    expect(desk.handle.due(performance.now()).tray).toBe(Number.POSITIVE_INFINITY);
    expect(desk.handle.due(performance.now()).at).toBe(Number.POSITIVE_INFINITY);
  }, 20_000);
});
