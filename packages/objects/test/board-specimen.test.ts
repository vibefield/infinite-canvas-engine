// @vitest-environment node
// THE BOARD'S PEN MATERIALS ON A SPECIMEN (K5b): the tray's whiteboard is drawn WITHOUT the desk's local, so nobody set its pass's pen
// materials — the local's raster sets the ROOT's, and only when a desk board is drawn; the specimen's slot pass copied whatever the
// root held: black before any desk board, the look's after (rig:world's tray scenes alone drew its marker black, the full order white —
// an order-dependent still). A record made without the local carries its look's materials, and the kind's pass takes them.
import { describe, expect, it } from "vitest";
import { DEFAULT_GRID, type ObjectContext } from "@ice/desk";
import { BoardKind, boardKind, type BoardObjectLook } from "../src/board/kind";
import type { BoardPass } from "../src/board/board-pass";
import type { BoardInstance } from "../src/board/layout";
import { lampOf } from "../src/paper/paper";
import { BOARD_LOOK, MARKERS, PALETTE, THEMES } from "../oracle/fixtures/vf-theme";
import { must } from "../../desk/test/must";

const palette = { ...PALETTE.light, board: BOARD_LOOK, markers: MARKERS };
const look = must(boardKind().theme)(palette, "light") as BoardObjectLook;

const ctxOf = (local?: unknown): ObjectContext => ({
  entity: 5 as ObjectContext["entity"],
  rect: { cx: 0, cy: 0, w: 480, h: 320 },
  props: {},
  flux: { lift: 0, hover: 0, ring: 0, fade: 1 },
  look,
  theme: THEMES.light,
  lamp: lampOf(DEFAULT_GRID.mat.plane),
  view: { camX: -600, camY: -400, zoom: 1, width: 1200, height: 800, dpr: 2 },
  grid: DEFAULT_GRID,
  dt: 0,
  ...(local !== undefined ? { local } : {}),
});

describe("the board specimen's pen materials (K5b)", () => {
  it("a record made without the desk's local carries its look's; one made with it does not (the local sets the root's)", () => {
    const k = boardKind();
    const bare = k.record(k.resolve(ctxOf()), ctxOf()) as BoardInstance;
    expect(bare.materials).toBe(look.pen);
    const ink = { raster: () => 7, handFor: () => ({ hand: undefined, pen: {}, pinned: false }) };
    const withLocal = k.record(k.resolve(ctxOf(ink)), ctxOf(ink)) as BoardInstance;
    expect(withLocal.materials).toBeUndefined();
  });

  it("the kind's pass takes a record's materials before it prepares — whatever the root left in the copy `tune` made", () => {
    const black = { barrel: [0, 0, 0], felt: [0, 0, 0], wood: [0, 0, 0] } as const;
    const spy = { look: black as BoardPass["look"], prepare: () => 1 };
    const kind = new BoardKind(spy as unknown as BoardPass);
    const s = { view: {}, fadeIn: {}, cfg: {}, frame: undefined, present: undefined, light: {}, theme: THEMES.light } as never;
    kind.prepare({} as GPUCommandEncoder, s, [{ id: 1 } as BoardInstance]);
    expect(spy.look).toBe(black);   // a desk board's record (made with the local) leaves the pass's own
    kind.prepare({} as GPUCommandEncoder, s, [{ id: 1, materials: look.pen } as BoardInstance]);
    expect(spy.look).toBe(look.pen);
  });
});
