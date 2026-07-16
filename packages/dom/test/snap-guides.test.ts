/**
 * snap-guides reflector (P0 pass, design-004 §1 as-built amendment 2026-07-16):
 * strokes the snapSystem's pooled GuideLine/SpacingBar chrome under content.
 * Asserts: full-span vs bounded alignment lines, spacing bars + end ticks,
 * change-only redraws (idle scene re-strokes zero times), the reap frame
 * clears exactly once, and camera moves re-stroke.
 *
 * happy-dom's `getContext("2d")` returns `null` (no 2D engine), so — mirroring
 * wires.test.ts — `getContext` is stubbed with a recording fake context.
 */
import {
  Camera,
  createEngine,
  createWorld,
  GuideLine,
  SpacingBar,
} from "@ice/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCanvasHost } from "../src/host";
import { createSnapGuidesReflector } from "../src/reflectors/snap-guides";

/** A recording 2D context: logs every method call + the settable style props. */
class FakeContext2D {
  calls: Array<{ m: string; args: unknown[] }> = [];
  strokeStyle = "";
  fillStyle = "";
  lineWidth = 0;
  private rec(m: string, ...args: unknown[]): void {
    this.calls.push({ m, args });
  }
  setTransform(...a: unknown[]): void {
    this.rec("setTransform", ...a);
  }
  clearRect(...a: unknown[]): void {
    this.rec("clearRect", ...a);
  }
  beginPath(): void {
    this.rec("beginPath");
  }
  moveTo(...a: unknown[]): void {
    this.rec("moveTo", ...a);
  }
  lineTo(...a: unknown[]): void {
    this.rec("lineTo", ...a);
  }
  stroke(): void {
    this.rec("stroke");
  }
  count(m: string): number {
    return this.calls.filter((c) => c.m === m).length;
  }
  /** The (x0,y0)→(x1,y1) of stroked segment n (moveTo/lineTo pairs, in order). */
  segment(n: number): [number, number, number, number] {
    const moves = this.calls.filter((c) => c.m === "moveTo");
    const lines = this.calls.filter((c) => c.m === "lineTo");
    const mv = moves[n];
    const ln = lines[n];
    if (mv === undefined || ln === undefined) throw new Error(`no segment ${n}`);
    return [mv.args[0] as number, mv.args[1] as number, ln.args[0] as number, ln.args[1] as number];
  }
  reset(): void {
    this.calls = [];
  }
}

let capturedCtx: FakeContext2D | null = null;
let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  capturedCtx = null;
  HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, id: string) {
    if (id === "2d") {
      const fake = new FakeContext2D();
      capturedCtx = fake;
      return fake as unknown as CanvasRenderingContext2D;
    }
    return null;
  } as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

function setup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const host = createCanvasHost(container);
  const world = createWorld();
  const engine = createEngine(world);
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  const reflector = createSnapGuidesReflector(host, world);
  engine.registerReflector(reflector);
  let now = 0;
  const step = () => {
    now += 16;
    engine.step(now);
  };
  const ctx = () => capturedCtx as FakeContext2D;
  return { world, engine, host, container, reflector, step, ctx };
}

describe("snap-guides reflector", () => {
  it("sits in P0 immediately before the content plane, pointer-transparent", () => {
    const { host } = setup();
    const canvas = host.contentPlane.previousElementSibling as HTMLCanvasElement;
    expect(canvas.tagName).toBe("CANVAS");
    expect(canvas.style.pointerEvents).toBe("none");
  });

  it("strokes a full-span x guide as a vertical viewport line at the camera-mapped x", () => {
    const { world, step, ctx } = setup();
    world.spawn({ components: [[GuideLine, { axis: "x", at: 300, from: 0, to: 0 }]] });
    step();
    expect(ctx().count("stroke")).toBe(1);
    const [x0, , x1] = [ctx().segment(0)[0], 0, ctx().segment(0)[2]];
    expect(x0).toBe(300); // camera at origin, zoom 1
    expect(x1).toBe(300); // vertical: both endpoints on the guide x
  });

  it("strokes a bounded y guide only across [from, to]", () => {
    const { world, step, ctx } = setup();
    world.spawn({ components: [[GuideLine, { axis: "y", at: 100, from: 50, to: 250 }]] });
    step();
    const [x0, y0, x1, y1] = ctx().segment(0);
    expect(y0).toBe(100);
    expect(y1).toBe(100);
    expect(x0).toBe(50);
    expect(x1).toBe(250);
  });

  it("strokes a spacing bar as segment + two end ticks (3 strokes)", () => {
    const { world, step, ctx } = setup();
    world.spawn({ components: [[SpacingBar, { axis: "x", from: 180, to: 300, perp: 130, gap: 120 }]] });
    step();
    expect(ctx().count("stroke")).toBe(3); // the gap segment + 2 ticks
    const [x0, y0, x1, y1] = ctx().segment(0);
    expect([x0, y0, x1, y1]).toEqual([180, 130, 300, 130]);
  });

  it("re-strokes change-only: zero redraws while idle, one clearing redraw on reap", () => {
    const { world, step, ctx, reflector } = setup();
    const e = world.spawn({ components: [[GuideLine, { axis: "x", at: 300, from: 0, to: 0 }]] });
    step();
    const after = reflector.redraws();
    expect(after).toBeGreaterThan(0);

    step();
    step();
    expect(reflector.redraws()).toBe(after); // static guide, no camera move — no re-stroke

    ctx().reset();
    world.destroy(e);
    step();
    expect(reflector.redraws()).toBe(after + 1); // the reap frame clears once
    expect(ctx().count("clearRect")).toBe(1);
    expect(ctx().count("stroke")).toBe(0); // nothing left to draw

    step();
    expect(reflector.redraws()).toBe(after + 1); // and stays quiet after
  });

  it("re-strokes on camera change with worldToScreen-mapped coordinates", () => {
    const { world, step, ctx } = setup();
    world.spawn({ components: [[GuideLine, { axis: "x", at: 300, from: 0, to: 0 }]] });
    step();
    ctx().reset();
    world.setResource(Camera, { x: 100, y: 0, zoom: 2, gesturing: false });
    step();
    expect(ctx().count("stroke")).toBe(1);
    expect(ctx().segment(0)[0]).toBe((300 - 100) * 2); // worldToScreen x
  });

  it("degrades to unavailable without a 2D context (happy-dom native)", () => {
    HTMLCanvasElement.prototype.getContext = originalGetContext; // real happy-dom: null
    const container = document.createElement("div");
    document.body.appendChild(container);
    const host = createCanvasHost(container);
    const world = createWorld();
    const engine = createEngine(world);
    world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    const reflector = createSnapGuidesReflector(host, world);
    engine.registerReflector(reflector);
    expect(reflector.available()).toBe(false);
    world.spawn({ components: [[GuideLine, { axis: "x", at: 0, from: 0, to: 0 }]] });
    engine.step(16); // flush is a silent no-op — no throw
  });
});
