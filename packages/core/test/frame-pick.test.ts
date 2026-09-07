// @vitest-environment node
// The frame pick source (design-014, B3b): with a source on the interaction
// stack, the ground's chrome is hittable — a press on the band outside the
// content rect grabs the card, a press on a PART (a control the ground draws)
// is a click on that control: it moves nothing, selects nothing, and reaches
// the app as a `PartTap`. Without a source, nothing changes: the band is the
// canvas. Full stack, real picking, a source that mirrors a card program.
import { createWorld } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import {
  Active,
  Camera,
  createEngine,
  createRecordingCommitSink,
  DownPart,
  type Entity,
  type FramePickSource,
  Grab,
  installInteractionStack,
  Movable,
  NO_MODS,
  PartTap,
  PointerPart,
  Position,
  Selectable,
  Selected,
  Size,
  TouchesExact,
  WidgetEquipped,
  defineQuery,
} from "../src";

const BAND = 8;          // the chrome band's reach past the content rect, world units
const CLOSE_R = 13;      // the close control's radius
const pointerQ = defineQuery([PointerPart]);

/** A source shaped like a card program's `pick`: the content rect, a band round it, a close disc at the top-right corner. */
function sourceFor(world: ReturnType<typeof createWorld>): FramePickSource {
  return {
    pad: () => BAND,
    hit(e, wx, wy) {
      const p = world.get(e, Position);
      const s = world.get(e, Size);
      if (p === undefined || s === undefined) return "outside";
      const inX = wx >= p.x && wx <= p.x + s.w;
      const inY = wy >= p.y && wy <= p.y + s.h;
      if (Math.hypot(wx - (p.x + s.w), wy - p.y) <= CLOSE_R) return "close";
      if (inX && inY) return "content";
      const inBandX = wx >= p.x - BAND && wx <= p.x + s.w + BAND;
      const inBandY = wy >= p.y - BAND && wy <= p.y + s.h + BAND;
      return inBandX && inBandY ? "frame" : "outside";
    },
  };
}

function makeRig(withSource: boolean) {
  const world = createWorld();
  const engine = createEngine(world);
  const sink = createRecordingCommitSink();
  const stack = installInteractionStack(engine, { sink });
  engine.registerReflector({ name: "armed", observe: { resources: [Camera] }, flush: () => {} });
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false }); // screen == world
  if (withSource) stack.framePick.current = sourceFor(world);
  let now = 1000;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; engine.step(now); } };
  const mouse = (kind: "down" | "move" | "up", x: number, y: number, buttons: number): void => {
    stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: NO_MODS });
  };
  // a widget as the pick's frame tier sees one: equipped, Active, movable, selectable
  const card = world.spawn({
    components: [[Position, { x: 100, y: 100 }], [Size, { w: 200, h: 120 }]],
    tags: [Selectable, Movable, WidgetEquipped, Active],
  });
  step(); // the spatial index picks up the card
  const pointerPart = (): string | undefined => {
    let part: string | undefined;
    world.query(pointerQ).each((b) => { for (const r of b) part = world.get(b.entity(r), PointerPart)?.part ?? undefined; });
    return part;
  };
  const exactOf = (): Entity | undefined => {
    let e: Entity | undefined;
    world.query(pointerQ).each((b) => { for (const r of b) e = world.getRelation(b.entity(r), TouchesExact); });
    return e;
  };
  return { world, stack, step, mouse, card, pointerPart, exactOf };
}

describe("the frame pick source (design-014, B3b)", () => {
  it("a press on the chrome band, outside the content rect, grabs the card", () => {
    const rig = makeRig(true);
    rig.mouse("down", 96, 160, 1);   // 4 px left of the content rect: on the band
    rig.step();
    expect(rig.exactOf()).toBe(rig.card);
    expect(rig.pointerPart()).toBe("");
    rig.mouse("move", 120, 170, 1);
    rig.step(3);
    expect(rig.world.has(rig.card, Grab)).toBe(true);
    expect(rig.world.hasTag(rig.card, Selected)).toBe(true);   // select-on-grab, as ever
  });

  it("a press on a PART is a click on a control: no move, no selection, a PartTap for the app", () => {
    const rig = makeRig(true);
    rig.mouse("down", 300, 100, 1);   // the top-right corner: the close disc
    rig.step();
    expect(rig.exactOf()).toBe(rig.card);
    expect(rig.pointerPart()).toBe("close");
    // the recognizers this down spawned carry the part
    let memos = 0;
    rig.world.query(defineQuery([DownPart])).each((b) => { memos += b.count; });
    expect(memos).toBeGreaterThan(0);
    rig.mouse("move", 306, 104, 1);   // past the drag slop, still holding
    rig.step(3);
    expect(rig.world.has(rig.card, Grab)).toBe(false);         // never moved
    rig.mouse("up", 306, 104, 0);
    rig.step(2);
    expect(rig.world.hasTag(rig.card, Selected)).toBe(false);  // never selected
    const tap = rig.world.getResource(PartTap);
    expect(tap?.target).toBe(rig.card);
    expect(tap?.part).toBe("close");
    expect(tap?.seq).toBe(1);
  });

  it("inside the content it is the content: the part is empty and a tap selects", () => {
    const rig = makeRig(true);
    rig.mouse("down", 200, 160, 1);
    rig.step();
    expect(rig.pointerPart()).toBe("");
    rig.mouse("up", 200, 160, 0);
    rig.step(2);
    expect(rig.world.hasTag(rig.card, Selected)).toBe(true);
    expect(rig.world.getResource(PartTap)).toBeUndefined();
  });

  it("without a source nothing changes: the band is the canvas, no part is ever written", () => {
    const rig = makeRig(false);
    rig.mouse("down", 96, 160, 1);
    rig.step();
    expect(rig.exactOf()).not.toBe(rig.card);
    expect(rig.pointerPart()).toBeUndefined();
    rig.mouse("move", 120, 170, 1);
    rig.step(3);
    expect(rig.world.has(rig.card, Grab)).toBe(false);
  });
});
