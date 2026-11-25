/**
 * The LOOK camera (petition I58, `ops.lookAt`): kernel `lookCamera` centres a target in what the person
 * can see (the viewport less the host's inset) at the zoom its policy gives. Pinned:
 *  - `"keep"` keeps the zoom; a number is that zoom;
 *  - `"comfort"` keeps a zoom the target reads at (≥ the band's floor) and fits at; below the floor it
 *    zooms in to the floor and never past 100%; a target too big for the zoom is zoomed out until it fits;
 *  - `"fit"` lands in the band as `fitCamera`'s does; the pad is SCREEN px, on screen at every zoom;
 *  - the inset moves the centre and shrinks the room the fit is measured in; insets that leave no room
 *    are ignored, and a pad is never more than a quarter of the room;
 *  - CameraLimits clamp every result, and the band meets them as `frameContent`'s does.
 */
import { describe, expect, it } from "vitest";
import { fitCamera, lookCamera, worldToScreen, type CameraState, type LookCameraOpts } from "../src/coords";
import type { Rect } from "../src/shapes";
import { inRange, makePrng } from "./prng";

const VP = { w: 800, h: 600 };
/** FIT_DEFAULTS' band and pad, and core's default CameraLimits. */
const BAND = { minZoom: 0.5, maxZoom: 1 };
const LIMITS = { minZoom: 0.1, maxZoom: 5 };
/** Centre (200, 150); with 80 screen px round it, it fits up to zoom min(640/200, 440/100) = 3.2. */
const CARD: Rect = { x: 100, y: 100, width: 200, height: 100 };

function look(target: Rect, from: number, zoom: LookCameraOpts["zoom"], more: Partial<LookCameraOpts> = {}): CameraState {
  return lookCamera(target, from, VP.w, VP.h, { zoom, pad: 80, band: BAND, limits: LIMITS, ...more });
}

/** Where the target's centre lands on screen under `cam`. */
function centreOnScreen(target: Rect, cam: CameraState): { x: number; y: number } {
  return worldToScreen(target.x + target.width / 2, target.y + target.height / 2, cam);
}

describe("lookCamera: keep and a number", () => {
  it("keep: the zoom stays and the target's centre is the view's", () => {
    expect(look(CARD, 0.8, "keep")).toEqual({ x: 200 - 400 / 0.8, y: 150 - 300 / 0.8, zoom: 0.8 });
    // outside the band, and too big to fit: keep is keep
    expect(look(CARD, 3, "keep").zoom).toBe(3);
    expect(look({ x: 0, y: 0, width: 5000, height: 5000 }, 2, "keep").zoom).toBe(2);
  });

  it("a number: that zoom, centred", () => {
    const cam = look(CARD, 0.3, 2.5);
    expect(cam.zoom).toBe(2.5);
    expect(centreOnScreen(CARD, cam)).toEqual({ x: 400, y: 300 });
  });
});

describe("lookCamera: comfort", () => {
  it("keeps a zoom the target can be read at and fits at — past 100% too, when it fits", () => {
    expect(look(CARD, 0.8, "comfort")).toEqual({ x: 200 - 400 / 0.8, y: 150 - 300 / 0.8, zoom: 0.8 });
    expect(look(CARD, 0.5, "comfort").zoom).toBe(0.5); // the floor itself reads
    expect(look(CARD, 2, "comfort").zoom).toBe(2); // fits up to 3.2: kept
  });

  it("zooms in from 20% to the band's floor, 50%, centred", () => {
    expect(look(CARD, 0.2, "comfort")).toEqual({ x: 200 - 400 / 0.5, y: 150 - 300 / 0.5, zoom: 0.5 });
  });

  it("never zooms in past 100%: a dot the fit would take to 4400% comes in to the floor, from any far-out zoom", () => {
    const DOT: Rect = { x: -5, y: -5, width: 10, height: 10 };
    for (const from of [0.01, 0.1, 0.2, 0.35, 0.49]) {
      const cam = look(DOT, from, "comfort");
      expect(cam.zoom).toBe(0.5);
      expect(cam.zoom).toBeLessThanOrEqual(1);
    }
    // a higher floor is still a floor: in to it, not past it
    expect(look(DOT, 0.2, "comfort", { band: { minZoom: 0.8, maxZoom: 1 } }).zoom).toBe(0.8);
    // the fit of the same dot stops at the ceiling, 100%
    expect(look(DOT, 0.2, "fit").zoom).toBe(1);
  });

  it("zooms out until a target too big for the zoom fits — its pad on screen — below the floor if it must", () => {
    const BIG: Rect = { x: 0, y: 0, width: 2000, height: 1000 };
    const cam = look(BIG, 0.8, "comfort");
    expect(cam.zoom).toBeCloseTo(640 / 2000, 12);
    expect(cam.zoom).toBeLessThan(BAND.minZoom);
    // the target is inside the view with 80 screen px round it on its tight axis
    const a = worldToScreen(BIG.x, BIG.y, cam);
    const b = worldToScreen(BIG.x + BIG.width, BIG.y + BIG.height, cam);
    expect(a.x).toBeCloseTo(80, 9);
    expect(b.x).toBeCloseTo(720, 9);
    expect(a.y).toBeGreaterThanOrEqual(80);
    expect(b.y).toBeLessThanOrEqual(520);
    // far out and too big for the floor: in, but only as far as it still fits
    const MID: Rect = { x: 0, y: 0, width: 1500, height: 800 };
    expect(look(MID, 0.2, "comfort").zoom).toBeCloseTo(640 / 1500, 12);
    expect(look(MID, 0.3, "comfort").zoom).toBeCloseTo(640 / 1500, 12);
  });
});

describe("lookCamera: fit", () => {
  it("lands in the band as fitCamera's does, the pad measured on screen", () => {
    const opts = { pad: 80, minZoom: 0.5, maxZoom: 1 };
    // clamped at either end of the band, the two framings are one
    expect(look(CARD, 0.3, "fit")).toEqual(fitCamera(CARD, VP.w, VP.h, opts));
    expect(look(CARD, 0.3, "fit").zoom).toBe(1);
    const BIG: Rect = { x: 0, y: 0, width: 2000, height: 1000 };
    expect(look(BIG, 3, "fit")).toEqual(fitCamera(BIG, VP.w, VP.h, opts));
    expect(look(BIG, 3, "fit").zoom).toBe(0.5);
    // inside the band: 80 screen px round the target on its tight axis (fitCamera adds its pad in world units)
    const MID: Rect = { x: -40, y: 10, width: 900, height: 500 };
    const cam = look(MID, 3, "fit");
    expect(cam.zoom).toBeCloseTo(640 / 900, 12);
    expect(worldToScreen(MID.x, MID.y, cam).x).toBeCloseTo(80, 9);
    expect(worldToScreen(MID.x + MID.width, MID.y, cam).x).toBeCloseTo(720, 9);
    expect(centreOnScreen(MID, cam).y).toBeCloseTo(300, 9);
  });
});

describe("lookCamera: the inset", () => {
  it("centres the target in what the chrome leaves", () => {
    expect(centreOnScreen(CARD, look(CARD, 1, "keep", { inset: { left: 200, top: 100 } }))).toEqual({ x: 500, y: 350 });
    expect(centreOnScreen(CARD, look(CARD, 1, "keep", { inset: { right: 200, bottom: 100 } }))).toEqual({ x: 300, y: 250 });
    const all = centreOnScreen(CARD, look(CARD, 0.7, "comfort", { inset: { top: 40, right: 10, bottom: 60, left: 90 } }));
    expect(all.x).toBeCloseTo(90 + 700 / 2, 9);
    expect(all.y).toBeCloseTo(40 + 500 / 2, 9);
  });

  it("measures the fit in what is left: a target that fits the view but not the room is zoomed out to the room", () => {
    const WIDE: Rect = { x: 0, y: 0, width: 500, height: 100 };
    expect(look(WIDE, 1, "comfort").zoom).toBe(1); // the whole view: fits up to 1.28
    const cam = look(WIDE, 1, "comfort", { inset: { left: 200, top: 100 } });
    expect(cam.zoom).toBeCloseTo(440 / 500, 12);
    expect(centreOnScreen(WIDE, cam).x).toBeCloseTo(500, 9);
    expect(look(WIDE, 1, "fit", { inset: { left: 200 } }).zoom).toBeCloseTo(440 / 500, 12);
  });

  it("ignores insets that leave no room: the whole viewport", () => {
    expect(centreOnScreen(CARD, look(CARD, 1, "keep", { inset: { left: 500, right: 400 } }))).toEqual({ x: 400, y: 300 });
    expect(centreOnScreen(CARD, look(CARD, 1, "keep", { inset: { top: 600 } }))).toEqual({ x: 400, y: 300 });
  });

  it("cuts a pad to a quarter of the room on its axis: a huge pad still gives a finite zoom the target fits at", () => {
    // pad 1e6 → 200 px across (a quarter of 800), 150 px down (a quarter of 600): the card fits up to min(400/200, 300/100) = 2
    expect(look(CARD, 3, "comfort", { pad: 1e6 }).zoom).toBe(2);
    expect(look(CARD, 1, "comfort", { pad: 1e6 }).zoom).toBe(1);
  });

  it("lands the centre at the room's centre for any target, zoom and inset (property)", () => {
    const rand = makePrng(58);
    for (let i = 0; i < 200; i++) {
      const target: Rect = { x: inRange(rand, -1e5, 1e5), y: inRange(rand, -1e5, 1e5), width: inRange(rand, 0, 4000), height: inRange(rand, 0, 4000) };
      const inset = { top: inRange(rand, 0, 200), right: inRange(rand, 0, 200), bottom: inRange(rand, 0, 200), left: inRange(rand, 0, 200) };
      const policy = (["comfort", "fit", "keep", inRange(rand, 0.05, 8)] as const)[i % 4] as LookCameraOpts["zoom"];
      const cam = look(target, inRange(rand, 0.05, 8), policy, { inset });
      const c = centreOnScreen(target, cam);
      expect(c.x).toBeCloseTo(inset.left + (VP.w - inset.left - inset.right) / 2, 6);
      expect(c.y).toBeCloseTo(inset.top + (VP.h - inset.top - inset.bottom) / 2, 6);
      expect(cam.zoom).toBeGreaterThanOrEqual(LIMITS.minZoom);
      expect(cam.zoom).toBeLessThanOrEqual(LIMITS.maxZoom);
    }
  });
});

describe("lookCamera: the limits", () => {
  it("clamp every result", () => {
    expect(look(CARD, 1, 9).zoom).toBe(5);
    expect(look(CARD, 1, 0.01).zoom).toBe(0.1);
    expect(look(CARD, 7, "keep").zoom).toBe(5);
    expect(look(CARD, 0.02, "keep").zoom).toBe(0.1);
    const HUGE: Rect = { x: 0, y: 0, width: 1e6, height: 1e6 };
    expect(look(HUGE, 1, "comfort").zoom).toBe(0.1); // it fits at 0.00044: the limit holds
  });

  it("meet the band as frameContent's do: on no overlap the limit wins", () => {
    const high = { limits: { minZoom: 2, maxZoom: 5 } };
    expect(look(CARD, 0.3, "fit", high).zoom).toBe(2);
    expect(look(CARD, 0.2, "comfort", high).zoom).toBe(2);
    const low = { limits: { minZoom: 0.1, maxZoom: 0.3 } };
    expect(look(CARD, 0.2, "comfort", low).zoom).toBe(0.3);
    expect(look(CARD, 0.2, "fit", low).zoom).toBe(0.3);
  });
});
