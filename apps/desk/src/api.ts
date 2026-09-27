// `window.__desk` — the desk's door for the rigs (and a person at the console): the engine and the
// layer's handle themselves, `spawn` (at a CENTRE, the prototype's convention), `setScene` (an
// oracle still spawned into the world), the desk's objects as a harness reads them, the camera, the
// selection, the instruments (`stats`, `wakes`, `submits`; the GPU profiler and per-kind cost — `perf.gpu()`, `perf.kindCost()`, K2), the ambient policy, the theme, the gesture
// settings (a host's live tuning), and `settle` — resolves once the desk is drawn, quiet and its
// assets are up. Everything reads the WORLD (Position/Size/tags) and the builder's flux; nothing here
// writes what an op would not.

import { Active, type CanvasEngine, ChildOf, type Entity, GESTURE_DEFAULTS, GestureSettings, Grab, HeldView, Locked, NavIntent, NavRedress, NavTapMemo, NavTransition, Position, PrefabId, Selected, Size, Camera, Viewport, writeRuntimeResource, defineQuery, defineTickSystem, LocalPointer, Pointer, PointerWorld } from "@ice/core";
import { ablateKinds, type BuildWork, type DeskLayerPerf, type GpuFrameReport, type GpuProfiler, type GroundFrameInputs, type KindCostOptions, type KindCostReport, type UploadTally } from "@ice/desk";
import type { DeskLayerHandle, GlyphAtlasMeta, MatPin } from "@ice/desk";
import type { AmbientMode } from "@ice/desk";
import type { ThemeName } from "@ice/desk";
import { type CalendarApi, calendarApi } from "./calendar-api";
import { DESK_FAULTS } from "./desk";
import { type KindsApi, kindsApi } from "./kinds-api";
import { type NoteApi, noteApi } from "./note-api";
import { type NotebookApi, notebookApi } from "./notebook-api";
import { type RoomApi, roomApi } from "./room-api";
import { type TrayApi, trayApi } from "./tray-api";
import type { GlyphFeed } from "./glyphs";
import type { ProfilerDock } from "./devtools";
import type { DevPanel } from "./panel/panel";
import { deskRig } from "./rig-door";
import { spawnAll } from "./scene";

export interface DeskEntity {
  readonly id: number;
  readonly type: string;
  /** ICE's rect: the top-left and the size. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** The prototype's centre. */
  readonly cx: number;
  readonly cy: number;
  readonly selected: boolean;
  readonly grabbed: boolean;
  readonly locked: boolean;
  /** The `ChildOf` parent (0 = none) and whether it is a member of the current nav frame (`Active`). */
  readonly parent: number;
  readonly active: boolean;
  readonly props: Readonly<Record<string, unknown>>;
  readonly flux: { readonly lift: number; readonly hover: number; readonly ring: number; readonly fade: number } | null;
  readonly geometry: unknown;
}

export interface DeskApi {
  readonly engine: CanvasEngine;
  readonly handle: DeskLayerHandle;
  /** Spawn one object of `type` centred at `at` (one undoable transaction); returns its entity id. */
  spawn(type: string, props: Readonly<Record<string, unknown>>, at: { readonly x: number; readonly y: number }): number;
  /** THE RIGS' DOOR (D7): an oracle scene staged into the world — on rig.html only; the product page refuses (src/rig-door.ts). */
  setScene(scene: object): Promise<{ readonly notes: number[]; readonly minimats: number[]; readonly objects: number }>;
  entities(): DeskEntity[];
  entity(id: number): DeskEntity | null;
  camera(): { readonly x: number; readonly y: number; readonly zoom: number };
  setCamera(cam: { readonly x: number; readonly y: number; readonly zoom: number }): void;
  viewport(): { readonly w: number; readonly h: number; readonly dpr: number };
  selection(): number[];
  /** The mouse pointer's world point, if the pointer was seen. */
  pointer(): { readonly x: number; readonly y: number } | null;
  stats(): ReturnType<DeskLayerHandle["stats"]>;
  wakes(): ReturnType<DeskLayerHandle["wakes"]>;
  submits(): { readonly total: number; readonly buffers: number; readonly inWindow: (ms: number) => number } | null;
  ambient(mode?: AmbientMode, idleMs?: number): ReturnType<ReturnType<DeskLayerHandle["ambient"]>["state"]> & { readonly clocks: { readonly time: number; readonly goboTime: number } };
  /** The live gesture settings (design-005 §4), `patch` written over them first — a rig tunes a slop, then puts it back. */
  gestures(patch?: { readonly [K in Exclude<keyof typeof GESTURE_DEFAULTS, "wheel">]?: number }): Readonly<Record<string, number | string>>;
  pinMat(pin: MatPin | null): void;
  theme(): ThemeName;
  setTheme(name: ThemeName): void;
  /** Resolves when the desk is drawn and quiet (nothing dirty, no spring, the ground here), two frames later — or, under a flight pin, once three pinned frames have drawn. */
  settle(timeoutMs?: number): Promise<{ readonly settled: boolean; readonly redraws: number }>;
  /** Frames since the mount and the drawing state, for a rig's counters. */
  readonly state: { ready: boolean };
  /** The sticky notes' text stack: the editor, the writing, the ink (D2c). */
  readonly note: NoteApi;
  /** The D3w kinds: strokes as a board's children, a print's body and flick, the books drawn, a pad's events. */
  readonly kinds: KindsApi;
  /** The notebook in hand (D3t-b): its strokes, a page's raster, the hand, its leaves. */
  readonly notebook: NotebookApi;
  /** The desk calendar at work (D3t-c): its entries, its print, its days, its roll, its pins. */
  readonly calendar: CalendarApi;
  /** The room's doors (D5a — M5's two-tab rows, M9's live collab): an object's key, the document by key, the local commits. */
  readonly room: RoomApi;
  /** The pegboard drawer's doors (design-017, K3). */
  readonly tray: TrayApi;
  // ---- the nav (D2b): the doors the portal and nav rigs use
  /** The nav stack's depth (0 = the root desk). */
  depth(): number;
  /** The flight on now, as core states it, or null. */
  flight(): { readonly kind: "enter" | "exit"; readonly p: number; readonly frozen: boolean; readonly c0: { x: number; y: number; zoom: number }; readonly c1: { x: number; y: number; zoom: number }; readonly epoch: number } | null;
  /** Fly into a mini mat (the engine's op — the seam's exact camera), fly out, or cut (`transition`). */
  enter(id: number, transition?: "zoom" | "none" | "cut"): void;
  exit(transition?: "zoom" | "none" | "cut"): void;
  /** Hold the flight on at progress `p` every tick — the frame a still (the oracle's nav scenes); `null` lets it fly. Freezes the flux while held. */
  pinFlight(p: number | null): void;
  /** Hold the re-dressing ramp at its start (the prototype harness's `redressPinned`). */
  pinRedress(on: boolean): void;
  /** Hold every spring and ghost where it is — a still of a moving frame (a rig's cut witness). */
  freeze(on: boolean): void;
  /** The re-dressing fact as core last stated it, or null. */
  redress(): { readonly kind: "in" | "out"; readonly from: number; readonly frame: number; readonly epoch: number } | null;
  /** Live insides on or off (the oracle's `portals: false`). */
  portals(on: boolean): void;
  /** THE SEAM's answer for a mini mat under the live camera: its face, arrival, embedding (inside → desk), the inside's camera, presence, and whether it covers the view by `coverPx`. */
  navFace(id: number, coverPx?: number): { readonly face: { x: number; y: number; width: number; height: number }; readonly arrival: { x: number; y: number; zoom: number }; readonly affine: { s: number; ox: number; oy: number }; readonly cam: { x: number; y: number; zoom: number }; readonly presence: number; readonly covers: boolean } | null;
  /** The last build's view of a mini mat's inside (its camera, presence, clip), or null when it was not drawn. */
  insideView(id: number): { readonly cam: { x: number; y: number; zoom: number }; readonly presence: number; readonly clip: { cx: number; cy: number; hx: number; hy: number } } | null;
  /** The gesture's facts (a rig's diagnosis): the last instant tap remembered, and the last nav request a system made. */
  taps(): { readonly memo: { target: number; x: number; y: number; at: number; seq: number } | null; readonly intent: { kind: string; target: number; transition: string; source: string; epoch: number } | null; readonly redressRaw: { kind: string; from: number; frame: number; epoch: number } | null };
  /** The desk's marks as last drawn (stratum 5 — D4a), or null before the first frame. */
  marks(): NonNullable<ReturnType<DeskLayerHandle["lastInputs"]>>["marks"] | null;
  /** The selection menu's anchor as the layer last published it. */
  anchor(): ReturnType<DeskLayerHandle["selection"]["anchor"]>;
  /** The app's stub Send: each press's selection count. */
  readonly sent: number[];
  /** The faults the engine contained on this page — a reflector's or a guest's throw (D7); a rig's "no page errors" row holds it empty. */
  readonly faults: readonly string[];
  /** The dev panel (D5a — the backtick opens it): its params, open or not. */
  readonly panel: DevPanel | null;
  /**
   * The app's runtime glyph atlas (K1 — glyphs.ts `glyphFeed`): its last upload's key (`scale:size`), meta and upload count, and
   * whether the root mat prints with THAT atlas now (the very meta object — a rig's `setScene` uploads the committed fixture over
   * it); null before the first upload.
   */
  glyphs(): { readonly key: string; readonly meta: GlyphAtlasMeta; readonly uploads: number; readonly onMat: boolean } | null;
  /** The devtools dock (K2 — ⇧` opens it, arming the GPU profiler): open or not. */
  readonly dock: ProfilerDock | null;
  // ---- the hand (design-015 §8, D4b)
  /** The object in hand as of the last frame: its carry, whether settled or flying home, its frame on screen (the pose seam's word); null = nothing held. */
  hand(): { readonly entity: number; readonly e: number; readonly settled: boolean; readonly landing: boolean; readonly frame: { readonly cx: number; readonly cy: number; readonly hx: number; readonly hy: number; readonly s: number; readonly settled: boolean } } | null;
  /** Pick an object up / put it down — the ops. */
  open(id: number): void;
  putDown(): void;
  /** Pin the carry for a still (`null` unpins). */
  pinHold(pin: { readonly e: number; readonly open?: boolean } | null): void;
  /** The user's facts on the held object (core's `HeldView`), or null. */
  heldView(id: number): { readonly zoom: number; readonly panX: number; readonly panY: number } | null;
  /** How many desk copies the hand has made (the "once per settled state" witness). */
  holdCopies(): number;
  /**
   * THE COST (design-015 §11.4): `n` frames drawn back to back into the canvas with the GPU drained before and after — a copy
   * remade every frame (a fresh stamp), the hand alone over the standing copy, and the rest frame (nothing held) — ms per frame
   * and the CPU µs of recording one. Needs something in hand for `copy` and `hand` (null otherwise). Leaves the frame as it was.
   */
  holdCost(n: number): Promise<{ readonly copy: { ms: number; cpu: number } | null; readonly hand: { ms: number; cpu: number } | null; readonly rest: { ms: number; cpu: number } }>;
  /** The performance instruments (D6 — design-015 §11.4's gates, read by rig:stress). */
  readonly perf: PerfApi;
  /** The raster budget's ledger (D6): the kinds' caches by owner against the cap, the evictions so far. */
  memory(): ReturnType<DeskLayerHandle["memory"]>;
}

/** One reading of every counter rig:stress diffs (D6): cumulative since the mount unless said otherwise. */
export interface PerfReading {
  /** Every `engine.step` since `arm()`: its ms, in order — drained by `take`. */
  readonly steps: number[];
  /** The layer's own flushes and their ms (`DeskLayerHandle.perf`). */
  readonly flush: DeskLayerPerf;
  /** The queue's uploads by resource label prefix (`paper`, `minimat`, `board`, `mat`, `marks` …) and its submits. */
  readonly uploads: Readonly<Record<string, UploadTally>>;
  readonly submits: number;
  /** The builder's work over every build. */
  readonly totals: BuildWork;
  /** The last build's work. */
  readonly work: BuildWork;
  readonly redraws: number;
  /** The kinds' persistent record stores (D6, design-015 §4.3): records written and draw lists rewritten since the mount, by kind. */
  readonly records: Readonly<Record<string, { readonly written: number; readonly bytes: number; readonly orderWrites: number; readonly slots: number }>>;
  /** The GPU profiler's frames completed since the last take (K2), drained — none unless it is armed (`perf.gpu()?.arm()`). */
  readonly gpu: { readonly armed: boolean; readonly frames: readonly GpuFrameReport[] };
}

export interface PerfApi {
  /** Wrap the engine's `step` once so every step is timed; idempotent. */
  arm(): void;
  /** A reading of every counter; the step samples since the last take are drained. */
  take(): PerfReading;
  /** Chrome's `performance.memory.usedJSHeapSize` (precise under `--enable-precise-memory-info`), or null where absent. */
  heap(): number | null;
  /** V8's `gc()` when Chrome exposes it (`--js-flags=--expose-gc`); false when it does not. */
  gc(): boolean;
  /** THE GPU PROFILER on the desk's device (K2, design-016 §4): unarmed until a rig or the dock arms it; null before the device. */
  gpu(): GpuProfiler | null;
  /**
   * PER-KIND GPU COST BY ABLATION (K2, design-016 §4.4): the last frame drawn in saturated, drained, probe-calibrated batches with
   * each kind's objects left out in turn, round-robined, an A/A control beside — ms per frame each kind costs, and the noise
   * floor. At rest (a desk drawing its own frames meanwhile shares the GPU); leaves the frame as it was.
   */
  kindCost(opts?: KindCostOptions): Promise<KindCostReport>;
}

declare global {
  interface Window { __desk?: DeskApi }
}

const widgetsQ = defineQuery([Position, Size, PrefabId]);
const mouseQ = defineQuery([Pointer, LocalPointer, PointerWorld]);

export function installDeskApi(engine: CanvasEngine, handle: DeskLayerHandle, theme: { name(): ThemeName; set(name: ThemeName, pin: boolean): void }, panel: DevPanel | null = null, glyphs: GlyphFeed | null = null, dock: ProfilerDock | null = null): DeskApi {
  const { world } = engine;
  const state = { ready: false };
  // THE FLIGHT PIN (D2b): a system after core's `navFlight` in `simulate` that puts the flight back at `pinned` and the camera at
  // that progress every tick, change-only — the oracle's nav scenes are stills of a flight, and a rig's cut check needs one frame held
  let pinned: number | null = null;
  let pinRedraws = 0;
  const pinFlight = defineTickSystem(
    () => {
      if (pinned === null) return;
      const t = world.getResource(NavTransition);
      if (t === undefined || !t.active) return;
      const cam = handle.flightCameraAt(pinned);
      if (cam === undefined) return;
      const cur = world.getResource(Camera);
      if (cur === undefined || cur.x !== cam.x || cur.y !== cam.y || cur.zoom !== cam.zoom || cur.gesturing) writeRuntimeResource(world, Camera, { x: cam.x, y: cam.y, zoom: cam.zoom, gesturing: false });
      if (t.p !== pinned || t.v !== 0 || t.ticks !== 1) world.setResource(NavTransition, { ...t, p: pinned, v: 0, ticks: 1 });
    },
    { name: "desk.pinFlight", runIf: () => pinned !== null },
  );
  engine.engine.addSystems("simulate", pinFlight);
  const describe = (e: Entity): DeskEntity | null => {
    if (!world.isAlive(e)) return null;
    const p = world.get(e, Position);
    const s = world.get(e, Size);
    const id = world.get(e, PrefabId)?.id;
    if (p === undefined || s === undefined || typeof id !== "string") return null;
    const widget = engine.catalog.widget(id);
    const props: Record<string, unknown> = {};
    for (const g of widget?.groups ?? []) { const v = world.get(e, g.component) as Record<string, unknown> | undefined; if (v !== undefined) for (const k of Object.keys(g.fields)) props[k] = v[k]; }
    return {
      id: e as number, type: id, x: p.x, y: p.y, w: s.w, h: s.h, cx: p.x + s.w / 2, cy: p.y + s.h / 2,
      selected: world.hasTag(e, Selected), grabbed: world.has(e, Grab), locked: world.hasTag(e, Locked), props,
      parent: (world.getRelation(e, ChildOf) ?? 0) as number, active: world.hasTag(e, Active),
      flux: handle.fluxOf(e) ?? null, geometry: handle.geometryOf(e) ?? null,
    };
  };
  // THE PERF DOOR (D6): the engine's `step` timed from outside — the loop calls `engine.step(now)` through the property, so a wrapper
  // installed here sees every step the rAF loop makes, the desk's flush among them
  let stepSamples: number[] = [];
  let armed = false;
  const perf: PerfApi = {
    arm() {
      if (armed) return;
      armed = true;
      const eng = engine.engine as { step(now: number): void };
      const step = eng.step.bind(eng);
      eng.step = (now: number): void => { const t0 = performance.now(); step(now); stepSamples.push(performance.now() - t0); };
    },
    take() {
      const steps = stepSamples;
      stepSamples = [];
      const s = handle.submits();
      const st = handle.stats();
      const gpu = handle.profiler();
      return { steps, flush: handle.perf(), uploads: s?.uploadsByLabel() ?? {}, submits: s?.total() ?? 0, totals: st.totals, work: st.work, redraws: handle.redraws(), records: handle.records(), gpu: { armed: gpu?.armed() ?? false, frames: gpu?.take() ?? [] } };
    },
    heap() {
      const m = (performance as { memory?: { usedJSHeapSize?: number } }).memory;
      return typeof m?.usedJSHeapSize === "number" ? m.usedJSHeapSize : null;
    },
    gc() {
      const g = (globalThis as { gc?: () => void }).gc;
      if (typeof g !== "function") return false;
      g();
      return true;
    },
    gpu: () => handle.profiler() ?? null,
    async kindCost(opts) {
      const device = handle.device();
      const g = handle.ground();
      const inputs = handle.lastInputs();
      if (device === undefined || g === null || inputs === null) throw new Error("desk: no frame to measure");
      return ablateKinds({ inputs, render: (f: GroundFrameInputs) => { g.render(f); }, drain: () => device.queue.onSubmittedWorkDone(), now: () => performance.now() }, opts);
    },
  };
  const api: DeskApi = {
    engine,
    handle,
    state,
    perf,
    note: noteApi(engine, handle),
    kinds: kindsApi(engine, handle),
    notebook: notebookApi(engine, handle),
    calendar: calendarApi(engine, handle),
    room: roomApi(engine),
    tray: trayApi(engine, handle),
    spawn(type, props, at) {
      const widget = engine.catalog.widget(type);
      if (widget === undefined) throw new Error(`desk: no object type "${type}"`);
      const [e] = spawnAll(engine, [{ type, cx: at.x, cy: at.y, w: widget.defaultSize.w, h: widget.defaultSize.h, props }], true);
      return e as number;
    },
    async setScene(scene) {
      const r = await deskRig().setScene({ engine, handle, setTheme: (n, pin) => theme.set(n, pin), pinFlight: (p) => api.pinFlight(p) }, scene);
      return { notes: r.notes.map((e) => e as number), minimats: r.minimats.map((e) => e as number), objects: Object.values(r).reduce((n, list) => n + list.length, 0) };
    },
    entities() {
      const out: DeskEntity[] = [];
      world.query(widgetsQ).each((b) => { for (const r of b) { const d = describe(b.entity(r)); if (d !== null) out.push(d); } });
      return out;
    },
    entity: (id) => describe(id as Entity),
    camera() { const c = world.getResource(Camera) ?? { x: 0, y: 0, zoom: 1 }; return { x: c.x, y: c.y, zoom: c.zoom }; },
    setCamera(cam) { writeRuntimeResource(world, Camera, { x: cam.x, y: cam.y, zoom: cam.zoom, gesturing: false }); },
    viewport() { const v = world.getResource(Viewport) ?? { w: 0, h: 0, dpr: 1 }; return { w: v.w, h: v.h, dpr: v.dpr }; },
    selection() { const out: number[] = []; world.query(widgetsQ).each((b) => { for (const r of b) { const e = b.entity(r); if (world.hasTag(e, Selected)) out.push(e as number); } }); return out; },
    pointer() {
      let at: { x: number; y: number } | null = null;
      world.query(mouseQ).each((b) => { for (const r of b) { const p = b.entity(r); if (world.read(p, Pointer).device === "mouse") { const w = world.read(p, PointerWorld); at = { x: w.x, y: w.y }; } } });
      return at;
    },
    marks: () => handle.lastInputs()?.marks ?? null,
    anchor: () => handle.selection.anchor(),
    sent: [],
    faults: DESK_FAULTS,
    panel,
    glyphs() {
      const last = glyphs?.last ?? null;
      if (glyphs === null || last === null) return null;
      return { key: last.key, meta: last.meta, uploads: glyphs.uploads, onMat: handle.ground()?.mat.glyphs === last.meta };
    },
    dock,
    stats: () => handle.stats(),
    wakes: () => handle.wakes(),
    memory: () => handle.memory(),
    submits() { const s = handle.submits(); return s === undefined ? null : { total: s.total(), buffers: s.buffers(), inWindow: (ms) => s.inWindow(ms) }; },
    ambient(mode, idleMs) { if (mode !== undefined) handle.setAmbient(mode, idleMs); return { ...handle.ambient().state(), clocks: handle.ambient().clocks() }; },
    gestures(patch) {
      const cur = world.getResource(GestureSettings) ?? GESTURE_DEFAULTS;
      if (patch !== undefined) world.setResource(GestureSettings, { ...cur, ...patch });
      return { ...(world.getResource(GestureSettings) ?? cur) };
    },
    pinMat: (pin) => handle.pinMat(pin),
    theme: () => theme.name(),
    setTheme: (name) => theme.set(name, true),
    settle(timeoutMs = 8000) {
      return new Promise((resolve) => {
        const t0 = performance.now();
        const poll = (): void => {
          // under a flight pin the flight system and the pin trade writes every tick, so the frame is never "clean" — three pinned frames drawn is the still
          const pinnedQuiet = pinned !== null && handle.redraws() >= pinRedraws + 3;
          const quiet = handle.available() && state.ready && (pinnedQuiet || (!handle.dirty() && !handle.stats().live));
          if (quiet || performance.now() - t0 > timeoutMs) requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => resolve({ settled: quiet, redraws: handle.redraws() }), 60)));
          else requestAnimationFrame(poll);
        };
        // the first look is a FRAME away, never now: an input the rig just sent (a release) is processed by the next tick, and a desk
        // quiet before it is not the desk after it (found at D6 — the ring's spring used to keep the desk live across that gap)
        requestAnimationFrame(poll);
      });
    },
    depth: () => engine.nav.depth(),
    flight() {
      const t = world.getResource(NavTransition);
      if (t === undefined || !t.active) return null;
      return { kind: t.kind, p: t.p, frozen: t.frozen, c0: { x: t.c0x, y: t.c0y, zoom: t.c0z }, c1: { x: t.c1x, y: t.c1y, zoom: t.c1z }, epoch: t.epoch };
    },
    enter(id, transition) { engine.ops.enterContainer(id as Entity, transition === undefined ? {} : { transition }); },
    exit(transition) { engine.ops.exitContainer(transition === undefined ? {} : { transition }); },
    pinFlight(p) {
      pinned = p;
      pinRedraws = handle.redraws();
      handle.freeze(p !== null);
    },
    pinRedress: (on) => handle.holdRedress(on),
    freeze: (on) => handle.freeze(on),
    redress() {
      const r = world.getResource(NavRedress);
      return r === undefined || r.epoch === 0 ? null : { kind: r.kind, from: r.from, frame: r.frame as number, epoch: r.epoch };
    },
    portals: (on) => handle.setPortals(on),
    navFace(id, coverPx = 0) {
      const f = handle.navFace(id as Entity);
      if (f === undefined) return null;
      return { face: { ...f.face }, arrival: { ...f.arrival }, affine: { ...f.affine }, cam: { ...f.camera }, presence: f.presence, covers: f.covers(coverPx) };
    },
    insideView(id) {
      const v = handle.insideViewOf(id as Entity);
      if (v === undefined) return null;
      return { cam: { ...v.cam }, presence: v.presence, clip: { cx: v.clip.cx, cy: v.clip.cy, hx: v.clip.hx, hy: v.clip.hy } };
    },
    hand() {
      const h = handle.hand();
      return h === undefined ? null : { entity: h.entity as number, e: h.e, settled: h.settled, landing: h.landing, frame: { ...h.frame } };
    },
    open: (id) => engine.ops.open(id as Entity),
    putDown: () => engine.ops.putDown(),
    pinHold: (pin) => handle.pinHold(pin),
    heldView(id) { const v = world.get(id as Entity, HeldView); return v === undefined ? null : { zoom: v.zoom, panX: v.panX, panY: v.panY }; },
    holdCopies: () => handle.ground()?.heldCopies() ?? 0,
    async holdCost(n) {
      const device = handle.device();
      const g = handle.ground();
      const inputs = handle.lastInputs();
      if (device === undefined || g === null || inputs === null) throw new Error("desk: no frame to measure");
      // the cost rig's method: a saturated batch into the canvas's current texture, the queue drained before and after
      const batch = async (make: (i: number) => GroundFrameInputs): Promise<{ ms: number; cpu: number }> => {
        await device.queue.onSubmittedWorkDone();
        const t0 = performance.now();
        let cpu = 0;
        for (let i = 0; i < n; i++) { const c0 = performance.now(); g.render(make(i)); cpu += performance.now() - c0; }
        await device.queue.onSubmittedWorkDone();
        return { ms: (performance.now() - t0) / n, cpu: cpu / n };
      };
      const held = inputs.held;
      const copy = held === undefined ? null : await batch((i) => ({ ...inputs, held: { ...held, stamp: `cost ${i}` } }));
      const hand = held === undefined ? null : await batch(() => inputs);
      const { held: _held, ...bare } = inputs;
      const rest = await batch(() => bare);
      g.render(inputs);   // the frame as it was
      return { copy, hand, rest };
    },
    taps() {
      const m = world.getResource(NavTapMemo);
      const i = world.getResource(NavIntent);
      const r = world.getResource(NavRedress);
      return {
        memo: m === undefined ? null : { target: m.target as number, x: m.x, y: m.y, at: m.at, seq: m.seq },
        intent: i === undefined ? null : { kind: i.kind, target: i.target as number, transition: i.transition, source: i.source, epoch: i.epoch },
        redressRaw: r === undefined ? null : { ...r, frame: r.frame as number },
      };
    },
  };
  window.__desk = api;
  return api;
}
