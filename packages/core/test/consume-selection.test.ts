// @vitest-environment node
/**
 * `Selected ⇒ Active` (design-011 §6, §16) as a WORLD invariant: the selection is always a subset of the current
 * nav frame's members. Found at D4a's landing (2026-09-26): a note dropped into a mini mat (D2b's consume path)
 * stayed `Selected` inside it — no brackets, no menu (the desk's marks are the root slot's), but a selection all
 * the same, one that every consumer not filtering by membership could reach unseen (the arrow-key nudge, ⇧⌘L's
 * tape, a later drag of the rest of the selection, a resize, Clean Up). Membership is derived in one place
 * (`activeMembership`); an object that leaves the frame — by a drop, a peer's reparent, an undo or a redo — or
 * a selection written onto a non-member (the undo stack's selection restore) is deselected there.
 */
import { describe, expect, it } from "vitest";
import {
  Active,
  Camera,
  ChildOf,
  NO_MODS,
  Selected,
  SelectionVersion,
  Viewport,
  createCanvasEngine,
  defineWidget,
  selectedEntities,
  widgets,
  type CanvasEngine,
  type Entity,
  type InputMods,
} from "../src";

// One widget type per FILE (global registry; no test reset).
const NOTE =
  widgets.get("csel:note") ??
  defineWidget({ type: "csel:note", object: { name: "paper" }, stratum: "things", defaultSize: { w: 200, h: 200 }, provides: ["note"], interaction: { snap: "none" } });
const MAT =
  widgets.get("csel:mat") ??
  defineWidget({
    type: "csel:mat", object: { name: "minimat" }, stratum: "sheets", defaultSize: { w: 640, h: 480 }, interaction: { snap: "none" },
    container: { accepts: ["note"], provides: ["mat"], portal: { top: 32, right: 32, bottom: 32, left: 32 } },
  });

function rig() {
  const ce = createCanvasEngine({ widgets: [NOTE, MAT], settings: { snap: { enabled: false } } });
  ce.docs.create();
  return withEngine(ce);
}

function withEngine(ce: CanvasEngine) {
  ce.world.setResource(Viewport, { w: 800, h: 600, dpr: 1 });
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false }); // screen == world
  let now = 1000;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  const mouse = (kind: "down" | "move" | "up", x: number, y: number, buttons: number, mods?: Partial<InputMods>): void => {
    ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: { ...NO_MODS, ...mods } });
  };
  /** A drag from `from` to `to` in 8 samples; `during` runs before the release (the note is held, selected by the grab). */
  const drag = (from: [number, number], to: [number, number], during?: () => void): void => {
    mouse("move", from[0], from[1], 0); step();
    mouse("down", from[0], from[1], 1); step();
    for (let i = 1; i <= 8; i++) { mouse("move", from[0] + ((to[0] - from[0]) * i) / 8, from[1] + ((to[1] - from[1]) * i) / 8, 1); step(); }
    during?.();
    mouse("up", to[0], to[1], 0); step(4);
  };
  const tap = (x: number, y: number): void => { mouse("move", x, y, 0); step(); mouse("down", x, y, 1); step(); mouse("up", x, y, 0); step(3); };
  const spawn = (type: string, x: number, y: number, w: number, h: number): Entity => {
    const e = ce.ops.spawnWidget(type, { x, y, w, h, undoable: false });
    ce.world.sync();
    step(3);
    return e;
  };
  const selected = (): Entity[] => selectedEntities(ce.world);
  /** The invariant itself: every selected widget is a member of the current nav frame. */
  const scoped = (): boolean => selected().every((e) => ce.world.hasTag(e, Active));
  const version = (): number => ce.world.getResource(SelectionVersion)?.v ?? 0;
  return { ce, world: ce.world, step, mouse, drag, tap, spawn, selected, scoped, version };
}

describe("the selection is a subset of the current frame's members (Selected ⇒ Active)", () => {
  it("a drop into a mini mat deselects what it moved inside", () => {
    const r = rig();
    // the mat's rect (580, 260)…(1220, 740), its face inset by 32; the note centred at (300, 250)
    const mat = r.spawn("csel:mat", 580, 260, 640, 480);
    const note = r.spawn("csel:note", 200, 150, 200, 200);
    let heldSelected = false;
    r.drag([300, 250], [900, 500], () => { heldSelected = r.world.hasTag(note, Selected); });
    expect(heldSelected).toBe(true); // the precondition: the grab selected it
    expect(r.world.getRelation(note, ChildOf)).toBe(mat); // it went in
    expect(r.world.hasTag(note, Active)).toBe(false);
    expect(r.world.hasTag(note, Selected)).toBe(false);
    expect(r.selected()).toEqual([]);
    r.ce.dispose();
  });

  it("the undo that brings it back may reselect it; the redo that takes it in again deselects it", () => {
    const r = rig();
    const mat = r.spawn("csel:mat", 580, 260, 640, 480);
    const note = r.spawn("csel:note", 200, 150, 200, 200);
    r.drag([300, 250], [900, 500]);
    expect(r.world.getRelation(note, ChildOf)).toBe(mat);
    expect(r.ce.docs.undo()).toBe(true);
    r.step(3);
    expect(r.world.getRelation(note, ChildOf)).not.toBe(mat); // back on the desk: a member again
    expect(r.scoped()).toBe(true);
    expect(r.ce.docs.redo()).toBe(true);
    r.step(3);
    expect(r.world.getRelation(note, ChildOf)).toBe(mat);
    expect(r.world.hasTag(note, Selected)).toBe(false); // the stack's selection restore does not reach inside
    expect(r.scoped()).toBe(true);
    r.ce.dispose();
  });

  it("an undo that moves a selected object AWAY from the frame deselects it — entered, the note inside, then ⌘Z", () => {
    const r = rig();
    const mat = r.spawn("csel:mat", 580, 260, 640, 480);
    const note = r.spawn("csel:note", 200, 150, 200, 200);
    r.drag([300, 250], [900, 500]);
    expect(r.world.getRelation(note, ChildOf)).toBe(mat);
    r.ce.ops.enterContainer(mat, { transition: "none" });
    r.step(3);
    expect(r.world.hasTag(note, Active)).toBe(true); // inside the mat, the note is a member
    r.ce.ops.setSelection([note]);
    expect(r.world.hasTag(note, Selected)).toBe(true); // the precondition
    expect(r.ce.docs.undo()).toBe(true); // the drop is undone: the note goes back to the ROOT desk
    r.step(3);
    expect(r.world.getRelation(note, ChildOf)).not.toBe(mat);
    expect(r.world.hasTag(note, Active)).toBe(false); // not a member of the frame we are in
    expect(r.world.hasTag(note, Selected)).toBe(false);
    expect(r.scoped()).toBe(true);
    r.ce.dispose();
  });

  it("a peer's reparent of a selected object into a mini mat deselects it here", () => {
    const a = rig();
    const mat = a.spawn("csel:mat", 580, 260, 640, 480);
    const note = a.spawn("csel:note", 200, 150, 200, 200);
    // the peer: the same document, opened in a second engine
    const sessionA = a.ce.docs.current();
    if (sessionA === undefined) throw new Error("no session");
    const ceB = createCanvasEngine({ widgets: [NOTE, MAT], settings: { snap: { enabled: false } } });
    expect(ceB.docs.open(sessionA.exportEnvelope()).ok).toBe(true);
    const b = withEngine(ceB);
    ceB.world.sync();
    b.step(3);
    const sessionB = ceB.docs.current();
    if (sessionB === undefined) throw new Error("no peer session");
    const noteB = sessionB.store.resolve(sessionA.store.keyOf(note) as never) as Entity;
    const matB = sessionB.store.resolve(sessionA.store.keyOf(mat) as never) as Entity;
    expect(noteB).toBeDefined();
    // here: the note is selected, a member of the root desk
    a.tap(300, 250);
    expect(a.world.hasTag(note, Selected)).toBe(true); // the precondition
    const v0 = a.version();
    // the peer drops it into the mat (its own gesture — a consume, committed to its document)
    b.drag([300, 250], [900, 500]);
    expect(ceB.world.getRelation(noteB, ChildOf)).toBe(matB);
    // the peer's change arrives
    sessionA.applyRemote(sessionB.exportSnapshot());
    a.step(3);
    expect(a.world.getRelation(note, ChildOf)).toBe(mat);
    expect(a.world.hasTag(note, Selected)).toBe(false);
    expect(a.selected()).toEqual([]);
    expect(a.version()).toBeGreaterThan(v0); // the selection's readers were told
    a.ce.dispose();
    ceB.dispose();
  });

  it("a selection written onto a non-member (a stale key restored, an app's raw write) is dropped at the next tick", () => {
    const r = rig();
    const mat = r.spawn("csel:mat", 580, 260, 640, 480);
    const note = r.spawn("csel:note", 200, 150, 200, 200);
    r.drag([300, 250], [900, 500]);
    expect(r.world.getRelation(note, ChildOf)).toBe(mat);
    r.world.addTag(note, Selected);
    r.step();
    expect(r.world.hasTag(note, Selected)).toBe(false);
    // the control: a member keeps a selection written the same way
    const other = r.spawn("csel:note", 100, 400, 120, 120);
    r.world.addTag(other, Selected);
    r.step(2);
    expect(r.world.hasTag(other, Selected)).toBe(true);
    expect(r.scoped()).toBe(true);
    r.ce.dispose();
  });

  it("a tray insert dropped into a mini mat is never selected there — not for one tick (the select-on-drop stays out)", () => {
    const r = rig();
    const mat = r.spawn("csel:mat", 580, 260, 640, 480);
    const ghost = r.ce.ops.insertByDrag("csel:note", { screenX: 300, screenY: 250 });
    r.step();
    r.mouse("move", 315, 250, 1);
    r.step();
    expect(r.world.hasTag(ghost, Selected)).toBe(true); // the precondition: the ghost holds the select-on-grab
    r.mouse("move", 900, 500, 1);
    r.step();
    r.mouse("up", 900, 500, 0);
    const trace: string[] = [];
    for (let i = 0; i < 5; i++) {
      r.step();
      trace.push(r.scoped() ? "ok" : `out-of-frame ${r.selected().join(",")}`);
    }
    const inside = r.world.getReverse(mat, ChildOf);
    expect(inside).toHaveLength(1); // the twin went in
    expect(trace).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    expect(r.world.hasTag(inside[0] as Entity, Selected)).toBe(false);
    r.ce.dispose();
  });
});
