// @vitest-environment node
// THE KIND SET (petition I25 — the rule, measured; the door deferred): a desk's kinds are the set it was MOUNTED with — compiled at the
// layer's mount (`Ground.create`), fixed for its life; a host that changes the set remounts the layer on a new generation. The desk layer
// is mounted as a host mounts it, on the fake device (fake-gpu.ts — a new one each mount, as a layer acquires its own), over a HOST'S
// CATALOG — the structural `catalog` a layer reads once, at its mount — that grows after it: a type registered after the mount adds no
// kind, its objects wear I24's missing face and the layer says so once, naming the type and the remount; the remount on the grown
// catalog draws them by their own kind. And what a remount costs and keeps: the boot's milestones (`perf().boot`), the document
// untouched, the memory ledger at zero after each unmount — a refused and a quarantined kind's generation included.
import { type CanvasEngine, createCanvasEngine, type Entity, NO_MODS, openTray, PrefabId, specimensOf, Tray, trayCategories, trayEntity, trayEntryCount, Viewport, type WidgetType } from "@ice/core";
import { layTray, type TrayItem } from "@ice/kernel";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { BROKEN_WGSL_TOKEN, brokenClockKind, DeskClock, DeskClockBroken } from "../../../examples/desk-clock/src/index";
import type { SlotObject } from "../src/ground";
import { deskLayer, type DeskLayerHandle } from "../src/host/layer";
import { isMissingRecord } from "../src/missing/layout";
import { MISSING_KIND } from "../src/missing/object";
import { defineObject } from "../src/object";
import { type Palette, themeFrom } from "../src/theme";
import { fakeDevice, installGpuFlags } from "./fake-gpu";

const PALETTE: Palette = { canvasBg: { token: "--bg", css: "#fafafa" }, select: { token: "--sel", css: "#3080ff" } };
const VIEW = { w: 1200, h: 800, dpr: 1 };

/** A clock under another name and type — a plugin's kind the host registers AFTER the desk was mounted; it hangs on the tray too. */
const Late = defineObject({
  type: "test.late-clock", version: 1, props: {}, size: { w: 150, h: 150 }, kind: brokenClockKind({ name: "test-late" }),
  tray: { label: "Late", category: "things", order: 1, hang: { w: 110, h: 110, accessory: "hook", pegs: [[0, -0.5]] } },
});
/** A clock in a category of its OWN, laid after the clock's (petition I38): a plugin's kind the engine knows and the desk was not mounted with. */
const Lone = defineObject({
  type: "test.lone-clock", version: 1, props: {}, size: { w: 150, h: 150 }, kind: brokenClockKind({ name: "test-lone" }),
  tray: { label: "Lone", category: "tools", order: 0, hang: { w: 110, h: 110, accessory: "hook", pegs: [[0, -0.5]] } },
});
/** A clock whose `record` throws from its third call: three strikes, and the desk QUARANTINES it (petition I24's other path). */
const Faulty = defineObject({ type: "test.set-faulty-clock", version: 1, props: {}, size: { w: 150, h: 150 }, kind: brokenClockKind({ name: "test-set-faulty", recordFrom: 3 }) });

/** A host's catalog — what a layer reads its object types from at its mount; `listed` may grow after it. */
const hostCatalog = (listed: WidgetType[]) => ({ widgetTypes: (): readonly WidgetType[] => listed });

/** An engine over `widgets` with a fresh document; a reflector's contained throw lands in `faults` (a frame the desk could not draw). */
function stage(widgets: readonly WidgetType[]) {
  const faults: string[] = [];
  const ce = createCanvasEngine({ widgets, onReflectorFault: (name, err) => { faults.push(`${name}: ${err instanceof Error ? err.message : String(err)}`); } });
  ce.docs.create();
  const step = (): void => { ce.engine.step(performance.now()); };
  return { ce, faults, step, frame: (): void => { ce.world.setResource(Viewport, VIEW); step(); }, at: (type: string, x: number, y: number): Entity => ce.ops.spawnWidget(type, { x, y, undoable: false }) as Entity };
}

/** A desk layer mounted on `ce` as a host mounts it — its own fake device (refusing the broken WGSL as a compiler does), the host's catalog, the reflector registered — booted. */
async function mount(ce: CanvasEngine, catalog: { widgetTypes(): readonly WidgetType[] }, opts: { readonly gpuLedger?: boolean } = {}) {
  const log: string[] = [];
  const fake = fakeDevice(log, { refuse: (code) => (code.includes(BROKEN_WGSL_TOKEN) ? `unresolved value '${BROKEN_WGSL_TOKEN}'` : undefined) });
  const { device } = fake;
  Object.assign(device, { lost: new Promise(() => {}), destroy: () => {} });
  const adapter = { features: new Set<string>(), requestDevice: async () => device };
  const gpu = { requestAdapter: async () => adapter, getPreferredCanvasFormat: () => "bgra8unorm" } as unknown as GPU;
  const context = { configure: () => {}, unconfigure: () => {}, getCurrentTexture: () => ({ createView: () => ({ label: "swap" }), width: 1, height: 1 }) };
  const canvas = { style: {}, width: 1, height: 1, clientWidth: VIEW.w, clientHeight: VIEW.h, getContext: () => context, remove: () => {} };
  const node = () => ({ style: {}, setAttribute: () => {}, addEventListener: () => {}, removeEventListener: () => {}, remove: () => {} });
  const container = { ownerDocument: { createElement: (tag: string) => (tag === "canvas" ? canvas : node()), defaultView: undefined, addEventListener: () => {}, removeEventListener: () => {} }, prepend: () => {}, appendChild: () => {}, addEventListener: () => {}, removeEventListener: () => {} } as unknown as HTMLElement;
  vi.stubGlobal("navigator", { gpu });
  const handle: DeskLayerHandle = deskLayer({ gpu, theme: themeFrom("light", PALETTE), palette: PALETTE, ...(opts.gpuLedger === true ? { gpuLedger: true } : {}) })({ host: { container }, world: ce.world, frame: ce.engine.frame, catalog, framePick: ce.stack.framePick, trayPose: ce.stack.trayPose });
  const early = handle.perf().boot;   // read the moment the factory returned: nothing of the boot has happened
  const unregister = ce.engine.registerReflector(handle.reflector);
  for (let i = 0; i < 100 && handle.status().state === "pending"; i++) await new Promise((r) => setTimeout(r, 5));
  const row = (e: Entity): SlotObject | undefined => handle.lastInputs()?.objects?.find((o) => o.key === (e as number));
  const kinds = (): Readonly<Record<string, number>> | undefined => handle.stats().frame?.kinds;
  return { handle, log, fake, early, row, kinds, unmount: (): void => { unregister(); handle.dispose(); } };
}

/** What the desk WARNED, naming `type`. */
const warned = (spy: { mock: { calls: unknown[][] } }, type: string): string[] => spy.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(`"${type}"`));

describe("the kind set (petition I25): fixed for a layer's life, a host remounts to change it", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); vi.unstubAllGlobals(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("a type registered on the catalog AFTER the mount adds no kind: its objects wear the missing face, said ONCE — the type and the remount — the status untouched; the remount on the grown catalog draws them by their own kind", async () => {
    const warns = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = stage([DeskClock, Late]);   // the engine knows both: an object of either can be laid (a peer's, an op's)
    const listed: WidgetType[] = [DeskClock];
    const catalog = hostCatalog(listed);
    const first = await mount(s.ce, catalog);
    let late: Entity;
    try {
      listed.push(Late);   // the plugin's type registered on the host's catalog, the desk already mounted
      const clock = s.at(DeskClock.type, 100, 100);
      late = s.at(Late.type, 400, 100);
      s.frame();
      // the frame draws — the late kind never reaches the ground, which compiled no pass for it (a record handed it would throw the frame)
      expect(s.faults).toEqual([]);
      expect(first.kinds()).toEqual({ "desk-clock": 1, [MISSING_KIND]: 1 });
      expect(first.row(late)?.kind).toBe(MISSING_KIND);
      expect(isMissingRecord(first.row(late)?.record)).toBe(true);
      expect(isMissingRecord(first.row(clock)?.record)).toBe(false);
      expect(first.handle.ground()?.pass("test-late")).toBeUndefined();
      expect(first.handle.local("test-late")).toBeUndefined();
      // said ONCE, naming the type and the remount that draws it
      expect(warned(warns, Late.type)).toHaveLength(1);
      expect(warned(warns, Late.type)[0]).toMatch(/kind \("test-late"\) this desk was not mounted with .* remount to draw it \(petition I25\)$/);
      // another of its objects, more frames: never said again, nothing faulted, the status untouched
      s.at(Late.type, 700, 100);
      s.frame(); s.frame();
      expect(first.kinds()).toEqual({ "desk-clock": 1, [MISSING_KIND]: 2 });
      expect(warned(warns, Late.type)).toHaveLength(1);
      expect(s.faults).toEqual([]);
      expect(first.handle.status()).toEqual({ state: "ready" });
    } finally { first.unmount(); }
    // THE REMOUNT, on the catalog as it stands now: the kind compiled at this mount, its objects drawn by it — the document's, untouched
    const second = await mount(s.ce, catalog);
    try {
      s.frame();
      expect(second.kinds()).toEqual({ "desk-clock": 1, "test-late": 2 });
      expect(isMissingRecord(second.row(late)?.record)).toBe(false);
      expect(second.handle.ground()?.pass("test-late")).toBeDefined();
      expect(warned(warns, Late.type)).toHaveLength(1);   // the generation that draws it says nothing
      expect(s.faults).toEqual([]);
    } finally { second.unmount(); s.ce.dispose(); }
  });

  it("the tray hangs no specimen of a type registered after the mount and the drawer draws on; the remount hangs it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = stage([DeskClock, Late]);
    const listed: WidgetType[] = [DeskClock];
    const catalog = hostCatalog(listed);
    const first = await mount(s.ce, catalog);
    const hung = (m: { handle: DeskLayerHandle }): string[] => m.handle.tray.state().specimens.map((q) => q.type).sort();
    try {
      listed.push(Late);
      openTray(s.ce.world);
      first.handle.tray.pin({ p: 1 });
      s.frame(); s.frame();
      expect(s.faults).toEqual([]);
      expect(hung(first)).toEqual([DeskClock.type]);
    } finally { first.unmount(); }
    const second = await mount(s.ce, catalog);
    try {
      second.handle.tray.pin({ p: 1 });
      s.frame(); s.frame();
      expect(s.faults).toEqual([]);
      expect(hung(second)).toEqual([DeskClock.type, Late.type].sort());
    } finally { second.unmount(); s.ce.dispose(); }
  });

  it("petition I38: core's lay hangs only the kinds the desk was MOUNTED with — a type the engine knows and the desk cannot draw is not laid, its category (left empty) is not offered, a press at its would-be peg takes nothing; the remount that draws it hangs it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = stage([DeskClock, Lone]);   // the engine knows both (VibeField: the plugin's widget registered, its plugin off)
    const laid = (): string[] => { const t = trayEntity(s.ce.world); return t === undefined ? [] : specimensOf(s.ce.world, t).map((e) => String(s.ce.world.read(e, PrefabId).id)).sort(); };
    const hung = (m: { handle: DeskLayerHandle }): string[] => m.handle.tray.state().specimens.map((q) => q.type).sort();
    const take = (): string => s.ce.world.read(trayEntity(s.ce.world) as Entity, Tray).take ?? "";
    const pointer = (kind: "move" | "down" | "up", x: number, y: number, buttons: number): void => { s.ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: NO_MODS }); s.frame(); };
    const first = await mount(s.ce, hostCatalog([DeskClock]));
    let peg: { x: number; y: number };
    try {
      openTray(s.ce.world);
      first.handle.tray.pin({ p: 1 });
      s.frame(); s.frame(); s.frame();
      expect(s.faults).toEqual([]);
      // what the desk draws and what core lays agree: the clock alone — the lone kind is no specimen, no count, no chip
      expect(hung(first)).toEqual([DeskClock.type]);
      expect(laid()).toEqual([DeskClock.type]);
      expect(trayEntryCount(s.ce.world)).toBe(1);
      expect(trayCategories(s.ce.world).map((c) => c.id)).toEqual(["things"]);
      // where the law WOULD hang the lone clock beside it, on screen — a press there (down, past the slop) takes nothing
      const f = first.handle.tray.state().frame;
      if (f === undefined) throw new Error("no drawer drawn");
      const item = (t: WidgetType): TrayItem => ({ type: t.type, hang: t.tray?.hang as NonNullable<WidgetType["tray"]>["hang"], ...(t.tray?.category !== undefined ? { category: t.tray.category } : {}), ...(t.tray?.order !== undefined ? { order: t.tray.order } : {}) });
      const would = layTray([item(DeskClock), item(Lone)], f.w, f.pitch).placed.find((q) => q.type === Lone.type);
      if (would === undefined) throw new Error("the law lays no lone clock");
      peg = { x: f.x + would.x + would.w / 2, y: f.y + would.y + would.h / 2 - f.scroll };
      pointer("move", peg.x, peg.y, 0);
      pointer("down", peg.x, peg.y, 1);
      pointer("move", peg.x + 12, peg.y + 12, 1);
      expect(take()).toBe("");
      pointer("up", peg.x + 12, peg.y + 12, 0);
    } finally { first.unmount(); }
    // THE REMOUNT on a catalog that lists it: core lays it beside the clock, its chip offered — and the same press takes it
    const second = await mount(s.ce, hostCatalog([DeskClock, Lone]));
    try {
      second.handle.tray.pin({ p: 1 });
      s.frame(); s.frame(); s.frame();
      expect(hung(second)).toEqual([DeskClock.type, Lone.type].sort());
      expect(laid()).toEqual([DeskClock.type, Lone.type].sort());
      expect(trayCategories(s.ce.world).map((c) => c.id)).toEqual(["things", "tools"]);
      pointer("move", peg.x, peg.y, 0);
      pointer("down", peg.x, peg.y, 1);
      pointer("move", peg.x + 12, peg.y + 12, 1);
      expect(take()).toBe(Lone.type);
      expect(s.faults).toEqual([]);
    } finally { second.unmount(); s.ce.dispose(); }
  });

  it("the mount's cost as the boot went — `perf().boot`: the device in hand, the passes compiled (the status ready), the first frame presented — each absent until it happens", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = stage([DeskClock]);
    const m = await mount(s.ce, hostCatalog([DeskClock]));
    try {
      expect(m.early).toEqual({});
      const booted = m.handle.perf().boot;
      expect(m.handle.status().state).toBe("ready");
      expect(booted.device).toBeGreaterThanOrEqual(0);
      expect(booted.compiled).toBeGreaterThanOrEqual(booted.device as number);
      expect(booted.presented).toBeUndefined();   // no frame yet
      s.at(DeskClock.type, 100, 100);
      s.frame();
      expect(m.handle.redraws()).toBe(1);
      await Promise.resolve();
      const after = m.handle.perf().boot;
      expect(after.presented).toBeGreaterThanOrEqual(after.compiled as number);
      // the boot's figures stand: a later frame moves none of them
      const presented = after.presented;
      s.at(DeskClock.type, 400, 100);
      s.frame();
      await Promise.resolve();
      expect(m.handle.perf().boot).toEqual({ device: booted.device, compiled: booted.compiled, presented });
    } finally { m.unmount(); s.ce.dispose(); }
  });

  it("a document survives a remount untouched: the layer holds none of it — the unmount and the next mount commit nothing, and the next generation draws the same objects", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = stage([DeskClock]);
    const catalog = hostCatalog([DeskClock]);
    const first = await mount(s.ce, catalog);
    const ids = [s.at(DeskClock.type, 100, 100), s.at(DeskClock.type, 400, 100), s.at(DeskClock.type, 700, 300)];
    s.frame();
    const session = s.ce.docs.current();
    if (session === undefined) throw new Error("no document");
    const before = session.exportSnapshot();
    let commits = 0;
    const stop = session.store.subscribeOutbound(() => { commits += 1; });
    first.unmount();
    s.step();
    const second = await mount(s.ce, catalog);
    try {
      s.frame(); s.frame();
      expect(commits).toBe(0);
      expect(Buffer.from(session.exportSnapshot()).equals(Buffer.from(before))).toBe(true);
      expect(s.ce.docs.current()).toBe(session);
      expect(ids.map((e) => isMissingRecord(second.row(e)?.record))).toEqual([false, false, false]);
      expect(second.kinds()).toEqual({ "desk-clock": 3 });
    } finally { stop(); second.unmount(); s.ce.dispose(); }
  });

  it("the memory ledger reads ZERO after each unmount — across generations: one with a kind refused at create and one quarantined at three strikes, then one mounted clean", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const s = stage([DeskClock, DeskClockBroken, Faulty]);
    const zero = (h: DeskLayerHandle) => { const m = h.gpuMemory()?.read(); return { total: m?.total, textures: m?.textures, buffers: m?.buffers, rows: Object.keys(m?.byLabel ?? {}), made: (m?.made ?? 0) > 0 }; };
    const ZERO = { total: 0, textures: 0, buffers: 0, rows: [], made: true };
    // the BROKEN generation: the broken clock refused at create, the faulty one quarantined at its third record
    const broken = await mount(s.ce, hostCatalog([DeskClock, DeskClockBroken, Faulty]), { gpuLedger: true });
    const laid = [s.at(DeskClock.type, 100, 100), s.at(DeskClockBroken.type, 400, 100), s.at(Faulty.type, 700, 100)];
    for (let i = 0; i < 5; i++) { broken.handle.builder.invalidate(); s.frame(); }
    expect(broken.handle.status().faults?.map((f) => f.kind)).toEqual(["desk-clock-broken", "test-set-faulty"]);
    expect((broken.handle.gpuMemory()?.read().total ?? 0) > 0).toBe(true);
    broken.unmount();
    expect(zero(broken.handle)).toEqual(ZERO);
    // …its objects gone from the document, the next generation mounted CLEAN: the clock alone, nothing missing
    s.ce.ops.setSelection(laid.slice(1), "replace");
    s.ce.ops.deleteSelection();
    s.step();
    const clean = await mount(s.ce, hostCatalog([DeskClock]), { gpuLedger: true });
    try {
      for (let i = 0; i < 3; i++) s.frame();
      expect(clean.handle.status()).toEqual({ state: "ready" });
      expect(clean.kinds()).toEqual({ "desk-clock": 1 });
      expect((clean.handle.gpuMemory()?.read().total ?? 0) > 0).toBe(true);
    } finally { clean.unmount(); }
    expect(zero(clean.handle)).toEqual(ZERO);
    expect(s.faults).toEqual([]);
    s.ce.dispose();
  });
});
