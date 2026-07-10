/**
 * M4 cancellation matrix (implementation-plan M4 exit; design-003 §4.1/§5.3/§8).
 * Every way a live drag can die, asserted tick-by-tick against the REAL loop:
 *
 *  (a) pointercancel mid-drag → recognizer Cancelled, Position + StackZ restored
 *      from Grab, riders (Grab/Drags) removed;
 *  (b) blur-equivalent → the adapter's blur output (a pointer cancel + a mods-
 *      clearing key fact) unlatches the world's Keyboard resource AND cancels the
 *      gesture — the CORE-contract regression for commit 4778a6b's adapter fix;
 *  (c) capture death → despawning the CAPTURED widget mid-drag cancels the whole
 *      gesture next frame with no throw; riders on the SURVIVING dragged widgets
 *      are restored;
 *  (d) rejected-drop fly-back → StackZ restored to Grab.z on the SAME frame the
 *      tween attaches (4778a6b: an elevated z with no commit held remote z-edits
 *      forever), and nothing commits (the doc z is never written);
 *  (e) Movable gate → a Selectable-but-NOT-Movable widget's drag claims its
 *      pointer but routes no Move: it never grabs and never moves (4778a6b).
 */
import { createWorld, type Entity } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import {
  Accepts,
  Camera,
  Container,
  Drags,
  Grab,
  Keyboard,
  Movable,
  NO_MODS,
  Position,
  RoutedMove,
  Selectable,
  Size,
  StackZ,
  TransformTween,
  ClaimedBy,
  GesturePhases,
  createEngine,
  createRecordingCommitSink,
  installInteractionStack,
} from "../../src";
import { createTraceRig } from "./rig";

const P = GesturePhases;

/** Drive a mouse drag on `a` to Active with the box moved; returns the claimant. */
function dragToActive(rig: ReturnType<typeof createTraceRig>, a: Entity): Entity {
  rig.target("mouse", a);
  rig.down("mouse", 500, 500);
  rig.step(); // frame 1: Possible
  rig.move("mouse", 511, 500); // 11px > slop
  rig.step(); // frame 2: claim — Active, Grab, StackZ elevated
  const pointer = rig.pointerEntity("mouse");
  if (pointer === undefined) throw new Error("pointer missing after down");
  const claimant = rig.world.getRelation(pointer, ClaimedBy);
  if (claimant === undefined) throw new Error("no claim at slop exit");
  return claimant;
}

describe("cancel matrix (a): pointercancel mid-drag", () => {
  it("cancels the recognizer, restores Position AND StackZ from Grab, and removes riders", () => {
    const rig = createTraceRig();
    const a = rig.spawnBox({ x: 100, y: 100, z: 0 });
    const claimant = dragToActive(rig, a);
    expect(rig.world.has(a, Grab)).toBe(true);
    expect(rig.world.read(a, StackZ).z).toBeGreaterThan(0); // elevated during the drag

    rig.move("mouse", 531, 505);
    rig.step();
    expect(rig.world.read(a, Position)).toEqual({ x: 120, y: 105 });

    // A real pointercancel (touch stolen / OS gesture) lands as WentCancelled.
    rig.cancel("mouse", 531, 505);
    rig.step();

    expect(rig.world.hasTag(claimant, P.tags.Cancelled)).toBe(true);
    expect(rig.world.read(a, Position)).toEqual({ x: 100, y: 100 }); // restored
    expect(rig.world.read(a, StackZ).z).toBe(0); // StackZ restored from Grab.z
    expect(rig.world.has(a, Grab)).toBe(false); // rider removed
    expect(rig.world.getRelations(claimant, Drags)).toEqual([]); // edge removed
  });
});

describe("cancel matrix (b): blur unlatches Keyboard AND cancels the gesture", () => {
  it("the adapter's blur output (cancel + mods-clear key fact) clears Keyboard.space and cancels", () => {
    const rig = createTraceRig();
    const a = rig.spawnBox({ x: 100, y: 100, z: 0 });
    const claimant = dragToActive(rig, a);
    rig.move("mouse", 531, 505);
    rig.step();
    expect(rig.world.read(a, Position)).toEqual({ x: 120, y: 105 });

    // Space goes down mid-drag (the route is already latched to Move — unaffected).
    rig.key({ space: true });
    rig.step();
    expect(rig.world.getResource(Keyboard)?.space).toBe(true);

    // Blur: the browser sends no keyup and no pointerup, so the adapter enqueues
    // a synthetic cancel for the live pointer AND a mods-clearing key fact. The
    // regression (4778a6b): clearing only adapter-local state left the WORLD's
    // Keyboard latched (space-stuck: every canvas drag pans forever).
    rig.cancel("mouse", 531, 505);
    rig.key({}); // NO_MODS — the clearing fact
    rig.step();

    expect(rig.world.getResource(Keyboard)?.space).toBe(false); // unlatched
    expect(rig.world.hasTag(claimant, P.tags.Cancelled)).toBe(true); // gesture cancelled
    expect(rig.world.read(a, Position)).toEqual({ x: 100, y: 100 }); // riders restored
    expect(rig.world.has(a, Grab)).toBe(false);
  });
});

describe("cancel matrix (c): capture death mid-drag", () => {
  it("despawning the CAPTURED widget cancels the gesture; surviving riders restore, no throw", () => {
    const rig = createTraceRig();
    const a = rig.spawnBox({ x: 100, y: 100, z: 0 }); // will be captured + destroyed
    const b = rig.spawnBox({ x: 300, y: 100, z: 0 }); // co-dragged survivor

    // Select both (tap a, shift-tap b).
    rig.target("mouse", a);
    rig.down("mouse", 110, 110);
    rig.step();
    rig.up("mouse", 110, 110);
    rig.step(2);
    rig.target("mouse", b);
    rig.down("mouse", 310, 110, { mods: { shift: true } });
    rig.step();
    rig.up("mouse", 310, 110, { mods: { shift: true } });
    rig.step(2);

    // Grab a → both drag; a is the CAPTURED widget.
    rig.target("mouse", a);
    rig.down("mouse", 110, 110);
    rig.step();
    rig.move("mouse", 125, 110);
    rig.step(); // claim: Drags {a,b}
    const pointer = rig.pointerEntity("mouse");
    if (pointer === undefined) throw new Error("pointer missing");
    const claimant = rig.world.getRelation(pointer, ClaimedBy);
    if (claimant === undefined) throw new Error("no claim");
    expect(rig.world.has(a, Grab)).toBe(true);
    expect(rig.world.has(b, Grab)).toBe(true);

    rig.move("mouse", 145, 110); // +20 from slop exit
    rig.step();
    expect(rig.world.read(a, Position)).toEqual({ x: 120, y: 100 });
    expect(rig.world.read(b, Position)).toEqual({ x: 320, y: 100 });

    // The CAPTURED widget despawns (remote delete / undo) between frames.
    rig.world.destroy(a);
    expect(() => rig.step()).not.toThrow(); // integrity cancels; no ghost reads

    expect(rig.world.isAlive(a)).toBe(false);
    expect(rig.world.hasTag(claimant, P.tags.Cancelled)).toBe(true);
    // The survivor's riders are restored from ITS Grab (Position + StackZ), removed.
    expect(rig.world.read(b, Position)).toEqual({ x: 300, y: 100 });
    expect(rig.world.read(b, StackZ).z).toBe(0);
    expect(rig.world.has(b, Grab)).toBe(false);
  });
});

describe("cancel matrix (d): rejected-drop fly-back restores StackZ that frame", () => {
  it("attaches the tween AND restores StackZ to Grab.z with NO commit (doc z untouched)", () => {
    // Full stack (drop + tween) with a plain recording sink — no commit = no doc write.
    const world = createWorld();
    const engine = createEngine(world);
    const sink = createRecordingCommitSink();
    const stack = installInteractionStack(engine, { sink });
    engine.registerReflector({ name: "armed", always: false, flush: () => {} });
    world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false }); // screen == world

    let now = 1000;
    const step = (n = 1): void => {
      for (let i = 0; i < n; i++) {
        now += 16;
        engine.step(now);
      }
    };
    const mouse = (kind: "down" | "move" | "up", x: number, y: number, buttons: number): void => {
      stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: NO_MODS });
    };

    const box = world.spawn({
      components: [[Position, { x: 100, y: 100 }], [Size, { w: 80, h: 60 }], [StackZ, { z: 0 }]],
      tags: [Selectable, Movable],
    });
    // A container that does NOT accept the box (box has no Provides ⇒ mismatch).
    world.spawn({
      components: [
        [Position, { x: 400, y: 80 }],
        [Size, { w: 240, h: 200 }],
        [StackZ, { z: -1 }],
        [Accepts, { list: '["cards"]' }],
      ],
      tags: [Container],
    });
    step(); // spatial index picks up both

    mouse("down", 120, 120, 1);
    step();
    mouse("move", 140, 130, 1); // exits slop → Active, Grab, StackZ elevated
    step();
    expect(world.read(box, StackZ).z).toBeGreaterThan(0);
    expect(world.read(box, Grab).z).toBe(0);
    mouse("move", 500, 170, 1); // over the container → DropTarget, no OverlapCandidate
    step();

    mouse("up", 500, 170, 0);
    step(); // JustEnded → rejected drop → fly-back

    expect(world.has(box, TransformTween)).toBe(true); // easing home
    expect(world.read(box, StackZ).z).toBe(0); // StackZ back to Grab.z THAT frame
    expect(sink.intents).toHaveLength(0); // NO commit — the doc z is never written
  });
});

describe("cancel matrix (e): the Movable gate", () => {
  it("a Selectable-but-NOT-Movable widget claims its pointer but routes no Move and never grabs", () => {
    const rig = createTraceRig();
    const a = rig.spawnBox({ x: 100, y: 100, movable: false }); // selectable, NOT movable
    rig.target("mouse", a);

    rig.down("mouse", 500, 500);
    rig.step();
    rig.move("mouse", 511, 500); // exits slop → Drag Active, arbitration claims the pointer
    rig.step();
    const pointer = rig.pointerEntity("mouse");
    if (pointer === undefined) throw new Error("pointer missing");
    const claimant = rig.world.getRelation(pointer, ClaimedBy);
    expect(claimant).toBeDefined(); // the pointer IS claimed (no pan-through)
    if (claimant === undefined) return;
    expect(rig.world.hasTag(claimant, P.tags.Active)).toBe(true);
    expect(rig.world.hasTag(claimant, RoutedMove)).toBe(false); // but NO move route

    rig.move("mouse", 531, 505);
    rig.step();
    expect(rig.world.read(a, Position)).toEqual({ x: 100, y: 100 }); // never moves
    expect(rig.world.has(a, Grab)).toBe(false); // never grabs
  });
});
