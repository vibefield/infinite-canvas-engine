// @vitest-environment node
// FAULT CONTAINMENT PER KIND (petition I24; VibeField DK-D22 — a plugin's kind runs in the renderer realm on the host's device,
// contained per kind by ICE): one kind's fault is that kind's — drawn as MISSING, said once, never the desk down. The desk layer is
// mounted as a host mounts it, on a fake device that REFUSES the fault fixture's WGSL as a compiler does (examples/desk-clock
// `DeskClockBroken`: a function naming what nothing declares — the module raises a validation error into the scope open when it was
// made, else to the device's uncaptured handler), its reflector registered, frames drawn through it; the working desk clock beside
// the broken one is the "other kind" that must go on drawing. And an object whose type has no kind wears the same face.
import { createCanvasEngine, defineWidget, type Entity, Viewport, type WidgetType } from "@ice/core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { BROKEN_WGSL_TOKEN, brokenClockKind, DeskClock, DeskClockBroken } from "../../../examples/desk-clock/src/index";
import { KIND_MISSING } from "../src/faults";
import type { SlotObject } from "../src/ground";
import { deskLayer, type DeskLayerHandle, type DeskLayerStatus } from "../src/host/layer";
import type { ObjectKind } from "../src/kinds/world";
import { isMissingRecord } from "../src/missing/layout";
import { MISSING_KIND } from "../src/missing/object";
import { defineObject } from "../src/object";
import { type Palette, themeFrom } from "../src/theme";
import { fakeDevice, installGpuFlags } from "./fake-gpu";

const PALETTE: Palette = { canvasBg: { token: "--bg", css: "#fafafa" }, select: { token: "--sel", css: "#3080ff" } };
const VIEW = { w: 1200, h: 800, dpr: 1 };

/** A desk over `objects` on a fake device that refuses the broken WGSL — mounted, its status heard from the start, its frames drawn. */
async function mountDesk(objects: WidgetType[], opts: { readonly gpuLedger?: boolean } = {}) {
  const log: string[] = [];
  const fake = fakeDevice(log, { refuse: (code) => (code.includes(BROKEN_WGSL_TOKEN) ? `unresolved value '${BROKEN_WGSL_TOKEN}'` : undefined) });
  const { device } = fake;
  Object.assign(device, { lost: new Promise(() => {}), destroy: () => {} });
  // every pipeline the device is asked to make, by label (the missing face's is made only when a face is first asked for)
  const pipelines: string[] = [];
  const dev = device as unknown as { createRenderPipeline: (d: GPURenderPipelineDescriptor) => unknown; createRenderPipelineAsync: (d: GPURenderPipelineDescriptor) => Promise<unknown> };
  const makeSync = dev.createRenderPipeline.bind(dev);
  const makeAsync = dev.createRenderPipelineAsync.bind(dev);
  dev.createRenderPipeline = (d) => { pipelines.push(d.label ?? ""); return makeSync(d); };
  dev.createRenderPipelineAsync = (d) => { pipelines.push(d.label ?? ""); return makeAsync(d); };
  const adapter = { features: new Set<string>(), requestDevice: async () => device };
  const gpu = { requestAdapter: async () => adapter, getPreferredCanvasFormat: () => "bgra8unorm" } as unknown as GPU;
  const context = { configure: () => {}, unconfigure: () => {}, getCurrentTexture: () => ({ createView: () => ({ label: "swap" }), width: 1, height: 1 }) };
  const canvas = { style: {}, width: 1, height: 1, clientWidth: VIEW.w, clientHeight: VIEW.h, getContext: () => context, remove: () => {} };
  const node = () => ({ style: {}, setAttribute: () => {}, addEventListener: () => {}, removeEventListener: () => {}, remove: () => {} });
  const container = { ownerDocument: { createElement: (tag: string) => (tag === "canvas" ? canvas : node()), defaultView: undefined, addEventListener: () => {}, removeEventListener: () => {} }, prepend: () => {}, appendChild: () => {}, addEventListener: () => {}, removeEventListener: () => {} } as unknown as HTMLElement;
  vi.stubGlobal("navigator", { gpu });
  const ce = createCanvasEngine({ widgets: objects });
  ce.docs.create();
  const heard: DeskLayerStatus[] = [];
  const handle: DeskLayerHandle = deskLayer({ gpu, objects, theme: themeFrom("light", PALETTE), palette: PALETTE, ...(opts.gpuLedger === true ? { gpuLedger: true } : {}) })({ host: { container }, world: ce.world, frame: ce.engine.frame, catalog: ce.catalog, framePick: ce.stack.framePick });
  handle.onStatus((s) => heard.push(s));   // heard from the mount on: the boot's own word is the first
  const unregister = ce.engine.registerReflector(handle.reflector);
  for (let i = 0; i < 100 && handle.status().state === "pending"; i++) await new Promise((r) => setTimeout(r, 5));
  /** One engine step — the reflector flushes. */
  const step = (): void => { ce.engine.step(performance.now()); };
  /** One drawn frame (the viewport written: a frame is owed). */
  const frame = (): void => { ce.world.setResource(Viewport, VIEW); step(); };
  const at = (type: string, x: number, y: number): Entity => ce.ops.spawnWidget(type, { x, y, undoable: false }) as Entity;
  const row = (e: Entity): SlotObject | undefined => handle.lastInputs()?.objects?.find((o) => o.key === (e as number));
  const kinds = (): Readonly<Record<string, number>> | undefined => handle.stats().frame?.kinds;
  const pick = (e: Entity, x: number, y: number): string | undefined => ce.stack.framePick.current?.hit(e, x, y);
  return { ce, handle, log, pipelines, heard, fake, step, frame, at, row, kinds, pick, dispose: () => { unregister(); handle.dispose(); ce.dispose(); } };
}

/** What the desk said on the console, by level, about `kind`. */
const said = (spy: { mock: { calls: unknown[][] } }, kind: string): string[] => spy.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(`"${kind}"`));

describe("fault containment per kind (petition I24)", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => {
    undo.push(installGpuFlags());
    // the page's ImageData and createImageBitmap (the capture door's last step; Node has neither)
    vi.stubGlobal("ImageData", class { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} });
    vi.stubGlobal("createImageBitmap", async (img: { width: number; height: number }) => ({ width: img.width, height: img.height, close() {} }));
  });
  afterAll(() => { for (const u of undo.splice(0)) u(); vi.unstubAllGlobals(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("a kind whose WGSL does not compile is REFUSED at create: the others draw, its objects wear the missing face, ONE notice names it, status ready", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = await mountDesk([DeskClock, DeskClockBroken]);
    try {
      // ready — the refusal named — and the compile error was the kind's own scope's: nothing reached the device's handler
      expect(d.handle.status().state).toBe("ready");
      expect(d.handle.status().faults).toEqual([{ kind: "desk-clock-broken", reason: expect.stringMatching(/^refused at create — WGSL .*unresolved value 'desk_clock_broken_on_purpose'/) }]);
      expect(d.fake.uncaptured).toEqual([]);
      // said ONCE: the boot's own `ready` carried it — one notice — and one console line naming it
      expect(d.heard).toEqual([d.handle.status()]);
      expect(said(errors, "desk-clock-broken").filter((m) => m.includes("is MISSING"))).toHaveLength(1);
      const clock = d.at(DeskClock.type, 100, 100);
      const broken = d.at(DeskClockBroken.type, 400, 100);
      d.frame();
      // the other kind draws by its own pass; the refused kind's object by the missing face, under its own kind's name
      expect(d.kinds()).toEqual({ "desk-clock": 1, "desk-clock-broken": 1 });
      expect(isMissingRecord(d.row(broken)?.record)).toBe(true);
      expect(d.row(broken)?.kind).toBe("desk-clock-broken");
      expect(isMissingRecord(d.row(clock)?.record)).toBe(false);
      expect(d.log).toContain("pipeline desk-clock/clocks");
      expect(d.log).toContain("pipeline desk/missing");
      // pickable: its box is the object itself (a tap selects it, a drag moves it); beside its box, nothing of it
      expect(d.pick(broken, 400 + 140, 100 + 10)).toBe("content");
      expect(d.pick(broken, 400 + 160, 100 + 10)).toBe("outside");
      // the ledger: `due().kinds` names it, missing — and nothing of it runs (no desk state, no pass reached)
      expect(d.handle.due(performance.now()).kinds["desk-clock-broken"]).toBe(KIND_MISSING);
      expect(d.handle.local("desk-clock-broken")).toBeUndefined();
      expect(d.handle.ground()?.pass("desk-clock-broken")).toBeUndefined();
      // at rest a missing kind costs nothing: once the desk has settled (the spawn's own frame after the first), steps that change
      // nothing draw nothing and submit nothing (idle-zero)
      d.step(); d.step();
      const redraws = d.handle.redraws();
      const submits = d.fake.queue.submits;
      for (let i = 0; i < 5; i++) d.step();
      expect(d.handle.redraws()).toBe(redraws);
      expect(d.fake.queue.submits).toBe(submits);
      // and never said again
      d.frame(); d.frame();
      expect(d.heard).toHaveLength(1);
      expect(said(errors, "desk-clock-broken").filter((m) => m.includes("is MISSING"))).toHaveLength(1);
    } finally { d.dispose(); }
  });

  it("a `record` that throws from the third frame: a strike a frame and the frame goes on without it; at THREE the kind is MISSING — said once, its pass and its desk state disposed, its memory let go — and its object wears the face", async () => {
    const warns = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    // the fault fixture's record-throwing clock, its record counted and its pass's and desk state's dispose watched
    const base = brokenClockKind({ name: "test-faulty", recordFrom: 3 });
    let records = 0;
    const disposed: string[] = [];
    const kind: ObjectKind = {
      ...base,
      create: async (device, format, mat) => {
        const pass = await base.create(device, format, mat);
        const was = pass.dispose.bind(pass);
        pass.dispose = () => { disposed.push("pass"); was(); };
        return pass;
      },
      local: (host) => {
        const local = (base.local as NonNullable<ObjectKind["local"]>)(host);
        const was = local.dispose?.bind(local);
        local.dispose = () => { disposed.push("local"); was?.(); };
        return local;
      },
      record: (G, ctx) => { records += 1; return base.record(G as never, ctx); },
    };
    const Faulty = defineObject({ type: "test.faulty-clock", version: 1, props: {}, size: { w: 150, h: 150 }, kind });
    const d = await mountDesk([DeskClock, Faulty], { gpuLedger: true });
    try {
      const clock = d.at(DeskClock.type, 100, 100);
      const faulty = d.at(Faulty.type, 400, 100);
      // every frame remakes every record (a law tuned — `invalidate`), so `record` is asked once a frame
      const frame = (): void => { d.handle.builder.invalidate(); d.frame(); };
      const ledger = (): number => d.handle.gpuMemory()?.read().byLabel["desk-clock"]?.buffers ?? 0;
      frame(); frame();
      expect(records).toBe(2);
      expect(d.kinds()).toEqual({ "desk-clock": 1, "test-faulty": 1 });
      const buffers = ledger();   // the two clocks' stores: the working one's and the faulty one's
      const heard = d.heard.length;
      // the third frame's record throws: strike 1 — the frame goes on WITHOUT its object (no row), the other kind drawn
      const redraws = d.handle.redraws();
      frame();
      expect(records).toBe(3);
      expect(d.handle.redraws()).toBe(redraws + 1);
      expect(d.kinds()).toEqual({ "desk-clock": 1, "test-faulty": 0 });
      expect(d.row(faulty)).toBeUndefined();
      expect(d.row(clock)).toBeDefined();
      // …and the slot it was writing is reset, not left half-made: no geometry, made afresh next time
      expect(d.handle.geometryOf(faulty)).toBeUndefined();
      expect(d.handle.status().faults).toBeUndefined();
      frame();   // strike 2
      expect(records).toBe(4);
      expect(d.heard).toHaveLength(heard);   // nothing said to the host before the third
      expect(said(warns, "test-faulty")).toHaveLength(2);
      expect(said(warns, "test-faulty")[1]).toContain("strike 2 of 3");
      frame();   // strike 3: MISSING
      expect(records).toBe(5);
      expect(d.handle.status()).toEqual({ state: "ready", faults: [{ kind: "test-faulty", reason: expect.stringMatching(/^its `record` threw on entity \d+ \(strike 3 of 3\): test-faulty: its record throws on purpose \(call 5\)$/) }] });
      expect(d.heard).toHaveLength(heard + 1);   // said ONCE
      expect(d.heard[heard]).toEqual(d.handle.status());
      expect(said(errors, "test-faulty").filter((m) => m.includes("is MISSING"))).toHaveLength(1);
      // its dispose is still called — its pass's and its desk state's — and the memory ledger counts its store no more
      expect(disposed.sort()).toEqual(["local", "pass"]);
      expect(ledger()).toBe(buffers - 2);
      // from the next frame its object wears the missing face, and nothing of it is asked again
      frame();
      expect(d.kinds()).toEqual({ "desk-clock": 1, "test-faulty": 1 });
      expect(isMissingRecord(d.row(faulty)?.record)).toBe(true);
      frame(); frame();
      expect(records).toBe(5);
      expect(d.heard).toHaveLength(heard + 1);
      expect(d.handle.due(performance.now()).kinds["test-faulty"]).toBe(KIND_MISSING);
      expect(d.handle.local("test-faulty")).toBeUndefined();
      // the capture door draws the frame's inputs once more: the face is drawn there too, and nothing throws (I23 under I24)
      expect(await d.handle.capture({ scale: 0.25 })).toMatchObject({ width: 300, height: 200 });
    } finally { d.dispose(); }
  });

  it("a `hit` that throws: the pick MISSES that object and nothing else — the object under it is picked; three strikes and the kind is missing, picked by its box", async () => {
    const warns = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const Unhit = defineObject({ type: "test.unhit-clock", version: 1, props: {}, size: { w: 150, h: 150 }, kind: brokenClockKind({ name: "test-unhit", hit: true }) });
    const d = await mountDesk([DeskClock, Unhit]);
    try {
      const under = d.at(DeskClock.type, 100, 100);
      const over = d.at(Unhit.type, 100, 100);   // the same place, later: above it
      d.frame();
      // where both lie, the faulty kind's `hit` throws — a miss for it alone — and the clock under it answers
      expect(d.pick(over, 175, 175)).toBe("outside");
      expect(d.pick(under, 175, 175)).toBe("content");
      expect(said(warns, "test-unhit")).toHaveLength(1);
      expect(said(warns, "test-unhit")[0]).toContain("`hit`");
      expect(d.handle.status().faults).toBeUndefined();
      expect(d.pick(over, 175, 175)).toBe("outside");
      expect(d.pick(over, 175, 175)).toBe("outside");   // the third
      expect(d.handle.status().faults?.map((f) => f.kind)).toEqual(["test-unhit"]);
      // until its next frame it is drawn as nothing it can be picked by; from it, by the missing face's box — the object itself
      expect(d.pick(over, 175, 175)).toBeUndefined();
      d.frame();
      expect(d.pick(over, 175, 175)).toBe("content");
      expect(d.pick(under, 175, 175)).toBe("content");
    } finally { d.dispose(); }
  });

  it("an object whose type has NO KIND wears the same face — drawn, pickable by its box, said once a type; no kind faulted, the status untouched", async () => {
    const warns = vi.spyOn(console, "warn").mockImplementation(() => {});
    // a GHOST STUB: a registered type with no object binding — VibeField's for an absent plugin's type (DK r5: "kindless entities, which on
    // the desk are invisible") — beside the desk clock
    const Ghost = defineWidget({ type: "test.ghost-stub", version: 1, props: {} });
    const d = await mountDesk([DeskClock, Ghost]);
    try {
      const ghost = d.ce.ops.spawnWidget(Ghost.type, { x: 400, y: 100, w: 120, h: 80, undoable: false }) as Entity;
      const other = d.ce.ops.spawnWidget(Ghost.type, { x: 700, y: 100, w: 60, h: 60, undoable: false }) as Entity;
      d.frame();
      expect(d.kinds()).toEqual({ "desk-clock": 0, [MISSING_KIND]: 2 });
      expect(d.row(ghost)?.kind).toBe(MISSING_KIND);
      expect(isMissingRecord(d.row(ghost)?.record)).toBe(true);
      expect(d.row(ghost)?.record).toMatchObject({ cx: 460, cy: 140, hx: 60, hy: 40 });
      expect(d.pick(ghost, 470, 150)).toBe("content");
      expect(d.pick(ghost, 530, 150)).toBe("outside");
      expect(isMissingRecord(d.row(other)?.record)).toBe(true);
      expect(said(warns, "test.ghost-stub")).toHaveLength(1);
      expect(d.handle.status()).toEqual({ state: "ready" });
      expect(d.log).toContain("pipeline desk/missing");
    } finally { d.dispose(); }
  });

  it("a kind whose GPU error comes AFTER its first await — its create resolves, its pipeline failed validation — is found by the window and refused alone; the rest stand", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    // a kind that compiles its broken module late (after an await) and never asks the compiler's word: its create RESOLVES, its error
    // lands in no scope of its own — only the kinds' window holds it, and the kind is found by being made again alone
    const base = brokenClockKind({ name: "test-late" });
    let made = 0;
    const late: ObjectKind = {
      ...base,
      create: async (device, format, mat) => {
        made += 1;
        await Promise.resolve();
        device.createShaderModule({ code: `fn late() -> f32 { return ${BROKEN_WGSL_TOKEN}; }`, label: "test-late/module" });
        return base.create(device, format, mat);
      },
    };
    const Late = defineObject({ type: "test.late-clock", version: 1, props: {}, size: { w: 150, h: 150 }, kind: late });
    const d = await mountDesk([DeskClock, Late]);
    try {
      expect(d.handle.status().state).toBe("ready");
      expect(d.handle.status().faults).toEqual([{ kind: "test-late", reason: expect.stringMatching(/^refused at create — a GPU error while its pass was made: .*unresolved value 'desk_clock_broken_on_purpose'/) }]);
      expect(d.fake.uncaptured).toEqual([]);
      expect(made).toBe(2);   // once beside the others, once alone (the window's attribution)
      const clock = d.at(DeskClock.type, 100, 100);
      const lateOne = d.at(Late.type, 400, 100);
      d.frame();
      expect(d.kinds()).toEqual({ "desk-clock": 1, "test-late": 1 });
      expect(isMissingRecord(d.row(lateOne)?.record)).toBe(true);
      expect(isMissingRecord(d.row(clock)?.record)).toBe(false);
      expect(said(errors, "test-late").filter((m) => m.includes("is MISSING"))).toHaveLength(1);
    } finally { d.dispose(); }
  });

  it("a desk where nothing is missing makes nothing of the missing face — no pipeline, no buffer — and its frames are the frames they were", async () => {
    const d = await mountDesk([DeskClock], { gpuLedger: true });
    try {
      d.at(DeskClock.type, 100, 100);
      d.frame();
      expect(d.kinds()).toEqual({ "desk-clock": 1 });
      expect(d.pipelines).toContain("desk-clock/clocks");
      expect(d.pipelines.filter((l) => l.startsWith("desk/missing"))).toEqual([]);
      expect(d.log.some((l) => l.includes("desk/missing"))).toBe(false);
      expect(Object.keys(d.handle.gpuMemory()?.read().byLabel ?? {}).some((k) => k.startsWith("desk/missing"))).toBe(false);
      expect(d.handle.status()).toEqual({ state: "ready" });
    } finally { d.dispose(); }
  });
});
