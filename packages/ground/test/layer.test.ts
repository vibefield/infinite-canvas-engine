/**
 * Layer orchestration with a FAKE renderer (the GroundRendererLike seam):
 * async-init gating, per-pass dirty union, camera dirt waking every pass,
 * idle frames rendering nothing, and dispose cleanup. Also proves that
 * importing three/webgpu classes (Scene/Object3D — plain JS until a GPU is
 * touched) is safe under happy-dom.
 */
import { Camera, createEngine, createWorld, type World } from "@ice/core";
import { Object3D, type Camera as ThreeCamera, type Scene } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { createLayer } from "../src/layer";
import type { GroundFrame, GroundPass } from "../src/pass";
import type { GroundRendererLike } from "../src/renderer";

function fakeRenderer(doc: Document): GroundRendererLike & {
  makeReady(): void;
  loseDevice(): void;
  renders: number;
} {
  let isReady = false;
  let isFailed = false;
  const readyCbs: Array<() => void> = [];
  const self = {
    canvas: doc.createElement("canvas"),
    renders: 0,
    ready: () => isReady,
    failed: () => isFailed,
    status: () => isFailed
      ? {
          backend: "webgpu" as const,
          ready: false,
          failed: true,
          failure: {
            kind: "device-lost" as const,
            backend: "webgpu" as const,
            message: "simulated device loss",
            api: "WebGPU" as const,
          },
        }
      : { backend: "webgpu" as const, ready: isReady, failed: false },
    onReady: (cb: () => void) => {
      if (isReady) cb();
      else readyCbs.push(cb);
    },
    setSize() {},
    render(_s: Scene, _c: ThreeCamera) {
      self.renders++;
    },
    dispose() {},
    makeReady() {
      isReady = true;
      for (const cb of readyCbs.splice(0)) cb();
    },
    loseDevice() {
      isReady = false;
      isFailed = true;
      readyCbs.length = 0;
    },
  };
  return self;
}

function fakePass(name: string): GroundPass & { collects: number; wakeRef: { wake: (() => void) | null } } {
  const wakeRef: { wake: (() => void) | null } = { wake: null };
  const self = {
    name,
    object: new Object3D(),
    collects: 0,
    wakeRef,
    arm(_world: World, wake: () => void) {
      wakeRef.wake = wake;
      return [];
    },
    collect(_world: World, _frame: GroundFrame) {
      self.collects++;
    },
    dispose() {},
  };
  return self;
}

function setup() {
  const container = document.createElement("div");
  const contentPlane = document.createElement("div");
  container.appendChild(contentPlane);
  document.body.appendChild(container);
  const world = createWorld();
  const engine = createEngine(world);
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  const renderer = fakeRenderer(document);
  const passA = fakePass("a");
  const passB = fakePass("b");
  const layer = createLayer({ container, contentPlane }, world, renderer, [passA, passB]);
  engine.registerReflector(layer.reflector);
  let now = 0;
  const step = () => {
    now += 16;
    engine.step(now);
  };
  return { world, engine, container, contentPlane, renderer, passA, passB, layer, step };
}

describe("ground layer", () => {
  it("mounts ONE canvas immediately before the content plane", () => {
    const { container, contentPlane, renderer } = setup();
    expect(contentPlane.previousElementSibling).toBe(renderer.canvas);
    expect(container.querySelectorAll("canvas")).toHaveLength(1);
    expect(renderer.canvas.style.pointerEvents).toBe("none");
  });

  it("defers flushes until the renderer is ready, then paints ONCE with all passes", () => {
    const { renderer, passA, passB, step, layer } = setup();
    step();
    step();
    expect(renderer.renders).toBe(0); // init pending — dirty stays armed
    expect(layer.reflector.available()).toBe(false);

    renderer.makeReady();
    step();
    expect(renderer.renders).toBe(1);
    expect(passA.collects).toBe(1);
    expect(passB.collects).toBe(1);
    expect(layer.reflector.available()).toBe(true);

    step(); // idle — nothing dirty
    expect(renderer.renders).toBe(1);
  });

  it("a single pass wake re-collects ONLY that pass but re-renders the canvas", () => {
    const { renderer, passA, passB, step } = setup();
    renderer.makeReady();
    step();
    passA.wakeRef.wake?.();
    step();
    expect(passA.collects).toBe(2);
    expect(passB.collects).toBe(1); // untouched pass reuses its geometry
    expect(renderer.renders).toBe(2);
  });

  it("camera dirt wakes EVERY pass (screen-space geometry re-maps)", () => {
    const { world, renderer, passA, passB, step } = setup();
    renderer.makeReady();
    step();
    world.setResource(Camera, { x: 50, y: 0, zoom: 1, gesturing: false });
    step();
    expect(passA.collects).toBe(2);
    expect(passB.collects).toBe(2);
  });

  it("stops the whole ground and exposes diagnostics after device loss", () => {
    const { world, renderer, layer, step } = setup();
    renderer.makeReady();
    step();
    const rendersBeforeLoss = renderer.renders;

    renderer.loseDevice();
    world.setResource(Camera, { x: 100, y: 20, zoom: 1, gesturing: false });
    step();

    expect(renderer.renders).toBe(rendersBeforeLoss);
    expect(layer.reflector.available()).toBe(false);
    expect(layer.reflector.rendererStatus()).toMatchObject({
      backend: "webgpu",
      failed: true,
      failure: { kind: "device-lost", api: "WebGPU" },
    });
  });

  it("dispose removes the canvas and stops rendering", () => {
    const { container, renderer, layer, step } = setup();
    renderer.makeReady();
    step();
    layer.dispose();
    expect(container.querySelectorAll("canvas")).toHaveLength(0);
    step(); // reflector may still be registered; flush must not throw
  });
});
