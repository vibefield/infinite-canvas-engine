import { describe, expect, it } from "vitest";
import {
  islandToWorld,
  screenToWorld,
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
