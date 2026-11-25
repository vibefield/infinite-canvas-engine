// @vitest-environment node
// `ops.lookAt` (petition I58 — VibeField's Godview: a sticker clicked takes the person to the object, centred and selected).
// In the frame it is an ORDINARY camera move: the look flight (systems/look-flight.ts, a resource and a tick system beside
// `navFlight`) flies from the camera where it is to the look camera (kernel `lookCamera`) on the nav flight's spring and path,
// holds its first tick, lands exactly, and yields to a gesture, to any other camera write and to a nav switch; `"none"` and
// reduced motion snap. In another frame it is the nav ops: out to the frame the object's chain shares with the nav stack, then
// in, every step a cut but the last, which flies (or snaps) and LANDS on the look camera (`NavOpts.landing`); the selection is
// made after the cuts. The hand lets go as at a nav cut, live gestures cancel, inertia stops; nothing is a document write.
import { lookCamera, worldToScreen, type CameraState } from "@ice/kernel";
import { describe, expect, it } from "vitest";
import {
  Active,
  CAMERA_DEFAULTS,
  Camera,
  CameraInertia,
  CameraLimits,
  CancelRequest,
  ChildOf,
  Container,
  FIT_DEFAULTS,
  Held,
  HeldView,
  NavTransition,
  NO_MODS,
  Position,
  PrefabId,
  Retained,
  Selected,
  Size,
  Viewport,
  createCanvasEngine,
  currentNavFrame,
  defineQuery,
  defineWidget,
  interactionPending,
  selectedEntities,
  widgets,
  type CanvasEngine,
  type Entity,
} from "../src";
import { LookFlight } from "../src/systems/look-flight";

// One widget type per FILE (global registry; no test reset).
const BOX =
  widgets.get("look:box") ??
  defineWidget({ type: "look:box", defaultSize: { w: 100, h: 100 }, provides: ["widget"] });
const FOLDER =
  widgets.get("look:folder") ??
  defineWidget({ type: "look:folder", defaultSize: { w: 200, h: 200 }, container: { accepts: ["widget"], provides: ["widget"] } });
const BOOK =
  widgets.get("look:book") ??
  defineWidget({ type: "look:book", object: { name: "book" }, openable: true, defaultSize: { w: 200, h: 140 }, provides: ["widget"] });

const VP = { w: 800, h: 600, dpr: 1 };
const retainedQ = defineQuery([Retained]);
const placedQ = defineQuery([Position, PrefabId]);

/**
 * The board: at the root a box `r1` (100, 100, 100 × 100), the book (-300, 300, 200 × 140) and two folders, `A` (300, 200) and
 * `B` (-500, 0), 200 × 200. In A: a box `a1` (10, 10, 50 × 50) and a folder `A2` (100, 100, 80 × 80) holding a box `a2`
 * (5, 5, 40 × 40). In B: a box `b1` (20, 20, 50 × 50). Every spawn outside history (`undoable: false`).
 */
function board(ce: CanvasEngine, step: (n?: number) => void) {
  const spawn = (type: string, x: number, y: number, w: number, h: number, parent?: Entity): Entity =>
    ce.ops.spawnWidget(type, { x, y, w, h, undoable: false, ...(parent !== undefined ? { parent } : {}) });
  const r1 = spawn("look:box", 100, 100, 100, 100);
  const book = spawn("look:book", -300, 300, 200, 140);
  const A = spawn("look:folder", 300, 200, 200, 200);
  const B = spawn("look:folder", -500, 0, 200, 200);
  ce.world.sync();
  step(2); // a container compiles on a tick before it takes children
  const a1 = spawn("look:box", 10, 10, 50, 50, A);
  const A2 = spawn("look:folder", 100, 100, 80, 80, A);
  const b1 = spawn("look:box", 20, 20, 50, 50, B);
  ce.world.sync();
  step(2);
  const a2 = spawn("look:box", 5, 5, 40, 40, A2);
  ce.world.sync();
  step(5);
  return { r1, book, A, B, a1, A2, b1, a2 };
}

function rig() {
  const ce = createCanvasEngine({ widgets: [BOX, FOLDER, BOOK] });
  ce.engine.registerReflector({ name: "armed", observe: { resources: [Camera] }, flush: () => {} });
  ce.docs.create();
  ce.world.setResource(Viewport, VP);
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  let now = 1000;
  const step = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      now += 16;
      ce.step(now);
    }
  };
  const e = board(ce, step);
  const world = ce.world;
  const cam = (): CameraState => {
    const c = world.getResource(Camera);
    if (c === undefined) throw new Error("no camera");
    return { x: c.x, y: c.y, zoom: c.zoom };
  };
  const look = () => world.getResource(LookFlight);
  const nav = () => world.getResource(NavTransition);
  /** Steps until neither flight drives the camera; returns how many it took. */
  const settle = (): number => {
    let n = 0;
    while ((look()?.active === true || nav()?.active === true) && n < 600) {
      step();
      n += 1;
    }
    return n;
  };
  /** The look camera of an entity's rect, from `from`, as `ops.lookAt` computes it (defaults: comfort, FIT_DEFAULTS, the limits). */
  const lookOf = (entity: Entity, from: number, zoom: "comfort" | "fit" | "keep" | number = "comfort"): CameraState => {
    const p = world.get(entity, Position);
    const s = world.get(entity, Size);
    if (p === undefined || s === undefined) throw new Error("no rect");
    const limits = world.getResource(CameraLimits) ?? CAMERA_DEFAULTS;
    return lookCamera({ x: p.x, y: p.y, width: s.w, height: s.h }, from, VP.w, VP.h, { zoom, pad: FIT_DEFAULTS.pad, band: FIT_DEFAULTS, limits });
  };
  const selection = (): Entity[] => selectedEntities(world);
  const wheel = (dx: number, dy: number): void => {
    ce.stack.queue.enqueue({ kind: "wheel", pointerId: "mouse", device: "mouse", screenX: 400, screenY: 300, buttons: 0, mods: NO_MODS, wheel: { dx, dy, pinch: 0 } });
  };
  return { ce, world, step, cam, look, nav, settle, lookOf, selection, wheel, ...e };
}

describe("ops.lookAt — in the frame", () => {
  it("centres the object at a zoom it can be read at (comfort keeps it), and the selection becomes exactly it", () => {
    const r = rig();
    r.world.setResource(Camera, { x: 0, y: 0, zoom: 0.8, gesturing: false });
    r.ce.ops.setSelection([r.book]);
    expect(r.ce.ops.lookAt(r.r1, { transition: "none" })).toBe(true);
    expect(r.cam()).toEqual({ x: 150 - 400 / 0.8, y: 150 - 300 / 0.8, zoom: 0.8 });
    const c = worldToScreen(150, 150, r.cam());
    expect(c.x).toBeCloseTo(400, 9);
    expect(c.y).toBeCloseTo(300, 9);
    expect(r.selection()).toEqual([r.r1]);
    r.ce.dispose();
  });

  it("select: false leaves the selection as it was", () => {
    const r = rig();
    r.ce.ops.setSelection([r.book]);
    expect(r.ce.ops.lookAt(r.r1, { transition: "none", select: false })).toBe(true);
    expect(r.cam()).toEqual({ x: 150 - 400, y: 150 - 300, zoom: 1 });
    expect(r.selection()).toEqual([r.book]);
    r.ce.dispose();
  });

  it('transition "none" snaps: the camera is there before any step, and no flight is armed', () => {
    const r = rig();
    const c1 = r.lookOf(r.book, 1);
    r.ce.ops.lookAt(r.book, { transition: "none" });
    expect(r.cam()).toEqual(c1);
    expect(r.look()?.active ?? false).toBe(false);
    r.step(3);
    expect(r.cam()).toEqual(c1);
    r.ce.dispose();
  });

  it("flies: holds its first tick, moves as an ordinary camera move (no portal, no frame switch), keeps the loop awake, lands EXACTLY", () => {
    const r = rig();
    const c0 = r.cam();
    const c1 = r.lookOf(r.book, 1);
    expect(c1).toEqual({ x: -200 - 400, y: 370 - 300, zoom: 1 });
    const navEpoch = r.nav()?.epoch ?? 0;
    expect(r.ce.ops.lookAt(r.book)).toBe(true);
    expect(r.look()).toMatchObject({ active: true, p: 0, ticks: 0, c0x: c0.x, c0y: c0.y, c0z: c0.zoom, c1x: c1.x, c1y: c1.y, c1z: c1.zoom });
    expect(r.cam()).toEqual(c0); // the op arms; the tick moves
    expect(interactionPending(r.world, r.ce.stack.queue)).toBe("look");
    r.step();
    expect(r.look()).toMatchObject({ active: true, p: 0, ticks: 1 });
    expect(r.cam()).toEqual(c0); // the first tick holds
    r.step();
    expect(r.look()?.p ?? 0).toBeGreaterThan(0);
    expect(r.cam()).not.toEqual(c0);
    expect(r.world.getResource(Camera)?.gesturing).toBe(false);
    // an ordinary camera move: the nav never heard of it, nothing is retained, the frame is the root
    expect(r.nav()?.epoch ?? 0).toBe(navEpoch);
    expect(r.nav()?.active ?? false).toBe(false);
    expect(r.world.firstOf(retainedQ)).toBeUndefined();
    expect(currentNavFrame(r.world)).toBeUndefined();
    expect(r.settle()).toBeLessThan(120);
    expect(r.cam()).toEqual(c1);
    expect(r.look()).toMatchObject({ active: false, p: 1 });
    expect(interactionPending(r.world, r.ce.stack.queue)).toBeUndefined();
    expect(r.selection()).toEqual([r.book]);
    r.ce.dispose();
  });

  it("a camera gesture mid-way stops it without touching the camera — and it stays stopped", () => {
    const r = rig();
    const c1 = r.lookOf(r.book, 1);
    r.ce.ops.lookAt(r.book);
    r.step(5);
    const mid = r.cam();
    expect(mid).not.toEqual(c1);
    r.wheel(40, 0); // a plain wheel pans (the default mode): the gesture goes Active this tick
    r.step();
    expect(r.look()?.active).toBe(false);
    expect(r.cam()).toEqual({ x: mid.x + 40 / mid.zoom, y: mid.y, zoom: mid.zoom }); // the pan's, from where the flight was
    const after = r.cam();
    r.step(40);
    expect(r.look()?.active).toBe(false);
    expect(r.cam()).toEqual(after);
    r.ce.dispose();
  });

  it("any other camera write stops it too (an op's)", () => {
    const r = rig();
    r.ce.ops.lookAt(r.book);
    r.step(4);
    const z = r.cam().zoom;
    r.ce.ops.panTo(5, 6);
    r.step();
    expect(r.look()?.active).toBe(false);
    expect(r.cam()).toEqual({ x: 5, y: 6, zoom: z });
    r.ce.dispose();
  });

  it("a new lookAt mid-flight retargets from the camera where it is", () => {
    const r = rig();
    r.ce.ops.lookAt(r.book);
    r.step(6);
    const mid = r.cam();
    const epoch = r.look()?.epoch ?? 0;
    const c1 = r.lookOf(r.r1, 1);
    expect(r.ce.ops.lookAt(r.r1)).toBe(true);
    expect(r.look()).toMatchObject({ active: true, p: 0, ticks: 0, epoch: epoch + 1, c0x: mid.x, c0y: mid.y, c0z: mid.zoom, c1x: c1.x, c1y: c1.y, c1z: c1.zoom });
    r.settle();
    expect(r.cam()).toEqual(c1);
    expect(r.selection()).toEqual([r.r1]);
    r.ce.dispose();
  });

  it("reduced motion snaps, as nav flights do — in the frame and into another", () => {
    const r = rig();
    r.ce.transitions.setReducedMotion(true);
    const c1 = r.lookOf(r.book, 1);
    r.ce.ops.lookAt(r.book);
    expect(r.cam()).toEqual(c1);
    expect(r.look()?.active ?? false).toBe(false);
    const into = r.lookOf(r.a1, 1);
    r.ce.ops.lookAt(r.a1);
    expect(currentNavFrame(r.world)).toBe(r.A);
    expect(r.nav()?.active).toBe(false);
    expect(r.cam()).toEqual(into);
    r.ce.dispose();
  });

  it("stops the pan's inertia and cancels live gestures at the call", () => {
    const r = rig();
    r.world.setResource(CameraInertia, { vx: 4000, vy: 0 });
    r.ce.ops.lookAt(r.book, { transition: "none" });
    expect(r.world.getResource(CameraInertia)).toEqual({ vx: 0, vy: 0 });
    expect(r.world.getResource(CancelRequest)?.active).toBe(true);
    r.ce.dispose();
  });

  it("takes over from a nav flight in progress (its frame is the one the object is in)", () => {
    const r = rig();
    r.ce.ops.enterContainer(r.A);
    r.step(3);
    expect(r.nav()?.active).toBe(true);
    const c1 = r.lookOf(r.a1, r.nav()?.c1z ?? Number.NaN); // the zoom it was landing at
    expect(r.ce.ops.lookAt(r.a1)).toBe(true);
    expect(r.nav()?.active).toBe(false);
    expect(r.look()?.active).toBe(true);
    r.settle();
    expect(r.cam()).toEqual(c1);
    expect(currentNavFrame(r.world)).toBe(r.A);
    expect(r.selection()).toEqual([r.a1]);
    r.ce.dispose();
  });

  it("a nav transition starting ends it; the nav flight drives from there", () => {
    const r = rig();
    r.ce.ops.lookAt(r.book);
    r.step(3);
    r.ce.ops.enterContainer(r.A);
    r.step();
    expect(r.look()?.active).toBe(false);
    expect(r.nav()?.active).toBe(true);
    const landing = r.nav();
    r.settle();
    expect(r.cam()).toEqual({ x: landing?.c1x, y: landing?.c1y, zoom: landing?.c1z });
    r.ce.dispose();
  });
});

describe("ops.lookAt — false, and nothing changes", () => {
  it("for a dead entity, for one that is no object of the scene, and while there is no real viewport", () => {
    const r = rig();
    r.ce.ops.setSelection([r.book]);
    r.step(2);
    const before = { cam: r.world.getResource(Camera), selection: r.selection(), cancel: r.world.getResource(CancelRequest)?.active ?? false };
    expect(before.cancel).toBe(false);
    const gone = r.world.spawn({ components: [[Position, { x: 0, y: 0 }], [Size, { w: 10, h: 10 }]] });
    r.world.destroy(gone);
    expect(r.ce.ops.lookAt(gone)).toBe(false);
    const raw = r.world.spawn({ components: [[Position, { x: 0, y: 0 }], [Size, { w: 10, h: 10 }]] }); // alive, but no object of the scene
    expect(r.ce.ops.lookAt(raw)).toBe(false);
    r.world.setResource(Viewport, { w: 0, h: 600, dpr: 1 });
    expect(r.ce.ops.lookAt(r.r1)).toBe(false);
    r.world.setResource(Viewport, { w: 800, h: 0, dpr: 1 });
    expect(r.ce.ops.lookAt(r.a1)).toBe(false);
    expect(r.world.getResource(Camera)).toEqual(before.cam);
    expect(r.selection()).toEqual(before.selection);
    expect(r.world.getResource(CancelRequest)?.active ?? false).toBe(false);
    expect(r.look()?.active ?? false).toBe(false);
    expect(r.ce.nav.depth()).toBe(0);
    r.ce.dispose();
  });

  it("throws on an option that is no option", () => {
    const r = rig();
    expect(() => r.ce.ops.lookAt(r.r1, { zoom: 0 })).toThrow(/ops\.lookAt/);
    expect(() => r.ce.ops.lookAt(r.r1, { zoom: Number.NaN })).toThrow(/ops\.lookAt/);
    expect(() => r.ce.ops.lookAt(r.r1, { zoom: "far" as never })).toThrow(/ops\.lookAt/);
    expect(() => r.ce.ops.lookAt(r.r1, { pad: -1 })).toThrow(/ops\.lookAt/);
    expect(() => r.ce.ops.lookAt(r.r1, { inset: { left: Number.POSITIVE_INFINITY } })).toThrow(/ops\.lookAt/);
    expect(() => r.ce.ops.lookAt(r.r1, { transition: "warp" as never })).toThrow(/ops\.lookAt/);
    expect(r.cam()).toEqual({ x: 0, y: 0, zoom: 1 });
    r.ce.dispose();
  });
});

describe("ops.lookAt — another frame, through the nav ops", () => {
  it("an object in a child container: entered (cut-first), selected after the cut, framed EXACTLY at the landing", () => {
    const r = rig();
    const c1 = r.lookOf(r.a1, 1);
    expect(c1).toEqual({ x: 35 - 400, y: 35 - 300, zoom: 1 });
    expect(r.ce.ops.lookAt(r.a1)).toBe(true);
    expect(r.ce.nav.depth()).toBe(1);
    expect(currentNavFrame(r.world)).toBe(r.A);
    expect(r.nav()).toMatchObject({ active: true, kind: "enter", toFrame: r.A, c1x: c1.x, c1y: c1.y, c1z: c1.zoom });
    expect(r.selection()).toEqual([r.a1]);
    expect(r.world.hasTag(r.a1, Active)).toBe(true);
    r.settle();
    expect(r.cam()).toEqual(c1);
    expect(r.selection()).toEqual([r.a1]);
    expect(r.world.hasTag(r.a1, Selected)).toBe(true);
    r.ce.dispose();
  });

  it("two containers down: the first enter cuts, the last flies; the way back is the nav stack's", () => {
    const r = rig();
    const c1 = r.lookOf(r.a2, 1);
    expect(r.ce.ops.lookAt(r.a2)).toBe(true);
    expect(r.ce.nav.depth()).toBe(2);
    expect(currentNavFrame(r.world)).toBe(r.A2);
    expect(r.nav()).toMatchObject({ active: true, kind: "enter", fromFrame: r.A, toFrame: r.A2 });
    r.settle();
    expect(r.cam()).toEqual(c1);
    expect(r.selection()).toEqual([r.a2]);
    // the A2 entry saved the camera A was cut to (its arrival), the A entry the root camera the person had
    r.ce.ops.exitContainer({ transition: "none" });
    expect(currentNavFrame(r.world)).toBe(r.A);
    r.ce.ops.exitContainer({ transition: "none" });
    expect(r.ce.nav.depth()).toBe(0);
    expect(r.cam()).toEqual({ x: 0, y: 0, zoom: 1 });
    r.ce.dispose();
  });

  it("a sibling branch: out to the frame the two share (a cut), then in (the flight), framed and selected", () => {
    const r = rig();
    r.ce.ops.enterContainer(r.B, { transition: "none" });
    r.step(3);
    expect(currentNavFrame(r.world)).toBe(r.B);
    const c1 = r.lookOf(r.a1, r.cam().zoom);
    expect(r.ce.ops.lookAt(r.a1)).toBe(true);
    expect(r.ce.nav.depth()).toBe(1);
    expect(currentNavFrame(r.world)).toBe(r.A);
    expect(r.nav()).toMatchObject({ active: true, kind: "enter", toFrame: r.A });
    r.settle();
    expect(r.cam()).toEqual(c1);
    expect(r.selection()).toEqual([r.a1]);
    r.ce.ops.exitContainer({ transition: "none" });
    expect(r.cam()).toEqual({ x: 0, y: 0, zoom: 1 }); // the root camera from before B was entered
    r.ce.dispose();
  });

  it("an object in an ancestor frame: the exit is the step that flies, and it lands on the look camera", () => {
    const r = rig();
    r.ce.ops.enterContainer(r.A, { transition: "none" });
    r.step(3);
    const c1 = r.lookOf(r.r1, r.cam().zoom);
    expect(r.ce.ops.lookAt(r.r1)).toBe(true);
    expect(r.ce.nav.depth()).toBe(0);
    expect(r.nav()).toMatchObject({ active: true, kind: "exit", c1x: c1.x, c1y: c1.y, c1z: c1.zoom });
    r.settle();
    expect(r.cam()).toEqual(c1);
    expect(r.selection()).toEqual([r.r1]);
    // the frame's own container is an object of the frame above it
    r.ce.ops.enterContainer(r.A, { transition: "none" });
    r.step(3);
    const atA = r.lookOf(r.A, r.cam().zoom);
    r.ce.ops.lookAt(r.A, { transition: "none" });
    expect(r.ce.nav.depth()).toBe(0);
    expect(r.cam()).toEqual(atA);
    expect(r.selection()).toEqual([r.A]);
    r.ce.dispose();
  });

  it("back-to-back cuts in one call leave a consistent world: out of B, into A, into A2, at the look camera, a2 selected", () => {
    const r = rig();
    r.ce.ops.enterContainer(r.B, { transition: "none" });
    r.step(3);
    const c1 = r.lookOf(r.a2, r.cam().zoom);
    expect(r.ce.ops.lookAt(r.a2, { transition: "none" })).toBe(true);
    // at once, before a step
    expect(r.ce.nav.depth()).toBe(2);
    expect(currentNavFrame(r.world)).toBe(r.A2);
    expect(r.ce.canvas.current()).toMatchObject({ state: "attached", frame: r.A2, depth: 2 });
    expect(r.cam()).toEqual(c1);
    expect(r.nav()?.active).toBe(false);
    expect(r.world.firstOf(retainedQ)).toBeUndefined();
    expect(r.selection()).toEqual([r.a2]);
    expect(r.world.hasTag(r.a2, Active)).toBe(true);
    // and after the membership pass: a2 is the frame's, nothing else is, the selection held
    r.step(3);
    expect(r.world.hasTag(r.a2, Active)).toBe(true);
    for (const e of [r.r1, r.book, r.A, r.B, r.a1, r.A2, r.b1]) expect(r.world.hasTag(e, Active)).toBe(false);
    expect(r.selection()).toEqual([r.a2]);
    expect(r.cam()).toEqual(c1);
    r.ce.ops.exitTo(0, { transition: "none" });
    expect(r.cam()).toEqual({ x: 0, y: 0, zoom: 1 }); // home: the camera the person had before B
    r.ce.dispose();
  });

  it("goes only where the nav enters: under a Container-tagged entity no type compiles, false, and nothing changes", () => {
    const r = rig();
    // a box hung under a raw Container-tagged entity inside A (the tray's shape): membership anchors it there, the nav cannot go
    const stray = r.world.spawn({ components: [[Position, { x: 0, y: 0 }], [Size, { w: 10, h: 10 }]], tags: [Container] });
    r.world.setRelation(stray, ChildOf, r.A);
    const inner = r.world.spawn({ components: [[Position, { x: 2, y: 2 }], [Size, { w: 5, h: 5 }], [PrefabId, { id: "look:box" }]] });
    r.world.setRelation(inner, ChildOf, stray);
    r.step(2);
    expect(r.world.hasTag(inner, Active)).toBe(false);
    const before = r.cam();
    expect(r.ce.ops.lookAt(inner)).toBe(false);
    expect(r.cam()).toEqual(before);
    expect(r.ce.nav.depth()).toBe(0);
    expect(r.world.getResource(CancelRequest)?.active ?? false).toBe(false);
    r.ce.dispose();
  });
});

describe("ops.lookAt — the hand, and the document", () => {
  it("the hand lets go as it does at a nav cut; the object in hand itself is put down and framed", () => {
    const r = rig();
    r.ce.ops.open(r.book);
    expect(r.world.hasTag(r.book, Held)).toBe(true);
    r.ce.ops.lookAt(r.r1, { transition: "none" });
    expect(r.world.hasTag(r.book, Held)).toBe(false);
    expect(r.world.has(r.book, HeldView)).toBe(false);
    expect(r.selection()).toEqual([r.r1]);
    r.step(3);
    r.ce.ops.open(r.book);
    r.ce.ops.lookAt(r.book, { transition: "none" });
    expect(r.world.hasTag(r.book, Held)).toBe(false);
    expect(r.cam()).toEqual(r.lookOf(r.book, 1));
    expect(r.selection()).toEqual([r.book]);
    // select: false — put down, and it stays selected as a put-down leaves it
    r.step(3);
    r.ce.ops.open(r.book);
    r.ce.ops.lookAt(r.r1, { transition: "none", select: false });
    expect(r.world.hasTag(r.book, Held)).toBe(false);
    expect(r.selection()).toEqual([r.book]);
    // into another frame: the nav op's own put-down
    r.step(3);
    r.ce.ops.open(r.book);
    r.ce.ops.lookAt(r.a1, { transition: "none" });
    expect(r.world.hasTag(r.book, Held)).toBe(false);
    expect(currentNavFrame(r.world)).toBe(r.A);
    expect(r.selection()).toEqual([r.a1]);
    r.ce.dispose();
  });

  it("writes the runtime alone: no transaction, no undo step — and a read-only document looks as well", () => {
    const r = rig();
    const store = r.ce.docs.current()?.store;
    expect(store?.canUndo()).toBe(false);
    r.ce.ops.lookAt(r.book);
    r.settle();
    r.ce.ops.lookAt(r.a2);
    r.settle();
    r.ce.ops.lookAt(r.b1, { transition: "none" });
    expect(store?.canUndo()).toBe(false);
    const bytes = r.ce.docs.current()?.exportEnvelope();
    r.ce.dispose();
    if (bytes === undefined) throw new Error("no envelope");

    const ce = createCanvasEngine({ widgets: [BOX, FOLDER, BOOK] });
    const opened = ce.docs.open(bytes, { onGate: () => "readOnly" });
    if (!opened.ok) throw new Error(`open failed: ${opened.reason}`);
    expect(opened.session.readOnly).toBe(true);
    ce.world.setResource(Viewport, VP);
    let now = 1000;
    const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
    step(5);
    const at = (x: number, y: number): Entity => {
      let found: Entity | undefined;
      ce.world.query(placedQ).each((b) => { for (const row of b) { const e = b.entity(row); const p = ce.world.get(e, Position); if (p?.x === x && p.y === y) found = e; } });
      if (found === undefined) throw new Error(`nothing at ${x}, ${y}`);
      return found;
    };
    const a1 = at(10, 10);
    const A = at(300, 200);
    expect(ce.ops.lookAt(a1, { transition: "none" })).toBe(true);
    expect(currentNavFrame(ce.world)).toBe(A);
    expect(selectedEntities(ce.world)).toEqual([a1]);
    const r1 = at(100, 100);
    expect(ce.ops.lookAt(r1)).toBe(true);
    expect(currentNavFrame(ce.world)).toBeUndefined();
    let n = 0;
    while ((ce.world.getResource(NavTransition)?.active === true || ce.world.getResource(LookFlight)?.active === true) && n < 600) { step(); n += 1; }
    const c = ce.world.getResource(Camera);
    expect(worldToScreen(150, 150, { x: c?.x ?? 0, y: c?.y ?? 0, zoom: c?.zoom ?? 1 }).x).toBeCloseTo(400, 6);
    expect(opened.session.store.canUndo()).toBe(false);
    ce.dispose();
  });
});

describe("NavOpts.landing — where an enter or an exit comes to rest", () => {
  it("moves only the rest: the cut is the container's own, the flight lands on it exactly — an enter's and an exit's", () => {
    const plain = rig();
    plain.ce.ops.enterContainer(plain.A);
    const t0 = plain.nav();
    plain.ce.dispose();

    const r = rig();
    const landing = { x: -123, y: -45, zoom: 1.5 };
    r.ce.ops.enterContainer(r.A, { landing });
    const t = r.nav();
    expect(t).toMatchObject({ active: true, kind: "enter", c0x: t0?.c0x, c0y: t0?.c0y, c0z: t0?.c0z, as: t0?.as, aox: t0?.aox, aoy: t0?.aoy });
    expect(t).toMatchObject({ c1x: -123, c1y: -45, c1z: 1.5 });
    r.settle();
    expect(r.cam()).toEqual(landing);
    const home = { x: 77, y: 88, zoom: 0.75 };
    r.ce.ops.exitContainer({ landing: home });
    expect(r.nav()).toMatchObject({ active: true, kind: "exit", c1x: 77, c1y: 88, c1z: 0.75 });
    r.settle();
    expect(r.cam()).toEqual(home);
    // "none" snaps to it
    r.ce.ops.enterContainer(r.A, { transition: "none", landing });
    expect(r.cam()).toEqual(landing);
    r.ce.dispose();
  });
});
