// @vitest-environment node
// PETITION I34 — THE TRAY'S TWO WRITERS ARE ORDERED, NOT ATTESTED. `trayInput` (react) writes the drawer's facts from this tick's
// pointers; the lay (`trayLay`) reads them back in the same tick and writes over them: its clamp judges THIS tick's band and scroll
// (design-017 §12, D-K9-c.2), and a category move starts the board at its top over THIS tick's wheel (design-018 §6). Their writes
// to `Tray` do not commute, so `orderIndependent` would be a false attestation: the lay must SEE the input's write. Both sat in
// "react", and strata's dev build (DEV is on in the source vitest runs) warned at every engine's first tick — every `createStill`
// printed it. The lay now runs at the head of "derive" (design-002 §2: derived state, flushed for present and the reflectors); the
// one other writer of `Position`/`Size` there, the selection chrome, writes only its handle pool — rows disjoint from the lay's
// specimens — and both attest that. Through the REAL stack.
import { describe, expect, it, vi } from "vitest";
import {
  createCanvasEngine,
  defineWidget,
  NO_MODS,
  openTray,
  PHASE_GROUPS,
  setTrayCategory,
  Tray,
  trayEntity,
  trayOpen,
  Viewport,
  Camera,
  widgets,
  type TrayScreenFrame,
  type WidgetType,
} from "../src";

// One widget type per FILE (global registry; no test reset): two categories, so a category can move.
const hang = { w: 80, h: 80, accessory: "clip", pegs: [[0, -0.5]] } as const;
const INK: WidgetType = widgets.get("order:ink") ?? defineWidget({ type: "order:ink", object: { name: "ink" }, defaultSize: { w: 100, h: 100 }, tray: { label: "Ink", category: "pens", hang } });
const LEAF: WidgetType = widgets.get("order:leaf") ?? defineWidget({ type: "order:leaf", object: { name: "leaf" }, defaultSize: { w: 100, h: 100 }, tray: { label: "Leaf", category: "paper", hang } });

/** A drawer out over an 800 × 600 view whose board scrolls 200 px — the renderer's word through the pose seam. */
function rig() {
  const ce = createCanvasEngine({ widgets: [INK, LEAF] });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 800, h: 600, dpr: 1 });
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  let now = 1000;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  const scroll = (): number => { const e = trayEntity(ce.world); return e === undefined ? 0 : ce.world.read(e, Tray).scroll; };
  const frame = (): TrayScreenFrame => ({ x: 40, y: trayOpen(ce.world) ? 348 : 588, w: 720, h: 252, p: trayOpen(ce.world) ? 1 : 0, max: 200, pitch: 40, scroll: scroll() });
  ce.stack.trayPose.current = { frame };
  return { ce, step, scroll };
}

describe("the tray's writers (petition I34)", () => {
  it("createCanvasEngine under strata's dev build prints no `Tray` write-order warning — no access advisory at all", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const r = rig();
      r.step(3);   // the pipeline is walked at the first tick; the lay has run (the pose is up)
      expect(r.ce.world.read(trayEntity(r.ce.world) as never, Tray).category).toBe("");
      const said = warn.mock.calls.map((c) => String(c[0]));
      expect(said.filter((m) => /declare write of "Tray"/.test(m))).toEqual([]);
      expect(said.filter((m) => /^strata: access:/.test(m))).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it("the lay runs in a later phase than the input — the one ordering strata's pipeline keeps", () => {
    const r = rig();
    r.ce.engine.enableTelemetry();
    r.step(2);
    const ran = r.ce.engine.lastFrame()?.systems ?? [];
    const phaseOf = (name: string): number => PHASE_GROUPS.indexOf(ran.find((s) => s.system === name)?.phase as (typeof PHASE_GROUPS)[number]);
    expect(phaseOf("trayInput")).toBe(PHASE_GROUPS.indexOf("react"));
    expect(phaseOf("trayLay")).toBe(PHASE_GROUPS.indexOf("derive"));
  });

  it("the lay SEES the input's write: one tick that wheels the board and moves the category starts the board at its top", () => {
    const r = rig();
    r.step(2);
    openTray(r.ce.world);
    r.step(2);
    // the wheel alone scrolls it — the control
    r.ce.stack.queue.enqueue({ kind: "wheel", pointerId: "mouse", device: "mouse", screenX: 300, screenY: 500, buttons: 0, mods: NO_MODS, wheel: { dx: 0, dy: 30, pinch: 0 } });
    r.step();
    expect(r.scroll()).toBe(30);
    // the wheel and a category move in ONE tick: the input scrolls, the lay — after it — starts the board again at its top
    r.ce.stack.queue.enqueue({ kind: "wheel", pointerId: "mouse", device: "mouse", screenX: 300, screenY: 500, buttons: 0, mods: NO_MODS, wheel: { dx: 0, dy: 30, pinch: 0 } });
    setTrayCategory(r.ce.world, "paper");
    r.step();
    expect(r.ce.world.read(trayEntity(r.ce.world) as never, Tray).category).toBe("paper");
    expect(r.scroll()).toBe(0);
  });
});
