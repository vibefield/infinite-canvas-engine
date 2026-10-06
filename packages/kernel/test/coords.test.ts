import { describe, expect, it } from "vitest";
import {
  clientToScreen,
  fitCamera,
  screenSizeOf,
  screenToWorld,
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

// Petition I39: a container drawn under a CSS transform — its RENDERED box (`getBoundingClientRect`) scaled, its LAYOUT box
// (`clientWidth`/`clientHeight`) not. Screen space is the layout's: the canvas fills it and every screen-space child is laid out in it.
describe("coords: client → screen (petition I39)", () => {
  const LAYOUT = { clientWidth: 1180, clientHeight: 748 };
  /** The layout box at (left, top) drawn under `scale(sx, sy)` about its centre. */
  const scaled = (sx: number, sy: number, left = 20, top = 30) => ({ left: left + (1180 * (1 - sx)) / 2, top: top + (748 * (1 - sy)) / 2, width: 1180 * sx, height: 748 * sy });

  it("is the layout size under any transform; a node with no layout box to measure (0 × 0) is its rendered box", () => {
    expect(screenSizeOf(scaled(0.98, 0.98), LAYOUT)).toEqual({ width: 1180, height: 748 });
    expect(screenSizeOf(scaled(1, 1), LAYOUT)).toEqual({ width: 1180, height: 748 });
    expect(screenSizeOf({ left: 5, top: 6, width: 800, height: 600 }, { clientWidth: 0, clientHeight: 0 })).toEqual({ width: 800, height: 600 });
  });

  it("maps the scaled box's corners and centre to the layout's — each axis by its own scale", () => {
    for (const [sx, sy] of [[0.98, 0.98], [0.982, 0.982], [1.25, 0.5], [1, 1]] as const) {
      const r = scaled(sx, sy);
      const far = clientToScreen(r.left + r.width, r.top + r.height, r, LAYOUT);
      const near = clientToScreen(r.left, r.top, r, LAYOUT);
      const mid = clientToScreen(r.left + r.width / 2, r.top + r.height / 2, r, LAYOUT);
      expect(far.x).toBeCloseTo(1180, 9);
      expect(far.y).toBeCloseTo(748, 9);
      expect(near).toEqual({ x: 0, y: 0 });
      expect(mid.x).toBeCloseTo(590, 9);
      expect(mid.y).toBeCloseTo(374, 9);
    }
  });

  it("untransformed it is the offset alone — and so for a node with no layout box (the rendered box is all there is)", () => {
    expect(clientToScreen(150, 120, { left: 50, top: 20, width: 1180, height: 748 }, LAYOUT)).toEqual({ x: 100, y: 100 });
    expect(clientToScreen(150, 120, { left: 50, top: 20, width: 800, height: 600 }, { clientWidth: 0, clientHeight: 0 })).toEqual({ x: 100, y: 100 });
    expect(clientToScreen(150, 120, { left: 50, top: 20, width: 0, height: 0 }, LAYOUT)).toEqual({ x: 100, y: 100 });   // nothing rendered: no scale to undo
  });
});
