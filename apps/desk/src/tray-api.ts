// `window.__desk.tray` — the pegboard drawer's doors for the rigs (design-017 §10; K3): the handle's door (open, close, toggle, isOpen,
// scroll, pin, state), the facts as core holds them, a TRACE of the slide on the frame clock (the curve's witness), and the COST of the
// drawer on the GPU — a saturated batch of it alone into the canvas's texture (the queue drained around it), beside whole frames with
// the drawer open and closed.

import { type CanvasEngine, FrameInfo, Tray, trayEntity } from "@ice/core";
import type { DeskLayerHandle, GroundFrameInputs, TrayPin } from "@ice/desk";

export interface TrayCost { readonly ms: number; readonly cpu: number }

export interface TrayApi {
  open(): boolean;
  close(): void;
  toggle(): boolean;
  isOpen(): boolean;
  /** The board's scroll, CSS px past its top — set when given, and returned. */
  scroll(px?: number): number;
  pin(pin: TrayPin | null): void;
  state(): ReturnType<DeskLayerHandle["tray"]["state"]>;
  /** Core's `Tray` fact as it stands (null: no tray entity). */
  facts(): { readonly open: boolean; readonly scroll: number; readonly stretch: number; readonly lip: boolean; readonly wheelAt: number } | null;
  /** Toggle the drawer, then sample its slide every frame for `ms` of the frame clock: `t` since the tween began (frame clock), `wall` since the toggle (performance.now()), `p`. */
  trace(ms: number): Promise<readonly { readonly t: number; readonly wall: number; readonly p: number }[]>;
  /** The drawer's GPU cost (open, at the frame's view): `n` of it alone per batch, and whole frames with it open and closed — ms per frame, drained. */
  cost(n: number): Promise<{ readonly alone: TrayCost; readonly open: TrayCost; readonly closed: TrayCost }>;
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
      return t === undefined ? null : { open: t.open, scroll: t.scroll, stretch: t.stretch, lip: t.lip, wheelAt: t.wheelAt };
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
      const open: GroundFrameInputs = { ...bare, tray: { p: 1, lift: 0, scroll: last.tray?.scroll ?? 0 } };
      const batch = async (run: () => void): Promise<TrayCost> => {
        await device.queue.onSubmittedWorkDone();
        const t0 = performance.now();
        let cpu = 0;
        for (let i = 0; i < n; i++) { const c0 = performance.now(); run(); cpu += performance.now() - c0; }
        await device.queue.onSubmittedWorkDone();
        return { ms: (performance.now() - t0) / n, cpu: cpu / n };
      };
      pass.prepare(open.view, open.theme, open.grid ?? g.grid, open.mat, open.tray ?? { p: 1, lift: 0, scroll: 0 });
      const alone = await batch(() => {
        const encoder = device.createCommandEncoder({ label: "tray/cost" });
        const rp = encoder.beginRenderPass({ label: "tray/cost", colorAttachments: [{ view: g.surface.view(), loadOp: "load", storeOp: "store" }] });
        pass.draw(rp);
        rp.end();
        device.queue.submit([encoder.finish()]);
      });
      const withTray = await batch(() => { g.render(open); });
      const closed = await batch(() => { g.render(bare); });
      g.render(last);   // the frame as it was
      return { alone, open: withTray, closed };
    },
  };
}
