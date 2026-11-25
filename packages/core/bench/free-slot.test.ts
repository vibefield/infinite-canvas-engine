/**
 * resolveFreeSlot at scale (petition I57): what one ask costs when something is placed.
 *
 * On the REAL facade (createCanvasEngine, a document, the objects spawned through a transaction as a batch seed
 * does), a board of N objects — 180 × 120 on a 240 × 170 pitch, so no 200 × 100 newcomer fits between two of them
 * with the 24 gutter — in a 1600 × 1000 view at zoom 1 over the field's middle. Four asks per board:
 *
 *   free      a clearing at the view's middle: the anchor itself answers (the first object an agent places).
 *   beside    the same clearing with one object where the newcomer wants to be: the nearest side of it.
 *   crowded   no clearing: nothing free within the default reach (one view, one newcomer, the gutter) → undefined.
 *             Every column within the reach is read: the worst the default reach allows.
 *   wide      no clearing, and a reach past the whole field: the slot is at the field's edge. Every incumbent is
 *             within the reach — the kernel's worst case in n.
 *
 * The ask walks the frame's children once (O(N)) whatever the reach; `within` is how many of them can block a
 * position within the reach and so reach the kernel. Medians over ROUNDS asks, µs.
 *
 * Guarded by BENCH=1 (package.json "bench" script) — real timed work, not a correctness test. Numbers are recorded
 * in docs/benchmarks.md with the host's load beside them.
 */
import os from "node:os";
import { describe, expect, it } from "vitest";
import { Camera, Viewport, attachSpawnParent, createCanvasEngine, defineWidget, resolveFreeSlot, widgets } from "../src";
import type { CanvasEngine } from "../src";
import { guardedTransaction } from "../src/guards/guarded-tx";
import { widgetSpawnInits } from "../src/widget/spawn";

const Card = widgets.get("bench-slot-card") ?? defineWidget({ type: "bench-slot-card", defaultSize: { w: 180, h: 120 } });

const SIZE = { w: 200, h: 100 };
const VP = { w: 1600, h: 1000, dpr: 1 };
const PITCH = { x: 240, y: 170 };
const ROUNDS = 31;

interface Board {
  readonly ce: CanvasEngine;
  readonly n: number;
  readonly mid: { readonly x: number; readonly y: number };
  readonly span: number;
}

/** N cards on the lattice, less those within `clearing` of the field's middle; `under` adds one at the middle. */
function seed(n: number, clearing: number, under: boolean): Board {
  const ce = createCanvasEngine({ widgets: [Card] });
  const session = ce.docs.create();
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const mid = { x: (cols * PITCH.x) / 2, y: (rows * PITCH.y) / 2 };
  ce.world.setResource(Viewport, VP);
  ce.world.setResource(Camera, { x: mid.x - VP.w / 2, y: mid.y - VP.h / 2, zoom: 1, gesturing: false });
  let made = 0;
  guardedTransaction(
    session.store,
    ce.world,
    (tx) => {
      const spawnOne = (x: number, y: number): void => {
        const { prefab, overrides } = widgetSpawnInits(Card.type, { x, y });
        attachSpawnParent(tx, ce.world, tx.spawnPrefab(prefab, overrides));
        made += 1;
      };
      for (let i = 0; i < n; i++) {
        const x = (i % cols) * PITCH.x;
        const y = Math.floor(i / cols) * PITCH.y;
        if (Math.abs(x + 90 - mid.x) < clearing && Math.abs(y + 60 - mid.y) < clearing) continue;
        spawnOne(x, y);
      }
      if (under) spawnOne(mid.x - 90, mid.y - 60);
    },
    { undoable: false },
  );
  ce.world.sync();
  ce.step(16);
  return { ce, n: made, mid, span: Math.max(cols * PITCH.x, rows * PITCH.y) };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] as number;
}

/** Median µs of one ask, and its answer (the same every round: asserted). */
function time(board: Board, reach?: number): { us: number; where: string } {
  const ask = () => resolveFreeSlot(board.ce.world, SIZE, reach === undefined ? {} : { reach });
  const first = ask();
  for (let i = 0; i < 5; i++) ask(); // warm
  const samples: number[] = [];
  for (let i = 0; i < ROUNDS; i++) {
    const t0 = performance.now();
    const slot = ask();
    samples.push((performance.now() - t0) * 1000);
    expect(slot).toEqual(first);
  }
  return { us: median(samples), where: first === undefined ? "none" : first.where };
}

/** How many of the board's cards can block a position within `reach` of the anchored one (what reaches the kernel). */
function within(board: Board, reach: number, cards: number): number {
  const cols = Math.ceil(Math.sqrt(cards));
  const ax = board.mid.x - SIZE.w / 2;
  const ay = board.mid.y - SIZE.h / 2;
  let k = 0;
  for (let i = 0; i < cards; i++) {
    const x = (i % cols) * PITCH.x;
    const y = Math.floor(i / cols) * PITCH.y;
    if (x - 24 - SIZE.w < ax + reach && x + 180 + 24 > ax - reach && y - 24 - SIZE.h < ay + reach && y + 120 + 24 > ay - reach) k += 1;
  }
  return k;
}

describe("resolveFreeSlot at scale (BENCH=1 only)", () => {
  it.runIf(process.env.BENCH === "1")(
    "one ask on a board of 100, 1,000 and 10,000 objects",
    () => {
      const lines: string[] = [];
      for (const n of [100, 1_000, 10_000]) {
        const free = seed(n, 420, false);
        const beside = seed(n, 420, true);
        const crowded = seed(n, 0, false);
        const reachDefault = Math.max(VP.w, VP.h) + Math.max(SIZE.w, SIZE.h) + 24;
        const a = time(free);
        const b = time(beside);
        const c = time(crowded);
        const d = time(crowded, crowded.span);
        expect(a.where).toBe("anchor");
        expect(b.where).toBe("view");
        lines.push(
          `  ${String(n).padStart(6)} | ${a.us.toFixed(0).padStart(7)} ${a.where.padEnd(6)} | ${b.us.toFixed(0).padStart(7)} ${b.where.padEnd(6)} | ${c.us.toFixed(0).padStart(8)} ${c.where.padEnd(6)} (${String(within(crowded, reachDefault, n)).padStart(5)} within) | ${d.us.toFixed(0).padStart(8)} ${d.where.padEnd(6)} (${String(within(crowded, crowded.span, n)).padStart(5)} within)`,
        );
        free.ce.dispose();
        beside.ce.dispose();
        crowded.ce.dispose();
      }
      console.log(`
free-slot (µs = median of ${ROUNDS} asks; load ${os.loadavg()[0]?.toFixed(1)}; node ${process.version}):
  objects |   free µs        | beside µs        | crowded µs (default reach)        | wide µs (reach past the field)
${lines.join("\n")}
`);
    },
    600_000,
  );
});
