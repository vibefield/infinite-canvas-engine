// @vitest-environment node
// TAKING ONE (design-017 §9; K5b): a press on a specimen is `TrayPress specimen`; past the slop its COPY lifts (`Tray.take`, the grab
// point, the pointer — the specimen stays hung, the board does not scroll); out of the drawer's open rect the copy is HANDED to the
// desk — the drawer shuts, `handed` bumps, and after the step `ops.insertByDrag` spawns the insert ghost under the SAME grab point (no
// centre-snap), its home the specimen's centre, its synthetic down the pointer's. The ordinary drag runs; the release is ONE create
// transaction, selected, one undo step. Released inside the drawer, or the drawer shut under it, the take is put back; released back
// over the drawer as drawn after the hand-off (still sliding away — once shut, where it stood is the desk's: K9), or Esc mid-drag, the
// ghost flies home — nothing enters undo. A kind that is not
// core-movable is taken all the same. What one taken is made with is the entry's `take` (D-K5b.1). Through the REAL stack; the pose is
// the renderer's word.
import { describe, expect, it } from "vitest";
import { specimenFit } from "@ice/kernel";
import {
  Camera,
  closeTray,
  createCanvasEngine,
  defineWidget,
  GhostRetiring,
  Grab,
  InsertGhost,
  Movable,
  NO_MODS,
  openTray,
  p,
  Position,
  PrefabId,
  Selected,
  Size,
  Specimen,
  specimensOf,
  TransformTween,
  Tray,
  TrayIntent,
  TrayPress,
  trayEntity,
  trayOpen,
  Viewport,
  widgets,
  defineQuery,
  type Entity,
  type TrayScreenFrame,
  type WidgetType,
} from "../src";

// One widget type per FILE (global registry; no test reset).
const NOTE: WidgetType = widgets.get("take:note") ?? defineWidget({
  type: "take:note", object: { name: "note" }, defaultSize: { w: 100, h: 100 },
  props: { word: p.string({ default: "" }) },
  // the face shows a word; one taken is blank (no `take`: the widget's defaults)
  tray: { label: "Note", props: { word: "hi" }, category: "a", order: 0, hang: { w: 120, h: 120, accessory: "hook", pegs: [[-1, -0.5], [1, -0.5]] } },
});
const CARD: WidgetType = widgets.get("take:card") ?? defineWidget({
  type: "take:card", object: { name: "card" }, defaultSize: { w: 200, h: 100 },
  props: { tint: p.string({ default: "plain" }) },
  // wider than its hang (the fit leaves a band above and below); one taken carries its face
  tray: { label: "Card", props: { tint: "red" }, take: "face", category: "a", order: 1, hang: { w: 120, h: 120, accessory: "hook", pegs: [[-1, -0.5], [1, -0.5]] } },
});
const PRINT: WidgetType = widgets.get("take:print") ?? defineWidget({
  type: "take:print", object: { name: "print" }, defaultSize: { w: 150, h: 100 },
  // not core-movable — its carry is its own (the photo's physics)
  interaction: { selectable: true, movable: false },
  tray: { label: "Print", category: "a", order: 2, hang: { w: 80, h: 80, accessory: "clip", pegs: [[0, -0.5]] } },
});

const BOX: WidgetType = widgets.get("take:box") ?? defineWidget({
  type: "take:box", defaultSize: { w: 200, h: 200 }, interaction: { selectable: true, movable: false },
  container: { accepts: ["take:nothing"] },
});

const VP = { w: 800, h: 600, dpr: 1 };
const ghostQ = defineQuery([InsertGhost]);

function rig() {
  const ce = createCanvasEngine({ widgets: [NOTE, CARD, PRINT, BOX] });
  ce.docs.create();
  ce.world.setResource(Viewport, VP);
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false }); // screen == world
  let now = 1000;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  // what the renderer would publish: the drawer 720 × 252 open (its top at 348), its 12 px lip closed
  const shown = (): number => { const e = trayEntity(ce.world); return e === undefined ? 0 : ce.world.read(e, Tray).scroll; };
  // …or, pinned, the drawer as it is drawn mid-slide (the renderer's word lags the fact by the slide)
  let pinned: TrayScreenFrame | null = null;
  const frame = (): TrayScreenFrame => pinned ?? (trayOpen(ce.world) ? { x: 40, y: 348, w: 720, h: 252, p: 1, max: 400, pitch: 40, scroll: shown() } : { x: 40, y: 588, w: 720, h: 252, p: 0, max: 400, pitch: 40, scroll: shown() });
  ce.stack.trayPose.current = { frame };
  const mouse = (kind: "down" | "move" | "up", x: number, y: number, buttons: number): void => {
    ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: NO_MODS });
    step();
  };
  const tray = () => { const e = trayEntity(ce.world); if (e === undefined) throw new Error("no tray"); return ce.world.read(e, Tray); };
  step(3);
  openTray(ce.world);
  step(2);
  /** A specimen's object as the board draws it, on screen (the drawer open, scrolled `shown()`). */
  const specimen = (type: string) => {
    const e = specimensOf(ce.world, trayEntity(ce.world) as Entity).find((s) => ce.world.read(s, PrefabId).id === type);
    if (e === undefined) throw new Error(`no ${type} specimen`);
    const at = ce.world.read(e, Position);
    const size = ce.world.read(e, Size);
    const t = widgets.get(type) as WidgetType;
    const fit = specimenFit({ x: at.x, y: at.y, w: size.w, h: size.h }, t.defaultSize);
    const f = frame();
    return { entity: e, x: f.x + fit.x, y: f.y + fit.y - f.scroll, w: fit.w, h: fit.h };
  };
  const ghosts = (): Entity[] => { const out: Entity[] = []; ce.world.query(ghostQ).each((b) => { for (const r of b) out.push(b.entity(r)); }); return out; };
  const twins = (type: string): Entity[] => {
    const out: Entity[] = [];
    ce.world.query(defineQuery([PrefabId, Position])).each((b) => { for (const r of b) { const e = b.entity(r); if (ce.world.read(e, PrefabId).id === type && !ce.world.has(e, InsertGhost) && !ce.world.hasTag(e, Specimen)) out.push(e); } });
    return out;
  };
  const readPress = (e: Entity) => ce.world.read(e, TrayPress);
  const press = () => { let got: ReturnType<typeof readPress> | undefined; ce.world.query(defineQuery([TrayPress])).each((b) => { for (const r of b) got = readPress(b.entity(r)); }); return got; };
  /** Press on a specimen at (u, v) across its object and lift the copy (6 px). */
  const lift = (type: string, u = 0.25, v = 0.5) => {
    const s = specimen(type);
    const x = s.x + u * s.w;
    const y = s.y + v * s.h;
    mouse("move", x, y, 0);
    mouse("down", x, y, 1);
    mouse("move", x + 6, y, 1);
    return { s, x: x + 6, y };
  };
  return { ce, world: ce.world, step, mouse, tray, specimen, ghosts, twins, press, lift, frame, pin: (f: TrayScreenFrame | null) => { pinned = f; } };
}

describe("taking one (design-017 §9)", () => {
  it("a press on a specimen, past the slop, lifts its copy — the grab point across the object as drawn, the pointer; the specimen stays hung, the board still", () => {
    const r = rig();
    const s = r.specimen("take:card");
    const x = s.x + 0.25 * s.w;
    const y = s.y + 0.75 * s.h;
    r.mouse("move", x, y, 0);
    r.mouse("down", x, y, 1);
    expect(r.press()).toMatchObject({ kind: "specimen", type: "take:card", moved: false });
    expect(r.press()?.u).toBeCloseTo(0.25, 9);
    expect(r.press()?.v).toBeCloseTo(0.75, 9);   // across the drawn object (120 × 60 in a 120 × 120 hang), not the hang's rect
    expect(r.press()?.homeX).toBeCloseTo(s.x + s.w / 2, 9);
    expect(r.press()?.homeY).toBeCloseTo(s.y + s.h / 2, 9);
    r.mouse("move", x + 2, y + 2, 1);
    expect(r.tray().take).toBe("");   // within the slop: nothing lifted yet
    r.mouse("move", x + 9, y - 30, 1);
    const t = r.tray();
    expect(t.take).toBe("take:card");
    expect([t.takeU, t.takeV, t.takeX, t.takeY]).toEqual([r.press()?.u, r.press()?.v, x + 9, y - 30]);
    expect(t.open).toBe(true);
    expect(t.scroll).toBe(0);   // a press on a specimen never scrolls the board (control below: the bare board does)
    expect(t.handed).toBe(0);
    expect(r.ghosts()).toEqual([]);   // the copy is flux: nothing in the world yet
    expect(r.world.isAlive(s.entity)).toBe(true);
    // control: a drag on the bare board (below the specimens) scrolls it
    r.mouse("up", x + 9, y - 30, 0);
    const bare = { x: 700, y: 560 };
    r.mouse("move", bare.x, bare.y, 0);
    r.mouse("down", bare.x, bare.y, 1);
    r.mouse("move", bare.x, bare.y - 40, 1);
    expect(r.tray().scroll).toBe(40);
    r.mouse("up", bare.x, bare.y - 40, 0);
  });

  it("out of the drawer it is HANDED: the drawer shuts, `handed` bumps, the ghost spawns under the same grab point; the drop is ONE create, selected, one undo step", () => {
    const r = rig();
    const { s, x, y } = r.lift("take:card", 0.25, 0.5);
    expect(r.tray().take).toBe("take:card");
    // up and out of the drawer's top (348): the hand-off tick
    r.mouse("move", x, 300, 1);
    const t = r.tray();
    // that tick the take still names what was handed, and where (the renderer's ghost grows out of it); the tick after, it is clear
    expect([t.open, t.take, t.handed, t.takeX, t.takeY]).toEqual([false, "take:card", 1, x, 300]);
    const intent = r.world.getResource(TrayIntent);
    expect(intent).toMatchObject({ type: "take:card", x, y: 300, pointerId: "mouse", device: "mouse", buttons: 1, epoch: 1 });
    expect(intent?.homeX).toBeCloseTo(s.x + s.w / 2, 9);
    expect(r.press()?.kind).toBe("carry");
    // after the step: the ghost, its grab point under the pointer (the card is 200 × 100: 0.25 · 200 = 50, 0.5 · 100 = 50)
    const [ghost] = r.ghosts();
    r.step();
    expect(r.tray().take).toBe("");
    expect(ghost).toBeDefined();
    const g = ghost as Entity;
    expect(r.world.read(g, Position)).toEqual({ x: x - 50, y: 300 - 50 });
    expect(r.world.read(g, InsertGhost)).toMatchObject({ type: "take:card", props: JSON.stringify({ tint: "red" }) });   // `take: "face"`
    expect(r.world.read(g, InsertGhost).screenX).toBeCloseTo(s.x + s.w / 2, 3);
    // the ordinary drag: the synthetic down claims it, the pointer carries it by the same spot
    r.mouse("move", x + 40, 250, 1);    // the synthetic down is ingested with this move (the down point is the down's)
    r.mouse("move", x + 100, 200, 1);   // the claim
    expect(r.world.has(g, Grab)).toBe(true);
    r.mouse("move", x + 100, 200, 1);
    expect(r.world.read(g, Position)).toEqual({ x: x + 100 - 50, y: 200 - 50 });
    r.mouse("up", x + 100, 200, 0);
    r.step(3);
    expect(r.world.isAlive(g)).toBe(false);
    const made = r.twins("take:card");
    expect(made).toHaveLength(1);
    const twin = made[0] as Entity;
    expect(r.world.read(twin, Position)).toEqual({ x: x + 50, y: 150 });
    expect(r.world.hasTag(twin, Selected)).toBe(true);
    const props = CARD.groups.find((q) => q.name === "props")?.component;
    expect((r.world.get(twin, props as never) as { tint?: string } | undefined)?.tint).toBe("red");
    expect(r.press()).toBeUndefined();
    // ONE undo step: undo removes it, redo restores it, and there was nothing before it
    expect(r.ce.docs.undo()).toBe(true);
    r.step(2);
    expect(r.twins("take:card")).toHaveLength(0);
    expect(r.ce.docs.undo()).toBe(false);
    expect(r.ce.docs.redo()).toBe(true);
    r.step(2);
    expect(r.twins("take:card")).toHaveLength(1);
  });

  it("one taken is made with the entry's `take`: none — the widget's defaults (the face's word stays on the board)", () => {
    const r = rig();
    const { x } = r.lift("take:note", 0.5, 0.5);
    r.mouse("move", x, 300, 1);
    const g = r.ghosts()[0] as Entity;
    expect(r.world.read(g, InsertGhost).props).toBe("{}");
    r.mouse("move", x + 30, 250, 1);
    r.mouse("move", x + 60, 200, 1);
    r.mouse("up", x + 60, 200, 0);
    r.step(3);
    const twin = r.twins("take:note")[0] as Entity;
    const props = NOTE.groups.find((q) => q.name === "props")?.component;
    expect((r.world.get(twin, props as never) as { word?: string } | undefined)?.word).toBe("");
    // the specimen still shows its face
    const spec = r.specimen("take:note").entity;
    expect((r.world.get(spec, props as never) as { word?: string } | undefined)?.word).toBe("hi");
  });

  it("handed through the finger notch while the drawer is still drawn sliding away: the ghost's synthetic down is the ghost's, never the lip's", () => {
    const r = rig();
    r.lift("take:note", 0.5, 0.5);
    // out through the top edge at the drawer's centre (400), 3 px above it — where the lip's handle and its pad will be as it slides
    r.mouse("move", 400, 345, 1);
    expect(r.tray().handed).toBe(1);
    r.pin({ x: 40, y: 352, w: 720, h: 252, p: 0.98, max: 400, pitch: 40, scroll: 0 });   // the renderer's drawer, a frame into its slide
    const g = r.ghosts()[0] as Entity;
    r.mouse("move", 410, 330, 1);   // the synthetic down lands on the handle (|400 − 400| ≤ 60, 345 ≥ 352 − 8)
    r.mouse("move", 420, 300, 1);
    r.mouse("move", 430, 280, 1);
    expect(r.world.has(g, Grab)).toBe(true);
    expect(r.world.read(g, Position)).toEqual({ x: 430 - 50, y: 280 - 50 });
    expect(r.tray().open).toBe(false);   // …and no lip press opened the drawer again
    r.pin(null);
    r.mouse("up", 430, 280, 0);
    r.step(3);
    expect(r.twins("take:note")).toHaveLength(1);
  });

  it("released inside the drawer, the take is put back: no ghost, no hand-off, nothing in undo", () => {
    const r = rig();
    const { x, y } = r.lift("take:note");
    r.mouse("move", x + 80, y - 20, 1);   // still inside the drawer
    expect(r.tray().take).toBe("take:note");
    r.mouse("up", x + 80, y - 20, 0);
    r.step(2);
    const t = r.tray();
    expect([t.open, t.take, t.handed]).toEqual([true, "", 0]);
    expect(r.ghosts()).toEqual([]);
    expect(r.press()).toBeUndefined();
    expect(r.world.getResource(TrayIntent)?.epoch ?? 0).toBe(0);
    expect(r.ce.docs.undo()).toBe(false);
  });

  it("the drawer shut under a take (Esc's way: `closeTray`) puts it back — and the pointer is not the lip's", () => {
    const r = rig();
    const { x, y } = r.lift("take:note");
    closeTray(r.world);
    r.mouse("move", x + 3, y, 1);
    const t = r.tray();
    expect([t.open, t.take, t.handed]).toEqual([false, "", 0]);
    expect(r.press()).toBeUndefined();
    r.mouse("up", x + 3, y, 0);
    r.step(2);
    expect(r.ghosts()).toEqual([]);
    expect(r.twins("take:note")).toEqual([]);
    expect(r.ce.docs.undo()).toBe(false);
  });

  it("released back over the drawer AS DRAWN — still sliding away — the gesture is cancelled: the ghost flies home to the specimen's spot and nothing enters undo", () => {
    const r = rig();
    const { s, x } = r.lift("take:note", 0.5, 0.5);
    r.mouse("move", x, 300, 1);                     // handed: the drawer shuts
    const g = r.ghosts()[0] as Entity;
    r.mouse("move", x + 20, 280, 1);
    r.mouse("move", x + 40, 250, 1);
    expect(r.world.has(g, Grab)).toBe(true);
    r.pin({ x: 40, y: 468, w: 720, h: 252, p: 0.5, max: 400, pitch: 40, scroll: 0 });   // the renderer's drawer, half way down its slide
    r.mouse("move", x + 40, 500, 1);                // back down over the drawer where it is drawn
    expect(trayOpen(r.world)).toBe(false);          // (the fact is shut: the pixels lag it by the slide)
    r.mouse("up", x + 40, 500, 0);
    r.pin(null);
    expect(r.world.hasTag(g, GhostRetiring)).toBe(true);
    const tw = r.world.read(g, TransformTween);
    // it flies so its centre lands on the specimen's (the ghost is 100 × 100)
    expect(tw.toX + 50).toBeCloseTo(s.x + s.w / 2, 3);
    expect(tw.toY + 50).toBeCloseTo(s.y + s.h / 2, 3);
    r.step(40);
    expect(r.world.isAlive(g)).toBe(false);
    expect(r.twins("take:note")).toEqual([]);
    expect(r.ce.docs.undo()).toBe(false);
    expect(r.press()).toBeUndefined();
  });

  it("once the drawer has slid shut, a release where it stood open lands the take — that rect is the desk's again (K9 S2); so is the lip's strip beside the notch (D-K9-c.1)", () => {
    const r = rig();
    const { x } = r.lift("take:note", 0.5, 0.5);
    r.mouse("move", x, 300, 1);                     // handed: the drawer shuts, and the renderer's word is that it has (p 0)
    r.mouse("move", x + 20, 380, 1);
    r.mouse("move", x + 40, 450, 1);                // inside the rect the drawer stood open in (its top 348)
    expect(r.frame().p).toBe(0);
    r.mouse("up", x + 40, 450, 0);
    r.step(3);
    const made = r.twins("take:note");
    expect(made).toHaveLength(1);
    expect(r.world.hasTag(made[0] as Entity, Selected)).toBe(true);
    expect(r.ce.docs.undo()).toBe(true);
    r.step(2);
    expect(r.twins("take:note")).toEqual([]);
    // …and on the strip the shut drawer still shows at the view's foot (its 12 px lip, 588 … 600), beside the notch
    openTray(r.world); r.step(2);
    const again = r.lift("take:note", 0.5, 0.5);
    r.mouse("move", again.x, 300, 1);
    r.mouse("move", 200, 500, 1);
    r.mouse("move", 200, 595, 1);
    r.mouse("up", 200, 595, 0);
    r.step(3);
    expect(r.twins("take:note")).toHaveLength(1);
    expect(r.ce.docs.undo()).toBe(true);
  });

  it("control: the same release above the drawer's open rect lands it", () => {
    const r = rig();
    const { x } = r.lift("take:note", 0.5, 0.5);
    r.mouse("move", x, 300, 1);
    r.mouse("move", x + 20, 330, 1);
    r.mouse("move", x + 40, 340, 1);                // 8 px above the open top (348)
    r.mouse("up", x + 40, 340, 0);
    r.step(3);
    expect(r.twins("take:note")).toHaveLength(1);
    expect(r.ce.docs.undo()).toBe(true);
  });

  it("Esc mid-drag after the hand-off (the gestures' cancel): the ghost flies home, nothing enters undo", () => {
    const r = rig();
    const { x } = r.lift("take:note", 0.5, 0.5);
    r.mouse("move", x, 300, 1);
    const g = r.ghosts()[0] as Entity;
    r.mouse("move", x + 30, 250, 1);
    r.mouse("move", x + 60, 200, 1);
    r.ce.ops.cancelActiveGestures();
    r.step();
    expect(r.world.hasTag(g, GhostRetiring)).toBe(true);
    r.mouse("up", x + 60, 200, 0);
    r.step(40);
    expect(r.world.isAlive(g)).toBe(false);
    expect(r.twins("take:note")).toEqual([]);
    expect(r.ce.docs.undo()).toBe(false);
  });

  it("a kind that is not core-movable (a print: its carry is its own) is taken all the same — the ghost moves by the ordinary drag, the one made is still not core-movable", () => {
    const r = rig();
    const { x } = r.lift("take:print", 0.5, 0.5);
    r.mouse("move", x, 300, 1);
    const g = r.ghosts()[0] as Entity;
    expect(r.world.hasTag(g, Movable)).toBe(true);
    r.mouse("move", x + 30, 250, 1);
    r.mouse("move", x + 60, 200, 1);
    r.mouse("move", x + 60, 200, 1);
    expect(r.world.read(g, Position)).toEqual({ x: x + 60 - 75, y: 200 - 50 });
    r.mouse("up", x + 60, 200, 0);
    r.step(3);
    const made = r.twins("take:print");
    expect(made).toHaveLength(1);
    expect(r.world.hasTag(made[0] as Entity, Movable)).toBe(false);
  });

  it("a refused hand-off (a frame that takes no such kind) spawns nothing: the drawer shut, no ghost, the reason said, nothing in undo", () => {
    const r = rig();
    const box = r.ce.ops.spawnWidget("take:box", { x: 100, y: 60, undoable: false });
    r.world.sync();
    r.step(2);
    r.ce.ops.enterContainer(box, { transition: "none" });
    r.step(3);
    openTray(r.world);
    r.step(2);
    const { x } = r.lift("take:note", 0.5, 0.5);
    const warn = console.warn;
    const said: unknown[] = [];
    console.warn = (...a: unknown[]) => { said.push(a); };
    try { r.mouse("move", x, 300, 1); } finally { console.warn = warn; }
    expect(r.tray().handed).toBe(1);
    expect(r.ghosts()).toEqual([]);
    expect(said.length).toBe(1);
    r.mouse("up", x, 300, 0);
    r.step(2);
    expect(r.twins("take:note")).toEqual([]);
    expect(r.press()).toBeUndefined();
    expect(r.ce.docs.undo()).toBe(false);
  });
});
