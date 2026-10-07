// @vitest-environment node
// Petition I37 — THE TRAY'S KEYBOARD PATH: the board's FOCUS (`Tray.focus`, the op `focusTray`) walks the specimens the lay hangs in
// the LAY'S order (`TrayContent.order` — row by row, across the categories when the drawer shows all; never the specimens' sibling
// order, which a category round-trip scrambles), from none `next` the first and `prev` the last, staying at the ends; a type by its
// id; the lay scrolls the specimen it moves to into the board's face — once, the least that shows it whole — and lets go a focus on a
// type it lays no more. `ops.layFromTray` LAYS the tray's own take at a world point with no drag: what a drag-off's drop makes — the
// type at its natural size, the entry's `take` props, ONE undo step, selected — centred on the point, the board folding as a handed
// take's does. Through the REAL stack; the pose is the renderer's word (as tray-take.test.ts's).
import { describe, expect, it } from "vitest";
import { specimenFit } from "@ice/kernel";
import {
  Camera,
  createCanvasEngine,
  defineQuery,
  defineWidget,
  focusTray,
  Held,
  InsertGhost,
  NO_MODS,
  openTray,
  p,
  Position,
  PrefabId,
  Selected,
  setTrayCategory,
  Size,
  Specimen,
  specimensOf,
  Tray,
  TrayContent,
  trayEntity,
  trayFocus,
  trayHung,
  trayOpen,
  Viewport,
  widgets,
  type Entity,
  type TrayScreenFrame,
  type WidgetType,
} from "../src";

// One widget type per FILE (global registry; no test reset): twelve in category "a", four in "b" — rows enough to scroll
const define = (cat: string, i: number): WidgetType =>
  widgets.get(`focus:${cat}${i}`) ??
  defineWidget({
    type: `focus:${cat}${i}`, object: { name: "note" }, defaultSize: { w: 100, h: 80 },
    props: { word: p.string({ default: "" }), tint: p.string({ default: "plain" }) },
    tray: {
      label: `${cat}${i}`, props: { word: "face", tint: "red" }, ...(i % 2 === 0 ? { take: "face" as const } : {}),
      category: cat, order: i, hang: { w: 120, h: 120, accessory: "hook", pegs: [[-1, -0.5], [1, -0.5]] },
    },
  });
const A = Array.from({ length: 12 }, (_, i) => define("a", i));
const B = Array.from({ length: 4 }, (_, i) => define("b", i));
const ORDER = [...A, ...B].map((t) => t.type);   // the lay's order: category, then order

const VP = { w: 800, h: 600, dpr: 1 };
const HEAD = 40;
const FACE = 252;

function rig() {
  const ce = createCanvasEngine({ widgets: [...A, ...B] });
  ce.docs.create();
  ce.world.setResource(Viewport, VP);
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false }); // screen == world
  let now = 1000;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  const tray = () => ce.world.read(trayEntity(ce.world) as Entity, Tray);
  const shown = (): number => { const e = trayEntity(ce.world); return e === undefined ? 0 : ce.world.read(e, Tray).scroll; };
  // the renderer's word: the drawer 720 × 252 open (its top at 348), its face the board's 252 px, its header 40
  const frame = (): TrayScreenFrame => trayOpen(ce.world)
    ? { x: 40, y: 348, w: 720, h: 252, p: 1, max: 400, pitch: 40, scroll: shown(), face: FACE, head: HEAD }
    : { x: 40, y: 588, w: 720, h: 252, p: 0, max: 400, pitch: 40, scroll: shown(), face: FACE, head: HEAD };
  ce.stack.trayPose.current = { frame };
  const mouse = (kind: "down" | "move" | "up", x: number, y: number, buttons: number): void => {
    ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: NO_MODS });
    step();
  };
  step(3);
  openTray(ce.world);
  step(2);
  /** A specimen's hang on the board (board px) and its object as drawn on screen. */
  const specimen = (type: string) => {
    const e = specimensOf(ce.world, trayEntity(ce.world) as Entity).find((s) => ce.world.read(s, PrefabId).id === type);
    if (e === undefined) throw new Error(`no ${type} specimen`);
    const at = ce.world.read(e, Position);
    const size = ce.world.read(e, Size);
    const fit = specimenFit({ x: at.x, y: at.y, w: size.w, h: size.h }, (widgets.get(type) as WidgetType).defaultSize);
    const f = frame();
    return { board: { y0: at.y, y1: at.y + size.h }, x: f.x + fit.x, y: f.y + fit.y - f.scroll, w: fit.w, h: fit.h };
  };
  /** The board band the drawer shows (board px): under the header, above the face's foot. */
  const band = () => ({ y0: shown() + HEAD, y1: shown() + FACE });
  const made = (type: string): Entity[] => {
    const out: Entity[] = [];
    ce.world.query(defineQuery([PrefabId, Position])).each((b) => { for (const r of b) { const e = b.entity(r); if (ce.world.read(e, PrefabId).id === type && !ce.world.has(e, InsertGhost) && !ce.world.hasTag(e, Specimen)) out.push(e); } });
    return out;
  };
  return { ce, world: ce.world, step, mouse, tray, specimen, band, made, frame };
}

describe("the board's keyboard focus (petition I37)", () => {
  it("walks the specimens in the LAY'S order — from none `next` the first, `prev` the last; the ends stay; `first`/`last`; a type by its id, an unknown one changes nothing", () => {
    const r = rig();
    expect(trayHung(r.world)).toEqual(ORDER);
    expect(trayFocus(r.world)).toBe("");
    expect(focusTray(r.world, "next")).toBe(ORDER[0]);
    expect(focusTray(r.world, "next")).toBe(ORDER[1]);
    expect(focusTray(r.world, "prev")).toBe(ORDER[0]);
    expect(focusTray(r.world, "prev")).toBe(ORDER[0]);   // at the start it stays
    expect(focusTray(r.world, "last")).toBe(ORDER[15]);
    expect(focusTray(r.world, "next")).toBe(ORDER[15]);   // at the end it stays
    expect(focusTray(r.world, "focus:a5")).toBe("focus:a5");
    expect(focusTray(r.world, "focus:nothing")).toBe("focus:a5");
    expect(focusTray(r.world, "first")).toBe(ORDER[0]);
    // the walk crosses from category a into b (the drawer shows all)
    focusTray(r.world, "focus:a11");
    expect(focusTray(r.world, "next")).toBe("focus:b0");
    // from none, `prev` is the last
    r.world.edit(trayEntity(r.world) as Entity).set(Tray, { ...r.tray(), focus: "" });
    expect(focusTray(r.world, "prev")).toBe(ORDER[15]);
    expect(r.tray().focus).toBe(ORDER[15]);   // the fact, on the tray entity
  });

  it("follows the lay's order, not the specimens' sibling order — which a category round-trip scrambles", () => {
    const r = rig();
    setTrayCategory(r.world, "b");
    r.step(2);
    expect(trayHung(r.world)).toEqual(B.map((t) => t.type));
    expect(focusTray(r.world, "first")).toBe("focus:b0");
    expect(focusTray(r.world, "last")).toBe("focus:b3");   // only what the drawer shows
    setTrayCategory(r.world, "");
    r.step(2);
    const siblings = specimensOf(r.world, trayEntity(r.world) as Entity).map((e) => r.world.read(e, PrefabId).id);
    expect(siblings.slice(0, 4)).toEqual(B.map((t) => t.type));   // b's specimens kept where they hung, a's appended…
    expect(trayHung(r.world)).toEqual(ORDER);                     // …the lay's order is a's first
    expect(JSON.parse(r.world.read(trayEntity(r.world) as Entity, TrayContent).order ?? "[]")).toEqual(ORDER);
    focusTray(r.world, "first");
    expect(trayFocus(r.world)).toBe("focus:a0");
  });

  it("scrolls the specimen it moves to into the board's face — the least that shows it whole, once; a wheel may take it out again", () => {
    const r = rig();
    expect(r.tray().scroll).toBe(0);
    focusTray(r.world, "last");
    r.step();
    const last = r.specimen(ORDER[15] as string).board;
    expect(r.tray().scroll).toBeGreaterThan(0);
    expect(last.y1).toBe(r.band().y1);   // just shown: its foot on the face's
    expect(last.y0).toBeGreaterThanOrEqual(r.band().y0);
    // the first specimen is above the band now: focusing it scrolls up the least — its top just under the header
    focusTray(r.world, "first");
    r.step();
    const first = r.specimen(ORDER[0] as string).board;
    expect(first.y0).toBe(r.band().y0);
    expect(r.tray().scroll).toBe(first.y0 - HEAD);
    // a specimen already whole in view (the next on the first row): no scroll
    const before = r.tray().scroll;
    focusTray(r.world, "next");
    r.step();
    expect(r.tray().scroll).toBe(before);
    // once: a wheel down takes the focused specimen out of view, and the focus does not pull it back
    r.mouse("move", 400, 500, 0);
    r.ce.stack.queue.enqueue({ kind: "wheel", pointerId: "mouse", device: "mouse", screenX: 400, screenY: 500, buttons: 0, mods: NO_MODS, wheel: { dx: 0, dy: 300, pinch: 0 } });
    r.step(12);
    expect(r.tray().scroll).toBeGreaterThan(200);
    expect(trayFocus(r.world)).toBe(ORDER[1]);
  });

  it("lets go a focus on a type the board lays no more (another category shown)", () => {
    const r = rig();
    focusTray(r.world, "focus:a3");
    r.step();
    setTrayCategory(r.world, "b");
    r.step(2);
    expect(trayFocus(r.world)).toBe("");
    expect(focusTray(r.world, "next")).toBe("focus:b0");
  });
});

describe("ops.layFromTray — the tray's own take, laid (petition I37)", () => {
  /** A drag-off of `type` dropped with its object centred on (cx, cy): pressed at its specimen's centre, carried out, released. */
  const dragOff = (r: ReturnType<typeof rig>, type: string, cx: number, cy: number): Entity => {
    const s = r.specimen(type);
    const x = s.x + s.w / 2;
    const y = s.y + s.h / 2;
    r.mouse("move", x, y, 0);
    r.mouse("down", x, y, 1);
    r.mouse("move", x + 6, y, 1);
    r.mouse("move", cx, 300, 1);   // out of the drawer: handed
    r.mouse("move", cx, 250, 1);
    r.mouse("move", cx, cy, 1);
    r.mouse("move", cx, cy, 1);
    r.mouse("up", cx, cy, 0);
    r.step(3);
    const twin = r.made(type)[0];
    if (twin === undefined) throw new Error(`the drag-off made no ${type}`);
    return twin;
  };
  /** Every durable cell of an object but where it lies: its type's component groups, read. */
  const cellsOf = (r: ReturnType<typeof rig>, type: string, e: Entity) =>
    (widgets.get(type) as WidgetType).groups.map((g) => [g.name, r.world.get(e, g.component as never)] as const);

  it("lays exactly what a drag-off makes — the type at its natural size, the entry's take, selected — centred on the point; ONE undo step; the board folds", () => {
    for (const type of ["focus:a2", "focus:a3"]) {   // `take: "face"` (a2: the face's props) and none (a3: the widget's defaults)
      const dragged = rig();
      const d = dragOff(dragged, type, 300, 160);
      const laidRig = rig();
      focusTray(laidRig.world, type);
      const e = laidRig.ce.ops.layFromTray(type, { x: 300, y: 160 });
      if (e === undefined) throw new Error("refused");
      expect(laidRig.tray().open).toBe(false);   // folded, as a handed take's board
      laidRig.step(3);
      expect(laidRig.made(type)).toEqual([e]);
      expect(laidRig.world.read(e, Size)).toEqual(dragged.world.read(d, Size));
      expect(laidRig.world.read(e, Size)).toEqual({ w: 100, h: 80 });
      expect(laidRig.world.read(e, Position)).toEqual({ x: 250, y: 120 });   // centred on (300, 160)
      expect(dragged.world.read(d, Position)).toEqual({ x: 250, y: 120 });   // the drag-off's, dropped there by its centre
      expect(cellsOf(laidRig, type, e)).toEqual(cellsOf(dragged, type, d));
      expect(laidRig.world.hasTag(e, Selected)).toBe(true);
      expect(dragged.world.hasTag(d, Selected)).toBe(true);
      // ONE undo step, as the drag-off's: undo takes it away, there was nothing before it, redo brings it back
      expect(laidRig.ce.docs.undo()).toBe(true);
      laidRig.step(2);
      expect(laidRig.made(type)).toEqual([]);
      expect(laidRig.ce.docs.undo()).toBe(false);
      expect(laidRig.ce.docs.redo()).toBe(true);
      laidRig.step(2);
      expect(laidRig.made(type)).toHaveLength(1);
    }
  });

  it("refuses what the board does not hang now, and while an object is in hand; a malformed point throws", () => {
    const r = rig();
    setTrayCategory(r.world, "b");
    r.step(2);
    expect(r.ce.ops.layFromTray("focus:a0", { x: 0, y: 0 })).toBeUndefined();   // category a is not shown
    expect(r.ce.ops.layFromTray("focus:nothing", { x: 0, y: 0 })).toBeUndefined();
    expect(r.made("focus:a0")).toEqual([]);
    expect(trayOpen(r.world)).toBe(true);   // a refusal folds nothing
    expect(() => r.ce.ops.layFromTray("focus:b0", { x: Number.NaN, y: 0 })).toThrow(/two finite numbers/);
    const e = r.ce.ops.layFromTray("focus:b0", { x: 100, y: 100 });
    expect(e).toBeDefined();
    // an object in hand: the tray stands aside (the hand is a focus of its own)
    r.step(2);
    r.world.addTag(e as Entity, Held);
    expect(r.ce.ops.layFromTray("focus:b1", { x: 300, y: 100 })).toBeUndefined();
    expect(r.made("focus:b1")).toEqual([]);
  });
});
