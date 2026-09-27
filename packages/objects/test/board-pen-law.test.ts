// THE MARKER'S LAW (BOARD.md §5 — lab/board.ts `poseOf` and `step`, number for number; D3t-a): at rest it lies capped where
// `boardRest` draws it; taken up (take 1) its nib is at the hand, turned to a right hand's angle, its cap posted, present where
// the hand is over the board; hovering, it stands `pen.hover` off the melamine (its shadow off the nib); pressed, they meet.
// The springs: taken up only while held and open and not erasing, the eraser rubbing at the hand instead; a still snaps them.
import { describe, expect, it } from "vitest";
import { resolveBoard } from "../src/board/board";
import { followHand, HAND_ANGLE, handOnMelamine, penAtRest, penPose, stepPen } from "../src/board/pen";
import { boardKind, type BoardObjectLook, boardRest } from "../src/board/kind";
import { lampOf } from "../src/paper/paper";
import { MAT_GRID } from "@ice/desk";
import { BOARD } from "../src/board/theme";
import { BOARD_LOOK, MARKERS, PALETTE } from "../oracle/fixtures/vf-theme";
import { must } from "../../desk/test/must";

const palette = { ...PALETTE.light, board: BOARD_LOOK, markers: MARKERS };
const look = must(boardKind().theme)(palette, "light") as BoardObjectLook;
const G = resolveBoard({ cx: 340, cy: 260, w: 480, h: 320 }, { held: 0, ring: 0, fade: 1 }, lampOf(MAT_GRID.plane));
const INK: [number, number, number] = [0.2, 0.3, 0.8];

describe("the marker's pose (board/pen.ts)", () => {
  it("at rest the pen lies where boardRest draws it — the same record", () => {
    const rest = boardRest(G, 480, 320, "bullet", INK, look);
    expect(penPose(G, 480, 320, "bullet", INK, penAtRest(), null).pen).toEqual(rest.pen);
    expect(penPose(G, 480, 320, "bullet", INK, penAtRest(), [100, 100]).pen).toEqual(rest.pen);   // at rest the hand is nowhere
  });

  it("taken up: the nib at the hand, a right hand's angle, the cap posted, present over the board; hovering it stands off, pressed it meets", () => {
    const s = { ...penAtRest(), take: 1, shown: 1 };
    const hover = penPose(G, 480, 320, "fine", INK, s, [300, 240]).pen;
    expect([hover.x, hover.y]).toEqual([300, 240]);
    expect(hover.angle).toBeCloseTo(HAND_ANGLE, 12);
    expect(hover.cap).toBe(1);
    expect(hover.presence).toBe(1);
    expect(hover.height).toBeCloseTo(BOARD.pen.hover, 9);
    const pressed = penPose(G, 480, 320, "fine", INK, { ...s, press: 1 }, [300, 240]).pen;
    expect(pressed.height).toBeCloseTo(0, 9);
    const away = penPose(G, 480, 320, "fine", INK, { ...s, shown: 0 }, [300, 240]).pen;
    expect(away.presence).toBe(0);   // off the melamine the pen is not drawn — the OS cursor is the desk's again
    // the hand is kept on the melamine
    expect(handOnMelamine(G, [10_000, -10_000])).toEqual([G.centre[0] + G.inner[0], G.centre[1] - G.inner[1]]);
  });

  it("the eraser rubs at the hand while the marker lies down; the quad takes both in", () => {
    const s = { ...penAtRest(), rub: 1 };
    const p = penPose(G, 480, 320, "bullet", INK, s, [300, 240]);
    expect(p.eraser).toEqual({ x: 300, y: 240, height: BOARD.pen.hover, presence: 1 });
    expect(p.pen).toEqual(boardRest(G, 480, 320, "bullet", INK, look).pen);
    expect(p.box.x0).toBeLessThanOrEqual(300 - 60);
  });

  it("the springs: taken up only held and open and not erasing; shown over the board; pressed while laying; a still snaps", () => {
    const s = penAtRest();
    let t = 0;
    while (stepPen(s, { held: true, erasing: false, over: true, pressing: false }, 1 / 60) && t < 600) t++;
    expect([s.take, s.shown, s.press, s.rub]).toEqual([1, 1, 0, 0]);
    expect(t * (1 / 60)).toBeLessThan(1.2);   // 2.4 Hz critically damped: in hand well within the pickup's second
    stepPen(s, { held: true, erasing: true, over: true, pressing: false }, 0, true);
    expect([s.take, s.shown, s.rub]).toEqual([0, 0, 1]);
    stepPen(s, { held: true, erasing: false, over: true, pressing: true }, 0, true);
    expect([s.take, s.press]).toEqual([1, 1]);
    stepPen(s, { held: false, erasing: false, over: true, pressing: true }, 0, true);   // flying home: it lies down
    expect([s.take, s.shown, s.press]).toEqual([0, 0, 0]);
  });

  it("the lean follows the hand's speed across the barrel, half as much hovering, and dies away when the hand stops", () => {
    const s = { ...penAtRest(), take: 1 };
    followHand(s, -30, -20, 1 / 60);   // up and to the left: across the barrel
    stepPen(s, { held: true, erasing: false, over: true, pressing: true }, 1 / 60);
    expect(s.lean).toBeGreaterThan(0);
    for (let i = 0; i < 240; i++) stepPen(s, { held: true, erasing: false, over: true, pressing: true }, 1 / 60);
    expect(Math.abs(s.lean)).toBeLessThan(1e-3);
  });
});
