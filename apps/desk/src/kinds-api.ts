// `window.__desk.kinds` — the D3w kinds' door for the rigs (design-015 D3w): lay a stroke on a board as its data child
// (one undoable transaction), count a board's strokes and the ink's replays; lay the committed picture as a print (one
// undoable transaction, through the app's BlobStore); read a print's body and its last flick (the law's replay input);
// count the frames a print's Position changed while watched (the carry's ONE transaction); the notebook pass's drawn
// books (the instant delete); a pad's events. Everything reads the kinds' own state or the world; the only writes are
// the transactions an op would make.

import { type CanvasEngine, ChildOf, type Entity, guardedTransaction, Position } from "@ice/core";
import type { DeskLayerHandle } from "@ice/desk";
import type { BoardInk, FlickWitness, NotebookKind, Pads, Prints } from "@ice/desk";
import { addStroke, BoardStroke, PHOTO_TYPE, type StrokeSpec } from "@ice/desk/objects";
import { printRect } from "@ice/desk";
import { spawnAll } from "./scene";
import { printFixture } from "./scene-kinds";

export interface KindsApi {
  stroke(board: number, spec: StrokeSpec): number;
  strokes(board: number): number;
  replays(): number;
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
