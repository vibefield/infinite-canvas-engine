// @vitest-environment node
// WHAT RIDES WITH A WIDGET, AND AN EDGE THAT DIES WITH ITS TARGET (design-015 D3t-c — the desk calendar's notes stuck to its days):
// a widget type's `riders` join the move claim's dragged set, so they move live with it and land in the SAME transaction — one undo
// step takes them all back — and a taped rider stays put; a `dependent` relation's source is taken by the destroy cascade with the
// entity it points at — in the same transaction, so one undo brings both back.
import { describe, expect, it } from "vitest";
import {
  Camera,
  ChildOf,
  createCanvasEngine,
  defineComponent,
  definePrefab,
  defineRelation,
  defineWidget,
  type Entity,
  field,
  guardedTransaction,
  init,
  Locked,
  NO_MODS,
  Position,
  schemaMeta,
  Viewport,
  widgets,
  type World,
} from "../src";

// one widget type per FILE (global registry; no test reset)
const PinsTo = defineRelation("rd:pins", { arity: "one", dependent: true });
const Pin = defineComponent("rd:pin", { day: field("string", { default: "" }) });
const PinPrefab = definePrefab("rd:pin", { store: "durable", version: 1, components: [init(Pin, { day: "" })], relations: [ChildOf, PinsTo] });
const pinnedTo = (world: World, pad: Entity): Entity[] =>
  world.getReverse(pad, ChildOf).flatMap((k) => { const n = world.has(k, Pin) ? world.getRelation(k, PinsTo) : undefined; return n === undefined ? [] : [n]; });
const NOTE = widgets.get("rd:note") ?? defineWidget({ type: "rd:note", object: { name: "paper" }, defaultSize: { w: 100, h: 100 }, interaction: { selectable: true, movable: true } });
const PAD = widgets.get("rd:pad") ?? defineWidget({ type: "rd:pad", object: { name: "calendar" }, stratum: "pads", defaultSize: { w: 600, h: 400 }, interaction: { selectable: true, movable: true }, data: [PinPrefab], riders: pinnedTo });

function rig() {
  const ce = createCanvasEngine({ widgets: [NOTE, PAD] });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 1600, h: 900, dpr: 1 });
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  const pad = ce.ops.spawnWidget(PAD.type, { x: 0, y: 0, undoable: false });
  const stuck = ce.ops.spawnWidget(NOTE.type, { x: 400, y: 250, undoable: false });
  const loose = ce.ops.spawnWidget(NOTE.type, { x: 100, y: 250, undoable: false });
  ce.world.sync();
  const session = ce.docs.current();
  if (session === undefined) throw new Error("no session");
  let pin: Entity | undefined;
  guardedTransaction(session.store, ce.world, (tx) => { pin = tx.spawnPrefab(PinPrefab, [init(Pin, { day: "2026-09-23" })]); tx.setRelation(pin, ChildOf, pad); tx.setRelation(pin, PinsTo, stuck); });
  ce.world.sync();
  let now = 0;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  step(3);
  const mouse = (kind: "down" | "move" | "up", x: number, y: number, buttons: number): void => {
    ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: NO_MODS });
  };
  const drag = (from: readonly [number, number], d: readonly [number, number]): void => {
    mouse("move", from[0], from[1], 0); step();
    mouse("down", from[0], from[1], 1); step();
    for (let i = 1; i <= 5; i++) { mouse("move", from[0] + (d[0] * i) / 5, from[1] + (d[1] * i) / 5, 1); step(); }
    mouse("up", from[0] + d[0], from[1] + d[1], 0); step(3);
  };
  const at = (e: Entity) => { const p = ce.world.get(e, Position); return p === undefined ? null : [p.x, p.y]; };
  const undoSteps = (): number => { const s = session.store; let n = 0; while (s.canUndo() && n < 50) { s.undo(); n += 1; } for (let i = 0; i < n; i++) s.redo(); ce.world.sync(); return n; };
  return { ce, session, pad, stuck, loose, pin: pin as Entity, step, drag, at, undoSteps };
}

describe("a widget type's RIDERS move with it (defineWidget({ riders }))", () => {
  it("dragging the pad carries the note stuck to it by the same delta — one transaction, one undo step; the loose note stays", () => {
    const r = rig();
    const steps = r.undoSteps();
    r.drag([50, 50], [120, 80]);
    const [px, py] = r.at(r.pad) as number[];
    expect(px).toBeGreaterThan(60);   // it moved (the claim's dead zone takes its first samples)
    expect(r.at(r.stuck)).toEqual([400 + (px as number), 250 + (py as number)]);
    expect(r.at(r.loose)).toEqual([100, 250]);
    expect(r.undoSteps()).toBe(steps + 1);
    r.session.store.undo();
    r.ce.world.sync();
    expect([r.at(r.pad), r.at(r.stuck)]).toEqual([[0, 0], [400, 250]]);
  });

  it("a taped rider stays put (the tape holds it as it holds a member of the selection)", () => {
    const r = rig();
    r.ce.ops.setLocked([r.stuck], true);
    r.ce.world.sync();
    r.drag([50, 50], [60, 0]);
    expect((r.at(r.pad) as number[])[0]).toBeGreaterThan(20);
    expect(r.at(r.stuck)).toEqual([400, 250]);
  });

  it("dragging the note itself does not carry the pad", () => {
    const r = rig();
    r.drag([450, 300], [-50, 0]);
    expect((r.at(r.stuck) as number[])[0]).toBeLessThan(390);
    expect(r.at(r.pad)).toEqual([0, 0]);
  });
});

describe("a DEPENDENT relation's source dies with its target (defineRelation({ dependent: true }))", () => {
  it("declared, it is the cascade's: deleting the note takes its pin in the SAME transaction; one ⌘Z brings both back, the edge whole", () => {
    const r = rig();
    expect(schemaMeta.relation(PinsTo)?.dependent).toBe(true);
    expect(schemaMeta.dependents()).toContain(PinsTo);
    const steps = r.undoSteps();
    r.ce.ops.setSelection([r.stuck], "replace");
    r.ce.ops.deleteSelection();
    r.ce.world.sync();
    expect(r.ce.world.isAlive(r.stuck)).toBe(false);
    expect(r.ce.world.isAlive(r.pin)).toBe(false);
    expect(r.ce.world.isAlive(r.pad)).toBe(true);
    expect(r.undoSteps()).toBe(steps + 1);
    r.session.store.undo();
    r.ce.world.sync();
    const back = r.ce.world.getReverse(r.pad, ChildOf).filter((k) => r.ce.world.has(k, Pin));
    expect(back.length).toBe(1);
    const note = r.ce.world.getRelation(back[0] as Entity, PinsTo);
    expect(note !== undefined && r.ce.world.isAlive(note) && r.at(note)?.[0] === 400).toBe(true);
  });

  it("an ordinary relation is not: a wire-less reified edge without `dependent` outlives its target", () => {
    const Plain = defineRelation("rd:plain", { arity: "one" });
    expect(schemaMeta.relation(Plain)?.dependent).toBeUndefined();
    expect(schemaMeta.dependents()).not.toContain(Plain);
    expect(Locked).toBeDefined();
  });
});
