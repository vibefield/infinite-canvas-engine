// THE FRAME'S RASTER QUEUE (K6b, design-016 §6 — "re-rasters capped per frame; the old raster stands meanwhile"). A kind whose
// objects keep a raster as a cache of their data makes it again when the zoom asks another density (a note's ink at a new band, a
// board's strokes at a new density) and when an object comes on screen holding none. Done in the frame that asked, a zoom across
// a rung re-rastered every object near the view in ONE frame — the stall design-016 §1.3 measured (193 ms: 108 notes in a frame).
// Instead the kind ASKS here and keeps drawing what it has (its old raster, scaled; a thumbnail; blank paper); the host gives the
// queue its turn once a tick, BEFORE the build (a raster laid and its record remade reach the same frame): the asks run lowest
// priority first while the frame's budget lasts — a run starts only while the ms spent this turn plus its owner's measured cost of
// a run fits `budgetMs`, and the turn's first always runs, so every ask is served in finitely many frames. An ask whose object was
// not drawn in the last build is let go unrun (it asks again when it is). A run that finds no room is HELD, out of the count that
// keeps the desk awake — and so are its owner's later asks of that turn, unrun (the pages are as full for them) — until room may
// have been made: its owner let a raster go (`wake(owner)`), or the host drew a frame (`wake()` — what is drawn moved, and a
// raster no longer drawn may be evicted). The desk idles at zero submits with asks held. Nothing here touches the device: the
// runs do.

import type { Entity } from "@ice/core";

/** What a run says: `done` — the raster is laid (or no longer owed); `wait` — no room for it now: held until its owner `wake`s. */
export type RasterRun = () => "done" | "wait";

export interface RasterQueueStats {
  /** Asks waiting for their turn, and those held for room. */
  readonly waiting: number;
  readonly held: number;
  /** Runs since the queue was made, the turns that ran any, and their ms. */
  readonly ran: number;
  readonly turns: number;
  readonly ms: number;
  /** Asks let go unrun: their object was not drawn when their turn came. */
  readonly dropped: number;
  /** The most runs one turn made, and the most ms one turn spent. */
  readonly peakRuns: number;
  readonly peakMs: number;
}

export interface RasterQueue {
  /** The frame's budget, ms (the turn's first run excepted). */
  readonly budgetMs: number;
  /**
   * Ask for `owner`'s raster of `key` (a kind and its object): `priority` orders the turn (lower first — a kind puts what shows
   * nothing before what shows a stand-in, and the nearest the view's centre first); `run` lays it when its turn comes. A second ask
   * for the same key replaces the first — its priority and its run, and a held ask is waiting again.
   */
  ask(owner: string, key: Entity, priority: number, run: RasterRun): void;
  /** The ask is withdrawn: the object's need went away before its turn (the zoom came back to the band it holds), or it left. */
  drop(owner: string, key: Entity): void;
  has(owner: string, key: Entity): boolean;
  /** Room may have been made — `owner` let a raster go, or (no owner) the host drew a frame: the held asks wait for their turn again. */
  wake(owner?: string): void;
  /** Every ask of `owner` withdrawn (its state reset), or every ask. */
  clear(owner?: string): void;
  /** The host's turn, once a tick before the build: the runs, lowest priority first, while the budget lasts. Returns how many ran. */
  drain(): number;
  /** Asks waiting for their turn — the host keeps the desk awake while there are any (held asks are not counted). */
  readonly size: number;
  stats(): RasterQueueStats;
}

export interface RasterQueueOptions {
  /** The frame's budget, ms (default `RASTER_BUDGET_MS`). */
  readonly budgetMs?: number;
  /** The clock the budget is kept on (default `performance.now`). */
  readonly clock?: () => number;
  /** Was the object drawn in the last build (the builder's word, `DeskBuilder.shows`)? Absent: every ask is run. */
  readonly shows?: (key: Entity) => boolean;
}

/**
 * The frame's raster budget, ms: a zoom's frame keeps its other work (≈ 1 ms of JS on the stress desk) inside design-016 §6's
 * 8 ms with a raster's worth to spare — a note's ink at band 2 costs ≈ 2 ms on this Mac, and the turn's first always runs.
 */
export const RASTER_BUDGET_MS = 4;

/**
 * What an object shows while its raster waits its turn (K6b): NOTHING (a blank sheet, a bare board), its old raster MAGNIFIED (a
 * band or a density short of the screen's — soft), or its old raster MINIFIED (past it — only the pages' room is at stake).
 */
export type RasterWait = "nothing" | "magnified" | "minified";

const TIERS: Readonly<Record<RasterWait, number>> = { nothing: 0, magnified: 1, minified: 2 };

/**
 * The priority every kind asks with, so one turn orders them all alike (K6b): what shows nothing first, then a stand-in magnified,
 * then one minified — the nearest the view's centre (`px`, screen px) first within each.
 */
export function rasterPriority(shows: RasterWait, px: number): number {
  return TIERS[shows] * 1e7 + Math.min(Math.max(px, 0), 1e7 - 1);
}

interface Ask {
  readonly owner: string;
  readonly key: Entity;
  readonly priority: number;
  readonly run: RasterRun;
  held: boolean;
  /** Its order of arrival (kept across re-asks): equal priorities run first come, first served. */
  readonly seq: number;
}

const id = (owner: string, key: Entity): string => `${owner}\u0000${key as number}`;

export function createRasterQueue(opts: RasterQueueOptions = {}): RasterQueue {
  const budgetMs = opts.budgetMs ?? RASTER_BUDGET_MS;
  const clock = opts.clock ?? (() => performance.now());
  const shows = opts.shows;
  const asks = new Map<string, Ask>();
  /** Each owner's measured ms a run — its runs' running mean and its last run's; unknown before its first. */
  const cost = new Map<string, { mean: number; last: number }>();
  /** What the next run of `owner` is expected to cost: the dearer of its mean and its last (a raster's cost jumps with its band). */
  const expect = (owner: string): number => { const c = cost.get(owner); return c === undefined ? 0 : Math.max(c.mean, c.last); };
  let waiting = 0;
  let seq = 0;
  let ran = 0;
  let turns = 0;
  let ms = 0;
  let dropped = 0;
  let peakRuns = 0;
  let peakMs = 0;
  const remove = (k: string, a: Ask): void => { asks.delete(k); if (!a.held) waiting -= 1; };
  return {
    budgetMs,
    ask(owner, key, priority, run) {
      const k = id(owner, key);
      const had = asks.get(k);
      // a new entry, never the old one changed: a turn running the old one sees it replaced and keeps the newer need
      asks.set(k, { owner, key, priority, run, held: false, seq: had?.seq ?? seq++ });
      if (had === undefined || had.held) waiting += 1;
    },
    drop(owner, key) {
      const k = id(owner, key);
      const a = asks.get(k);
      if (a !== undefined) remove(k, a);
    },
    has: (owner, key) => asks.has(id(owner, key)),
    wake(owner) {
      for (const a of asks.values()) if (a.held && (owner === undefined || a.owner === owner)) { a.held = false; waiting += 1; }
    },
    clear(owner) {
      for (const [k, a] of asks) if (owner === undefined || a.owner === owner) remove(k, a);
    },
    drain() {
      if (waiting === 0) return 0;
      const turn = [...asks.values()].filter((a) => !a.held).sort((a, b) => a.priority - b.priority || a.seq - b.seq);
      const t0 = clock();
      let n = 0;
      /** The owners a run of this turn found no room for: their later asks are held unrun — the pages are as full for them. */
      const full = new Set<string>();
      for (const a of turn) {
        const k = id(a.owner, a.key);
        if (asks.get(k) !== a || a.held) continue;   // withdrawn, or replaced
        if (shows !== undefined && !shows(a.key)) { remove(k, a); dropped += 1; continue; }
        if (full.has(a.owner)) { a.held = true; waiting -= 1; continue; }
        const spent = clock() - t0;
        if (n > 0 && spent + expect(a.owner) > budgetMs) break;
        const r0 = clock();
        const verdict = a.run();
        const took = clock() - r0;
        const c = cost.get(a.owner);
        cost.set(a.owner, { mean: c === undefined ? took : 0.7 * c.mean + 0.3 * took, last: took });
        n += 1;
        // a run may have asked again for its own key (a newer need): that ask stands; else the verdict decides
        if (asks.get(k) !== a) continue;
        if (verdict === "done") remove(k, a);
        else {
          if (!a.held) { a.held = true; waiting -= 1; }
          full.add(a.owner);
        }
      }
      const spent = clock() - t0;
      if (n > 0) { ran += n; turns += 1; ms += spent; peakRuns = Math.max(peakRuns, n); peakMs = Math.max(peakMs, spent); }
      return n;
    },
    get size() { return waiting; },
    stats: () => ({ waiting, held: asks.size - waiting, ran, turns, ms, dropped, peakRuns, peakMs }),
  };
}
