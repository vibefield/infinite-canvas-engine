import { describe, expect, it } from "vitest";
import {
  compositeCameraFrustum,
  fitCamera,
  islandToWorld,
  planeCssTransform,
  screenToWorld,
  worldRectToComposite,
  worldToIsland,
  worldToScreen,
  zoomAtPoint,
  type CameraState,
} from "../src/coords";
import type { Rect } from "../src/shapes";
import { inRange, makePrng } from "./prng";

const CASES = 200;

function randomCamera(rand: () => number): CameraState {
  return {
    x: inRange(rand, -1e6, 1e6),
    y: inRange(rand, -1e6, 1e6),
    zoom: inRange(rand, 0.05, 8),
  };
}

describe("coords: screen ↔ world", () => {
  it("round-trips (property)", () => {
    const rand = makePrng(42);
    for (let i = 0; i < CASES; i++) {
      const cam = randomCamera(rand);
      const sx = inRange(rand, -4000, 4000);
      const sy = inRange(rand, -4000, 4000);
      const w = screenToWorld(sx, sy, cam);
      const s = worldToScreen(w.x, w.y, cam);
      expect(s.x).toBeCloseTo(sx, 6);
      expect(s.y).toBeCloseTo(sy, 6);
    }
  });

  it("world origin maps to screen (-cam.x*zoom, -cam.y*zoom)", () => {
    const cam = { x: 100, y: 50, zoom: 2 };
    expect(worldToScreen(0, 0, cam)).toEqual({ x: -200, y: -100 });
  });
});

describe("coords: planeCssTransform", () => {
  it("applying the plane transform to a world-unit child equals worldToScreen (property)", () => {
    const rand = makePrng(1234);
    for (let i = 0; i < CASES; i++) {
      const cam = randomCamera(rand);
      const wx = inRange(rand, -1e6, 1e6);
      const wy = inRange(rand, -1e6, 1e6);
      const t = planeCssTransform(cam);
      // CSS `translate(tx,ty) scale(s)` with origin 0 0 on a child laid out at (wx, wy):
      const screen = { x: wx * t.scale + t.tx, y: wy * t.scale + t.ty };
      const expected = worldToScreen(wx, wy, cam);
      expect(screen.x).toBeCloseTo(expected.x, 6);
      expect(screen.y).toBeCloseTo(expected.y, 6);
    }
  });

  it("identity camera is the identity transform", () => {
    const t = planeCssTransform({ x: 0, y: 0, zoom: 1 });
    // Numeric compares: tx/ty are -0 here and Object.is(-0, +0) is false; CSS treats them the same.
    expect(t.tx === 0 && t.ty === 0).toBe(true);
    expect(t.scale).toBe(1);
  });

  it("pan-only moves the plane opposite the camera, scaled by zoom", () => {
    expect(planeCssTransform({ x: 100, y: -50, zoom: 2 })).toEqual({ tx: -200, ty: 100, scale: 2 });
  });
});

describe("coords: zoomAtPoint", () => {
  it("keeps the world point under the anchor fixed (property)", () => {
    const rand = makePrng(7);
    for (let i = 0; i < CASES; i++) {
      const cam = randomCamera(rand);
      const ax = inRange(rand, 0, 2000);
      const ay = inRange(rand, 0, 1500);
      const before = screenToWorld(ax, ay, cam);
      const next = zoomAtPoint(cam, ax, ay, inRange(rand, 0.05, 8));
      const after = screenToWorld(ax, ay, next);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
    }
  });
});

describe("coords: island space (THE Y-flip)", () => {
  const widget: Rect = { x: 100, y: 200, width: 80, height: 60 };

  it("widget center is island origin", () => {
    const p = worldToIsland(140, 230, widget);
    // Numeric compare: the Y-flip yields -0 at the exact center (=== 0 in JS).
    expect(p.x === 0).toBe(true);
    expect(p.y === 0).toBe(true);
  });

  it("world DOWN is island NEGATIVE-Y (the flip, direction one)", () => {
    // 10 world units below center → island y = -10.
    expect(worldToIsland(140, 240, widget).y).toBe(-10);
    // Top edge of the widget is ABOVE center → island y = +height/2.
    expect(worldToIsland(140, 200, widget).y).toBe(30);
  });

  it("round-trips (property)", () => {
    const rand = makePrng(99);
    for (let i = 0; i < CASES; i++) {
      const w: Rect = {
        x: inRange(rand, -1e5, 1e5),
        y: inRange(rand, -1e5, 1e5),
        width: inRange(rand, 1, 2000),
        height: inRange(rand, 1, 2000),
      };
      const wx = inRange(rand, -1e5, 1e5);
      const wy = inRange(rand, -1e5, 1e5);
      const island = worldToIsland(wx, wy, w);
      const back = islandToWorld(island.x, island.y, w);
      expect(back.x).toBeCloseTo(wx, 6);
      expect(back.y).toBeCloseTo(wy, 6);
    }
  });
});

describe("coords: P2 composite scene", () => {
  /**
   * Ortho-project a Y-up scene point through the composite frustum onto
   * Y-down screen px — the same math Three's OrthographicCamera performs.
   * Inline here (kernel tests import no three).
   */
  function orthoToScreen(
    sceneX: number,
    sceneY: number,
    f: ReturnType<typeof compositeCameraFrustum>,
    vw: number,
    vh: number,
  ): { x: number; y: number } {
    const ndcX = (2 * (sceneX - f.x - f.left)) / (f.right - f.left) - 1;
    const ndcY = (2 * (sceneY - f.y - f.bottom)) / (f.top - f.bottom) - 1;
    return { x: ((ndcX + 1) / 2) * vw, y: ((1 - ndcY) / 2) * vh };
  }

  it("frustum + quad transform reproduce worldToScreen exactly (property)", () => {
    // THE alignment invariant: a composite quad at worldRectToComposite(rect)
    // must land on the same screen pixels as a DOM host at rect under the
    // plane transform. Otherwise P1/P2 drift at arbitrary zoom.
    const rand = makePrng(7);
    for (let i = 0; i < CASES; i++) {
      const cam = randomCamera(rand);
      const vw = inRange(rand, 100, 4000);
      const vh = inRange(rand, 100, 4000);
      const rect: Rect = {
        x: inRange(rand, -1e5, 1e5),
        y: inRange(rand, -1e5, 1e5),
        width: inRange(rand, 1, 2000),
        height: inRange(rand, 1, 2000),
      };
      const f = compositeCameraFrustum(cam, vw, vh);
      const q = worldRectToComposite(rect);
      const got = orthoToScreen(q.x, q.y, f, vw, vh);
      const want = worldToScreen(rect.x + rect.width / 2, rect.y + rect.height / 2, cam);
      expect(got.x / (vw / 2)).toBeCloseTo(want.x / (vw / 2), 6);
      expect(got.y / (vh / 2)).toBeCloseTo(want.y / (vh / 2), 6);
    }
  });

  it("quad scale is the world size; center is Y-negated", () => {
    const q = worldRectToComposite({ x: 100, y: 200, width: 80, height: 60 });
    expect(q).toEqual({ x: 140, y: -230, sx: 80, sy: 60 });
  });

  it("frustum spans viewport/zoom world units from the camera origin", () => {
    const f = compositeCameraFrustum({ x: 10, y: 20, zoom: 2 }, 800, 600);
    expect(f.right).toBe(400);
    expect(f.bottom).toBe(-300);
    expect(f.x).toBe(10);
    expect(f.y).toBe(-20);
  });
});

describe("fitCamera — the natural default framing", () => {
  const BAND = { pad: 80, minZoom: 0.5, maxZoom: 1 };

  it("small content caps at maxZoom, centered — one card never fills the screen", () => {
    const cam = fitCamera({ x: 500, y: 500, width: 100, height: 100 }, 1600, 900, BAND);
    expect(cam.zoom).toBe(1); // uncapped fit would be ~3.46
    expect(cam.x).toBe(550 - 800); // content center (550,550) at viewport center
    expect(cam.y).toBe(550 - 450);
  });

  it("huge content floors at minZoom, centered — never an ant farm", () => {
    const cam = fitCamera({ x: 0, y: 0, width: 10000, height: 5000 }, 1600, 900, BAND);
    expect(cam.zoom).toBe(0.5); // uncapped fit would be ~0.157
    expect(cam.x).toBe(5000 - 1600); // center (5000,2500) at viewport center
    expect(cam.y).toBe(2500 - 900);
  });

  it("in-band content gets the exact padded fit", () => {
    const cam = fitCamera({ x: 0, y: 0, width: 3000, height: 1000 }, 1600, 900, BAND);
    const fit = Math.min(1600 / 3160, 900 / 1160);
    expect(cam.zoom).toBeCloseTo(fit, 10);
    expect(cam.x).toBeCloseTo(1500 - 800 / fit, 8);
    expect(cam.y).toBeCloseTo(500 - 450 / fit, 8);
  });
});
