// @vitest-environment node
// M24 LT3 (design-019 §8): the RENDER HALF and the rest of a kind's calls under petition I24's ladder, on a desk layer as a host mounts
// it (the fake device, the engine's frame gate, the engine's ops in the mount context): a throw from a kind's pass in a frame — its
// `prepare`, its `drawRange` — from a driver's `follow`, a desk state's `forget` (the builder's, the tray's) or `keeps`, its `held`
// while in hand, and a GPU error raised in its `prepare` (its slot's scope, then its own) is a STRIKE against that kind, struck once
// the frame (or the trim) it broke is done — never a lost frame: the
// reflector never faults, the frame count keeps rising, every other kind draws. The third quarantines it — said once, naming the call;
// its objects wear the missing face from the next frame; an object of it in hand is put down, its `up` told to no one.
import { createCanvasEngine, type Entity, heldEntity, type InputMods, NO_MODS, Viewport, type WidgetType } from "@ice/core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SlotObject } from "../src/ground";
import { deskLayer, type DeskLayerHandle } from "../src/host/layer";
import type { KindPass } from "../src/kind";
import type { KindDriver, KindHost, KindLocal, ObjectKind, ObjectRect } from "../src/kinds/world";
import { LAYER_IDLE_MS } from "../src/kit/layer";
import { isMissingRecord } from "../src/missing/layout";
import { defineObject } from "../src/object";
import { type Palette, themeFrom } from "../src/theme";
import { fakeDevice, installGpuFlags } from "./fake-gpu";

const PALETTE: Palette = { canvasBg: { token: "--bg", css: "#fafafa" }, select: { token: "--sel", css: "#3080ff" } };
const VIEW = { w: 1200, h: 800, dpr: 1 };
/** A WGSL the fake device refuses (a validation error raised into the scope open when it is made). */
const BROKEN = "fn broken() { nothing_declares_this; }";

/** What of the faulty kind throws now (switched on and off by a test), and what it was asked. */
interface Fault {
  prepare?: boolean;
  drawRange?: boolean;
  gpu?: boolean;
  follow?: boolean;
  forget?: boolean;
  keeps?: boolean;
  held?: boolean;
}
const fault: Fault = {};
const asked: string[] = [];
let device: GPUDevice | undefined;

/** A kind whose pass draws nothing (a debug group a range) and whose calls throw on the test's word; its desk state charges the raster budget. */
function faultyKind(name: string, own: Fault | null): ObjectKind<ObjectRect> {
  const f = (k: keyof Fault): boolean => own !== null && own[k] === true;
  const pass = (label: string): KindPass => ({
    spawn: () => pass(`${label}+`),
    prepare: (_e, _s, records) => {
      asked.push(`${name} prepare`);
      if (f("gpu")) device?.createShaderModule({ code: BROKEN, label: `${name} broken` });
      if (f("prepare")) throw new Error(`${name}: its prepare throws on purpose`);
      return records.length;
    },
    drawRange: (p, first, end) => {
      asked.push(`${name} drawRange`);
      if (f("drawRange")) throw new Error(`${name}: its drawRange throws on purpose`);
      p.pushDebugGroup(`kind ${label} ${first}-${end}`);
      p.popDebugGroup();
    },
    dispose: () => { asked.push(`${name} pass disposed`); },
  });
  return {
    name, stratum: "things", reach: 0,
    create: async () => pass(name),
    resolve: (c) => c.rect,
    record: (_G, ctx) => ({ e: ctx.entity }),
    hit: (G, wx, wy) => (Math.abs(wx - G.cx) <= G.w / 2 && Math.abs(wy - G.cy) <= G.h / 2 ? "content" : null),
    local: (host: KindHost): KindLocal => {
      const evicted: string[] = [];
      return {
        tick: () => {
          // two rasters charged a tick, over the test's small budget: the trim asks `keeps` of each
          host.budget?.charge(name, `${name}:a`, 600, () => { evicted.push("a"); });
          host.budget?.charge(name, `${name}:b`, 600, () => { evicted.push("b"); });
          return false;
        },
        due: () => Number.POSITIVE_INFINITY,
        forget: (e) => { asked.push(`${name} forget ${e as number}`); if (f("forget")) throw new Error(`${name}: its forget throws on purpose`); },
        keeps: (key) => { asked.push(`${name} keeps ${key}`); if (f("keeps")) throw new Error(`${name}: its keeps throws on purpose`); return false; },
        held: (_e, events) => { asked.push(`${name} held ${events.length}`); if (f("held")) throw new Error(`${name}: its held throws on purpose`); },
        dispose: () => { asked.push(`${name} local disposed`); },
      };
    },
    open: { extent: (c) => c.rect },
  };
}

/** A driver that follows every step it is asked (never idle), throwing on the test's word. */
const follower = (name: string, own: Fault | null) => (): KindDriver => ({
  follow: () => { asked.push(`${name} follow`); if (own !== null && own.follow === true) throw new Error(`${name}: its follow throws on purpose`); },
  idle: () => false,
});

const FAULTY = defineObject({ type: "lt3.faulty", version: 1, props: {}, size: { w: 200, h: 120 }, kind: faultyKind("faulty", fault), drivers: follower("faulty", fault) });
const SOUND = defineObject({ type: "lt3.sound", version: 1, props: {}, size: { w: 200, h: 120 }, kind: faultyKind("sound", null), drivers: follower("sound", null) });
/** Two kinds that hang on the tray, each specimen drawn with its kind's desk state (`tray.local`) — the first's `forget` faulted. */
const HANG = { w: 110, h: 110, accessory: "hook" as const, pegs: [[0, -0.5]] as [number, number][] };
const TRAYED = defineObject({ type: "lt3.trayed", version: 1, props: {}, size: { w: 200, h: 120 }, kind: faultyKind("trayed", fault), tray: { label: "Trayed", local: true, order: 0, hang: HANG } });
const CALM = defineObject({ type: "lt3.calm", version: 1, props: {}, size: { w: 200, h: 120 }, kind: faultyKind("calm", null), tray: { label: "Calm", local: true, order: 1, hang: HANG } });

/** A desk of the faulty kind and a sound one on the fake device — the engine's ops in the mount context — stepped on a clock of its own. */
async function mountDesk(more: readonly WidgetType[] = []) {
  const log: string[] = [];
  const fake = fakeDevice(log, { refuse: (code) => (code === BROKEN ? "unresolved value 'nothing_declares_this'" : undefined) });
  device = fake.device;
  Object.assign(fake.device, { lost: new Promise(() => {}), destroy: () => {} });
  const adapter = { features: new Set<string>(), requestDevice: async () => fake.device };
  const gpu = { requestAdapter: async () => adapter, getPreferredCanvasFormat: () => "bgra8unorm" } as unknown as GPU;
  const context = { configure: () => {}, unconfigure: () => {}, getCurrentTexture: () => ({ createView: () => ({ label: "swap" }), width: 1, height: 1 }) };
  const canvas = { style: {}, width: 1, height: 1, clientWidth: VIEW.w, clientHeight: VIEW.h, getContext: () => context, remove: () => {} };
  const node = () => ({ style: {}, setAttribute: () => {}, addEventListener: () => {}, removeEventListener: () => {}, remove: () => {} });
  const container = { ownerDocument: { createElement: (tag: string) => (tag === "canvas" ? canvas : node()), defaultView: undefined, addEventListener: () => {}, removeEventListener: () => {} }, prepend: () => {}, appendChild: () => {}, addEventListener: () => {}, removeEventListener: () => {} } as unknown as HTMLElement;
  vi.stubGlobal("navigator", { gpu });
  const frameFaults: string[] = [];
  const objects: WidgetType[] = [FAULTY, SOUND, ...more];
  const ce = createCanvasEngine({ widgets: objects, onReflectorFault: (name, err) => { frameFaults.push(`${name}: ${String(err)}`); } });
  ce.docs.create();
  ce.world.setResource(Viewport, VIEW);
  const handle: DeskLayerHandle = deskLayer({ gpu, objects, theme: themeFrom("light", PALETTE), palette: PALETTE, ambient: "still", rasterBudget: 1000 })({
    host: { container }, world: ce.world, frame: ce.engine.frame, catalog: ce.catalog, heldPose: ce.stack.heldPose, framePick: ce.stack.framePick, trayPose: ce.stack.trayPose, ops: ce.ops,
  });
  const unregister = ce.engine.registerReflector(handle.reflector);
  for (let i = 0; i < 100 && handle.status().state === "pending"; i++) await new Promise((r) => setTimeout(r, 5));
  let clock = performance.now();
  /** One step on the desk's clock — and the microtasks it queued (a put-down the layer asked for) run before the next. */
  const step = async (n = 1, ms = 16): Promise<void> => { for (let i = 0; i < n; i++) { clock += ms; ce.engine.step(clock); await Promise.resolve(); } };
  /** One drawn frame: the builder's records made again (a law tuned), so every kind is asked every frame. */
  const frame = async (): Promise<void> => { handle.builder.invalidate(); await step(); };
  const at = (type: string, x: number, y: number): Entity => ce.ops.spawnWidget(type, { x, y, undoable: false }) as Entity;
  const row = (e: Entity): SlotObject | undefined => handle.lastInputs()?.objects?.find((o) => o.key === (e as number));
  const kinds = (): Readonly<Record<string, number>> | undefined => handle.stats().frame?.kinds;
  const put = async (kind: "down" | "move" | "up", x: number, y: number, buttons: number, mods: InputMods = NO_MODS): Promise<void> => {
    ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods });
    await step();
  };
  return { ce, handle, log, fake, step, frame, at, row, kinds, put, frameFaults, dispose: () => { unregister(); handle.dispose(); ce.dispose(); } };
}

const said = (spy: { mock: { calls: unknown[][] } }, kind: string): string[] => spy.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(`"${kind}"`));

describe("the render half and the rest of a kind's calls under the ladder (design-019 §8, M24 LT3)", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); vi.unstubAllGlobals(); });
  afterEach(() => { vi.restoreAllMocks(); for (const k of Object.keys(fault) as (keyof Fault)[]) fault[k] = false; asked.length = 0; });

  it("a `prepare` that throws frame after frame: a strike each, struck after the frame it broke — drawn without its objects, the other kind drawn, no frame lost; at the third MISSING, said once, its objects in the missing face from the next frame", async () => {
    const warns = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = await mountDesk();
    try {
      const faulty = d.at(FAULTY.type, 100, 100);
      const sound = d.at(SOUND.type, 500, 100);
      await d.frame(); await d.frame();
      expect(d.kinds()).toEqual({ faulty: 1, sound: 1 });
      fault.prepare = true;
      for (let n = 1; n <= 3; n++) {
        const redraws = d.handle.redraws();
        await d.frame();
        expect(d.handle.redraws()).toBe(redraws + 1);   // the frame was drawn
        expect(d.kinds()).toEqual({ faulty: 0, sound: 1 });   // without the faulty kind's object, the sound one drawn
        expect(said(warns, "faulty").length).toBe(Math.min(n, 2));
        if (n < 3) expect(d.handle.status().faults).toBeUndefined();
      }
      expect(d.handle.status().faults).toEqual([{ kind: "faulty", reason: "its `prepare` threw (strike 3 of 3): faulty: its prepare throws on purpose" }]);
      // …struck AFTER the frame it broke: the third frame's draws were all made — the sound kind's among them — before its pass was let go
      expect(asked.lastIndexOf("sound drawRange")).toBeLessThan(asked.indexOf("faulty pass disposed"));
      expect(said(errors, "faulty").filter((m) => m.includes("is MISSING"))).toHaveLength(1);
      expect(asked).toContain("faulty pass disposed");
      expect(asked).toContain("faulty local disposed");
      // from the next frame: its object in the missing face, nothing of it asked again; the sound kind draws on
      asked.length = 0;
      await d.frame();
      expect(isMissingRecord(d.row(faulty)?.record)).toBe(true);
      expect(d.row(sound)).toBeDefined();
      expect(asked.filter((a) => a.startsWith("faulty"))).toEqual([]);
      expect(d.frameFaults).toEqual([]);   // never a lost frame: the reflector never faulted
    } finally { d.dispose(); }
  });

  it("a `drawRange` that throws: the same ladder, the status naming `drawRange`; the sound kind drawn every frame", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = await mountDesk();
    try {
      d.at(FAULTY.type, 100, 100);
      d.at(SOUND.type, 500, 100);
      await d.frame();
      fault.drawRange = true;
      for (let n = 1; n <= 3; n++) {
        d.log.length = 0;
        await d.frame();
        expect(d.log.filter((l) => l.startsWith("debug kind sound"))).toHaveLength(1);
      }
      expect(d.handle.status().faults?.[0]).toEqual({ kind: "faulty", reason: "its `drawRange` threw (strike 3 of 3): faulty: its drawRange throws on purpose" });
      expect(d.frameFaults).toEqual([]);
    } finally { d.dispose(); }
  });

  it("a driver whose `follow` throws: a strike a step against its kind — the other kind's driver follows each — three, and the kind is missing (`follow`), its driver parked", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = await mountDesk();
    try {
      d.at(FAULTY.type, 100, 100);
      d.at(SOUND.type, 500, 100);
      await d.frame();
      fault.follow = true;
      asked.length = 0;
      await d.frame(); await d.frame(); await d.frame();
      expect(asked.filter((a) => a === "sound follow")).toHaveLength(3);
      expect(d.handle.status().faults?.[0]).toEqual({ kind: "faulty", reason: "its `follow` threw (strike 3 of 3): faulty: its follow throws on purpose" });
      asked.length = 0;
      await d.frame();
      expect(asked.filter((a) => a === "faulty follow")).toEqual([]);   // parked
      expect(asked.filter((a) => a === "sound follow")).toHaveLength(1);
      expect(d.frameFaults).toEqual([]);
    } finally { d.dispose(); }
  });

  it("a `forget` that throws: a strike against the kind, the builder lets go of the rest; a `keeps` that throws while the budget trims is struck ONCE a trim, after it, its keys not kept", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = await mountDesk();
    try {
      const a = d.at(FAULTY.type, 100, 100);
      d.at(SOUND.type, 500, 100);
      await d.frame();
      fault.forget = true;
      d.ce.ops.setSelection([a]);
      d.ce.ops.deleteSelection();
      // its ghost fades first (the builder's), then its kind's state is told to let go — and throws
      for (let i = 0; i < 120 && !asked.includes(`faulty forget ${a as number}`); i++) await d.frame();
      expect(asked.filter((x) => x === `faulty forget ${a as number}`)).toHaveLength(1);
      expect(d.frameFaults).toEqual([]);
      expect(d.handle.status().faults).toBeUndefined();   // one strike, said on the console alone
      fault.forget = false;
      // keeps: the budget (1,000 B) is over once the two kinds charge 2,400 B — the trim asks keeps of every key it may evict
      fault.keeps = true;
      d.at(FAULTY.type, 100, 300);
      asked.length = 0;
      await d.frame();
      expect(asked.filter((x) => x.startsWith("faulty keeps"))).toHaveLength(1);   // asked once in the trim, then no more
      expect(asked.filter((x) => x.startsWith("sound keeps")).length).toBeGreaterThan(0);
      await d.frame();
      expect(d.handle.status().faults?.[0]).toEqual({ kind: "faulty", reason: "its `keeps` threw (strike 3 of 3): faulty: its keeps throws on purpose" });
      expect(d.frameFaults).toEqual([]);
    } finally { d.dispose(); }
  });

  it("a tray specimen's desk state let go once the drawer has been shut a while: a `forget` that throws is a strike against its kind — the other specimen's let go as ever, no frame lost", async () => {
    const warns = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = await mountDesk([TRAYED, CALM]);
    try {
      await d.step(2);
      d.handle.tray.open();
      for (let i = 0; i < 60; i++) { await d.step(); await new Promise((r) => setTimeout(r, 0)); }   // the drawer out, the specimens drawn
      expect(d.handle.tray.state().specimens.map((q) => q.type)).toEqual([TRAYED.type, CALM.type]);
      fault.forget = true;
      asked.length = 0;
      d.handle.tray.close();
      await d.step(60);                    // the drawer home
      await d.step(1, LAYER_IDLE_MS + 100);   // shut a while: its specimens' desk state let go
      await d.step(2);
      const forgot = asked.filter((x) => x.includes(" forget ")).map((x) => x.replace(/\d+$/, "N"));
      expect(forgot.sort()).toEqual(["calm forget N", "trayed forget N"]);
      expect(said(warns, "trayed").filter((m) => m.includes("forget"))).toHaveLength(1);   // one strike, said
      expect(d.handle.status().faults).toBeUndefined();
      expect(d.frameFaults).toEqual([]);
    } finally { d.dispose(); }
  });

  it("a `held` that throws while its object is in hand: three frames of the hand's input and the kind is MISSING (`held`) — the hand PUT DOWN, its `up` told to no one", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = await mountDesk();
    try {
      const e = d.at(FAULTY.type, 300, 200);
      await d.step(2);
      d.ce.ops.open(e);
      for (let i = 0; i < 120 && d.ce.stack.heldPose.current?.frame(e)?.settled !== true; i++) await d.step();
      const f = d.ce.stack.heldPose.current?.frame(e);
      if (f === undefined) throw new Error("never settled");
      fault.held = true;
      asked.length = 0;
      await d.put("move", f.cx, f.cy, 0);
      await d.put("down", f.cx, f.cy, 1);   // a press of the kind's, down when the hand lets go
      await d.put("move", f.cx + 5, f.cy, 1);
      expect(asked.filter((x) => x.startsWith("faulty held"))).toHaveLength(3);
      expect(d.handle.status().faults?.[0]).toEqual({ kind: "faulty", reason: expect.stringMatching(/^its `held` threw on entity \d+ \(strike 3 of 3\): faulty: its held throws on purpose$/) });
      await d.step(2);
      expect(heldEntity(d.ce.world)).toBeUndefined();   // put down
      asked.length = 0;
      await d.put("up", f.cx + 5, f.cy, 0);
      await d.step(2);
      expect(asked.filter((x) => x.startsWith("faulty"))).toEqual([]);   // its up told to no one
      expect(d.frameFaults).toEqual([]);
    } finally { d.dispose(); }
  });

  it("a GPU error raised in a kind's `prepare` — caught first by its slot's ONE scope beside another kind (said: one of the two; each kind's own scope kept from then), then by its own — is a strike against it, the layer never `degraded`: missing at the third; the slot's scope given back after its frames", async () => {
    const warns = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = await mountDesk();
    const answered = (): Promise<unknown> => new Promise((r) => setTimeout(r, 0));   // the device answers a scope later
    const scopes = (): string | undefined => d.handle.ground()?.root.boundary?.scopes;
    try {
      d.at(FAULTY.type, 100, 100);
      d.at(SOUND.type, 500, 100);
      await d.frame();
      expect(scopes()).toBe("slot");
      fault.gpu = true;
      await d.frame();
      await answered();
      const said = warns.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("a GPU error in the prepare of one of"));
      expect(said).toEqual([expect.stringContaining(`one of "faulty", "sound" — each kind's own scope kept for the next 120 frames`)]);
      expect(scopes()).toBe("kind");
      expect(d.handle.status().faults).toBeUndefined();   // unattributed: no one's strike
      // each kind's own scope: the faulty kind's error its own, struck at the next frame's head — three, and it is missing
      for (let n = 0; n < 4; n++) { await d.frame(); await answered(); }
      expect(d.handle.status()).toEqual({ state: "ready", faults: [{ kind: "faulty", reason: "its `prepare` threw (strike 3 of 3): a GPU error in its own scope — GPUValidationError: Error while parsing WGSL: unresolved value 'nothing_declares_this'" }] });
      expect(d.fake.uncaptured).toEqual([]);
      for (let n = 0; n < 120 && scopes() === "kind"; n++) await d.frame();
      expect(scopes()).toBe("slot");
    } finally { d.dispose(); }
  });
});
