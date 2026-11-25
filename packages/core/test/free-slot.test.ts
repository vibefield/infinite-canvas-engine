// @vitest-environment node
/**
 * resolveFreeSlot (petition I57) — where an object that comes with no pointer lands: the world's reader over the
 * kernel's `freeSlot`. Through the REAL facade (createCanvasEngine, a document, the ops): the board and a mat's
 * inside are each a frame with its own incumbents and units; the view is what the camera shows, at any zoom; what
 * counts as occupied (every object of the frame — taped ones too; a mat as one rectangle; a glide where it is and
 * where it lands; a drag where it is; never landscape); the nothing-free answer; and that it is a READ — asked out
 * of the tick, under a frozen frame gate, it sees a spawn as soon as the world has synced it.
 */
import { describe, expect, it } from "vitest";
import type { LayoutRect } from "@ice/kernel";
import {
  BoardRoot,
  Camera,
  FREE_SLOT_DEFAULTS,
  Locked,
  NO_MODS,
  Position,
  Size,
  TransformTween,
  Viewport,
  createCanvasEngine,
  defineWidget,
  guardedTransaction,
  resolveFreeSlot,
  widgets,
  type Entity,
} from "../src";

// One widget type per FILE (global registry; no test reset).
const PANE = widgets.get("fs:pane") ?? defineWidget({ type: "fs:pane", defaultSize: { w: 200, h: 100 }, provides: ["widget"] });
const MAT = widgets.get("fs:mat") ?? defineWidget({ type: "fs:mat", defaultSize: { w: 300, h: 200 }, container: { accepts: ["widget"] } });
// a comment box: it sweeps what lies inside it, so things are MEANT to lie on it — landscape (l3-drop.ts)
const GROUND = widgets.get("fs:ground") ?? defineWidget({ type: "fs:ground", defaultSize: { w: 600, h: 400 }, interaction: { selectable: true, movable: true, sweepContained: true } });

const VP = { w: 1000, h: 600, dpr: 1 };
/** The newcomer every row places: centred in the 1000 × 600 view at zoom 1 it lies at (400, 250). */
const SIZE = { w: 200, h: 100 };

/** Closer than `gutter` on both axes (the kernel's crowding law). */
function crowds(a: LayoutRect, b: LayoutRect, gutter: number): boolean {
  return a.x < b.x + b.w + gutter && b.x < a.x + a.w + gutter && a.y < b.y + b.h + gutter && b.y < a.y + a.h + gutter;
}

function rig() {
  const ce = createCanvasEngine({ widgets: [PANE, MAT, GROUND] });
  ce.docs.create();
  ce.world.setResource(Viewport, VP);
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false }); // screen == world
  let now = 1000;
  const step = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      now += 16;
      ce.step(now);
    }
  };
  /** An object made by the engine's own op and synced into the world (a transaction's spawn lands at the next sync). */
  const put = (type: string, x: number, y: number, extra: { w?: number; h?: number; parent?: Entity } = {}): Entity => {
    const e = ce.ops.spawnWidget(type, { x, y, undoable: false, ...extra });
    ce.world.sync();
    return e;
  };
  const rectOf = (e: Entity): LayoutRect => {
    const p = ce.world.read(e, Position);
    const s = ce.world.read(e, Size);
    return { x: p.x, y: p.y, w: s.w, h: s.h };
  };
  const board = ce.world.getResource(BoardRoot)?.root;
  if (board === undefined) throw new Error("no board root");
  step(2);
  return { ce, world: ce.world, step, put, rectOf, board };
}

describe("resolveFreeSlot — the board", () => {
  it("an empty board → the newcomer centred in the view, on the board", () => {
    const r = rig();
    expect(resolveFreeSlot(r.world, SIZE)).toEqual({ x: 400, y: 250, where: "anchor", frame: r.board });
    r.ce.dispose();
  });

  it("one object where the person is looking → beside it, the default gutter kept", () => {
    const r = rig();
    const mine = r.put("fs:pane", 400, 250);
    const slot = resolveFreeSlot(r.world, SIZE);
    expect(slot).toEqual({ x: 400, y: 374, where: "view", frame: r.board });
    expect(FREE_SLOT_DEFAULTS.gutter).toBe(24);
    expect((slot?.y ?? 0) - (r.rectOf(mine).y + r.rectOf(mine).h)).toBe(FREE_SLOT_DEFAULTS.gutter);
    r.ce.dispose();
  });

  it("under a frozen frame gate (a host covering the desk): each object placed is seen by the next ask, once the world has synced it", () => {
    const r = rig();
    const mine = r.put("fs:pane", 400, 250); // the person's own, at the view's middle
    r.step(3);
    const thaw = r.ce.frame.freeze("another view covers the desk");
    const placed: Entity[] = [mine];
    const wheres: string[] = [];
    for (let n = 0; n < 4; n++) {
      const slot = resolveFreeSlot(r.world, SIZE);
      if (slot === undefined) throw new Error("a slot was expected");
      wheres.push(`${slot.x},${slot.y},${slot.where}`);
      // the op a host places with, then the frame's first step alone (no tick runs under the freeze)
      placed.push(r.ce.ops.spawnWidget("fs:pane", { x: slot.x, y: slot.y, parent: slot.frame, undoable: false }));
      r.world.sync();
    }
    expect(wheres).toEqual(["400,374,view", "400,126,view", "624,250,view", "176,250,view"]);
    const rects = placed.map(r.rectOf);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) expect(crowds(rects[i] as LayoutRect, rects[j] as LayoutRect, 24)).toBe(false);
    }
    thaw();
    r.ce.dispose();
  });

  it("a host's own gutter, anchor, view and avoided rectangles", () => {
    const r = rig();
    r.put("fs:pane", 400, 250);
    expect(resolveFreeSlot(r.world, SIZE, { gutter: 8 })).toMatchObject({ x: 400, y: 358 });
    // an anchor of its own: free there, and wholly in view
    expect(resolveFreeSlot(r.world, SIZE, { anchor: { x: 200, y: 100 } })).toMatchObject({ x: 100, y: 50, where: "anchor" });
    // a view of its own (the part its chrome leaves clear): the middle of THAT is the default anchor
    expect(resolveFreeSlot(r.world, SIZE, { view: { x: 0, y: 0, w: 400, h: 200 } })).toMatchObject({ x: 100, y: 50, where: "anchor" });
    // no view at all: the view's preference is off, and nothing says "view"
    expect(resolveFreeSlot(r.world, SIZE, { view: null, anchor: { x: 500, y: 300 } })).toMatchObject({ x: 400, y: 374, where: "reach" });
    // what the world does not hold: a rectangle the host keeps clear (here, the slot under the pane)
    expect(resolveFreeSlot(r.world, SIZE, { avoid: [{ x: 400, y: 374, w: 200, h: 100 }] })).toMatchObject({ x: 400, y: 126, where: "view" });
    r.ce.dispose();
  });
});

describe("resolveFreeSlot — a zoomed view", () => {
  it("the view is what the camera shows, in the frame's units; the gutter is not scaled by the zoom", () => {
    const r = rig();
    // zoom 2 from (100, 50): 500 × 300 units are on screen, their middle (350, 200)
    r.world.setResource(Camera, { x: 100, y: 50, zoom: 2, gesturing: false });
    expect(resolveFreeSlot(r.world, SIZE)).toMatchObject({ x: 250, y: 150, where: "anchor" });
    r.put("fs:pane", 250, 150);
    // zoomed in, no second 200 × 100 lies wholly in view beside the first: the nearest within the reach, 24 units under it
    expect(resolveFreeSlot(r.world, SIZE)).toMatchObject({ x: 250, y: 274, where: "reach" });
    // zoom 0.5 from (-500, -300): 2000 × 1200 units on screen, their middle (500, 300); the pane at (250, 150) crowds
    // the anchored (400, 250) by its corner, and the slot is 24 units under the pane — the same gap as at zoom 2
    r.world.setResource(Camera, { x: -500, y: -300, zoom: 0.5, gesturing: false });
    expect(resolveFreeSlot(r.world, SIZE)).toMatchObject({ x: 400, y: 274, where: "view" });
    r.ce.dispose();
  });

  it("zoomed in past the newcomer's own size: the anchor still answers, as the nearest within the reach", () => {
    const r = rig();
    r.world.setResource(Camera, { x: 450, y: 275, zoom: 10, gesturing: false }); // 100 × 60 units on screen
    expect(resolveFreeSlot(r.world, SIZE)).toMatchObject({ x: 400, y: 255, where: "anchor" });
    r.ce.dispose();
  });
});

describe("resolveFreeSlot — a mat's inside", () => {
  const scene = () => {
    const r = rig();
    const mat = r.put("fs:mat", 100, 100); // 300 × 200 on the board
    r.step(2); // the container compiles on a tick before it takes children
    const inside = r.put("fs:pane", 700, 20, { parent: mat }); // in the inside's own units
    const onBoard = r.put("fs:pane", 400, 250);
    r.step(3);
    return { ...r, mat, inside, onBoard };
  };

  it("asked of a mat: its own objects alone, in its own units, and no view while the person is outside it", () => {
    const r = scene();
    // centred on the inside's pane → the nearest side of it, under it
    expect(resolveFreeSlot(r.world, SIZE, { frame: r.mat, anchor: { x: 800, y: 70 } })).toEqual({ x: 700, y: 144, where: "reach", frame: r.mat });
    // the board's pane lies at the numbers (400, 250): inside the mat that place is free
    expect(resolveFreeSlot(r.world, SIZE, { frame: r.mat, anchor: { x: 500, y: 300 } })).toEqual({ x: 400, y: 250, where: "anchor", frame: r.mat });
    // no anchor given: the middle of what the mat holds
    expect(resolveFreeSlot(r.world, SIZE, { frame: r.mat })).toEqual({ x: 700, y: 144, where: "reach", frame: r.mat });
    r.ce.dispose();
  });

  it("on the board a mat is one rectangle, and what lies inside it is not on the board", () => {
    const r = scene();
    // the inside's pane lies at the numbers (700, 20): on the board that place is free
    expect(resolveFreeSlot(r.world, SIZE, { anchor: { x: 800, y: 70 } })).toEqual({ x: 700, y: 20, where: "anchor", frame: r.board });
    // centred on the mat: clear of the mat itself by the gutter
    const slot = resolveFreeSlot(r.world, SIZE, { anchor: { x: 250, y: 200 } });
    expect(slot).toBeDefined();
    expect(crowds({ x: slot?.x ?? 0, y: slot?.y ?? 0, ...SIZE }, r.rectOf(r.mat), 24)).toBe(false);
    expect(crowds({ x: slot?.x ?? 0, y: slot?.y ?? 0, ...SIZE }, r.rectOf(r.onBoard), 24)).toBe(false);
    r.ce.dispose();
  });

  it("the person inside the mat: it is the frame on screen, and the view is its camera's", () => {
    const r = scene();
    r.ce.ops.enterContainer(r.mat, { transition: "none" });
    r.step(3);
    r.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    expect(resolveFreeSlot(r.world, SIZE)).toEqual({ x: 400, y: 250, where: "anchor", frame: r.mat });
    // …and the board, asked for by name, is a frame that is not on screen: no view, the middle of what it holds as
    // the anchor ((350, 225): the mat and the pane), and the nearest slot clear of both — flush under the mat, flush left of the pane
    expect(resolveFreeSlot(r.world, SIZE, { frame: r.board })).toEqual({ x: 176, y: 324, where: "reach", frame: r.board });
    r.ce.dispose();
  });
});

describe("resolveFreeSlot — what counts as occupied", () => {
  it("a taped object is in the way; landscape (a type that sweeps what lies inside it) is not", () => {
    const r = rig();
    const ground = r.put("fs:ground", 200, 100); // 600 × 400 around the view's middle
    r.step(3);
    expect(resolveFreeSlot(r.world, SIZE)).toMatchObject({ x: 400, y: 250, where: "anchor" });
    const taped = r.put("fs:pane", 400, 250);
    r.step(3);
    r.ce.ops.setLocked([taped], true);
    r.world.sync();
    expect(r.world.hasTag(taped, Locked)).toBe(true);
    expect(resolveFreeSlot(r.world, SIZE)).toMatchObject({ x: 400, y: 374, where: "view" });
    expect(r.world.isAlive(ground)).toBe(true);
    r.ce.dispose();
  });

  it("a gliding object counts where it is and where it lands", () => {
    const r = rig();
    const mover = r.put("fs:pane", 0, 0);
    r.step(3);
    expect(resolveFreeSlot(r.world, SIZE)).toMatchObject({ where: "anchor" });
    const session = r.ce.docs.current();
    if (session === undefined) throw new Error("session expected");
    // a Clean Up's move: the document is at the target at once, the object glides there
    guardedTransaction(session.store, r.world, (tx) => tx.move(mover, { x: 400, y: 250 }, { animateMs: 240 }), { live: session.liveWriter });
    expect(r.world.get(mover, Position)).toEqual({ x: 0, y: 0 });
    expect(r.world.get(mover, TransformTween)).toMatchObject({ toX: 400, toY: 250 });
    expect(resolveFreeSlot(r.world, SIZE)).toMatchObject({ x: 400, y: 374, where: "view" }); // clear of where it lands
    expect(resolveFreeSlot(r.world, SIZE, { anchor: { x: 100, y: 50 } })).toMatchObject({ x: 0, y: 124 }); // and of where it is
    r.ce.dispose();
  });

  it("an object in the person's hand counts where it is at the moment of the ask", () => {
    const r = rig();
    const pane = r.put("fs:pane", 20, 20);
    r.step(3);
    const mouse = (kind: "down" | "move" | "up", x: number, y: number, buttons: number): void => {
      r.ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: NO_MODS });
      r.step();
    };
    mouse("move", 120, 70, 0);
    mouse("down", 120, 70, 1);
    mouse("move", 132, 70, 1); // out of the dead zone
    for (let i = 1; i <= 4; i++) mouse("move", 132 + 95 * i, 70 + 57 * i, 1); // carried to the view's middle
    const held = r.rectOf(pane);
    expect(held.x).toBeGreaterThan(300); // it moved with the hand (the control: the drag is real)
    const slot = resolveFreeSlot(r.world, SIZE);
    expect(slot).toBeDefined();
    expect(slot?.where).not.toBe("anchor");
    expect(crowds({ x: slot?.x ?? 0, y: slot?.y ?? 0, ...SIZE }, held, 24)).toBe(false);
    mouse("up", 512, 298, 0);
    r.ce.dispose();
  });
});

describe("resolveFreeSlot — the reach, and the answers that are not a slot", () => {
  it("nothing free within the reach → undefined; the default reach is one view, one newcomer and the gutter", () => {
    const r = rig();
    r.put("fs:pane", 400, 250);
    expect(resolveFreeSlot(r.world, SIZE, { reach: 50 })).toBeUndefined();
    expect(resolveFreeSlot(r.world, SIZE, { reach: 124 })).toMatchObject({ x: 400, y: 374 });
    // a slab whose nearest edge is 1,574 from the anchored position: past the default 1000 + 200 + 24
    r.put("fs:pane", -1000, -1200, { w: 3000, h: 3000 });
    expect(resolveFreeSlot(r.world, SIZE)).toBeUndefined();
    expect(resolveFreeSlot(r.world, SIZE, { reach: 2000 })).toMatchObject({ x: 400, y: 1824, where: "reach" });
    r.ce.dispose();
  });

  it("the same world answers the same place, asked twice and built twice", () => {
    const build = () => {
      const r = rig();
      r.put("fs:pane", 400, 250);
      r.put("fs:pane", 330, 380, { w: 420, h: 60 });
      r.put("fs:mat", 650, 120);
      return r;
    };
    const a = build();
    const b = build();
    const first = resolveFreeSlot(a.world, SIZE);
    expect(first).toBeDefined();
    expect(first?.where).toBe("view");
    expect(resolveFreeSlot(a.world, SIZE)).toEqual(first);
    const again = resolveFreeSlot(b.world, SIZE);
    expect({ x: again?.x, y: again?.y, where: again?.where }).toEqual({ x: first?.x, y: first?.y, where: first?.where });
    a.ce.dispose();
    b.ce.dispose();
  });

  it("it refuses what it cannot answer: a size that is not two positive numbers, no frame to place in", () => {
    const r = rig();
    expect(() => resolveFreeSlot(r.world, { w: 0, h: 100 })).toThrow(/size/);
    expect(() => resolveFreeSlot(r.world, { w: 200, h: Number.NaN })).toThrow(/size/);
    expect(() => resolveFreeSlot(r.world, SIZE, { gutter: -1 })).toThrow(/gutter/);
    expect(() => resolveFreeSlot(r.world, SIZE, { reach: Number.POSITIVE_INFINITY })).toThrow(/reach/);
    const gone = r.put("fs:mat", 0, 0);
    r.step(3);
    r.ce.ops.setSelection([gone]);
    r.ce.ops.deleteSelection();
    r.world.sync();
    expect(() => resolveFreeSlot(r.world, SIZE, { frame: gone })).toThrow(/frame/);
    r.ce.dispose();
    // an engine with no document has no board to place on
    const bare = createCanvasEngine({ widgets: [PANE, MAT, GROUND] });
    expect(() => resolveFreeSlot(bare.world, SIZE)).toThrow(/frame/);
    bare.dispose();
  });
});
