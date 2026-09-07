/**
 * The C2 exit witness (design-013 §8, D-C2.2–D-C2.4): the STRATIFIED profile's ground on the
 * engine — `<InfiniteCanvas profile={stratifiedProfile} ground={groundField(…)}>`, NO app
 * device (the layer acquires its own), the seeded board of real DOM widgets above it.
 * Measured, in order:
 *
 *  1. it mounts: one ground canvas in the L0 slot and NO L1 source canvas (the stratified
 *     mount has no HTML-in-Canvas), the layer available on its own device, at least one
 *     redraw and one real submit, zero uncaptured GPU errors;
 *  2. idle-zero: over a quiet window it submits nothing; a camera write is one frame;
 *  3. the grid draws and a DOM card is a DOM card: on the GROUND canvas a gap and a card's
 *     centre both read the theme's ground (no plate — the ground draws no frames, the
 *     builder still counts the cards as SOURCES), while the PAGE over the card's title
 *     differs from the ground (the DOM is above it);
 *  4. the overlays follow the type: a wired node pair draws its wire (the vertices
 *     collected, the stroke's core reads the configured colour composited straight over the
 *     ground — D-C2.6's chain), a guide spawned by hand draws in its configured magenta, and
 *     inside the whiteboard folder (`wires: false`) the wires gate is off;
 *  5. the flight is the ground's SECOND SLOT on the ground canvas only: the enter cut
 *     changes no pixel INSIDE the face (the arriving slot IS the portal's last frame) and
 *     none outside it (the departed slot IS the pre-cut frame), the departed slot carries
 *     no frames, the round trip returns the ground pixel for pixel; and inside, the root's
 *     glyph is the whiteboard's `line`;
 *  6. D-C2.2: a 60-step gesture of the REAL pointer (Playwright's mouse, one step per
 *     frame) is a redraw per step and 0 bakes; a remote cursor pole moved 5 times is 5 bakes;
 *  7. idle-zero after every settle, 0 GPU errors throughout.
 *
 * ONE document for the whole run (the `boot` rig's shape): a second `docs.create()` closes
 * the first with an in-place `world.reset()`, which clears the runtime resources — `Viewport`
 * among them — and the ground paints only under a live viewport (a finding, named in C2's
 * landing log: a document switch after the mount leaves the ground dark until a resize).
 *
 * Mounted from `stratified.html`, driven by `scripts/stratified.mjs`.
 */
import {
  Camera,
  CursorVisual,
  DEFAULT_SNAP_GUIDES_CONFIG,
  DEFAULT_WIRES_CONFIG,
  type Entity,
  GuideLine,
  NavTransition,
  Position,
  Selected,
  spawnWidget,
  Wire,
  defineQuery,
} from "@ice/core";
import { type GroundFieldContext, type GroundFieldHandle, groundField, instrumentSubmits, localPointerPoles, cursorVisualPoles, type SubmitInstrument } from "@ice/ground";
import { THEMES } from "@ice/ground/oracle/fixtures/vf-theme";
import { cuttingMat, needleGlyph } from "@ice/ground/packs";
import { InfiniteCanvas, stratifiedProfile } from "@ice/react";
import { createRoot } from "react-dom/client";
import { createDemoEngine, seedWire } from "../App";

type RGB = readonly [number, number, number];

interface Mounted {
  readonly profile: string;
  readonly canvases: number;
  readonly sourceCanvases: number;
  readonly available: boolean;
  readonly status: string;
  readonly ownDevice: boolean;
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
  readonly drawnFrames: number;
  readonly textured: number;
  readonly sources: number;
  readonly redraws: number;
  readonly submits: number;
  readonly gpuErrors: number;
  /** Modal colours of 9×9 device-px patches off the GROUND canvas. */
  readonly pixels: { readonly card: RGB; readonly gap: RGB; readonly face: RGB };
  readonly expect: { readonly bg: RGB; readonly card: RGB };
  /** CSS px on the page: the card's title area (the DOM above the ground). */
  readonly title: { sx: number; sy: number; w: number; h: number };
  readonly note?: string;
}
interface Overlays {
  readonly wires: number;
  readonly guides: number;
  readonly wiresOn: boolean;
  readonly guidesOn: boolean;
  /** The guide's configured colour composited straight over the ground, and how many ground pixels ARE that byte (the line's fully covered core). */
  readonly guideExpect: RGB;
  readonly guidePixels: number;
  /** The exact ground pixel on the guide line at mid-height. */
  readonly guidePixel: RGB;
  /** The wire's configured colour over the ground, and how many ground pixels are that byte (two wires' stroke cores). */
  readonly wireExpect: RGB;
  readonly wirePixels: number;
  /** A control: pixels of the guide's colour BEFORE the guide existed (0 — the byte is the overlay's). */
  readonly guidePixelsBefore: number;
  readonly gpuErrors: number;
}
interface NavFlight {
  readonly size: { w: number; h: number };
  readonly cut: { p: number; ticks: number; active: boolean; maxDelta: number; maxDeltaInsideFace: number; outgoing: { kind: string; frames: number; at: number | null } | null };
  readonly mid: { p: number; outgoing: boolean };
  readonly landed: number;
  readonly insideGlyph: string;
  readonly wiresOnInside: boolean;
  readonly afterLanding: { outgoing: boolean; submits: number; frames: number };
  readonly exit: { p: number; kind: string; maxDelta: number; outgoing: boolean };
  readonly landed2: number;
  readonly roundTrip: number;
  readonly rootGlyph: string;
  readonly gpuErrors: number;
}
/** The counters D-C2.2's witness reads around a REAL pointer gesture the script drives. */
interface Counters {
  readonly redraws: number;
  readonly bakes: number;
  readonly submits: number;
  readonly pointerOn: boolean;
  readonly sources: number;
  readonly gpuErrors: number;
}
interface RemotePole {
  readonly moves: number;
  readonly redraws: number;
  readonly bakes: number;
  readonly sources: number;
  readonly gpuErrors: number;
}
interface StratifiedRig {
  readonly ready: Promise<void>;
  mount(): Promise<Mounted>;
  idle(ms: number): Promise<{ frames: number; submits: number; redraws: number }>;
  nudge(): Promise<{ submits: number; redraws: number }>;
  board(): Promise<Board>;
  overlays(): Promise<Overlays>;
  nav(): Promise<NavFlight>;
  counters(): Promise<Counters>;
  remote(): Promise<RemotePole>;
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const frames = async (n: number) => { for (let i = 0; i < n; i++) await frame(); };
const bytes = (c: RGB): RGB => [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255)];

/** The board in world units: six cards in a 3×2 grid and a folder with three cards inside (the `boot` rig's board). */
const CARD = { w: 220, h: 150 } as const;
const GRID = { x: 40, y: 40, dx: 250, dy: 180 } as const;
const FOLDER = { x: 800, y: 40, w: 329, h: 345, pad: 10, bar: 36 } as const;
const BOARD = { w: FOLDER.x + FOLDER.w + 40, h: FOLDER.y + FOLDER.h + 40 } as const;
const cardRect = (i: number) => ({ x: GRID.x + (i % 3) * GRID.dx, y: GRID.y + Math.floor(i / 3) * GRID.dy, w: CARD.w, h: CARD.h });

function diffOf(a: ImageData, b: ImageData, region?: { x0: number; y0: number; x1: number; y1: number }, inside = true): { max: number; count: number } {
  if (a.width !== b.width || a.height !== b.height) return { max: 255, count: -1 };
  let max = 0;
  let count = 0;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      if (region !== undefined) {
        const inR = x >= region.x0 && x < region.x1 && y >= region.y0 && y < region.y1;
        if (inR !== inside) continue;
      }
      const i = (y * a.width + x) * 4;
      let d = 0;
      for (let k = 0; k < 3; k++) { const dk = Math.abs((a.data[i + k] as number) - (b.data[i + k] as number)); if (dk > d) d = dk; }
      if (d > 0) { count += 1; if (d > max) max = d; }
    }
  }
  return { max, count };
}
/** Pixels off a LIVE WebGPU canvas: `drawImage` from it is silently blank; `toDataURL` → decode → draw works (the 2026-09 finding). */
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
/** The modal colour of a 9×9 patch centred at device px (x, y) — a glyph cannot outvote the ground. */
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
/** How many pixels of the image are within `tol` per channel of `c`. */
function countNear(img: ImageData, c: RGB, tol: number): number {
  let n = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (Math.abs((img.data[i] as number) - c[0]) <= tol && Math.abs((img.data[i + 1] as number) - c[1]) <= tol && Math.abs((img.data[i + 2] as number) - c[2]) <= tol) n += 1;
  }
  return n;
}
const pixelAt = (img: ImageData, x: number, y: number): RGB => {
  const px = Math.min(Math.max(Math.round(x), 0), img.width - 1);
  const py = Math.min(Math.max(Math.round(y), 0), img.height - 1);
  const i = (py * img.width + px) * 4;
  return [img.data[i] as number, img.data[i + 1] as number, img.data[i + 2] as number];
};
/** `css` (rgba or #hex) composited straight over `bg` (0..1) — D-C2.6: what the engine writes. */
function over(css: string, bg: RGB): RGB {
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(css.trim());
  let c: [number, number, number, number];
  if (m) c = [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255, m[4] === undefined ? 1 : Number(m[4])];
  else { const v = Number.parseInt(css.slice(1), 16); c = [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, 1]; }
  const a = c[3];
  return bytes([bg[0] * (1 - a) + c[0] * a, bg[1] * (1 - a) + c[1] * a, bg[2] * (1 - a) + c[2] * a]);
}

const wireQ = defineQuery([Wire]);

function mountRig(): StratifiedRig {
  let instrument: SubmitInstrument | undefined;
  let handle: GroundFieldHandle | null = null;
  let engine: ReturnType<typeof createDemoEngine> | undefined;
  const gpuErrors: GPUError[] = [];
  const rootEl = document.getElementById("root") as HTMLElement;
  const theme = THEMES.dark;
  let cards: Entity[] = [];
  let folder: Entity | null = null;
  let zoom = 1;

  const ready = (async () => {
    const ce = createDemoEngine();   // NO device: the stratified arm
    // Every rig page runs inside the Electron shell, so `hasDesktopBridge()` is true and
    // `createDemoEngine` left the seeding to a switchboard join this one-window harness never
    // makes. ONE local document, empty: every phase spawns into it (see the header).
    if (ce.docs.current() === undefined) ce.docs.create();
    engine = ce;
    const factory = groundField({
      theme,
      grids: [needleGlyph, cuttingMat],
      poles: [localPointerPoles(), cursorVisualPoles()],
      onDevice: (device) => {
        instrument = instrumentSubmits(device);
        device.addEventListener("uncapturederror", (ev) => { gpuErrors.push((ev as GPUUncapturedErrorEvent).error); });
      },
    });
    const ground = (ctx: GroundFieldContext) => { handle = factory(ctx); return handle; };
    createRoot(rootEl).render(<InfiniteCanvas engine={ce} ground={ground} profile={stratifiedProfile} className="h-full w-full" />);
    await frames(2);
  })();

  const must = <T,>(v: T | null | undefined, what: string): T => { if (v === null || v === undefined) throw new Error(`rig: no ${what}`); return v; };
  const ce = () => must(engine, "engine");
  const field = () => must(handle, "ground handle").field;
  const submits = () => instrument?.total() ?? 0;
  const redraws = () => handle?.field.redraws() ?? 0;
  const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
  const dpx = (wx: number, wy: number): [number, number] => [wx * zoom * dpr(), wy * zoom * dpr()];
  const until = async (p: () => boolean, max = 300) => { for (let i = 0; i < max && !p(); i++) await frame(); return p(); };
  const snapshot = (): Mounted => ({
    profile: stratifiedProfile.name,
    canvases: rootEl.querySelectorAll("canvas:not([data-ice-source-canvas])").length,
    sourceCanvases: rootEl.querySelectorAll("canvas[data-ice-source-canvas]").length,
    available: handle?.field.available() ?? false,
    status: JSON.stringify(handle?.field.status() ?? null),
    ownDevice: handle?.field.device() !== undefined,
    redraws: redraws(),
    submits: submits(),
    gpuErrors: gpuErrors.length,
    viewport: `${rootEl.clientWidth}x${rootEl.clientHeight}`,
  });

  return {
    ready,
    async mount() {
      await ready;
      await until(() => (handle?.field.available() ?? false) && redraws() > 0);
      return snapshot();
    },
    async idle(ms) {
      const submits0 = submits();
      const redraws0 = redraws();
      const t0 = performance.now();
      let n = 0;
      while (performance.now() - t0 < ms) { await frame(); n++; }
      return { frames: n, submits: submits() - submits0, redraws: redraws() - redraws0 };
    },
    async nudge() {
      const submits0 = submits();
      const redraws0 = redraws();
      const world = ce().world;
      const cam = world.getResource(Camera) ?? { x: 0, y: 0, zoom: 1, gesturing: false };
      world.setResource(Camera, { ...cam, x: cam.x + 40 });   // a rig SETUP write, outside the tick
      await frames(6);
      return { submits: submits() - submits0, redraws: redraws() - redraws0 };
    },
    async overlays() {
      // LAST phase: a wired node pair far right of the board (the seed's own column), plus one guide spawned by hand
      // (the snap system's pooled entity, written as a rig SETUP) — nothing here is on screen for the phases before it
      const e = ce();
      const world = e.world;
      const session = must(e.docs.current(), "the document");
      const from = { x: 1880, y: 50 };
      const signal = spawnWidget(session.store, world, "signal-node", { x: from.x, y: from.y, w: 170, h: 96, undoable: false });
      const filter = spawnWidget(session.store, world, "filter-node", { x: from.x + 240, y: from.y + 120, w: 170, h: 96, undoable: false });
      seedWire(session, signal, "out", filter, "in");
      world.sync();
      let wires = 0;
      world.query(wireQ).each((b) => { wires += b.count; });
      if (wires === 0) throw new Error("rig: the wire did not spawn");
      const size = { w: rootEl.clientWidth, h: rootEl.clientHeight };
      // pan the camera onto the pair (a rig SETUP write)
      world.setResource(Camera, { x: from.x - 40, y: from.y - 40, zoom: 1, gesturing: false });
      await until(() => field().stats().overlays.wires > 0, 120);
      await frames(4);
      const bg = theme.canvasBg;
      const gc = DEFAULT_SNAP_GUIDES_CONFIG;
      // the guide's straight-alpha colour over the ground (guideAlpha 0.8) — D-C2.6: the byte the engine writes
      const guideExpect = bytes([bg[0] * (1 - gc.guideAlpha) + gc.color[0] * gc.guideAlpha, bg[1] * (1 - gc.guideAlpha) + gc.color[1] * gc.guideAlpha, bg[2] * (1 - gc.guideAlpha) + gc.color[2] * gc.guideAlpha]);
      const wireExpect = over(DEFAULT_WIRES_CONFIG.wireColor, bg);
      // the CONTROL: before the guide exists, no ground pixel is the guide's byte
      const before = await readback(field().canvas);
      const guidePixelsBefore = countNear(before, guideExpect, 1);
      // a guide line across the view, in world coords under that camera (axis x at world x = from.x + 300, spanning the view)
      const guideX = from.x + 300;
      const guide = world.spawn({ components: [[GuideLine, { axis: "x", at: guideX, from: from.y - 40, to: from.y - 40 + size.h }]] });
      await until(() => field().stats().overlays.guides > 0, 120);
      await frames(4);
      const s = field().stats().overlays;
      const img = await readback(field().canvas);
      const d = dpr();
      // the guide: world x → screen (guideX − cam.x) · zoom = 340 CSS px; the exact device px on the line at mid-height
      const guidePixel = pixelAt(img, 340 * d, Math.round(size.h / 2) * d);
      const out: Overlays = {
        wires: s.wires, guides: s.guides, wiresOn: s.wiresOn, guidesOn: s.guidesOn,
        guideExpect, guidePixels: countNear(img, guideExpect, 1), guidePixel,
        wireExpect, wirePixels: countNear(img, wireExpect, 1),
        guidePixelsBefore,
        gpuErrors: gpuErrors.length,
      };
      world.destroy(guide);   // the guide is this phase's; the flight below must not carry it
      await frames(3);
      return out;
    },
    async board() {
      const e = ce();
      const world = e.world;
      const session = must(e.docs.current(), "the document");   // the one document: the board below is the whole world
      zoom = Math.min(1, (rootEl.clientWidth - 20) / BOARD.w, (rootEl.clientHeight - 20) / BOARD.h);
      world.setResource(Camera, { x: 0, y: 0, zoom, gesturing: false });
      cards = [];
      for (let i = 0; i < 6; i++) { const r = cardRect(i); cards.push(spawnWidget(session.store, world, "clock-card", { ...r, undoable: false })); }
      const f = spawnWidget(session.store, world, "card-container", { x: FOLDER.x, y: FOLDER.y, w: FOLDER.w, h: FOLDER.h, undoable: false, props: { title: "Folder", accent: "#7B96FF" } });
      folder = f;
      world.sync();
      await frames(2);
      for (const [x, y] of [[0, 0], [260, 0], [0, 200]] as const) spawnWidget(session.store, world, "clock-card", { x, y, w: CARD.w, h: CARD.h, parent: f, undoable: false });
      world.sync();
      const ok = await until(() => { const s = field().stats(); return s.cards >= 7 && s.portals >= 1; });
      await frames(3);
      const s = field().stats();
      const r0 = cardRect(0);
      const r1 = cardRect(1);
      const face = { x: FOLDER.x + FOLDER.pad, y: FOLDER.y + FOLDER.pad, w: FOLDER.w - 2 * FOLDER.pad, h: FOLDER.h - FOLDER.pad - FOLDER.bar };
      const img = await readback(field().canvas);
      const at = (wx: number, wy: number) => { const [x, y] = dpx(wx, wy); return modal(img, x, y); };
      const inputs = field().lastInputs();
      return {
        zoom, active: s.active, cards: s.cards, containers: s.containers, portals: s.portals, inside: s.inside, drawnFrames: s.drawnFrames, textured: s.textured,
        sources: inputs?.sources.length ?? -1,
        redraws: redraws(), submits: submits(), gpuErrors: gpuErrors.length,
        pixels: { card: at(r0.x + r0.w / 2, r0.y + r0.h / 2), gap: at((r0.x + r0.w + r1.x) / 2, r0.y + r0.h / 2), face: at(face.x + face.w / 2, face.y + face.h / 2) },
        expect: { bg: bytes(theme.canvasBg), card: bytes(theme.card) },
        title: { sx: (r0.x + 16) * zoom, sy: (r0.y + 14) * zoom, w: 60 * zoom, h: 12 * zoom },
        ...(ok ? {} : { note: "board never reached 7 cards + 1 portal" }),
      };
    },
    async nav() {
      const e = ce();
      const world = e.world;
      const f = must(folder, "the folder");
      const canvas = field().canvas;
      const t = () => must(world.getResource(NavTransition), "NavTransition");
      const camOf = () => { const c = must(world.getResource(Camera), "camera"); return { x: c.x, y: c.y, zoom: c.zoom }; };
      const outOf = () => field().stats().outgoing;
      for (const c of cards) if (world.hasTag(c, Selected)) world.removeTag(c, Selected);
      await frames(4);
      const r0 = await readback(canvas);
      // ENTER: the op cuts the world and snaps the camera to c0; the first tick holds at p = 0 — the cut frame
      e.ops.enterContainer(f);
      await until(() => t().ticks >= 1, 30);
      const cutT = t();
      const r1 = await readback(canvas);
      const o0 = outOf();
      // the face in device px under the PRE-CUT camera (the rig's camera at the origin, `zoom`)
      const face = { x: FOLDER.x + FOLDER.pad, y: FOLDER.y + FOLDER.pad, w: FOLDER.w - 2 * FOLDER.pad, h: FOLDER.h - FOLDER.pad - FOLDER.bar };
      const [fx0, fy0] = dpx(face.x, face.y);
      const [fx1, fy1] = dpx(face.x + face.w, face.y + face.h);
      const region = { x0: Math.ceil(fx0) + 2, y0: Math.ceil(fy0) + 2, x1: Math.floor(fx1) - 2, y1: Math.floor(fy1) - 2 };
      const cut = {
        p: cutT.p, ticks: cutT.ticks, active: cutT.active,
        maxDelta: diffOf(r0, r1).max, maxDeltaInsideFace: diffOf(r0, r1, region, true).max,
        outgoing: o0 === null ? null : { kind: o0.kind, frames: o0.frames, at: o0.at },
      };
      await frames(3);
      const mid = { p: t().p, outgoing: outOf() !== null };
      await until(() => !t().active, 600);
      const tl = t();
      const cl = camOf();
      const landed = Math.max(Math.abs(cl.x - tl.c1x), Math.abs(cl.y - tl.c1y), Math.abs(cl.zoom - tl.c1z));
      await frames(3);
      const insideGlyph = field().config().glyph;
      const wiresOnInside = field().stats().overlays.wiresOn;
      const submits0 = submits();
      await frames(70);
      const afterLanding = { outgoing: outOf() !== null, submits: submits() - submits0, frames: 70 };
      const r2 = await readback(canvas);
      // EXIT: the departed inside over the parent, clipped by the face under the arriving camera
      e.ops.exitContainer();
      await until(() => t().ticks >= 1 && t().kind === "exit", 30);
      const xt = t();
      const r3 = await readback(canvas);
      const xo = outOf();
      const exit = { p: xt.p, kind: xt.kind, maxDelta: diffOf(r2, r3).max, outgoing: xo !== null };
      await until(() => !t().active, 600);
      const t2 = t();
      const c2 = camOf();
      const landed2 = Math.max(Math.abs(c2.x - t2.c1x), Math.abs(c2.y - t2.c1y), Math.abs(c2.zoom - t2.c1z));
      await frames(4);
      const r4 = await readback(canvas);
      return { size: { w: r0.width, h: r0.height }, cut, mid, landed, insideGlyph, wiresOnInside, afterLanding, exit, landed2, roundTrip: diffOf(r0, r4).max, rootGlyph: field().config().glyph, gpuErrors: gpuErrors.length };
    },
    async counters() {
      await frames(2);
      const s = field().stats();
      return { redraws: redraws(), bakes: s.bakes, submits: submits(), pointerOn: s.poles.pointer, sources: s.poles.sources, gpuErrors: gpuErrors.length };
    },
    async remote() {
      const world = ce().world;
      // a remote collaborator's cursor (core's `CursorVisual` + `Position`, as presence projects it) — a rig SETUP write per move, outside the tick
      const remote = world.spawn({ components: [[Position, { x: 500, y: 400 }], [CursorVisual, { kind: "remote", pressed: false }]] });
      await frames(3);
      const bakes1 = field().stats().bakes;
      const redraws1 = redraws();
      const MOVES = 5;
      for (let i = 1; i <= MOVES; i++) {
        world.edit(remote).set(Position, { x: 500 + i * 20, y: 400 });
        await frames(2);
      }
      const out = { moves: MOVES, redraws: redraws() - redraws1, bakes: field().stats().bakes - bakes1, sources: field().stats().poles.sources, gpuErrors: gpuErrors.length };
      world.destroy(remote);
      await frames(3);
      return out;
    },
  };
}

declare global {
  interface Window { __stratifiedRig?: StratifiedRig }
}
window.__stratifiedRig = mountRig();
