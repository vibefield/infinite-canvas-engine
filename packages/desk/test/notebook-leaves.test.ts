// @vitest-environment node
// THE LEAVES IN HAND (NOTEBOOK.md §6–7; design-015 §8; D3t-b): the turns are the kind's PARTS — a page's outer 30 % is `turn`,
// core's held input makes a press there the kind's (`HeldPress` "part"), never a tap that puts the book down. Through the REAL
// stack: the keys' and the bar's ‹ › are counted on the book and the hand turns by the count; a click there turns (the right on,
// the left back — two clicks turn two); a pinch that travels takes the sheet and it follows the hand over the gutter, going past
// the vertical and falling back short of it; every completed turn moves the durable `spread` in ONE transaction, OFF the undo
// stack; the kind heads for the spread asked one sheet a frame (a run of turns fans); the right page's corner peeks under the
// pointer; a portrait phone reads page by page; put down and picked up again, the book opens where it was, its ink with it.
import { guardedTransaction, heldEntity } from "@ice/core";
import { describe, expect, it } from "vitest";
import { heldFrame, readingTarget } from "../src/hold/pose";
import { addStroke } from "../src/objects";
import { must } from "./must";
import { bookRig } from "./notebook-rig";

type Rig = ReturnType<typeof bookRig>;
const airs = (r: Rig) => (r.books.state(r.book).motion?.sheets ?? []).filter((q) => q.air);
const click = (r: Rig, x: number, y: number): void => {
  const [sx, sy] = r.screen(x, y);
  r.mouse("move", sx, sy, 0); r.frame();
  r.mouse("down", sx, sy, 1); r.frame();
  r.mouse("up", sx, sy, 0); r.frame();
};
/** Frames until the sheets land (a turn is well under two seconds). */
const land = (r: Rig): void => { for (let i = 0; i < 150 && airs(r).length > 0; i++) r.frame(); };
/** The right page's outer share (a turn), the left page's, the right page's tail corner — desk points of the book in hand. */
const RIGHT_TURN = [60, 0] as const;
const LEFT_TURN = [-262, 0] as const;
const CORNER = [72, 104] as const;

describe("the turns by the keys and the bar: counted on the book, the hand turns by the count", () => {
  it("› flies a sheet and moves the spread in ONE transaction; three at once are one transaction and a sheet a frame (they fan); ⌘Z takes back ink, never a page", async () => {
    const r = bookRig();
    r.open();
    // a stroke laid (an undoable step) before the turns
    guardedTransaction(must(r.ce.docs.current()).store, r.ce.world, (tx) => { addStroke(tx, r.book, { tool: "pen", page: 1, points: [[20, 40], [40, 45]], times: [0, 16] }); });
    r.ce.ops.useHeldTool("turn:1");
    r.frame();
    expect(r.books.state(r.book).pending).toBe(1);
    r.frame();
    expect(airs(r)).toHaveLength(1);
    await r.settle();
    expect(r.spread()).toBe(1);
    expect(r.hand.turns()).toBe(1);
    expect(r.books.state(r.book).pending).toBeNull();
    land(r);
    for (let i = 0; i < 3; i++) r.ce.ops.useHeldTool("turn:1");
    r.frame();
    await r.settle();
    expect(r.spread()).toBe(4);
    expect(r.hand.turns()).toBe(2);
    r.frame(); r.frame();
    const flying = airs(r);
    expect(flying).toHaveLength(3);
    expect(new Set(flying.map((q) => q.phi.toFixed(4))).size).toBe(3);   // lifted a frame apart: a fan, not one sheet thrice
    land(r);
    expect(r.books.state(r.book).motion?.sheets.filter((q) => q.side === 1)).toHaveLength(4);
    // the document's undo walks the ink: the stroke goes, the spread stays
    r.ce.docs.undo();
    r.ce.world.sync();
    expect(r.strokes()).toHaveLength(0);
    expect(r.spread()).toBe(4);
    // ‹ back one; never past the front (the count moves, the spread clamps)
    for (let i = 0; i < 6; i++) r.ce.ops.useHeldTool("turn:-1");
    r.frame();
    await r.settle();
    expect(r.spread()).toBe(0);
  });
});

describe("the turns by the hand: a click, a pinch that travels", () => {
  it("a click on the right page's outer 30 % turns a page on, on the left's a page back; two clicks turn two — the book stays in hand", async () => {
    const r = bookRig();
    r.open();
    const [tx, ty] = r.screen(...RIGHT_TURN);
    r.mouse("move", tx, ty, 0); r.frame();
    expect(r.partUnder()).toBe("turn");
    click(r, ...RIGHT_TURN);
    click(r, ...RIGHT_TURN);
    await r.settle();
    expect(r.spread()).toBe(2);
    expect(heldEntity(r.ce.world)).toBe(r.book);
    land(r);
    click(r, ...LEFT_TURN);
    await r.settle();
    expect(r.spread()).toBe(1);
    expect(r.hand.turns()).toBeGreaterThanOrEqual(2);
  });

  it("a pinch that travels takes the sheet: it follows the hand over the gutter and goes — ONE transaction; short of the vertical it falls back, nothing written", async () => {
    const r = bookRig();
    r.open();
    const drag = (to: number, frames: number): void => {
      const [ax, ay] = r.screen(...RIGHT_TURN);
      r.mouse("move", ax, ay, 0); r.frame();
      r.mouse("down", ax, ay, 1); r.frame();
      for (let i = 1; i <= frames; i++) { const [x, y] = r.screen(RIGHT_TURN[0] + ((to - RIGHT_TURN[0]) * i) / frames, 0); r.mouse("move", x, y, 1); r.frame(); }
    };
    drag(-200, 12);
    const held = r.hand.turning();
    expect(held).toMatchObject({ book: r.book, side: 0 });
    expect(held?.sheet).toBe(0);
    const s = must(r.books.state(r.book).motion?.sheets[0]);
    expect(s.held && s.grip > Math.PI / 2).toBe(true);   // over the gutter, in the hand
    expect(r.hand.turns()).toBe(0);
    const [bx, by] = r.screen(-200, 0);
    r.mouse("up", bx, by, 0); r.frame();
    await r.settle();
    expect(r.spread()).toBe(1);
    expect(r.hand.turns()).toBe(1);
    land(r);
    // short of the vertical: it falls back
    drag(40, 4);
    r.frame(); r.frame();
    const [cx, cy] = r.screen(40, 0);
    r.mouse("up", cx, cy, 0); r.frame();
    await r.settle();
    land(r);
    expect(r.spread()).toBe(1);
    expect(r.hand.turns()).toBe(1);
    expect(r.books.state(r.book).motion?.sheets[1]?.side).toBe(0);
  });

  it("over the right page's fore-edge corner the corner peeks — a sheet lifted at its corner — and lies down when the pointer leaves", () => {
    const r = bookRig();
    r.open();
    const [px, py] = r.screen(...CORNER);
    r.mouse("move", px, py, 0);
    for (let i = 0; i < 30; i++) r.frame();
    const m = must(r.books.state(r.book).motion);
    expect(m.peekOn).toBe(true);
    expect(m.peekSide).toBe(1);
    expect(m.peek).toBeGreaterThan(0.9);
    expect(r.geometry().pose.airs).toHaveLength(1);   // the peek is a sheet in the air at its corner
    const [qx, qy] = r.screen(-40, 0);
    r.mouse("move", qx, qy, 0);
    for (let i = 0; i < 60; i++) r.frame();
    expect(m.peekOn).toBe(false);
    expect(r.geometry().pose.airs).toHaveLength(0);
  });
});

describe("a portrait phone reads page by page (D4b's `spread`: one page in view)", () => {
  it("› from the right page turns its sheet and the view follows it to its verso; › again, the right page; ‹ the other way round", async () => {
    const r = bookRig({}, { w: 390, h: 844 });
    r.open();
    const face = () => r.books.state(r.book).faceT;
    r.ce.ops.useHeldTool("turn:1"); r.frame(); await r.settle();
    expect([r.spread(), face()]).toEqual([1, 1]);   // page 2 — sheet 0's verso, on the left
    r.ce.ops.useHeldTool("turn:1"); r.frame(); await r.settle();
    expect([r.spread(), face()]).toEqual([1, 0]);   // page 3 — the right page of the same spread
    r.ce.ops.useHeldTool("turn:-1"); r.frame(); await r.settle();
    expect([r.spread(), face()]).toEqual([1, 1]);   // page 2 again
    r.ce.ops.useHeldTool("turn:-1"); r.frame(); await r.settle();
    expect([r.spread(), face()]).toEqual([0, 0]);   // page 1: the sheet back, the view with it
    for (let i = 0; i < 90; i++) r.frame();
    expect(r.books.state(r.book).face).toBe(0);
    // the pose centres the page in view: the right page (face 0) a quarter-width right of the spread's centre, the left (face 1) left
    const extent = { cx: -90, cy: 0, w: 360, h: 252 };
    const vp = { width: 390, height: 844 };
    const t0 = readingTarget(extent, vp, true, 0);
    const t1 = readingTarget(extent, vp, true, 1);
    expect(t0.single && t1.single).toBe(true);
    expect(t1.cx - t0.cx).toBeCloseTo(180 * t0.s, 9);
    const pose = { cx: t1.cx, cy: t1.cy, s: t1.s, angle: 0, e: 1 };
    expect(heldFrame(pose, extent, true, 1).cx).toBeCloseTo(390 / 2, 9);   // the left page, centred
    expect(heldFrame(pose, extent, true, 0).cx).toBeCloseTo(390 / 2 + 180 * t1.s, 9);
  });
});

describe("put down and picked up again", () => {
  it("the book opens at its spread — the sheets where the document says — and its ink is where it was", async () => {
    const r = bookRig({ spread: 3 });
    r.open();
    guardedTransaction(must(r.ce.docs.current()).store, r.ce.world, (tx) => { addStroke(tx, r.book, { tool: "pen", page: 7, points: [[30, 60], [60, 70]], times: [0, 16] }); });
    r.ce.world.sync();
    r.frame();
    expect(r.books.pages.rasterOf(r.books.state(r.book).id, 7)).toBeDefined();   // sheet 3's recto: the right page at spread 3
    r.ce.ops.putDown();
    r.frame(); r.frame();
    expect(r.books.state(r.book).motion).toBeNull();
    r.ce.ops.open(r.book);
    r.frame(); r.frame();
    const m = must(r.books.state(r.book).motion);
    expect(m.sheets.filter((q) => q.side === 1)).toHaveLength(3);
    expect(airs(r)).toHaveLength(0);
    const rec = r.geometry();
    expect(rec.pose.rightTop).toBe(3);
    expect(r.books.strokesOn(r.book, 7)).toHaveLength(1);
  });
});
