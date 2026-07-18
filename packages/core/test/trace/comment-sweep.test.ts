/**
 * SweepsContained — the UE-Blueprint comment drag (2026-07-18, James: "when
 * drag this comment widget, it will drag the entire contained widgets, and i
 * can also drag any of its inside widget outside").
 *
 * Pinned:
 *  - a move claim on a sweeping widget also claims every widget FULLY inside
 *    its bounds at claim time; all move together and land in ONE commit;
 *  - a widget straddling the edge is NOT swept (fully-inside rule);
 *  - dragging a member directly never moves the comment (spatial membership,
 *    no reparenting — dragging out is just a move).
 */
import { createWorld } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import {
  Camera,
  Grab,
  Movable,
  NO_MODS,
  Position,
  Selectable,
  Size,
  StackZ,
  SweepsContained,
  TransformTween,
  Viewport,
  createCanvasEngine,
  createEngine,
  createRecordingCommitSink,
  defineWidget,
  installInteractionStack,
  widgets,
} from "../../src";
import { createFullRig } from "./rig-full";

function makeBoard() {
  const rig = createFullRig();
  const comment = rig.spawnBox({ x: 0, y: 0, w: 400, h: 300, z: 0, sweeps: true });
  const member = rig.spawnBox({ x: 50, y: 50, w: 80, h: 60, z: 1 });
  const straddler = rig.spawnBox({ x: 370, y: 50, w: 80, h: 60, z: 1 }); // pokes out the right edge
  const outsider = rig.spawnBox({ x: 600, y: 50, w: 80, h: 60, z: 1 });
  return { rig, comment, member, straddler, outsider };
}

describe("trace: comment-box sweep (SweepsContained)", () => {
  it("dragging the comment body carries fully-contained widgets, one commit", () => {
    const { rig, comment, member, straddler, outsider } = makeBoard();
    rig.down("mouse", 300, 250); // empty comment body — below the member
    rig.step();
    rig.move("mouse", 315, 250); // slop exit → Active; origin (315,250)
    rig.step();
    expect(rig.world.has(comment, Grab)).toBe(true);
    expect(rig.world.has(member, Grab)).toBe(true); // swept
    expect(rig.world.has(straddler, Grab)).toBe(false); // not fully inside
    expect(rig.world.has(outsider, Grab)).toBe(false);

    rig.move("mouse", 415, 350); // total (100,100)
    rig.step();
    expect(rig.world.read(comment, Position)).toEqual({ x: 100, y: 100 });
    expect(rig.world.read(member, Position)).toEqual({ x: 150, y: 150 });
    expect(rig.world.read(straddler, Position)).toEqual({ x: 370, y: 50 });
    expect(rig.world.read(outsider, Position)).toEqual({ x: 600, y: 50 });

    rig.up("mouse", 415, 350);
    rig.step();
    expect(rig.sink.intents).toHaveLength(1);
    const intent = rig.sink.intents[0];
    expect(intent?.kind).toBe("move");
    const moved = new Set(intent?.writes.filter((w) => w.component === Position).map((w) => w.entity));
    expect(moved.has(comment)).toBe(true);
    expect(moved.has(member)).toBe(true);
    expect(moved.has(outsider)).toBe(false);
  });

  it("a comment group FILES into an accepting container (2026-07-18: 'i do want that')", () => {
    const rig = createFullRig();
    const comment = rig.spawnBox({ x: 0, y: 0, w: 300, h: 250, z: 0.5, sweeps: true, provides: ["widget"] });
    const member = rig.spawnBox({ x: 50, y: 50, w: 80, h: 60, z: 1, provides: ["widget"] });
    const folder = rig.spawnBox({
      x: 600,
      y: 300,
      w: 200,
      h: 200,
      container: true,
      accepts: ["widget"],
      selectable: false,
      movable: false,
    });
    rig.down("mouse", 250, 220); // comment body, clear of the member
    rig.step();
    rig.move("mouse", 265, 220);
    rig.step();
    rig.move("mouse", 765, 420); // total (500,200): the group overlaps the folder
    rig.step();
    rig.up("mouse", 765, 420);
    rig.step();
    expect(rig.sink.intents).toHaveLength(1);
    const intent = rig.sink.intents[0];
    expect(intent?.kind).toBe("consume");
    const reparented = new Set((intent?.reparents ?? []).map((r) => r.entity));
    expect(reparented.has(comment)).toBe(true);
    expect(reparented.has(member)).toBe(true);
    expect(reparented.has(folder)).toBe(false);
  });

  it("a comment group over a NON-matching container is a plain move, never a fly-back", () => {
    const rig = createFullRig();
    const comment = rig.spawnBox({ x: 0, y: 0, w: 300, h: 250, z: 0.5, sweeps: true, provides: ["widget"] });
    rig.spawnBox({ x: 50, y: 50, w: 80, h: 60, z: 1, provides: ["widget"] });
    rig.spawnBox({
      x: 600,
      y: 300,
      w: 200,
      h: 200,
      container: true,
      accepts: ["other"], // no match — the old rule would DropTarget + fly back
      selectable: false,
      movable: false,
    });
    rig.down("mouse", 250, 220);
    rig.step();
    rig.move("mouse", 265, 220);
    rig.step();
    rig.move("mouse", 765, 420);
    rig.step();
    rig.up("mouse", 765, 420);
    rig.step();
    expect(rig.sink.intents).toHaveLength(1);
    expect(rig.sink.intents[0]?.kind).toBe("move");
    expect(rig.world.has(comment, TransformTween)).toBe(false); // no fly-back
    expect(rig.world.read(comment, Position)).toEqual({ x: 500, y: 200 });
  });

  it("a comment group is landscape, not cargo: release over a Solid card is a PLAIN move", () => {
    const { rig, comment, member } = makeBoard();
    // A solid card sitting where the group will land — a normal drag would
    // DropTarget it and fly back (v1 iOS-card contract).
    rig.spawnBox({ x: 700, y: 300, w: 100, h: 100, z: 2, solid: true });

    rig.down("mouse", 300, 250);
    rig.step();
    rig.move("mouse", 315, 250);
    rig.step();
    rig.move("mouse", 715, 350); // union bounds now overlap the solid card
    rig.step();
    rig.up("mouse", 715, 350);
    rig.step();
    expect(rig.sink.intents).toHaveLength(1); // committed — NOT a fly-back
    expect(rig.sink.intents[0]?.kind).toBe("move");
    expect(rig.world.read(comment, Position)).toEqual({ x: 400, y: 100 });
    expect(rig.world.read(member, Position)).toEqual({ x: 450, y: 150 });
  });

  it("full stack + ARMED enforcement: the sweep works through installInteractionStack", () => {
    // The bare rig wires systems by hand and never arms strata enforcement;
    // this variant is the app-shaped path (real installer, real picking,
    // armed reflector) — a live-only failure must reproduce HERE.
    const world = createWorld();
    const engine = createEngine(world);
    const sink = createRecordingCommitSink();
    const stack = installInteractionStack(engine, { sink });
    engine.registerReflector({ name: "armed", observe: { resources: [Camera] }, flush: () => {} });
    world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    const comment = world.spawn({
      components: [
        [Position, { x: 0, y: 0 }],
        [Size, { w: 400, h: 300 }],
        [StackZ, { z: 0.5 }], // the app spawns comments at a fractional low z
      ],
      tags: [Selectable, Movable, SweepsContained],
    });
    const member = world.spawn({
      components: [
        [Position, { x: 50, y: 50 }],
        [Size, { w: 80, h: 60 }],
        [StackZ, { z: 1 }],
      ],
      tags: [Selectable, Movable],
    });
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
    step();

    mouse("down", 300, 250, 1); // empty comment body
    step();
    mouse("move", 315, 250, 1); // slop exit
    step();
    mouse("move", 415, 350, 1); // total (100,100)
    step();
    expect(world.read(comment, Position)).toEqual({ x: 100, y: 100 });
    expect(world.read(member, Position)).toEqual({ x: 150, y: 150 });
    mouse("up", 415, 350, 0);
    step();
    expect(sink.intents.some((i) => i.kind === "move")).toBe(true);
  });

  it("FACADE engine (real defs + doc + tools): C-shaped comment drags its member", () => {
    // The app-exact path: createCanvasEngine, defineWidget defs (press-drag,
    // resizable, sweepContained), durable spawns at fractional z, selection
    // set to the fresh comment — the live widgetlab scenario end to end.
    const CMT =
      widgets.get("cmt:c") ??
      defineWidget({
        type: "cmt:c",
        surface: "dom",
        component: null,
        defaultSize: { w: 400, h: 300 },
        interaction: { selectable: true, movable: true, resizable: true, snap: "target", dragOn: "press", sweepContained: true },
      });
    const BX =
      widgets.get("cmt:m") ??
      defineWidget({
        type: "cmt:m",
        surface: "dom",
        component: null,
        defaultSize: { w: 80, h: 60 },
        interaction: { selectable: true, movable: true, solid: true, snap: "both", dragOn: "press" },
        provides: ["widget"],
      });
    const ce = createCanvasEngine({ widgets: [CMT, BX] });
    ce.docs.create();
    ce.world.setResource(Viewport, { w: 1600, h: 900, dpr: 1 });
    const member = ce.ops.spawnWidget("cmt:m", { x: 50, y: 50, w: 80, h: 60, undoable: false });
    const comment = ce.ops.spawnWidget("cmt:c", { x: 0, y: 0, w: 400, h: 300, z: 0.5, undoable: false });
    ce.world.sync();
    let now = 1000;
    const step = (n = 1): void => {
      for (let i = 0; i < n; i++) {
        now += 16;
        ce.step(now);
      }
    };
    step(5);
    ce.ops.setSelection([comment]); // post-C state

    const mouse = (kind: "down" | "move" | "up", x: number, y: number, buttons: number): void => {
      ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: NO_MODS });
    };
    mouse("down", 300, 250, 1); // empty comment body (identity camera default)
    step();
    mouse("move", 315, 250, 1);
    step();
    mouse("move", 415, 350, 1);
    step();
    expect(ce.world.get(comment, Position)).toEqual({ x: 100, y: 100 });
    expect(ce.world.get(member, Position)).toEqual({ x: 150, y: 150 });
    mouse("up", 415, 350, 0);
    step(3);
    ce.dispose();
  });

  it("dragging a member directly moves it alone — out of the comment is just a move", () => {
    const { rig, comment, member } = makeBoard();
    rig.down("mouse", 90, 80); // on the member (z 1, above the comment)
    rig.step();
    rig.move("mouse", 105, 80);
    rig.step();
    expect(rig.world.has(member, Grab)).toBe(true);
    expect(rig.world.has(comment, Grab)).toBe(false);

    rig.move("mouse", 605, 80); // total (500,0) → far outside the comment
    rig.step();
    rig.up("mouse", 605, 80);
    rig.step();
    expect(rig.world.read(member, Position)).toEqual({ x: 550, y: 50 });
    expect(rig.world.read(comment, Position)).toEqual({ x: 0, y: 0 });

    // Re-drag the comment: the departed member is no longer inside → stays.
    rig.down("mouse", 300, 250);
    rig.step();
    rig.move("mouse", 315, 250);
    rig.step();
    expect(rig.world.has(comment, Grab)).toBe(true);
    expect(rig.world.has(member, Grab)).toBe(false);
  });
});
