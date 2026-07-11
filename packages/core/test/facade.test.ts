/**
 * M10 facade traces: createCanvasEngine construction, the ops catalog over a
 * real doc session, the draw tool end-to-end (route → behavior → create
 * intent → doc spawn), tool routing policy, live settings, and the
 * forwarding sink across doc close/reopen.
 */
import { describe, expect, it } from "vitest";
import {
  Camera,
  GestureSettings,
  Position,
  PrefabId,
  Selected,
  Size,
  StackZ,
  Viewport,
  createCanvasEngine,
  createDrawTool,
  defineQuery,
  defineWidget,
  tools,
  widgets,
  NO_MODS,
  type Entity,
} from "../src";

const CARD =
  widgets.get("facade:card") ??
  defineWidget({
    type: "facade:card",
    surface: "dom",
    component: () => null,
    defaultSize: { w: 120, h: 90 },
    minSize: { w: 30, h: 30 },
  });
void CARD;

const DRAW_TOOL = tools.get("draw:facade:card") ?? createDrawTool("facade:card");

function makeRig() {
  const ce = createCanvasEngine({ widgets: [{ type: "facade:card" }], tools: [DRAW_TOOL] });
  ce.engine.registerReflector({ name: "armed", always: false, flush: () => {} });
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
  return { ce, step, mouse };
}

describe("createCanvasEngine (design-005 §4)", () => {
  it("constructs doc-less; ops needing a doc throw with guidance; create() arms the sink", () => {
    const { ce, step, mouse } = makeRig();
    expect(() => ce.ops.spawnWidget("facade:card", { x: 0, y: 0 })).toThrowError(/docs.create/);

    ce.docs.create();
    const a = ce.ops.spawnWidget("facade:card", { x: 100, y: 100 });
    step(2); // project + equip + membership
    expect(ce.world.isAlive(a)).toBe(true);
    expect(ce.world.get(a, Position)).toEqual({ x: 100, y: 100 });

    // A real drag commits through the forwarding sink into THIS doc.
    // Drag totals rebase at dead-zone exit (M4-pinned): move#1 activates
    // (total 0), move#2 carries the 40px delta.
    mouse("down", 130, 120, 1);
    step();
    mouse("move", 170, 120, 1);
    step();
    mouse("move", 210, 120, 1);
    step();
    mouse("up", 210, 120, 0);
    step(2);
    expect(ce.world.get(a, Position)?.x).toBeCloseTo(140, 3);
    expect(ce.docs.undo()).toBe(true); // the move was ONE undo step
    step();
    expect(ce.world.get(a, Position)?.x).toBeCloseTo(100, 3);
  });

  it("draw tool: canvas drag creates the widget from the rect, one undoable tx", () => {
    const { ce, step, mouse } = makeRig();
    ce.docs.create();
    ce.ops.setTool(DRAW_TOOL.id);
    step();

    // The draw rect spans ACTIVATION→release (dead-zone exit rebases start,
    // the marquee-pinned semantic): activate at (200,161), release (320,251).
    mouse("down", 200, 150, 1);
    step();
    mouse("move", 200, 161, 1); // 11px > slop: activation point
    step();
    mouse("move", 320, 251, 1);
    step();
    mouse("up", 320, 251, 0);
    step(2); // create intent → doc spawn → projection

    const cardQ = defineQuery([Position, Size, PrefabId]);
    let created: Entity | undefined;
    ce.world.query(cardQ).each((b) => {
      for (const r of b) {
        const e = b.entity(r);
        if (ce.world.get(e, PrefabId)?.id === "facade:card") created = e;
      }
    });
    expect(created).toBeDefined();
    const pos = ce.world.get(created as Entity, Position);
    const size = ce.world.get(created as Entity, Size);
    expect(pos).toEqual({ x: 200, y: 161 });
    expect(size).toEqual({ w: 120, h: 90 });

    // Draw-CLICK: activation then a sub-4px release → default size centered
    // on the activation point (512-60, 400-45).
    mouse("down", 500, 400, 1);
    step();
    mouse("move", 512, 400, 1); // activation
    step();
    mouse("move", 513, 400, 1); // 1px total < click slop
    step();
    mouse("up", 513, 400, 0);
    step(2);
    const cards: Entity[] = [];
    ce.world.query(cardQ).each((b) => {
      for (const r of b) {
        const e = b.entity(r);
        if (ce.world.get(e, PrefabId)?.id === "facade:card") cards.push(e);
      }
    });
    expect(cards).toHaveLength(2);
    const clicked = cards.find((e) => e !== created) as Entity;
    expect(ce.world.get(clicked, Position)).toEqual({ x: 452, y: 355 });
    expect(ce.world.get(clicked, Size)).toEqual({ w: 120, h: 90 });

    // Each creation is ONE undo step.
    expect(ce.docs.undo()).toBe(true);
    step(2);
    expect(ce.world.isAlive(clicked)).toBe(false);
    expect(ce.docs.undo()).toBe(true);
    step(2);
    expect(ce.world.isAlive(created as Entity)).toBe(false);
  });

  it("pan tool routes widget drags to pan (gates.movable false): widget never moves", () => {
    const { ce, step, mouse } = makeRig();
    ce.docs.create();
    const a = ce.ops.spawnWidget("facade:card", { x: 100, y: 100 });
    step(2);
    ce.ops.setTool("pan");
    step();

    mouse("down", 130, 120, 1); // ON the widget
    step();
    mouse("move", 150, 120, 1); // activation
    step();
    mouse("move", 190, 120, 1); // 40px pan delta
    step();
    mouse("up", 190, 120, 0);
    step(2);
    expect(ce.world.get(a, Position)).toEqual({ x: 100, y: 100 }); // unmoved
    expect(ce.world.getResource(Camera)?.x).toBeLessThan(0); // the drag panned instead
  });

  it("ops: selection, duplicate (+16/+16, one undo step), reorder, delete cascade", () => {
    const { ce, step } = makeRig();
    ce.docs.create();
    const a = ce.ops.spawnWidget("facade:card", { x: 0, y: 0 });
    const b = ce.ops.spawnWidget("facade:card", { x: 300, y: 0 });
    step(2);

    ce.ops.setSelection([a, b]);
    const clones = ce.ops.duplicateSelection();
    step(2);
    expect(clones).toHaveLength(2);
    expect(ce.world.get(clones[0] as Entity, Position)).toEqual({ x: 16, y: 16 });
    expect(ce.world.hasTag(clones[0] as Entity, Selected)).toBe(true); // clones become the selection

    ce.ops.reorder([a], "top");
    const za = ce.world.get(a, StackZ)?.z ?? 0;
    for (const other of [b, ...clones]) {
      expect(za).toBeGreaterThan(ce.world.get(other as Entity, StackZ)?.z ?? 0);
    }

    ce.ops.setSelection([a]);
    ce.ops.deleteSelection();
    step(2);
    expect(ce.world.isAlive(a)).toBe(false);

    ce.docs.undo(); // delete undone
    step(2);
    ce.docs.undo(); // reorder undone
    ce.docs.undo(); // duplicate undone — ONE step for both clones
    step(2);
    let cardCount = 0;
    ce.world.query(defineQuery([PrefabId, Position])).each((bb) => {
      for (const r of bb) {
        if (ce.world.get(bb.entity(r), PrefabId)?.id === "facade:card") cardCount += 1;
      }
    });
    expect(cardCount).toBe(2); // back to a + b
  });

  it("settings seed + camera ops honor CameraLimits", () => {
    const ce = createCanvasEngine({ settings: { zoom: { min: 0.5, max: 2 }, gestures: { tapMaxMs: 99 } } });
    ce.world.setResource(Viewport, { w: 800, h: 600, dpr: 1 });
    expect(ce.world.getResource(GestureSettings)?.tapMaxMs).toBe(99);
    ce.ops.zoomTo(10); // clamped to max 2
    expect(ce.world.getResource(Camera)?.zoom).toBe(2);
    ce.ops.zoomTo(0.01); // clamped to min 0.5
    expect(ce.world.getResource(Camera)?.zoom).toBe(0.5);
  });

  it("doc switch: close + create rebinds the forwarding sink (no stack rebuild)", () => {
    const { ce, step, mouse } = makeRig();
    ce.docs.create();
    ce.ops.spawnWidget("facade:card", { x: 100, y: 100 });
    step(2);
    ce.docs.close();
    step();

    const s2 = ce.docs.create();
    const c = ce.ops.spawnWidget("facade:card", { x: 50, y: 50 });
    step(2);
    expect(ce.world.isAlive(c)).toBe(true);

    // Gesture commits land in the NEW doc.
    mouse("down", 80, 70, 1);
    step();
    mouse("move", 95, 70, 1); // activation
    step();
    mouse("move", 135, 70, 1); // 40px delta
    step();
    mouse("up", 135, 70, 0);
    step(2);
    expect(ce.world.get(c, Position)?.x).toBeCloseTo(90, 3);
    expect(s2.store.canUndo()).toBe(true);
  });
});
