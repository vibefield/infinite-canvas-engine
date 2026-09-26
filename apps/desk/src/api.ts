// `window.__desk` — the desk's door for the rigs (and a person at the console): the engine and the
// layer's handle themselves, `spawn` (at a CENTRE, the prototype's convention), `setScene` (an
// oracle still spawned into the world), the desk's objects as a harness reads them, the camera, the
// selection, the instruments (`stats`, `wakes`, `submits`), the ambient policy, the theme, and
// `settle` — resolves once the desk is drawn, quiet and its assets are up. Everything reads the
// WORLD (Position/Size/tags) and the builder's flux; nothing here writes what an op would not.

import { Active, type CanvasEngine, ChildOf, type Entity, Grab, Locked, NavIntent, NavRedress, NavTapMemo, NavTransition, Position, PrefabId, Selected, Size, Camera, Viewport, writeRuntimeResource, defineQuery, defineTickSystem, LocalPointer, Pointer, PointerWorld } from "@ice/core";
import type { DeskLayerHandle, MatPin } from "@ice/desk/host";
import type { AmbientMode } from "@ice/desk/compose";
import type { ThemeName } from "@ice/desk/theme";
import { type NoteApi, noteApi } from "./note-api";
import { type OracleScene, setScene, spawnAll } from "./scene";

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
  setScene(scene: OracleScene): Promise<{ readonly notes: number[]; readonly minimats: number[] }>;
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
  pinMat(pin: MatPin | null): void;
  theme(): ThemeName;
  setTheme(name: ThemeName): void;
  /** Resolves when the desk is drawn and quiet (nothing dirty, no spring, the ground here), two frames later — or, under a flight pin, once three pinned frames have drawn. */
  settle(timeoutMs?: number): Promise<{ readonly settled: boolean; readonly redraws: number }>;
  /** Frames since the mount and the drawing state, for a rig's counters. */
  readonly state: { ready: boolean };
  /** The sticky notes' text stack: the editor, the writing, the ink (D2c). */
  readonly note: NoteApi;
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
}

declare global {
  interface Window { __desk?: DeskApi }
}

const widgetsQ = defineQuery([Position, Size, PrefabId]);
const mouseQ = defineQuery([Pointer, LocalPointer, PointerWorld]);

export function installDeskApi(engine: CanvasEngine, handle: DeskLayerHandle, theme: { name(): ThemeName; set(name: ThemeName, pin: boolean): void }): DeskApi {
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
  const api: DeskApi = {
    engine,
    handle,
    state,
    note: noteApi(engine, handle),
    spawn(type, props, at) {
      const widget = engine.catalog.widget(type);
      if (widget === undefined) throw new Error(`desk: no object type "${type}"`);
      const [e] = spawnAll(engine, [{ type, cx: at.x, cy: at.y, w: widget.defaultSize.w, h: widget.defaultSize.h, props }], true);
      return e as number;
    },
    async setScene(scene) {
      const r = await setScene({ engine, handle, setTheme: (n, pin) => theme.set(n, pin), pinFlight: (p) => api.pinFlight(p) }, scene);
      return { notes: r.notes.map((e) => e as number), minimats: r.minimats.map((e) => e as number) };
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
    stats: () => handle.stats(),
    wakes: () => handle.wakes(),
    submits() { const s = handle.submits(); return s === undefined ? null : { total: s.total(), buffers: s.buffers(), inWindow: (ms) => s.inWindow(ms) }; },
    ambient(mode, idleMs) { if (mode !== undefined) handle.setAmbient(mode, idleMs); return { ...handle.ambient().state(), clocks: handle.ambient().clocks() }; },
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
        poll();
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
