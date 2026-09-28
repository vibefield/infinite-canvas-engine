// @vitest-environment node
// K9 law #1 (design-017 §1 "while it is open the desk dims and goes inert", §4 "anywhere else — inert"): with the drawer OUT the desk
// under it is inert to the DOM-AT-EVENT-TIME halves too. The desk's editor tap (`tapHit`) and the calendar's days (`tapOn`) read the
// pointer's exact hit; `trayInput`'s `HandledByWidget` is a same-phase structural stamp l1-pick never sees, so until K9 that hit was
// LIVE through the drawer — a click on a specimen over a note lent the editor to the note under the drawer, a click over a pad selected
// a day (a double-click began writing, and flew the pad into the hand), and the hover rose on the dimmed desk. Here the desk is mounted
// on the fake device as `desk-mount.ts` mounts it, on a container that KEEPS its listeners so the halves' platform events can be sent
// at the pixel; the loop is driven as `dom/loop.ts` drives it, on a virtual clock. Every case with its control, the drawer shut.
import { Camera, closeTray, createCanvasEngine, defineQuery, Editing, type Entity, heldEntity, LocalPointer, NO_MODS, openTray, Pointer, TouchesExact, trayOpen, Viewport } from "@ice/core";
import { deskLayer, type DeskLayerHandle } from "@ice/desk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DESK_ENGINE, DESK_OBJECTS, deskPalette, deskTheme, PadSelection } from "../src";
import { partAt } from "../src/calendar/kind";
import { CALENDAR } from "../src/calendar/law";
import { fakeDevice, installGpuFlags } from "../../desk/test/fake-gpu";
import { fakePage } from "../../desk/test/fake-page";

interface Rig {
  readonly ce: ReturnType<typeof createCanvasEngine>;
  readonly handle: DeskLayerHandle;
  readonly world: ReturnType<typeof createCanvasEngine>["world"];
  /** Steps until the gate says sleep (400 at most). */
  settle(): void;
  step(n?: number): void;
  /** The mouse to (x, y) through the one input path, then settled. */
  move(x: number, y: number): void;
  /** A press and its release at (x, y) through the queue (what the stack sees), then the platform's pointerdown + click (what the halves see). */
  click(x: number, y: number, detail?: number): void;
  /** The mouse pointer's exact hit. */
  exact(): Entity | undefined;
  /** The drawer opened by its op and slid; the tray's per-kind passes (made asynchronously on the fake device) settled before the test goes on. */
  open(): Promise<void>;
  dispose(): void;
}

const mouseQ = defineQuery([Pointer, LocalPointer]);

async function mount(): Promise<Rig> {
  const undo: (() => void)[] = [installGpuFlags()];
  const log: string[] = [];
  const { device } = fakeDevice(log);
  Object.assign(device, { addEventListener: () => {}, lost: new Promise(() => {}), destroy: () => {} });
  const adapter = { features: new Set<string>(), requestDevice: async () => device };
  const gpu = { requestAdapter: async () => adapter, getPreferredCanvasFormat: () => "bgra8unorm" } as unknown as GPU;
  const context = { configure: () => {}, unconfigure: () => {}, getCurrentTexture: () => ({ createView: () => ({ label: "swap" }), width: 1, height: 1 }) };
  const canvas = { style: {}, width: 1, height: 1, clientWidth: 1, clientHeight: 1, getContext: () => context, remove: () => {} };
  const page = fakePage();
  const doc = page.container.ownerDocument as unknown as { createElement(tag: string): unknown };
  const element = doc.createElement.bind(doc);
  doc.createElement = (tag: string) => (tag === "canvas" ? canvas : element(tag));
  // the container keeps its listeners (fakePage's swallows them) and has a rect at the origin: screen = client
  const listeners = new Map<string, ((ev: unknown) => void)[]>();
  const container = new Proxy(page.container as Record<PropertyKey, unknown>, {
    get(t, k) {
      if (k === "addEventListener") return (type: string, fn: (ev: unknown) => void) => { const l = listeners.get(type) ?? []; l.push(fn); listeners.set(type, l); };
      if (k === "removeEventListener") return () => {};
      if (k === "getBoundingClientRect") return () => ({ left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800 });
      if (k === "querySelectorAll") return () => [];
      return t[k];
    },
  });
  const dispatch = (type: string, ev: unknown): void => { for (const fn of listeners.get(type) ?? []) fn(ev); };
  vi.stubGlobal("navigator", { gpu });
  undo.push(() => vi.unstubAllGlobals());
  const ce = createCanvasEngine(DESK_ENGINE);
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 1200, h: 800, dpr: 1 });
  const handle = deskLayer({ gpu, theme: deskTheme("light"), palette: deskPalette("light"), objects: [...DESK_OBJECTS], docs: ce.docs })({
    host: { container: container as unknown as HTMLElement }, world: ce.world, frame: ce.engine.frame, catalog: ce.catalog,
    trayPose: ce.stack.trayPose, framePick: ce.stack.framePick, navGeometry: ce.stack.navGeometry, heldPose: ce.stack.heldPose,
  });
  undo.push(ce.engine.registerReflector(handle.reflector));
  for (let i = 0; i < 200 && handle.status().state === "pending"; i++) await new Promise((r) => setTimeout(r, 5));
  expect(handle.status().state).toBe("ready");
  handle.setAmbient("still");
  let t = 1000;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { ce.engine.step(t); ce.engine.frame.nextStep(t); t += 16.7; } };
  const settle = (): void => { for (let i = 0; i < 400; i++) { ce.engine.step(t); const due = ce.engine.frame.nextStep(t); t += 16.7; if (due > t) return; } };
  const enqueue = (kind: "move" | "down" | "up", x: number, y: number, buttons: number): void => { ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: NO_MODS }); ce.engine.frame.wake("test"); };
  const move = (x: number, y: number): void => { enqueue("move", x, y, 0); settle(); };
  const click = (x: number, y: number, detail = 1): void => {
    enqueue("down", x, y, 1); step(2);
    enqueue("up", x, y, 0); step(1);
    const ev = { isPrimary: true, button: 0, pointerId: 1, pointerType: "mouse", clientX: x, clientY: y, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, detail, preventDefault() {} };
    dispatch("pointerdown", ev);
    dispatch("click", ev);
    if (detail >= 2) dispatch("dblclick", ev);
    settle();
  };
  const exact = (): Entity | undefined => { let hit: Entity | undefined; ce.world.query(mouseQ).each((b) => { for (const r of b) hit = ce.world.getRelation(b.entity(r), TouchesExact); }); return hit; };
  const open = async (): Promise<void> => { openTray(ce.world); settle(); await new Promise((r) => setTimeout(r, 0)); settle(); };
  return { ce, handle, world: ce.world, settle, step, move, click, exact, open, dispose() { handle.dispose(); ce.dispose(); for (const u of undo.splice(0).reverse()) u(); } };
}

const rigs: Rig[] = [];
afterEach(() => { for (const r of rigs.splice(0)) r.dispose(); });

/** The drawer open (and slid), the specimen of `type` — its screen box — or a failure that names what hangs. */
function specimen(r: Rig, type: string): { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number } {
  const specs = r.handle.tray.state().specimens;
  const s = specs.find((q) => q.type === type);
  if (s === undefined) throw new Error(`no ${type} specimen on the board — hanging: ${specs.map((q) => q.type).join(" ")}`);
  return s.screen;
}

describe("the desk under the open drawer is inert to the DOM-at-event-time halves (design-017 §4; K9 law #1)", () => {
  it("a click on a specimen hanging over a NOTE under the drawer lends nothing — no lease, no `Editing`, the drawer still open; shut, the same spot lends the editor to the note (control)", async () => {
    const r = await mount(); rigs.push(r);
    // the camera is the identity here: world = screen. A note whose sheet lies under the drawer's rect (the drawer's top at 448)
    expect(r.world.getResource(Camera)).toMatchObject({ x: 0, y: 0, zoom: 1 });
    const under = r.ce.ops.spawnWidget("desk.note", { x: 300, y: 560 });
    r.settle();
    await r.open();
    // a specimen whose centre lies over the note (the lattice lays the photo there at this width; any that does will do)
    const specs = r.handle.tray.state().specimens.filter((q) => q.screen.y1 <= 800);
    const over = specs.find((q) => { const cx = (q.screen.x0 + q.screen.x1) / 2; const cy = (q.screen.y0 + q.screen.y1) / 2; return cx >= 300 && cx <= 500 && cy >= 560 && cy <= 760; });
    if (over === undefined) throw new Error(`no specimen hangs over the note under the drawer — ${specs.map((q) => `${q.type}@(${((q.screen.x0 + q.screen.x1) / 2).toFixed(0)},${((q.screen.y0 + q.screen.y1) / 2).toFixed(0)})`).join(" ")}`);
    const sx = (over.screen.x0 + over.screen.x1) / 2;
    const sy = (over.screen.y0 + over.screen.y1) / 2;
    r.move(sx, sy);
    // the pick answers the bare canvas through the drawer (l1-pick reads `Tray.open`)
    expect(r.exact()).not.toBe(under);
    r.click(sx, sy);
    expect(r.handle.editor().lease()).toBeUndefined();
    expect(r.world.hasTag(under, Editing)).toBe(false);
    expect(trayOpen(r.world)).toBe(true);   // a click on the drawer is not a click on the dimmed desk
    // control: the drawer shut, the same spot is the note's — the desk's tap lends the editor to its body
    closeTray(r.world); r.settle();
    r.move(sx, sy);
    expect(r.exact()).toBe(under);
    r.click(sx, sy);
    expect(r.handle.editor().lease()?.part).toBe("note.body");
    expect(r.world.hasTag(under, Editing)).toBe(true);
    r.handle.editor().blur(); r.settle();
  });

  it("a click on a specimen over a CALENDAR PAD under the drawer selects no day, a double-click begins no writing and flies nothing into the hand; shut, the same click selects the day (control)", async () => {
    const r = await mount(); rigs.push(r);
    const pad = r.ce.ops.spawnWidget("desk.calendar", { x: 100, y: 60 });
    r.settle();
    // a DAY cell of the pad, through its kind's own `partAt` on the geometry the builder drew (world = screen), under the drawer's rect
    const G = r.handle.geometryOf(pad) as Parameters<typeof partAt>[0] | undefined;
    expect(G).toBeDefined();
    let day: readonly [number, number] | null = null;
    outer: for (let y = 460; y < 790; y += 10) for (let x = 110; x < 1190; x += 10) {
      const part = G === undefined ? null : partAt(G, x, y, [], CALENDAR);
      if (part !== null && part.part === "day" && part.day !== undefined) { day = [x, y]; break outer; }
    }
    if (day === null) throw new Error("no day cell of the pad lies under the drawer's rect");
    await r.open();
    r.move(day[0], day[1]);
    r.click(day[0], day[1]);
    expect(r.world.get(pad, PadSelection)).toBeUndefined();
    expect(r.handle.editor().lease()).toBeUndefined();
    r.click(day[0], day[1], 2);
    expect(r.world.get(pad, PadSelection)).toBeUndefined();
    expect(r.handle.editor().lease()).toBeUndefined();
    expect(heldEntity(r.world)).toBeUndefined();
    expect(trayOpen(r.world)).toBe(true);
    // control: shut, a click on the day selects it (and the day's line takes the editor)
    closeTray(r.world); r.settle();
    r.move(day[0], day[1]);
    r.click(day[0], day[1]);
    expect(r.world.get(pad, PadSelection)).toBeDefined();
    r.handle.editor().blur(); r.settle();
  });

  it("the HOVER stays down on the dimmed desk: the mouse onto a note above the drawer lifts nothing while it is out (control: shut, it rises)", async () => {
    const r = await mount(); rigs.push(r);
    const above = r.ce.ops.spawnWidget("desk.note", { x: 800, y: 100 });
    r.settle();
    r.move(400, 200);
    await r.open();
    r.move(900, 200);   // the note's centre
    r.step(30);
    expect(r.exact()).not.toBe(above);
    expect(r.handle.fluxOf(above)?.hover ?? 0).toBeLessThan(0.01);
    closeTray(r.world); r.settle();
    r.step(30);
    expect(r.exact()).toBe(above);
    expect(r.handle.fluxOf(above)?.hover ?? 0).toBeGreaterThan(0.9);
  });
});
