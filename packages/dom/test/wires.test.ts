/**
 * wires reflector (P0 WIRES pass, screen-space canvas under content, design-004
 * §1): strokes cubic wires whose geometry comes from the kernel port anchors
 * (never a runtime port entity, so CULLED endpoints still draw — design-001
 * §5.3), the out-of-ECS connect preview (dashed free / solid snapped), and the
 * materialized port dots. Asserts draw calls, preview dash state, culled-endpoint
 * drawing with zero port entities, and change-only re-strokes.
 *
 * happy-dom's `getContext("2d")` returns `null` (no 2D engine — same as WebGL for
 * the grid), so — mirroring grid.test.ts's FakeResizeObserver — these tests stub
 * `getContext` to hand back a recording fake context and assert on its call log.
 */
import {
  Camera,
  createEngine,
  createWorld,
  defineQuery,
  defineWidget,
  type Entity,
  Port,
  PortAnchor,
  Position,
  PrefabId,
  RoutedConnect,
  Selected,
  Size,
  type Tag,
  widgets,
  Wire,
  WireFrom,
  WirePorts,
  WireTo,
} from "@ice/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCanvasHost } from "../src/host";
import { createWiresReflector, type WirePreview } from "../src/reflectors/wires";

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
  bezierCurveTo(...a: unknown[]): void {
    this.rec("bezierCurveTo", ...a);
  }
  stroke(): void {
    this.rec("stroke");
  }
  arc(...a: unknown[]): void {
    this.rec("arc", ...a);
  }
  fill(): void {
    this.rec("fill");
  }
  setLineDash(a: number[]): void {
    this.rec("setLineDash", a);
  }
  count(m: string): number {
    return this.calls.filter((c) => c.m === m).length;
  }
  reset(): void {
    this.calls = [];
  }
  hasDash(pattern: number[]): boolean {
    return this.calls.some((c) => c.m === "setLineDash" && JSON.stringify(c.args[0]) === JSON.stringify(pattern));
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
  // Register the node type once (idempotent across the suite's shared registry).
  if (widgets.get("wireNode") === undefined) {
    defineWidget({
      type: "wireNode",
      surface: "dom",
      component: () => null,
      defaultSize: { w: 100, h: 60 },
      ports: [
        { id: "out", side: "e" },
        { id: "in", side: "w" },
      ],
    });
  }
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

function setup(readPreview?: () => WirePreview) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const host = createCanvasHost(container);
  const world = createWorld();
  const engine = createEngine(world);
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  const reflector = createWiresReflector(host, world, readPreview ? { readPreview } : {});
  engine.registerReflector(reflector);
  let now = 0;
  const step = () => {
    now += 16;
    engine.step(now);
  };
  const ctx = () => capturedCtx as FakeContext2D;
  return { world, engine, host, container, reflector, step, ctx };
}

/** Spawn a wireNode widget at a world position. */
function spawnNode(world: ReturnType<typeof createWorld>, x: number, y: number) {
  return world.spawn({
    components: [
      [PrefabId, { id: "wireNode" }],
      [Position, { x, y }],
      [Size, { w: 100, h: 60 }],
    ],
  });
}

function spawnWire(world: ReturnType<typeof createWorld>, from: Entity, to: Entity, tags: Tag[] = []) {
  const wire = world.spawn({ components: [[WirePorts, { from: "out", to: "in" }]], tags: [Wire, ...tags] });
  world.setRelation(wire, WireFrom, from);
  world.setRelation(wire, WireTo, to);
  return wire;
}

const portQ = defineQuery([Port]);

describe("wires reflector", () => {
  it("is unavailable and never throws when there is no 2D context", () => {
    // Force getContext("2d") to null (the raw happy-dom behavior) for this test.
    HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
    const { world, step, reflector } = setup();
    expect(reflector.available()).toBe(false);
    expect(() => {
      spawnWire(world, spawnNode(world, 0, 0), spawnNode(world, 300, 0));
      step();
    }).not.toThrow();
    expect(reflector.available()).toBe(false);
  });

  it("mounts its canvas after the grid slot, immediately before the content plane", () => {
    const { host, container } = setup();
    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas?.nextElementSibling).toBe(host.contentPlane);
    expect((canvas as HTMLElement).style.pointerEvents).toBe("none");
  });

  it("strokes one cubic bezier per wire (geometry from kernel anchors)", () => {
    const { world, step, ctx } = setup();
    const a = spawnNode(world, 0, 0);
    const b = spawnNode(world, 300, 0);
    const c = spawnNode(world, 600, 0);
    spawnWire(world, a, b);
    spawnWire(world, b, c);
    step();

    expect(ctx().count("bezierCurveTo")).toBe(2);
    expect(ctx().count("moveTo")).toBe(2);
    expect(ctx().count("stroke")).toBe(2);
    expect(ctx().count("clearRect")).toBe(1);
  });

  it("draws a wire whose endpoint is far off-viewport, with zero port entities materialized", () => {
    const { world, step, ctx } = setup();
    const near = spawnNode(world, 0, 0);
    const farCulled = spawnNode(world, 5_000_000, 0); // way outside any viewport
    spawnWire(world, near, farCulled);
    step();

    // The whole point of design-001 §5.3: geometry needs only Position/Size —
    // no Port entity exists, and the wire still strokes.
    expect(world.firstOf(portQ)).toBeUndefined();
    expect(ctx().count("bezierCurveTo")).toBe(1);
  });

  it("draws the connect preview dashed while free/incompatible and solid when snapped-compatible", () => {
    const preview: WirePreview = { sx: 0, sy: 0, tx: 0, ty: 0, active: false, compatible: false };
    const { step, ctx } = setup(() => preview);
    step(); // first paint, preview idle

    preview.active = true;
    preview.compatible = false;
    preview.tx = 200;
    preview.ty = 120;
    ctx().reset();
    step();
    expect(ctx().count("bezierCurveTo")).toBe(1); // the preview curve
    expect(ctx().hasDash([6, 4])).toBe(true); // dashed while incompatible

    preview.compatible = true;
    ctx().reset();
    step();
    expect(ctx().count("bezierCurveTo")).toBe(1);
    expect(ctx().hasDash([6, 4])).toBe(false); // solid once compatible
  });

  it("draws a dot per materialized port, brighter during a connect drag", () => {
    const { world, step, ctx } = setup();
    const node = spawnNode(world, 0, 0);
    world.spawn({
      components: [
        [Port, { id: "out", side: "e", index: 0 }],
        [PortAnchor, { x: 100, y: 30 }],
      ],
    });
    // PortOf relation is not needed for drawing — PortAnchor carries world coords.
    void node;
    step();
    expect(ctx().count("arc")).toBe(1);
    const idleFill = ctx().fillStyle;

    // A connect drag is in progress → dots light up.
    world.spawn({ tags: [RoutedConnect] });
    ctx().reset();
    step();
    expect(ctx().count("arc")).toBe(1);
    expect(ctx().fillStyle).not.toBe(idleFill);
  });

  it("accents a Selected wire with a distinct stroke", () => {
    const { world, step, ctx } = setup();
    const a = spawnNode(world, 0, 0);
    const b = spawnNode(world, 300, 0);
    spawnWire(world, a, b, [Selected]);
    step();
    // The selected accent color differs from the neutral wire color.
    expect(ctx().strokeStyle).toBe("#4a90d9");
  });

  it("re-strokes change-only: static idle scene draws once, a camera change redraws", () => {
    const { world, step, reflector } = setup();
    spawnWire(world, spawnNode(world, 0, 0), spawnNode(world, 300, 0));
    step();
    expect(reflector.redraws()).toBe(1);

    step();
    step();
    expect(reflector.redraws()).toBe(1); // nothing changed, preview idle → no re-stroke

    world.setResource(Camera, { x: 50, y: 0, zoom: 1, gesturing: false });
    step();
    expect(reflector.redraws()).toBe(2); // pan → wires re-project
  });
});
