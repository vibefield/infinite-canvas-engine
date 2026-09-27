// @vitest-environment node
// THE FRAME'S RASTER QUEUE (K6b, design-016 §6) — the kinds' re-rasters under one budget a frame. Pinned: a turn runs the asks
// lowest priority first (equal priorities first come, first served — a re-ask keeps its place); it starts a run only while the
// ms spent plus the owner's measured cost of a run fits the budget, and the turn's first always runs; an ask whose object was not
// drawn is let go unrun; a run that finds no room is HELD out of the count that keeps the desk awake — its owner's later asks of
// the turn with it, unrun — until its owner wakes it or a drawn frame wakes them all; a re-ask replaces the ask (a run that re-asks
// its own key keeps the newer need); drop and clear withdraw.
import type { Entity } from "@ice/core";
import { describe, expect, it } from "vitest";
import { createRasterQueue, type RasterRun } from "../src/engine/rasters";

const E = (n: number) => n as Entity;

/** A clock the runs move: each run costs what it is told. */
function fakeClock() {
  let t = 0;
  return { now: () => t, spend: (ms: number) => { t += ms; } };
}

describe("the frame's raster queue (K6b)", () => {
  it("a turn runs lowest priority first, equal priorities in the order they came; a re-ask keeps its place and takes its new priority", () => {
    const ran: number[] = [];
    const q = createRasterQueue({ budgetMs: 1e9 });
    const run = (n: number): RasterRun => () => { ran.push(n); return "done"; };
    q.ask("paper", E(1), 30, run(1));
    q.ask("paper", E(2), 10, run(2));
    q.ask("board", E(3), 20, run(3));
    q.ask("paper", E(4), 20, run(4));
    q.ask("paper", E(1), 20, run(1));   // re-asked: priority 20, and it came FIRST among the 20s
    expect(q.size).toBe(4);
    expect(q.drain()).toBe(4);
    expect(ran).toEqual([2, 1, 3, 4]);
    expect(q.size).toBe(0);
    expect(q.drain()).toBe(0);
  });

  it("THE BUDGET: a run starts only while the ms spent plus its owner's measured cost fits; the turn's first always runs, so every ask is served", () => {
    const c = fakeClock();
    const q = createRasterQueue({ budgetMs: 4, clock: c.now });
    const ran: number[] = [];
    const costly = (n: number, ms: number): RasterRun => () => { c.spend(ms); ran.push(n); return "done"; };
    for (let i = 1; i <= 6; i++) q.ask("paper", E(i), i, costly(i, 1.5));
    // no cost known: 1 runs (1.5); 1.5 + 1.5 ≤ 4: 2 runs (3.0); 3.0 + 1.5 > 4: the turn ends
    expect(q.drain()).toBe(2);
    expect(ran).toEqual([1, 2]);
    expect(q.drain()).toBe(2);
    expect(q.drain()).toBe(2);
    expect(ran).toEqual([1, 2, 3, 4, 5, 6]);
    // one ask dearer than the whole budget still runs — alone, first in its turn
    q.ask("paper", E(7), 0, costly(7, 9));
    q.ask("paper", E(8), 1, costly(8, 9));
    expect(q.drain()).toBe(1);
    expect(q.drain()).toBe(1);
    expect(q.stats()).toMatchObject({ ran: 8, turns: 5, peakRuns: 2, peakMs: 9, waiting: 0 });
  });

  it("an ask whose object the last build did not draw is let go unrun — out of the budget; it asks again when it is drawn", () => {
    const shown = new Set([1, 3]);
    const ran: number[] = [];
    const q = createRasterQueue({ budgetMs: 1e9, shows: (e) => shown.has(e as number) });
    for (const n of [1, 2, 3]) q.ask("paper", E(n), n, () => { ran.push(n); return "done"; });
    expect(q.drain()).toBe(2);
    expect(ran).toEqual([1, 3]);
    expect(q.stats()).toMatchObject({ dropped: 1, waiting: 0 });
    expect(q.has("paper", E(2))).toBe(false);
  });

  it("no room: the run WAITS — held out of the size (the desk may idle) until its owner wakes it; another owner's wake leaves it held", () => {
    let room = false;
    const q = createRasterQueue({ budgetMs: 1e9 });
    q.ask("paper", E(1), 0, () => (room ? "done" : "wait"));
    expect(q.drain()).toBe(1);
    expect(q.size).toBe(0);
    expect(q.stats()).toMatchObject({ waiting: 0, held: 1 });
    expect(q.drain()).toBe(0);   // held: not run again
    q.wake("board");
    expect(q.size).toBe(0);
    room = true;
    q.wake("paper");
    expect(q.size).toBe(1);
    expect(q.drain()).toBe(1);
    expect(q.stats()).toMatchObject({ waiting: 0, held: 0 });
    // a held ask asked again waits again at once
    q.ask("paper", E(2), 0, () => "wait");
    q.drain();
    q.ask("paper", E(2), 0, () => "done");
    expect(q.size).toBe(1);
  });

  it("a run that finds no room holds its owner's LATER asks of the turn unrun (the pages are as full for them), never another owner's; a drawn frame (`wake()`) wakes every held ask", () => {
    const ran: string[] = [];
    let room = false;
    const q = createRasterQueue({ budgetMs: 1e9 });
    const paper = (n: number): RasterRun => () => { ran.push(`p${n}`); return room ? "done" : "wait"; };
    q.ask("paper", E(1), 0, paper(1));
    q.ask("board", E(2), 1, () => { ran.push("b2"); return "done"; });
    q.ask("paper", E(3), 2, paper(3));
    q.ask("paper", E(4), 3, paper(4));
    expect(q.drain()).toBe(2);
    expect(ran).toEqual(["p1", "b2"]);   // p3, p4 held unrun behind p1's no-room
    expect(q.stats()).toMatchObject({ waiting: 0, held: 3 });
    expect(q.drain()).toBe(0);
    room = true;
    q.wake();
    expect(q.size).toBe(3);
    expect(q.drain()).toBe(3);
    expect(ran).toEqual(["p1", "b2", "p1", "p3", "p4"]);
  });

  it("a run that asks again for its own key keeps the NEWER need; drop and clear withdraw", () => {
    const q = createRasterQueue({ budgetMs: 1e9 });
    const again: RasterRun = () => "done";
    q.ask("paper", E(1), 0, () => { q.ask("paper", E(1), 5, again); return "done"; });
    expect(q.drain()).toBe(1);
    expect(q.has("paper", E(1))).toBe(true);
    expect(q.size).toBe(1);
    q.drop("paper", E(1));
    expect(q.size).toBe(0);
    q.ask("paper", E(1), 0, again);
    q.ask("board", E(2), 0, again);
    q.clear("paper");
    expect([q.has("paper", E(1)), q.has("board", E(2)), q.size]).toEqual([false, true, 1]);
    q.clear();
    expect(q.size).toBe(0);
  });
});
