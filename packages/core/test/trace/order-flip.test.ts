/**
 * Ordered relations end-to-end (petition 8): the sibling-sequence law driven
 * through a REAL engine — createCanvasEngine + a real doc session, no
 * hand-wired systems. `getReverse(root, ChildOf)` is the assertion surface:
 * within a frame, paint/pick/drop order IS that sequence.
 *
 * Pinned:
 *  - spawns append "last" (spawn order = stacking order) and `order: "first"`
 *    prepends (the comment-box contract);
 *  - reorder(top/bottom) moves within the sequence, later ids outermost —
 *    the legacy fractional-z sweep's outcome, keyed on position;
 *  - duplicate inserts each clone {after: its source};
 *  - a real drag ELEVATES to the frame tail and the plain-move commit lands
 *    the placement in the SAME transaction (one gesture = one undo step —
 *    undo restores position AND order together).
 */
import { describe, expect, it } from "vitest";
import {
  BoardRoot,
  Camera,
  ChildOf,
  NO_MODS,
  Position,
  Viewport,
  createCanvasEngine,
  defineWidget,
  widgets,
  type CanvasEngine,
  type Entity,
} from "../../src";

const CARD =
  widgets.get("order:card") ??
  defineWidget({
    type: "order:card",
    surface: "dom",
    component: () => null,
    defaultSize: { w: 80, h: 60 },
  });
void CARD;

function makeRig() {
  const ce = createCanvasEngine({ widgets: [{ type: "order:card" }] });
  ce.engine.registerReflector({ name: "armed", observe: { resources: [Camera] }, flush: () => {} });
  ce.world.setResource(Viewport, { w: 800, h: 600, dpr: 1 });
  let now = 1000;
  const step = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      now += 16;
      ce.step(now);
    }
  };
  const mouse = (kind: "down" | "move" | "up", x: number, y: number, buttons: number): void => {
    ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: NO_MODS });
  };
  const stack = (): Entity[] => {
    const root = ce.world.getResource(BoardRoot)?.root;
    if (root === undefined) throw new Error("no board root — docs.create() must name one");
    return ce.world.getReverse(root, ChildOf);
  };
  return { ce, step, mouse, stack };
}

function spawnThree(ce: CanvasEngine, step: (n?: number) => void): [Entity, Entity, Entity] {
  ce.docs.create();
  const a = ce.ops.spawnWidget("order:card", { x: 0, y: 0, undoable: false });
  const b = ce.ops.spawnWidget("order:card", { x: 200, y: 0, undoable: false });
  const c = ce.ops.spawnWidget("order:card", { x: 400, y: 0, undoable: false });
  step(2); // project + equip + membership
  return [a, b, c];
}

describe("trace: the ordered-relations flip end-to-end (petition 8)", () => {
  it("spawn → reorder(top) → duplicate: getReverse tracks every op", () => {
    const { ce, step, stack } = makeRig();
    const [a, b, c] = spawnThree(ce, step);
    expect(stack()).toEqual([a, b, c]); // spawn order IS the sequence

    ce.ops.reorder([a], "top");
    step();
    expect(stack()).toEqual([b, c, a]); // top = the tail = painted last

    ce.ops.reorder([a, c], "bottom");
    step();
    // Sequential "first" moves: a prepends, then c prepends under it —
    // later ids finish LOWER, the legacy sweep's outcome.
    expect(stack()).toEqual([c, a, b]);

    ce.ops.setSelection([b]);
    const clones = ce.ops.duplicateSelection();
    step(2);
    expect(clones).toHaveLength(1);
    expect(stack()).toEqual([c, a, b, clones[0] as Entity]); // {after: source}
  });

  it("order: 'first' spawns under everything (the comment-box contract)", () => {
    const { ce, step, stack } = makeRig();
    const [a, b, c] = spawnThree(ce, step);
    const under = ce.ops.spawnWidget("order:card", { x: 600, y: 0, order: "first", undoable: false });
    step(2);
    expect(stack()).toEqual([under, a, b, c]);
  });

  it("a real drag elevates to the frame tail; the commit is one undo step for position + order", () => {
    const { ce, step, mouse, stack } = makeRig();
    const [a, b, c] = spawnThree(ce, step);

    // Drag a (at 0,0 80×60) by +40px: claim elevates it to the tail.
    mouse("down", 30, 20, 1);
    step();
    mouse("move", 70, 20, 1); // dead-zone exit
    step();
    expect(stack()).toEqual([b, c, a]); // elevated live (runtime divergence)
    mouse("move", 110, 20, 1);
    step();
    mouse("up", 110, 20, 0);
    step(2);
    expect(stack()).toEqual([b, c, a]); // the commit re-asserted the placement
    expect(ce.world.get(a, Position)?.x).toBeCloseTo(40, 3);

    // ONE undo step: position AND order restore together.
    expect(ce.docs.undo()).toBe(true);
    step(2);
    expect(ce.world.get(a, Position)?.x).toBeCloseTo(0, 3);
    expect(stack()).toEqual([a, b, c]);
  });
});
