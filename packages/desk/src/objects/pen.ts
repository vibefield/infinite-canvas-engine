// THE WHITEBOARD IN HAND — its pen (BOARD.md §5; design-015 §8; D3t-a): the hand half of the board kind, the print's carry's
// sibling (objects/carry.ts). It READS the world — the board in hand (core's `Held`), the tool in hand (`HeldTool`), the
// local pointer through the pose the renderer drew (`HeldPointer`, mapped to the desk by the builder's `heldToWorld`), the
// press that is the tool's (`HeldPress` "tool") and its buttons (a pen's eraser end erases too) — and drives the board kind's
// own state (kinds/board.ts `BoardInk`): the hand it follows, the stroke laid LIVE. It WRITES exactly two things, each ONE
// transaction deferred out of the frame (a reflector never writes — D-D2c.5): at the lift, the stroke — one `desk.stroke`
// child of the board with its samples' times (board/data.ts), which the ink adopts rather than replays — and at the put-down,
// the capped marker's ink (`cap`, off the undo stack) when the ink last used is another.
//
// A press on the melamine with a mode in hand begins a stroke at the next frame's pointer; every frame the pointer moved is a
// move, a frame it did not is the pen RESTING (it bleeds); the frame the press is gone is the lift, at the pointer's last
// point. The samples reach the pen as f32s — the same the cell stores — so the stamps laid live are the stamps a replay lays.
// The pen is seeded with the next op's seed (`strokeSeed` of the board's children), as the replay seeds it. Put down while a
// stroke is laid, the stroke lands first. Samples are a frame apart (the ingest folds a frame's moves into one — the
// prototype's coalesced events are owed).

import { ChildOf, type Component, defineQuery, type Entity, guardedTransaction, heldEntity, HeldPointer, HeldPress, HeldTool, LocalPointer, Pointer, PointerButtons, PointerScreen, setWidgetProps, type World } from "@ice/core";
import { type BoardGeometry, toSurface } from "../board/board";
import { addStroke, BoardStroke, encodePoints, strokeSeed } from "../board/data";
import { ERASER_TOOL, markerTool, StrokeBuilder, TIP_NAMES, type TipName, TIPS } from "../board/stroke";
import { type BoardInk, type BoardObjectLook, ERASER_TOOL_ID, inkOfTool } from "../kinds/board";
import { linear } from "../kit/light";
import { type TypingDocs, writable } from "../docs";

export interface BoardPenOptions {
  readonly world: World;
  /** The document a stroke commits into — the facade's `engine.docs`. */
  readonly docs: TypingDocs;
  /** The board's props cell (its `cap`, its `tip`) — the object hands its own (D-D7-A.3); absent, the marker is black, the tip a bullet. */
  readonly props?: Component | undefined;
  /** The board kind's state on this desk (undefined before it is made). */
  readonly ink: () => BoardInk | undefined;
  /** The board kind's look for the theme in force (the markers' inks). */
  readonly look: () => BoardObjectLook | undefined;
  /** Is this entity a board (the desk's builder knows each entity's kind). */
  readonly isBoard: (e: Entity) => boolean;
  /** A point of the held object's own frame as a desk point, through the pose the last frame drew (the builder's). */
  readonly heldToWorld: (e: Entity, x: number, y: number) => readonly [number, number] | undefined;
  /** The geometry the board was drawn with in hand (the builder's). */
  readonly geometryOf: (e: Entity) => unknown;
  /** Where a transaction runs: out of the frame (a microtask) unless a test says. */
  readonly defer?: (fn: () => void) => void;
}

export interface BoardPen {
  /** Nothing to follow (D7 #14): no board in hand, no stroke laid, no marker to lie down. */
  idle(): boolean;
  /** Once a frame, before the kinds' clocks: the hand onto the board in hand, its stroke laid, lifted, committed. */
  follow(now: number): void;
  /** The stroke in hand: its board and how many samples so far; null when none. */
  live(): { readonly board: Entity; readonly samples: number } | null;
  /** Strokes committed since creation (a rig's witness). */
  commits(): number;
}

interface Stroke {
  readonly board: Entity;
  readonly pointer: Entity;
  readonly builder: StrokeBuilder;
  readonly t0: number;
  readonly points: [number, number][];
  readonly times: number[];
  readonly ink: string;
  readonly tip: TipName;
  readonly erase: boolean;
  /** The fibre seed the live pen laid with — STORED in the row (v4, D7 #13), so the replay lays the same stamps whatever lands before it. */
  readonly seed: number;
}

const pointersQ = defineQuery([Pointer, LocalPointer, PointerScreen]);
const f32 = Math.fround;

export function createBoardPen(opts: BoardPenOptions): BoardPen {
  const { world, docs } = opts;
  const defer = opts.defer ?? ((fn: () => void) => queueMicrotask(fn));
  let stroke: Stroke | null = null;
  /** The board last in hand and the ink in hand then: at the put-down its marker lies down in it. */
  let last: { readonly board: Entity; ink: string } | null = null;
  let commits = 0;

  /** The capped marker's ink and tip, as the board's props hold them. */
  const propsOf = (b: Entity): { cap: string; tip: string } => {
    const v = opts.props === undefined ? undefined : (world.get(b, opts.props as never) as { cap?: string; tip?: string } | undefined);
    return { cap: v?.cap ?? "black", tip: v?.tip ?? "bullet" };
  };
  /** A desk point on board `b`'s melamine, as the cell stores it (world units from its top-left, f32). */
  const onMelamine = (G: BoardGeometry, at: readonly [number, number]): [number, number] => { const [x, y] = toSurface(G, at[0], at[1]); return [f32(x), f32(y)]; };

  /** The lift: the last sample, the stroke laid in WET, its ONE transaction out of the frame. */
  const lift = (s: Stroke, at: readonly [number, number] | undefined, now: number): void => {
    const ink = opts.ink();
    const G = opts.geometryOf(s.board) as BoardGeometry | undefined;
    const [x, y] = at !== undefined && G !== undefined ? onMelamine(G, at) : (s.points[s.points.length - 1] as [number, number]);
    const t = f32(now - s.t0);
    s.builder.end(x, y, t);
    s.points.push([x, y]);
    s.times.push(t);
    ink?.commit(s.board, encodePoints(s.points));
    const spec = { tool: "marker" as const, ink: s.ink, tip: s.tip, erase: s.erase, points: s.points, times: s.times, seed: s.seed };
    defer(() => {
      const session = writable(docs);
      let ok = false;
      if (session !== undefined && world.isAlive(s.board)) {
        try { guardedTransaction(session.store, world, (tx) => { addStroke(tx, s.board, spec); }); ok = true; } catch { ok = false; }
      }
      if (ok) commits += 1;
      else ink?.cancel(s.board);   // refused (a read-only document, a board gone): the raster is its children's again
    });
  };

  /** The put-down: the marker lies down in the ink last used — the `cap`, off the undo stack, when it is another. */
  const layDown = (b: Entity, ink: string): void => {
    defer(() => {
      const session = writable(docs);
      if (session === undefined || !world.isAlive(b) || propsOf(b).cap === ink) return;
      try { setWidgetProps(session.store, world, b, { cap: ink }, { undoable: false }); } catch { /* refused (the prop's schema, the guard): the old cap stays */ }
    });
  };

  return {
    follow(now) {
      const held = heldEntity(world);
      const board = held !== undefined && world.isAlive(held) && opts.isBoard(held) ? held : undefined;
      if (last !== null && last.board !== board) {
        // the board was put down (or another taken up): the stroke in hand lands first, then the marker lies down
        if (stroke !== null && stroke.board === last.board) { lift(stroke, undefined, now); stroke = null; }
        layDown(last.board, last.ink);
        last = null;
      }
      if (stroke !== null && !world.isAlive(stroke.board)) { opts.ink()?.cancel(stroke.board); stroke = null; }
      if (board === undefined) return;
      const ink = opts.ink();
      const look = opts.look();
      if (ink === undefined || look === undefined) return;
      const held0 = world.get(board, HeldTool);
      const tool = { id: held0?.id ?? "", prev: held0?.prev ?? "" };
      const props = propsOf(board);
      const inHand = inkOfTool(tool.id) ?? inkOfTool(tool.prev) ?? props.cap;
      last = { board, ink: inHand };
      // the pointer: the one laying the stroke, else the local mouse
      let pointer: Entity | undefined;
      world.query(pointersQ).each((b) => {
        for (const r of b) {
          const p = b.entity(r);
          if (stroke !== null ? p === stroke.pointer : world.read(p, Pointer).device === "mouse" || world.get(p, HeldPress)?.kind === "tool") pointer = pointer ?? p;
        }
      });
      const hp = pointer !== undefined ? world.get(pointer, HeldPointer) : undefined;
      const at = hp !== undefined ? opts.heldToWorld(board, hp.x, hp.y) : undefined;
      const G = opts.geometryOf(board) as BoardGeometry | undefined;
      const buttons = pointer !== undefined ? (world.get(pointer, PointerButtons)?.buttons ?? 0) : 0;
      const pressing = pointer !== undefined && world.get(pointer, HeldPress)?.kind === "tool" && (buttons & (1 | 32)) !== 0;
      // the lift: the press is gone (released, cancelled) — the stroke lands at the pointer's last point
      if (stroke !== null && (!pressing || stroke.pointer !== pointer || stroke.board !== board)) { lift(stroke, at, now); stroke = null; }
      else if (stroke !== null && at !== undefined && G !== undefined) {
        // a frame of the stroke: a move, or — the pointer where it was — the pen resting (its bleed)
        const [x, y] = onMelamine(G, at);
        const t = f32(now - stroke.t0);
        const [px, py] = stroke.points[stroke.points.length - 1] as [number, number];
        if (x === px && y === py) stroke.builder.hold(t);
        else stroke.builder.move(x, y, t);
        stroke.points.push([x, y]);
        stroke.times.push(t);
        ink.lay(board, stroke.builder);
      } else if (stroke === null && pressing && pointer !== undefined && at !== undefined && G !== undefined) {
        // the press: the pen meets the melamine — the eraser if it is the tool in hand, or a pen's eraser end
        const erase = tool.id === ERASER_TOOL_ID || (buttons & 32) !== 0;
        const tip = (TIP_NAMES.includes(props.tip as TipName) ? props.tip : "bullet") as TipName;
        const m = look.markers[inHand] ?? Object.values(look.markers)[0];
        const pen = erase || m === undefined ? ERASER_TOOL : markerTool(linear(m.color), m.opacity, TIPS[tip]);
        const rows = world.getReverse(board, ChildOf).filter((k) => world.get(k, BoardStroke) !== undefined).length;
        const seed = strokeSeed(rows);   // the next op's, as a replay of the rows so far would seed it — and the row will carry it
        const builder = new StrokeBuilder(pen, seed);
        const [x, y] = onMelamine(G, at);
        builder.begin(x, y, 0);
        stroke = { board, pointer, builder, t0: now, points: [[x, y]], times: [0], ink: inHand, tip, erase, seed };
        ink.lay(board, builder);
      }
      const screen = pointer !== undefined ? world.get(pointer, PointerScreen) : undefined;
      ink.hand(board, {
        at: at ?? null,
        over: hp?.part === "content" || stroke !== null,
        pressing: stroke !== null,
        erasing: stroke !== null ? stroke.erase : tool.id === ERASER_TOOL_ID,
        ink: inHand,
        ...(screen !== undefined ? { screen: [screen.x, screen.y] as const, t: now } : {}),
      });
    },
    idle: () => stroke === null && last === null && heldEntity(world) === undefined,
    live: () => (stroke === null ? null : { board: stroke.board, samples: stroke.points.length }),
    commits: () => commits,
  };
}
