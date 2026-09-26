// `window.__desk` — the desk's door for the rigs (and a person at the console): the engine and the
// layer's handle themselves, `spawn` (at a CENTRE, the prototype's convention), `setScene` (an
// oracle still spawned into the world), the desk's objects as a harness reads them, the camera, the
// selection, the instruments (`stats`, `wakes`, `submits`), the ambient policy, the theme, and
// `settle` — resolves once the desk is drawn, quiet and its assets are up. Everything reads the
// WORLD (Position/Size/tags) and the builder's flux; nothing here writes what an op would not.

import { type CanvasEngine, type Entity, Grab, Locked, Position, PrefabId, Selected, Size, Camera, Viewport, writeRuntimeResource, defineQuery, LocalPointer, Pointer, PointerWorld } from "@ice/core";
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
  /** Resolves when the desk is drawn and quiet (nothing dirty, no spring, the ground here), two frames later. */
  settle(timeoutMs?: number): Promise<{ readonly settled: boolean; readonly redraws: number }>;
  /** Frames since the mount and the drawing state, for a rig's counters. */
  readonly state: { ready: boolean };
  /** The sticky notes' text stack: the editor, the writing, the ink (D2c). */
  readonly note: NoteApi;
}

declare global {
  interface Window { __desk?: DeskApi }
}

const widgetsQ = defineQuery([Position, Size, PrefabId]);
const mouseQ = defineQuery([Pointer, LocalPointer, PointerWorld]);

export function installDeskApi(engine: CanvasEngine, handle: DeskLayerHandle, theme: { name(): ThemeName; set(name: ThemeName, pin: boolean): void }): DeskApi {
  const { world } = engine;
  const state = { ready: false };
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
      const r = await setScene({ engine, handle, setTheme: (n, pin) => theme.set(n, pin) }, scene);
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
          const quiet = handle.available() && !handle.dirty() && !handle.stats().live && state.ready;
          if (quiet || performance.now() - t0 > timeoutMs) requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => resolve({ settled: quiet, redraws: handle.redraws() }), 60)));
          else requestAnimationFrame(poll);
        };
        poll();
      });
    },
  };
  window.__desk = api;
  return api;
}
