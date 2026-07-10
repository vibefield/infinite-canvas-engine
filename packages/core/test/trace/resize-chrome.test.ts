/**
 * Full-stack resize trace: prove that selectionChrome's handles are pickable and
 * drive a real resize. Not synthetic — the chrome system spawns handle entities,
 * `spatialSync` indexes them, `picking` resolves a corner grab to the handle
 * (HandleSpec priority), `dragRoute` routes `RoutedResize`, `resizeClaim` +
 * `resizeBehavior` run, and `JustEnded` commits ONE `resize` intent. This is the
 * end-to-end wiring the M6 chrome slice exists to enable.
 */
import { createWorld } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import {
  Camera,
  createEngine,
  createRecordingCommitSink,
  defineQuery,
  type Entity,
  HandleSpec,
  installInteractionStack,
  Movable,
  NO_MODS,
  Position,
  Resizable,
  Selectable,
  Selected,
  Size,
  StackZ,
} from "../../src";

const handleQ = defineQuery([HandleSpec]);

function makeRig() {
  const world = createWorld();
  const engine = createEngine(world);
  const sink = createRecordingCommitSink();
  const stack = installInteractionStack(engine, { sink });
  // Chrome lands in derive — its handles feed the SAME spatial index picking uses.
  // selectionChrome ships inside installInteractionStack now (review fix) —
  // installing it again here would double the pool (16 handles).
  engine.registerReflector({ name: "armed", always: false, flush: () => {} });
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false }); // screen == world
  let now = 1000;
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      now += 16;
      engine.step(now);
    }
  };
  const mouse = (kind: "down" | "move" | "up", x: number, y: number, buttons: number) => {
    stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: NO_MODS });
  };
  const handleCount = () => {
    let n = 0;
    world.query(handleQ).each((b) => {
      n += b.count;
    });
    return n;
  };
  return { world, engine, sink, stack, step, mouse, handleCount };
}

describe("resize through selection chrome (full stack)", () => {
  it("tap-selects a box, chrome spawns handles, dragging the SE handle resizes + commits once", () => {
    const rig = makeRig();
    const box = rig.world.spawn({
      components: [
        [Position, { x: 100, y: 100 }],
        [Size, { w: 80, h: 60 }],
        [StackZ, { z: 0 }],
      ],
      tags: [Selectable, Movable, Resizable],
    });
    rig.step(); // spatial index picks up the box

    // Tap the box center → select it (full stack, real picking).
    rig.mouse("down", 140, 130, 1);
    rig.step();
    rig.mouse("up", 140, 130, 0);
    rig.step();
    expect(rig.world.hasTag(box, Selected)).toBe(true);

    // Let the tap reap, chrome spawn its pool, and spatialSync index the handles.
    rig.step(3);
    expect(rig.handleCount()).toBe(8);

    // Grab the SE handle (widget SE corner = (180,160)). The drag re-origins at
    // dead-zone exit (l2-recognize: no jump on promote), so the effective resize
    // delta is measured from the slop-exit point (195,175), not the down.
    rig.mouse("down", 180, 160, 1);
    rig.step();
    rig.mouse("move", 195, 175, 1); // 21px — exits slop, claims + routes Resize, total re-origins here
    rig.step();
    rig.mouse("move", 215, 195, 1); // +20,+20 from the slop-exit origin
    rig.step();

    // NW corner pinned, SE dragged → grows to 100×80 at (100,100).
    expect(rig.world.read(box, Position)).toEqual({ x: 100, y: 100 });
    expect(rig.world.read(box, Size)).toEqual({ w: 100, h: 80 });
    expect(rig.world.hasTag(box, Selected)).toBe(true); // selection survives the resize

    rig.mouse("up", 215, 195, 0);
    rig.step();
    expect(rig.sink.intents).toHaveLength(1);
    expect(rig.sink.intents[0]?.kind).toBe("resize");
    const writeEntities = new Set(rig.sink.intents[0]?.writes.map((w) => w.entity as Entity));
    expect(writeEntities.has(box)).toBe(true);
  });
});
