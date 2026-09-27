// @vitest-environment node
// THE WHITEBOARD'S TOOLS IN HAND (design-015 §8; D3t-a — the tray merged into the held bar, Q-o): the kind's `open.tools` ride
// the Board's widget type (`defineObject`), so the engine reaches them — `ops.open` takes the marker up in the ink it lies in
// (its `cap`), `1`–`4` and `e` are modes (core's `HeldTool`), undo and redo are the DOCUMENT's history over the board's stroke
// entities, `t` cycles the capped marker's tip off the undo stack, ⌘⌫ wipes in ONE transaction (itself undoable) only when there
// is ink to wipe; the bar's slots are the tools less the keys-only ones, the markers' swatches the palette's inks.
import { ChildOf, createCanvasEngine, guardedTransaction, HeldTool, Viewport } from "@ice/core";
import { describe, expect, it } from "vitest";
import { heldSlots } from "../../desk/src/compose/marks";
import { BOARD_TOOLS, boardKind, type BoardObjectLook, ERASER_TOOL_ID, inkOfTool, markerToolId } from "../src/board/kind";
import { addStroke, Board, BoardStroke } from "../src";
import { BOARD_LOOK, MARKERS, PALETTE } from "../../desk/oracle/fixtures/vf-theme";
import { must } from "../../desk/test/must";

const palette = { ...PALETTE.light, board: BOARD_LOOK, markers: MARKERS };
const look = must(boardKind().theme)(palette, "light") as BoardObjectLook;

function desk(props: Record<string, unknown> = {}) {
  const ce = createCanvasEngine({ widgets: [Board] });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 1200, h: 800, dpr: 1 });
  const board = ce.ops.spawnWidget("desk.board", { x: 100, y: 100, props, undoable: false });
  ce.world.sync();
  const strokes = () => ce.world.getReverse(board, ChildOf).map((k) => ce.world.get(k, BoardStroke)).filter((s) => s !== undefined);
  const propsOf = () => ce.world.get(board, Board.groups[0]?.component as never) as { cap: string; tip: string };
  const lay = (): void => {
    const s = must(ce.docs.current());
    guardedTransaction(s.store, ce.world, (tx) => { addStroke(tx, board, { ink: "red", points: [[10, 10], [60, 40]] }); });
    ce.world.sync();
  };
  return { ce, world: ce.world, board, strokes, propsOf, lay };
}

describe("the board's tools on its widget type (design-015 §8, D3t-a)", () => {
  it("the Board carries the kind's nine tools; the bar's slots are seven — the tip and the wipe on keys alone — the markers' swatches the palette's", () => {
    expect(Board.heldTools.map((t) => t.id)).toEqual(BOARD_TOOLS.map((t) => t.id));
    expect(Board.heldTools.filter((t) => t.kind === "mode").map((t) => t.id)).toEqual(["marker:black", "marker:blue", "marker:red", "marker:green", ERASER_TOOL_ID]);
    const slots = heldSlots(Board.heldTools, look.swatches);
    expect(slots.map((s) => s.id)).toEqual(["marker:black", "marker:blue", "marker:red", "marker:green", "eraser", "undo", "redo"]);
    for (const [name, m] of Object.entries(MARKERS)) expect(slots.find((s) => s.id === markerToolId(name))?.swatch).toBe(m.css);
    expect(slots.find((s) => s.id === "eraser")?.swatch).toBeUndefined();
    expect(slots.every((s) => !("run" in s))).toBe(true);   // plain data: the op stays on the type
    expect(inkOfTool("marker:green")).toBe("green");
    expect(inkOfTool(ERASER_TOOL_ID)).toBeUndefined();
  });

  it("picked up, the marker comes into the hand in the ink it lies in; `1`–`4` and the eraser are the modes", () => {
    const { ce, board, world } = desk({ cap: "red" });
    ce.ops.open(board);
    expect(world.get(board, HeldTool)).toEqual({ id: "marker:red", prev: "marker:red" });
    ce.ops.useHeldTool("marker:green");
    ce.ops.useHeldTool(ERASER_TOOL_ID);
    expect(world.get(board, HeldTool)).toEqual({ id: "eraser", prev: "marker:green" });
    ce.ops.useHeldTool(ERASER_TOOL_ID);   // the eraser put down: the marker it took over from
    expect(world.get(board, HeldTool)?.id).toBe("marker:green");
  });

  it("undo and redo are the document's history over the board's strokes; the wipe is ONE transaction, only on ink, itself undoable", () => {
    const { ce, board, strokes, lay } = desk();
    ce.ops.open(board);
    ce.ops.useHeldTool("wipe");
    ce.world.sync();
    expect(strokes()).toHaveLength(0);   // nothing to wipe: no transaction
    lay();
    lay();
    expect(strokes()).toHaveLength(2);
    ce.ops.useHeldTool("undo");
    ce.world.sync();
    expect(strokes()).toHaveLength(1);
    ce.ops.useHeldTool("redo");
    ce.world.sync();
    expect(strokes()).toHaveLength(2);
    ce.ops.useHeldTool("wipe");
    ce.world.sync();
    expect(strokes().map((s) => s?.tool)).toEqual(["marker", "marker", "wipe"]);
    ce.ops.useHeldTool("wipe");   // wiped already: no second wipe
    ce.world.sync();
    expect(strokes()).toHaveLength(3);
    ce.ops.useHeldTool("undo");
    ce.world.sync();
    expect(strokes()).toHaveLength(2);
  });

  it("`t` cycles the capped marker's tip — fine → bullet → chisel — written off the undo stack", () => {
    const { ce, board, propsOf } = desk({ tip: "bullet" });
    ce.ops.open(board);
    ce.ops.useHeldTool("tip");
    ce.world.sync();
    expect(propsOf().tip).toBe("chisel");
    ce.ops.useHeldTool("tip");
    ce.world.sync();
    expect(propsOf().tip).toBe("fine");
    expect(ce.docs.undo()).toBe(false);   // a pick of the pen is never an undo step
    expect(propsOf().tip).toBe("fine");
  });
});
