// The WHITEBOARD from the world (design-015 §5–6; D3w): the Board object through `defineObject`, its world
// half on the bench's own laws — resolve + record equal to the Node oracle's own scene builder for the same
// board (frame.mjs `boardPoseOf`, number for number: PARITY BY CONSTRUCTION), its strokes as DATA CHILDREN
// whose replay is the oracle's `opsOf` op for op, the raster a cache the kind's local rebuilds when the
// children's stamp turns over (a stroke laid, undone, redone), the path codec, the mirror, the look.
import { cascadeDestroy, ChildOf, createCanvasEngine, type Entity, guardedTransaction, Position, Resizable, STRATUM_BANDS } from "@ice/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { surfaceSize } from "../src/board/board";
import type { BoardPass } from "../src/board/board-pass";
import type { BoardOp } from "../src/board/history";
import { worldChildren } from "../src/compose/children";
import { type BoardInk, BoardKind, boardFrame, boardKind, FLUX_REST, type ObjectContext, rectOf } from "../src/kinds";
import { DEFAULT_GRID } from "../src/mat/grid";
import { objectKindOf } from "../src/object";
import { addStroke, Board, BOARD_TYPE, BoardStroke, boardOps, decodePoints, encodePoints, strokeRow, strokeSeed } from "../src/objects";
import { ERASER_TOOL, StrokeBuilder } from "../src/board/stroke";
import { lampOf } from "../src/paper/paper";
import { BOARD, MAT_GRID } from "../src/theme";
import { BOARD_LOOK, MARKERS, PALETTE, THEMES } from "../oracle/fixtures/vf-theme";
import { fakeEncoder, fakeOracle, type OracleInternals, sceneOf } from "./oracle-fake";
import { must } from "./must";

const lamp = lampOf(MAT_GRID.plane);
const palette = { ...PALETTE.light, board: BOARD_LOOK, markers: MARKERS };
const kind = boardKind();
const look = must(kind.theme)(palette, "light");
const W = BOARD.spec.width;
const H = BOARD.spec.height;
/** A scene's camera as the builder hands it (the oracle's VIEW: 1200 × 800 CSS px at dpr 2). */
const viewOf = (s: { camX: number; camY: number; zoom: number }) => ({ camX: s.camX, camY: s.camY, zoom: s.zoom, width: 1200, height: 800, dpr: 2 });
interface BoardScene { camX: number; camY: number; zoom: number; boards: { x: number; y: number; strokes?: { ink?: string; tip?: string; erase?: boolean; points: [number, number][] }[] }[] }
const inkScene = sceneOf<BoardScene>("board-ink-z1");
const BOARD_STROKES = must(must(inkScene.boards[0]).strokes);
/** A board's context as the builder hands it — ring 0 selected or not: the kinds' own ring is retired, a selection is the desk's marks (D4a). */
const ctxOf = (b: { x: number; y: number; selected?: boolean }, over: Partial<ObjectContext> = {}): ObjectContext => ({
  entity: 7 as Entity, rect: rectOf({ x: b.x - W / 2, y: b.y - H / 2 }, { w: W, h: H }), props: { cap: "black", tip: "bullet" },
  flux: { ...FLUX_REST, ring: 0 }, look, theme: THEMES.light, lamp, view: viewOf(inkScene), grid: DEFAULT_GRID, dt: 1 / 60, ...over,
});

let oracle: OracleInternals;
let undoGpu: () => void;
let device: GPUDevice;
beforeAll(async () => { const o = await fakeOracle(); oracle = o.desk; undoGpu = o.undo; device = o.device; });
afterAll(() => undoGpu());

describe("the Board object (design-015 §6)", () => {
  it("desk.board — cap · tip, 480 × 320, things, movable, selectable and RESIZABLE (its knobs are core's handles — Q-a/b), snapping both ways; its kind the board's", () => {
    expect(Board.type).toBe(BOARD_TYPE);
    expect(objectKindOf(Board)?.name).toBe("board");
    expect(Board.defaultSize).toEqual({ w: 480, h: 320 });
    expect(Board.stratum).toBe("things");
    expect(STRATUM_BANDS.things).toBeGreaterThan(STRATUM_BANDS.sheets);
    expect(Object.keys(Board.propToGroup).sort()).toEqual(["cap", "tip"]);
    expect(Board.capabilityTags).toContain(Resizable);
  });
});

describe("the board's world half = the oracle's scene builder (parity by construction)", () => {
  it("resolve + record = frame.mjs `boardPoseOf` for the bench's boards: at rest and selected (the ring retired on both sides — D4a) — the geometry, the materials, the quad, the sheen, the capped marker", () => {
    for (const b of [{ x: 420, y: -120 }, { x: 420, y: -120, selected: true }, { x: -300, y: 250 }]) {
      const ctx = ctxOf(b);
      const G = kind.resolve(ctx);
      const { id, ...R } = kind.record(G, ctx);
      expect(id).toBe(0);   // no desk, no raster: the pass draws nothing for it (the kind's local makes one)
      expect(R).toEqual(oracle.boardPoseOf(b));
    }
  });

  it("the strokes REPLAY as the oracle's `opsOf` lays them, op for op: tools, stamps (the bench's seeds by index), inks — the eraser included", () => {
    const captured: BoardOp[][] = [];
    const replay = oracle.boards.replay.bind(oracle.boards);
    oracle.boards.replay = (id, ops) => { captured.push([...(ops as BoardOp[])]); replay(id, ops); };
    oracle.encode(fakeEncoder(device), {} as GPUTextureView, { w: 2400, h: 1600 }, inkScene);
    oracle.boards.replay = replay;
    const theirs = must(captured[0]);
    const ours = boardOps(BOARD_STROKES.map((s) => strokeRow({ ...(s.ink !== undefined ? { ink: s.ink } : {}), ...(s.tip !== undefined ? { tip: s.tip as "fine" } : {}), ...(s.erase ? { erase: true } : {}), points: s.points as [number, number][] })), look.markers);
    expect(ours.length).toBe(4);
    expect(ours.length).toBe(theirs.length);
    ours.forEach((op, i) => {
      const t = theirs[i] as BoardOp;
      expect(op.kind).toBe(t.kind);
      if (op.kind !== "stroke" || t.kind !== "stroke") return;
      expect(op.tool).toEqual(t.tool);
      expect(op.ink).toBe(t.ink);
      expect([...op.stamps]).toEqual([...t.stamps]);
    });
  });
});

describe("the strokes are DATA CHILDREN; the raster is their cache (D-D5)", () => {
  /** A board pass that records what the kind asks of it. */
  function stubPass() {
    const calls: string[] = [];
    const replays: BoardOp[][] = [];
    const pass = {
      look: { barrel: [0, 0, 0], felt: [0, 0, 0], wood: [0, 0, 0] },
      made: new Set<number>(),
      ensure(id: number) { if (this.made.has(id)) return false; this.made.add(id); calls.push(`ensure ${id}`); return true; },
      replay(id: number, ops: readonly BoardOp[]) { replays.push([...ops]); calls.push(`replay ${id} ${ops.length}`); },
      release(id: number) { this.made.delete(id); calls.push(`release ${id}`); },
      // the live stroke's door (D3t-a): what the pen lays, lifts, drops; the drying
      wetting: false,
      lay(id: number, _tool: unknown, stamps: Float32Array) { calls.push(`lay ${id} ${stamps.length / 8}`); },
      commit(id: number) { this.wetting = true; calls.push(`commit ${id}`); },
      cancel(id: number) { calls.push(`cancel ${id}`); },
      dry(_dt: number) {},
    };
    return { kindPass: new BoardKind(pass as unknown as BoardPass), pass, calls, replays };
  }

  function desk(drawn?: (e: Entity) => number | undefined) {
    const ce = createCanvasEngine({ widgets: [Board] });
    ce.docs.create();
    let now = 0;
    const step = (): void => { now += 16; ce.step(now); };
    const session = () => must(ce.docs.current(), "a document");
    const board = ce.ops.spawnWidget(BOARD_TYPE, { x: 180, y: -280, undoable: false });
    step();
    const stub = stubPass();
    const ink = must(kind.local)({ pass: () => stub.kindPass, children: worldChildren(ce.world), ...(drawn !== undefined ? { drawn } : {}) }) as BoardInk;
    const draw = (ghost = false) => { const ctx = ctxOf({ x: 420, y: -120 }, { entity: board, local: ink, flux: { ...FLUX_REST, fade: ghost ? 0.5 : 1 } }); return kind.record(kind.resolve(ctx), ctx).id; };
    const lay = (spec: Parameters<typeof addStroke>[2]) => { guardedTransaction(session().store, ce.world, (tx) => { addStroke(tx, board, spec); }); step(); };
    return { ce, step, session, board, stub, ink, draw, lay };
  }

  it("a board met is rastered and its children replayed; a stroke LAID is a child entity — the stamp turns, the local asks a frame, the next record replays it", () => {
    const { board, stub, ink, draw, lay, ce } = desk();
    const id = draw();
    expect(id).toBe(1);
    expect(stub.calls).toEqual(["ensure 1", "replay 1 0"]);
    expect(ink.tick?.(0)).toBe(false);
    draw();
    expect(stub.calls.length).toBe(2);   // nothing changed: no replay
    lay({ ink: "blue", tip: "bullet", points: [[40, 60], [90, 48], [150, 52]] });
    const kids = ce.world.getReverse(board, ChildOf);
    expect(kids.length).toBe(1);   // the stroke is an entity, the board's child — never a member of the desk's paint order
    expect(ce.world.get(must(kids[0]), BoardStroke)?.ink).toBe("blue");
    expect(ce.world.get(must(kids[0]), Position)).toBeUndefined();
    expect(ink.tick?.(0)).toBe(true);   // the local wants a frame: a child arrived
    draw();
    expect(stub.calls.slice(2)).toEqual(["replay 1 1"]);
    expect(must(stub.replays[1])[0]?.kind).toBe("stroke");
    expect(ink.tick?.(0)).toBe(false);
    expect(ink.replays()).toBe(2);
  });

  it("a stroke laid on a board NOT drawn (culled — the builder's word): nothing asks a frame for it; back in view it asks, and replays (law #6 — D6's gate, pinned at D7)", () => {
    let shown = true;
    const { ink, draw, lay, stub, board } = desk(() => (shown ? 0 : undefined));
    draw();
    expect(ink.tick?.(0)).toBe(false);
    expect(ink.landed?.(board)).toBe(1);   // met: its ink replayed — a landing (D7)
    shown = false;   // scrolled off: the builder resolves nothing of it
    lay({ ink: "blue", tip: "bullet", points: [[40, 60], [90, 48], [150, 52]] });
    expect(ink.tick?.(16)).toBe(false);
    expect(ink.tick?.(32)).toBe(false);
    shown = true;
    expect(ink.tick?.(48)).toBe(true);
    draw();
    expect(stub.calls.at(-1)).toBe("replay 1 1");
    expect(ink.tick?.(64)).toBe(false);
    expect(ink.landed?.(board)).toBe(2);   // the replay landed; the ticks between moved nothing
  });

  it("a stroke laid LIVE (D3t-a): its stamps into the stroke layer; the lift lays it in WET; its entity is ADOPTED when it lands — no replay; another turnover replays and lays a stroke in hand again", () => {
    const { stub, ink, draw, lay, ce, board } = desk();
    draw();
    const builder = new StrokeBuilder(ERASER_TOOL, strokeSeed(0));
    builder.begin(40, 60, 0);
    ink.lay(board, builder);
    builder.move(90, 60, 16);
    ink.lay(board, builder);
    expect(ink.laying(board)).toEqual({ color: ERASER_TOOL.color, erase: true });
    expect(ink.tick?.(0)).toBe(true);   // a stroke in hand: a frame every tick
    builder.end(90, 60, 32);
    const points = encodePoints([[40, 60], [90, 60], [90, 60]]);
    ink.commit(board, points);
    expect(ink.laying(board)).toBeUndefined();
    expect(stub.calls.slice(2)).toEqual(["lay 1 1", `lay 1 ${builder.count - 1}`, "commit 1"]);
    lay({ erase: true, points: [[40, 60], [90, 60], [90, 60]], times: [0, 16, 32] });   // its ONE transaction lands
    const replays = ink.replays();
    draw();
    expect(ink.replays()).toBe(replays);   // adopted: the raster holds it already, wet
    // a stroke in hand while another lands (a peer's): the replay, then the stroke in hand laid again over it
    const again = new StrokeBuilder(ERASER_TOOL, strokeSeed(1));
    again.begin(10, 10, 0);
    ink.lay(board, again);
    lay({ ink: "red", points: [[200, 100], [260, 120]] });
    stub.calls.length = 0;
    draw();
    expect(stub.calls).toEqual(["replay 1 2", "lay 1 1"]);
    // abandoned: dropped, and the next record replays the children
    ink.cancel(board);
    stub.calls.length = 0;
    draw();
    expect(stub.calls).toEqual(["replay 1 2"]);
    expect(ce.world.getReverse(board, ChildOf)).toHaveLength(2);
  });

  it("resized, a board is drawn at its new rect — the frame the marks go around follows — and its ink replays into a raster of the new size", () => {
    const { stub, ink, lay, board } = desk();
    // the pass keeps one raster per board and makes it afresh when the melamine's size changes (board-pass.ts `ensure`)
    const sizes = new Map<number, string>();
    stub.pass.ensure = (id: number, size?: readonly [number, number]) => { const k = String(size); if (sizes.get(id) === k) return false; sizes.set(id, k); stub.calls.push(`ensure ${id}`); return true; };
    const drawAt = (w: number, h: number) => { const ctx = ctxOf({ x: 420, y: -120 }, { entity: board, local: ink, rect: rectOf({ x: 420 - w / 2, y: -120 - h / 2 }, { w, h }) }); const G = kind.resolve(ctx); kind.record(G, ctx); return G; };
    drawAt(W, H);
    lay({ ink: "blue", tip: "bullet", points: [[40, 60], [90, 48]] });
    drawAt(W, H);
    const before = stub.calls.length;
    const G = drawAt(W + 60, H + 40);
    expect(G.half).toEqual([(W + 60) / 2, (H + 40) / 2]);
    expect(boardFrame(G)).toMatchObject({ hx: (W + 60) / 2, hy: (H + 40) / 2 });
    expect(stub.calls.slice(before)).toEqual(["ensure 1", "replay 1 1"]);   // a raster of the new size, the stroke replayed into it
    expect(sizes.get(1)).toBe(String(surfaceSize(G)));
  });

  it("⌘Z takes the stroke away (the child despawns) and the raster replays without it; ⇧⌘Z brings it back — one stroke, one undo step", () => {
    const { stub, ink, draw, lay, session, step } = desk();
    draw();
    lay({ ink: "red", tip: "chisel", points: [[250, 120], [300, 96], [350, 110]] });
    lay({ tool: "wipe" });
    draw();
    expect(stub.calls.at(-1)).toBe("replay 1 0");   // a wipe clears what came before it: nothing to replay
    expect(session().store.undo()).toBe(true);
    step();
    expect(ink.tick?.(0)).toBe(true);
    draw();
    expect(stub.calls.at(-1)).toBe("replay 1 1");   // the wipe undone: the red stroke is back on the board
    expect(session().store.undo()).toBe(true);
    step();
    draw();
    expect(stub.calls.at(-1)).toBe("replay 1 0");
    expect(session().store.redo()).toBe(true);
    step();
    draw();
    expect(stub.calls.at(-1)).toBe("replay 1 1");
  });

  it("a deleted board's ghost keeps its ink while it fades (its strokes died with it: no replay); the builder's `forget` releases the raster", () => {
    const { ce, board, stub, ink, draw, lay, session, step } = desk();
    draw();
    lay({ ink: "green", tip: "fine", points: [[60, 200], [120, 185]] });
    draw();
    expect(stub.calls).toEqual(["ensure 1", "replay 1 0", "replay 1 1"]);
    session().store.transaction((tx) => { cascadeDestroy(tx, ce.world, board); });
    step();
    expect(ce.world.isAlive(board)).toBe(false);
    draw(true);
    expect(stub.calls.length).toBe(3);   // the ghost fades on the ink it had
    ink.forget?.(board);
    expect(stub.calls.at(-1)).toBe("release 1");
  });

  it("the stroke's cell: tool · ink · tip · erase · points · speed · times (v2, D3t-a) · page (v3, D3t-b) · seed (v4, D7 #13: −1 = the position's); the path as base64 LE f32 pairs, read tolerantly", () => {
    const pts: [number, number][] = [[40, 60], [90.5, 48.25], [-3, 1e4]];
    expect(decodePoints(encodePoints(pts))).toEqual(pts);
    expect(decodePoints(encodePoints([[0.1, 0.2]]))).toEqual([[Math.fround(0.1), Math.fround(0.2)]]);
    expect(encodePoints([[1, 2]])).toBe("AACAPwAAAEA");   // 1.0f = 00 00 80 3F, 2.0f = 00 00 00 40, little-endian
    expect(decodePoints("!?")).toEqual([]);
    expect(strokeRow({})).toEqual({ tool: "marker", ink: "black", tip: "bullet", erase: false, points: "", speed: 400, times: "", page: 0, seed: -1 });
  });
});

describe("the board's mirror, reach and look", () => {
  it("hit: the melamine is content, the aluminium frame, outside null — pickBoard on the same geometry", () => {
    const G = kind.resolve(ctxOf({ x: 420, y: -120 }));
    expect(kind.hit(G, 420, -120)).toBe("content");
    expect(kind.hit(G, 420 + W / 2 - 3, -120)).toBe("frame");
    expect(kind.hit(G, 420 + W / 2 + 3, -120)).toBeNull();
  });

  it("reach covers what a board may paint past its rect: the resting marker's box, the slab's shadow, the held scale", () => {
    const ctx = ctxOf({ x: 420, y: -120 }, { flux: { ...FLUX_REST, lift: 1 } });
    const R = kind.record(kind.resolve(ctx), ctx);
    const past = Math.max(R.quad.x1 - (420 + W / 2), (-120 + H / 2) - (-120 + H / 2) + R.quad.y1 - (-120 + H / 2), (420 - W / 2) - R.quad.x0, (-120 - H / 2) - R.quad.y0);
    expect(kind.reach).toBeGreaterThanOrEqual(past);
  });

  it("theme parses the palette's materials and markers; a palette without the board's materials is the host's mistake, said so", () => {
    expect(look.markers.blue?.opacity).toBe(0.97);
    expect(look.surface).toEqual([0xf3 / 255, 0xf2 / 255, 0xed / 255]);
    expect(() => must(kind.theme)(PALETTE.light, "light")).toThrow(/board/);
  });
});
