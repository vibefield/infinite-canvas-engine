/**
 * The B6 exit witness (design-013 §8, §9 Q5): a LIVE SURFACE on the new composited profile.
 *
 * The video kind's contract is now a registered stable-texture handle. A producer states its
 * size once (`compose.video.register`), hands each frame over as it arrives
 * (`compose.video.arrive`), and VideoIngest copies it ONCE into that texture inside §6's
 * reflector 7 — before GpuCompose's submit — and closes it. This page is the producer: the
 * retain-and-import fixture that used to live beside the old compositor
 * (`composited-app.tsx`'s `createFixtureSurface`) moves in here, minus the retention, because
 * holding the frame is exactly what the ruling ends.
 *
 * Measured, in order:
 *  1. boot — the profile mounts, one canvas, a video card registered, the ground draws it in
 *     `own` mode (`stats().textured`), no GPU errors;
 *  2. coverage (S8's numbers, re-witnessed) — at 24 fps over ~181 frames every production is
 *     ONE copy and ONE compose frame: `produced === arrivals === copies === submits`, and
 *     nothing is dropped;
 *  3. liveness + orientation — the card's centre cycles through the fixture's colour band over
 *     the run, and the fixture's TOP-LEFT marker lands top-left on the ground's own pixels
 *     (both axes, against the bright-top / dark-bottom contrast the island leg's inherited
 *     answer got backwards);
 *  4. paused — a card whose kind asks for `paused` (the old `picture`) drops every arrival:
 *     0 copies, 0 submits, while the producer keeps producing;
 *  5. idle — the producer stops and the board submits nothing at all;
 *  6. the null control — a card registered but never fed draws the PLATE, and no copy exists
 *     for it; without it "the surface is showing" cannot be told from "a quad drew".
 *
 * Mounted from `composited-video.html`, driven by `scripts/composited-video.mjs`.
 */
import {
  acquireCompositorDevice,
  alwaysGpu,
  Camera,
  createCanvasEngine,
  defineCanvasType,
  defineWidget,
  type EngineGpu,
  type Entity,
  tools,
} from "@ice/core";
import { instrumentSubmits, type SubmitInstrument } from "@ice/ground";
import { groundCompose, type GroundComposeContext, type GroundComposeHandle } from "@ice/ground/compose";
import { THEMES } from "@ice/ground/oracle/fixtures/vf-theme";
import { compositedProfile, InfiniteCanvas } from "@ice/react";
import { createRoot } from "react-dom/client";

type RGB = readonly [number, number, number];

/** The card in world units, and the board the three of them sit on. */
const CARD = { w: 320, h: 180 } as const;
const SLOTS = [
  { x: 40, y: 40 },     // 0 — the live surface
  { x: 400, y: 40 },    // 1 — the paused one (the old `picture`)
  { x: 760, y: 40 },    // 2 — the null control: registered, never fed
] as const;
const BOARD = { w: 1120, h: 260 } as const;
/** The producer's rate. `toFpsBucket(60)` is the card's ceiling, so 24 fps is never throttled. */
const FPS = 24;

/**
 * THE FIXTURE, ported from `composited-app.tsx`'s `createFixtureSurface` (plan §5 S7.1) with its
 * RETENTION REMOVED — that half was the old contract. What is kept is what made it a witness:
 *
 *  - ASYMMETRIC top to bottom (bright band above, dark below), so orientation has an answer a
 *    symmetric pattern would hide — the trap the island leg walked into;
 *  - a TOP-LEFT MARKER inside the bright band, so the horizontal axis has one too (a
 *    top-to-bottom witness alone cannot see a mirrored copy);
 *  - a full-width LIVENESS BAND that changes colour every production, so "a frame is showing"
 *    and "the FIRST frame is showing forever" read differently. Full width, because the 24 px
 *    sliding marker it replaced graded a working build broken: it never entered the coordinate
 *    its own check sampled.
 */
const LIVENESS_COLOURS = ["#e8c547", "#47e88a", "#c547e8", "#e85447", "#47a8e8", "#a8e847"];
const MARKER = "#0033ff";
const TOP_BAND = "#ffffff";
const BOTTOM_BAND = "#1b3a5c";

function createProducer(width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
  let produced = 0;
  let tick = 0;

  const draw = (): void => {
    ctx.fillStyle = "#101010";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = TOP_BAND;
    ctx.fillRect(0, 0, width, Math.floor(height * 0.4));
    ctx.fillStyle = BOTTOM_BAND;
    ctx.fillRect(0, Math.floor(height * 0.6), width, height - Math.floor(height * 0.6));
    // the orientation marker: the TOP-LEFT quarter of the bright band
    ctx.fillStyle = MARKER;
    ctx.fillRect(0, 0, Math.floor(width * 0.25), Math.floor(height * 0.25));
    ctx.fillStyle = LIVENESS_COLOURS[tick % LIVENESS_COLOURS.length] as string;
    ctx.fillRect(0, Math.floor(height * 0.45), width, Math.floor(height * 0.1));
    tick++;
  };

  return {
    /** One production: a frame, handed straight over. Nothing here retains it — `arrive` owns it now. */
    produce(sink: (frame: VideoFrame) => void): void {
      draw();
      const frame = new VideoFrame(canvas, { timestamp: produced * 1000 });
      produced++;
      sink(frame);
    },
    produced: () => produced,
    colours: LIVENESS_COLOURS.length,
  };
}

interface Mounted {
  readonly profile: string;
  readonly canvases: number;
  readonly available: boolean;
  readonly redraws: number;
  readonly submits: number;
  readonly gpuErrors: number;
  readonly viewport: string;
}
interface Booted {
  readonly zoom: number;
  readonly cards: number;
  readonly registered: number;
  readonly handles: readonly number[];
  readonly textured: number;
  readonly copies: number;
  readonly submits: number;
  readonly gpuErrors: number;
  readonly note?: string;
}
interface Coverage {
  readonly frames: number;
  readonly ms: number;
  readonly produced: number;
  readonly arrivals: number;
  readonly copies: number;
  readonly dropped: number;
  readonly paused: number;
  readonly submits: number;
  readonly redraws: number;
  readonly textured: number;
  readonly gpuErrors: number;
}
interface Look {
  /** Modal 9×9 patches off the ground canvas at fractions of the card's rect. */
  readonly centre: RGB;
  readonly top: RGB;
  readonly bottom: RGB;
  readonly markerTL: RGB;
  readonly markerTR: RGB;
  readonly markerBL: RGB;
  readonly expect: { readonly marker: RGB; readonly top: RGB; readonly bottom: RGB; readonly plate: RGB };
  readonly distinctCentreColours: number;
  readonly samples: number;
}
interface NullControl { readonly centre: RGB; readonly plate: RGB; readonly totalCopies: number; readonly textured: number }
interface VideoRig {
  readonly ready: Promise<void>;
  mount(): Promise<Mounted>;
  boot(): Promise<Booted>;
  coverage(frames: number): Promise<Coverage>;
  look(productions: number): Promise<Look>;
  paused(frames: number): Promise<Coverage>;
  idle(ms: number): Promise<{ frames: number; submits: number; redraws: number; copies: number }>;
  nullControl(): Promise<NullControl>;
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const frames = async (n: number) => { for (let i = 0; i < n; i++) await frame(); };
const bytes = (c: readonly [number, number, number]): RGB => [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255)];
const hexRgb = (hex: string): RGB => [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)];

/** Pixels off a LIVE WebGPU canvas: `drawImage` from it is silently blank; `toDataURL` → decode → draw works. */
async function readback(canvas: HTMLCanvasElement): Promise<ImageData> {
  const url = canvas.toDataURL("image/png");
  const img = new Image();
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("readback decode")); img.src = url; });
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext("2d");
  if (g === null) throw new Error("readback 2d");
  g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, c.width, c.height);
}
/** The modal colour of a 9×9 patch centred at device px (x, y). */
function modal(img: ImageData, x: number, y: number): RGB {
  const counts = new Map<number, number>();
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const px = Math.min(Math.max(Math.round(x + dx), 0), img.width - 1);
      const py = Math.min(Math.max(Math.round(y + dy), 0), img.height - 1);
      const i = (py * img.width + px) * 4;
      const key = ((img.data[i] as number) << 16) | ((img.data[i + 1] as number) << 8) | (img.data[i + 2] as number);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let best = 0;
  let bestN = -1;
  for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
  return [(best >> 16) & 255, (best >> 8) & 255, best & 255];
}

// The three widget types. `surface: "video"` is the door design-013 B6 opened: the PIXELS come
// from a producer, but the CARD is declared like any other — Band, Demand and Residency all key
// off `SurfaceKind = video`, and only equip stamps that, from the type's static recipe.
const LIVE = defineWidget({ type: "nv:video", surface: "video", component: null, defaultSize: { w: CARD.w, h: CARD.h } });
const PICTURE = defineWidget({ type: "nv:picture", surface: "video", component: null, defaultSize: { w: CARD.w, h: CARD.h }, behaviors: [alwaysGpu.with({ paused: true })] });
const SILENT = defineWidget({ type: "nv:silent", surface: "video", component: null, defaultSize: { w: CARD.w, h: CARD.h } });
const ROOT = defineCanvasType({
  id: "nv:root",
  semanticVersion: 1,
  semantic: { placement: { widgets: [LIVE, PICTURE, SILENT] } },
  presentation: { camera: { arrival: "identity" } },
});

function mountVideoRig(): VideoRig {
  let gpu: EngineGpu | undefined;
  let instrument: SubmitInstrument | undefined;
  let handle: GroundComposeHandle | null = null;
  let engine: ReturnType<typeof createCanvasEngine> | undefined;
  const rootEl = document.getElementById("root") as HTMLElement;
  const theme = THEMES.dark;
  const cards: Entity[] = [];
  const handles: number[] = [];
  let zoom = 1;
  const producer = createProducer(CARD.w, CARD.h);

  const ready = (async () => {
    gpu = await acquireCompositorDevice();
    instrument = instrumentSubmits(gpu.device);
    engine = createCanvasEngine({
      widgets: [LIVE, PICTURE, SILENT],
      canvasTypes: [ROOT],
      rootCanvas: ROOT,
      presentationFallback: ROOT,
      tools: [tools.get("select"), tools.get("pan")].filter((t): t is NonNullable<typeof t> => t !== undefined),
      compositorDevice: gpu,
    });
    engine.docs.create();
    const factory = groundCompose({ device: gpu.device, theme });
    const ground = (ctx: GroundComposeContext) => { handle = factory(ctx); return handle; };
    createRoot(rootEl).render(
      <InfiniteCanvas engine={engine} ground={ground} profile={compositedProfile} className="h-full w-full" />,
    );
    await frames(2);
  })();

  const must = <T,>(v: T | null | undefined, what: string): T => { if (v === null || v === undefined) throw new Error(`rig: no ${what}`); return v; };
  const ce = () => must(engine, "engine");
  const compose = () => must(handle, "ground handle").compose;
  const submits = () => instrument?.total() ?? 0;
  const redraws = () => handle?.compose.redraws() ?? 0;
  const copies = () => compose().video.stats().copies;
  const until = async (p: () => boolean, max = 300) => { for (let i = 0; i < max && !p(); i++) await frame(); return p(); };
  /** World → device px under the rig's camera (at the origin, `zoom`). */
  const dpx = (wx: number, wy: number): [number, number] => { const dpr = Math.min(window.devicePixelRatio || 1, 2); return [wx * zoom * dpr, wy * zoom * dpr]; };
  /** A tap at a FRACTION of card `i`'s rect — the content term maps the texture onto that rect (`chalf = ih`). */
  const tapOf = (i: number, fx: number, fy: number): [number, number] => {
    const s = must(SLOTS[i], `slot ${i}`);
    return dpx(s.x + fx * CARD.w, s.y + fy * CARD.h);
  };
  const sample = async (i: number, taps: Record<string, [number, number]>): Promise<Record<string, RGB>> => {
    const img = await readback(compose().canvas);
    const out: Record<string, RGB> = {};
    for (const [k, [fx, fy]] of Object.entries(taps)) { const [x, y] = tapOf(i, fx, fy); out[k] = modal(img, x, y); }
    return out;
  };
  /** One production, handed to the ingest for card `i`. */
  const produceInto = (i: number): void => { producer.produce((f) => { compose().video.arrive(must(cards[i], `card ${i}`), f); }); };

  /**
   * A counting window: N animation frames with the producer running at `FPS`, gated on the
   * rig's own rAF so at most ONE frame is produced between two engine ticks — a supersede
   * would make `produced === copies` false for a reason that is the harness's, not the
   * engine's, and the point of this arm is the engine's.
   */
  const window_ = async (n: number, into: number | null): Promise<Coverage> => {
    const v0 = compose().video.stats();
    const s0 = submits();
    const r0 = redraws();
    const p0 = producer.produced();
    const t0 = performance.now();
    let last = -Number.POSITIVE_INFINITY;
    let seen = 0;
    while (seen < n) {
      await frame();
      seen++;
      const now = performance.now();
      if (into !== null && now - last >= 1000 / FPS) { last = now; produceInto(into); }
    }
    const ms = performance.now() - t0;
    // The window's LAST production may land on its last frame, with the tick that copies it
    // still owed: the queue is drained by three quiet frames before the counters are read, so
    // the boundary is not scored as a lost frame (`dropped` stays the witness that none was).
    await frames(3);
    const v = compose().video.stats();
    return {
      frames: seen,
      ms: Math.round(ms),
      produced: producer.produced() - p0,
      arrivals: v.arrivals - v0.arrivals,
      copies: v.copies - v0.copies,
      dropped: v.dropped - v0.dropped,
      paused: v.paused - v0.paused,
      submits: submits() - s0,
      redraws: redraws() - r0,
      textured: compose().stats().textured,
      gpuErrors: gpu?.errors().length ?? 0,
    };
  };

  return {
    ready,
    async mount() {
      await ready;
      await until(() => (handle?.compose.available() ?? false) && redraws() > 0);
      return {
        profile: compositedProfile.name,
        // the ground's own and (islands) the never-presenting island Canvas — never the L1 source canvas B4 mounts for the copies
        canvases: rootEl.querySelectorAll("canvas:not([data-ice-source-canvas])").length,
        available: handle?.compose.available() ?? false,
        redraws: redraws(),
        submits: submits(),
        gpuErrors: gpu?.errors().length ?? 0,
        viewport: `${rootEl.clientWidth}x${rootEl.clientHeight}`,
      };
    },

    async boot() {
      const e = ce();
      const world = e.world;
      zoom = Math.min(1, (rootEl.clientWidth - 20) / BOARD.w, (rootEl.clientHeight - 20) / BOARD.h);
      world.setResource(Camera, { x: 0, y: 0, zoom, gesturing: false });
      cards.length = 0;
      for (const [i, slot] of SLOTS.entries()) {
        const type = i === 0 ? "nv:video" : i === 1 ? "nv:picture" : "nv:silent";
        cards.push(e.ops.spawnWidget(type, { ...slot, w: CARD.w, h: CARD.h, undoable: false }));
      }
      world.sync();
      const ok = await until(() => compose().stats().cards >= 3);
      // the producer's registration: a size stated once, and the handle Residency will name
      handles.length = 0;
      for (const card of cards) handles.push(compose().video.register(card, { width: CARD.w, height: CARD.h }));
      await frames(3);
      // one frame each into the live and paused cards, so `own` has something to show
      produceInto(0);
      await until(() => compose().stats().textured >= 1);
      await frames(2);
      return {
        zoom,
        cards: compose().stats().cards,
        registered: compose().video.stats().registered,
        handles: [...handles],
        textured: compose().stats().textured,
        copies: copies(),
        submits: submits(),
        gpuErrors: gpu?.errors().length ?? 0,
        ...(ok ? {} : { note: "the board never reached 3 cards" }),
      };
    },

    coverage: (n) => window_(n, 0),
    paused: (n) => window_(n, 1),

    async look(productions) {
      const seen = new Set<string>();
      let last: Record<string, RGB> = {};
      const taps: Record<string, [number, number]> = {
        centre: [0.5, 0.5], top: [0.5, 0.15], bottom: [0.5, 0.85],
        markerTL: [0.18, 0.18], markerTR: [0.82, 0.18], markerBL: [0.18, 0.82],
      };
      for (let i = 0; i < productions; i++) {
        produceInto(0);
        await frames(3);             // the copy lands in reflector 7, the compose frame right after
        last = await sample(0, taps);
        seen.add(must(last.centre, "centre").join(","));
      }
      return {
        centre: must(last.centre, "centre"),
        top: must(last.top, "top"),
        bottom: must(last.bottom, "bottom"),
        markerTL: must(last.markerTL, "markerTL"),
        markerTR: must(last.markerTR, "markerTR"),
        markerBL: must(last.markerBL, "markerBL"),
        expect: { marker: hexRgb(MARKER), top: hexRgb(TOP_BAND), bottom: hexRgb(BOTTOM_BAND), plate: bytes(theme.card) },
        distinctCentreColours: seen.size,
        samples: productions,
      };
    },

    async idle(ms) {
      const s0 = submits();
      const r0 = redraws();
      const c0 = copies();
      const t0 = performance.now();
      let n = 0;
      while (performance.now() - t0 < ms) { await frame(); n++; }
      return { frames: n, submits: submits() - s0, redraws: redraws() - r0, copies: copies() - c0 };
    },

    async nullControl() {
      const px = await sample(2, { centre: [0.5, 0.5] });
      return {
        centre: must(px.centre, "centre"),
        plate: bytes(theme.card),
        totalCopies: copies(),   // the ingest's counter is per-BOARD; this card's own witness is its plate
        textured: compose().stats().textured,
      };
    },
  };
}

declare global {
  interface Window { __videoRig?: VideoRig }
}
window.__videoRig = mountVideoRig();
