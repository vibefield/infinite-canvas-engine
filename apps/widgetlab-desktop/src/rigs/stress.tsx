/**
 * The STRESS rig (2026-09-09): many DOM cards with LOOPING CSS ANIMATIONS under the
 * two standard surface behaviours, measured against each other —
 *
 *   arm `dom`  `ice:surface.domAtRest` (the default): live DOM at rest, the GPU only
 *              while grabbed. Chromium paints and composites the cards; the ground
 *              draws chrome and field and otherwise sleeps.
 *   arm `gpu`  `ice:surface.alwaysGpu`: every card's pixels go through the
 *              HTML-in-Canvas copy into Residency's page layers, always, and the
 *              ground draws them. Every paint event is a whole-card copy at the
 *              demand bucket and a full ground frame.
 *
 * ONE ARM AND ONE BOARD SIZE PER PAGE LOAD (`?arm=dom|gpu&n=48`). The behaviour is
 * a definition-time fact, and the memory question needs a fresh process per arm
 * (hic-bench §6: GPU-process footprint drifts monotonically inside one process, so
 * an in-process A/B measures the drift).
 *
 * What one window measures (`window(ms, opts)`): rAF frames and their interval
 * distribution (what the user feels), the main-thread time spent INSIDE rAF
 * callbacks (the engine's loop — DomRender's flush, the frame build, the encode;
 * Chromium's own paint is outside JS and shows up in the driver's per-process CPU
 * instead), long tasks, and the ground's own counters: submits, redraws, wakes,
 * copies, paint marks, refusals, the clamp's parked/deferred sets, page layers.
 *
 * Two animation kinds, because they are different questions for a live-DOM arm:
 * COMPOSITOR-driven (`transform` + `opacity` on their own layers — no main-thread
 * paint at all under live DOM) and PAINT-driven (`width` + `background-color` —
 * layout and paint every frame under either arm). The gpu arm cannot tell them
 * apart: inside the source canvas every animation frame is a paint event.
 *
 * Mounted from `stress.html`, driven by `scripts/stress.mjs`.
 */
import {
  acquireCompositorDevice,
  alwaysGpu,
  Camera,
  type EngineGpu,
  type Entity,
  Grab,
  NO_ENTITY,
  Position,
  RequestedDemand,
  SurfaceBand,
  SurfaceDemand,
  SurfaceTarget,
  TextureRef,
  defineWidget,
  p,
  spawnWidget,
} from "@ice/core";
import { instrumentSubmits, probeHic, type SubmitInstrument } from "@ice/ground";
import { groundCompose, type GroundComposeContext, type GroundComposeHandle } from "@ice/ground/compose";
import { THEMES } from "@ice/ground/oracle/fixtures/vf-theme";
import { cuttingMat, needleGlyph, vfFrame } from "@ice/ground/packs";
import { compositedProfile, InfiniteCanvas, useWidgetProps, type WidgetComponentProps } from "@ice/react";
import { createRoot } from "react-dom/client";
import type { ReactElement } from "react";
import { createDemoEngine } from "../App";

// ---------------------------------------------------------------------------
// The main-thread instrument: every rAF callback's duration. Installed at module
// evaluation, before the engine's loop is started (`ready` below), and the loop
// reads the GLOBAL per frame (`@ice/dom`'s loop.ts calls `requestAnimationFrame`
// by name), so the wrapper sees the engine's tick. The rig's own `frame()` waits
// are wrapped too; they cost microseconds and are counted honestly.
// ---------------------------------------------------------------------------
const raf = { calls: 0, ms: 0, maxMs: 0 };
{
  const original = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb: FrameRequestCallback): number =>
    original((t) => {
      const s = performance.now();
      try {
        cb(t);
      } finally {
        const d = performance.now() - s;
        raf.calls += 1;
        raf.ms += d;
        if (d > raf.maxMs) raf.maxMs = d;
      }
    });
}
/** Long tasks (≥ 50 ms on the main thread), from the platform's own observer. */
const longTasks = { count: 0, ms: 0 };
try {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      longTasks.count += 1;
      longTasks.ms += entry.duration;
    }
  }).observe({ entryTypes: ["longtask"] });
} catch {
  // an older platform without the entry type: the count stays 0 and says so
}

// ---------------------------------------------------------------------------
// The card. Same component under both arms; the arm is the widget TYPE's behaviour.
// ---------------------------------------------------------------------------
const CARD = { w: 150, h: 100 } as const;
const GAP = 10;
const ORIGIN = 20;
const PALETTE = ["#2b3a67", "#4a2b4f", "#1f4b3f", "#5a3b1f", "#2f3d52", "#4b2f2f"] as const;

function viewFor(type: string) {
  return function StressView({ entity, world }: WidgetComponentProps): ReactElement {
    const props = useWidgetProps<{ index: number }>(world, entity, type);
    const index = Math.max(0, Math.round(props?.index ?? 0));
    const bg = PALETTE[index % PALETTE.length] as string;
    return (
      <div className="st-card" style={{ background: bg }} {...(index === 0 ? { "data-one": "" } : {})}>
        <div className="st-title">card {index}</div>
        <div className="st-spin" />
        <div className="st-pulse" />
        <div className="st-bar" />
        <div className="st-hue" />
        <div className="st-text">the quick brown fox jumps over the lazy dog {index}</div>
      </div>
    );
  };
}

const StressDom = defineWidget({
  type: "stress-dom",
  surface: "dom",
  component: viewFor("stress-dom"),
  defaultSize: { w: CARD.w, h: CARD.h },
  props: { index: p.number({ default: 0 }) },
});
const StressGpu = defineWidget({
  type: "stress-gpu",
  surface: "dom",
  component: viewFor("stress-gpu"),
  defaultSize: { w: CARD.w, h: CARD.h },
  props: { index: p.number({ default: 0 }) },
  behaviors: [alwaysGpu],
});

type Arm = "dom" | "gpu";
type Anim = "none" | "compositor" | "compositor-one" | "paint";

interface Counters {
  readonly submits: number;
  readonly redraws: number;
  readonly copies: number;
  readonly dirtied: number;
  readonly selfDirt: number;
  readonly refused: number;
  readonly unavailable: number;
  readonly oversize: number;
  readonly backedOff: number;
  readonly resized: number;
  readonly growths: number;
  readonly domWrites: number;
  readonly clips: number;
  readonly touches: number;
  readonly rafCalls: number;
  readonly rafMs: number;
  readonly longTasks: number;
  readonly longTaskMs: number;
  readonly wakes: Record<string, number>;
}
interface Gauges {
  readonly parked: number;
  readonly deferred: number;
  readonly pending: number;
  readonly pagesLayers: number;
  readonly realized: number;
  readonly written: number;
  readonly textured: number;
  readonly cards: number;
  readonly animations: number;
}
interface Mounted {
  readonly arm: Arm;
  readonly n: number;
  readonly profile: string;
  readonly hicMissing: readonly string[];
  readonly layoutSubtree: boolean;
  readonly available: boolean;
  readonly gpuErrors: number;
  readonly viewport: string;
  readonly dpr: number;
  readonly refreshHz: number;
  readonly crossOriginIsolated: boolean;
}
interface Board {
  readonly cards: number;
  readonly cols: number;
  readonly rows: number;
  readonly zoom: number;
  readonly band: number;
  /** One card's slot, device px (the copy's extent under `band` raster). */
  readonly slot: { w: number; h: number };
  readonly slotTexels: number;
  readonly targets: { dom: number; gpu: number };
  readonly hostsOnCanvas: number;
  readonly written: number;
  readonly textured: number;
  readonly copies: number;
  readonly refused: number;
  readonly pagesLayers: number;
  readonly framesToSettle: number;
  /** The camera as the world holds it at the end of the board step. */
  readonly camera: { x: number; y: number; zoom: number };
  /** Hosts in the document at the end of the board step (every card should have one). */
  readonly hostsMounted: number;
}
interface WindowResult {
  readonly frames: number;
  readonly wallMs: number;
  readonly fps: number;
  readonly interval: { p50: number; p95: number; max: number; over12: number; over25: number; over50: number };
  readonly delta: Counters;
  readonly gauges: Gauges;
  readonly rafMsPerFrame: number;
  readonly rafMaxMs: number;
  readonly zoomRange?: { from: number; to: number; bandFrom: number; bandTo: number };
  /** Camera drifts the guard corrected so far, and Camera writes made outside the rig so far (cumulative). */
  readonly cameraDrifts: number;
  readonly foreignCameraWrites: number;
  /** Pan windows only: card 0's resolved geometry fields that feed the DOM clip key, at the window's first and last frame, and which of them moved. */
  readonly clipFields?: { first: Record<string, string>; last: Record<string, string>; changed: string[]; clips: number; early: { frame: number; changed: string[]; from: Record<string, string>; to: Record<string, string> }[] };
}
interface StressRig {
  readonly ready: Promise<void>;
  mount(): Promise<Mounted>;
  board(): Promise<Board>;
  anim(mode: Anim): Promise<{ mode: Anim; animations: number }>;
  window(ms: number, opts?: { pan?: boolean; zoomCross?: boolean }): Promise<WindowResult>;
  /** Every card's cadence ask, for the gpu arm's lever. */
  bucket(fps: number): Promise<{ requested: number; granted: string; cards: number }>;
  /**
   * THE DRAG (2026-09-09, the gesture set): grab card 0 and carry it onto card 1 over `ms`,
   * as the standard `domAtRest` behaviour sees it (a `Grab` rider, a `Position` walk). Reports
   * the pickup (targets and demand modes after the grab, the frames whose build still drew
   * plates, the longest early frame), the carry (copies, submits, fps) and where card 0 ended,
   * so the driver can read the overlap's pixel. `release()` drops it and waits out the settle.
   */
  drag(ms: number): Promise<DragResult>;
  release(settleMs: number): Promise<ReleaseResult>;
  /** Screen rects for the motion witness: the whole card, its spinner, its bar. */
  rects(i: number): { card: Rect; spin: Rect; bar: Rect };
  /**
   * The GPU-side witness (gpu arm): card i's slot in the page array, read back and hashed —
   * `ink` is its non-transparent texel count. Two calls apart in time answer whether the
   * COPY brings new pixels, independently of what the screen presents; `null` when the card
   * has no realised destination (the dom arm).
   */
  texels(i: number): Promise<{ hash: string; ink: number; w: number; h: number; layer: number } | null>;
  counters(): Counters;
}
interface Rect { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
interface DragResult {
  readonly targets: { dom: number; gpu: number };
  readonly demand: { live: number; paused: number };
  /** `stats().textured` and `cards` on each of the first 12 frames after the grab: a frame with textured < cards drew plates. */
  readonly plateFrames: { frame: number; textured: number; cards: number }[];
  readonly pickupMaxMs: number;
  readonly frames: number;
  readonly fps: number;
  readonly interval: { p50: number; p95: number; max: number };
  readonly delta: Counters;
  readonly stills: number;
  readonly rafMsPerFrame: number;
  /** Card 0's final screen rect (over card 1) and a plain-background sample point inside it, for the overlap witness. */
  readonly over: { card: Rect; sample: { x: number; y: number }; expectRgb: [number, number, number]; underRgb: [number, number, number] };
}
interface ReleaseResult {
  readonly targets: { dom: number; gpu: number };
  readonly demand: { live: number; paused: number };
  readonly delta: Counters;
  readonly frames: number;
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const frames = async (n: number) => { for (let i = 0; i < n; i++) await frame(); };
const quantile = (xs: readonly number[], q: number): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * q)))] as number;
};

function mountStressRig(): StressRig {
  const params = new URLSearchParams(window.location.search);
  const arm: Arm = params.get("arm") === "gpu" ? "gpu" : "dom";
  const n = Math.max(1, Number(params.get("n") ?? "48") || 48);
  const type = arm === "gpu" ? "stress-gpu" : "stress-dom";
  let gpu: EngineGpu | undefined;
  let instrument: SubmitInstrument | undefined;
  let handle: GroundComposeHandle | null = null;
  let engine: ReturnType<typeof createDemoEngine> | undefined;
  const rootEl = document.getElementById("root") as HTMLElement;
  const theme = THEMES.dark;
  let cards: Entity[] = [];
  let cols = 1;
  let rows = 1;
  let zoom = 1;
  /**
   * THE CAMERA GUARD. Two sweep cells on the dom arm lost their board to a camera write the
   * rig never made (one before the board mounted, one between two phases). The rig keeps the
   * camera it intends, re-applies it at the start of every still window and before a witness,
   * counts the drifts, and names the writer: `setResource` is wrapped so a Camera write that
   * is not the rig's own logs its stack under the `[ice-stress]` prefix the driver echoes.
   */
  const intended = { x: 0, y: 0, zoom: 1 };
  let rigWriting = false;
  let cameraDrifts = 0;
  let foreignWrites = 0;

  const ready = (async () => {
    gpu = await acquireCompositorDevice();
    instrument = instrumentSubmits(gpu.device);
    engine = createDemoEngine(gpu, [StressDom, StressGpu]);
    armCameraWatch();
    const factory = groundCompose({ device: gpu.device, theme, card: vfFrame(), grids: [needleGlyph, cuttingMat] });
    const ground = (ctx: GroundComposeContext) => { handle = factory(ctx); return handle; };
    createRoot(rootEl).render(<InfiniteCanvas engine={engine} ground={ground} profile={compositedProfile} className="h-full w-full" />);
    await frames(2);
  })();

  const must = <T,>(v: T | null | undefined, what: string): T => { if (v === null || v === undefined) throw new Error(`rig: no ${what}`); return v; };
  const ce = () => must(engine, "engine");
  const until = async (pred: () => boolean, max = 600): Promise<number> => { let i = 0; for (; i < max && !pred(); i++) await frame(); return pred() ? i : -1; };
  const hostOf = (e: Entity): HTMLElement | null => document.querySelector(`[data-ice-entity="${String(e)}"]`);
  const cardWorld = (i: number) => ({ x: ORIGIN + (i % cols) * (CARD.w + GAP), y: ORIGIN + Math.floor(i / cols) * (CARD.h + GAP), w: CARD.w, h: CARD.h });
  const cam = () => ce().world.getResource(Camera) ?? { x: 0, y: 0, zoom: 1, gesturing: false };
  const toScreen = (wx: number, wy: number) => { const c = cam(); return { x: (wx - c.x) * c.zoom, y: (wy - c.y) * c.zoom }; };
  const setCamera = (x: number, y: number, z: number, gesturing: boolean) => { rigWriting = true; try { ce().world.setResource(Camera, { x, y, zoom: z, gesturing }); } finally { rigWriting = false; } };
  const holdCamera = (x: number, y: number, z: number) => { intended.x = x; intended.y = y; intended.zoom = z; setCamera(x, y, z, false); };
  /** Re-apply the intended camera when the world's has drifted; returns whether it had. */
  const guardCamera = (): boolean => {
    const c = cam();
    if (Math.abs(c.x - intended.x) < 1e-6 && Math.abs(c.y - intended.y) < 1e-6 && Math.abs(c.zoom - intended.zoom) < 1e-6) return false;
    cameraDrifts += 1;
    console.warn(`[ice-stress] camera drifted to ${JSON.stringify(c)} from ${JSON.stringify(intended)} (drift ${cameraDrifts}); re-applied`);
    setCamera(intended.x, intended.y, intended.zoom, false);
    return true;
  };
  function armCameraWatch(): void {
    const world = ce().world;
    const original = world.setResource.bind(world);
    (world as { setResource: typeof world.setResource }).setResource = ((res: unknown, value: unknown) => {
      if (res === Camera && !rigWriting) {
        foreignWrites += 1;
        if (foreignWrites <= 5) console.warn(`[ice-stress] Camera written outside the rig (${foreignWrites}): ${JSON.stringify(value)}\n${new Error("writer").stack ?? ""}`);
      }
      return original(res as never, value as never);
    }) as typeof world.setResource;
  }

  const counters = (): Counters => {
    const st = handle?.compose.domRender?.stats();
    const dw = handle?.compose.domWrites();
    return {
      submits: instrument?.total() ?? 0,
      redraws: handle?.compose.redraws() ?? 0,
      copies: st?.copies ?? 0,
      dirtied: st?.dirtied ?? 0,
      selfDirt: st?.selfDirt ?? 0,
      refused: st?.refused ?? 0,
      unavailable: st?.unavailable ?? 0,
      oversize: st?.oversize ?? 0,
      backedOff: st?.backedOff ?? 0,
      resized: st?.resized ?? 0,
      growths: st?.growths ?? 0,
      domWrites: dw?.writes ?? 0,
      clips: dw?.clips ?? 0,
      touches: handle?.compose.residency.stats().touches ?? 0,
      rafCalls: raf.calls,
      rafMs: raf.ms,
      longTasks: longTasks.count,
      longTaskMs: longTasks.ms,
      wakes: { ...(handle?.compose.wakes() ?? {}) },
    };
  };
  const gauges = (): Gauges => {
    const st = handle?.compose.domRender?.stats();
    const rs = handle?.compose.residency.stats();
    const gs = handle?.compose.stats();
    return {
      parked: st?.parked ?? 0,
      deferred: st?.deferred ?? 0,
      pending: st?.pending ?? 0,
      pagesLayers: st?.pagesLayers ?? 0,
      realized: rs?.realized ?? 0,
      written: rs?.written ?? 0,
      textured: gs?.textured ?? 0,
      cards: gs?.cards ?? 0,
      animations: document.getAnimations().length,
    };
  };
  const diff = (a: Counters, b: Counters): Counters => {
    const wakes: Record<string, number> = {};
    for (const [k, v] of Object.entries(b.wakes)) { const d = v - (a.wakes[k] ?? 0); if (d > 0) wakes[k] = d; }
    return {
      submits: b.submits - a.submits,
      redraws: b.redraws - a.redraws,
      copies: b.copies - a.copies,
      dirtied: b.dirtied - a.dirtied,
      selfDirt: b.selfDirt - a.selfDirt,
      refused: b.refused - a.refused,
      unavailable: b.unavailable - a.unavailable,
      oversize: b.oversize - a.oversize,
      backedOff: b.backedOff - a.backedOff,
      resized: b.resized - a.resized,
      growths: b.growths - a.growths,
      domWrites: b.domWrites - a.domWrites,
      clips: b.clips - a.clips,
      touches: b.touches - a.touches,
      rafCalls: b.rafCalls - a.rafCalls,
      rafMs: b.rafMs - a.rafMs,
      longTasks: b.longTasks - a.longTasks,
      longTaskMs: b.longTaskMs - a.longTaskMs,
      wakes,
    };
  };
  const bandOf = (): number => (cards[0] === undefined ? 0 : (ce().world.get(cards[0], SurfaceBand)?.band ?? 0));

  return {
    ready,
    async mount() {
      await ready;
      await until(() => (handle?.compose.available() ?? false) && (handle?.compose.redraws() ?? 0) > 0);
      const probe = probeHic(document);
      // The display's rate, from 30 rAF intervals — the driver divides by it.
      const stamps: number[] = [];
      for (let i = 0; i < 31; i++) { await frame(); stamps.push(performance.now()); }
      const gaps = stamps.slice(1).map((t, i) => t - (stamps[i] as number));
      const refreshHz = Math.round(1000 / quantile(gaps, 0.5));
      return {
        arm,
        n,
        profile: compositedProfile.name,
        hicMissing: probe.missing,
        layoutSubtree: probe.capabilities.layoutSubtree,
        available: handle?.compose.available() ?? false,
        gpuErrors: gpu?.errors().length ?? 0,
        viewport: `${rootEl.clientWidth}x${rootEl.clientHeight}`,
        dpr: window.devicePixelRatio,
        refreshHz,
        crossOriginIsolated: window.crossOriginIsolated === true,
      };
    },
    async board() {
      const e = ce();
      const world = e.world;
      const session = e.docs.create();
      // A grid that FITS the viewport, so every card is Visible (a culled card folds
      // to paused demand and would measure nothing): columns by the viewport's aspect,
      // the zoom by whichever axis binds, never above 1.
      const vw = rootEl.clientWidth;
      const vh = rootEl.clientHeight;
      cols = Math.max(1, Math.ceil(Math.sqrt((n * vw) / vh)));
      rows = Math.max(1, Math.ceil(n / cols));
      const worldW = ORIGIN * 2 + cols * (CARD.w + GAP) - GAP;
      const worldH = ORIGIN * 2 + rows * (CARD.h + GAP) - GAP;
      zoom = Math.min(1, vw / worldW, vh / worldH);
      holdCamera(0, 0, zoom);
      cards = [];
      for (let i = 0; i < n; i++) {
        cards.push(spawnWidget(session.store, world, type, { ...cardWorld(i), undoable: false, props: { index: i } }));
      }
      world.sync();
      await frames(6);
      // RE-ASSERT the camera after the spawn has projected: one sweep cell (dom, 48) came up
      // with every card culled and no host mounted — a camera write landing a frame after
      // the rig's own is the one explanation that fits all of its symptoms, so the camera is
      // written again here and reported below, where a failed mount can be diagnosed.
      holdCamera(0, 0, zoom);
      await frames(2);
      await until(() => hostOf(must(cards[0], "card 0")) !== null);
      // The gpu arm settles when EVERY card has been copied once (a first copy is
      // refused on an unpainted host and retried); the dom arm when its hosts exist.
      const settled = arm === "gpu"
        ? await until(() => (handle?.compose.residency.stats().written ?? 0) >= n, 1200)
        : await until(() => cards.every((c) => hostOf(c) !== null), 600);
      await frames(6);
      const targets = { dom: 0, gpu: 0 };
      let onCanvas = 0;
      for (const c of cards) {
        const t = world.get(c, SurfaceTarget)?.target;
        if (t === "gpu") targets.gpu += 1; else targets.dom += 1;
        if (hostOf(c)?.parentElement?.hasAttribute("data-ice-source-canvas")) onCanvas += 1;
      }
      const ref = cards[0] === undefined ? undefined : world.get(cards[0], TextureRef);
      const side = 2048;
      const slot = ref === undefined || ref.texture === 0
        ? { w: 0, h: 0 }
        : { w: Math.round((ref.u1 - ref.u0) * side), h: Math.round((ref.v1 - ref.v0) * side) };
      const st = handle?.compose.domRender?.stats();
      const g = gauges();
      return {
        cards: g.cards,
        cols,
        rows,
        zoom,
        band: bandOf(),
        slot,
        slotTexels: slot.w * slot.h,
        targets,
        hostsOnCanvas: onCanvas,
        written: g.written,
        textured: g.textured,
        copies: st?.copies ?? 0,
        refused: st?.refused ?? 0,
        pagesLayers: g.pagesLayers,
        framesToSettle: settled,
        camera: { x: cam().x, y: cam().y, zoom: cam().zoom },
        hostsMounted: cards.filter((c) => hostOf(c) !== null).length,
      };
    },
    async anim(mode) {
      document.documentElement.setAttribute("data-anim", mode);
      await frames(8);
      return { mode, animations: document.getAnimations().length };
    },
    async window(ms, opts = {}) {
      const drifted = opts.pan || opts.zoomCross ? false : guardCamera();
      if (drifted) await frames(2);
      const c0 = counters();
      raf.maxMs = 0;
      const world = ce().world;
      const start = { ...intended, gesturing: false };
      const band0 = bandOf();
      // The band crossing: leave the held band's [0.5×, 2×] window and come back —
      // the re-copy burst under `band` raster, Chromium's re-raster under live DOM.
      const zTo = Math.min(3, Math.max(0.25, band0 > 0 ? band0 * 2.25 : start.zoom * 2.25));
      const clipFieldsOf = (): Record<string, string> => {
        const out: Record<string, string> = {};
        const g = cards[0] === undefined ? undefined : (handle?.compose.geometryOf(cards[0]) as Record<string, unknown> | undefined);
        if (g === undefined) return out;
        for (const k of ["ih", "nw", "nh", "rho", "rfH", "rfV", "baseR", "scale", "radius", "half", "centre", "frameAlpha"]) if (k in g) out[k] = JSON.stringify(g[k]);
        return out;
      };
      const clips0 = handle?.compose.domWrites().clips ?? 0;
      let clipFirst: Record<string, string> | null = null;
      // the first frames of a pan, sampled one by one: the transient that recomputes every clip
      const early: { frame: number; changed: string[]; from: Record<string, string>; to: Record<string, string> }[] = [];
      let prevFields: Record<string, string> | null = opts.pan ? clipFieldsOf() : null;
      const t0 = performance.now();
      let last = t0;
      const intervals: number[] = [];
      let i = 0;
      let bandTo = band0;
      while (performance.now() - t0 < ms) {
        if (opts.pan) setCamera(Math.sin(i / 19) * 260, Math.cos(i / 23) * 150, start.zoom, true);
        if (opts.zoomCross) {
          const u = Math.min(1, (performance.now() - t0) / ms);
          const k = u < 0.5 ? u * 2 : (1 - u) * 2;
          setCamera(start.x, start.y, start.zoom + (zTo - start.zoom) * k, true);
          if (u >= 0.45 && u <= 0.55) { const b = world.get(must(cards[0], "card 0"), SurfaceBand)?.band ?? band0; if (b !== band0) bandTo = b; }
        }
        await frame();
        if (opts.pan && i === 1) clipFirst = clipFieldsOf();
        if (opts.pan && i < 8 && prevFields !== null) {
          const now = clipFieldsOf();
          const changed = Object.keys(now).filter((k) => now[k] !== prevFields?.[k]);
          if (changed.length > 0) early.push({ frame: i, changed, from: Object.fromEntries(changed.map((k) => [k, prevFields?.[k] ?? ""])), to: Object.fromEntries(changed.map((k) => [k, now[k] ?? ""])) });
          prevFields = now;
        }
        const now = performance.now();
        intervals.push(now - last);
        last = now;
        i++;
      }
      let clipFields: WindowResult["clipFields"];
      if (opts.pan) {
        const first = clipFirst ?? clipFieldsOf();
        const lastF = clipFieldsOf();
        clipFields = { first, last: lastF, changed: Object.keys(first).filter((k) => first[k] !== lastF[k]), clips: (handle?.compose.domWrites().clips ?? 0) - clips0, early };
      }
      if (opts.pan || opts.zoomCross) { setCamera(intended.x, intended.y, intended.zoom, false); await frames(4); }
      const wall = last - t0;
      const c1 = counters();
      const delta = diff(c0, c1);
      const out: WindowResult = {
        frames: intervals.length,
        wallMs: wall,
        fps: intervals.length / (wall / 1000),
        interval: {
          p50: quantile(intervals, 0.5),
          p95: quantile(intervals, 0.95),
          max: intervals.length ? Math.max(...intervals) : 0,
          over12: intervals.filter((x) => x > 12.5).length,
          over25: intervals.filter((x) => x > 25).length,
          over50: intervals.filter((x) => x > 50).length,
        },
        delta,
        gauges: gauges(),
        rafMsPerFrame: intervals.length ? delta.rafMs / intervals.length : 0,
        rafMaxMs: raf.maxMs,
        cameraDrifts,
        foreignCameraWrites: foreignWrites,
        ...(clipFields !== undefined ? { clipFields } : {}),
        ...(opts.zoomCross ? { zoomRange: { from: start.zoom, to: zTo, bandFrom: band0, bandTo } } : {}),
      };
      return out;
    },
    async bucket(fps) {
      const world = ce().world;
      for (const c of cards) world.edit(c).set(RequestedDemand, { mode: "live", fpsBucket: fps, interactive: false });
      await until(() => cards.every((c) => (world.get(c, SurfaceDemand)?.fpsBucket ?? -1) === fps), 120);
      await frames(2);
      const d = cards[0] === undefined ? undefined : world.get(cards[0], SurfaceDemand);
      return { requested: fps, granted: `${d?.mode ?? "?"}@${d?.fpsBucket ?? -1}`, cards: cards.length };
    },
    async drag(ms) {
      guardCamera();
      const world = ce().world;
      const card = must(cards[0], "card 0");
      const r0 = cardWorld(0);
      const r1 = cardWorld(1);
      const c0 = counters();
      const s0 = handle?.compose.domRender?.stats().stills ?? 0;
      raf.maxMs = 0;
      const count = () => {
        const targets = { dom: 0, gpu: 0 };
        const demand = { live: 0, paused: 0 };
        for (const c of cards) {
          if (world.get(c, SurfaceTarget)?.target === "gpu") targets.gpu += 1; else targets.dom += 1;
          if (world.get(c, RequestedDemand)?.mode === "paused") demand.paused += 1; else demand.live += 1;
        }
        return { targets, demand };
      };
      // THE GRAB — a rig setup write of the gesture's rider, exactly what the render rig does.
      world.addComponent(card, Grab, { x: r0.x, y: r0.y, w: r0.w, h: r0.h, parent: NO_ENTITY, prev: NO_ENTITY, ord: 0 });
      const plateFrames: DragResult["plateFrames"] = [];
      const intervals: number[] = [];
      const t0 = performance.now();
      let last = t0;
      let i = 0;
      while (performance.now() - t0 < ms) {
        const u = Math.min(1, (performance.now() - t0) / (ms * 0.6));
        // the carry: card 0 walks onto card 1's rect and stays there
        world.edit(card).set(Position, { x: r0.x + (r1.x - r0.x) * u, y: r0.y + (r1.y - r0.y) * u });
        await frame();
        const now = performance.now();
        intervals.push(now - last);
        last = now;
        if (i < 12) { const g = handle?.compose.stats(); plateFrames.push({ frame: i, textured: g?.textured ?? 0, cards: g?.cards ?? 0 }); }
        i++;
      }
      const wall = last - t0;
      const c1 = counters();
      const z = cam().zoom;
      const o = toScreen(r1.x, r1.y);
      const idx0 = 0 % PALETTE.length;
      const idx1 = 1 % PALETTE.length;
      const hex = (h: string): [number, number, number] => [Number.parseInt(h.slice(1, 3), 16), Number.parseInt(h.slice(3, 5), 16), Number.parseInt(h.slice(5, 7), 16)];
      return {
        ...count(),
        plateFrames,
        pickupMaxMs: intervals.slice(0, 12).reduce((m, x) => Math.max(m, x), 0),
        frames: intervals.length,
        fps: intervals.length / (wall / 1000),
        interval: { p50: quantile(intervals, 0.5), p95: quantile(intervals, 0.95), max: intervals.length ? Math.max(...intervals) : 0 },
        delta: diff(c0, c1),
        stills: (handle?.compose.domRender?.stats().stills ?? 0) - s0,
        rafMsPerFrame: intervals.length ? diff(c0, c1).rafMs / intervals.length : 0,
        // a plain-background point of the carried card: right of the title, above the bar (card px 135, 18)
        over: { card: { x: o.x, y: o.y, w: r1.w * z, h: r1.h * z }, sample: { x: o.x + 135 * z, y: o.y + 18 * z }, expectRgb: hex(PALETTE[idx0] as string), underRgb: hex(PALETTE[idx1] as string) },
      };
    },
    async release(settleMs) {
      const world = ce().world;
      const card = must(cards[0], "card 0");
      const c0 = counters();
      world.removeComponent(card, Grab);
      const t0 = performance.now();
      let n = 0;
      while (performance.now() - t0 < settleMs) { await frame(); n++; }
      const targets = { dom: 0, gpu: 0 };
      const demand = { live: 0, paused: 0 };
      for (const c of cards) {
        if (world.get(c, SurfaceTarget)?.target === "gpu") targets.gpu += 1; else targets.dom += 1;
        if (world.get(c, RequestedDemand)?.mode === "paused") demand.paused += 1; else demand.live += 1;
      }
      // put card 0 back where it was, for the phases that follow
      const r0 = cardWorld(0);
      world.edit(card).set(Position, { x: r0.x, y: r0.y });
      await frames(4);
      return { targets, demand, delta: diff(c0, counters()), frames: n };
    },
    rects(i) {
      guardCamera();
      const r = cardWorld(i);
      const o = toScreen(r.x, r.y);
      const z = cam().zoom;
      return {
        card: { x: o.x, y: o.y, w: r.w * z, h: r.h * z },
        spin: { x: o.x + 12 * z, y: o.y + 30 * z, w: 28 * z, h: 28 * z },
        bar: { x: o.x + 76 * z, y: o.y + 34 * z, w: 60 * z, h: 8 * z },
      };
    },
    counters,
    async texels(i) {
      const world = ce().world;
      const device = must(gpu, "gpu").device;
      const card = cards[i];
      if (card === undefined) return null;
      const ref = world.get(card, TextureRef);
      if (ref === undefined || ref.texture === 0) return null;
      const pages = handle?.compose.residency.textureOf(ref.texture);
      if (pages === undefined) return null;
      const side = pages.width;
      const x0 = Math.round(ref.u0 * side);
      const y0 = Math.round(ref.v0 * side);
      const w = Math.max(1, Math.round((ref.u1 - ref.u0) * side));
      const h = Math.max(1, Math.round((ref.v1 - ref.v0) * side));
      const bytesPerRow = Math.ceil((w * 4) / 256) * 256;
      const buffer = device.createBuffer({ size: bytesPerRow * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = device.createCommandEncoder({ label: "stress texel witness" });
      enc.copyTextureToBuffer({ texture: pages, origin: { x: x0, y: y0, z: ref.layer } }, { buffer, bytesPerRow, rowsPerImage: h }, { width: w, height: h, depthOrArrayLayers: 1 });
      device.queue.submit([enc.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      const px = new Uint8Array(buffer.getMappedRange().slice(0));
      buffer.unmap();
      buffer.destroy();
      let hash = 2166136261;
      let ink = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const o = y * bytesPerRow + x * 4;
          const r = px[o] as number; const g = px[o + 1] as number; const b = px[o + 2] as number; const a = px[o + 3] as number;
          if (a !== 0) ink++;
          hash = Math.imul(hash ^ r, 16777619) ^ g;
          hash = Math.imul(hash ^ b, 16777619) ^ a;
        }
      }
      return { hash: (hash >>> 0).toString(16), ink, w, h, layer: ref.layer };
    },
  };
}

declare global {
  interface Window { __stressRig?: StressRig }
}
window.__stressRig = mountStressRig();
