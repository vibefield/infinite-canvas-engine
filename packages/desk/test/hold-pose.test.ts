// @vitest-environment node
// THE HAND'S POSE (design-015 §8; D4b) — desk.js `HOLD` · `heldTarget` · `heldPose`, number for number: the
// reading size fits the open extent inside the margins and above the bar's band, never past 3×, whatever the
// zoom; a portrait phone opens a spread one page at a time when a page reads 1.3× larger; the pose between
// the desk and the hand lerps its position, grows in LOG scale and lets the tilt go; the pose IS a camera
// (a flat kind's camera maps the extent to the held rect exactly; an eye kind keeps the desk's zoom and
// rises by `grow`); the frame the pose seam publishes is the shown extent; the focus follows the carry.
import { describe, expect, it } from "vitest";
import { carryOf, focusOf, HELD_USER_REST, heldCamera, heldFrame, heldPose, HOLD, homePose, readingTarget } from "../src/hold/pose";
import { easeIsland } from "../src/marks/ease";
import { boardKind, calendarKind, notebookKind } from "../src/kinds";

const VP = { width: 1200, height: 800 };
const PHONE = { width: 390, height: 844 };
const near = (a: number, b: number, eps = 1e-9): void => { expect(Math.abs(a - b)).toBeLessThanOrEqual(eps); };

describe("the reading size (desk.js heldTarget)", () => {
  it("fits the extent inside 56 px margins and above the 72 px band, never past 3×, centred in the box", () => {
    // a notebook's spread: 360 × 252 → the height binds: (800 − 56 − 72) / 252 = 2.6667
    const t = readingTarget({ cx: 0, cy: 0, w: 360, h: 252 }, VP, true);
    near(t.s, 672 / 252);
    near(t.cx, 600);
    near(t.cy, 56 + 672 / 2);
    expect(t.single).toBe(false);
    // a small board far below 3× of the box: capped at 3
    expect(readingTarget({ cx: 0, cy: 0, w: 100, h: 60 }, VP).s).toBe(HOLD.max);
    // a wide board: the width binds — (1200 − 112) / 2000
    near(readingTarget({ cx: 0, cy: 0, w: 2000, h: 300 }, VP).s, 1088 / 2000);
  });

  it("the zoom you were at no longer matters: the target reads the extent and the view alone", () => {
    const a = readingTarget({ cx: 100, cy: 200, w: 360, h: 252 }, VP, true);
    const b = readingTarget({ cx: -9000, cy: 5, w: 360, h: 252 }, VP, true);
    expect(a).toEqual(b);
  });

  it("a portrait phone opens a spread on its right page when one page reads 1.3× larger; the page is centred, the phone's margins apply", () => {
    const t = readingTarget({ cx: 0, cy: 0, w: 360, h: 252 }, PHONE, true);
    // whole spread: min((390 − 32)/360, (844 − 60 − 72)/252, 3) = min(0.994, 2.825, 3) = 0.994; one page: min(358/180, 2.825, 3) = 1.989 > 1.3 × 0.994
    expect(t.single).toBe(true);
    near(t.s, 358 / 180);
    // the extent's centre a quarter of its width left of the middle → the RIGHT page centred
    near(t.cx, 195 - (360 / 4) * (358 / 180));
    near(t.cy, 60 + 712 / 2);
    // a board is never a spread: whole on the phone
    expect(readingTarget({ cx: 0, cy: 0, w: 360, h: 252 }, PHONE, false).single).toBe(false);
  });
});

describe("the pose between the desk and the hand (desk.js heldPose)", () => {
  const cam = { x: -100, y: 50, zoom: 0.5 };
  const extent = { cx: 300, cy: 400, w: 360, h: 252 };
  const home = homePose(extent, 0.08, cam);
  const target = readingTarget(extent, VP, true);

  it("at e = 0 the pose is the desk's (the extent where the camera draws it, at the zoom, turned); at e = 1 the reading pose, square", () => {
    near(home.cx, (300 + 100) * 0.5);
    near(home.cy, (400 - 50) * 0.5);
    const p0 = heldPose(home, target, HELD_USER_REST, 0);
    expect(p0).toEqual({ cx: home.cx, cy: home.cy, s: 0.5, angle: 0.08, e: 0 });
    const p1 = heldPose(home, target, HELD_USER_REST, 1);
    near(p1.cx, target.cx);
    near(p1.cy, target.cy);
    near(p1.s, target.s);
    expect(p1.angle).toBe(0);
  });

  it("between: the position lerps by e, the size grows in LOG scale, the tilt lets go linearly", () => {
    const e = 0.42;
    const p = heldPose(home, target, HELD_USER_REST, e);
    near(p.cx, home.cx + (target.cx - home.cx) * e);
    near(p.s, Math.exp(Math.log(0.5) + (Math.log(target.s) - Math.log(0.5)) * e));
    near(p.angle, 0.08 * (1 - e));
    // log, not linear: the half-way size is the geometric mean
    near(heldPose(home, target, HELD_USER_REST, 0.5).s, Math.sqrt(0.5 * target.s));
  });

  it("the user's zoom scales the reading size and the pan moves it, both riding on e", () => {
    const p = heldPose(home, target, { zoom: 2, panX: 30, panY: -10 }, 1);
    near(p.s, target.s * 2);
    near(p.cx, target.cx + 30);
    near(p.cy, target.cy - 10);
  });

  it("the carry is the island ease of the pickup's progress", () => {
    expect(carryOf(0)).toBe(0);
    expect(carryOf(1)).toBe(1);
    near(carryOf(0.42), easeIsland(0.42));
    expect(carryOf(0.42)).toBeGreaterThan(0.42);   // the island curve leads
  });
});

describe("the pose IS a camera (the plan's D4b ruling)", () => {
  const rect = { cx: 300, cy: 400, w: 180, h: 252 };
  const extent = { cx: 210, cy: 400, w: 360, h: 252 };   // the spread, left of the spine
  const cam = { x: 0, y: 0, zoom: 1 };
  const target = readingTarget(extent, VP, true);
  const pose = heldPose(homePose(extent, 0.08, cam), target, HELD_USER_REST, 1);

  it("a flat kind: the camera's zoom is the pose's scale and it maps the extent's centre to the pose exactly", () => {
    const { cam: c, grow } = heldCamera(pose, rect, extent, cam.zoom, false, VP);
    expect(grow).toBe(1);
    near(c.zoom, pose.s);
    // the extent's centre on screen under this camera
    near((extent.cx - c.x) * c.zoom, pose.cx, 1e-6);
    near((extent.cy - c.y) * c.zoom, pose.cy, 1e-6);
  });

  it("an eye kind keeps the desk's zoom and grows by the rest — the rect's centre at H·(1 − 1/grow) lands on the pose through the eye", () => {
    const { cam: c, grow } = heldCamera(pose, rect, extent, cam.zoom, true, VP);
    expect(c.zoom).toBe(1);
    near(grow, pose.s);
    // the eye stands over the view's centre E: a point at rising height z lands at vw/2 + (p − E)·grow·zoom
    const ex = c.x + VP.width / (2 * c.zoom);
    const ey = c.y + VP.height / (2 * c.zoom);
    const sx = VP.width / 2 + (rect.cx - ex) * grow * c.zoom;
    const sy = VP.height / 2 + (rect.cy - ey) * grow * c.zoom;
    // the rect's centre lies half a case-width right of the extent's centre (the angle is 0 at e = 1)
    near(sx, pose.cx + (rect.w / 2) * pose.s, 1e-6);
    near(sy, pose.cy, 1e-6);
  });

  it("an eye kind picked up from very close zooms OUT with the camera and grows nothing", () => {
    const close = { x: 200, y: 300, zoom: 6 };
    const p = heldPose(homePose(extent, 0, close), target, HELD_USER_REST, 1);
    const { cam: c, grow } = heldCamera(p, rect, extent, close.zoom, true, VP);
    expect(grow).toBe(1);
    near(c.zoom, p.s);
  });

  it("the frame the pose seam publishes is the shown extent — the spread, or the right page alone on a phone", () => {
    const f = heldFrame(pose, extent, false);
    near(f.cx, pose.cx);
    near(f.hx, 180 * pose.s);
    near(f.hy, 126 * pose.s);
    near(f.s, pose.s);
    const one = heldFrame(pose, extent, true);
    near(one.cx, pose.cx + 90 * pose.s);
    near(one.hx, 90 * pose.s);
  });

  it("the focus follows the carry: 14 px and 8 % at e = 1 (10 px on a phone), half of each half-way", () => {
    expect(focusOf(1, VP)).toEqual({ blur: 14, dim: 0.08 });
    expect(focusOf(0.5, VP)).toEqual({ blur: 7, dim: 0.04 });
    expect(focusOf(1, PHONE).blur).toBe(10);
    expect(focusOf(0, VP)).toEqual({ blur: 0, dim: 0 });
  });
});

describe("the kinds' openings (design-015 §8's contract)", () => {
  it("the notebook opens a spread twice its width left of the spine under the eye; the board and the calendar their own rect, flat; a note and a mini mat have none", () => {
    const nb = notebookKind();
    const rect = { cx: 300, cy: 400, w: 180, h: 252 };
    expect(nb.open?.pose).toBe("eye");
    expect(nb.open?.spread).toBe(true);
    expect(nb.open?.extent({ rect, props: {} })).toEqual({ cx: 210, cy: 400, w: 360, h: 252 });
    // D3t-b: live — ‹ ›, the four pens (the note's), undo and redo (keys only)
    expect(nb.open?.tools?.map((t) => t.id)).toEqual(["turn:-1", "turn:1", "pen:felt", "pen:ball", "pen:fountain", "pen:red", "undo", "redo"]);
    const bd = boardKind();
    expect(bd.open?.pose).toBeUndefined();
    expect(bd.open?.extent({ rect, props: {} })).toEqual(rect);
    // D3t-a: the board's tools are live — four markers and the eraser (modes), undo and redo; the tip and the wipe on keys alone
    expect(bd.open?.tools?.map((t) => t.id)).toEqual(["marker:black", "marker:blue", "marker:red", "marker:green", "eraser", "undo", "redo", "tip", "wipe"]);
    expect(bd.open?.tools?.filter((t) => t.bar !== false).map((t) => t.id)).toEqual(["marker:black", "marker:blue", "marker:red", "marker:green", "eraser", "undo", "redo"]);
    const cal = calendarKind();
    expect(cal.open?.extent({ rect, props: {} })).toEqual(rect);
    expect(cal.open?.tools?.map((t) => t.id)).toEqual(["month:-1", "month:1", "today", "pen"]);
  });
});
