/**
 * Demo interaction path, headless: the FULL stack (`installInteractionStack` —
 * real picking + spatial index, exactly what main.ts boots) under the select tool.
 * Proves what a hand-tester would check — tap selects a box, drag moves a box
 * and commits once, and a drag on empty canvas pans instead of moving anything.
 */
import {
  ActiveTool,
  Camera,
  createEngine,
  createRecordingCommitSink,
  createWorld,
  Grab,
  type InputMods,
  installInteractionStack,
  Movable,
  NO_MODS,
  Position,
  Selectable,
  Selected,
  Size,
} from "@ice/core";
import { describe, expect, it } from "vitest";

function stack() {
  const world = createWorld();
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  const engine = createEngine(world);
  const sink = createRecordingCommitSink();
  // M10 tool-policy mechanization: the pan tool is a REAL hand tool now
  // (widget drags pan, never move) — this rig runs the select tool like the
  // demo's default, and the canvas-pan test uses the middle-button device
  // convention (honored above tool policy).
  const core = installInteractionStack(engine, { sink });
  world.setResource(ActiveTool, { id: "select" });

  let now = 1000;
  const enq = (kind: "down" | "move" | "up", x: number, y: number, buttons: number, mods?: Partial<InputMods>) =>
    core.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: { ...NO_MODS, ...mods } });
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      now += 16;
      engine.step(now);
    }
  };
  const box = (x: number, y: number) =>
    world.spawn({ components: [[Position, { x, y }], [Size, { w: 80, h: 60 }]], tags: [Selectable, Movable] });

  return { world, sink, enq, step, box };
}

describe("graybox demo interactions (real stack + app picking)", () => {
  it("taps a box to select it", () => {
    const s = stack();
    const a = s.box(100, 100); // screen == world at identity camera
    s.enq("down", 120, 110, 1);
    s.step(); // picking targets a; tap/drag spawn capturing a
    s.enq("up", 120, 110, 0);
    s.step(); // quick release within slop → tap Recognized → select
    expect(s.world.hasTag(a, Selected)).toBe(true);
  });

  it("drags a box to move it and commits exactly once", () => {
    const s = stack();
    const a = s.box(100, 100);
    s.enq("down", 120, 110, 1);
    s.step();
    s.enq("move", 140, 110, 1);
    s.step(); // 20px > slop → Active, RoutedMove; moveClaim attaches Grab + select-on-grab
    expect(s.world.has(a, Grab)).toBe(true);
    expect(s.world.hasTag(a, Selected)).toBe(true);

    s.enq("move", 160, 110, 1);
    s.step(); // integrates the drag → box moves right
    expect(s.world.read(a, Position).x).toBeGreaterThan(100);

    s.enq("up", 160, 110, 0);
    s.step(); // Ended → one commit intent
    expect(s.sink.intents).toHaveLength(1);
    expect(s.sink.intents[0]?.kind).toBe("move");
  });

  it("pans on an empty-canvas drag, moving no box", () => {
    const s = stack();
    const a = s.box(100, 100);
    const before = s.world.read(a, Position);
    s.enq("down", 500, 500, 4); // middle button: device pan convention → RoutedPan
    s.step();
    s.enq("move", 520, 500, 4);
    s.step(); // Active, RoutedPan
    s.enq("move", 560, 500, 4);
    s.step(); // camera pans; box is untouched
    const cam = s.world.getResource(Camera);
    expect(cam?.x).toBeLessThan(0); // panned right → camera.x drifts negative
    expect(s.world.read(a, Position)).toEqual(before);
    expect(s.world.has(a, Grab)).toBe(false);
  });
});
