/**
 * Grid reflector (design-004 §1 P0 ground plane; M6): mounts under the content
 * plane, sizes off a ResizeObserver, and degrades to a silent no-op — never a
 * throw — when WebGL is unavailable (the happy-dom case: `<canvas>` exists,
 * `getContext("webgl2"|"webgl")` returns `null`).
 *
 * happy-dom's `ResizeObserver` is an unimplemented stub (`observe()` is a
 * no-op) and `getBoundingClientRect()` always reports 0×0 — there is no layout
 * engine to drive either — so the resize test installs a fake `ResizeObserver`
 * that captures its callback and lets the test fire it manually, mirroring
 * loop.test.ts's rAF-stub pattern for the same reason (no real browser clock/
 * layout under happy-dom).
 */
import { Camera, createEngine, createWorld } from "@ice/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCanvasHost } from "../src/host";
import { createGridReflector } from "../src/reflectors/grid";

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}

  trigger(width: number, height: number): void {
    const entry = { contentRect: { width, height } } as ResizeObserverEntry;
    this.callback([entry], this as unknown as ResizeObserver);
  }
}

let originalRO: typeof ResizeObserver;

beforeEach(() => {
  originalRO = globalThis.ResizeObserver;
  FakeResizeObserver.instances = [];
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
  globalThis.ResizeObserver = originalRO;
});

function setup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const host = createCanvasHost(container);
  const world = createWorld();
  const engine = createEngine(world);
  const reflector = createGridReflector(host);
  engine.registerReflector(reflector);
  return { world, engine, host, reflector, container };
}

describe("grid reflector", () => {
  it("mounts the canvas as the container's first child, under the content plane", () => {
    const { host } = setup();
    const first = host.container.firstElementChild;
    expect(first?.tagName).toBe("CANVAS");
    expect(first?.nextElementSibling).toBe(host.contentPlane);
  });

  it("reports unavailable under happy-dom (no WebGL) and never throws on flush", () => {
    const { world, engine, reflector } = setup();
    expect(reflector.available()).toBe(false);

    expect(() => {
      world.setResource(Camera, { x: 1, y: 2, zoom: 1.5, gesturing: false });
      engine.step(0);
    }).not.toThrow();
    expect(reflector.available()).toBe(false);
  });

  it("never throws across repeated steps, with or without a Camera resource", () => {
    const { engine, reflector } = setup();
    expect(() => {
      for (let i = 0; i < 5; i++) engine.step(i);
    }).not.toThrow();
    expect(reflector.available()).toBe(false);
  });

  it("resizes the canvas backing buffer to the container size × dpr on a ResizeObserver tick", () => {
    const { host } = setup();
    const canvas = host.container.firstElementChild as HTMLCanvasElement;
    const ro = FakeResizeObserver.instances.at(-1);
    expect(ro).toBeDefined();

    const dpr = host.container.ownerDocument.defaultView?.devicePixelRatio ?? 1;
    ro?.trigger(400, 300);

    expect(canvas.width).toBe(Math.round(400 * dpr));
    expect(canvas.height).toBe(Math.round(300 * dpr));

    ro?.trigger(120, 80);
    expect(canvas.width).toBe(Math.round(120 * dpr));
    expect(canvas.height).toBe(Math.round(80 * dpr));
  });
});
