/**
 * The free slot at scale (petition I57): what one ask costs when something is placed.
 *
 * A board of N objects — 180 × 120 on a 240 × 170 pitch, so no 200 × 100 newcomer fits between two of them with the
 * 24 gutter — in a 1600 × 1000 view at zoom 1 over the field's middle. Four asks per board:
 *
 *   free      a clearing at the view's middle: the anchor itself answers (the first object a tool places).
 *   beside    the same clearing with one object where the newcomer wants to be: the nearest side of it.
 *   crowded   no clearing: nothing free within the default reach (one view, one newcomer, the gutter) → undefined.
 *             Every column within the reach is read: the worst the default reach allows.
 *   wide      no clearing, and a reach past the whole field: the slot is at the field's edge. Every incumbent is
 *             within the reach — the kernel's worst case in n.
 *
 * Two tables. THE KERNEL (`freeSlot` over plain rectangles) at 100, 1,000 and 10,000 incumbents: the search alone.
 * THE WORLD'S READER (`resolveFreeSlot` on the real facade — createCanvasEngine, a document, the objects hung on the
 * board as a spawn hangs them) at 100 and 1,000: the search plus one walk of the frame's children, O(N) whatever the
 * reach. The reader's boards stop at 1,000 because SEEDING one is the cost there, not the ask: it grows faster than
 * N (the last column), and a first form of this file, with three boards of 10,000 alive at once, died of a 4 GB heap
 * six minutes in (2026-11-24; where the heap went was not measured). `BENCH_SLOT_BOARDS=100,1000,…` names other boards.
 *
 * `within` is how many incumbents can block a position within the reach, and so reach the search. Medians over
 * ROUNDS asks (7 at 10,000), µs.
 *
 * Guarded by BENCH=1 (package.json "bench" script) — real timed work, not a correctness test.
 */
import os from "node:os";
import { freeSlot, type LayoutRect } from "@ice/kernel";
import { describe, expect, it } from "vitest";
import { Camera, Viewport, attachSpawnParent, createCanvasEngine, defineWidget, resolveFreeSlot, widgets } from "../src";
import type { CanvasEngine } from "../src";
import { guardedTransaction } from "../src/guards/guarded-tx";
import { widgetSpawnInits } from "../src/widget/spawn";

const Card = widgets.get("bench-slot-card") ?? defineWidget({ type: "bench-slot-card", defaultSize: { w: 180, h: 120 } });

const SIZE = { w: 200, h: 100 };
const CARD = { w: 180, h: 120 };
const GUTTER = 24;
const VP = { w: 1600, h: 1000, dpr: 1 };
const PITCH = { x: 240, y: 170 };
const REACH_DEFAULT = Math.max(VP.w, VP.h) + Math.max(SIZE.w, SIZE.h) + GUTTER;

interface Field {
  readonly rects: readonly LayoutRect[];
  readonly mid: { readonly x: number; readonly y: number };
  readonly span: number;
  readonly view: LayoutRect;
}

/** N cards on the lattice, less those within `clearing` of the field's middle; `under` adds one at the middle. */
function field(n: number, clearing: number, under: boolean): Field {
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const mid = { x: (cols * PITCH.x) / 2, y: (rows * PITCH.y) / 2 };
  const rects: LayoutRect[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i % cols) * PITCH.x;
    const y = Math.floor(i / cols) * PITCH.y;
    if (Math.abs(x + CARD.w / 2 - mid.x) < clearing && Math.abs(y + CARD.h / 2 - mid.y) < clearing) continue;
    rects.push({ x, y, ...CARD });
  }
  if (under) rects.push({ x: mid.x - CARD.w / 2, y: mid.y - CARD.h / 2, ...CARD });
  return { rects, mid, span: Math.max(cols * PITCH.x, rows * PITCH.y), view: { x: mid.x - VP.w / 2, y: mid.y - VP.h / 2, w: VP.w, h: VP.h } };
}

/** The field as a real board: every card spawned and hung on the board root, one transaction, as a batch seed does. */
function board(f: Field): { ce: CanvasEngine; seedMs: number } {
  const ce = createCanvasEngine({ widgets: [Card] });
  const session = ce.docs.create();
  ce.world.setResource(Viewport, VP);
  ce.world.setResource(Camera, { x: f.view.x, y: f.view.y, zoom: 1, gesturing: false });
  const t0 = performance.now();
  guardedTransaction(
    session.store,
    ce.world,
    (tx) => {
      for (const r of f.rects) {
        const { prefab, overrides } = widgetSpawnInits(Card.type, { x: r.x, y: r.y });
        attachSpawnParent(tx, ce.world, tx.spawnPrefab(prefab, overrides));
      }
    },
    { undoable: false },
  );
  ce.world.sync();
  ce.step(16);
  return { ce, seedMs: performance.now() - t0 };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] as number;
}

/** Median µs of one ask, and its answer (the same every round: asserted). */
function time(rounds: number, ask: () => { readonly where: string } | undefined): { us: number; where: string } {
  const first = ask();
  for (let i = 0; i < 3; i++) ask(); // warm
  const samples: number[] = [];
  for (let i = 0; i < rounds; i++) {
    const t0 = performance.now();
    const slot = ask();
    samples.push((performance.now() - t0) * 1000);
    expect(slot).toEqual(first);
  }
  return { us: median(samples), where: first === undefined ? "none" : first.where };
}

/** How many of the field's cards can block a position within `reach` of the anchored one (what reaches the search). */
function within(f: Field, reach: number): number {
  const ax = f.mid.x - SIZE.w / 2;
  const ay = f.mid.y - SIZE.h / 2;
  let k = 0;
  for (const r of f.rects) {
    if (r.x - GUTTER - SIZE.w < ax + reach && r.x + r.w + GUTTER > ax - reach && r.y - GUTTER - SIZE.h < ay + reach && r.y + r.h + GUTTER > ay - reach) k += 1;
  }
  return k;
}

const cell = (t: { us: number; where: string }): string => `${t.us.toFixed(0).padStart(8)} ${t.where.padEnd(6)}`;

describe("the free slot at scale (BENCH=1 only)", () => {
  it.runIf(process.env.BENCH === "1")(
    "one ask of the kernel at 100, 1,000 and 10,000 incumbents; of the world's reader on boards of 100 and 1,000",
    () => {
      console.log(`\nfree-slot (µs, the median ask; load ${os.loadavg()[0]?.toFixed(1)}; node ${process.version})`);
      console.log("freeSlot, the kernel alone:\n  incumbents |    free µs      |  beside µs      | crowded µs (default reach)       |    wide µs (reach past the field)");
      for (const n of [100, 1_000, 10_000]) {
        const rounds = n > 1_000 ? 7 : 31;
        const open = field(n, 420, false);
        const beside = field(n, 420, true);
        const crowded = field(n, 0, false);
        const ask = (f: Field, reach: number) => () => freeSlot(f.rects, SIZE, { anchor: f.mid, gutter: GUTTER, reach, view: f.view });
        const a = time(rounds, ask(open, REACH_DEFAULT));
        const b = time(rounds, ask(beside, REACH_DEFAULT));
        const c = time(rounds, ask(crowded, REACH_DEFAULT));
        const d = time(rounds, ask(crowded, crowded.span));
        expect(a.where).toBe("anchor");
        expect(b.where).toBe("view");
        console.log(
          `  ${String(n).padStart(10)} | ${cell(a)} | ${cell(b)} | ${cell(c)} (${String(within(crowded, REACH_DEFAULT)).padStart(5)} within) | ${cell(d)} (${String(within(crowded, crowded.span)).padStart(5)} within)`,
        );
      }

      const boards = (process.env.BENCH_SLOT_BOARDS ?? "100,1000").split(",").map(Number);
      console.log("resolveFreeSlot, the world's reader on a real board:\n     objects |    free µs      |  beside µs      | crowded µs (default reach)       |    wide µs (reach past the field) | seeding one board, ms");
      for (const n of boards) {
        const cells: string[] = [];
        let seedMs = 0;
        // one board at a time: seeded, asked, disposed
        for (const [f, reach] of [
          [field(n, 420, false), undefined],
          [field(n, 420, true), undefined],
          [field(n, 0, false), undefined],
          [field(n, 0, false), -1],
        ] as const) {
          const { ce, seedMs: ms } = board(f);
          seedMs = Math.max(seedMs, ms);
          cells.push(cell(time(31, () => resolveFreeSlot(ce.world, SIZE, reach === undefined ? {} : { reach: f.span }))));
          ce.dispose();
        }
        console.log(`  ${String(n).padStart(10)} | ${cells[0]} | ${cells[1]} | ${cells[2]}                | ${cells[3]}                | ${seedMs.toFixed(0)}`);
      }
    },
    600_000,
  );
});
