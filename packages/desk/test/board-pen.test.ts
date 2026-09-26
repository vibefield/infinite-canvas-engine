// @vitest-environment node
// THE WHITEBOARD IN HAND — its pen (BOARD.md §5; design-015 §8; D3t-a): through the REAL stack (core's held input maps the
// pointer through the pose seam into `HeldPointer`; a press on the melamine with a mode in hand is the tool's), the pen driver
// lays a stroke LIVE a frame at a time — moves, the pen RESTING (a repeat: its bleed), the lift at the last point — and commits
// it as ONE `desk.stroke` child with its samples' times, whose replay lays the SAME stamps the live pen laid (the seed is the
// next op's, the samples the cell's f32s). The eraser in hand (or a pen's eraser end) erases; put down mid-stroke, the stroke
// lands first and the marker lies down in the ink last used — the cap, off the undo stack; ⌘Z is the document's.
import { ChildOf, createCanvasEngine, type Entity, HeldPointer, LocalPointer, NO_MODS, Pointer, Viewport, defineQuery } from "@ice/core";
import { describe, expect, it } from "vitest";
import { pickBoard, resolveBoard, toSurface } from "../src/board/board";
import type { StrokeBuilder } from "../src/board/stroke";
import { type BoardInk, boardKind, type BoardObjectLook, type PenHand } from "../src/kinds";
import { Board, BoardStroke, boardOps, createBoardPen, decodePoints, decodeTimes } from "../src/objects";
import { lampOf } from "../src/paper/paper";
import { MAT_GRID } from "../src/theme";
import { BOARD_LOOK, MARKERS, PALETTE } from "../oracle/fixtures/vf-theme";
import { must } from "./must";

const palette = { ...PALETTE.light, board: BOARD_LOOK, markers: MARKERS };
const look = must(boardKind().theme)(palette, "light") as BoardObjectLook;
const pointerQ = defineQuery([Pointer, LocalPointer]);

function rig(props: Record<string, unknown> = {}, readOnly?: () => boolean) {
  const ce = createCanvasEngine({ widgets: [Board] });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 1200, h: 800, dpr: 1 });
  // the board's rect at (100, 100) — centre (340, 260); in hand it sits at the screen's (600, 400) at 1 px a unit
  const board = ce.ops.spawnWidget("desk.board", { x: 100, y: 100, props, undoable: false });
  ce.world.sync();
  const G = resolveBoard({ cx: 340, cy: 260, w: 480, h: 320 }, { held: 0, ring: 0, fade: 1 }, lampOf(MAT_GRID.plane));
  ce.stack.heldPose.current = {
    frame: (e) => (e === board ? { cx: 600, cy: 400, hx: 240, hy: 160, s: 1, settled: true } : undefined),
    part: (e, x, y) => { if (e !== board) return null; const h = pickBoard(G, 340 + x, 260 + y); return h === "surface" ? "content" : h === "frame" ? "frame" : null; },
  };
  // the ink as a spy: what the pen laid, lifted, cancelled — and the hand it was told
  const laid: StrokeBuilder[] = [];
  const committed: string[] = [];
  const hands: PenHand[] = [];
  let cancels = 0;
  const ink = {
    lay: (_e: Entity, b: StrokeBuilder) => { if (laid[laid.length - 1] !== b) laid.push(b); },
    commit: (_e: Entity, points: string) => { committed.push(points); },
    cancel: () => { cancels += 1; },
    hand: (_e: Entity, h: PenHand) => { hands.push(h); },
  } as unknown as BoardInk;
  // the document as `TypingDocs` carries it — the gate's verdict swapped in when a test says (a doc a newer build wrote reads so)
  const docs = readOnly === undefined
    ? ce.docs
    : { current: () => { const s = ce.docs.current(); return s === undefined ? undefined : { store: s.store, liveWriter: s.liveWriter, readOnly: readOnly(), versionReport: s.versionReport }; } };
  const pen = createBoardPen({
    world: ce.world, docs, ink: () => ink, look: () => look, isBoard: (e) => e === board,
    heldToWorld: (e, x, y) => (e === board ? [340 + x, 260 + y] : undefined), geometryOf: (e) => (e === board ? G : undefined),
  });
  let now = 1000;
  const frame = (dt = 16): void => { now += dt; ce.step(now); pen.follow(now); };
  const mouse = (kind: "down" | "move" | "up", x: number, y: number, buttons: number): void => {
    ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: NO_MODS });
  };
  const strokes = () => ce.world.getReverse(board, ChildOf).map((k) => ce.world.get(k, BoardStroke)).filter((s) => s !== undefined);
  const settle = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); ce.world.sync(); };
  const cap = () => (ce.world.get(board, Board.groups[0]?.component as never) as { cap: string }).cap;
  return { ce, board, pen, frame, mouse, strokes, settle, laid, committed, hands, cap, cancels: () => cancels, now: () => now };
}

describe("the pen in hand lays a stroke and commits it as ONE child with its samples' times", () => {
  it("press · moves · a rest · the lift → one desk.stroke; the replay of its row lays the live pen's stamps", async () => {
    const r = rig({ cap: "blue" });
    r.frame(); r.ce.ops.open(r.board); r.frame(); r.frame();
    // screen (600, 400) is the board's centre — the melamine
    r.mouse("move", 560, 380, 0); r.frame();
    expect(r.ce.world.get(r.ce.world.firstOf(pointerQ) as Entity, HeldPointer)?.part).toBe("content");
    r.mouse("down", 560, 380, 1); r.frame();
    expect(r.pen.live()?.samples).toBe(1);
    r.mouse("move", 590, 390, 1); r.frame();
    r.mouse("move", 640, 395, 1); r.frame();
    r.frame(200);   // the pen rests past `bleed.after`
    r.mouse("move", 700, 430, 1); r.frame();
    r.mouse("up", 700, 430, 0); r.frame();
    expect(r.pen.live()).toBeNull();
    expect(r.committed).toHaveLength(1);
    await r.settle();
    const rows = r.strokes();
    expect(rows).toHaveLength(1);
    const row = must(rows[0]);
    expect(row.ink).toBe("blue");
    expect(row.erase).toBe(false);
    const pts = decodePoints(row.points ?? "");
    const times = decodeTimes(row.times ?? "");
    expect(pts.length).toBe(times.length);
    // screen (560, 380) is the board's (−40, −20): the desk's (300, 240), on the melamine from its top-left
    const G = resolveBoard({ cx: 340, cy: 260, w: 480, h: 320 }, { held: 0, ring: 0, fade: 1 }, lampOf(MAT_GRID.plane));
    expect(pts[0]).toEqual(toSurface(G, 300, 240).map(Math.fround));
    expect(times[0]).toBe(0);
    expect(pts[pts.length - 1]).toEqual(pts[pts.length - 2]);   // the lift where the last move left it
    expect(row.points).toBe(r.committed[0]);
    // the replay lays what the live pen laid, stamp for stamp
    const live = must(r.laid[0]);
    const op = boardOps(rows, look.markers)[0];
    expect(op?.kind === "stroke" ? Array.from(op.stamps) : null).toEqual(Array.from(live.stamps()));
    expect(r.pen.commits()).toBe(1);
    // ⌘Z is the document's: the stroke goes
    r.ce.docs.undo();
    r.ce.world.sync();
    expect(r.strokes()).toHaveLength(0);
  });

  it("the eraser in hand erases; so does a pen's eraser end; the hand is told over the melamine, pressing, erasing", async () => {
    const r = rig();
    r.frame(); r.ce.ops.open(r.board); r.frame(); r.frame();
    r.ce.ops.useHeldTool("eraser");
    r.mouse("move", 560, 380, 0); r.frame();
    expect(r.hands[r.hands.length - 1]).toMatchObject({ over: true, pressing: false, erasing: true, ink: "black" });
    r.mouse("down", 560, 380, 1); r.frame();
    expect(r.hands[r.hands.length - 1]).toMatchObject({ pressing: true, erasing: true });
    r.mouse("move", 600, 380, 1); r.frame();
    r.mouse("up", 600, 380, 0); r.frame();
    r.ce.ops.useHeldTool("eraser");   // the marker back
    r.mouse("move", 560, 420, 0); r.frame();
    r.mouse("down", 560, 420, 32); r.frame();   // a pen's eraser end
    r.mouse("move", 600, 420, 32); r.frame();
    r.mouse("up", 600, 420, 0); r.frame();
    await r.settle();
    expect(r.strokes().map((s) => s?.erase)).toEqual([true, true]);
  });

  it("put down mid-stroke: the stroke lands first; the marker lies down in the ink last used — the cap, off the undo stack", async () => {
    const r = rig({ cap: "black" });
    r.frame(); r.ce.ops.open(r.board); r.frame(); r.frame();
    r.ce.ops.useHeldTool("marker:red");
    r.mouse("move", 560, 380, 0); r.frame();
    r.mouse("down", 560, 380, 1); r.frame();
    r.mouse("move", 620, 390, 1); r.frame();
    r.ce.ops.putDown();
    r.frame();
    await r.settle();
    expect(r.strokes().map((s) => s?.ink)).toEqual(["red"]);
    expect(r.cap()).toBe("red");
    r.ce.docs.undo();   // the stroke's step — the cap's write took none
    r.ce.world.sync();
    expect(r.strokes()).toHaveLength(0);
    expect(r.cap()).toBe("red");
  });

  it("a press off the melamine (the frame) is no stroke; nor is one with nothing in hand", async () => {
    const r = rig();
    r.frame();
    r.mouse("move", 560, 380, 0); r.frame();
    r.mouse("down", 560, 380, 1); r.frame();
    r.mouse("up", 560, 380, 0); r.frame();
    r.ce.ops.open(r.board); r.frame(); r.frame();
    r.mouse("move", 600 + 235, 400, 0); r.frame();   // the aluminium
    r.mouse("down", 600 + 235, 400, 1); r.frame();
    expect(r.pen.live()).toBeNull();
    r.mouse("up", 600 + 235, 400, 0); r.frame();
    await r.settle();
    expect(r.strokes()).toHaveLength(0);
  });
});

describe("the pen and a read-only document (D7 #1: the writer's gate)", () => {
  it("a stroke on a read-only session lands NO desk.stroke — the wet ink is cancelled, the raster its children's again — and the cap is not written", async () => {
    const r = rig({ cap: "black" }, () => true);
    r.frame(); r.ce.ops.open(r.board); r.frame(); r.frame();
    r.ce.ops.useHeldTool("marker:red");
    r.mouse("move", 560, 380, 0); r.frame();
    r.mouse("down", 560, 380, 1); r.frame();
    expect(r.pen.live()?.samples).toBe(1);
    r.mouse("move", 620, 390, 1); r.frame();
    r.ce.ops.putDown();   // mid-stroke: the stroke would land first, then the marker lie down in red
    r.frame();
    await r.settle();
    expect(r.strokes()).toHaveLength(0);
    expect(r.pen.commits()).toBe(0);
    expect(r.cancels()).toBe(1);
    expect(r.cap()).toBe("black");
  });
});
