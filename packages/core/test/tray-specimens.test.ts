// @vitest-environment node
// THE SPECIMENS (design-017 §8; K5a): the tray entity roots a runtime canvas whose members are the kinds that declared a tray entry —
// the catalog's, a plugin's by its entry alone — each a runtime entity `ChildOf` it: `PrefabId` its type, `Position`/`Size` where the
// lattice law lays it across the drawer the renderer drew (the pose seam), its entry's props over the widget's defaults, `Specimen`.
// Never Active (the desk's stack never picks, selects or culls one), never durable; re-laid on a width change, laid afresh after a
// reset. Open, the mouse over one is `Tray.hover` — the hover that lifts it. design-018 §6 (R2): THE FILTER — the view's category
// ("" all) lays only its entries, a change zeroes the scroll and the band, one the frame hangs none of falls back to all, and the
// categories the frame hangs are listed in the lay's order. Petition I54: THE SET (`setTrayOnly`) lays only its types across their
// categories and wins over the category; THE HIDDEN (`setTrayHidden`) hang nothing while their objects on the desk stay whole.
// Through the REAL stack; the pose is the renderer's word.
import { describe, expect, it } from "vitest";
import { layTray, trayScrollMax } from "@ice/kernel";
import {
  Active,
  Camera,
  createCanvasEngine,
  defineWidget,
  FrameInfo,
  openTray,
  scrollTray,
  setTrayCategory,
  setTrayHidden,
  setTrayOnly,
  trayCategories,
  trayCategory,
  trayEntryCount,
  trayHidden,
  trayHung,
  trayOnly,
  p,
  Position,
  Selectable,
  Selected,
  Size,
  Specimen,
  specimensOf,
  Tray,
  TrayContent,
  TrayIntent,
  trayEntity,
  trayOpen,
  PrefabId,
  Viewport,
  widgets,
  NO_MODS,
  type TrayScreenFrame,
  type WidgetType,
} from "../src";

// One widget type per FILE (global registry; no test reset). The PLUGIN kind is declared here — no engine list names it.
const hangOf = (t: WidgetType) => { if (t.tray === undefined) throw new Error(`${t.type} hangs nothing`); return t.tray.hang; };
const PAD: WidgetType = widgets.get("spec:pad") ?? defineWidget({
  type: "spec:pad", object: { name: "pad" }, defaultSize: { w: 200, h: 200 },
  props: { tint: p.string({ default: "yellow" }), seed: p.number({ default: 0 }) },
  tray: { label: "Pad", props: { seed: 7 }, category: "paper", order: 0, hang: { w: 120, h: 120, accessory: "hook", pegs: [[-1, -0.5], [1, -0.5]] } },
});
const PLUGIN: WidgetType = widgets.get("plugin:swatch") ?? defineWidget({
  type: "plugin:swatch", object: { name: "swatch" }, defaultSize: { w: 100, h: 100 },
  tray: { label: "Swatch", category: "plugin", hang: { w: 80, h: 80, accessory: "clip", pegs: [[0, -0.5]] } },
});
const PLAIN: WidgetType = widgets.get("spec:plain") ?? defineWidget({ type: "spec:plain", object: { name: "plain" }, defaultSize: { w: 100, h: 100 } });
// design-018 §6: a second paper kind, and an entry that names no category (laid under all alone — no chip)
const CARD: WidgetType = widgets.get("spec:card") ?? defineWidget({
  type: "spec:card", object: { name: "card" }, defaultSize: { w: 100, h: 100 },
  tray: { label: "Card", category: "paper", order: 1, hang: { w: 80, h: 80, accessory: "clip", pegs: [[0, -0.5]] } },
});
const LOOSE: WidgetType = widgets.get("spec:loose") ?? defineWidget({
  type: "spec:loose", object: { name: "loose" }, defaultSize: { w: 100, h: 100 },
  tray: { label: "Loose", hang: { w: 80, h: 80, accessory: "clip", pegs: [[0, -0.5]] } },
});
// a container that takes the swatch alone (K9 S13): inside it the pad's specimen has nothing to offer
const BIN: WidgetType = widgets.get("spec:bin") ?? defineWidget({
  type: "spec:bin", object: { name: "bin" }, defaultSize: { w: 300, h: 200 },
  container: { accepts: [], widgets: [PLUGIN], portal: { top: 20, right: 20, bottom: 20, left: 20 } },
});

const VP = { w: 800, h: 600, dpr: 1 };

function rig(widths: { w: number; face?: number; foot?: number } = { w: 720 }, extra: readonly WidgetType[] = []) {
  const ce = createCanvasEngine({ widgets: [PAD, PLUGIN, PLAIN, BIN, ...extra] });
  ce.docs.create();
  ce.world.setResource(Viewport, VP);
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  const plain = ce.ops.spawnWidget("spec:plain", { x: 100, y: 100, undoable: false });
  let now = 1000;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  const shown = (): number => { const e = trayEntity(ce.world); return e === undefined ? 0 : ce.world.read(e, Tray).scroll; };
  const frame = (): TrayScreenFrame => ({ x: 40, y: trayOpen(ce.world) ? 348 : 588, w: widths.w, h: 252, p: trayOpen(ce.world) ? 1 : 0, max: 0, pitch: 40, scroll: shown(), ...(widths.face !== undefined ? { face: widths.face } : {}), ...(widths.foot !== undefined ? { foot: widths.foot } : {}) });
  const tray = () => { const e = trayEntity(ce.world); if (e === undefined) throw new Error("no tray"); return e; };
  const specimens = () => specimensOf(ce.world, tray());
  const byType = () => Object.fromEntries(specimens().map((e) => [ce.world.read(e, PrefabId).id, e]));
  const mouse = (x: number, y: number): void => { ce.stack.queue.enqueue({ kind: "move", pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons: 0, mods: NO_MODS }); step(); };
  return { ce, world: ce.world, step, frame, tray, specimens, byType, mouse, plain, pose: (on: boolean) => { ce.stack.trayPose.current = on ? { frame } : null; } };
}

describe("the tray's specimens", () => {
  it("are laid once the renderer says how wide the drawer is: the kinds with an entry, a plugin's by its entry alone", () => {
    const r = rig();
    r.step(3);
    expect(r.specimens()).toEqual([]);   // no pose, no lay
    r.pose(true);
    r.step(2);
    const got = r.byType();
    expect(Object.keys(got).sort()).toEqual(["plugin:swatch", "spec:pad"]);
    const laid = layTray([{ type: "spec:pad", hang: hangOf(PAD), category: "paper", order: 0 }, { type: "plugin:swatch", hang: hangOf(PLUGIN), category: "plugin" }], 720, 40);
    for (const q of laid.placed) {
      const e = got[q.type] as number;
      expect(r.world.read(e as never, Position)).toEqual({ x: q.x, y: q.y });
      expect(r.world.read(e as never, Size)).toEqual({ w: q.w, h: q.h });
      expect(r.world.hasTag(e as never, Specimen)).toBe(true);
    }
    const c = r.world.read(r.tray(), TrayContent);
    // design-018 §6: what it could hang; petition I37: what it laid, in its order (what the keyboard focus walks)
    expect(c).toEqual({ width: 720, bottom: laid.bottom, laid: 1, present: JSON.stringify([["paper", 1], ["plugin", 1]]), order: JSON.stringify(laid.placed.map((q) => q.type)) });
    // the entry's props over the widget's defaults
    const group = PAD.groups[0]?.component;
    if (group === undefined) throw new Error("the pad has no group");
    expect(r.world.get(got["spec:pad"] as never, group)).toEqual({ tint: "yellow", seed: 7 });
  });

  it("are never Active, never selected, never durable", () => {
    const r = rig();
    r.pose(true);
    r.step(6);
    const all = r.specimens();
    expect(all.length).toBe(2);
    for (const e of all) expect(r.world.hasTag(e, Active)).toBe(false);
    for (const e of all) expect(r.world.hasTag(e, Selectable)).toBe(false);   // spawned equipped: nothing stamps it
    expect(r.world.hasTag(r.plain, Active)).toBe(true);   // the control: a desk object is
    r.ce.ops.selectAll();
    r.step(2);
    for (const e of all) expect(r.world.hasTag(e, Selected)).toBe(false);
    expect(r.world.hasTag(r.plain, Selected)).toBe(true);
    const store = r.ce.docs.current()?.store;
    for (const e of all) expect(store?.keyOf(e)).toBeUndefined();
    expect(store?.keyOf(r.plain)).toBeDefined();
  });

  it("are re-laid when the drawer's width changes — the same entities — and laid afresh after a reset", () => {
    const widths = { w: 720 };
    const r = rig(widths);
    r.pose(true);
    r.step(2);
    const before = r.byType();
    const x0 = r.world.read(before["plugin:swatch"] as never, Position).x;
    r.step(4);
    expect(r.world.read(r.tray(), TrayContent).laid).toBe(1);   // at rest, never re-laid
    widths.w = 200;   // too narrow for both on one line
    r.step(2);
    const after = r.byType();
    expect(after).toEqual(before);
    expect(r.world.read(after["plugin:swatch"] as never, Position).x).not.toBe(x0);
    expect(r.world.read(r.tray(), TrayContent)).toMatchObject({ width: 200, laid: 2 });
    // a document switch resets the world: a new tray, laid again
    r.ce.docs.create();
    r.world.setResource(Viewport, VP);
    r.step(3);
    expect(Object.keys(r.byType()).sort()).toEqual(["plugin:swatch", "spec:pad"]);
    for (const e of r.specimens()) expect(r.world.hasTag(e, Active)).toBe(false);
  });

  it("the mouse over one while the drawer is out is its hover; off it, or closed, none", () => {
    const r = rig();
    r.pose(true);
    r.step(2);
    openTray(r.world);
    r.step(2);
    const pad = r.byType()["spec:pad"] as number;
    const at = r.world.read(pad as never, Position);
    const size = r.world.read(pad as never, Size);
    const sx = 40 + at.x + size.w / 2;
    const sy = 348 + at.y + size.h / 2;
    r.mouse(sx, sy);
    expect(r.world.read(r.tray(), Tray).hover).toBe("spec:pad");
    r.mouse(40 + 700, 348 + 240);   // the board, no specimen
    expect(r.world.read(r.tray(), Tray).hover).toBe("");
    r.mouse(sx, sy);
    expect(r.world.read(r.tray(), Tray).hover).toBe("spec:pad");
    // scrolled by 30: the same screen point is 30 px further down the board
    r.ce.world.edit(r.tray()).set(Tray, { ...r.world.read(r.tray(), Tray), scroll: size.h });
    r.mouse(sx, sy - size.h / 2 - 5);
    expect(r.world.read(r.tray(), Tray).hover).toBe("spec:pad");
    r.mouse(sx, sy + 5);   // below it now
    expect(r.world.read(r.tray(), Tray).hover).toBe("");
    r.mouse(sx, sy - size.h / 2 - 5);
    expect(r.world.read(r.tray(), Tray).hover).toBe("spec:pad");
    // closed: no hover
    r.ce.world.edit(r.tray()).set(Tray, { ...r.world.read(r.tray(), Tray), open: false });
    r.step(2);
    expect(r.world.read(r.tray(), Tray).hover).toBe("");
  });

  it("a range that moves under the scroll — a re-lay, the drawer's face — clamps it to the new end at rest; a band's pull is judged once it lets go; the rig's door takes any value until the range next moves (K9 S10)", () => {
    const view = { w: 280, face: 147 };   // at 280 the two kinds hang on two lines (foot 410), at 720 on one (foot 250) — the first line 2 pitches down (design-018 R4)
    const r = rig(view);
    r.pose(true);
    r.step(2);
    const t = () => r.world.read(r.tray(), Tray);
    const range = () => trayScrollMax(r.world.read(r.tray(), TrayContent).bottom, view.face, 40);
    expect(range()).toBe(410 + 40 - 147);
    scrollTray(r.world, range()); r.step(2);
    expect(t().scroll).toBe(303);
    view.w = 720; r.step(2);                        // the window widens — one line: the range falls under the scroll
    expect(range()).toBe(250 + 40 - 147);
    expect(t().scroll).toBe(143);
    scrollTray(r.world, 1e6 * 40); r.step(3);       // the door (rig:tray's 10⁶ rows): no range moved, nothing clamps it
    expect(t().scroll).toBe(1e6 * 40);
    view.face += 50; r.step(2);                     // the view grows taller, its face with it: the range moves — clamped
    expect(t().scroll).toBe(250 + 40 - 197);
    // pulled past the end (the band's), the range moves under it: left be — and clamped once the pull lets go
    r.ce.world.edit(r.tray()).set(Tray, { ...t(), scroll: 93, stretch: 30 });
    view.face += 20; r.step(2);
    expect([t().scroll, t().stretch]).toEqual([93, 30]);
    r.ce.world.edit(r.tray()).set(Tray, { ...t(), stretch: 0 });
    r.step(2);
    expect(t().scroll).toBe(250 + 40 - 217);
    // a face the renderer does not report clamps nothing (the range is its word)
    const bare = rig({ w: 720 });
    bare.pose(true); bare.step(2);
    scrollTray(bare.world, 5000); bare.step(3);
    expect(bare.world.read(bare.tray(), Tray).scroll).toBe(5000);
  });

  it("petition I21: a host's FOOT inset grows the range by itself — the content's foot plus a pitch less the face above the foot — and a foot that moves (a mount) clamps as the face does", () => {
    const view = { w: 720, face: 147, foot: 60 };   // one line (foot 250) at 720
    const r = rig(view);
    r.pose(true);
    r.step(2);
    const t = () => r.world.read(r.tray(), Tray);
    const bottom = () => r.world.read(r.tray(), TrayContent).bottom;
    expect(bottom()).toBe(250);
    scrollTray(r.world, 1e4); r.step(3);           // the door: no range moved, nothing clamps it
    view.face += 50; r.step(2);                     // the face moves: clamped to the range ABOVE the foot
    expect(t().scroll).toBe(250 + 40 - (197 - 60));
    scrollTray(r.world, 1e4); r.step(3);
    view.foot = 0; r.step(2);                       // the foot gone: the range shrinks by it — clamped
    expect(t().scroll).toBe(250 + 40 - 197);
  });

  it("hang what the CURRENT frame takes (K9 S13): inside a container that refuses a kind its specimen is not on the board — the placement authority's word — and back at the root it hangs again", () => {
    const r = rig();
    const bin = r.ce.ops.spawnWidget("spec:bin", { x: 300, y: 300, undoable: false });
    r.pose(true);
    r.step(2);
    expect(Object.keys(r.byType()).sort()).toEqual(["plugin:swatch", "spec:pad"]);
    r.ce.ops.enterContainer(bin, { transition: "none" });
    r.step(3);
    expect(r.ce.placement.canIngress("spec:pad", bin).ok).toBe(false);          // what a take's commit in here would be told
    expect(r.ce.placement.canIngress("plugin:swatch", bin).ok).toBe(true);
    expect(Object.keys(r.byType())).toEqual(["plugin:swatch"]);
    // laid by the lattice law over what hangs here: the swatch alone, first on the board
    const alone = layTray([{ type: "plugin:swatch", hang: hangOf(PLUGIN), category: "plugin" }], 720, 40).placed[0];
    expect(r.world.read(r.byType()["plugin:swatch"] as never, Position)).toEqual({ x: alone?.x, y: alone?.y });
    r.ce.ops.exitContainer({ transition: "none" });
    r.step(3);
    expect(Object.keys(r.byType()).sort()).toEqual(["plugin:swatch", "spec:pad"]);
  });
});

describe("the filter (design-018 §6)", () => {
  const law = (types: readonly WidgetType[]) => layTray(types.map((t) => ({ type: t.type, hang: hangOf(t), ...(t.tray?.category !== undefined ? { category: t.tray.category } : {}), ...(t.tray?.order !== undefined ? { order: t.tray.order } : {}) })), 720, 40).placed;

  it("is the view's category — all (\"\") at install, set by its op, all again after a document switch — a runtime fact", () => {
    const r = rig();
    expect(r.world.read(r.tray(), Tray).category).toBe("");
    setTrayCategory(r.world, "plugin");
    expect(trayCategory(r.world)).toBe("plugin");
    expect(r.ce.docs.current()?.store.keyOf(r.tray())).toBeUndefined();
    r.ce.docs.create();
    r.world.setResource(Viewport, VP);
    r.step(2);
    expect(trayCategory(r.world)).toBe("");
  });

  it("lists the categories the frame hangs in the lay's order — each its label and count — from the first lay on; an entry naming none is counted but has no chip", () => {
    const r = rig({ w: 720 }, [CARD, LOOSE]);
    r.step(2);
    expect([trayCategories(r.world), trayEntryCount(r.world)]).toEqual([[], 0]);   // no pose, no lay: nothing to offer yet
    r.pose(true);
    r.step(2);
    expect(trayCategories(r.world)).toEqual([{ id: "paper", label: "Paper", count: 2 }, { id: "plugin", label: "Plugin", count: 1 }]);
    expect(trayEntryCount(r.world)).toBe(4);
    setTrayCategory(r.world, "plugin");
    r.step(2);
    expect(Object.keys(r.byType())).toEqual(["plugin:swatch"]);
    expect(trayCategories(r.world).map((c) => c.id)).toEqual(["paper", "plugin"]);   // what the frame hangs, not what is shown
    expect(trayEntryCount(r.world)).toBe(4);
  });

  it("lays only the chosen category's entries where the law lays them alone — the others' specimens gone — and all again on \"\"; each change zeroes the scroll and the band, the same category again changes nothing", () => {
    const r = rig({ w: 720 }, [CARD]);
    r.pose(true);
    r.step(2);
    const t = () => r.world.read(r.tray(), Tray);
    const at = (type: string) => { const e = r.byType()[type]; return e === undefined ? undefined : { ...r.world.read(e as never, Position), ...r.world.read(e as never, Size) }; };
    const laid = () => r.world.read(r.tray(), TrayContent).laid;
    expect(Object.keys(r.byType()).sort()).toEqual(["plugin:swatch", "spec:card", "spec:pad"]);
    r.ce.world.edit(r.tray()).set(Tray, { ...t(), scroll: 77, stretch: 12 });
    setTrayCategory(r.world, "paper");
    r.step(2);
    expect(Object.keys(r.byType()).sort()).toEqual(["spec:card", "spec:pad"]);
    for (const q of law([PAD, CARD])) expect(at(q.type), q.type).toEqual({ x: q.x, y: q.y, w: q.w, h: q.h });
    expect([t().category, t().scroll, t().stretch]).toEqual(["paper", 0, 0]);
    r.ce.world.edit(r.tray()).set(Tray, { ...t(), scroll: 30 });
    const n = laid();
    setTrayCategory(r.world, "paper");   // the same: no re-lay, the scroll kept
    r.step(2);
    expect([laid(), t().scroll]).toEqual([n, 30]);
    setTrayCategory(r.world, "plugin");
    r.step(2);
    expect(Object.keys(r.byType())).toEqual(["plugin:swatch"]);
    const alone = law([PLUGIN])[0];
    expect(at("plugin:swatch")).toEqual({ x: alone?.x, y: alone?.y, w: alone?.w, h: alone?.h });
    expect(t().scroll).toBe(0);
    r.ce.world.edit(r.tray()).set(Tray, { ...t(), scroll: 40 });
    setTrayCategory(r.world, "");
    r.step(2);
    expect(Object.keys(r.byType()).sort()).toEqual(["plugin:swatch", "spec:card", "spec:pad"]);
    for (const q of law([PAD, CARD, PLUGIN])) expect(at(q.type), q.type).toEqual({ x: q.x, y: q.y, w: q.w, h: q.h });
    expect(t().scroll).toBe(0);
  });

  it("survives the tray's own writes: the mouse over a specimen writes the fact (its hover) and the category stays", () => {
    const r = rig();
    r.pose(true);
    r.step(2);
    setTrayCategory(r.world, "paper");
    openTray(r.world);
    r.step(2);
    const pad = r.byType()["spec:pad"] as number;
    const at = r.world.read(pad as never, Position);
    const size = r.world.read(pad as never, Size);
    r.mouse(40 + at.x + size.w / 2, 348 + at.y + size.h / 2);
    expect([r.world.read(r.tray(), Tray).hover, trayCategory(r.world)]).toEqual(["spec:pad", "paper"]);
  });

  it("falls back to all when the frame hangs none of the category — an id no entry names, and the category whose last entry the frame leaves behind (inside a container that takes none of it) — the board at its top", () => {
    const r = rig();
    r.pose(true);
    r.step(2);
    setTrayCategory(r.world, "nope");
    r.step(2);
    expect(trayCategory(r.world)).toBe("");
    expect(Object.keys(r.byType()).sort()).toEqual(["plugin:swatch", "spec:pad"]);
    const bin = r.ce.ops.spawnWidget("spec:bin", { x: 300, y: 300, undoable: false });
    setTrayCategory(r.world, "paper");
    r.step(2);
    expect(Object.keys(r.byType())).toEqual(["spec:pad"]);
    r.ce.world.edit(r.tray()).set(Tray, { ...r.world.read(r.tray(), Tray), scroll: 25 });
    r.ce.ops.enterContainer(bin, { transition: "none" });   // the bin takes the swatch alone: no paper hangs in it
    r.step(3);
    const t = r.world.read(r.tray(), Tray);
    expect([t.category, t.scroll]).toEqual(["", 0]);
    expect(Object.keys(r.byType())).toEqual(["plugin:swatch"]);
    expect(trayCategories(r.world).map((c) => c.id)).toEqual(["plugin"]);
    r.ce.ops.exitContainer({ transition: "none" });
    r.step(3);
    expect(trayCategory(r.world)).toBe("");   // it stays all: the fallback is the fact
    expect(Object.keys(r.byType()).sort()).toEqual(["plugin:swatch", "spec:pad"]);
  });

  it("petition I38: hangs only what the renderer DRAWS — a type its `draws` refuses (a kind the desk was not mounted with) is not laid, offers no category left empty, takes no press at its would-be peg; a word that changes re-lays", () => {
    const r = rig();
    r.pose(true);
    r.step(2);
    // the control — the renderer says nothing of what it draws: every hung type is laid, each category offered
    const swatch = r.byType()["plugin:swatch"] as number;
    const peg = { ...r.world.read(swatch as never, Position), ...r.world.read(swatch as never, Size) };
    expect(trayCategories(r.world).map((c) => c.id)).toEqual(["paper", "plugin"]);
    // the renderer cannot draw the swatch's kind: not laid, its category (left empty) not offered, the count without it
    const refuse = { frame: r.frame, draws: (type: string): boolean => type !== "plugin:swatch" };
    r.ce.stack.trayPose.current = refuse;
    r.step(2);
    expect(Object.keys(r.byType())).toEqual(["spec:pad"]);
    expect(r.world.isAlive(swatch as never)).toBe(false);
    expect(trayCategories(r.world).map((c) => c.id)).toEqual(["paper"]);
    expect(trayEntryCount(r.world)).toBe(1);
    setTrayCategory(r.world, "plugin");   // a host's stale chip: the frame hangs none of it — all again
    r.step(2);
    expect([trayCategory(r.world), Object.keys(r.byType())]).toEqual(["", ["spec:pad"]]);
    // a press at the would-be peg, out: no hover, no take — the board's press (a drag past the slop lifts nothing)
    openTray(r.world);
    r.step(2);
    const x = 40 + peg.x + peg.w / 2;
    const y = 348 + peg.y + peg.h / 2;
    r.mouse(x, y);
    expect(r.world.read(r.tray(), Tray).hover).toBe("");
    r.ce.stack.queue.enqueue({ kind: "down", pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons: 1, mods: NO_MODS });
    r.step();
    r.ce.stack.queue.enqueue({ kind: "move", pointerId: "mouse", device: "mouse", screenX: x + 12, screenY: y + 12, buttons: 1, mods: NO_MODS });
    r.step();
    expect(r.world.read(r.tray(), Tray).take).toBe("");
    r.ce.stack.queue.enqueue({ kind: "up", pointerId: "mouse", device: "mouse", screenX: x + 12, screenY: y + 12, buttons: 0, mods: NO_MODS });
    r.step();
    // the word changes (a remount that draws it): the lay hangs it again, where the law lays it
    r.ce.stack.trayPose.current = { frame: r.frame };
    r.step(2);
    expect(Object.keys(r.byType()).sort()).toEqual(["plugin:swatch", "spec:pad"]);
    const back = r.byType()["plugin:swatch"] as number;
    expect({ ...r.world.read(back as never, Position), ...r.world.read(back as never, Size) }).toEqual(peg);
    expect(trayCategories(r.world).map((c) => c.id)).toEqual(["paper", "plugin"]);
    // …and the same press now takes it — the control that the press above was at its peg
    r.mouse(x, y);
    expect(r.world.read(r.tray(), Tray).hover).toBe("plugin:swatch");
    r.ce.stack.queue.enqueue({ kind: "down", pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons: 1, mods: NO_MODS });
    r.step();
    r.ce.stack.queue.enqueue({ kind: "move", pointerId: "mouse", device: "mouse", screenX: x + 12, screenY: y + 12, buttons: 1, mods: NO_MODS });
    r.step();
    expect(r.world.read(r.tray(), Tray).take).toBe("plugin:swatch");
  });
});

describe("the set and the hidden (petition I54)", () => {
  const law = (types: readonly WidgetType[]) => layTray(types.map((t) => ({ type: t.type, hang: hangOf(t), ...(t.tray?.category !== undefined ? { category: t.tray.category } : {}), ...(t.tray?.order !== undefined ? { order: t.tray.order } : {}) })), 720, 40).placed;
  const rect = (r: ReturnType<typeof rig>, type: string) => { const e = r.byType()[type]; return e === undefined ? undefined : { ...r.world.read(e as never, Position), ...r.world.read(e as never, Size) }; };
  /** The drawer out, a mouse over a screen point, pressed, moved past the slop and released inside it — its hover, and what it took. */
  const pressAt = (r: ReturnType<typeof rig>, x: number, y: number): readonly [string, string] => {
    r.mouse(x, y);
    const hover = r.world.read(r.tray(), Tray).hover;
    r.ce.stack.queue.enqueue({ kind: "down", pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons: 1, mods: NO_MODS });
    r.step();
    r.ce.stack.queue.enqueue({ kind: "move", pointerId: "mouse", device: "mouse", screenX: x + 12, screenY: y + 12, buttons: 1, mods: NO_MODS });
    r.step();
    const take = r.world.read(r.tray(), Tray).take;
    r.ce.stack.queue.enqueue({ kind: "up", pointerId: "mouse", device: "mouse", screenX: x + 12, screenY: y + 12, buttons: 0, mods: NO_MODS });
    r.step();
    return [hover ?? "", take ?? ""];   // a Tray string field reads as string | null, as the system reads it
  };

  it("are facts of the view — none at install, set by their ops (sorted, each once; [] or null clears), none again after a document switch; a list that is not one throws", () => {
    const r = rig();
    expect([trayOnly(r.world), trayHidden(r.world)]).toEqual([null, []]);
    expect([r.world.read(r.tray(), Tray).only, r.world.read(r.tray(), Tray).hidden]).toEqual(["", ""]);
    setTrayOnly(r.world, ["spec:pad", "plugin:swatch", "spec:pad"]);
    expect(trayOnly(r.world)).toEqual(["plugin:swatch", "spec:pad"]);
    expect(r.world.read(r.tray(), Tray).only).toBe(JSON.stringify(["plugin:swatch", "spec:pad"]));
    setTrayOnly(r.world, []);
    expect(trayOnly(r.world)).toBeNull();
    setTrayOnly(r.world, ["spec:pad"]);
    setTrayOnly(r.world, null);
    expect(trayOnly(r.world)).toBeNull();
    setTrayHidden(r.world, ["plugin:swatch", "plugin:swatch"]);
    expect(trayHidden(r.world)).toEqual(["plugin:swatch"]);
    setTrayHidden(r.world, []);
    expect(trayHidden(r.world)).toEqual([]);
    // runtime facts: never in the document, and a reset (a document switch) starts with none
    setTrayOnly(r.world, ["spec:pad"]);
    setTrayHidden(r.world, ["plugin:swatch"]);
    expect(r.ce.docs.current()?.store.keyOf(r.tray())).toBeUndefined();
    r.ce.docs.create();
    r.world.setResource(Viewport, VP);
    r.step(2);
    expect([trayOnly(r.world), trayHidden(r.world)]).toEqual([null, []]);
    // a refusal writes nothing — from facts that stand: a set, a hidden type, a category (written after the set, by hand)
    setTrayOnly(r.world, ["spec:pad"]);
    setTrayHidden(r.world, ["plugin:swatch"]);
    r.ce.world.edit(r.tray()).set(Tray, { ...r.world.read(r.tray(), Tray), category: "paper" });
    expect(() => setTrayOnly(r.world, "spec:pad" as never)).toThrow(/only — .*an array of object types/);
    expect(() => setTrayOnly(r.world, ["spec:card", 3] as never)).toThrow(/only — .*an array of object types/);
    expect(() => setTrayHidden(r.world, [7] as never)).toThrow(/hide — .*an array of object types/);
    expect([trayOnly(r.world), trayHidden(r.world), trayCategory(r.world)]).toEqual([["spec:pad"], ["plugin:swatch"], "paper"]);
    // a fact written by hand that is no list reads as none — never a throw (the lay reads them inside the tick)
    r.ce.world.edit(r.tray()).set(Tray, { ...r.world.read(r.tray(), Tray), only: "spec:pad", hidden: "{" });
    expect([trayOnly(r.world), trayHidden(r.world)]).toEqual([null, []]);
  });

  it("the SET lays only its types, across their categories, where the law lays them alone and in its order; it wins over the category (written \"\" with it, written back \"\" over one asked meanwhile); the chips and the count stay the frame's whole hang; a move zeroes the scroll and the band, the same set again changes nothing; cleared, every object — never the category before it", () => {
    const r = rig({ w: 720 }, [CARD, LOOSE]);
    r.pose(true);
    r.step(2);
    openTray(r.world);   // out: the input lets a band go only once the wheel has been quiet — so a band zeroed in ONE step is the lay's
    r.step(2);
    const t = () => r.world.read(r.tray(), Tray);
    const laid = () => r.world.read(r.tray(), TrayContent).laid;
    setTrayCategory(r.world, "paper");
    r.step(2);
    expect(Object.keys(r.byType()).sort()).toEqual(["spec:card", "spec:pad"]);
    // a pull on the band this instant (the wheel's clock now): only the lay's move can zero it within the next step
    r.ce.world.edit(r.tray()).set(Tray, { ...t(), scroll: 77, stretch: 12, wheelAt: r.world.getResource(FrameInfo)?.now ?? 0 });
    // a set over two categories and the entry that names none
    setTrayOnly(r.world, ["spec:loose", "plugin:swatch", "spec:card"]);
    expect(trayCategory(r.world)).toBe("");   // written with it: the set wins at once
    r.step();
    expect([t().scroll, t().stretch]).toEqual([0, 0]);
    r.step();
    expect(Object.keys(r.byType()).sort()).toEqual(["plugin:swatch", "spec:card", "spec:loose"]);
    const set = law([CARD, PLUGIN, LOOSE]);
    for (const q of set) expect(rect(r, q.type), q.type).toEqual({ x: q.x, y: q.y, w: q.w, h: q.h });
    expect(trayHung(r.world)).toEqual(set.map((q) => q.type));   // the lay's order, across the categories
    expect([t().category, t().only, t().scroll, t().stretch]).toEqual(["", JSON.stringify(["plugin:swatch", "spec:card", "spec:loose"]), 0, 0]);
    // the frame's whole hang, as before the set: a host's chips quiet themselves on `only`, not on a count that moved
    expect(trayCategories(r.world)).toEqual([{ id: "paper", label: "Paper", count: 2 }, { id: "plugin", label: "Plugin", count: 1 }]);
    expect(trayEntryCount(r.world)).toBe(4);
    // a category asked while the set stands: written back "" — nothing re-laid, the scroll kept
    r.ce.world.edit(r.tray()).set(Tray, { ...t(), scroll: 30 });
    const n = laid();
    setTrayCategory(r.world, "paper");
    r.step(2);
    expect([t().category, laid(), t().scroll, Object.keys(r.byType()).length]).toEqual(["", n, 30, 3]);
    // the same set again, in another order with a repeat: no write, no re-lay, the scroll kept
    setTrayOnly(r.world, ["spec:card", "spec:loose", "plugin:swatch", "spec:card"]);
    r.step(2);
    expect([laid(), t().scroll]).toEqual([n, 30]);
    // another set: re-laid where the law lays it alone, the board at its top
    setTrayOnly(r.world, ["spec:pad"]);
    r.step(2);
    expect(Object.keys(r.byType())).toEqual(["spec:pad"]);
    const alone = law([PAD])[0];
    expect(rect(r, "spec:pad")).toEqual({ x: alone?.x, y: alone?.y, w: alone?.w, h: alone?.h });
    expect(t().scroll).toBe(0);
    // cleared: every object, laid as the law lays them all — not the paper the drawer showed before the set — the board at its top
    r.ce.world.edit(r.tray()).set(Tray, { ...t(), scroll: 40 });
    setTrayOnly(r.world, null);
    r.step(2);
    expect(Object.keys(r.byType()).sort()).toEqual(["plugin:swatch", "spec:card", "spec:loose", "spec:pad"]);
    for (const q of law([PAD, CARD, PLUGIN, LOOSE])) expect(rect(r, q.type), q.type).toEqual({ x: q.x, y: q.y, w: q.w, h: q.h });
    expect([t().category, t().only, t().scroll]).toEqual(["", "", 0]);
  });

  it("a SET the frame hangs none of falls back to none — ids no entry names, and a set whose types the frame leaves behind (inside a container that takes none of them) — written back, the board at its top; an id no entry names beside one it does is passed over", () => {
    const r = rig();
    r.pose(true);
    r.step(2);
    setTrayOnly(r.world, ["spec:nothing"]);
    r.step(2);
    expect(trayOnly(r.world)).toBeNull();
    expect(Object.keys(r.byType()).sort()).toEqual(["plugin:swatch", "spec:pad"]);
    const bin = r.ce.ops.spawnWidget("spec:bin", { x: 300, y: 300, undoable: false });
    setTrayOnly(r.world, ["spec:pad", "spec:nothing"]);
    r.step(2);
    expect(Object.keys(r.byType())).toEqual(["spec:pad"]);
    expect(trayOnly(r.world)).toEqual(["spec:nothing", "spec:pad"]);   // the set stands as asked
    r.ce.world.edit(r.tray()).set(Tray, { ...r.world.read(r.tray(), Tray), scroll: 25 });
    r.ce.ops.enterContainer(bin, { transition: "none" });   // the bin takes the swatch alone: none of the set hangs in it
    r.step(3);
    const t = r.world.read(r.tray(), Tray);
    expect([t.only, t.category, t.scroll]).toEqual(["", "", 0]);
    expect(Object.keys(r.byType())).toEqual(["plugin:swatch"]);
    r.ce.ops.exitContainer({ transition: "none" });
    r.step(3);
    expect(trayOnly(r.world)).toBeNull();   // it stays none: the fallback is the fact — the host says the set again
    expect(Object.keys(r.byType()).sort()).toEqual(["plugin:swatch", "spec:pad"]);
    // a set written by hand that is no list (never by the op) reads as none: the lay drops it — never a throw inside the tick
    r.ce.world.edit(r.tray()).set(Tray, { ...r.world.read(r.tray(), Tray), only: "spec:pad" });
    r.step(2);
    expect([r.world.read(r.tray(), Tray).only, Object.keys(r.byType()).sort()]).toEqual(["", ["plugin:swatch", "spec:pad"]]);
  });

  it("a SET over kinds the renderer cannot draw (I38 — a kind this desk was not mounted with) is dropped at the next lay, the category it replaced not restored; said again once the desk draws them, it stands", () => {
    const r = rig();
    r.ce.stack.trayPose.current = { frame: r.frame, draws: (type: string): boolean => type !== "plugin:swatch" };
    r.step(2);
    setTrayCategory(r.world, "paper");
    r.step(2);
    setTrayOnly(r.world, ["plugin:swatch"]);   // a plugin's new kind, asked before the desk that draws it is mounted
    r.step(2);
    expect([trayOnly(r.world), trayCategory(r.world), Object.keys(r.byType())]).toEqual([null, "", ["spec:pad"]]);
    // the remount that draws it (the renderer's word changes), then the set said again: it stands, laid alone
    r.ce.stack.trayPose.current = { frame: r.frame };
    r.step(2);
    setTrayOnly(r.world, ["plugin:swatch"]);
    r.step(2);
    expect([trayOnly(r.world), Object.keys(r.byType())]).toEqual([["plugin:swatch"], ["plugin:swatch"]]);
  });

  it("a HIDDEN type hangs nothing — no specimen, no count, no category it alone would fill, no hover or take at its would-be peg, no lay — the scroll kept; its objects on the desk stay members, select and duplicate; every type hidden, nothing to offer; [] hangs it again at its peg", () => {
    const r = rig();
    const desk = r.ce.ops.spawnWidget("plugin:swatch", { x: 300, y: 300, undoable: false });   // one on the desk
    r.pose(true);
    r.step(2);
    const t = () => r.world.read(r.tray(), Tray);
    const swatch = r.byType()["plugin:swatch"] as number;
    const peg = rect(r, "plugin:swatch");
    const n = r.world.read(r.tray(), TrayContent).laid;
    expect(trayCategories(r.world).map((c) => c.id)).toEqual(["paper", "plugin"]);   // the control
    r.ce.world.edit(r.tray()).set(Tray, { ...t(), scroll: 20 });
    setTrayHidden(r.world, ["plugin:swatch"]);
    r.step(2);
    expect(Object.keys(r.byType())).toEqual(["spec:pad"]);
    expect(r.world.isAlive(swatch as never)).toBe(false);
    expect(r.world.read(r.tray(), TrayContent).laid).toBe(n + 1);   // re-laid
    expect(trayCategories(r.world).map((c) => c.id)).toEqual(["paper"]);
    expect(trayEntryCount(r.world)).toBe(1);
    expect(t().scroll).toBe(20);   // a hide is no move of what the drawer shows: the scroll kept
    setTrayCategory(r.world, "plugin");   // a host's stale chip: the frame hangs none of it — all again
    r.step(2);
    expect([trayCategory(r.world), Object.keys(r.byType())]).toEqual(["", ["spec:pad"]]);
    // out: a press at its would-be peg hovers nothing and takes nothing; the op lays nothing of it
    openTray(r.world);
    r.ce.world.edit(r.tray()).set(Tray, { ...t(), scroll: 0 });
    r.step(2);
    const x = 40 + (peg?.x ?? 0) + (peg?.w ?? 0) / 2;
    const y = 348 + (peg?.y ?? 0) + (peg?.h ?? 0) / 2;
    expect(pressAt(r, x, y)).toEqual(["", ""]);
    expect(r.ce.ops.layFromTray("plugin:swatch", { x: 0, y: 0 })).toBeUndefined();
    // its object on the desk: still a member of the frame, selected and duplicated as before
    expect(r.world.hasTag(desk, Active)).toBe(true);
    r.ce.ops.setSelection([desk], "replace");
    const twins = r.ce.ops.duplicateSelection();
    r.step(2);
    expect(twins).toHaveLength(1);
    expect(r.world.read(twins[0] as never, PrefabId).id).toBe("plugin:swatch");
    expect(r.world.hasTag(twins[0] as never, Active)).toBe(true);
    expect(r.world.hasTag(twins[0] as never, Selected)).toBe(true);
    // every type hidden: nothing to offer — no specimen, no chip, a count of 0, no order to walk
    setTrayHidden(r.world, ["spec:pad", "plugin:swatch"]);
    r.step(2);
    expect([r.specimens(), trayCategories(r.world), trayEntryCount(r.world), trayHung(r.world)]).toEqual([[], [], 0, []]);
    // none hidden: hung again where the law lays it, and the same press takes it — the control that the press above was at its peg
    setTrayHidden(r.world, []);
    r.step(2);
    expect(Object.keys(r.byType()).sort()).toEqual(["plugin:swatch", "spec:pad"]);
    expect(rect(r, "plugin:swatch")).toEqual(peg);
    expect(pressAt(r, x, y)).toEqual(["plugin:swatch", "plugin:swatch"]);
  });

  it("a HIDE keeps the scroll — clamped when the lay it causes moves the range under it (K9 S10), kept when the range grows", () => {
    const view = { w: 280, face: 147 };   // at 280 the pad and the swatch hang on two lines (foot 410): the K9 row's numbers
    const r = rig(view);
    r.pose(true);
    r.step(2);
    const t = () => r.world.read(r.tray(), Tray);
    const bottom = () => r.world.read(r.tray(), TrayContent).bottom;
    expect(bottom()).toBe(410);
    scrollTray(r.world, trayScrollMax(410, 147, 40));   // 303, the whole range
    r.step(2);
    const n = r.world.read(r.tray(), TrayContent).laid;
    const alone = layTray([{ type: "spec:pad", hang: hangOf(PAD), category: "paper", order: 0 }], 280, 40).bottom;   // the pad alone: one line
    expect(trayScrollMax(alone, 147, 40)).toBeLessThan(303);   // the precondition: the range falls under the scroll
    setTrayHidden(r.world, ["plugin:swatch"]);
    r.step(2);
    expect([r.world.read(r.tray(), TrayContent).laid, bottom()]).toEqual([n + 1, alone]);
    expect(t().scroll).toBe(trayScrollMax(alone, 147, 40));   // clamped to the new end — not zeroed: a hide is no move of what is shown
    scrollTray(r.world, 20);
    r.step(2);
    setTrayHidden(r.world, []);   // two lines again: the range grows past the scroll — kept
    r.step(2);
    expect([bottom(), t().scroll]).toEqual([410, 20]);
  });

  it("a take in flight whose specimen hangs no more — its type hidden while it is lifted — is put back, never handed to the desk", () => {
    const r = rig();
    r.pose(true);
    r.step(2);
    openTray(r.world);
    r.step(2);
    const peg = rect(r, "plugin:swatch");
    const x = 40 + (peg?.x ?? 0) + (peg?.w ?? 0) / 2;
    const y = 348 + (peg?.y ?? 0) + (peg?.h ?? 0) / 2;
    const epoch = (): number => r.world.getResource(TrayIntent)?.epoch ?? 0;
    const press = (kind: "down" | "move" | "up", px: number, py: number, buttons: number): void => {
      r.ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: px, screenY: py, buttons, mods: NO_MODS });
      r.step();
    };
    r.mouse(x, y);
    press("down", x, y, 1);
    press("move", x + 12, y + 12, 1);
    expect(r.world.read(r.tray(), Tray).take).toBe("plugin:swatch");   // lifted, still in the drawer
    const before = epoch();
    setTrayHidden(r.world, ["plugin:swatch"]);
    r.step(2);
    expect(r.world.read(r.tray(), Tray).take).toBe("");   // its specimen gone: the copy goes back
    press("move", x, 200, 1);   // out of the drawer: nothing is handed — no intent, the drawer stays out
    expect([epoch(), r.world.read(r.tray(), Tray).take, trayOpen(r.world)]).toEqual([before, "", true]);
    press("up", x, 200, 0);
  });

  it("ops.layFromTray refuses a type hidden, or left out of a standing set, AT ONCE — before any step has moved the lay's record", () => {
    const r = rig();
    r.pose(true);
    r.step(2);
    expect([...trayHung(r.world)].sort()).toEqual(["plugin:swatch", "spec:pad"]);
    setTrayHidden(r.world, ["plugin:swatch"]);
    expect(trayHung(r.world)).toContain("plugin:swatch");   // the record has not moved: no step since
    expect(r.ce.ops.layFromTray("plugin:swatch", { x: 0, y: 0 })).toBeUndefined();
    setTrayHidden(r.world, []);
    setTrayOnly(r.world, ["spec:pad"]);
    expect(trayHung(r.world)).toContain("plugin:swatch");
    expect(r.ce.ops.layFromTray("plugin:swatch", { x: 0, y: 0 })).toBeUndefined();
    // the control, in the same state: the set's own type is laid
    const laid = r.ce.ops.layFromTray("spec:pad", { x: 0, y: 0 });
    expect(laid).toBeDefined();
    r.step(3);   // a spawned object's type is the store's, reflected in the step (as I37's own row reads `made`)
    expect(r.world.read(laid as never, PrefabId).id).toBe("spec:pad");
  });

  it("the hidden win over the set: a hidden type of the set hangs nothing, and a set wholly hidden falls back to none", () => {
    const r = rig({ w: 720 }, [CARD]);
    r.pose(true);
    r.step(2);
    setTrayOnly(r.world, ["spec:pad", "spec:card"]);
    setTrayHidden(r.world, ["spec:card"]);
    r.step(2);
    expect(Object.keys(r.byType())).toEqual(["spec:pad"]);
    expect(trayOnly(r.world)).toEqual(["spec:card", "spec:pad"]);   // the set stands
    expect(trayCategories(r.world)).toEqual([{ id: "paper", label: "Paper", count: 1 }, { id: "plugin", label: "Plugin", count: 1 }]);
    setTrayHidden(r.world, ["spec:card", "spec:pad"]);
    r.step(2);
    expect(trayOnly(r.world)).toBeNull();
    expect(Object.keys(r.byType())).toEqual(["plugin:swatch"]);
  });
});
