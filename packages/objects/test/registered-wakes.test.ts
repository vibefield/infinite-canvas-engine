// THE REGISTERED WAKES (K7a — design-016 §6, design-015 §2.4 idle-zero): each kind says when it is next live (`KindLocal.due`) and
// a desk at rest asks none of them. Mounted as a host mounts it — the desk layer on a fake device over an engine with the six
// objects, the engine's frame gate handed in — and stepped as the SLEEPING loop steps it (a step, then `nextStep`). The counters are
// the layer's own (`perf().kindTicks`, `driverAsks`): a step a registered time alone starts (`frame.settled()`) asks no driver and
// ticks no kind but one due; and each kind's `due` answers now while it moves, a time when it has one, never at rest.

import { createCanvasEngine, type Entity, Viewport } from "@ice/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { deskLayer, type DeskLayerHandle } from "@ice/desk";
import { LAYER_IDLE_MS } from "@ice/desk/kit";
import { DESK_ENGINE, DESK_OBJECTS, deskPalette, deskTheme } from "../src";
import type { BoardInk } from "../src/board/kind";
import type { Pads } from "../src/calendar/kind";
import type { Books } from "../src/notebook/kind";
import type { Writing } from "../src/paper/writing";
import type { Prints } from "../src/photo/kind";
import { fakeDevice, installGpuFlags } from "../../desk/test/fake-gpu";
import { fakePage } from "../../desk/test/fake-page";

function fakeHost() {
  const { device } = fakeDevice();
  Object.assign(device, { addEventListener: () => {}, lost: new Promise(() => {}), destroy: () => {} });
  const adapter = { features: new Set<string>(), requestDevice: async () => device };
  const gpu = { requestAdapter: async () => adapter, getPreferredCanvasFormat: () => "bgra8unorm" } as unknown as GPU;
  const context = { configure: () => {}, unconfigure: () => {}, getCurrentTexture: () => ({ createView: () => ({ label: "swap" }), width: 1, height: 1 }) };
  const canvas = { style: {}, width: 1, height: 1, clientWidth: 1, clientHeight: 1, getContext: () => context, remove: () => {} };
  // the objects' DOM halves mount too (the note's editor, the calendar's days): the page's elements take anything (fake-page.ts)
  const page = fakePage();
  const doc = page.container.ownerDocument as unknown as { createElement(tag: string): unknown };
  const make = doc.createElement.bind(doc);
  (doc as { createElement(tag: string): unknown }).createElement = (tag: string) => (tag === "canvas" ? canvas : make(tag));
  return { gpu, container: page.container as unknown as HTMLElement };
}

const KINDS = ["paper", "board", "photo", "notebook", "calendar"] as const;

describe("the kinds' registered wakes (K7a): nothing is polled at rest", () => {
  const undo: (() => void)[] = [];
  let ce: ReturnType<typeof createCanvasEngine>;
  let handle: DeskLayerHandle;
  const ids: Record<string, Entity> = {};
  beforeAll(async () => {
    undo.push(installGpuFlags());
    const { gpu, container } = fakeHost();
    vi.stubGlobal("navigator", { gpu });
    undo.push(() => vi.unstubAllGlobals());
    ce = createCanvasEngine(DESK_ENGINE);
    ce.docs.create();
    ce.world.setResource(Viewport, { w: 1200, h: 800, dpr: 1 });
    handle = deskLayer({ gpu, theme: deskTheme("light"), palette: deskPalette("light"), objects: [...DESK_OBJECTS], docs: ce.docs })({ host: { container }, world: ce.world, frame: ce.engine.frame, catalog: ce.catalog });
    undo.push(ce.engine.registerReflector(handle.reflector));
    for (let i = 0; i < 100 && handle.status().state === "pending"; i++) await new Promise((r) => setTimeout(r, 5));
    ids.note = ce.ops.spawnWidget("desk.note", { x: 100, y: 100 });
    ids.board = ce.ops.spawnWidget("desk.board", { x: 400, y: 100 });
    ids.print = ce.ops.spawnWidget("desk.photo", { x: 700, y: 100 });
    ids.book = ce.ops.spawnWidget("desk.notebook", { x: 300, y: 500 });
    ids.pad = ce.ops.spawnWidget("desk.calendar", { x: 900, y: 500 });
  });
  afterAll(() => { handle?.dispose(); ce?.dispose(); for (const u of undo.splice(0).reverse()) u(); });

  /** One step as the sleeping loop takes it; true when the gate then says sleep. */
  const step = (): boolean => {
    ce.engine.step(performance.now());
    const t = performance.now();
    return ce.engine.frame.nextStep(t) > t;
  };
  /** Steps until the gate says sleep; how many it took. */
  const toSleep = (cap = 400): number => { for (let n = 1; n <= cap; n++) if (step()) return n; return cap + 1; };
  const ticks = (): Record<string, number> => ({ ...handle.perf().kindTicks });

  it("the desk drew its objects, then the loop sleeps; at rest a step asks no driver and ticks no kind", () => {
    expect(handle.status().state).toBe("ready");
    expect(toSleep()).toBeLessThan(400);
    expect(handle.redraws()).toBeGreaterThan(0);
    for (const k of KINDS) expect(ticks()[k] ?? 0, `${k} ticked while the desk was busy`).toBeGreaterThan(0);
    // the steps a sleeping loop takes when a registered time comes (or a stray one): SETTLED — each kind asked only if due
    const t0 = ticks();
    const asks0 = handle.perf().driverAsks;
    for (let i = 0; i < 20; i++) {
      ce.engine.step(performance.now());
      expect(ce.engine.frame.settled()).toBe(true);
      ce.engine.frame.nextStep(performance.now());
    }
    expect(ticks(), "no kind ticked at rest").toEqual(t0);
    expect(handle.perf().driverAsks, "no driver asked at rest").toBe(asks0);
    // …and every kind says so itself: nothing due now
    const now = performance.now();
    const due = handle.due(now);
    for (const k of KINDS) expect(due.kinds[k] ?? Number.NaN, `${k} due at rest`).toBeGreaterThan(now);
    expect(due.following).toEqual([]);
  });

  it("paper: a caret standing is due at its next blink — never before — and ticked there once", async () => {
    const writing = handle.local("paper") as Writing;
    const t = performance.now();
    writing.caret(ids.note as Entity, 0, t);
    ce.engine.frame.wake("editor");   // the note's editor wakes the loop with it (its DOM half's `wake`)
    expect(writing.due(performance.now())).toBeLessThanOrEqual(performance.now());   // the caret placed: a frame now
    step();
    const blink = writing.due(performance.now());
    expect(blink).toBeGreaterThan(performance.now());
    expect(blink - t).toBeLessThanOrEqual(530 + 1);
    toSleep();
    const before = ticks().paper ?? 0;
    // a settled step before the blink ticks nothing
    ce.engine.step(performance.now());
    ce.engine.frame.nextStep(performance.now());
    expect(ticks().paper ?? 0).toBe(before);
    await new Promise((r) => setTimeout(r, Math.max(0, blink - performance.now()) + 5));
    ce.engine.step(performance.now());
    expect(ce.engine.frame.settled()).toBe(true);
    expect(ticks().paper ?? 0).toBe(before + 1);
    writing.caret(undefined);
    step();
    expect(writing.due(performance.now())).toBe(Number.POSITIVE_INFINITY);
    toSleep();
  });

  it("board: a pen moving is due now; at rest never", () => {
    const ink = handle.local("board") as BoardInk;
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
    const prints = handle.local("photo") as Prints;
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
    const books = handle.local("notebook") as Books;
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
    const pads = handle.local("calendar") as Pads;
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
