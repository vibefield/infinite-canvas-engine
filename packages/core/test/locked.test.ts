/**
 * design-015 D2a-core, item 6: the tape — `Locked` and `ops.setLocked`.
 *
 * A durable tag with one writer (`ops.setLocked`, one transaction, one undo
 * step, change-only, refused on a read-only document). A taped widget is never
 * moved or resized by a gesture (moveClaim/resizeClaim give it no rider), the
 * marquee passes over it (Q-g), and it stays selectable and pickable. Every
 * negative below has its control: the same gesture on the untaped widget does
 * move, resize or gather it, so no assertion passes because the gesture did
 * nothing at all.
 */
import { describe, expect, it } from "vitest";
import {
  Camera,
  HandleSpec,
  Locked,
  NO_MODS,
  Pointer,
  Position,
  Selected,
  Size,
  TouchesExact,
  Viewport,
  createCanvasEngine,
  defineQuery,
  defineWidget,
  widgets,
  type Entity,
  type InputMods,
} from "../src";

const CARD =
  widgets.get("lk:card") ??
  defineWidget({
    type: "lk:card",
    surface: "dom",
    component: () => null,
    defaultSize: { w: 120, h: 90 },
    interaction: { resizable: true },
  });

const handleQ = defineQuery([HandleSpec, Position, Size]);
const pointerQ = defineQuery([Pointer]);

function rig() {
  const ce = createCanvasEngine({ widgets: [CARD] });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 1200, h: 800, dpr: 1 });
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false }); // screen == world
  let now = 1000;
  const step = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      now += 16;
      ce.step(now);
    }
  };
  const mouse = (kind: "down" | "move" | "up", x: number, y: number, buttons: number, mods?: Partial<InputMods>): void => {
    ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: { ...NO_MODS, ...mods } });
  };
  /**
   * A mouse drag whose TOTAL is (tx − fx, ty − fy): it leaves the dead zone first (12 px right),
   * because a drag's origin is where it leaves (l2's Drag.start), then travels in four moves.
   */
  const drag = (fx: number, fy: number, tx: number, ty: number, mods?: Partial<InputMods>): void => {
    mouse("move", fx, fy, 0, mods);
    step();
    mouse("down", fx, fy, 1, mods);
    step();
    const ox = fx + 12;
    mouse("move", ox, fy, 1, mods);
    step();
    for (let i = 1; i <= 4; i++) {
      mouse("move", ox + ((tx - fx) * i) / 4, fy + ((ty - fy) * i) / 4, 1, mods);
      step();
    }
    mouse("up", ox + (tx - fx), ty, 0, mods);
    step(3);
  };
  const spawn = (x: number, y: number): Entity => {
    const e = ce.ops.spawnWidget(CARD.type, { x, y, undoable: false });
    ce.world.sync();
    return e;
  };
  const pos = (e: Entity) => ce.world.get(e, Position);
  const exact = (): Entity | undefined => {
    let hit: Entity | undefined;
    ce.world.query(pointerQ).each((b) => {
      for (const r of b) hit = ce.world.getRelation(b.entity(r), TouchesExact);
    });
    return hit;
  };
  return { ce, step, mouse, drag, spawn, pos, exact };
}

describe("ops.setLocked — the tape's one writer (design-015 §5.1)", () => {
  it("writes the durable tag in ONE transaction, change-only, undoable as one step", () => {
    const { ce, step, spawn } = rig();
    const a = spawn(100, 100);
    const b = spawn(300, 100);
    step(3);
    // a tx lands in the world at the next sync, like every facade write (hence the steps)
    ce.ops.setLocked([a, b, a], true); // a duplicate id is one id
    step();
    expect(ce.world.hasTag(a, Locked)).toBe(true);
    expect(ce.world.hasTag(b, Locked)).toBe(true);
    ce.ops.setLocked([a], true); // no change: the op opens no transaction (and strata would stage nothing anyway)
    step();
    expect(ce.docs.undo()).toBe(true); // the ONE step: both lift together
    step();
    expect(ce.world.hasTag(a, Locked)).toBe(false);
    expect(ce.world.hasTag(b, Locked)).toBe(false);
    expect(ce.docs.undo()).toBe(false); // nothing else was ever pushed
    expect(ce.docs.redo()).toBe(true);
    step();
    expect(ce.world.hasTag(a, Locked)).toBe(true);
    expect(ce.world.hasTag(b, Locked)).toBe(true);
    ce.ops.setLocked([b], false);
    step();
    expect(ce.world.hasTag(b, Locked)).toBe(false);
    expect(ce.world.hasTag(a, Locked)).toBe(true);
    // ids that are no widget of this frame are passed over, not refused
    ce.ops.setLocked([ce.stack.canvasSurface], true);
    expect(ce.world.hasTag(ce.stack.canvasSurface, Locked)).toBe(false);
    ce.dispose();
  });

  it("is document truth: it rides the saved bytes into another engine", () => {
    const { ce, step, spawn } = rig();
    const a = spawn(100, 100);
    spawn(300, 100);
    step(2);
    ce.ops.setLocked([a], true);
    const bytes = ce.docs.current()?.exportEnvelope();
    ce.dispose();
    if (bytes === undefined) throw new Error("no session");
    const other = createCanvasEngine({ widgets: [CARD] });
    const opened = other.docs.open(bytes);
    if (!opened.ok) throw new Error(`open failed: ${opened.reason}`);
    other.step(16);
    const taped: Entity[] = [];
    other.world.query(defineQuery([Locked])).each((b) => {
      for (const r of b) taped.push(b.entity(r));
    });
    expect(taped).toHaveLength(1);
    expect(other.world.get(taped[0] as Entity, Position)).toEqual({ x: 100, y: 100 });
    other.dispose();
  });

  it("refuses on a read-only document, like every write op", () => {
    const { ce, spawn } = rig();
    spawn(10, 10);
    const bytes = ce.docs.current()?.exportEnvelope();
    ce.dispose();
    if (bytes === undefined) throw new Error("no session");
    const ro = createCanvasEngine({ widgets: [CARD] });
    const opened = ro.docs.open(bytes, { onGate: () => "readOnly" });
    if (!opened.ok) throw new Error(`open failed: ${opened.reason}`);
    expect(() => ro.ops.setLocked([], true)).toThrow(/ops\.setLocked — the document is read-only/);
    ro.dispose();
  });
});

describe("a taped widget under gestures (design-015 §5.1, Q-e)", () => {
  it("a drag on it moves nothing and commits nothing; it is still selected", () => {
    const { ce, step, drag, spawn, pos } = rig();
    const a = spawn(100, 100);
    const b = spawn(400, 100);
    step(3);
    ce.ops.setLocked([a], true);
    drag(150, 140, 250, 240);
    expect(pos(a)).toEqual({ x: 100, y: 100 });
    expect(ce.world.hasTag(a, Selected)).toBe(true); // select-on-grab, as ever
    // control: the same drag on the untaped one moves it
    drag(450, 140, 550, 240);
    expect(pos(b)).toEqual({ x: 500, y: 200 });
    // the only history is setLocked + b's move: undo twice and the tape is gone, a never moved
    expect(ce.docs.undo()).toBe(true);
    step();
    expect(pos(b)).toEqual({ x: 400, y: 100 });
    expect(ce.docs.undo()).toBe(true);
    step();
    expect(ce.world.hasTag(a, Locked)).toBe(false);
    expect(pos(a)).toEqual({ x: 100, y: 100 });
    expect(ce.docs.undo()).toBe(false);
    ce.dispose();
  });

  it("is pickable at rest: the pointer over it touches it", () => {
    const { ce, step, mouse, spawn, exact } = rig();
    const a = spawn(100, 100);
    step(3);
    ce.ops.setLocked([a], true);
    mouse("move", 150, 140, 0);
    step();
    expect(exact()).toBe(a);
    ce.dispose();
  });

  it("rides a selection without moving: the untaped members move, the taped one stays", () => {
    const { ce, step, drag, spawn, pos } = rig();
    const a = spawn(100, 100);
    const b = spawn(400, 100);
    step(3);
    ce.ops.setLocked([a], true);
    ce.ops.setSelection([a, b]);
    step();
    drag(450, 140, 500, 190); // grab b, the selection rides
    expect(pos(b)).toEqual({ x: 450, y: 150 });
    expect(pos(a)).toEqual({ x: 100, y: 100 });
    ce.dispose();
  });

  it("a handle drag resizes nothing taped; the same drag untaped resizes (control)", () => {
    const { ce, step, drag, spawn } = rig();
    const a = spawn(100, 100);
    step(3);
    const seHandle = (): { x: number; y: number } => {
      let at: { x: number; y: number } | undefined;
      ce.world.query(handleQ).each((b) => {
        for (const r of b) {
          const h = b.entity(r);
          if (ce.world.read(h, HandleSpec).anchor !== "se") continue;
          const p = ce.world.read(h, Position);
          const s = ce.world.read(h, Size);
          at = { x: p.x + s.w / 2, y: p.y + s.h / 2 };
        }
      });
      if (at === undefined) throw new Error("no se handle");
      return at;
    };
    ce.ops.setLocked([a], true);
    ce.ops.setSelection([a]);
    step(2);
    const h = seHandle();
    drag(h.x, h.y, h.x + 60, h.y + 40);
    expect(ce.world.get(a, Size)).toEqual({ w: 120, h: 90 });
    expect(ce.world.get(a, Position)).toEqual({ x: 100, y: 100 });

    ce.ops.setLocked([a], false);
    ce.ops.setSelection([a]);
    step(2);
    const h2 = seHandle();
    drag(h2.x, h2.y, h2.x + 60, h2.y + 40);
    expect(ce.world.get(a, Size)).toEqual({ w: 180, h: 130 });
    ce.dispose();
  });

  it("the marquee passes over it (Q-g) — in the preview and in the commit; untaped, it is gathered (control)", () => {
    const { ce, step, mouse, drag, spawn } = rig();
    const a = spawn(100, 100);
    const b = spawn(300, 100);
    step(3);
    ce.ops.setLocked([a], true);
    // mid-marquee: the preview's hits
    mouse("move", 50, 50, 0);
    step();
    mouse("down", 50, 50, 1);
    step();
    mouse("move", 62, 50, 1); // out of the dead zone: the marquee's corner is here
    step();
    mouse("move", 600, 300, 1);
    step();
    expect(ce.stack.marqueeBuffer.hits).toEqual([b]);
    mouse("up", 600, 300, 0);
    step(3);
    expect(ce.world.hasTag(a, Selected)).toBe(false);
    expect(ce.world.hasTag(b, Selected)).toBe(true);

    ce.ops.setLocked([a], false);
    ce.ops.clearSelection();
    drag(50, 50, 600, 300);
    expect(ce.world.hasTag(a, Selected)).toBe(true);
    expect(ce.world.hasTag(b, Selected)).toBe(true);
    ce.dispose();
  });
});
