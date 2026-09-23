/**
 * The B4 exit witness (design-013 §8 B4): DomRender under the REAL React path.
 * `<InfiniteCanvas profile={compositedProfile} ground={groundCompose(…)}>`
 * on the app-owned device, an L1 `layoutsubtree` source canvas built by the
 * facade from the ground's own handle, and a board of TEXT-FREE cards whose
 * pixels move to the GPU when they are promoted. Measured, in order:
 *
 *  1. boot — the profile mounts, HTML-in-Canvas is present, ONE L1 canvas
 *     exists in the mount, and a quiet board submits nothing;
 *  2. promote (D7) — a card at rest on the DOM, then promoted: the chrome band
 *     and the card's INTERIOR must read the same before and after, because the
 *     only thing that changed is who rasterised the same pixels. Demoted back:
 *     the same again;
 *  3. idle — promoted cards submit and copy nothing while still; a card whose
 *     content animates copies at its DEMAND BUCKET's rate, not its paint rate;
 *     a paused card copies nothing at all;
 *  4. drift — at zoom 1.9 (the old rig's DRIFT, just inside the hysteresis
 *     window where the old leg wrote 40,272 px past its slot) the page layer is
 *     read back around the slot: pixels written outside it, under BOTH raster
 *     strategies (`?raster=band|crisp` — the strategy is a mount-time fact, so
 *     it is a page load, not a switch);
 *  5. parity — the interiors of the same text-free board, promoted here and
 *     painted by the browser on the stratified twin page.
 *
 * Text-free ON PURPOSE (design-012 §5's stated fidelity seam): privacy-
 * preserving paint strips subpixel AA, so composited glyphs need not match a
 * live-DOM card's byte for byte. Geometry, colour and blending have no such
 * licence — so a text-free board asks "is the copy exact?" and nothing else.
 *
 * Mounted from `composited-render.html`, driven by
 * `scripts/composited-render.mjs`.
 */
import {
  acquireCompositorDevice,
  Camera,
  type EngineGpu,
  type Entity,
  Grab,
  NO_ENTITY,
  Position,
  RequestedDemand,
  Size,
  SurfaceBand,
  SurfaceDemand,
  SurfaceTarget,
  TextureRef,
  defineWidget,
  p,
  spawnWidget,
  widgets,
} from "@ice/core";
import { geometry, type RasterStrategy } from "@ice/kernel";
import { instrumentSubmits, probeHic, type SubmitInstrument } from "@ice/ground";
import { groundCompose, type GroundComposeContext, type GroundComposeHandle } from "@ice/ground/compose";
import { THEMES } from "@ice/ground/oracle/fixtures/vf-theme";
import { cuttingMat, needleGlyph, vfFrame } from "@ice/ground/packs";
import { compositedProfile, InfiniteCanvas, stratifiedProfile, useWidgetProps, type WidgetComponentProps } from "@ice/react";
import { createRoot } from "react-dom/client";
import type { ReactElement } from "react";
import { createDemoEngine } from "../App";

type RGB = readonly [number, number, number];

/** The board in world units: a row of text-free cards, wide apart so no slot neighbours another. */
const CARD = { w: 200, h: 130 } as const;
const GRID = { x: 60, y: 60, dx: 280, dy: 200 } as const;
const cardRect = (i: number) => ({ x: GRID.x + (i % 3) * GRID.dx, y: GRID.y + Math.floor(i / 3) * GRID.dy, w: CARD.w, h: CARD.h });

/** The palette, as literal rgb so the script can predict a sample without reading a theme. */
const PALETTE: readonly RGB[] = [
  [40, 84, 148],
  [148, 64, 40],
  [48, 120, 84],
  [120, 48, 120],
  [140, 120, 40],
  [60, 60, 132],
];
const rgbCss = (c: RGB): string => `rgb(${c[0]},${c[1]},${c[2]})`;

/**
 * The card's whole visible content: an OPAQUE fill and one block, no glyphs and
 * no transparency. Opaque matters — the ground's plate sits under a promoted
 * card's texture and a stratified card's DOM box, and those two plates are
 * different colours, so anything translucent here would measure the plate
 * rather than the copy.
 */
function PlainView({ entity, world }: WidgetComponentProps): ReactElement {
  const props = useWidgetProps<{ index: number; spin: boolean }>(world, entity, "b4-plain");
  const index = props?.index ?? 0;
  const spin = props?.spin ?? false;
  const i = Math.max(0, Math.round(index)) % PALETTE.length;
  const bg = PALETTE[i] as RGB;
  const fg = PALETTE[(i + 3) % PALETTE.length] as RGB;
  return (
    <div style={{ width: "100%", height: "100%", background: rgbCss(bg), boxSizing: "border-box" }}>
      <div
        className={spin ? "b4-spin" : undefined}
        style={{ position: "absolute", left: "24px", top: "24px", width: "72px", height: "48px", background: rgbCss(fg) }}
      />
    </div>
  );
}

const PlainCard = defineWidget({
  type: "b4-plain",
  surface: "dom",
  component: PlainView,
  defaultSize: { w: CARD.w, h: CARD.h },
  props: { index: p.number({ default: 0 }), spin: p.boolean({ default: false }) },
});

interface Mounted {
  readonly profile: string;
  readonly canvases: number;
  readonly sourceCanvases: number;
  readonly layoutSubtree: boolean;
  readonly hicMissing: readonly string[];
  readonly available: boolean;
  readonly redraws: number;
  readonly submits: number;
  readonly gpuErrors: number;
  readonly raster: RasterStrategy;
  readonly viewport: string;
}
interface Promoted {
  readonly target: string;
  readonly onCanvas: boolean;
  readonly pointerEvents: string;
  /** `document.elementFromPoint` at the card's centre names the L1 host (hit truth survived the move). */
  readonly hitIsHost: boolean;
  readonly copies: number;
  readonly refused: number;
  readonly unavailable: number;
  readonly written: number;
  readonly mode: string;
  readonly hostBox: string;
  readonly expectBox: string;
  readonly slot: string;
  readonly writtenPx: string;
}
interface DriftResult {
  readonly raster: RasterStrategy;
  readonly zoom: number;
  readonly band: number;
  readonly slot: { x: number; y: number; w: number; h: number };
  readonly layer: number;
  /** Non-transparent pixels in the ring OUTSIDE the slot rect (the drift measurement). */
  readonly outside: number;
  /** Pixels sampled in that ring. */
  readonly ringTotal: number;
  /** Non-transparent pixels INSIDE the slot — the content guard (a blank copy would pass an outside count). */
  readonly inside: number;
  readonly copies: number;
  readonly refused: number;
  readonly unavailable: number;
}
interface RenderRig {
  readonly ready: Promise<void>;
  mount(): Promise<Mounted>;
  board(n: number): Promise<{ cards: number; textured: number; redraws: number }>;
  idle(ms: number): Promise<{ frames: number; submits: number; redraws: number; copies: number; dirtied: number; resized: number; domWrites: number; wakes: Record<string, number> }>;
  points(i: number): Promise<{ band: { sx: number; sy: number }; interior: { sx: number; sy: number }[]; rect: { sx: number; sy: number; w: number; h: number } }>;
  /** THE PIXEL ARM: request `gpu` and nothing else — no Grab, so no lift, no scale, no shadow. */
  promote(i: number): Promise<Promoted>;
  /** THE STANDARD PATH: a Grab, which `ice:surface.domAtRest` answers with `gpu` (and the lift). */
  grabPromote(i: number): Promise<Promoted>;
  demote(i: number): Promise<{ target: string; onCanvas: boolean; mode: string }>;
  spin(i: number, on: boolean): Promise<void>;
  pause(i: number, on: boolean): Promise<void>;
  /** Ask a card's kind for a live bucket at `fps` — the clamp's ceiling on its copies (B8 R7, ported from the old `demand` rig). */
  bucket(i: number, fps: number): Promise<{ requested: number; granted: string }>;
  copies(): number;
  /** Set the camera's zoom (about the origin) and let the band system and the hosts settle on it. */
  zoomTo(z: number): Promise<{ zoom: number }>;
  drift(): Promise<DriftResult>;
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const frames = async (n: number) => { for (let i = 0; i < n; i++) await frame(); };

function mountRenderRig(): RenderRig {
  const params = new URLSearchParams(window.location.search);
  const raster: RasterStrategy = params.get("raster") === "crisp" ? "crisp" : "band";
  const stratified = params.get("profile") === "stratified";
  let gpu: EngineGpu | undefined;
  let instrument: SubmitInstrument | undefined;
  let handle: GroundComposeHandle | null = null;
  let engine: ReturnType<typeof createDemoEngine> | undefined;
  const rootEl = document.getElementById("root") as HTMLElement;
  const theme = THEMES.dark;
  let cards: Entity[] = [];
  let zoom = 1;

  const ready = (async () => {
    gpu = await acquireCompositorDevice();
    instrument = instrumentSubmits(gpu.device);
    engine = createDemoEngine(gpu, [PlainCard]);
    if (stratified) {
      // The parity TWIN: the same board, the same component, painted by the
      // browser. One profile per page (§11 Q2) — there is no switch.
      createRoot(rootEl).render(<InfiniteCanvas engine={engine} profile={stratifiedProfile} className="h-full w-full" />);
    } else {
      const factory = groundCompose({ device: gpu.device, theme, card: vfFrame(), grids: [needleGlyph, cuttingMat], raster: () => raster });
      const ground = (ctx: GroundComposeContext) => { handle = factory(ctx); return handle; };
      createRoot(rootEl).render(<InfiniteCanvas engine={engine} ground={ground} profile={compositedProfile} className="h-full w-full" />);
    }
    await frames(2);
  })();

  const must = <T,>(v: T | null | undefined, what: string): T => { if (v === null || v === undefined) throw new Error(`rig: no ${what}`); return v; };
  const ce = () => must(engine, "engine");
  const compose = () => must(handle, "ground handle").compose;
  const submits = () => instrument?.total() ?? 0;
  const redraws = () => handle?.compose.redraws() ?? 0;
  const copies = () => handle?.compose.domRender?.stats().copies ?? 0;
  const hostOf = (e: Entity): HTMLElement | null => document.querySelector(`[data-ice-entity="${String(e)}"]`);
  const until = async (pred: () => boolean, max = 300) => { for (let i = 0; i < max && !pred(); i++) await frame(); return pred(); };
  const toScreen = (wx: number, wy: number) => ({ sx: wx * zoom, sy: wy * zoom });
  /** What a promotion looks like from outside: the world's facts, the host's box, and the slot beside what the copy writes. */
  const report = (i: number, card: Entity, ok: boolean): Promoted => {
    const world = ce().world;
    const st = handle?.compose.domRender?.stats();
    const el = hostOf(card);
    const size = must(world.get(card, Size), "Size");
    const band = must(world.get(card, SurfaceBand), "SurfaceBand").band;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const geo = geometry({ w: size.w, h: size.h }, band, dpr, zoom, raster);
    const ref = world.get(card, TextureRef);
    const side = 2048;
    const r = cardRect(i);
    const c = toScreen(r.x + r.w / 2, r.y + r.h / 2);
    const hit = document.elementFromPoint(c.sx, c.sy);
    return {
      target: world.get(card, SurfaceTarget)?.target ?? "?",
      onCanvas: el?.parentElement?.hasAttribute("data-ice-source-canvas") === true,
      pointerEvents: el?.style.pointerEvents ?? "",
      hitIsHost: hit !== null && el !== null && (hit === el || el.contains(hit)),
      copies: st?.copies ?? 0,
      refused: st?.refused ?? 0,
      unavailable: st?.unavailable ?? -1,
      written: handle?.compose.residency.stats().written ?? 0,
      mode: ok ? (handle?.compose.residency.contentOf(card).mode ?? "?") : "never-written",
      hostBox: `${el?.style.width ?? "?"}x${el?.style.height ?? "?"}`,
      expectBox: `${geo.cssSize.w}pxx${geo.cssSize.h}px`,
      slot: ref === undefined ? "?" : `${Math.round((ref.u1 - ref.u0) * side)}x${Math.round((ref.v1 - ref.v0) * side)}`,
      writtenPx: `${geo.written.w}x${geo.written.h}`,
    };
  };

  return {
    ready,
    async mount() {
      await ready;
      if (!stratified) await until(() => (handle?.compose.available() ?? false) && redraws() > 0);
      const probe = probeHic(document);
      return {
        profile: stratified ? stratifiedProfile.name : compositedProfile.name,
        canvases: rootEl.querySelectorAll("canvas:not([data-ice-source-canvas])").length,
        sourceCanvases: rootEl.querySelectorAll("canvas[data-ice-source-canvas]").length,
        layoutSubtree: probe.capabilities.layoutSubtree,
        hicMissing: probe.missing,
        available: handle?.compose.available() ?? stratified,
        redraws: redraws(),
        submits: submits(),
        gpuErrors: gpu?.errors().length ?? 0,
        raster,
        viewport: `${rootEl.clientWidth}x${rootEl.clientHeight}`,
      };
    },
    async board(n) {
      const e = ce();
      const world = e.world;
      const session = e.docs.create();
      zoom = 1;
      world.setResource(Camera, { x: 0, y: 0, zoom, gesturing: false });
      cards = [];
      for (let i = 0; i < n; i++) {
        const r = cardRect(i);
        cards.push(spawnWidget(session.store, world, "b4-plain", { ...r, undoable: false, props: { index: i, spin: false } }));
      }
      world.sync();
      await frames(6);
      await until(() => hostOf(must(cards[0], "card 0")) !== null);
      await frames(3);
      const s = handle?.compose.stats();
      return { cards: s?.cards ?? 0, textured: s?.textured ?? 0, redraws: redraws() };
    },
    async idle(ms) {
      const s0 = submits();
      const r0 = redraws();
      const st0 = handle?.compose.domRender?.stats();
      const d0 = handle?.compose.domWrites().writes ?? 0;
      const w0: Record<string, number> = { ...(handle?.compose.wakes() ?? {}) };
      const t0 = performance.now();
      let n = 0;
      while (performance.now() - t0 < ms) { await frame(); n++; }
      const wakes: Record<string, number> = {};
      for (const [k, v] of Object.entries(handle?.compose.wakes() ?? {})) { const d = v - (w0[k] ?? 0); if (d > 0) wakes[k] = d; }
      const st1 = handle?.compose.domRender?.stats();
      return {
        frames: n,
        submits: submits() - s0,
        redraws: redraws() - r0,
        copies: (st1?.copies ?? 0) - (st0?.copies ?? 0),
        dirtied: (st1?.dirtied ?? 0) - (st0?.dirtied ?? 0),
        resized: (st1?.resized ?? 0) - (st0?.resized ?? 0),
        domWrites: (handle?.compose.domWrites().writes ?? 0) - d0,
        wakes,
      };
    },
    async points(i) {
      const r = cardRect(i);
      // The chrome band: 2 CSS px inside the card's top edge, offset from the
      // edge CENTRE (the engine's P4 resize grip lives there — B3b's finding).
      const band = toScreen(r.x + r.w * 0.28, r.y + 2);
      // Interior samples: inside the card's own rect, on the fill and on the
      // block, well away from every edge the coverage filter antialiases.
      const interior = [
        toScreen(r.x + 60, r.y + 40),   // the block
        toScreen(r.x + 150, r.y + 40),  // the fill, right of the block
        toScreen(r.x + 100, r.y + 100), // the fill, below it
      ];
      return { band, interior, rect: { ...toScreen(r.x, r.y), w: r.w * zoom, h: r.h * zoom } };
    },
    async promote(i) {
      const world = ce().world;
      const card = must(cards[i], `card ${i}`);
      // THE PIXEL ARM asks for `gpu` and NOTHING else. Promoting through the
      // standard behaviour means a Grab, and a Grab is a LIFT: the card scales
      // by `ChromeSettings.liftScale` and grows a shadow, so a before/after
      // comparison would measure the lift and call it the copy. `domAtRest`
      // does not contest this write (it writes only for cards it grabbed), so
      // the target simply reads `gpu` until the demote below.
      world.edit(card).set(SurfaceTarget, { target: "gpu" });
      const ok = await until(() => handle?.compose.residency.isWritten(card) === true, 240);
      await frames(3);
      return report(i, card, ok);
    },
    async grabPromote(i) {
      const world = ce().world;
      const card = must(cards[i], `card ${i}`);
      const r = cardRect(i);
      // THE STANDARD PATH, end to end: `ice:surface.domAtRest` answers a Grab
      // with `gpu` and demotes 250 ms after the release. The Grab rider is a
      // rig setup write (there is no pointer here) — the same debt the S6 rig
      // carries — and the lift that comes with it is exactly the point.
      world.addComponent(card, Grab, { x: r.x, y: r.y, w: r.w, h: r.h, parent: NO_ENTITY, prev: NO_ENTITY, ord: 0 });
      const ok = await until(() => handle?.compose.residency.isWritten(card) === true, 240);
      await frames(3);
      const out = report(i, card, ok);
      world.removeComponent(card, Grab);
      await until(() => world.get(card, SurfaceTarget)?.target === "dom", 300);
      await frames(4);
      return out;
    },
    async demote(i) {
      const world = ce().world;
      const card = must(cards[i], `card ${i}`);
      world.edit(card).set(SurfaceTarget, { target: "dom" });
      await until(() => world.get(card, SurfaceTarget)?.target === "dom", 60);
      await frames(4);
      const el = hostOf(card);
      return {
        target: world.get(card, SurfaceTarget)?.target ?? "?",
        onCanvas: el?.parentElement?.hasAttribute("data-ice-source-canvas") === true,
        mode: handle?.compose.residency.contentOf(card).mode ?? "?",
      };
    },
    async spin(i, on) {
      const world = ce().world;
      const card = must(cards[i], `card ${i}`);
      // A rig SETUP write straight into the props group: `ops.setWidgetProps`
      // runs the canvas type's placement check, and this rig's card is not on
      // the demo board's admitted list (it is the rig's, not the product's).
      const group = must(widgets.get("b4-plain")?.groups.find((g) => g.name === "props"), "the props group");
      const cur = world.get(card, group.component) as { index: number; spin: boolean } | undefined;
      world.edit(card).set(group.component, { index: cur?.index ?? i, spin: on });
      await frames(4);
    },
    async bucket(i, fps) {
      const world = ce().world;
      const card = must(cards[i], `card ${i}`);
      // A rig SETUP write of the kind's own request, as `pause` does.
      world.edit(card).set(RequestedDemand, { mode: "live", fpsBucket: fps, interactive: false });
      await until(() => (world.get(card, SurfaceDemand)?.fpsBucket ?? -1) === fps, 60);
      await frames(2);
      const d = world.get(card, SurfaceDemand);
      return { requested: fps, granted: `${d?.mode ?? "?"}@${d?.fpsBucket ?? -1}` };
    },
    async pause(i, on) {
      const world = ce().world;
      const card = must(cards[i], `card ${i}`);
      // A rig SETUP write of the kind's own request: the clamp folds it.
      world.edit(card).set(RequestedDemand, on ? { mode: "paused", fpsBucket: 0, interactive: false } : { mode: "live", fpsBucket: 60, interactive: false });
      await until(() => (world.get(card, SurfaceDemand)?.mode ?? "live") === (on ? "paused" : "live"), 60);
      await frames(2);
    },
    copies,
    async zoomTo(z) {
      zoom = z;
      ce().world.setResource(Camera, { x: 0, y: 0, zoom, gesturing: false });
      await frames(6);
      return { zoom };
    },
    async drift() {
      const world = ce().world;
      const device = must(gpu, "gpu").device;
      // ONE card on the board, so every texel outside its slot is untouched.
      const session = ce().docs.create();
      zoom = 1.9;
      world.setResource(Camera, { x: 0, y: 0, zoom, gesturing: false });
      const r = cardRect(0);
      const card = spawnWidget(session.store, world, "b4-plain", { ...r, undoable: false, props: { index: 0, spin: false } });
      cards = [card];
      world.sync();
      await frames(6);
      await until(() => hostOf(card) !== null);
      await frames(2);
      world.addComponent(card, Grab, { x: r.x, y: r.y, w: r.w, h: r.h, parent: NO_ENTITY, prev: NO_ENTITY, ord: 0 });
      await until(() => handle?.compose.residency.isWritten(card) === true, 300);
      await frames(3);

      const ref = must(world.get(card, TextureRef), "a TextureRef");
      const pages = must(handle?.compose.residency.textureOf(ref.texture), "the realised page array");
      const side = pages.width;
      const x0 = Math.round(ref.u0 * side);
      const y0 = Math.round(ref.v0 * side);
      const w = Math.round((ref.u1 - ref.u0) * side);
      const h = Math.round((ref.v1 - ref.v0) * side);
      // A window around the slot: the slot plus a 4 px ring on every side.
      const pad = 4;
      const wx = Math.max(0, x0 - pad);
      const wy = Math.max(0, y0 - pad);
      const ww = Math.min(side - wx, w + 2 * pad);
      const wh = Math.min(side - wy, h + 2 * pad);
      const bytesPerRow = Math.ceil((ww * 4) / 256) * 256;
      const buffer = device.createBuffer({ size: bytesPerRow * wh, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = device.createCommandEncoder({ label: "drift readback" });
      enc.copyTextureToBuffer(
        { texture: pages, origin: { x: wx, y: wy, z: ref.layer } },
        { buffer, bytesPerRow, rowsPerImage: wh },
        { width: ww, height: wh, depthOrArrayLayers: 1 },
      );
      device.queue.submit([enc.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      const px = new Uint8Array(buffer.getMappedRange().slice(0));
      buffer.unmap();
      buffer.destroy();

      let outside = 0;
      let ringTotal = 0;
      let inside = 0;
      for (let y = 0; y < wh; y++) {
        for (let x = 0; x < ww; x++) {
          const gx = wx + x;
          const gy = wy + y;
          const within = gx >= x0 && gx < x0 + w && gy >= y0 && gy < y0 + h;
          const a = px[y * bytesPerRow + x * 4 + 3] as number;
          if (within) { if (a !== 0) inside++; continue; }
          ringTotal++;
          if (a !== 0) outside++;
        }
      }
      const st = handle?.compose.domRender?.stats();
      return {
        raster,
        zoom,
        band: world.get(card, SurfaceBand)?.band ?? 0,
        slot: { x: x0, y: y0, w, h },
        layer: ref.layer,
        outside,
        ringTotal,
        inside,
        copies: st?.copies ?? 0,
        refused: st?.refused ?? 0,
        unavailable: st?.unavailable ?? -1,
      };
    },
  };
}

declare global {
  interface Window { __renderRig?: RenderRig }
}
window.__renderRig = mountRenderRig();
