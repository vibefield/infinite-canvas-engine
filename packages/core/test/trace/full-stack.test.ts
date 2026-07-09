/**
 * Full-stack smoke trace: `installInteractionStack` end to end — REAL picking
 * (no synthetic targeting), real spatial index, the §5 in-phase order as wired
 * by the installer itself. Tap-select and drag-move-commit through the whole
 * pipe prove the composition, not just the parts.
 */
import { createWorld } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import {
  Camera,
  Movable,
  NO_MODS,
  Position,
  Selectable,
  Selected,
  Size,
  StackZ,
  createEngine,
  createRecordingCommitSink,
  installInteractionStack,
} from "../../src";

function makeRig() {
  const world = createWorld();
  const engine = createEngine(world);
  const sink = createRecordingCommitSink();
  const stack = installInteractionStack(engine, { sink });
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false }); // screen == world
  let now = 1000;
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      now += 16;
      engine.step(now);
    }
  };
  const mouse = (kind: "down" | "move" | "up", x: number, y: number, buttons: number) => {
    stack.queue.enqueue({
      kind,
      pointerId: "mouse",
      device: "mouse",
      screenX: x,
      screenY: y,
      buttons,
      mods: NO_MODS,
    });
  };
  return { world, engine, sink, stack, step, mouse };
}

describe("full stack (installInteractionStack)", () => {
  it("tap on a box through REAL picking selects it; tap on empty canvas clears", () => {
    const rig = makeRig();
    const a = rig.world.spawn({
      components: [
        [Position, { x: 100, y: 100 }],
        [Size, { w: 80, h: 60 }],
        [StackZ, { z: 0 }],
      ],
      tags: [Selectable, Movable],
    });
    rig.step(); // spatial index picks up the box

    rig.mouse("down", 120, 120, 1); // inside the box
    rig.step();
    rig.mouse("up", 120, 120, 0);
    rig.step();
    expect(rig.world.hasTag(a, Selected)).toBe(true);

    rig.step(2); // reap
    rig.mouse("down", 500, 400, 1); // empty canvas
    rig.step();
    rig.mouse("up", 500, 400, 0);
    rig.step();
    expect(rig.world.hasTag(a, Selected)).toBe(false);
  });

  it("drag on a box through REAL picking moves and commits once", () => {
    const rig = makeRig();
    const a = rig.world.spawn({
      components: [
        [Position, { x: 100, y: 100 }],
        [Size, { w: 80, h: 60 }],
        [StackZ, { z: 0 }],
      ],
      tags: [Selectable, Movable],
    });
    rig.step();

    rig.mouse("down", 120, 120, 1);
    rig.step();
    rig.mouse("move", 135, 120, 1); // 15px — exits slop, claims, routes Move
    rig.step();
    rig.mouse("move", 155, 130, 1); // +20/+10 past dead-zone exit
    rig.step();
    expect(rig.world.read(a, Position)).toEqual({ x: 120, y: 110 });

    rig.mouse("up", 155, 130, 0);
    rig.step();
    expect(rig.sink.intents).toHaveLength(1);
    expect(rig.sink.intents[0]?.kind).toBe("move");
    expect(rig.world.hasTag(a, Selected)).toBe(true); // select-on-grab
  });
});
