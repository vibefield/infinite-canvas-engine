// A board's HISTORY — pure (BOARD.md §4). What is on a whiteboard is the list of what was
// done to it: strokes (a tool and its stamps) and wipes. The raster on the GPU is a cache of
// that list, replayed in order — so an undo is "replay one fewer", a redo "one more", and the
// board can be re-rastered at any density. The list is also what an agent reads: every
// stroke's tool, colour and path, in world units.

import { pathOf, type Tool } from "./stroke";

export type BoardOp =
  | { readonly kind: "stroke"; readonly tool: Tool; readonly stamps: Float32Array; readonly ink?: string }
  | { readonly kind: "wipe" };

export class BoardHistory {
  private ops: BoardOp[] = [];
  private cursor = 0;
  /** Bumps on every change — what a host compares to know the raster is stale. */
  version = 0;

  /** Do something new: anything undone past the cursor is forgotten. */
  push(op: BoardOp): void {
    this.ops.length = this.cursor;
    this.ops.push(op);
    this.cursor += 1;
    this.version += 1;
  }

  get canUndo(): boolean { return this.cursor > 0; }
  get canRedo(): boolean { return this.cursor < this.ops.length; }

  undo(): boolean { if (!this.canUndo) return false; this.cursor -= 1; this.version += 1; return true; }
  redo(): boolean { if (!this.canRedo) return false; this.cursor += 1; this.version += 1; return true; }

  /** What is on the board now, in the order it was done. */
  get done(): readonly BoardOp[] { return this.ops.slice(0, this.cursor); }

  /** What a replay needs: everything after the last wipe (a wipe clears all before it). */
  get replay(): readonly BoardOp[] {
    const done = this.done;
    let from = 0;
    for (let i = done.length - 1; i >= 0; i--) if ((done[i] as BoardOp).kind === "wipe") { from = i + 1; break; }
    return done.slice(from);
  }

  /** Is there ink on the board? (A stroke after the last wipe — the eraser's count too: it may leave a ghost.) */
  get inked(): boolean { return this.replay.some((op) => op.kind === "stroke"); }

  /** The board as a reader sees it: each stroke's tool, ink and path since the last wipe. */
  read(every = 6): Array<{ tool: "marker" | "eraser"; ink: string | null; path: Array<readonly [number, number]> }> {
    return this.replay.flatMap((op) => op.kind === "stroke" ? [{ tool: op.tool.mode === "erase" ? "eraser" as const : "marker" as const, ink: op.ink ?? null, path: pathOf(op.stamps, every) }] : []);
  }
}
