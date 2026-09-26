/**
 * design-015 D4a — the desk's keys and the tape's remaining semantics (*Marks on the Mat*'s key table, Q-e):
 * ⌥ as a drag starts leaves a copy behind (in the move's ONE transaction, the copy untaped and just under its
 * original); ⌘ held holds the snap off; ⇧ locks the drag to its dominant axis (the snap corrects along it
 * alone); Clean Up flows around a taped widget; a taped selection shows no grips; a copy of a taped widget
 * is not taped. Every negative has its control (the same gesture without the modifier, or on the untaped
 * widget), so no assertion passes because nothing happened.
 */
import { describe, expect, it } from "vitest";
import {
  Camera,
  ChildOf,
  GuideLine,
  HandleSpec,
  Locked,
  NO_MODS,
  Position,
  PrefabId,
  Viewport,
  createCanvasEngine,
  createSiblingOrderIndex,
  defineQuery,
  defineWidget,
  p,
  widgets,
  type Entity,
  type InputMods,
} from "../src";

const CARD =
  widgets.get("dk:card") ??
  defineWidget({
    type: "dk:card",
    defaultSize: { w: 120, h: 90 },
    props: { label: p.string({ default: "" }) },
    interaction: { resizable: true, snap: "both" },
  });

const cardsQ = defineQuery([Position, PrefabId]);
const guidesQ = defineQuery([GuideLine]);
const handlesQ = defineQuery([HandleSpec]);

function rig() {
  const ce = createCanvasEngine({ widgets: [CARD] });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 1200, h: 800, dpr: 1 });
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false }); // screen == world
  let now = 1000;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  const mouse = (kind: "down" | "move" | "up", x: number, y: number, buttons: number, mods?: Partial<InputMods>): void => {
    ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: { ...NO_MODS, ...mods } });
  };
  /** A mouse drag whose TOTAL is (dx, dy), leaving the dead zone first (12 px right); `during` runs mid-drag, before the release. */
  const drag = (fx: number, fy: number, dx: number, dy: number, mods?: Partial<InputMods>, during?: () => void): void => {
    mouse("move", fx, fy, 0, mods);
    step();
    mouse("down", fx, fy, 1, mods);
    step();
    const ox = fx + 12;
    mouse("move", ox, fy, 1, mods);
    step();
    for (let i = 1; i <= 4; i++) { mouse("move", ox + (dx * i) / 4, fy + (dy * i) / 4, 1, mods); step(); }
    during?.();
    mouse("up", ox + dx, fy + dy, 0, mods);
    step(3);
  };
  const spawn = (x: number, y: number, label = ""): Entity => {
    const e = ce.ops.spawnWidget(CARD.type, { x, y, props: { label }, undoable: false });
    ce.world.sync();
    return e;
  };
  const pos = (e: Entity) => ce.world.get(e, Position);
  const count = (q: ReturnType<typeof defineQuery>): number => { let n = 0; ce.world.query(q).each((b) => { n += b.count; }); return n; };
  return { ce, step, drag, spawn, pos, count };
}

describe("the desk's drag modifiers (drag-mods.ts: ⌥ · ⌘ · ⇧)", () => {
  it("⌥ as the drag starts leaves a copy where the card lay — its props, untaped, just under it — and the move and the copy are ONE undo step", () => {
    const { ce, step, drag, spawn, pos, count } = rig();
    const a = spawn(100, 400, "a");
    const b = spawn(300, 100, "b");
    step(3);
    drag(360, 145, 200, 0, { alt: true });
    expect(pos(b)).toEqual({ x: 500, y: 100 });
    expect(count(cardsQ)).toBe(3);
    const all: Entity[] = [];
    ce.world.query(cardsQ).each((q) => { for (const r of q) all.push(q.entity(r)); });
    const copy = all.find((e) => e !== a && e !== b) as Entity;
    expect(pos(copy)).toEqual({ x: 300, y: 100 });
    expect((ce.world.get(copy, CARD.groups[0]?.component as never) as { label: string }).label).toBe("b");
    expect(ce.world.hasTag(copy, Locked)).toBe(false);
    const ord = createSiblingOrderIndex(ce.world).ordinals();
    expect(ord.get(copy) as number).toBeLessThan(ord.get(b) as number);
    expect(ord.get(copy) as number).toBeGreaterThan(ord.get(a) as number);
    expect(ce.world.getRelation(copy, ChildOf)).toBe(ce.world.getRelation(b, ChildOf));
    expect(ce.docs.undo()).toBe(true);
    step();
    expect(count(cardsQ)).toBe(2);
    expect(pos(b)).toEqual({ x: 300, y: 100 });
    // the control: the same drag without ⌥ copies nothing
    drag(360, 145, 200, 0);
    expect(count(cardsQ)).toBe(2);
    ce.dispose();
  });

  it("⌘ held holds the snap off — no correction, no guide; without it the same drag snaps to the neighbour's top and draws the guide", () => {
    const { ce, step, drag, spawn, pos, count } = rig();
    spawn(100, 100);
    const b = spawn(400, 300);
    step(3);
    let guides = -1;
    drag(460, 345, 40, -197, { meta: true }, () => { guides = count(guidesQ); });
    expect(pos(b)).toEqual({ x: 440, y: 103 });
    expect(guides).toBe(0);
    expect(ce.docs.undo()).toBe(true);
    step();
    drag(460, 345, 40, -197, undefined, () => { guides = count(guidesQ); });
    expect(pos(b)).toEqual({ x: 440, y: 100 });
    expect(guides).toBeGreaterThan(0);
    ce.dispose();
  });

  it("⇧ locks the drag to its dominant axis — the other stays exactly where it was — and the snap corrects along the free axis alone", () => {
    const { ce, step, drag, spawn, pos } = rig();
    spawn(100, 100);
    const b = spawn(400, 400);
    step(3);
    drag(460, 445, 60, 25, { shift: true });
    expect(pos(b)).toEqual({ x: 460, y: 400 });
    expect(ce.docs.undo()).toBe(true);
    step();
    drag(460, 445, 25, -60, { shift: true });
    expect(pos(b)).toEqual({ x: 400, y: 340 });
    expect(ce.docs.undo()).toBe(true);
    step();
    drag(460, 445, 60, 25);   // the control: free, it goes both ways
    expect(pos(b)).toEqual({ x: 460, y: 425 });
    ce.dispose();
  });

  it("⇧: the snap corrects along the free axis alone — the card 3 under its neighbour's foot stays there while the x snap lands it on the neighbour's left edge", () => {
    const { ce, step, drag, spawn, pos } = rig();
    spawn(100, 100);            // its foot at y 190
    const b = spawn(400, 193);  // 3 under it: a free drag would snap its top onto 190
    step(3);
    drag(460, 238, -297, 4, { shift: true });
    expect(pos(b)).toEqual({ x: 100, y: 193 });
    ce.dispose();
  });
});

describe("the tape's remaining semantics (design-015 §5.1, D4a)", () => {
  it("Clean Up flows around a taped widget — it stays, an obstacle — while the untaped ones arrange", () => {
    const { ce, step, spawn, pos } = rig();
    const a = spawn(0, 0);
    const b = spawn(700, 500);
    const c = spawn(40, 600);
    step(3);
    ce.ops.setLocked([b], true);
    step();
    ce.ops.arrange({ ids: [a, b, c] });
    step(40);
    expect(pos(b)).toEqual({ x: 700, y: 500 });
    const moved = [pos(a), pos(c)].some((q, i) => q?.x !== [0, 40][i] || q?.y !== [0, 600][i]);
    expect(moved).toBe(true);
    ce.dispose();
  });

  it("a taped selection shows no grips (the box stays); lifting the tape brings them back", () => {
    const { ce, step, spawn, count } = rig();
    const a = spawn(100, 100);
    step(3);
    ce.ops.setSelection([a]);
    step(2);
    expect(count(handlesQ)).toBe(8);
    ce.ops.setLocked([a], true);
    step(2);
    expect(count(handlesQ)).toBe(0);
    ce.ops.setLocked([a], false);
    step(2);
    expect(count(handlesQ)).toBe(8);
    ce.dispose();
  });

  it("a copy of a taped widget is not taped (the tape is not the object's)", () => {
    const { ce, step, spawn } = rig();
    const a = spawn(100, 100, "taped");
    step(3);
    ce.ops.setLocked([a], true);
    step();
    ce.ops.setSelection([a]);
    const [copy] = ce.ops.duplicateSelection();
    step(2);
    expect(copy).toBeDefined();
    expect(ce.world.hasTag(copy as Entity, Locked)).toBe(false);
    expect(ce.world.hasTag(a, Locked)).toBe(true);
    ce.dispose();
  });
});
