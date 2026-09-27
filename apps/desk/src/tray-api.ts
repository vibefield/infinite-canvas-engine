// `window.__desk.tray` — the pegboard drawer's doors for the rigs (design-017 §10; K3): the handle's door (open, close, toggle, isOpen,
// scroll, pin, state), the facts as core holds them, a TRACE of the slide on the frame clock (the curve's witness), and the COST of the
// drawer on the GPU — a saturated batch of it alone into the canvas's texture (the queue drained around it), beside whole frames with
// the drawer open and closed.

import { Active, type CanvasEngine, FrameInfo, hungTypes, Position, PrefabId, Selected, Size, specimensOf, Tray, TrayContent, trayEntity } from "@ice/core";
import type { DeskLayerHandle, GroundFrameInputs, TrayPin } from "@ice/desk";

export interface TrayCost { readonly ms: number; readonly cpu: number }

/** A specimen as the WORLD holds it (K5a — core's facts, read back): its type, its rect on the board (board px), and what the desk's stack never gives it. */
export interface TrayWorldSpecimen { readonly type: string; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly active: boolean; readonly selected: boolean; readonly durable: boolean }

export interface TrayApi {
  open(): boolean;
  close(): void;
  toggle(): boolean;
  isOpen(): boolean;
  /** The board's scroll, CSS px past its top — set when given, and returned. */
  scroll(px?: number): number;
  pin(pin: TrayPin | null): void;
  state(): ReturnType<DeskLayerHandle["tray"]["state"]>;
  /** Core's `Tray` fact as it stands (null: no tray entity) — and its `TrayContent` (K5a: the laid content's foot, the lay count). */
  facts(): { readonly open: boolean; readonly scroll: number; readonly stretch: number; readonly lip: boolean; readonly wheelAt: number; readonly hover: string; readonly bottom: number; readonly laid: number; readonly take: string; readonly handed: number } | null;
  /** The specimens in the world (K5a), read back from core's facts. */
  specimens(): readonly TrayWorldSpecimen[];
  /** What the lattice law lays (kernel `layTray` — the rig runs it): the catalog's tray entries, the drawer's width as drawn and the pitch. */
  law(): { readonly items: readonly { readonly type: string; readonly hang: unknown; readonly category: string; readonly order: number }[]; readonly width: number; readonly pitch: number } | null;
  /** Toggle the drawer, then sample its slide every frame for `ms` of the frame clock: `t` since the tween began (frame clock), `wall` since the toggle (performance.now()), `p`. */
  trace(ms: number): Promise<readonly { readonly t: number; readonly wall: number; readonly p: number }[]>;
  /**
   * The drawer's GPU cost (open, at the frame's view): `n` of it alone per batch (the board and its accessories), and whole frames with it
   * open WITH its specimens, open BARE (K5a — the difference is what the specimens cost) and closed — ms per frame, drained.
   */
  cost(n: number): Promise<{ readonly aloneBare: TrayCost; readonly alone: TrayCost; readonly open: TrayCost; readonly bare: TrayCost; readonly closed: TrayCost }>;
}

const frame = (): Promise<number> => new Promise((r) => requestAnimationFrame(r));

export function trayApi(engine: CanvasEngine, handle: DeskLayerHandle): TrayApi {
  const door = handle.tray;
  return {
    open: () => door.open(),
    close: () => door.close(),
    toggle: () => door.toggle(),
    isOpen: () => door.isOpen(),
    scroll: (px) => door.scroll(px),
    pin: (pin) => door.pin(pin),
    state: () => door.state(),
    facts() {
      const e = trayEntity(engine.world);
      const t = e === undefined ? undefined : engine.world.get(e, Tray);
      const c = e === undefined ? undefined : engine.world.get(e, TrayContent);
      return t === undefined ? null : { open: t.open, scroll: t.scroll, stretch: t.stretch, lip: t.lip, wheelAt: t.wheelAt, hover: t.hover ?? "", bottom: c?.bottom ?? 0, laid: c?.laid ?? 0, take: t.take ?? "", handed: t.handed };
    },
    specimens() {
      const w = engine.world;
      const e = trayEntity(w);
      const store = engine.docs.current()?.store;
      if (e === undefined) return [];
      return specimensOf(w, e).map((s) => {
        const at = w.read(s, Position);
        const size = w.read(s, Size);
        return { type: w.read(s, PrefabId).id ?? "", x: at.x, y: at.y, w: size.w, h: size.h, active: w.hasTag(s, Active), selected: w.hasTag(s, Selected), durable: store?.keyOf(s) !== undefined };
      });
    },
    law() {
      const f = door.state().frame;
      if (f === undefined) return null;
      const items = hungTypes(engine.world).flatMap((t) => (t.tray === undefined ? [] : [{ type: t.type, hang: t.tray.hang, category: t.tray.category ?? "", order: t.tray.order ?? 0 }]));
      return { items, width: f.w, pitch: f.pitch };
    },
    async trace(ms) {
      const out: { t: number; p: number; wall: number }[] = [];
      const w0 = performance.now();
      door.toggle();
      for (;;) {
        await frame();
        const s = door.state();
        const now = engine.world.getResource(FrameInfo)?.now ?? 0;
        if (s.since >= 0) out.push({ t: now - s.since, p: s.p, wall: performance.now() - w0 });
        if (performance.now() - w0 > ms + 200 || (out.length > 0 && (out.at(-1)?.t ?? 0) > ms)) break;
      }
      return out;
    },
    async cost(n) {
      const device = handle.device();
      const g = handle.ground();
      const last = handle.lastInputs();
      const pass = g?.tray;
      if (device === undefined || g === null || last === null || pass == null) throw new Error("desk: no frame to measure the tray in");
      const { tray: _t, held: _h, ...bare } = last;
      const shown = last.tray ?? { p: 1, lift: 0, scroll: 0 };
      const open: GroundFrameInputs = { ...bare, tray: { ...shown, p: 1, lift: 0 } };
      const { specimens: _s, ...board } = open.tray ?? shown;
      const openBare: GroundFrameInputs = { ...bare, tray: board };
      const batch = async (run: () => void): Promise<TrayCost> => {
        await device.queue.onSubmittedWorkDone();
        const t0 = performance.now();
        let cpu = 0;
        for (let i = 0; i < n; i++) { const c0 = performance.now(); run(); cpu += performance.now() - c0; }
        await device.queue.onSubmittedWorkDone();
        return { ms: (performance.now() - t0) / n, cpu: cpu / n };
      };
      const drawAlone = (): void => {
        const encoder = device.createCommandEncoder({ label: "tray/cost" });
        const rp = encoder.beginRenderPass({ label: "tray/cost", colorAttachments: [{ view: g.surface.view(), loadOp: "load", storeOp: "store" }] });
        pass.draw(rp);
        rp.end();
        device.queue.submit([encoder.finish()]);
      };
      // the board alone (no accessory — K3's measure), then with its accessories (K5a)
      pass.prepare(openBare.view, openBare.theme, openBare.grid ?? g.grid, openBare.mat, openBare.tray ?? { p: 1, lift: 0, scroll: 0 });
      const aloneBare = await batch(drawAlone);
      pass.prepare(open.view, open.theme, open.grid ?? g.grid, open.mat, open.tray ?? { p: 1, lift: 0, scroll: 0 });
      const alone = await batch(() => {
        const encoder = device.createCommandEncoder({ label: "tray/cost" });
        const rp = encoder.beginRenderPass({ label: "tray/cost", colorAttachments: [{ view: g.surface.view(), loadOp: "load", storeOp: "store" }] });
        pass.draw(rp);
        rp.end();
        device.queue.submit([encoder.finish()]);
      });
      const withTray = await batch(() => { g.render(open); });
      const bareTray = await batch(() => { g.render(openBare); });
      const closed = await batch(() => { g.render(bare); });
      g.render(last);   // the frame as it was
      return { aloneBare, alone, open: withTray, bare: bareTray, closed };
    },
  };
}
