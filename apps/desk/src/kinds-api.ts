// `window.__desk.kinds` — the D3w kinds' door for the rigs (design-015 D3w): lay a stroke on a board as its data child
// (one undoable transaction), count a board's strokes and the ink's replays; lay the committed picture as a print (one
// undoable transaction, through the app's BlobStore); read a print's body and its last flick (the law's replay input);
// count the frames a print's Position changed while watched (the carry's ONE transaction); the notebook pass's drawn
// books (the instant delete); a pad's events. Everything reads the kinds' own state or the world; the only writes are
// the transactions an op would make.

import { type CanvasEngine, ChildOf, type Entity, guardedTransaction, Position } from "@ice/core";
import type { DeskLayerHandle } from "@ice/desk";
import type { BoardInk, BoardKind, FlickWitness, NotebookKind, Pads, Prints } from "@ice/desk";
import { addStroke, BoardStroke, decodePoints, decodeTimes, PHOTO_TYPE, type StrokeSpec } from "@ice/desk/objects";
import { BOARD } from "@ice/desk";
import { printRect } from "@ice/desk";
import { spawnAll } from "./scene";
import { printFixture } from "./scene-kinds";

export interface KindsApi {
  stroke(board: number, spec: StrokeSpec): number;
  strokes(board: number): number;
  replays(): number;
  /** A board's strokes as its data children state them (D3t-a): tool, ink, tip, erase, the path's points, how many timed samples. */
  strokeRows(board: number): readonly { readonly tool: string; readonly ink: string; readonly tip: string; readonly erase: boolean; readonly points: readonly (readonly [number, number])[]; readonly timed: number }[];
  /** The board's ink raster read back (D3t-a): the coverage (alpha, 0–255) at each melamine point, and the whole raster's inked-texel count. */
  inkAt(board: number, points: readonly (readonly [number, number])[]): Promise<{ readonly alpha: readonly number[]; readonly inked: number } | null>;
  /** The board's pen flux (D3t-a): taken up, shown, rubbing, pressed. */
  pen(board: number): { readonly take: number; readonly shown: number; readonly rub: number; readonly press: number } | null;
  /** The pen driver (D3t-a): the stroke in hand, the strokes it committed. */
  hand(): { readonly live: { readonly board: number; readonly samples: number } | null; readonly commits: number } | null;
  print(at: { readonly x: number; readonly y: number }, angle?: number): Promise<number>;
  body(print: number): FlickWitness["body"] | null;
  flick(print: number): FlickWitness | null;
  watch(entity: number): void;
  moves(): number;
  booksDrawn(): number;
  events(pad: number): readonly unknown[];
}

export function kindsApi(engine: CanvasEngine, handle: DeskLayerHandle): KindsApi {
  const { world } = engine;
  let watched: { entity: Entity; moves: number; last: string } | null = null;
  const sample = (): void => {
    const w = watched;
    if (w === null) return;
    const p = world.isAlive(w.entity) ? world.get(w.entity, Position) : undefined;
    const now = p === undefined ? "" : `${p.x},${p.y}`;
    if (now !== w.last) { w.moves += 1; w.last = now; }
    requestAnimationFrame(sample);
  };
  return {
    stroke(board, spec) {
      const session = engine.docs.current();
      if (session === undefined) throw new Error("desk: no document");
      let e: Entity | undefined;
      guardedTransaction(session.store, world, (tx) => { e = addStroke(tx, board as Entity, spec); });
      return (e ?? 0) as number;
    },
    strokes: (board) => world.getReverse(board as Entity, ChildOf).filter((k) => world.get(k, BoardStroke) !== undefined).length,
    replays: () => (handle.local("board") as BoardInk | undefined)?.replays() ?? 0,
    strokeRows(board) {
      return world.getReverse(board as Entity, ChildOf).flatMap((k) => {
        const r = world.get(k, BoardStroke);
        if (r === undefined) return [];
        return [{ tool: r.tool ?? "marker", ink: r.ink ?? "black", tip: r.tip ?? "bullet", erase: r.erase === true, points: decodePoints(r.points ?? ""), timed: decodeTimes(r.times ?? "").length }];
      });
    },
    async inkAt(board, points) {
      const ink = handle.local("board") as BoardInk | undefined;
      const id = ink?.rasterOf(board as Entity);
      const pass = (handle.ground()?.pass("board") as BoardKind | undefined)?.pass;
      if (id === undefined || pass === undefined) return null;
      const r = await pass.readInk(id);
      if (r === null) return null;
      const density = BOARD.ink.density;
      const alpha = points.map(([x, y]) => { const tx = Math.min(Math.max(Math.floor(x * density), 0), r.width - 1); const ty = Math.min(Math.max(Math.floor(y * density), 0), r.height - 1); return r.bytes[(ty * r.width + tx) * 4 + 3] ?? 0; });
      let inked = 0;
      for (let i = 3; i < r.bytes.length; i += 4) if ((r.bytes[i] ?? 0) > 8) inked += 1;
      return { alpha, inked };
    },
    pen(board) {
      const p = (handle.local("board") as BoardInk | undefined)?.penOf(board as Entity);
      return p === undefined ? null : { take: p.take, shown: p.shown, rub: p.rub, press: p.press };
    },
    hand() {
      const pen = handle.pen();
      if (pen === undefined) return null;
      const live = pen.live();
      return { live: live === null ? null : { board: live.board as number, samples: live.samples }, commits: pen.commits() };
    },
    async print(at, angle = 0) {
      const fx = await printFixture(handle);
      const r = printRect(at.x, at.y, fx.w, fx.h);
      const [e] = spawnAll(engine, [{ type: PHOTO_TYPE, cx: r.cx, cy: r.cy, w: r.w, h: r.h, props: { blob: fx.hash, width: fx.w, height: fx.h, angle } }], true);
      return (e ?? 0) as number;
    },
    body: (e) => (handle.local("photo") as Prints | undefined)?.body(e as Entity) ?? null,
    flick: (e) => (handle.local("photo") as Prints | undefined)?.flick(e as Entity) ?? null,
    watch(e) {
      const p = world.get(e as Entity, Position);
      watched = { entity: e as Entity, moves: 0, last: p === undefined ? "" : `${p.x},${p.y}` };
      requestAnimationFrame(sample);
    },
    moves: () => watched?.moves ?? 0,
    booksDrawn: () => ((handle.ground()?.pass("notebook") as NotebookKind | undefined)?.pass?.drawn?.books ?? 0),
    events: (pad) => (handle.local("calendar") as Pads | undefined)?.events(pad as Entity) ?? [],
  };
}
