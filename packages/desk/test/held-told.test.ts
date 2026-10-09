// @vitest-environment node
// M24 LT2 (design-019 §5 · §13.2 ruling 1): THE HAND'S INPUT, TOLD — what the desk folds from core's held facts (`HeldPointer`,
// `HeldPress`, `HeldWheel`) into a kind's `held` events, one step at a time, through the REAL interaction stack: the adapters' facts
// enqueued, core's held input folding them, the pose seam set as the renderer would set it (a page held centred, 1.5 px a unit, a
// `live` part over its inside and its edge `content`). Every event in the held extent's units; a press the hand takes never told.
import { Camera, createCanvasEngine, defineWidget, type Entity, Held, HeldView, type InputMods, NO_MODS, Viewport, widgets } from "@ice/core";
import { describe, expect, it } from "vitest";
import { createHeldFold } from "../src/hold/told";
import type { HeldEvent } from "../src/kinds/world";

const PAGE =
  widgets.get("told:page") ??
  defineWidget({ type: "told:page", object: { name: "told-page" }, openable: true, heldWheel: "kind", defaultSize: { w: 200, h: 140 } });
const BOOK =
  widgets.get("told:book") ??
  defineWidget({ type: "told:book", object: { name: "told-book" }, openable: true, defaultSize: { w: 200, h: 140 } });
const META: InputMods = { ...NO_MODS, meta: true };

/** The page held at (400, 300), 1.5 CSS px a unit — its extent 200 × 133⅓ units: `live` within |x| ≤ 80, |y| ≤ 50, `content` to its edge. */
function rig() {
  const ce = createCanvasEngine({ widgets: [PAGE, BOOK], settings: { gestures: { wheel: "zoom" } } });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 800, h: 600, dpr: 1 });
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  const page = ce.ops.spawnWidget("told:page", { x: 100, y: 100, undoable: false });
  const book = ce.ops.spawnWidget("told:book", { x: 400, y: 100, undoable: false });
  ce.world.sync();
  ce.stack.heldPose.current = {
    frame: (e) => {
      const v = ce.world.get(e, HeldView) ?? { zoom: 1, panX: 0, panY: 0 };
      return { cx: 400 + v.panX, cy: 300 + v.panY, hx: 150 * v.zoom, hy: 100 * v.zoom, s: 1.5 * v.zoom, settled: true };
    },
    part: (e, x, y) => (e === page && Math.abs(x) <= 80 && Math.abs(y) <= 50 ? "live" : Math.abs(x) <= 100 && Math.abs(y) <= 200 / 3 ? "content" : null),
  };
  const fold = createHeldFold(ce.world);
  let now = 1000;
  /** The events the fold tells after each step: one step's per object, `[]` when nothing happened. */
  const told: { entity: Entity; events: readonly HeldEvent[] }[][] = [];
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); told.push(fold.step().map((t) => ({ ...t }))); } };
  step(3);
  const put = (kind: "down" | "move" | "up", x: number, y: number, buttons: number, mods: InputMods = NO_MODS, tMs?: number): void => {
    ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods, ...(tMs !== undefined ? { tMs } : {}) });
    step();
  };
  const wheel = (x: number, y: number, w: { dx?: number; dy?: number }, mods: InputMods = NO_MODS): void => {
    ce.stack.queue.enqueue({ kind: "wheel", pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons: 0, mods, wheel: { dx: w.dx ?? 0, dy: w.dy ?? 0, pinch: 0 } });
    step();
  };
  /** Every event told since `from` (an index into the steps), for `e`. */
  const since = (from: number, e: Entity = page): HeldEvent[] => told.slice(from).flatMap((s) => s.filter((t) => t.entity === e).flatMap((t) => t.events));
  return { ce, page, book, step, put, wheel, since, mark: () => told.length };
}

/** A pointer event as told, rounded to the 1e-9 the pose's divisions leave. */
const p = (phase: "down" | "move" | "up", x: number, y: number, part: string | null, button: number, buttons: number, count: number): HeldEvent =>
  ({ type: "pointer", phase, x, y, part, button, buttons, count });
const near = (es: readonly HeldEvent[]): HeldEvent[] => es.map((e) => ({ ...e, x: Math.round(e.x * 1e6) / 1e6, y: Math.round(e.y * 1e6) / 1e6 }));

describe("the hand's input, told (design-019 §5, M24 LT2)", () => {
  it("nothing in hand: nothing told; held: the pointer's first sample is a move, then one move a step it moved — in the held extent's units, centred, with the kind's part (null off it)", () => {
    const r = rig();
    let m = r.mark();
    r.put("move", 430, 300, 0);
    expect(r.since(m)).toEqual([]);
    r.ce.ops.open(r.page);
    m = r.mark();
    r.step();
    expect(near(r.since(m))).toEqual([p("move", 20, 0, "live", -1, 0, 0)]);
    m = r.mark();
    r.step(2);
    expect(r.since(m)).toEqual([]);   // nothing moved: nothing told
    r.put("move", 400 + 90 * 1.5, 330, 0);   // the edge
    r.put("move", 700, 550, 0);   // off it — the soft desk
    expect(near(r.since(m))).toEqual([p("move", 90, 20, "content", -1, 0, 0), p("move", 200, 166.666667, null, -1, 0, 0)]);
  });

  it("a press on a NAMED part: down, a move a step, up — the count told; a double-click is counts 1 and 2 and the object stays in hand; a synthetic down's empty mask is the primary's", () => {
    const r = rig();
    r.ce.ops.open(r.page);
    r.put("move", 430, 300, 0);
    let m = r.mark();
    r.put("down", 430, 300, 1, NO_MODS, 5000);
    r.put("move", 445, 315, 1);
    r.put("up", 445, 315, 0);
    expect(near(r.since(m))).toEqual([p("down", 20, 0, "live", 0, 1, 1), p("move", 30, 10, "live", -1, 1, 0), p("up", 30, 10, "live", 0, 0, 1)]);
    m = r.mark();
    r.put("down", 445, 315, 1, NO_MODS, 5100);
    r.put("up", 445, 315, 0);
    r.put("down", 445, 315, 1, NO_MODS, 5200);
    r.put("up", 445, 315, 0);
    // the last down was 21 px off (the drag began at 430, 300 — down to down, past the 20 px slop): counted afresh, then the double-click's 2
    expect(r.since(m).map((e) => (e.type === "pointer" ? `${e.phase} ${e.count}` : e.type))).toEqual(["down 1", "up 1", "down 2", "up 2"]);
    expect(r.ce.world.hasTag(r.page, Held)).toBe(true);   // two presses on its part: never a tap that puts it down
    m = r.mark();
    r.put("down", 445, 315, 0, NO_MODS, 9000);   // a down that names no button (a synthetic one): the primary's, so its mask is 1
    r.put("move", 460, 315, 0);
    r.put("up", 460, 315, 0);
    expect(near(r.since(m))).toEqual([p("down", 30, 10, "live", 0, 1, 1), p("move", 40, 10, "live", -1, 1, 0), p("up", 40, 10, "live", 0, 0, 1)]);
  });

  it("the HAND's presses are never told, nor their moves — a press on the soft desk, a pan; nor a secondary's (a point, I28), nor a press held since before the hold — and the hover after each is", () => {
    const r = rig();
    r.ce.ops.open(r.book);   // the book's wheel is the hand's: brought close, a middle drag pans it
    r.put("move", 430, 300, 0);
    r.wheel(400, 300, { dy: -60 }, META);   // closer, so the middle button pans
    let m = r.mark();
    r.put("down", 430, 300, 4);   // the middle: a pan
    r.put("move", 470, 300, 4);
    r.put("up", 470, 300, 0);
    const pan = r.since(m, r.book);
    expect(pan.filter((e) => e.type === "pointer" && e.phase !== "move")).toEqual([]);
    expect(pan.filter((e) => e.type === "pointer" && e.buttons !== 0)).toEqual([]);   // no move of the pan's
    m = r.mark();
    r.put("down", 430, 300, 2);   // the secondary: a point
    r.put("move", 440, 300, 2);
    r.put("up", 440, 300, 0);
    const point = r.since(m, r.book);
    expect(point.map((e) => (e.type === "pointer" ? `${e.phase} ${e.buttons}` : e.type))).toEqual(["move 0"]);   // only the hover once it let go
    r.ce.ops.putDown();
    r.step();
    // a press held since BEFORE the hold — the click that opened it: never told, nor its moves; the hover after it is
    r.put("down", 430, 300, 1);
    r.ce.ops.open(r.page);
    m = r.mark();
    r.step();
    r.put("move", 440, 300, 1);
    r.put("up", 440, 300, 0);
    expect(near(r.since(m))).toEqual([p("move", 26.666667, 0, "live", -1, 0, 0)]);
    // a press on the soft desk: never told (it puts the page down — and the kind is told nothing of it)
    m = r.mark();
    r.put("down", 700, 550, 1);
    r.put("up", 700, 550, 0);
    r.step();
    expect(r.since(m).filter((e) => e.type === "pointer" && e.phase !== "move")).toEqual([]);
    expect(r.ce.world.hasTag(r.page, Held)).toBe(false);
  });

  it("the kind's wheel: a plain wheel over it is told — the tick's deltas at the pointer's point; ⌘-wheel is the hand's and tells nothing", () => {
    const r = rig();
    r.ce.ops.open(r.page);
    r.put("move", 430, 300, 0);
    const m = r.mark();
    r.wheel(430, 300, { dx: 3, dy: 7 });
    r.wheel(430, 300, { dy: -40 }, META);
    r.wheel(430, 300, { dy: 12 });
    const wheels = near(r.since(m).filter((e) => e.type === "wheel"));
    expect(wheels.map((e) => (e.type === "wheel" ? [e.dx, e.dy] : []))).toEqual([[3, 7], [0, 12]]);
    expect(wheels[0]).toMatchObject({ x: 20, y: 0 });
  });

  it("the hand lets go mid-press: the kind is told its up where the pointer was last, in the frame after — never a button left held in its source", () => {
    const r = rig();
    r.ce.ops.open(r.page);
    r.put("move", 430, 300, 0);
    r.put("down", 430, 300, 1, NO_MODS, 7000);
    r.put("move", 445, 300, 1);
    const m = r.mark();
    r.ce.ops.putDown();
    r.step();
    expect(near(r.since(m))).toEqual([p("up", 30, 0, "live", 0, 0, 1)]);
    r.put("up", 445, 300, 0);
    r.step(2);
    expect(r.since(m).length).toBe(1);   // nothing more: the hand is empty
  });
});
