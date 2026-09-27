// The WHITEBOARD's law (BOARD.md) — no GPU: the board's geometry and its hit-test, the framing
// an open board is seen under, the pen's stamps (deterministic, evenly pitched, drier when fast,
// bleeding when held), the history's undo/redo/wipe, the records, and the shaders' purity.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BOARD_REST, framing, pickBoard, quadOf, rasterSize, resolveBoard, sdBoard, shadowReach, surfaceSize, toSurface } from "../src/board/board";
import { BoardHistory } from "../src/board/history";
import { Board, BoardUniforms, boardValues, InkUniforms, Stamp, StampUniforms } from "../src/board/layout";
import { boardShaders } from "../src/board/shaders";
import { ERASER_TOOL, markerTool, pathOf, pitchOf, STAMP_FLOATS, StrokeBuilder, TIPS } from "../src/board/stroke";
import { compose } from "../src/engine/shader";
import { MatUniforms } from "../src/mat/layout";
import { lampOf } from "../src/paper/paper";
import { MAT_GRID } from "../src/theme";
import { BOARD } from "../src/board/theme";

const lamp = lampOf(MAT_GRID.plane);
const rect = { cx: 0, cy: 0, w: BOARD.spec.width, h: BOARD.spec.height };

describe("the board's geometry", () => {
  it("at rest is its own rect: half its size, the frame inside it, flat on the mat", () => {
    const G = resolveBoard(rect, BOARD_REST, lamp);
    expect(G.half).toEqual([240, 160]);
    expect(G.inner).toEqual([240 - BOARD.spec.frame, 160 - BOARD.spec.frame]);
    expect(G.lift).toBe(0);
    expect(G.scale).toBe(1);
    expect(G.innerR).toBeGreaterThanOrEqual(1.5);
  });

  it("held, it rises by the note's lift and reads at its scale — one physics", () => {
    const G = resolveBoard(rect, { held: 1, ring: 0, fade: 1 }, lamp);
    expect(G.lift).toBe(BOARD.lift.height);
    expect(G.scale).toBeCloseTo(BOARD.lift.scale, 12);
    expect(G.half[0]).toBeCloseTo(240 * BOARD.lift.scale, 9);
  });

  it("casts away from the lamp — lower-left under the gobo projector, as the note and the notebook do — and never past the cap", () => {
    const G = resolveBoard(rect, BOARD_REST, lamp);
    expect(G.slope[0]).toBeLessThan(0);   // left
    expect(G.slope[1]).toBeGreaterThan(0);   // down
    expect(Math.hypot(G.slope[0], G.slope[1])).toBeLessThanOrEqual(BOARD.shadow.slopeMax + 1e-9);
    expect(Math.hypot(...G.lamp)).toBeCloseTo(1, 12);
    const far = resolveBoard({ ...rect, cx: -20000 }, BOARD_REST, lamp);
    expect(Math.hypot(far.slope[0], far.slope[1])).toBeCloseTo(BOARD.shadow.slopeMax, 9);
  });

  it("picks the melamine, the frame and nothing, by the same field the shader draws", () => {
    const G = resolveBoard(rect, BOARD_REST, lamp);
    expect(pickBoard(G, 0, 0)).toBe("surface");
    expect(pickBoard(G, 240 - BOARD.spec.frame / 2, 0)).toBe("frame");
    expect(pickBoard(G, 0, -160 + 1)).toBe("frame");
    expect(pickBoard(G, 241, 0)).toBe("outside");
    // the rounded corner: its very tip is off the board
    expect(pickBoard(G, 239.9, 159.9)).toBe("outside");
    expect(sdBoard(G, 240, 0)).toBeCloseTo(0, 9);
  });

  it("maps a world point onto the melamine's own units, top-left at 0 — what a stamp carries", () => {
    const G = resolveBoard({ ...rect, cx: 100, cy: -50 }, BOARD_REST, lamp);
    const [x0, y0] = toSurface(G, 100 - G.inner[0], -50 - G.inner[1]);
    expect(x0).toBeCloseTo(0, 9); expect(y0).toBeCloseTo(0, 9);
    const [x1, y1] = toSurface(G, 100 + G.inner[0], -50 + G.inner[1]);
    expect(x1).toBeCloseTo(surfaceSize(G)[0], 9); expect(y1).toBeCloseTo(surfaceSize(G)[1], 9);
  });

  it("rasters the melamine at scale 1 whatever the hold, at the density asked", () => {
    const G = resolveBoard(rect, { held: 1, ring: 0, fade: 1 }, lamp);
    expect(surfaceSize(G)[0]).toBeCloseTo(480 - 2 * BOARD.spec.frame * 1, 6);
    expect(rasterSize([462, 302], 4)).toEqual([1848, 1208]);
    expect(rasterSize([10.1, 0.2], 2)).toEqual([21, 1]);
  });

  it("paints no further than the board and its shadow — and takes in the pen when it is shown", () => {
    const G = resolveBoard(rect, BOARD_REST, lamp);
    const q = quadOf(G);
    const r = shadowReach(G);
    expect(q.x0).toBeCloseTo(-240 - r, 9); expect(q.x1).toBeCloseTo(240 + r, 9);
    const held = resolveBoard(rect, { held: 1, ring: 0, fade: 1 }, lamp);
    expect(shadowReach(held)).toBeGreaterThan(r);   // a lifted slab casts further and softer
    const withPen = quadOf(G, { x0: 0, y0: -900, x1: 900, y1: 0 });
    expect(withPen.y0).toBe(-900); expect(withPen.x1).toBe(900);
  });
});

describe("the open board's framing", () => {
  const vp = { width: 1440, height: 900 };
  it("fits the whole board above the tray with the pad clear, centred in what the tray leaves", () => {
    const f = BOARD.focus;
    const c = framing(rect, vp);
    expect(c.zoom).toBeCloseTo(Math.min((1440 - 2 * f.pad) / 480, (900 - 2 * f.pad - f.tray) / 320), 12);
    // the board's centre on screen
    expect((0 - c.x) * c.zoom).toBeCloseTo(720, 9);
    expect((0 - c.y) * c.zoom).toBeCloseTo((900 - f.tray) / 2, 9);
    // its edges inside the pad, above the tray
    expect((240 - c.x) * c.zoom).toBeLessThanOrEqual(1440 - f.pad + 1e-9);
    expect((160 - c.y) * c.zoom).toBeLessThanOrEqual(900 - f.tray - f.pad + 1e-9);
  });
  it("never flies past the band: a tiny board stops at the max zoom, a vast one at the min", () => {
    expect(framing({ cx: 0, cy: 0, w: 20, h: 10 }, vp).zoom).toBe(BOARD.focus.maxZoom);
    expect(framing({ cx: 0, cy: 0, w: 40000, h: 30000 }, vp).zoom).toBe(BOARD.focus.minZoom);
  });
});

describe("the pen's stamps", () => {
  const tool = markerTool([0.1, 0.2, 0.6], 0.97, TIPS.bullet);
  const draw = (seed: number, pts: ReadonlyArray<readonly [number, number, number]>) => {
    const b = new StrokeBuilder(tool, seed);
    pts.forEach(([x, y, t], i) => (i === 0 ? b.begin(x, y, t) : b.move(x, y, t)));
    b.end();
    return b.stamps();
  };
  const path = [[10, 10, 0], [40, 12, 30], [80, 30, 60], [120, 60, 90]] as const;

  it("are deterministic: the same samples make the same stamps — a stroke's stamps ARE the stroke", () => {
    expect(Array.from(draw(7, path))).toEqual(Array.from(draw(7, path)));
    expect(Array.from(draw(7, path))).not.toEqual(Array.from(draw(8, path)));   // the seed is the fibre
  });

  it("lie one pitch apart along the path, the tip's narrow half × k, clamped", () => {
    const s = draw(1, path);
    const n = s.length / STAMP_FLOATS;
    const pitch = pitchOf(TIPS.bullet);
    expect(pitch).toBeCloseTo(Math.min(BOARD.felt.pitch.max, Math.max(BOARD.felt.pitch.min, 1.35 * BOARD.felt.pitch.k)), 12);
    for (let i = 2; i < n; i++) {
      const d = Math.hypot((s[i * 8] as number) - (s[(i - 1) * 8] as number), (s[i * 8 + 1] as number) - (s[(i - 1) * 8 + 1] as number));
      expect(d).toBeLessThanOrEqual(pitch + 1e-3);
    }
    // the arc length runs up monotonically
    for (let i = 1; i < n; i++) expect(s[i * 8 + 4] as number).toBeGreaterThanOrEqual(s[(i - 1) * 8 + 4] as number);
  });

  it("run drier as the hand speeds up", () => {
    const slow = draw(1, [[0, 0, 0], [20, 0, 200], [40, 0, 400], [60, 0, 600]]);
    const fast = draw(1, [[0, 0, 0], [200, 0, 20], [400, 0, 40], [600, 0, 60]]);
    const lastFlow = (s: Float32Array) => s[s.length - STAMP_FLOATS + 5] as number;
    expect(lastFlow(slow)).toBeCloseTo(1, 3);
    expect(lastFlow(fast)).toBeLessThan(1 - BOARD.felt.dryLoss * 0.5);
  });

  it("bleed when the pen rests: past the delay the footprint grows toward 1 + grow", () => {
    const b = new StrokeBuilder(tool, 3);
    b.begin(5, 5, 1000);
    b.hold(1000 + BOARD.felt.bleed.after - 1);
    expect(b.count).toBe(1);
    b.hold(1000 + BOARD.felt.bleed.after + 10 * BOARD.felt.bleed.tau);
    const s = b.stamps();
    expect(s[s.length - STAMP_FLOATS + 6] as number).toBeCloseTo(1 + BOARD.felt.bleed.grow, 3);
  });

  it("hand out only what is new to the live upload, and everything to the history", () => {
    const b = new StrokeBuilder(tool, 3);
    b.begin(0, 0, 0);
    expect(b.pending().length).toBe(STAMP_FLOATS);
    b.move(10, 0, 10);
    const more = b.pending().length / STAMP_FLOATS;
    expect(more).toBeGreaterThan(5);
    expect(b.pending().length).toBe(0);
    expect(b.stamps().length / STAMP_FLOATS).toBe(1 + more);
  });

  it("read as a path for an agent — decimated, the last point kept", () => {
    const s = draw(1, path);
    const p = pathOf(s, 5);
    const n = s.length / STAMP_FLOATS;
    expect(p[0]).toEqual([10, 10]);
    expect(p[p.length - 1]).toEqual([s[(n - 1) * 8] as number, s[(n - 1) * 8 + 1] as number]);
  });

  it("the eraser is its own tool: the eraser's footprint, no ink", () => {
    expect(ERASER_TOOL.mode).toBe("erase");
    expect(ERASER_TOOL.tip.half).toEqual(BOARD.eraser.half);
    expect(ERASER_TOOL.tip.angle).toBeCloseTo((BOARD.eraser.angle * Math.PI) / 180, 12);
  });
});

describe("the history", () => {
  const stroke = (n: number) => ({ kind: "stroke" as const, tool: ERASER_TOOL, stamps: new Float32Array(STAMP_FLOATS * n) });
  it("undoes, redoes, and forgets the undone once something new is done", () => {
    const h = new BoardHistory();
    expect(h.canUndo).toBe(false);
    h.push(stroke(1)); h.push(stroke(2));
    const v = h.version;
    expect(h.undo()).toBe(true);
    expect(h.version).toBeGreaterThan(v);
    expect(h.done.length).toBe(1);
    expect(h.canRedo).toBe(true);
    expect(h.redo()).toBe(true);
    expect(h.done.length).toBe(2);
    h.undo();
    h.push(stroke(3));
    expect(h.canRedo).toBe(false);
    expect(h.done.map((o) => (o.kind === "stroke" ? o.stamps.length / STAMP_FLOATS : 0))).toEqual([1, 3]);
  });

  it("replays only what follows the last wipe; a wipe is itself undoable", () => {
    const h = new BoardHistory();
    h.push(stroke(1)); h.push({ kind: "wipe" }); h.push(stroke(2));
    expect(h.replay.length).toBe(1);
    h.undo(); h.undo();
    expect(h.replay.length).toBe(1);
    expect(h.inked).toBe(true);
    h.redo();
    expect(h.inked).toBe(false);
  });

  it("reads as strokes with their tool, ink and path", () => {
    const h = new BoardHistory();
    const b = new StrokeBuilder(markerTool([1, 0, 0], 0.96, TIPS.fine), 1);
    b.begin(1, 2, 0); b.move(30, 2, 20); b.end();
    h.push({ kind: "stroke", tool: b.tool, stamps: b.stamps(), ink: "red" });
    const r = h.read();
    expect(r).toHaveLength(1);
    expect(r[0]?.tool).toBe("marker");
    expect(r[0]?.ink).toBe("red");
    expect(r[0]?.path[0]).toEqual([1, 2]);
  });
});

describe("the records and the shaders", () => {
  it("lays every record out on 16 bytes, the stamp on the pen's eight floats", () => {
    for (const s of [Board, BoardUniforms, StampUniforms, InkUniforms]) expect(s.size % 16).toBe(0);
    expect(Stamp.size).toBe(STAMP_FLOATS * 4);
  });

  it("packs a board: its geometry, its raster, and what is in the hand", () => {
    const G = resolveBoard(rect, BOARD_REST, lamp);
    const v = boardValues({ id: 1, geometry: G, surface: [0.9, 0.9, 0.9], metal: [0.8, 0.8, 0.7], quad: quadOf(G) }, { size: [100, 50], density: 4, wet: false });
    expect(v.texels).toEqual([100, 50]);
    expect(v.laying).toBe(0);
    expect(v.pen).toEqual([0, 0, 0, 0]);      // no pen: nothing drawn for it
    expect(v.eraser).toEqual([0, 0, 0, 0]);
    const held = boardValues({ id: 1, geometry: G, surface: [0.9, 0.9, 0.9], metal: [0.8, 0.8, 0.7], quad: quadOf(G), pen: { x: 3, y: 4, angle: -0.9, height: 6, rise: 0.18, cap: 1, nib: 1.35, presence: 1, ink: [0.8, 0.1, 0.1] } }, { size: [100, 50], density: 4, wet: true });
    expect(held.pen).toEqual([3, 4, -0.9, 1]);
    expect(held.penPose).toEqual([6, 0.18, 1, 1.35]);
    expect(held.wet).toBe(1);
    const buf = Board.alloc(1);
    expect(() => buf.set(v)).not.toThrow();
  });

  it("composes: the board's modules are pure and every program names a field its structs have", () => {
    const here = resolve(import.meta.dirname, "..", "shaders");
    const read = (f: string) => readFileSync(join(here, f), "utf8");
    const src = boardShaders({ portal: read("portal.wgsl"), primitives: read("primitives.wgsl"), mat: read("mat/mat.wgsl"), felt: read("board/felt.wgsl"), board: read("board/board.wgsl"), boardPass: read("board/board-pass.wgsl"), stamp: read("board/stamp.wgsl"), ink: read("board/ink.wgsl"), mip: read("board/mip.wgsl") });
    const board = compose({ structs: [MatUniforms, BoardUniforms, Board], modules: src.board.modules, entry: src.board.entry });
    expect(() => compose({ structs: [StampUniforms, Stamp], modules: src.stamp.modules, entry: src.stamp.entry })).not.toThrow();
    // no WGSL reserved word hides as a field (the compiler says it; this says it without a GPU)
    for (const s of [Board, BoardUniforms, StampUniforms]) for (const [f] of s.fields) expect(["cast", "active", "filter", "sample", "target", "handle", "layout"]).not.toContain(f);
    for (const m of board.code.matchAll(/\bB\.(\w+)/g)) expect(Board.fields.map(([f]) => f)).toContain(m[1]);
    for (const m of board.code.matchAll(/\bk\.(\w+)/g)) expect(BoardUniforms.fields.map(([f]) => f)).toContain(m[1]);
  });
});
