// Exercise real pointer recognition, selection, claims and document history together.
import { Camera, CancelRequest, createCanvasEngine, type Entity, Keyboard, Locked, NO_MODS, Position, selectedEntities, Viewport } from "@ice/core";
import { describe, expect, it } from "vitest";
import { DESK_ENGINE } from "../src";
import { must } from "../../desk/test/must";

function desk(types = ["desk.note", "desk.note"], zoom = 1) {
  const ce = createCanvasEngine(DESK_ENGINE);
  ce.docs.create();
  const items = types.map((type, i) => ce.ops.spawnWidget(type, { x: 100 + i * 300, y: 100, w: 160, h: 160, undoable: false }));
  let time = 0;
  const step = () => { time += 16; ce.step(time); };
  step();
  ce.world.setResource(Camera, { x: 0, y: 0, zoom, gesturing: false });
  ce.world.setResource(Viewport, { w: 1200, h: 900, dpr: 1 });
  const mouse = (kind: "down" | "move" | "up", x: number, y: number, buttons: number, shift = false) => {
    ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x * zoom, screenY: y * zoom, buttons, mods: { ...NO_MODS, shift } });
    step();
  };
  const marquee = () => {
    mouse("move", 40, 40, 0); mouse("down", 40, 40, 1);
    mouse("move", 55, 55, 1); mouse("move", 590, 290, 1); mouse("up", 590, 290, 0);
    expect(new Set(selectedEntities(ce.world))).toEqual(new Set(items));
  };
  const drag = (x: number, y: number, shift = false, buttons = 1) => {
    mouse("move", x, y, 0, shift); mouse("down", x, y, buttons, shift);
    mouse("move", x + 32, y, buttons, shift); // the activation frame rebases at the slop exit
    mouse("move", x + 112, y + 40, buttons, shift);
  };
  const position = (e: Entity) => ({ ...ce.world.read(e, Position) });
  const positions = () => items.map(position);
  return { ce, items, mouse, step, marquee, drag, position, positions };
}

describe("dragging a marquee selection", () => {
  it.each([0.5, 1, 2])("moves from empty space inside the selection at zoom %s, as one undoable move", (zoom) => {
    const d = desk(undefined, zoom);
    try {
      d.marquee();
      const before = d.positions();
      d.drag(330, 180);
      expect(d.ce.stack.marqueeBuffer.rect).toBeNull();
      expect(d.positions()).toEqual(before.map(p => ({ x: p.x + 80, y: p.y + 40 })));
      d.mouse("up", 442, 220, 0);
      expect(new Set(selectedEntities(d.ce.world))).toEqual(new Set(d.items));
      expect(d.ce.world.getResource(Camera)).toMatchObject({ x: 0, y: 0, zoom });
      const store = must(d.ce.docs.current()).store;
      expect(store.canUndo()).toBe(true);
      store.undo(); d.step();
      expect(d.positions()).toEqual(before);
      expect(store.canUndo()).toBe(false);
      store.redo(); d.step();
      expect(d.positions()).toEqual(before.map(p => ({ x: p.x + 80, y: p.y + 40 })));
    } finally { d.ce.dispose(); }
  });

  it.each([
    { types: ["desk.photo", "desk.photo"], x: 330, label: "between prints" },
    { types: ["desk.photo", "desk.photo"], x: 180, label: "on a selected print" },
    { types: ["desk.photo", "desk.note"], x: 180, label: "on a print in a mixed selection" },
    { types: ["desk.note", "desk.photo"], x: 180, label: "on a note in a mixed selection" },
  ])("moves all selected objects $label", ({ types, x }) => {
    const d = desk(types);
    try {
      d.marquee();
      const before = d.positions();
      d.drag(x, 180); d.mouse("up", x + 112, 220, 0);
      expect(d.positions()).toEqual(before.map(p => ({ x: p.x + 80, y: p.y + 40 })));
      expect(d.ce.world.getResource(Camera)).toMatchObject({ x: 0, y: 0, zoom: 1 });
      must(d.ce.docs.current()).store.undo(); d.step();
      expect(d.positions()).toEqual(before);
      expect(must(d.ce.docs.current()).store.canUndo()).toBe(false);
    } finally { d.ce.dispose(); }
  });

  it("pinch zoom still reaches the canvas while a selected print belongs to a group drag", () => {
    const d = desk(["desk.photo", "desk.photo"]);
    try {
      d.marquee(); d.drag(180, 180);
      d.ce.stack.queue.enqueue({ kind: "wheel", pointerId: "mouse", device: "mouse", screenX: 292, screenY: 220, buttons: 1, mods: { ...NO_MODS, ctrl: true }, wheel: { dx: 0, dy: 0, pinch: -20 } });
      d.step();
      expect(d.ce.world.getResource(Camera)?.zoom).toBeCloseTo(Math.exp(0.2), 6);
    } finally { d.ce.dispose(); }
  });

  it("Escape restores the whole group without committing", () => {
    const d = desk(["desk.photo", "desk.note"]);
    try {
      d.marquee(); const before = d.positions(); d.drag(330, 180);
      expect(d.positions()).not.toEqual(before);
      d.ce.world.setResource(CancelRequest, { active: true }); d.step();
      expect(d.positions()).toEqual(before);
      expect(must(d.ce.docs.current()).store.canUndo()).toBe(false);
    } finally { d.ce.dispose(); }
  });

  it("keeps locked members fixed while the rest of the selection moves", () => {
    const d = desk();
    try {
      d.marquee(); const before = d.positions();
      d.ce.world.addTag(must(d.items[0]), Locked);
      d.drag(330, 180); d.mouse("up", 442, 220, 0);
      expect(d.position(must(d.items[0]))).toEqual(before[0]);
      expect(d.position(must(d.items[1]))).toEqual({ x: 480, y: 140 });
    } finally { d.ce.dispose(); }
  });

  it.each([{ x: 330, y: 180, shift: true }, { x: 650, y: 350, shift: false }])("still starts a marquee for $x,$y with shift=$shift", ({ x, y, shift }) => {
    const d = desk();
    try {
      d.marquee(); const before = d.positions(); d.drag(x, y, shift);
      expect(d.ce.stack.marqueeBuffer.rect).not.toBeNull();
      expect(d.positions()).toEqual(before);
    } finally { d.ce.dispose(); }
  });

  it("a press outside the selection cannot turn into a group drag when it enters the bounds", () => {
    const d = desk();
    try {
      d.marquee(); const before = d.positions();
      d.mouse("down", 330, 60, 1); d.mouse("move", 330, 180, 1); d.mouse("move", 380, 220, 1);
      expect(d.ce.stack.marqueeBuffer.rect).not.toBeNull();
      expect(d.positions()).toEqual(before);
    } finally { d.ce.dispose(); }
  });

  it.each(["space", "middle", "pan tool"])("%s still pans from a gap in the selection", mode => {
    const d = desk();
    try {
      d.marquee(); const before = d.positions();
      if (mode === "space") d.ce.world.setResource(Keyboard, { space: true, shift: false, alt: false, ctrl: false, meta: false });
      if (mode === "pan tool") { d.ce.ops.setTool("pan"); d.step(); }
      d.drag(330, 180, false, mode === "middle" ? 4 : 1);
      expect(d.positions()).toEqual(before);
      expect(d.ce.world.getResource(Camera)?.x).not.toBe(0);
    } finally { d.ce.dispose(); }
  });
});
