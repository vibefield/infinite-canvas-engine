// @vitest-environment node
// THE SPECIMENS (design-017 §8; K5a): the tray entity roots a runtime canvas whose members are the kinds that declared a tray entry —
// the catalog's, a plugin's by its entry alone — each a runtime entity `ChildOf` it: `PrefabId` its type, `Position`/`Size` where the
// lattice law lays it across the drawer the renderer drew (the pose seam), its entry's props over the widget's defaults, `Specimen`.
// Never Active (the desk's stack never picks, selects or culls one), never durable; re-laid on a width change, laid afresh after a
// reset. Open, the mouse over one is `Tray.hover` — the hover that lifts it. Through the REAL stack; the pose is the renderer's word.
import { describe, expect, it } from "vitest";
import { layTray, trayScrollMax } from "@ice/kernel";
import {
  Active,
  Camera,
  createCanvasEngine,
  defineWidget,
  openTray,
  scrollTray,
  p,
  Position,
  Selectable,
  Selected,
  Size,
  Specimen,
  specimensOf,
  Tray,
  TrayContent,
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

const VP = { w: 800, h: 600, dpr: 1 };

function rig(widths: { w: number; face?: number } = { w: 720 }) {
  const ce = createCanvasEngine({ widgets: [PAD, PLUGIN, PLAIN] });
  ce.docs.create();
  ce.world.setResource(Viewport, VP);
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  const plain = ce.ops.spawnWidget("spec:plain", { x: 100, y: 100, undoable: false });
  let now = 1000;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  const shown = (): number => { const e = trayEntity(ce.world); return e === undefined ? 0 : ce.world.read(e, Tray).scroll; };
  const frame = (): TrayScreenFrame => ({ x: 40, y: trayOpen(ce.world) ? 348 : 588, w: widths.w, h: 252, p: trayOpen(ce.world) ? 1 : 0, max: 0, pitch: 40, scroll: shown(), ...(widths.face !== undefined ? { face: widths.face } : {}) });
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
    expect(c).toEqual({ width: 720, bottom: laid.bottom, laid: 1 });
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
    const view = { w: 280, face: 147 };   // at 280 the two kinds hang on two lines (foot 370), at 720 on one (foot 210)
    const r = rig(view);
    r.pose(true);
    r.step(2);
    const t = () => r.world.read(r.tray(), Tray);
    const range = () => trayScrollMax(r.world.read(r.tray(), TrayContent).bottom, view.face, 40);
    expect(range()).toBe(370 + 40 - 147);
    scrollTray(r.world, range()); r.step(2);
    expect(t().scroll).toBe(263);
    view.w = 720; r.step(2);                        // the window widens — one line: the range falls under the scroll
    expect(range()).toBe(210 + 40 - 147);
    expect(t().scroll).toBe(103);
    scrollTray(r.world, 1e6 * 40); r.step(3);       // the door (rig:tray's 10⁶ rows): no range moved, nothing clamps it
    expect(t().scroll).toBe(1e6 * 40);
    view.face += 50; r.step(2);                     // the view grows taller, its face with it: the range moves — clamped
    expect(t().scroll).toBe(210 + 40 - 197);
    // pulled past the end (the band's), the range moves under it: left be — and clamped once the pull lets go
    r.ce.world.edit(r.tray()).set(Tray, { ...t(), scroll: 53, stretch: 30 });
    view.face += 20; r.step(2);
    expect([t().scroll, t().stretch]).toEqual([53, 30]);
    r.ce.world.edit(r.tray()).set(Tray, { ...t(), stretch: 0 });
    r.step(2);
    expect(t().scroll).toBe(210 + 40 - 217);
    // a face the renderer does not report clamps nothing (the range is its word)
    const bare = rig({ w: 720 });
    bare.pose(true); bare.step(2);
    scrollTray(bare.world, 5000); bare.step(3);
    expect(bare.world.read(bare.tray(), Tray).scroll).toBe(5000);
  });
});
