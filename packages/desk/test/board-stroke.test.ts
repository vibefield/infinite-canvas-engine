// @vitest-environment node
// A STROKE'S PACE (D3t-a — `desk.stroke` v2): a stroke laid by hand keeps each sample's time, `times` (base64 LE f32 ms from the
// first — the D-D3w.2 codec), so the replay feeds the pen exactly what the hand did: a sample repeating its point is the pen
// RESTING (its bleed), the last is the lift. Laid live and replayed, a stroke's stamps are the same bytes. `speed` stays: a v1
// stroke (no `times` — the migration's empty string) replays by distance / speed exactly as before, and a v2 stroke carries its
// mean pace there. The Board declares its strokes as its DATA, so the catalog stamps `desk.stroke@2` and gates it.
import { createCanvasEngine, dataPrefabFor, durablePrefabFor } from "@ice/core";
import { describe, expect, it } from "vitest";
import { linear } from "../src/mat/night";
import { BOARD } from "../src/theme";
import { markerTool, StrokeBuilder, TIPS } from "../src/board/stroke";
import { Board, boardOps, decodeTimes, encodePoints, encodeTimes, feedStroke, meanSpeed, StrokePrefab, strokeRow, strokeSeed } from "../src/objects";

const TOOL = markerTool([0.1, 0.2, 0.6], 0.9, TIPS.bullet);
const f = Math.fround;

describe("the stroke's times (desk.stroke v2)", () => {
  it("the codec: LE f32 bits in unpadded base64, one per sample; an old stroke's empty string is none", () => {
    expect(encodeTimes([1, 2])).toBe("AACAPwAAAEA");   // the same bits as the path [[1, 2]]
    expect(encodeTimes([1, 2])).toBe(encodePoints([[1, 2]]));
    expect(decodeTimes(encodeTimes([0, 16.6, 1234.5]))).toEqual([0, f(16.6), f(1234.5)]);
    expect(decodeTimes("")).toEqual([]);
  });

  it("a timed row: the times kept, `speed` its mean pace; a mismatched count is no timing", () => {
    const row = strokeRow({ points: [[0, 0], [30, 40]], times: [0, 100] });
    expect(decodeTimes(row.times)).toEqual([0, 100]);
    expect(row.speed).toBe(500);
    expect(meanSpeed([[0, 0]], [0])).toBe(400);
    const odd = strokeRow({ points: [[0, 0], [30, 40]], times: [0] });
    expect(odd.times).toBe("");
    expect(odd.speed).toBe(400);
  });

  it("the pen fed live and the same stroke replayed lay the same stamps — a resting pen bleeds, the lift never does", () => {
    // the hand as the live pen sees it, frame by frame: press, two moves, a rest long enough to bleed, a move, the lift where it stopped
    const samples: [number, number, number][] = [[10, 10, 0], [20, 12, 16], [20, 12, 33], [20, 12, 200], [20, 12, 216], [40, 20, 233], [40, 20, 250]];
    const live = new StrokeBuilder(TOOL, strokeSeed(3));
    samples.forEach(([x, y, t], i) => {
      if (i === 0) live.begin(x, y, t);
      else if (i === samples.length - 1) live.end(x, y, t);
      else { const [px, py] = samples[i - 1] as [number, number, number]; if (x === px && y === py) live.hold(t); else live.move(x, y, t); }
    });
    const replayed = new StrokeBuilder(TOOL, strokeSeed(3));
    feedStroke(replayed, samples.map(([x, y]) => [x, y] as const), samples.map(([, , t]) => t), 400);
    expect(Array.from(replayed.stamps())).toEqual(Array.from(live.stamps()));
    // the rest bled: a stamp past `bleed.after` at the resting point grown past 1
    const S = replayed.stamps();
    const sizes: number[] = [];
    for (let i = 0; i < S.length / 8; i++) sizes.push(S[i * 8 + 6] as number);
    expect(Math.max(...sizes)).toBeGreaterThan(1);
    expect(BOARD.felt.bleed.after).toBeLessThan(200 - 16);
  });

  it("an old stroke (no times) replays by distance / speed exactly as the bench's `sketch`; the timed one differs by its own pace", () => {
    const points: [number, number][] = [[40, 60], [90, 48], [150, 52], [200, 70]];
    const old = boardOps([{ tool: "marker", ink: "blue", tip: "bullet", erase: false, points: encodePoints(points), speed: 400, times: "" }], { blue: { color: [0.1, 0.2, 0.6], opacity: 0.9 } });
    // the bench's loop, as frame.mjs `opsOf` still lays it
    const bench = new StrokeBuilder(markerTool(linear([0.1, 0.2, 0.6]), 0.9, TIPS.bullet), strokeSeed(0));
    let t = 0;
    points.forEach(([x, y], i) => { if (i === 0) { bench.begin(x, y, t); return; } const [px, py] = points[i - 1] as [number, number]; t += (Math.hypot(x - px, y - py) / 400) * 1000; bench.move(x, y, t); });
    bench.end();
    const op = old[0];
    expect(op?.kind).toBe("stroke");
    expect(op?.kind === "stroke" ? Array.from(op.stamps) : []).toEqual(Array.from(bench.stamps()));
    const fast = boardOps([{ ...strokeRow({ ink: "blue", points, times: [0, 5, 10, 15] }) }], { blue: { color: [0.1, 0.2, 0.6], opacity: 0.9 } });
    const a = op?.kind === "stroke" ? op.stamps : new Float32Array();
    const b = fast[0]?.kind === "stroke" ? fast[0].stamps : new Float32Array();
    expect(Array.from(a)).not.toEqual(Array.from(b));   // a hand ten times faster runs the felt dry
  });

  it("the Board declares its strokes as its data: the catalog stamps desk.stroke@2; a v1 stroke migrates keeping its speed", () => {
    expect(Board.data).toEqual([StrokePrefab]);
    expect(StrokePrefab.version).toBe(2);
    const ce = createCanvasEngine({ widgets: [Board] });
    ce.docs.create();
    const report = ce.docs.current()?.versionReport();
    expect(report?.localPacks["desk.stroke"]).toBe(2);
    expect(report?.docPacks["desk.stroke"]).toBe(2);
    expect(durablePrefabFor(ce.world, "desk.stroke")).toBe(StrokePrefab);
    expect(dataPrefabFor(ce.world, "desk.stroke")).toBe(StrokePrefab);
    const v1 = { tool: "marker", ink: "red", tip: "fine", erase: false, points: encodePoints([[1, 2]]), speed: 250 };
    expect(StrokePrefab.migrate?.[1]?.(v1)).toEqual({ ...v1, times: "" });
  });
});
