/**
 * A release coalesced with the input around it (2026-09-26 — found under CDP
 * input in apps/desk, reachable by hand: a quick trackpad tap, then a flick of
 * the cursor inside one frame).
 *
 * The frame folds its events into one sample per pointer. Before the fold's
 * cut, a click whose release and a far move shared a frame published `WentUp`
 * at the MOVE's point: the tap failed its slop, and the drag measured its dead
 * zone to a point reached after the release, went Active and captured the
 * clicked object — which then followed the cursor, a ghost drag. Now a
 * pointer's fold ends at its transition (l0-input.ts), and a drag that sees
 * its release while still Possible fails, dead zone crossed or not
 * (l2-recognize.ts) — pressed travel can still fold into the release's tick.
 *
 * REAL picking (`installInteractionStack`), armed like an app: on main the
 * one-tick click picked at the far point and never selected the box.
 */
import type { Entity } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import {
  Camera,
  Drag,
  GestureActive,
  Grab,
  Keyboard,
  Movable,
  NO_MODS,
  Pointer,
  PointerScreen,
  Position,
  Selectable,
  Selected,
  Size,
  WentDown,
  WentUp,
  createEngine,
  createRecordingCommitSink,
  createWorld,
  defineQuery,
  defineSystem,
  installInteractionStack,
  makeDefaultMayDiverge,
  type InputEvent,
  type InputMods,
} from "../../src";

const activeDragQ = defineQuery([Drag, GestureActive]);
const pointerQ = defineQuery([Pointer, PointerScreen]);

/** The box's rect: (100,100) 80×60. The click lands inside it; FAR is well outside. */
const AT = { x: 120, y: 120 };
const FAR = { x: 600, y: 400 };

function makeRig() {
  const world = createWorld();
  const engine = createEngine(world);
  const sink = createRecordingCommitSink();
  const stack = installInteractionStack(engine, { sink });
  // Armed like a real app: undeclared reads/writes DEV-throw here.
  engine.registerReflector({ name: "armed", observe: { resources: [Camera] }, flush: () => {} });
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false }); // screen == world
  let now = 1000;
  const step = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      now += 16;
      engine.step(now);
    }
  };
  const send = (
    kind: InputEvent["kind"],
    at: { x: number; y: number },
    buttons: number,
    opts: { pointerId?: string; mods?: Partial<InputMods> } = {},
  ): void => {
    const pointerId = opts.pointerId ?? (kind === "key" ? "" : "mouse");
    stack.queue.enqueue({
      kind,
      pointerId,
      device: pointerId === "pen" ? "pen" : "mouse",
      screenX: at.x,
      screenY: at.y,
      buttons,
      mods: { ...NO_MODS, ...opts.mods },
    });
  };
  const box = world.spawn({
    components: [
      [Position, { x: 100, y: 100 }],
      [Size, { w: 80, h: 60 }],
    ],
    tags: [Selectable, Movable],
  });
  step(); // the spatial index picks up the box
  const activeDrags = (): number => {
    let n = 0;
    world.query(activeDragQ).each((b) => {
      for (const _ of b) n++;
    });
    return n;
  };
  return { world, engine, stack, sink, step, send, box, activeDrags };
}

type Rig = ReturnType<typeof makeRig>;

/** After the click: nothing drags, nothing holds the box, and hover moves leave it where it was. */
function expectNothingFollows(rig: Rig): void {
  expect(rig.activeDrags()).toBe(0);
  expect(rig.world.has(rig.box, Grab)).toBe(false); // no move claim rider
  expect(makeDefaultMayDiverge(rig.world)(rig.box)).toBe(false); // no Active recognizer captures it
  for (const p of [{ x: 650, y: 420 }, { x: 700, y: 180 }, { x: 40, y: 500 }]) {
    rig.send("move", p, 0);
    rig.step();
  }
  expect(rig.activeDrags()).toBe(0);
  expect(rig.world.read(rig.box, Position)).toEqual({ x: 100, y: 100 });
  expect(rig.sink.intents).toHaveLength(0); // no move committed, now or at a later release
  rig.send("down", FAR, 1);
  rig.step();
  rig.send("up", FAR, 0);
  rig.step(2);
  expect(rig.world.read(rig.box, Position)).toEqual({ x: 100, y: 100 });
  expect(rig.sink.intents.filter((i) => i.kind === "move")).toHaveLength(0);
}

describe("trace: a release coalesced with the input around it", () => {
  it("down → up → far move in ONE tick: the click selects the box; nothing is captured, nothing moves", () => {
    const rig = makeRig();
    rig.send("down", AT, 1);
    rig.send("up", AT, 0);
    rig.send("move", FAR, 0);
    rig.step(3); // the down, the up, the move — one transition per tick
    expect(rig.world.hasTag(rig.box, Selected)).toBe(true);
    expect(rig.world.read(rig.box, Position)).toEqual({ x: 100, y: 100 });
    // Only the NEXT press releases the selection (a click on the canvas), so the
    // no-ghost checks run before it.
    expect(rig.activeDrags()).toBe(0);
    expect(rig.world.has(rig.box, Grab)).toBe(false);
    expect(makeDefaultMayDiverge(rig.world)(rig.box)).toBe(false);
    expectNothingFollows(rig);
  });

  it("down, then up → far move in the NEXT tick: the release is judged where it happened", () => {
    const rig = makeRig();
    rig.send("down", AT, 1);
    rig.step();
    rig.send("up", AT, 0);
    rig.send("move", FAR, 0);
    rig.step();
    expect(rig.world.hasTag(rig.box, Selected)).toBe(true); // the tap, on the release tick
    expect(rig.activeDrags()).toBe(0);
    expect(rig.world.has(rig.box, Grab)).toBe(false);
    rig.step();
    expectNothingFollows(rig);
  });

  it("a flick — pressed travel past the dead zone and the release in ONE tick — leaves no drag on the lifted pointer", () => {
    const rig = makeRig();
    rig.send("down", AT, 1);
    rig.step();
    rig.send("move", { x: AT.x + 40, y: AT.y }, 1); // 40px > dragSlopPx, still pressed
    rig.send("up", { x: AT.x + 40, y: AT.y }, 0);
    rig.step();
    // The tap failed its slop and the drag its release: the flick is no gesture.
    expect(rig.activeDrags()).toBe(0);
    expect(rig.world.hasTag(rig.box, Selected)).toBe(false);
    expectNothingFollows(rig);
  });

  it("the cut: a tick ends at a pointer's transition, and everything behind it waits in arrival order", () => {
    const rig = makeRig();
    // What each tick PUBLISHED — the one-tick tags are gone by the end of the step.
    const seen: { id: string; x: number; y: number; down: boolean; up: boolean }[][] = [];
    let frame: (typeof seen)[number] = [];
    rig.engine.addSystems(
      "react",
      defineSystem(
        pointerQ,
        (b, ctx) => {
          for (const r of b) {
            const p: Entity = b.entity(r);
            const s = ctx.read(p, PointerScreen);
            const id = ctx.read(p, Pointer).id ?? "";
            frame.push({ id, x: s.x, y: s.y, down: ctx.hasTag(p, WentDown), up: ctx.hasTag(p, WentUp) });
          }
        },
        { name: "probe" },
      ),
    );
    const tick = (): (typeof seen)[number] => {
      frame = [];
      rig.step();
      frame.sort((a, b) => a.id.localeCompare(b.id)); // archetype order is not arrival order
      seen.push(frame);
      return frame;
    };
    const shift = (): boolean => rig.world.getResource(Keyboard)?.shift === true;

    rig.send("down", AT, 1);
    rig.send("up", AT, 0);
    rig.send("key", { x: 0, y: 0 }, 0, { mods: { shift: true } });
    rig.send("move", { x: 300, y: 200 }, 0, { pointerId: "pen" });
    rig.send("move", FAR, 0);

    // Tick 1: the down alone — the mouse's fold closed at it; the key and the pen wait.
    expect(tick()).toEqual([{ id: "mouse", x: AT.x, y: AT.y, down: true, up: false }]);
    expect(shift()).toBe(false);
    expect(rig.stack.queue.size()).toBe(4);

    // Tick 2: the up AT the release point, and the key and the pen behind it; the far move waits.
    expect(tick()).toEqual([
      { id: "mouse", x: AT.x, y: AT.y, down: false, up: true },
      { id: "pen", x: 300, y: 200, down: false, up: false },
    ]);
    expect(shift()).toBe(true);
    expect(rig.stack.queue.size()).toBe(1);

    // Tick 3: the far move — a hover, after the click was over.
    expect(tick()).toEqual([
      { id: "mouse", x: FAR.x, y: FAR.y, down: false, up: false },
      { id: "pen", x: 300, y: 200, down: false, up: false },
    ]);
    expect(rig.stack.queue.size()).toBe(0);
    expect(rig.world.hasTag(rig.box, Selected)).toBe(true);

    // Between transitions the fold is unchanged: moves still collapse into one sample.
    rig.send("move", { x: 610, y: 400 }, 0);
    rig.send("move", { x: 620, y: 410 }, 0);
    rig.send("move", { x: 630, y: 420 }, 0);
    expect(tick()[0]).toEqual({ id: "mouse", x: 630, y: 420, down: false, up: false });
    expect(rig.stack.queue.size()).toBe(0);
  });
});
