// @vitest-environment node
// THE HAND'S RESERVES (petition I20 — `deskLayer({ hold })`): the reading fit keeps the HOST's `top` under the view's top and its `band`
// above the view's foot — VibeField's bar under its head and its line at the foot, 116 / 100 — at any view height the desk is shown at;
// absent, `HOLD`'s own, number for number. A phone keeps its top and its margins (the band is the one reserve it shares), and its
// one-page decision (Q-p) is its own whatever the host reserves — so a kind that asks it alone agrees with the hand. The layer refuses
// a malformed number at the mount, before it touches the page.
import { createCanvasEngine } from "@ice/core";
import { describe, expect, it } from "vitest";
import { HELD_USER_REST, heldFrame, heldPose, HOLD, type HoldReserves, homePose, readingTarget } from "../src/hold/pose";
import { deskLayer } from "../src/host/layer";
import type { ObjectRect } from "../src/kinds/world";
import { type Palette, themeFrom } from "../src/theme";
import { fakePage } from "./fake-page";

/** VibeField's (One Frame §7, MC-D4): the held bar under the head, the line at the foot. */
const VF: HoldReserves = { top: 116, band: 100 };
/** A notebook's spread (360 × 252) — the reading size is its HEIGHT's at the views below. */
const SPREAD: ObjectRect = { cx: 0, cy: 0, w: 360, h: 252 };

/** The fit IN HAND (the carry at 1) as the builder poses it and the pose seam publishes it: the frame's edges on screen, CSS px. */
function fitOf(extent: ObjectRect, vp: { readonly width: number; readonly height: number }, reserves?: HoldReserves): { readonly top: number; readonly bottom: number; readonly left: number; readonly right: number } {
  const t = readingTarget(extent, vp, false, 0, reserves);
  const f = heldFrame(heldPose(homePose(extent, 0, { x: -400, y: -300, zoom: 0.5 }), t, HELD_USER_REST, 1), extent, t.single);
  return { top: f.cy - f.hy, bottom: f.cy + f.hy, left: f.cx - f.hx, right: f.cx + f.hx };
}

describe("the hand's reserves (petition I20)", () => {
  it("places the fit the host's top under the view's top and its band above the foot — at two view heights", () => {
    for (const height of [800, 640]) {
      const f = fitOf(SPREAD, { width: 1200, height }, VF);
      expect(f.top, `${height}`).toBeCloseTo(116, 9);
      expect(height - f.bottom, `${height}`).toBeCloseTo(100, 9);
      expect((f.left + f.right) / 2).toBeCloseTo(600, 9);   // centred across, the sides' margin the desk's own
    }
  });

  it("absent, the reserves are HOLD's own — the fit 56 under the top, 72 above the foot, the target identical to the call without", () => {
    for (const height of [800, 640]) {
      const vp = { width: 1200, height };
      expect(readingTarget(SPREAD, vp)).toEqual(readingTarget(SPREAD, vp, false, 0, HOLD));
      expect(readingTarget(SPREAD, vp, true, 1)).toEqual(readingTarget(SPREAD, vp, true, 1, { top: HOLD.top, band: HOLD.band }));
      const f = fitOf(SPREAD, vp);
      expect(f.top).toBeCloseTo(HOLD.top, 9);
      expect(height - f.bottom).toBeCloseTo(HOLD.band, 9);
    }
  });

  it("a phone keeps its own top and margins — the band is the host's — and decides one page at a time on its own numbers", () => {
    // a portrait phone: the top is HOLD.topPhone whatever the host says; the band below is the host's
    const phone = { width: 390, height: 844 };
    const t = readingTarget(SPREAD, phone, false, 0, VF);
    expect(t.cy).toBe(HOLD.topPhone + (844 - HOLD.topPhone - VF.band) / 2);
    expect(t.s).toBe((390 - 2 * HOLD.marginPhone) / 360);
    // at 400 × 480 the host's band would tip the spread back to two pages (one page would read under 1.3× the spread); the decision is
    // the phone's — one page, as the notebook's own `readingTarget(…, true).single` says — sized in the host's box
    const edge = { width: 400, height: 480 };
    const own = readingTarget(SPREAD, edge, true);
    const hosted = readingTarget(SPREAD, edge, true, 0, VF);
    expect(own.single).toBe(true);
    expect(hosted.single).toBe(own.single);
    expect(hosted.s).toBe((480 - HOLD.topPhone - VF.band) / 252);
    expect(hosted.cy).toBe(HOLD.topPhone + (480 - HOLD.topPhone - VF.band) / 2);
  });

  it("the layer refuses a malformed number at the mount, by its name, before it touches the page", () => {
    const palette: Palette = { canvasBg: { token: "--bg", css: "#101010" }, select: { token: "--sel", css: "#3080ff" } };
    for (const [hold, name] of [[{ top: -1 }, "hold.top"], [{ band: Number.NaN }, "hold.band"], [{ travelMs: Number.POSITIVE_INFINITY }, "hold.travelMs"]] as const) {
      const ce = createCanvasEngine({});
      const page = fakePage();
      expect(() => deskLayer({ theme: themeFrom("light", palette), palette, hold })({ host: { container: page.container } as never, world: ce.world }), name).toThrow(name);
      expect(page.children).toEqual([]);   // no canvas was prepended
      ce.dispose();
    }
  });
});
