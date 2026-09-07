/**
 * The B2 + B3a exit witness (design-013 §8): the NEW composited profile boots through the
 * REAL React path — `<InfiniteCanvas profile={compositedNextProfile} ground={groundCompose(…)}>`
 * — on the app-owned device, and the ground draws the WORLD's cards. Measured, in order:
 *
 *  B2 (kept):
 *  1. it mounts: one canvas in the L0 slot, the ground available, at least one redraw and
 *     one real submit, zero uncaptured GPU errors;
 *  2. idle-zero: over a quiet window it submits nothing (the instrument counts at
 *     `queue.submit`, so nothing can hide work);
 *  3. it is alive: a camera write is one more redraw and one more submit.
 *
 *  B3a:
 *  4. a board of real widgets (`spawnWidget` through a fresh document) is drawn: the
 *     builder's counts, and PIXELS read back off the ground canvas — a card's centre is the
 *     plate, a gap is the ground, a folder's face shows its inside's ground (a hole, not a
 *     plate) while its bar is the plate; idle-zero holds with cards on the board;
 *  5. selection is a spring: the reveal reaches 1, the ring arrives, and once settled the
 *     board is idle-zero again;
 *  6. Grab IS the lift: the card scales by ChromeSettings.liftScale and sets down when it goes;
 *  7. the heat: the drop pair on a target with a recognizer's DragBounds lights the target
 *     (the plate under the light reads brighter), and clearing it fades out.
 *
 *  B3b — the DOM boundary (design-014):
 *  8. chrome exists ONCE: at a selected card's ring band and in its shadow skirt the page's
 *     screenshot equals the ground canvas's own pixel (the DOM shell paints nothing there),
 *     while over the card's title the screenshot differs (the DOM content IS above the plate);
 *  9. a click on the ground-drawn close button reaches the app as `onPart("close")` and
 *     neither grabs nor deselects the card; a drag begun on the frame band moves the card.
 *
 * Mounted from `composited-next.html`, driven by `scripts/composited-next.mjs`.
 */
import {
  acquireCompositorDevice,
  Camera,
  DragBounds,
  DropTarget,
  type EngineGpu,
  type Entity,
  Grab,
  NO_ENTITY,
  OverlapCandidate,
  Position,
  Selected,
  spawnWidget,
  TransformTween,
  NavTransition,
} from "@ice/core";
import { instrumentSubmits, type SubmitInstrument } from "@ice/ground";
import { groundCompose, type GroundComposeContext, type GroundComposeHandle, type ShellGeometry } from "@ice/ground/compose";
import { THEMES } from "@ice/ground/oracle/fixtures/vf-theme";
import { cuttingMat, needleGlyph, vfFrame } from "@ice/ground/packs";
import { compositedNextProfile, InfiniteCanvas } from "@ice/react";
import { createRoot } from "react-dom/client";
import { createDemoEngine } from "../App";

type RGB = readonly [number, number, number];

interface Mounted {
  readonly profile: string;
  readonly canvases: number;
  /** The L1 source canvas (B4) — 1 wherever HTML-in-Canvas is present. */
  readonly sourceCanvases: number;
  readonly available: boolean;
  readonly redraws: number;
  readonly submits: number;
  readonly gpuErrors: number;
  readonly viewport: string;
}
interface Board {
  readonly zoom: number;
  readonly active: number;
  readonly cards: number;
  readonly containers: number;
  readonly portals: number;
  readonly inside: number;
  readonly capped: number;
  readonly redraws: number;
  readonly submits: number;
  readonly gpuErrors: number;
  /** Modal colours of 9×9 device-px patches off the ground canvas. */
  readonly pixels: { readonly card: RGB; readonly gap: RGB; readonly face: RGB; readonly bar: RGB };
  readonly expect: { readonly card: RGB; readonly bg: RGB };
  readonly note?: string;
}
interface SelectResult { readonly reveal: number; readonly ring: number; readonly live: boolean; readonly redraws: number }
interface Grabbed { readonly lift: number; readonly scale: number; readonly shadowSigma: number; readonly liftAfter: number; readonly scaleAfter: number }
interface Heated {
  readonly hot: number; readonly tier: number; readonly at: readonly [number, number]; readonly half: readonly [number, number]; readonly r: number;
  /** The target's plate under the light vs the same plate cold (modal 9×9 patches). */
  readonly lit: RGB; readonly cold: RGB;
  readonly hotAfter: number;
}
interface Boundary {
  /** CSS px on the page for: the ring band just inside the top edge, the shadow skirt below the card, the close control, the title's area. */
  readonly band: { sx: number; sy: number };
  readonly shadow: { sx: number; sy: number };
  readonly close: { sx: number; sy: number };
  /** The folder's face centre — the ground's live portal, which the DOM must not cover. */
  readonly face: { sx: number; sy: number };
  readonly title: { sx: number; sy: number; w: number; h: number };
  /** The ground canvas's own pixels at the band and shadow points (exact device px), and the plate. */
  readonly canvas: { band: RGB; shadow: RGB; plate: RGB };
  readonly domWrites: { writes: number; clips: number };
  readonly clip: string;
}
interface CardState { readonly selected: boolean; readonly grabbed: boolean; readonly x: number; readonly y: number; readonly taps: { entity: number; part: string }[] }
/** The flight (B7): the enter cut, the flight, the landing, the exit cut, the round trip — pixels off the ground canvas at each. */
interface NavFlight {
  readonly size: { w: number; h: number };
  /** The cut frame: held at p = 0, the camera at c0 — and its pixels vs the rest frame before the call. */
  readonly cut: { p: number; ticks: number; active: boolean; maxDelta: number; outgoing: { kind: string; frames: number; at: number | null } | null };
  readonly mid: { p: number; outgoing: boolean };
  readonly landed: number;
  readonly afterLanding: { outgoing: boolean; submits: number; frames: number };
  /** The exit's cut frame vs the inside at rest: whole frame, and inset by a band (the rim). */
  readonly exit: { p: number; kind: string; order: string; maxDelta: number; maxDeltaInset: number; outgoing: boolean };
  readonly landed2: number;
  /** The round trip vs the rest frame before it: whole frame, and outside the folder (whose inside is MEASURED for the first time on entry, so its portal may legitimately change). */
  readonly roundTrip: number;
  readonly roundTripOutsideFolder: number;
  /** Where the enter cut and the round trip differ, in WORLD units (device px / zoom / dpr): the evidence. */
  readonly where: { cut: { box: number[] | null; count: number }; roundTrip: { box: number[] | null; count: number } };
  readonly gpuErrors: number;
}
interface NextRig {
  readonly ready: Promise<void>;
  mount(): Promise<Mounted>;
  idle(ms: number): Promise<{ frames: number; submits: number; redraws: number; wakes: Record<string, number> }>;
  nudge(): Promise<{ submits: number; redraws: number }>;
  board(): Promise<Board>;
  select(i: number): Promise<SelectResult>;
  grab(i: number): Promise<Grabbed>;
  heat(target: number, source: number): Promise<Heated>;
  boundary(i: number): Promise<Boundary>;
  cardState(i: number): Promise<CardState>;
  nav(): Promise<NavFlight>;
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const frames = async (n: number) => { for (let i = 0; i < n; i++) await frame(); };
const bytes = (c: RGB): RGB => [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255)];

/** The board in world units: six cards in a 3×2 grid and a folder with three cards inside. */
const CARD = { w: 220, h: 150 } as const;
const GRID = { x: 40, y: 40, dx: 250, dy: 180 } as const;
const FOLDER = { x: 800, y: 40, w: 329, h: 345, pad: 10, bar: 36 } as const;
const BOARD = { w: FOLDER.x + FOLDER.w + 40, h: FOLDER.y + FOLDER.h + 40 } as const;
const cardRect = (i: number) => ({ x: GRID.x + (i % 3) * GRID.dx, y: GRID.y + Math.floor(i / 3) * GRID.dy, w: CARD.w, h: CARD.h });

/**
 * Pixels off a LIVE WebGPU canvas: `drawImage` from it is silently blank, but
 * `toDataURL` → decode → draw → `getImageData` works (the 2026-09 finding).
 */
/** The largest per-channel difference between two readbacks of the same size, over the whole frame or inset by `inset` px on every side. */
function maxDelta(a: ImageData, b: ImageData, inset = 0, skip?: { x0: number; y0: number; x1: number; y1: number }): number {
  return diffOf(a, b, inset, skip).max;
}
/** The largest difference and the device-px bounding box of every differing pixel (the rig's evidence). */
function diffOf(a: ImageData, b: ImageData, inset = 0, skip?: { x0: number; y0: number; x1: number; y1: number }): { max: number; box: [number, number, number, number] | null; count: number } {
  if (a.width !== b.width || a.height !== b.height) return { max: 255, box: null, count: -1 };
  let max = 0;
  let count = 0;
  let x0 = Number.POSITIVE_INFINITY; let y0 = Number.POSITIVE_INFINITY; let x1 = -1; let y1 = -1;
  for (let y = inset; y < a.height - inset; y++) {
    for (let x = inset; x < a.width - inset; x++) {
      if (skip !== undefined && x >= skip.x0 && x < skip.x1 && y >= skip.y0 && y < skip.y1) continue;
      const i = (y * a.width + x) * 4;
      let d = 0;
      for (let k = 0; k < 3; k++) { const dk = Math.abs((a.data[i + k] as number) - (b.data[i + k] as number)); if (dk > d) d = dk; }
      if (d > 0) { count += 1; if (d > max) max = d; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    }
  }
  return { max, box: count > 0 ? [x0, y0, x1, y1] : null, count };
}
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
/** The modal colour of a 9×9 patch centred at device px (x, y) — a dot glyph cannot outvote the ground. */
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

function mountNextRig(): NextRig {
  let gpu: EngineGpu | undefined;
  let instrument: SubmitInstrument | undefined;
  let handle: GroundComposeHandle | null = null;
  let engine: ReturnType<typeof createDemoEngine> | undefined;
  const rootEl = document.getElementById("root") as HTMLElement;
  const theme = THEMES.dark;
  let cards: Entity[] = [];
  let folder: Entity | null = null;
  let zoom = 1;
  const taps: { entity: number; part: string }[] = [];

  const ready = (async () => {
    gpu = await acquireCompositorDevice();
    instrument = instrumentSubmits(gpu.device);
    engine = createDemoEngine(gpu);
    // the app's own choice (design-014): VibeField's frame as the card program, the needle and the mat as grids
    const factory = groundCompose({ device: gpu.device, theme, card: vfFrame(), grids: [needleGlyph, cuttingMat], onPart: (entity, part) => { taps.push({ entity: Number(entity), part }); } });
    const ground = (ctx: GroundComposeContext) => { handle = factory(ctx); return handle; };
    createRoot(rootEl).render(
      <InfiniteCanvas engine={engine} ground={ground} profile={compositedNextProfile} className="h-full w-full" />,
    );
    await frames(2);
  })();

  const must = <T,>(v: T | null | undefined, what: string): T => { if (v === null || v === undefined) throw new Error(`rig: no ${what}`); return v; };
  const ce = () => must(engine, "engine");
  const compose = () => must(handle, "ground handle").compose;
  const submits = () => instrument?.total() ?? 0;
  const redraws = () => handle?.compose.redraws() ?? 0;
  /** World → device px under the rig's camera (at the origin, `zoom`). */
  const dpx = (wx: number, wy: number): [number, number] => { const dpr = Math.min(window.devicePixelRatio || 1, 2); return [wx * zoom * dpr, wy * zoom * dpr]; };
  /** The exact device pixel at a world point (no patch): the ring band is 3 device px wide. */
  const pixelAt = (img: ImageData, wx: number, wy: number): RGB => {
    const [x, y] = dpx(wx, wy);
    const px = Math.min(Math.max(Math.round(x), 0), img.width - 1);
    const py = Math.min(Math.max(Math.round(y), 0), img.height - 1);
    const i = (py * img.width + px) * 4;
    return [img.data[i] as number, img.data[i + 1] as number, img.data[i + 2] as number];
  };
  const sampleAt = async (points: Record<string, [number, number]>) => {
    const img = await readback(compose().canvas);
    const out: Record<string, RGB> = {};
    for (const [k, [wx, wy]] of Object.entries(points)) { const [x, y] = dpx(wx, wy); out[k] = modal(img, x, y); }
    return out;
  };
  const snapshot = (): Mounted => ({
    profile: compositedNextProfile.name,
    // The GROUND's canvas, not every canvas: since B4 the composited-next mount
    // also carries the L1 `layoutsubtree` SOURCE canvas, which paints nothing
    // and is the hit/copy surface for promoted hosts. Counting both would make
    // this assertion fail for a reason that is the design working.
    canvases: rootEl.querySelectorAll("canvas:not([data-ice-source-canvas])").length,
    sourceCanvases: rootEl.querySelectorAll("canvas[data-ice-source-canvas]").length,
    available: handle?.compose.available() ?? false,
    redraws: redraws(),
    submits: submits(),
    gpuErrors: gpu?.errors().length ?? 0,
    viewport: `${rootEl.clientWidth}x${rootEl.clientHeight}`,
  });
  /** Wait (bounded) until a predicate holds, a frame at a time. */
  const until = async (p: () => boolean, max = 300) => { for (let i = 0; i < max && !p(); i++) await frame(); return p(); };

  return {
    ready,
    async mount() {
      await ready;
      // the pipelines compile asynchronously; wait for the first real paint (bounded)
      await until(() => (handle?.compose.available() ?? false) && redraws() > 0);
      return snapshot();
    },
    async idle(ms) {
      const submits0 = submits();
      const redraws0 = redraws();
      const wakes0: Record<string, number> = { ...(handle?.compose.wakes() ?? {}) };
      const t0 = performance.now();
      let n = 0;
      while (performance.now() - t0 < ms) { await frame(); n++; }
      // what woke the builder over the window, by fact — only the facts that did
      const wakes: Record<string, number> = {};
      for (const [k, v] of Object.entries(handle?.compose.wakes() ?? {})) { const d = v - (wakes0[k] ?? 0); if (d > 0) wakes[k] = d; }
      return { frames: n, submits: submits() - submits0, redraws: redraws() - redraws0, wakes };
    },
    async nudge() {
      const submits0 = submits();
      const redraws0 = redraws();
      const world = ce().world;
      const cam = world.getResource(Camera) ?? { x: 0, y: 0, zoom: 1, gesturing: false };
      // a rig SETUP write, outside the tick — the same debt the S6 rig carries
      world.setResource(Camera, { ...cam, x: cam.x + 40 });
      await frames(6);
      return { submits: submits() - submits0, redraws: redraws() - redraws0 };
    },
    async board() {
      const e = ce();
      const world = e.world;
      // a fresh document: whatever the boot seeded is closed; the board below is the whole world
      const session = e.docs.create();
      // the camera at the origin, zoomed so the whole board fits (the folder's face must clear the gate: 299 × zoom ≥ 120)
      zoom = Math.min(1, (rootEl.clientWidth - 20) / BOARD.w, (rootEl.clientHeight - 20) / BOARD.h);
      world.setResource(Camera, { x: 0, y: 0, zoom, gesturing: false });
      cards = [];
      for (let i = 0; i < 6; i++) { const r = cardRect(i); cards.push(spawnWidget(session.store, world, "clock-card", { ...r, undoable: false })); }
      const f = spawnWidget(session.store, world, "card-container", { x: FOLDER.x, y: FOLDER.y, w: FOLDER.w, h: FOLDER.h, undoable: false, props: { title: "Folder", accent: "#7B96FF" } });
      folder = f;
      world.sync();
      await frames(2);   // the container compiles on a tick before it takes children
      for (const [x, y] of [[0, 0], [260, 0], [0, 200]] as const) spawnWidget(session.store, world, "clock-card", { x, y, w: CARD.w, h: CARD.h, parent: f, undoable: false });
      world.sync();
      const ok = await until(() => { const s = compose().stats(); return s.cards >= 7 && s.portals >= 1; });
      await frames(3);
      const s = compose().stats();
      const r0 = cardRect(0);
      const r1 = cardRect(1);
      const face = { x: FOLDER.x + FOLDER.pad, y: FOLDER.y + FOLDER.pad, w: FOLDER.w - 2 * FOLDER.pad, h: FOLDER.h - FOLDER.pad - FOLDER.bar };
      const px = await sampleAt({
        card: [r0.x + r0.w / 2, r0.y + r0.h / 2],
        gap: [(r0.x + r0.w + r1.x) / 2, r0.y + r0.h / 2],
        face: [face.x + face.w / 2, face.y + face.h / 2],
        bar: [FOLDER.x + FOLDER.w / 2, FOLDER.y + FOLDER.h - FOLDER.bar / 2],
      });
      return {
        zoom, active: s.active, cards: s.cards, containers: s.containers, portals: s.portals, inside: s.inside, capped: s.capped,
        redraws: redraws(), submits: submits(), gpuErrors: gpu?.errors().length ?? 0,
        pixels: { card: must(px.card, "card px"), gap: must(px.gap, "gap px"), face: must(px.face, "face px"), bar: must(px.bar, "bar px") },
        expect: { card: bytes(theme.card), bg: bytes(theme.canvasBg) },
        ...(ok ? {} : { note: "board never reached 7 cards + 1 portal" }),
      };
    },
    async select(i) {
      const e = ce();
      const card = must(cards[i], `card ${i}`);
      e.ops.setSelection([card]);
      await until(() => (compose().motionOf(card)?.reveal ?? 0) >= 1 && !compose().stats().live, 240);
      const m = must(compose().motionOf(card), "motion");
      const G = must(compose().geometryOf(card), "geometry");
      return { reveal: m.reveal, ring: G.ring, live: compose().stats().live, redraws: redraws() };
    },
    async grab(i) {
      const world = ce().world;
      const card = must(cards[i], `card ${i}`);
      const r = cardRect(i);
      // a rig SETUP write: the claim system's own attach, done by hand (no pointer here)
      world.addComponent(card, Grab, { x: r.x, y: r.y, w: r.w, h: r.h, parent: NO_ENTITY, prev: NO_ENTITY, ord: 0 });
      await until(() => (compose().motionOf(card)?.lift ?? 0) >= 1 && !compose().stats().live, 240);
      const m = must(compose().motionOf(card), "motion");
      const G = must(compose().geometryOf(card), "geometry");
      const lifted = { lift: m.lift, scale: G.scale, shadowSigma: G.shadowSigma };
      world.removeComponent(card, Grab);
      await until(() => (compose().motionOf(card)?.lift ?? 1) <= 0 && !compose().stats().live, 240);
      const m2 = must(compose().motionOf(card), "motion");
      const G2 = must(compose().geometryOf(card), "geometry");
      return { ...lifted, liftAfter: m2.lift, scaleAfter: G2.scale };
    },
    async boundary(i) {
      const card = must(cards[i], `card ${i}`);
      const G = must(compose().geometryOf(card), "geometry") as ShellGeometry & { closeC?: readonly [number, number] };
      const r = cardRect(i);
      const [cx, cy] = G.centre;
      const [hx, hy] = G.half;
      // world points on WHOLE device pixels (the page's screenshot and the canvas readback must sample the same one):
      // the ring band 1 px inside the top edge; the shadow skirt 14 px under the bottom edge; the close control's centre
      // 40 px right of the top-centre: the engine's P4 resize grip sits at the centre of each edge
      const band: [number, number] = [Math.round(cx) + 40, Math.round(cy - hy) + 1];
      const shadow: [number, number] = [Math.round(cx), Math.round(cy + hy) + 14];
      const close = G.closeC ?? [cx + hx - 21, cy - hy + 21];
      const img = await readback(compose().canvas);
      const content = document.querySelector(`[data-ice-entity="${String(card)}"] [data-ice-content]`) as HTMLElement | null;
      const toScreen = (wx: number, wy: number) => ({ sx: wx * zoom, sy: wy * zoom });
      return {
        band: toScreen(band[0], band[1]),
        shadow: toScreen(shadow[0], shadow[1]),
        close: toScreen(close[0], close[1]),
        face: toScreen(Math.round(FOLDER.x + FOLDER.pad + (FOLDER.w - 2 * FOLDER.pad) / 2), Math.round(FOLDER.y + FOLDER.pad + (FOLDER.h - FOLDER.pad - FOLDER.bar) / 2)),
        title: { ...toScreen(r.x + 16, r.y + 14), w: 60 * zoom, h: 12 * zoom },
        canvas: { band: pixelAt(img, band[0], band[1]), shadow: pixelAt(img, shadow[0], shadow[1]), plate: bytes(theme.card) },
        domWrites: compose().domWrites(),
        clip: content?.style.clipPath ?? "",
      };
    },
    async cardState(i) {
      const world = ce().world;
      const card = must(cards[i], `card ${i}`);
      // let a drop's glide or fly-back land before reading (bounded)
      await until(() => !world.has(card, TransformTween) && !world.has(card, Grab), 120);
      await frames(3);
      const p = world.get(card, Position) ?? { x: Number.NaN, y: Number.NaN };
      return { selected: world.hasTag(card, Selected), grabbed: world.has(card, Grab), x: p.x, y: p.y, taps: [...taps] };
    },
    async nav() {
      const e = ce();
      const world = e.world;
      const f = must(folder, "the folder");
      const canvas = compose().canvas;
      const t = () => must(world.getResource(NavTransition), "NavTransition");
      const camOf = () => { const c = must(world.getResource(Camera), "camera"); return { x: c.x, y: c.y, zoom: c.zoom }; };
      const outOf = () => compose().stats().outgoing;
      // the rest frame: no selection, every spring settled (a fading ring would differ from the departed frame's IDLE resolve)
      // a rig SETUP write: every card unselected (the departed frame draws at rest — a ring at the cut would be a pop, as in the lab)
      for (const c of cards) if (world.hasTag(c, Selected)) world.removeTag(c, Selected);
      await until(() => cards.every((c) => (compose().motionOf(c)?.reveal ?? 0) <= 0) && !compose().stats().live, 300);
      await frames(4);
      const r0 = await readback(canvas);
      // ENTER: the op cuts the world and snaps the camera to c0; the first tick holds at p = 0 — the cut frame
      e.ops.enterContainer(f);
      await until(() => t().ticks >= 1, 30);
      const cutT = t();
      const r1 = await readback(canvas);
      const o0 = outOf();
      const cut = { p: cutT.p, ticks: cutT.ticks, active: cutT.active, maxDelta: maxDelta(r0, r1), outgoing: o0 === null ? null : { kind: o0.kind, frames: o0.frames, at: o0.at } };
      await frames(3);
      const mid = { p: t().p, outgoing: outOf() !== null };
      await until(() => !t().active, 600);
      const tl = t();
      const cl = camOf();
      const landed = Math.max(Math.abs(cl.x - tl.c1x), Math.abs(cl.y - tl.c1y), Math.abs(cl.zoom - tl.c1z));
      await frames(3);
      const submits0 = submits();
      await frames(70);
      const afterLanding = { outgoing: outOf() !== null, submits: submits() - submits0, frames: 70 };
      const r2 = await readback(canvas);
      // EXIT: the departed inside over the parent, clipped by the face under the arriving camera — at the cut the face fills the view
      e.ops.exitContainer();
      await until(() => t().ticks >= 1 && t().kind === "exit", 30);
      const xt = t();
      const r3 = await readback(canvas);
      const xo = outOf();
      const inset = Math.round(24 * Math.min(window.devicePixelRatio || 1, 2));
      const exit = { p: xt.p, kind: xt.kind, order: xo?.kind === "exit" ? "over" : "?", maxDelta: maxDelta(r2, r3), maxDeltaInset: maxDelta(r2, r3, inset), outgoing: xo !== null };
      await until(() => !t().active, 600);
      const t2 = t();
      const c2 = camOf();
      const landed2 = Math.max(Math.abs(c2.x - t2.c1x), Math.abs(c2.y - t2.c1y), Math.abs(c2.zoom - t2.c1z));
      await frames(4);
      const r4 = await readback(canvas);
      // the folder and its reach (the shadow, the lift) in device px
      const [fx0, fy0] = dpx(FOLDER.x - 60, FOLDER.y - 60);
      const [fx1, fy1] = dpx(FOLDER.x + FOLDER.w + 60, FOLDER.y + FOLDER.h + 60);
      const skip = { x0: Math.floor(fx0), y0: Math.floor(fy0), x1: Math.ceil(fx1), y1: Math.ceil(fy1) };
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cutDiff = diffOf(r0, r1);
      const toWorld = (d: { box: [number, number, number, number] | null; count: number }) => ({ box: d.box === null ? null : d.box.map((v) => Math.round(v / zoom / dpr)), count: d.count });
      return { size: { w: r0.width, h: r0.height }, cut, mid, landed, afterLanding, exit, landed2, roundTrip: maxDelta(r0, r4), roundTripOutsideFolder: maxDelta(r0, r4, 0, skip), where: { cut: toWorld(cutDiff), roundTrip: toWorld(diffOf(r0, r4)) }, gpuErrors: gpu?.errors().length ?? 0 };
    },
    async heat(target, source) {
      const world = ce().world;
      const t = must(cards[target], `card ${target}`);
      const rt = cardRect(target);
      const rs = cardRect(source);
      // the plate cold: a point 30 world px inside the target's left edge, mid-height — where the light will land
      const probe: [number, number] = [rt.x + 30, rt.y + rt.h / 2];
      const cold = must((await sampleAt({ p: probe })).p, "cold px");
      // the dragged set's post-move union: the source card moved over the target's left half
      const dx = rt.x - rs.x - rs.w / 2;
      const dy = rt.y - rs.y;
      const rec = world.spawn({ components: [[DragBounds, { minX: rs.x + dx, minY: rs.y + dy, maxX: rs.x + dx + rs.w, maxY: rs.y + dy + rs.h }]] });
      world.setRelation(rec, DropTarget, t);
      world.addTag(t, OverlapCandidate);
      await until(() => (compose().motionOf(t)?.hot ?? 0) >= 1 && !compose().stats().live, 240);
      // the motion record is LIVE (the builder mutates it in place): copy the numbers now, before the clear below
      const m = must(compose().motionOf(t), "motion");
      const hot = { hot: m.hot, tier: m.tierK, at: [m.hotAt[0], m.hotAt[1]] as const, half: [m.hotHalf[0], m.hotHalf[1]] as const, r: m.hotR };
      const lit = must((await sampleAt({ p: probe })).p, "lit px");
      world.removeTag(t, OverlapCandidate);
      world.removeRelation(rec, DropTarget);
      await until(() => (compose().motionOf(t)?.hot ?? 1) <= 0 && !compose().stats().live, 240);
      return { ...hot, lit, cold, hotAfter: compose().motionOf(t)?.hot ?? -1 };
    },
  };
}

declare global {
  interface Window { __nextRig?: NextRig }
}
window.__nextRig = mountNextRig();
