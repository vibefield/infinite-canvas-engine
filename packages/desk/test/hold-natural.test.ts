// @vitest-environment node
// THE CAP (petition I55, 2026-11-19 — the print that opens): a kind's opening may say its extent's OWN PIXELS
// (`OpenBinding.natural`), and the hand's reading fit never passes them — `naturalCap(extent, natural, dpr)` is the most CSS px per
// object unit at which they read 1:1 in device pixels, and `readingTarget`'s trailing `cap` bounds the fit wherever 3× does. A cap
// above the fit, or none, leaves every number as it was (the desk, the phone, a spread one page at a time, the host's reserves); an
// absent or malformed natural is no cap. Through the BUILDER, a kind of the test's own: picked up, a small picture is posed at 1:1
// device pixels at the frame's dpr, centred in the fit; a large one fits the view; the person's own zoom (`HeldView.zoom`) rides on
// top; a natural that throws is the kind's strike, as its extent's is. Every row fails at v0.18.0 — it has no `naturalCap`, its
// `readingTarget` ignores a sixth argument and its builder never asks `natural` — but the two GUARDS, which hold before and after:
// today's numbers uncapped, and the fit of a large or a 0 × 0 picture.
import { createCanvasEngine, HeldView, p } from "@ice/core";
import { describe, expect, it, vi } from "vitest";
import { createDeskBuilder } from "../src/compose/builder";
import { createKindFaults, type KindFaults } from "../src/faults";
import { HOLD, type HoldReserves, naturalCap, readingTarget } from "../src/hold/pose";
import type { KindPass } from "../src/kind";
import { numberProp, type ObjectKind, type ObjectRect, type OpenBinding } from "../src/kinds/world";
import { DEFAULT_GRID } from "../src/mat/grid";
import { defineObject } from "../src/object";
import { type Palette, themeFrom } from "../src/theme";
import { must } from "./must";

const VP = { width: 1200, height: 800 };
const PHONE = { width: 390, height: 844 };
const VF: HoldReserves = { top: 116, band: 100 };
/** A print's open extent: 640 × 427 at the law's long side, 400 (the print is 400 × 266.875). */
const PRINT: ObjectRect = { cx: 0, cy: 0, w: 400, h: 266.875 };
/** A notebook's spread (360 × 252): the phone's one-page decision. */
const SPREAD: ObjectRect = { cx: 0, cy: 0, w: 360, h: 252 };
const near = (a: number, b: number, eps = 1e-9): void => { expect(Math.abs(a - b)).toBeLessThanOrEqual(eps); };

describe("readingTarget's cap (petition I55)", () => {
  it("never passes the cap: the fit is min(fit, cap) at any cap under 3×, its centre where the fit puts it (fails at v0.18.0: the cap is ignored)", () => {
    // the print's fit at 1200 × 800: min((1200 − 112) / 400, (800 − 56 − 72) / 266.875, 3) = min(2.72, 2.518…, 3) — the height binds
    const fit = readingTarget(PRINT, VP);
    near(fit.s, 672 / 266.875);
    for (const cap of [0.25, 0.8, 1, 2, 2.5]) {
      const t = readingTarget(PRINT, VP, false, 0, HOLD, cap);
      expect(t.s, `${cap}`).toBe(cap);
      expect([t.cx, t.cy, t.single], `${cap}`).toEqual([fit.cx, fit.cy, fit.single]);   // centred in the box, as the fit is
    }
    // a cap past the fit leaves the fit — and past 3× leaves 3× (a small extent the fit would grow past it)
    expect(readingTarget(PRINT, VP, false, 0, HOLD, 2.6)).toEqual(fit);
    expect(readingTarget({ cx: 0, cy: 0, w: 100, h: 60 }, VP, false, 0, HOLD, 5).s).toBe(HOLD.max);
    expect(readingTarget({ cx: 0, cy: 0, w: 100, h: 60 }, VP, false, 0, HOLD, 1.25).s).toBe(1.25);
    // the host's reserves size the box; the cap bounds it the same
    expect(readingTarget(PRINT, VP, false, 0, VF, 0.8).s).toBe(0.8);
  });

  it("absent, Infinity, or not a positive number: today's numbers EXACTLY — the desk, the host's reserves, the phone, a spread one page at a time (a guard: it holds at v0.18.0 too)", () => {
    const views = [VP, { width: 1200, height: 640 }, PHONE, { width: 400, height: 480 }];
    const extents = [PRINT, SPREAD, { cx: 30, cy: -40, w: 100, h: 60 }, { cx: 0, cy: 0, w: 2000, h: 300 }];
    for (const vp of views) {
      for (const extent of extents) {
        for (const [spread, face] of [[false, 0], [true, 0], [true, 1]] as const) {
          for (const reserves of [HOLD, VF]) {
            const was = readingTarget(extent, vp, spread, face, reserves);
            for (const cap of [undefined, Number.POSITIVE_INFINITY, 0, -1, Number.NaN, HOLD.max, 1e9]) {
              expect(readingTarget(extent, vp, spread, face, reserves, cap), `${vp.width}×${vp.height} ${extent.w}×${extent.h} ${spread} ${face} ${cap}`).toEqual(was);
            }
          }
        }
      }
    }
  });

  it("the phone's one-page decision takes the cap with 3×: a cap that binds the spread and its page alike keeps the spread whole; one that binds the page alone sizes it (fails at v0.18.0)", () => {
    // uncapped: one page at 358 / 180 = 1.989 reads past 1.3 × the spread's 358 / 360 = 0.994 — one page (hold-reserves.test.ts)
    const own = readingTarget(SPREAD, PHONE, true);
    expect(own.single).toBe(true);
    near(own.s, 358 / 180);
    // capped at 0.9: the spread and its page both read 0.9 — nothing to gain by a page: the spread whole, at the cap
    const both = readingTarget(SPREAD, PHONE, true, 0, HOLD, 0.9);
    expect(both.single).toBe(false);
    expect(both.s).toBe(0.9);
    expect(both.cx).toBe(PHONE.width / 2);
    // capped at 1.5: the page reads 1.5 > 1.3 × 0.994 — one page, at the cap, the right page centred
    const page = readingTarget(SPREAD, PHONE, true, 0, HOLD, 1.5);
    expect(page.single).toBe(true);
    expect(page.s).toBe(1.5);
    near(page.cx, PHONE.width / 2 - (360 / 4) * 1.5);
  });
});

describe("naturalCap — the extent's own pixels, 1:1 at the dpr (petition I55)", () => {
  it("min(natural.w / (extent.w · dpr), natural.h / (extent.h · dpr)): the side with fewer pixels a unit binds; the dpr divides it (fails at v0.18.0: no naturalCap)", () => {
    // the print: 640 × 427 across 400 × 266.875 — 1.6 px a unit both ways; at dpr 2 a CSS px holds two of them
    near(naturalCap(PRINT, { w: 640, h: 427 }, 1), 1.6);
    near(naturalCap(PRINT, { w: 640, h: 427 }, 2), 0.8);
    // at the cap the extent covers its picture's pixels exactly: 400 units × 0.8 CSS px × 2 device px = 640
    near(400 * naturalCap(PRINT, { w: 640, h: 427 }, 2) * 2, 640, 1e-9);
    // an aspect that is not the extent's: the side with fewer pixels a unit binds
    expect(naturalCap({ w: 100, h: 100 }, { w: 1000, h: 200 }, 1)).toBe(2);
    expect(naturalCap({ w: 100, h: 100 }, { w: 300, h: 1000 }, 3)).toBe(1);
    // no dpr said, or one that is not a positive finite number: 1 (the reflector's own fallback)
    for (const dpr of [undefined, 0, -2, Number.NaN, Number.POSITIVE_INFINITY]) expect(naturalCap({ w: 100, h: 100 }, { w: 300, h: 300 }, dpr), `${dpr}`).toBe(3);
  });

  it("no natural, or one that is not two positive finite numbers, or a degenerate extent: Infinity — the fit alone (a print of 0 × 0)", () => {
    const none: unknown[] = [
      undefined, null, "640x427", 640, {}, { w: 0, h: 0 }, { w: 640, h: 0 }, { w: -640, h: 427 }, { w: Number.NaN, h: 427 },
      { w: 640, h: Number.POSITIVE_INFINITY }, { w: "640", h: "427" },
    ];
    for (const n of none) expect(naturalCap(PRINT, n as { w: number; h: number } | undefined, 2), JSON.stringify(n) ?? String(n)).toBe(Number.POSITIVE_INFINITY);
    for (const extent of [{ w: 0, h: 266.875 }, { w: 400, h: -1 }, { w: Number.NaN, h: 1 }]) expect(naturalCap(extent, { w: 640, h: 427 }, 2)).toBe(Number.POSITIVE_INFINITY);
    // …and Infinity is no cap: the fit as it was
    expect(readingTarget(PRINT, VP, false, 0, HOLD, naturalCap(PRINT, { w: 0, h: 0 }, 2))).toEqual(readingTarget(PRINT, VP));
  });
});

// ---------------------------------------------------------------- through the builder

const PALETTE: Palette = { canvasBg: { token: "--bg", css: "#fafafa" }, select: { token: "--sel", css: "#3080ff" } };
const THEME = themeFrom("light", PALETTE);
const CAM = { x: 0, y: 0, zoom: 1 };

/** A flat kind of the test's own that opens on its rect (as the print and the whiteboard do) and says — or not — its own pixels. */
function pictureKind(name: string, natural: OpenBinding["natural"]): ObjectKind<ObjectRect> {
  return {
    name, stratum: "things", reach: 0, create: async () => ({}) as KindPass,
    resolve: (ctx) => ctx.rect, record: () => ({}), hit: () => "content",
    open: natural === undefined ? { extent: (c) => c.rect } : { extent: (c) => c.rect, natural },
  };
}
/** Its pixels are its props' (`px` × `py`), as the print's are its picture's `width` × `height` — 0 × 0, none. */
const PICTURE = defineObject({
  type: "cap.picture", version: 1, props: { px: p.number({ default: 0 }), py: p.number({ default: 0 }) }, size: { w: 400, h: 250 },
  kind: pictureKind("cap-picture", (c) => ({ w: numberProp(c.props, "px", 0), h: numberProp(c.props, "py", 0) })),
});
/** One whose `natural` throws. */
const THROWS = defineObject({ type: "cap.throws", version: 1, props: {}, size: { w: 400, h: 250 }, kind: pictureKind("cap-throws", () => { throw new Error("no pixels today"); }) });
const OBJECTS = [PICTURE, THROWS];

/** One object of `type` (400 × 250, centred on the origin) on a builder in Node, at `dpr`; `settle` picks it up and builds until the pickup settles. */
function desk(type: string, props: Record<string, number>, dpr: number, faults?: KindFaults) {
  const ce = createCanvasEngine({ widgets: OBJECTS });
  ce.docs.create();
  const e = ce.ops.spawnWidget(type, { x: -200, y: -125, w: 400, h: 250, props, undoable: false });
  for (let i = 1; i <= 3; i++) ce.step(i * 16);
  const builder = createDeskBuilder(ce.world, { objects: OBJECTS, ...(faults !== undefined ? { faults } : {}) });
  const vp = { ...VP, dpr };
  const build = () => { builder.changed(); return builder.build(CAM, vp, 1 / 60, THEME, DEFAULT_GRID, new Map()); };
  const settle = () => {
    ce.ops.open(e);
    for (let i = 0; i < 160 && builder.hand()?.settled !== true; i++) build();
    return must(builder.hand(), "the object in hand").frame;
  };
  return { ce, e, build, settle };
}

describe("the builder's hand with a natural (petition I55)", () => {
  /** The fit of the test's 400 × 250 object at 1200 × 800: min(1088 / 400, 672 / 250, 3) = 2.688. */
  const FIT = readingTarget({ cx: 0, cy: 0, w: 400, h: 250 }, VP);

  it("a small picture is posed at 1:1 device pixels at the frame's dpr — never past — centred in the fit (fails at v0.18.0: posed at the fit, 2.688)", () => {
    near(FIT.s, 672 / 250);
    for (const [dpr, s] of [[2, 0.8], [1, 1.6]] as const) {
      const d = desk("cap.picture", { px: 640, py: 400 }, dpr);
      try {
        const f = d.settle();
        near(f.s, s, 1e-9);
        expect(2 * f.hx * dpr, `${dpr}: device px across`).toBeLessThanOrEqual(640 + 1e-6);
        near(2 * f.hx * dpr, 640, 1e-6);
        near(2 * f.hy * dpr, 400, 1e-6);
        near(f.cx, FIT.cx, 1e-9);
        near(f.cy, FIT.cy, 1e-9);
      } finally { d.ce.dispose(); }
    }
  });

  it("a large picture fits the view as any kind does; 0 × 0 says no pixels — the fit alone (a guard: it holds at v0.18.0 too)", () => {
    for (const props of [{ px: 4000, py: 2500 }, { px: 0, py: 0 }]) {
      const d = desk("cap.picture", props, 2);
      try { near(d.settle().s, FIT.s, 1e-9); } finally { d.ce.dispose(); }
    }
  });

  it("the person's own zoom rides ON TOP of the capped fit: HeldView.zoom 2 reads 2 × the cap (fails at v0.18.0)", () => {
    const d = desk("cap.picture", { px: 640, py: 400 }, 2);
    try {
      d.settle();
      d.ce.world.removeComponent(d.e, HeldView);
      d.ce.world.addComponent(d.e, HeldView, { zoom: 2, panX: 0, panY: 0 });
      const f = must(d.build().held, "the object in hand").frame;
      near(f.s, 1.6, 1e-9);
    } finally { d.ce.dispose(); }
  });

  it("a natural that THROWS is the kind's strike, as its extent's is: nothing in hand this frame, the frame goes on (fails at v0.18.0: never asked)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const faults = createKindFaults();
    const d = desk("cap.throws", {}, 2, faults);
    try {
      d.build();
      d.ce.ops.open(d.e);
      const built = d.build();
      expect(built.held).toBeUndefined();
      expect(faults.strikes("cap-throws")).toBe(1);
    } finally { d.ce.dispose(); warn.mockRestore(); error.mockRestore(); }
  });
});
