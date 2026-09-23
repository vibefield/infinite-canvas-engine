// DomRender — §6's reflector 5 (design-013 §8 B4): a promoted DOM card's
// pixels, copied by HTML-in-Canvas from its L1 host into the destination
// Residency named in its `TextureRef`, and declared written to the content
// residency so the ground draws the card in `page` (or `own`) mode instead of
// the plate.
//
// It is the NEW leg's answer to `compositor/dom-source-binder.ts`, and it is
// deliberately not that file adapted: the binder owns an atlas of its own and
// sizes its slots from a second formula, which is exactly the disagreement its
// own errata records (a card banded at 1 whose live zoom drifted to 1.9 wrote
// 40,272 px past its slot). Here the destination is Residency's — the world's
// fact, `TextureRef` — and the SIZE comes from `geometry()` in
// `@ice/kernel/surface-geometry`, the same pure function, on the same inputs
// (`Size`, `SurfaceBand`, `Viewport.dpr`, `Camera.zoom`, the kind's raster
// strategy), that Residency called when it placed the slot. There is no second
// multiplier to drift, which is what makes the drift exit "0 px by
// construction" rather than a number that happened to come out right:
//
//   the host's CSS box  := the widget's own, × CSS `zoom` = geometry().cssSize   (this file writes both)
//   the copy's extent   =  cssSize × backingScale  (the platform; the L1
//                          bitmap's scale, measured flat at dpr)
//   the slot            =  geometry().slotSize     (Residency, same call)
//   and geometry() guarantees slotSize == written == ceil(cssSize × dpr).
//
// WHAT IS FLUX AND WHAT IS FACT. Dirt (which cards owe a copy), the deferred
// due dates and the parked set live HERE, outside the world — a paint event is
// not a world fact and a card that owes a copy is not a different card. The
// world's side of the same question is `residency.isWritten(e)`: a copy is
// owed per DESTINATION, so a re-slot or a promotion is a new debt whether or
// not the host repainted. Both sources feed one set.
//
// THE DEMAND CLAMP, carried verbatim in behaviour from the old binder (§6.2,
// design-013 D3): `demandIntervalMs(SurfaceDemand)` — `Infinity` (paused, or
// bucket 0) PARKS the card: no copy, no wake, and no entry in `pending()`, so
// a card animating off-screen costs nothing at all rather than one composite
// per paint event; a finite interval DEFERS the copy to the moment its bucket
// allows, so a throttled card is BEHIND, never wrong; 0 copies now.
//
// THE STILL (2026-09-09, the gesture set): a paused card whose CURRENT
// destination has never been written takes ONE picture — when its debt is the
// WORLD's (a promotion, a re-slot, a re-size, journaled through `TextureRef`
// and `SurfaceTarget`), never for a paint mark — and then parks like any other
// paused card. That is what "paused" has to mean for a card `domAtRest` holds
// on the GPU for a drag: the picture it had when the gesture began, held for
// the gesture, instead of the plate. Until this rule a paused card with no
// pixels stayed on the plate and D3 called that honest; a plate under a drag
// is a hole, not a picture, so the first copy is owed and a paint mark still
// buys nothing.
//
// THE BUDGET (2026-09-09, the levers): at most `budget` cards copy per flush,
// FIFO over the dirty set (a served card re-dirtied goes to the back, behind
// every card still waiting) with the stills ahead of the live cards. The
// reason is the pipeline's shape, named the same day: `copyElementImageToTexture`
// is a FIXED cost per CALL on the GPU process's one main thread (≈0.58 ms +
// ≈0.05 per card of content, whatever the texels), so a board past ≈2,800
// calls/s stalls the WHOLE app — the renderer's main thread blocks in
// command-buffer flow control until the GPU process catches up — where a
// budget keeps the app at the display's rate and lets only the promoted cards'
// cadence degrade (K × fps ÷ N each): "behind, never wrong", D3's own words,
// applied to the board. The controller reads two signals: the main-thread wall
// of the copy calls per flush (0.03 ms per card unsaturated, ten times that
// blocked in flow control) and the flush's own cadence against the display
// period it estimates (a saturated GPU process presents late before the copy
// calls block, because the ground's own submit shares that thread) — the
// second only while the copies' estimated GPU time is a real share of that
// period, since a board can run late for reasons of its own. A feed-forward
// cap keeps that estimate to half the period; the budget shrinks on either
// signal and grows by one only after a calm run with cards still waiting.
// ON by default since the review of 2026-09-23 (`budget: false` turns it off;
// the measurement commit of 2026-09-09 had kept the old behaviour the default
// until the numbers were in: every animated phase at 96 cards from 23–58 fps
// to the display's rate, the GPU process from 108–171 % to 44–84 % of a core,
// the pickup unchanged, each card refreshing ≈7 times a second).
//
// THE BATCH (2026-09-09, the other lever): strategy `batched` rasters the
// served cards of one page layer as ONE recording — each drawn into the SOURCE
// canvas's own 2D context (`drawElementImage`, the only context the platform
// accepts: the host's parent canvas's) at its slot's position within a staging
// tile, then the tile landed in the page layer by ONE `copyExternalImageToTexture`
// of the canvas — where the element route mints a surface, rasters, wraps and
// blits PER CARD. Measured without the engine: 0.1 ms of GPU-process CPU per
// draw against 0.58 per element copy, 6,400 cards/s against 3,400 for the same
// card. The hosts stay exactly where they are (hit-test, focus, caret, IME) and
// the slot atlas stays (a pan still copies nothing): the draw takes an (x, y).
// Tiles are cut to the bitmap the canvas already has (no resize, no explicit
// copy size), at slot boundaries, so a copy never leaves the bitmap or the
// page. A tile's copy overwrites every slot inside its box, so the WRITTEN
// residents whose slots intersect it are drawn too (`extras`); an unwritten
// slot is never sampled and may be overwritten. Any refusal in a tile (a draw
// throwing on an unpainted host, a missing host, a copy that returns false)
// discards the staged pixels and falls the tile's cards back to element copies,
// and a tile whose cost model says the batch would lose (one dirty card on a
// page: 0.1 + 0.9 against 0.58) is never staged at all. The staged pixels are
// cleared right after the copy — the copy snapshots at the call — so the
// canvas, which IS painted to the screen (only its children are not), presents
// nothing.
//
// Reflector contract (design-002 §5): post-notify, output-only. It writes DOM
// (the host's box and placement) and GPU queue ops, never the ECS, and it
// reads no layout — every size comes from world facts through `geometry()`.
// Its queue ops are ordered before GpuCompose's submit by registration order
// (§6: renders 5–7, then DomCompose 8, then GpuCompose 9).

import {
  Camera,
  DEFAULT_SURFACE_DEMAND,
  demandIntervalMs,
  type Entity,
  NO_TEXTURE,
  Position,
  Size,
  SurfaceBand,
  SurfaceDemand,
  type SurfaceDemandValue,
  SurfaceKind,
  SurfaceTarget,
  type TextureHandle,
  TextureRef,
  Viewport,
  type World,
} from "@ice/core";
import { geometry, type RasterStrategy, type SurfaceGeometry } from "@ice/kernel";
import { createPages, PAGE_USAGE } from "../card/content";
import { copyElementToTexture, drawElementImage } from "../hic-adapter";
import type { ContentResidency } from "./residency";
import { targetOf } from "./residency";

/** The dom reflector's OUTER host per entity — the node the copy addresses (never the content div). */
export interface DomRenderHosts {
  hostOf(entity: Entity): HTMLElement | undefined;
}

/** The copy itself, injectable so the unit tests need no origin trial. */
export type ElementCopy = (
  queue: GPUQueue,
  element: Element,
  texture: GPUTexture,
  origin: { readonly x: number; readonly y: number; readonly z?: number },
) => boolean;

/** The batched route's raster: one card's cached record drawn into the source canvas's 2D context at `(x, y)`, scaled to `w × h`. Injectable so the unit tests need no origin trial. */
export type ElementDraw = (ctx: CanvasRenderingContext2D, element: Element, x: number, y: number, w: number, h: number) => boolean;

/** The batched route's landing: a `src`-origined `size` rect of the canvas copied to `dst` in `texture` (`z` the layer). Injectable. */
export type CanvasCopy = (
  queue: GPUQueue,
  canvas: HTMLCanvasElement,
  src: { readonly x: number; readonly y: number },
  texture: GPUTexture,
  dst: { readonly x: number; readonly y: number; readonly z: number },
  size: { readonly w: number; readonly h: number },
) => boolean;

/** The two levers (2026-09-09; the header). The route defaults to the behaviour before them; the budget is ON since the review of 2026-09-23. */
export interface DomRenderTuning {
  /** `element` (one HiC copy per card — the default) or `batched` (the 2D draws + one canvas copy per tile, with the element copy as the fallback). */
  readonly strategy?: "element" | "batched";
  /**
   * The per-flush copy budget: `false` for none; a number for a fixed cap; an object — or nothing,
   * since 2026-09-23 — for the adaptive controller (start 16, min 2, max 256, `target` 0.5 — the share of the frame period the
   * copies' estimated GPU-process time is capped to; 0.5 held 120 fps with no dropped frame on the
   * stress rig, and a higher target buys card cadence on a mid-size board at the price of the
   * controller probing the knee with an occasional late frame).
   */
  readonly budget?: false | number | { readonly start?: number; readonly min?: number; readonly max?: number; readonly target?: number };
  /** The batched route's cost model, ms of GPU-process CPU (measured 2026-09-09): a draw, a canvas copy, an element copy. */
  readonly costs?: { readonly draw?: number; readonly canvasCopy?: number; readonly elementCopy?: number };
}

export interface DomRenderOptions {
  /** The ground's device — every destination texture is created on it. */
  readonly device: GPUDevice;
  readonly world: World;
  /** The content residency (B4a): every realisation and every write goes through it. */
  readonly residency: ContentResidency;
  /** The L1 hosts by entity. */
  readonly hosts: DomRenderHosts;
  /** The kind's raster strategy — the SAME function the profile hands Residency (§9 Q1). Default `band`. */
  readonly raster?: (kind: "dom" | "gl" | "video") => RasterStrategy;
  /** The clamp's clock; `performance.now` by default. */
  readonly now?: () => number;
  /** The element copy; the HiC adapter's by default. */
  readonly copy?: ElementCopy;
  /** The levers; off by default. */
  readonly tuning?: DomRenderTuning;
  /** The batched route's draw; the HiC adapter's `drawElementImage` by default. */
  readonly draw?: ElementDraw;
  /** The batched route's canvas copy; `queue.copyExternalImageToTexture` by default. */
  readonly canvasCopy?: CanvasCopy;
  /** The source canvas's 2D context; `canvas.getContext("2d")` by default (the context `@ice/dom`'s source canvas acquired at creation). */
  readonly context2d?: (canvas: HTMLCanvasElement) => CanvasRenderingContext2D | null;
}

export interface DomRenderStats {
  /** Element copies that landed. */
  readonly copies: number;
  /**
   * Of those, the FIRST pictures taken for PAUSED cards (the still's rule, 2026-09-09): a paused
   * card whose destination the world just named copies once and then parks. `copies − stills`
   * is what live demand paid for.
   */
  readonly stills: number;
  /**
   * Hosts a paint event named, cumulative — the RAW dirt rate, before the
   * demand clamp. The pair (`dirtied`, `copies`) is what says whether a busy
   * board is the clamp working or the latch spinning: an animating card at 60
   * dirties ~240 times a second and must copy at its bucket.
   */
  readonly dirtied: number;
  /**
   * Of those, the ones this module's OWN placement write caused, dropped by the
   * §4.2 guard (B8 R7). `dirtied − selfDirt` is the content dirt rate. A pan
   * over N promoted cards raises N of these per frame and must copy none of
   * them; a standing `selfDirt` of 0 during a gesture means the guard has
   * stopped being load-bearing and the pan is uploading again.
   */
  readonly selfDirt: number;
  /**
   * Copies the platform THREW on — `InvalidStateError: No cached paint record
   * for element`, the frame after a host is reparented onto L1. The debt is
   * kept and the next flush copies: a card is briefly absent, never
   * permanently plate. A small standing count is the design working.
   */
  readonly refused: number;
  /**
   * Copies the adapter could not even attempt because the host has no
   * `copyElementImageToTexture` — a build without the origin trial. Held apart
   * from `refused` because it is a different fact: retrying will never help,
   * and a non-zero count here means every promoted card draws its plate for
   * good. Should be 0 wherever `probeHic().supported` is true.
   */
  readonly unavailable: number;
  /**
   * Copies refused because the destination is SMALLER than the host's raster (`geometry().written`):
   * the Q10 oversize path clamps a private texture to the device limit while the L1 copy writes the
   * element's whole raster, and a copy past the texture's edge is a validation error whose write
   * must not be claimed (B9 review blocker 2 — the drift class, reopened). The debt is dropped: the
   * card draws the plate until its band changes and Residency names a destination that fits — and
   * its STANDING write is cleared with the refusal (`residency.unwrote`, D-C4.7), or a card that
   * copied once and then grew inside the same band would keep its ref and draw the stale raster
   * stretched. The real answer projects the clamp into the uv (D11); until then a non-zero count
   * here is a card at a band its device cannot hold.
   */
  readonly oversize: number;
  /**
   * Copies skipped because the TABLE refused the destination's realisation and neither the handle
   * nor the table's revision has moved since (D-C4.7). The debt is KEPT — it retries the moment
   * either moves — and nothing is minted meanwhile: the unbacked-off path allocated a full texture
   * and destroyed it again on every flush, for as long as the refusal stood.
   */
  readonly backedOff: number;
  /** Cards whose dirt a pause has parked right now (outside `pending`). */
  readonly parked: number;
  /** Cards whose dirt a bucket has deferred right now. */
  readonly deferred: number;
  /** Copies still owed right now — dirty + deferred, never parked. */
  readonly pending: number;
  /** Host boxes written because `geometry().cssSize` moved (the copy waits a frame for the relayout). */
  readonly resized: number;
  /** Layers in the realised page array (0 while none). */
  readonly pagesLayers: number;
  /** Page-array growths (realloc + per-layer copy + a new realisation) — D-B4.1. */
  readonly growths: number;
  /** The copy budget in force (cards per flush); `Infinity` without one. */
  readonly budget: number;
  /** Cards a flush left waiting because the budget was spent, cumulative. */
  readonly throttled: number;
  /** Batched tiles landed (one canvas copy each), cumulative. */
  readonly batches: number;
  /** 2D draws made for batches (the served cards and the written neighbours their tiles covered), cumulative. */
  readonly draws: number;
  /** Tiles abandoned for element copies (a refusal, a missing host, or a cost model that said so), cumulative. */
  readonly fallbacks: number;
  /** Main-thread ms spent inside the copy calls (element, draw and canvas copies), cumulative — the budget's signal. */
  readonly copyMs: number;
}

export interface DomRender {
  /** The reflector for `compose.renders.dom` (§6 reflector 5). */
  readonly name: "dom-render";
  flush(world: World): void;
  /** A paint event named these hosts (the L1 source canvas's `onDirty`). */
  markDirtyHosts(hosts: readonly Element[]): void;
  stats(): DomRenderStats;
  dispose(): void;
}

/** The host's `data-ice-entity` — the dom reflector stamps it at creation, so no second map can drift from it. */
export function entityOfHost(el: Element): Entity | undefined {
  const raw = el.getAttribute("data-ice-entity");
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? (n as Entity) : undefined;
}

/** The last host box this module wrote, so the writes are change-only. */
interface Placed {
  w: number;
  h: number;
  k: number;
  tx: number;
  ty: number;
}

const demandOf = (world: World, e: Entity): SurfaceDemandValue => {
  const cell = world.get(e, SurfaceDemand);
  if (cell === undefined) return DEFAULT_SURFACE_DEMAND;
  return {
    mode: cell.mode === "live" ? "live" : "paused",
    fpsBucket: cell.fpsBucket as SurfaceDemandValue["fpsBucket"],
    interactive: cell.interactive,
  };
};

export function createDomRender(opts: DomRenderOptions): DomRender {
  const { device, world, residency, hosts } = opts;
  const raster = opts.raster ?? ((): RasterStrategy => "band");
  const now = opts.now ?? (() => performance.now());
  const copy: ElementCopy = opts.copy ?? copyElementToTexture;

  /** Cards that owe a copy. Flux: a paint event, a re-slot, a promotion. */
  const dirty = new Set<Entity>();
  /** Dirt a bucket deferred, by the moment it comes due. */
  const deferred = new Map<Entity, number>();
  /**
   * Dirt a PAUSE parked. No clock will ever make these due (`demandIntervalMs`
   * is `Infinity`), which is why they are held apart from `deferred`: counting
   * them as pending would keep the ground awake forever for a card nobody can
   * see. The only door out is a demand that comes back to a live bucket.
   */
  const parked = new Set<Entity>();
  /** When each card was last copied — the throttle's clock. */
  const lastCopy = new Map<Entity, number>();
  /**
   * Cards whose debt came from the WORLD (the `TextureRef`/`SurfaceTarget` journal: a
   * promotion, a re-slot, a re-size), as opposed to a paint mark. A paused card owes its
   * FIRST picture only for these — the still's rule — and the set is cleared by the copy
   * that discharges the debt, by a demotion, and by death.
   */
  const worldDebt = new Set<Entity>();
  /** The host box this module last wrote, per card. */
  const placed = new Map<Entity, Placed>();
  /**
   * THE §4.2 GUARD, on this leg (B8 R7).
   *
   * A placement write raises a paint event, and `changedElements` reports the
   * DRAWABLE — the immediate canvas child — never the descendant that mutated
   * (measured 2026-08-31; `@ice/dom`'s `source-canvas.ts` header carries the
   * numbers). So a host's own placement write and a content edit inside it are
   * INDISTINGUISHABLE by shape: both arrive as the same element. The header
   * says what follows — the guard has to be TEMPORAL, and it has to live with
   * the writer that knows what it wrote. This is that writer's copy.
   *
   * The value is the flush ordinal at which the placement was written; a mark
   * is consumed only while it is at most one flush old, so a placement whose
   * paint event never arrived cannot swallow a real content change later.
   */
  const selfWrote = new Map<Element, number>();
  /**
   * A realisation the table REFUSED, per card: the destination it was refused for and the table's
   * revision at the time (D-C4.7). While both stand there is nothing to try — `realize` is a pure
   * function of the handle and the table's state — so the copy is skipped and the debt kept. A new
   * handle (a re-slot) or a bumped revision (a producer registered) retires the record.
   */
  const refusedRealize = new Map<Entity, { readonly handle: TextureHandle; readonly revision: number }>();
  let flushes = 0;

  // The world's half of the debt: a card's DESTINATION changed (a promotion,
  // a re-slot after an eviction, a re-size). `coarse: false` — `TextureRef` is
  // Residency's own `ctx.set` and `SurfaceTarget` a behaviour's, both through
  // the store's chokepoints, exactly as the frame builder attests for the same
  // two components.
  const collector = world.changes.collect({ components: [TextureRef, SurfaceTarget], coarse: false });

  let copies = 0;
  let stills = 0;
  let dirtied = 0;
  let selfDirt = 0;
  let refused = 0;
  let unavailable = 0;
  let oversize = 0;
  let backedOff = 0;
  let resized = 0;
  let growths = 0;
  let pagesLayers = 0;
  let pagesHandle: TextureHandle = NO_TEXTURE;
  let disposed = false;

  const forget = (e: Entity): void => {
    dirty.delete(e);
    deferred.delete(e);
    parked.delete(e);
    worldDebt.delete(e);
    lastCopy.delete(e);
    placed.delete(e);
    refusedRealize.delete(e);
    const el = hosts.hostOf(e);
    if (el !== undefined) {
      selfWrote.delete(el);
      // custody goes back to the reflector, which knows nothing of the band's zoom: clear it here
      if (el.style.zoom !== "") el.style.zoom = "";
    }
  };

  /** The card's geometry this frame, or undefined when it has no destination to be sized for. */
  const geometryOf = (e: Entity): SurfaceGeometry | undefined => {
    const size = world.get(e, Size);
    const band = world.get(e, SurfaceBand)?.band ?? 0;
    // `geometry` throws on band 0 ("never banded" — no destination), and
    // Residency wrote no ref for such a card either, so this never fires on a
    // card that reached the copy.
    if (size === undefined || !(band > 0)) return undefined;
    const dpr = world.getResource(Viewport)?.dpr ?? 1;
    const zoom = world.getResource(Camera)?.zoom ?? 1;
    const kind = world.get(e, SurfaceKind)?.kind;
    return geometry({ w: size.w, h: size.h }, band, dpr, zoom, raster(kind === "gl" || kind === "video" ? kind : "dom"));
  };

  /**
   * The L1 host's box and placement — this module's, and only while the card
   * is canvas-side. `dom-widgets` skips canvas hosts deliberately (its
   * `updateGeometry` says so) and hands custody back on demotion by clearing
   * the transform and invalidating its own cache, so nothing writes these two
   * properties at once.
   *
   * The box is `geometry().cssSize` — band space under `band`, live-zoom space
   * under `crisp` — because that box times the L1 bitmap's scale IS what the
   * extent-less element copy writes. The placement matrix carries the rest:
   * `zoom / band` (∈ [0.5, 2] while hysteresis holds) and the camera's offset,
   * with `transform-origin: 0 0` so the scale and the translate compose the way
   * `planeCssTransform` composes them for the planes.
   *
   * Returns true when the BOX changed: the copy reads a paint record made at
   * the LAST layout, so a host resized this flush is copied on the next one.
   * "Changed" is asked of the element's own inline style, not of a cache that
   * starts empty — a host the dom reflector just created already carries the
   * right box in the common case (band space at band 1 IS world units), and a
   * cache miss there would cost every promotion a frame on the plate.
   */
  const placeHost = (e: Entity, el: HTMLElement, geo: SurfaceGeometry, guard: boolean): boolean => {
    const cam = world.getResource(Camera);
    const p = world.get(e, Position);
    const zoom = cam?.zoom ?? 1;
    const w = geo.cssSize.w;
    const h = geo.cssSize.h;
    const k = w > 0 ? geo.placement.w / w : 1;
    const tx = ((p?.x ?? 0) - (cam?.x ?? 0)) * zoom;
    const ty = ((p?.y ?? 0) - (cam?.y ?? 0)) * zoom;
    const prev = placed.get(e);
    if (prev !== undefined && prev.w === w && prev.h === h && prev.k === k && prev.tx === tx && prev.ty === ty) return false;
    // THE BOX STAYS THE WIDGET'S OWN (S4, 2026-09-23 — the band-space reflow owed since the first
    // report): a widget laid out in fixed pixels does not reflow into a smaller box, and a host
    // whose box WAS band space was copied as the widget's top-left corner at zoom < 1 (James's
    // live test). So the host keeps its world-unit box and CSS `zoom` scales it — with everything
    // inside it — to `cssSize`: the layout box the extent-less copy writes is band space still,
    // the paint record is the whole widget, smaller.
    const own = world.get(e, Size);
    const w0 = own !== undefined && own.w > 0 ? own.w : w;
    const h0 = own !== undefined && own.h > 0 ? own.h : h;
    const width = `${w0}px`;
    const height = `${h0}px`;
    const scale = w0 > 0 ? w / w0 : 1;
    const zoomCss = Math.abs(scale - 1) < 1e-6 ? "" : scale.toFixed(6);
    // Reading an INLINE style is a string lookup, never a layout read.
    const boxMoved = el.style.width !== width || el.style.height !== height || (el.style.zoom ?? "") !== zoomCss;
    if (boxMoved) {
      el.style.width = width;
      el.style.height = height;
      el.style.zoom = zoomCss;
      resized += 1;
    }
    el.style.transformOrigin = "0 0";
    // Blink ZOOMS a transform's translation (its lengths are computed under the element's own
    // `zoom`, so `matrix(k,0,0,k,tx,ty)` on a host at zoom z lands at z·tx, z·ty: a promoted host
    // at band 0.5 sat at half its screen offset — the hit, focus and caret truth of every
    // promoted card at zoom < 1, wrong; review, 2026-09-23). Written in unzoomed units, it lands
    // where the placement says; the scale k is a ratio and is not zoomed.
    const z = zoomCss === "" ? 1 : scale;
    el.style.transform = `matrix(${k},0,0,${k},${tx / z},${ty / z})`;
    placed.set(e, { w, h, k, tx, ty });
    // ARM THE GUARD only for a write the PLACEMENT PASS made — a card whose
    // pixels nobody asked for, moved because the camera moved. When `attempt`
    // writes, the same flush takes the copy anyway, and swallowing that write's
    // paint event would risk eating a real content edit in the one window where
    // content is most likely to be changing: the promotion the user just made.
    // The cost of not arming it there is at most one redundant copy per
    // promotion or resize, which the debt bookkeeping already absorbs.
    if (guard) selfWrote.set(el, flushes);
    return boxMoved;
  };

  /**
   * The page array, realised at the layer count the table publishes (Residency
   * writes it every tick from the allocator). GROWTH is D-B4.1: a bigger array,
   * every live layer copied into it in ONE encoder, one submit, then the new
   * array realised — the residency retires the old one at the next `collect`,
   * which the host runs after the frame's submit, so nothing is destroyed under
   * a command that reads it.
   */
  const ensurePages = (handle: TextureHandle, size: number, layers: number): GPUTexture | undefined => {
    const need = Math.max(1, layers);
    const current = residency.textureOf(handle);
    if (current === undefined) {
      const next = createPages(device, size, need);
      if (!residency.realize(handle, next)) { next.destroy(); return undefined; }
      pagesHandle = handle;
      pagesLayers = need;
      return next;
    }
    if (need <= current.depthOrArrayLayers) return current;
    const next = createPages(device, size, need);
    const encoder = device.createCommandEncoder({ label: "dom-render/pages growth" });
    for (let layer = 0; layer < current.depthOrArrayLayers; layer++) {
      encoder.copyTextureToTexture(
        { texture: current, origin: { x: 0, y: 0, z: layer } },
        { texture: next, origin: { x: 0, y: 0, z: layer } },
        { width: current.width, height: current.height, depthOrArrayLayers: 1 },
      );
    }
    device.queue.submit([encoder.finish()]);
    // Refused: the grown array is nobody's — destroy it, and copy NOTHING this flush (the old array lacks the layer the ref names).
    if (!residency.realize(handle, next)) { next.destroy(); return undefined; }
    growths += 1;
    pagesHandle = handle;
    pagesLayers = need;
    return next;
  };

  /** A Q10 oversize card's private destination: the same usage a page has, at a size no page can hold. */
  const ensureOwn = (handle: TextureHandle, width: number, height: number): GPUTexture | undefined => {
    const current = residency.textureOf(handle);
    if (current !== undefined) return current;
    const next = device.createTexture({
      label: "dom-render/own",
      size: [Math.max(1, width), Math.max(1, height)],
      format: "rgba8unorm",
      usage: PAGE_USAGE(),
    });
    if (!residency.realize(handle, next)) { next.destroy(); return undefined; }
    return next;
  };

  // ── the levers (the header) ────────────────────────────────────────────────
  const tuning = opts.tuning ?? {};
  const strategy = tuning.strategy ?? "element";
  const COSTS = { draw: tuning.costs?.draw ?? 0.1, canvasCopy: tuning.costs?.canvasCopy ?? 0.9, elementCopy: tuning.costs?.elementCopy ?? 0.58 };
  const draw: ElementDraw = opts.draw ?? ((ctx, el, x, y, w, h) => drawElementImage(ctx, el, x, y, w, h) !== undefined);
  const canvasCopy: CanvasCopy =
    opts.canvasCopy ??
    ((queue, canvas, src, texture, dst, size) => {
      queue.copyExternalImageToTexture(
        { source: canvas, origin: { x: src.x, y: src.y } },
        { texture, origin: { x: dst.x, y: dst.y, z: dst.z } },
        { width: size.w, height: size.h, depthOrArrayLayers: 1 },
      );
      return true;
    });
  const context2d = opts.context2d ?? ((canvas: HTMLCanvasElement) => canvas.getContext("2d"));
  const budgetOpt = tuning.budget;
  // ON BY DEFAULT (review, 2026-09-23): absent ⇒ the adaptive controller; `false` ⇒ none. Measured
  // the same day on the stress rig (gpu arm, 96 cards, every card animating): every animated phase
  // 23–58 fps → 117–120, p95 45–65 → 9–10 ms, the GPU process 108–171 % → 44–84 % of a core, the
  // pickup unchanged; each card refreshing ≈7 times a second at 96 (the S2 trade).
  const budgetOn = budgetOpt !== false;
  const budgetFixed = typeof budgetOpt === "number";
  const budgetMin = typeof budgetOpt === "object" ? (budgetOpt.min ?? 2) : 2;
  const budgetMax = typeof budgetOpt === "object" ? (budgetOpt.max ?? 256) : 256;
  let budget = !budgetOn ? Number.POSITIVE_INFINITY : budgetFixed ? budgetOpt : typeof budgetOpt === "object" ? (budgetOpt.start ?? 16) : 16;
  /** The controller's thresholds: the copies' main-thread wall per flush (ms). */
  const BUDGET_HIGH_MS = 3;
  const BUDGET_LOW_MS = 1;
  /**
   * The controller's SECOND signal (measured on the live app, 2026-09-09): the GPU process can
   * be saturated — the display compositor on its main thread presenting late — while the copy
   * calls do not yet block, because the ground's own per-frame submit shares that thread and
   * the command buffer has room. So the flush watches its own cadence: the inter-flush interval
   * against a running estimate of the display period (a minimum that decays upward slowly, so
   * it follows a 60 Hz or 120 Hz host and snaps to the fastest recent frame). A LATE flush is
   * one past 1.6 × that period; two late in the last three shrink the budget, and it grows only
   * after `CALM_FLUSHES` on-time flushes in a row, so it hovers just under the knee.
   */
  const LATE_FACTOR = 1.6;
  const CALM_FLUSHES = 4;
  /**
   * The FEED-FORWARD cap (measured 2026-09-09, the third revision): the copies' estimated
   * GPU-process time per flush is kept to `TARGET` of the frame period, and a late frame counts
   * against the budget only while that estimate is at least `LATE_GATE` of the period — a board
   * of 384 animating cards runs late on the main thread's own paint of the canvas children,
   * and a controller that read every late frame as the copies' fault starved them to the floor.
   */
  const TARGET = typeof budgetOpt === "object" && budgetOpt.target !== undefined && budgetOpt.target > 0 ? budgetOpt.target : 0.5;
  const LATE_GATE = 0.35;
  /** GPU-process ms per served card: the element copy's fixed cost, or a draw plus a tile's copy amortised over about eight cards. */
  const gpuMsPerCard = strategy === "batched" ? COSTS.draw + COSTS.canvasCopy / 8 : COSTS.elementCopy;
  let lastFlushT = Number.NaN;
  let periodEst = 50;
  let lateBits = 0;
  let calm = 0;
  let throttled = 0;
  let batches = 0;
  let draws = 0;
  let fallbacks = 0;
  let copyMs = 0;

  /** One served card, checked and addressed, waiting for its copy. */
  interface Job {
    readonly e: Entity;
    readonly el: HTMLElement;
    readonly texture: GPUTexture;
    readonly handle: TextureHandle;
    readonly origin: { readonly x: number; readonly y: number; readonly z: number };
    readonly dest: { readonly w: number; readonly h: number };
    /** The page side, for the neighbours' rects; 0 for an `own` destination. */
    readonly side: number;
    readonly still: boolean;
  }
  type Prepared = { readonly kind: "discharge" } | { readonly kind: "keep" } | { readonly kind: "ready"; readonly job: Job };
  const DISCHARGE: Prepared = { kind: "discharge" };
  const KEEP: Prepared = { kind: "keep" };

  /**
   * One card's checks, up to the copy. `discharge`: the debt is over without a copy (not on
   * the GPU, no destination, a producer's stable handle, an oversize refusal — the old
   * `attempt`'s `true` paths); `keep`: not this flush (no host yet, a box that moved, a
   * refused realisation, a backed-off one); `ready`: the job the strategy commits.
   */
  const prepare = (e: Entity, still: boolean): Prepared => {
    const table = residency.table;
    if (table === null) return KEEP;
    // Not on the GPU (a demotion): nothing to copy, and every side table of
    // this card goes with it — a later promotion starts clean.
    if (targetOf(world, e) !== "gpu") {
      forget(e);
      return DISCHARGE;
    }
    const ref = world.get(e, TextureRef);
    // No destination this frame (culled and unheld, or refused by the
    // allocator). Residency journals the ref it eventually writes, so the debt
    // comes back named rather than being carried blind.
    if (ref === undefined || ref.texture === NO_TEXTURE) return DISCHARGE;

    const el = hosts.hostOf(e);
    if (el === undefined) return KEEP; // not hosted yet — keep the debt
    const geo = geometryOf(e);
    if (geo === undefined) return KEEP;
    if (placeHost(e, el, geo, false)) return KEEP; // the box moved: copy on the next flush, off the new paint record

    const entry = table.describe(ref.texture);
    if (entry === undefined) return KEEP;
    // BACKED OFF (D-C4.7): the table refused this destination's realisation and nothing that
    // decides the answer has moved. Keep the debt, mint nothing.
    const back = refusedRealize.get(e);
    if (back !== undefined) {
      if (back.handle === ref.texture && back.revision === residency.revision()) { backedOff += 1; return KEEP; }
      refusedRealize.delete(e);
    }
    let texture: GPUTexture | undefined;
    let origin: { x: number; y: number; z: number };
    let dest: { w: number; h: number };
    let side = 0;
    if (entry.kind === "pages") {
      texture = ensurePages(ref.texture, entry.size, entry.layers);
      // The written rect's origin in texels: the uv Residency derived from the
      // allocator's rect over the layer's side, read back through that side.
      origin = { x: Math.round(ref.u0 * entry.size), y: Math.round(ref.v0 * entry.size), z: ref.layer };
      dest = { w: Math.round((ref.u1 - ref.u0) * entry.size), h: Math.round((ref.v1 - ref.v0) * entry.size) };
      side = entry.size;
    } else if (entry.kind === "own") {
      texture = ensureOwn(ref.texture, entry.width, entry.height);
      origin = { x: 0, y: 0, z: 0 };
      dest = { w: entry.width, h: entry.height };
    } else {
      return DISCHARGE; // a `stable` handle is a video producer's (B6), never copied from a host
    }
    // The realisation was refused (all three paths above destroy what they minted): remember the
    // destination and the revision, so the next flushes cost nothing until one of them moves.
    if (texture === undefined) {
      refusedRealize.set(e, { handle: ref.texture, revision: residency.revision() });
      return KEEP;
    }
    if (geo.written.w > dest.w || geo.written.h > dest.h) {
      oversize += 1;
      // NOT claimed — and any STANDING claim is dropped (D-C4.7). A card that copied once and then
      // grew past its destination inside the same band keeps its ref (`ownFor` clamps to the same
      // numbers and `writeRef` early-returns), so the old write would stand and the card would draw
      // the stale raster STRETCHED. It draws its plate instead, which is honest.
      residency.unwrote(e);
      return DISCHARGE; // refused: the copy would run past the destination's edge
    }
    return { kind: "ready", job: { e, el, texture, handle: ref.texture, origin, dest, side, still } };
  };

  /** A job's pixels landed: the card draws from its destination now. */
  const landed = (job: Job, t: number): void => {
    copies += 1;
    lastCopy.set(job.e, t);
    residency.wrote(job.e); // the card draws from its destination now — and this touches, so the ground redraws
    if (job.still && residency.isWritten(job.e)) stills += 1;
    dirty.delete(job.e);
    worldDebt.delete(job.e);
  };

  /** The element route: one HiC copy for one card. A refusal keeps the debt. */
  const commitElement = (job: Job, t: number): void => {
    try {
      if (!copy(device.queue, job.el, job.texture, job.origin)) {
        unavailable += 1; // no method: the trial is absent, and no retry will find one
        return;
      }
    } catch {
      // `InvalidStateError: No cached paint record for element` — the frame
      // after a promotion, before the host has been painted once. Counted and
      // retried; never propagated, or one unrecorded card throws away the
      // whole frame (the old atlas's lesson, `compositor/dom-atlas.ts`).
      refused += 1;
      return;
    }
    landed(job, t);
  };

  /**
   * The batched route for the jobs of ONE page layer (the header): tiles cut to the canvas's
   * bitmap at slot boundaries, each drawn and landed with one copy. Returns the jobs that must
   * fall back to element copies.
   */
  const batchLayer = (group: readonly Job[], canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, t: number): Job[] => {
    const W = canvas.width;
    const H = canvas.height;
    const first = group[0];
    if (first === undefined) return [];
    const { handle, texture, side } = first;
    const z = first.origin.z;
    const fallback: Job[] = [];
    // A card the bitmap cannot hold takes the element route.
    const fit = group.filter((j) => {
      const ok = j.dest.w > 0 && j.dest.h > 0 && j.dest.w <= W && j.dest.h <= H;
      if (!ok) fallback.push(j);
      return ok;
    });
    // Bands by y (≤ H tall), tiles by x within a band (≤ W wide): every tile's box fits the bitmap.
    fit.sort((a, b) => a.origin.y - b.origin.y || a.origin.x - b.origin.x);
    const bands: Job[][] = [];
    let band: Job[] = [];
    let top = 0;
    for (const j of fit) {
      if (band.length > 0 && j.origin.y + j.dest.h <= top + H) { band.push(j); continue; }
      top = j.origin.y;
      band = [j];
      bands.push(band);
    }
    const tiles: Job[][] = [];
    for (const b of bands) {
      b.sort((a, c) => a.origin.x - c.origin.x);
      let tile: Job[] = [];
      let left = 0;
      for (const j of b) {
        if (tile.length > 0 && j.origin.x + j.dest.w <= left + W) { tile.push(j); continue; }
        left = j.origin.x;
        tile = [j];
        tiles.push(tile);
      }
    }
    for (const tile of tiles) {
      let x0 = Number.POSITIVE_INFINITY;
      let y0 = Number.POSITIVE_INFINITY;
      let x1 = Number.NEGATIVE_INFINITY;
      let y1 = Number.NEGATIVE_INFINITY;
      for (const j of tile) {
        if (j.origin.x < x0) x0 = j.origin.x;
        if (j.origin.y < y0) y0 = j.origin.y;
        if (j.origin.x + j.dest.w > x1) x1 = j.origin.x + j.dest.w;
        if (j.origin.y + j.dest.h > y1) y1 = j.origin.y + j.dest.h;
      }
      // The tile's copy overwrites every slot in its box: the WRITTEN residents of this layer whose
      // slots intersect it are drawn too, or they would lose their picture. An unwritten slot is
      // never sampled and may be overwritten. A written resident with no host cannot be drawn —
      // the tile is not safe, and its cards take the element route.
      const served = new Set<Entity>();
      for (const j of tile) served.add(j.e);
      const extras: { e: Entity; el: HTMLElement; x: number; y: number; w: number; h: number }[] = [];
      let unsafe = false;
      for (const e of placed.keys()) {
        if (served.has(e)) continue;
        const ref = world.get(e, TextureRef);
        if (ref === undefined || ref.texture !== handle || ref.layer !== z) continue;
        const rx = Math.round(ref.u0 * side);
        const ry = Math.round(ref.v0 * side);
        const rw = Math.round((ref.u1 - ref.u0) * side);
        const rh = Math.round((ref.v1 - ref.v0) * side);
        if (rx >= x1 || rx + rw <= x0 || ry >= y1 || ry + rh <= y0) continue; // disjoint
        if (!residency.isWritten(e)) continue;
        const el = hosts.hostOf(e);
        if (el === undefined) { unsafe = true; break; }
        extras.push({ e, el, x: rx, y: ry, w: rw, h: rh });
      }
      if (unsafe || (tile.length + extras.length) * COSTS.draw + COSTS.canvasCopy >= tile.length * COSTS.elementCopy) {
        fallbacks += 1;
        fallback.push(...tile);
        continue;
      }
      const bw = x1 - x0;
      const bh = y1 - y0;
      let ok = true;
      let drawn = 0;
      try {
        for (const j of tile) {
          ctx.clearRect(j.origin.x - x0, j.origin.y - y0, j.dest.w, j.dest.h);
          if (!draw(ctx, j.el, j.origin.x - x0, j.origin.y - y0, j.dest.w, j.dest.h)) { ok = false; break; }
          drawn += 1;
        }
        if (ok) {
          for (const x of extras) {
            ctx.clearRect(x.x - x0, x.y - y0, x.w, x.h);
            if (!draw(ctx, x.el, x.x - x0, x.y - y0, x.w, x.h)) { ok = false; break; }
            drawn += 1;
          }
        }
      } catch {
        ok = false; // a host without a paint record yet: the tile is discarded, its cards retried per card
      }
      draws += drawn;
      if (!ok) {
        ctx.clearRect(0, 0, bw, bh);
        fallbacks += 1;
        fallback.push(...tile);
        continue;
      }
      let copied = false;
      try {
        copied = canvasCopy(device.queue, canvas, { x: 0, y: 0 }, texture, { x: x0, y: y0, z }, { w: bw, h: bh });
      } catch {
        copied = false;
      }
      // The copy snapshotted the canvas at the call: the staging is cleared so the canvas presents nothing.
      ctx.clearRect(0, 0, bw, bh);
      if (!copied) {
        fallbacks += 1;
        fallback.push(...tile);
        continue;
      }
      batches += 1;
      for (const j of tile) landed(j, t);
      for (const x of extras) {
        // A fresh picture, for free: whatever it owed is paid.
        lastCopy.set(x.e, t);
        deferred.delete(x.e);
        dirty.delete(x.e);
        worldDebt.delete(x.e);
        residency.wrote(x.e);
      }
    }
    return fallback;
  };

  /** The batched route over every served job: page jobs grouped by layer, `own` jobs and singles per card. */
  const commitBatched = (jobs: readonly Job[], t: number): void => {
    const groups = new Map<string, Job[]>();
    const rest: Job[] = [];
    for (const j of jobs) {
      if (j.side === 0) { rest.push(j); continue; }
      const k = `${j.handle}|${j.origin.z}`;
      let g = groups.get(k);
      if (g === undefined) { g = []; groups.set(k, g); }
      g.push(j);
    }
    for (const g of groups.values()) {
      const first = g[0];
      if (g.length < 2 || first === undefined) { rest.push(...g); continue; }
      const parent = first.el.parentElement as HTMLCanvasElement | null;
      const canvas = parent !== null && typeof parent.width === "number" && typeof parent.height === "number" ? parent : null;
      const ctx = canvas === null ? null : context2d(canvas);
      if (canvas === null || ctx === null) { rest.push(...g); continue; }
      rest.push(...batchLayer(g, canvas, ctx, t));
    }
    for (const j of rest) commitElement(j, t);
  };

  return {
    name: "dom-render",
    markDirtyHosts(elements) {
      for (const el of elements) {
        const e = entityOfHost(el);
        if (e === undefined) continue;
        dirtied += 1;
        // A paint event this module's own placement write caused. Counted (it
        // is real dirt on the wire) and dropped: the camera moving is not the
        // card changing, and without this a pan re-uploads the whole promoted
        // board every frame. A BOX change is not lost with it — the placement
        // pass adds that debt itself, by hand.
        const wroteAt = selfWrote.get(el);
        if (wroteAt !== undefined) {
          selfWrote.delete(el);
          if (flushes - wroteAt <= 1) {
            selfDirt += 1;
            continue;
          }
        }
        dirty.add(e);
      }
    },
    flush() {
      if (disposed || residency.table === null) return;
      flushes += 1;
      // The world's half of the debt, drained every flush (the journal is
      // pull-based, so a frame that skips this would lose the record).
      const delta = collector.drain();
      for (const e of delta.removed) forget(e);
      for (const e of delta.changed) {
        if (targetOf(world, e) === "gpu") {
          dirty.add(e);
          worldDebt.add(e);
        } else forget(e);
      }
      // Nothing else scans the board for unwritten destinations: `TextureRef`
      // is written CHANGE-ONLY, so every new debt — a promotion, a re-slot
      // after an eviction, a re-size — arrives through that journal, named.
      const t = now();
      // The cadence signal (the controller's second signal, above).
      const dt = Number.isFinite(lastFlushT) ? t - lastFlushT : Number.NaN;
      lastFlushT = t;
      if (dt > 0) {
        periodEst = Math.min(dt, periodEst + 0.25);
        const late = dt > periodEst * LATE_FACTOR;
        lateBits = ((lateBits << 1) | (late ? 1 : 0)) & 0b111;
        calm = late ? 0 : calm + 1;
      }
      if (parked.size > 0) {
        for (const e of [...parked]) {
          // The ONLY door out of parked: demand came back to a live bucket.
          if (demandIntervalMs(demandOf(world, e)) === Number.POSITIVE_INFINITY) continue;
          parked.delete(e);
          dirty.add(e);
        }
      }
      if (deferred.size > 0) {
        for (const [e, due] of [...deferred]) {
          if (t < due) continue;
          deferred.delete(e);
          dirty.add(e);
        }
      }
      if (dirty.size > 0) {
        // THE QUEUE: the stills first (a gesture's pickup), then the live cards, each in the dirty
        // set's own order — FIFO, because a served card is deleted and re-added at the back by its
        // next paint mark, behind every card still waiting (the budget's fairness, the header).
        const stillQueue: Entity[] = [];
        const liveQueue: Entity[] = [];
        for (const e of [...dirty]) {
          const interval = demandIntervalMs(demandOf(world, e));
          if (interval === Number.POSITIVE_INFINITY) {
            // PAUSED. A paint mark buys nothing; the card parks. The one exception is the
            // STILL: the world named a destination this card has never written (a promotion,
            // a re-slot, a re-size) and the picture it owes is the first one, taken once and
            // then held — see the header. A refusal keeps the debt for the next flush, as it
            // does for a live card.
            if (worldDebt.has(e) && !residency.isWritten(e)) { stillQueue.push(e); continue; }
            dirty.delete(e);
            parked.add(e);
            continue;
          }
          if (interval !== 0) {
            const since = t - (lastCopy.get(e) ?? Number.NEGATIVE_INFINITY);
            if (since < interval) {
              dirty.delete(e);
              deferred.set(e, t + (interval - since));
              continue;
            }
          }
          liveQueue.push(e);
        }
        const queued = stillQueue.length + liveQueue.length;
        // The feed-forward cap, once the cadence is known (the estimate starts high and snaps down).
        const capByPeriod = Math.max(budgetMin, Math.min(budgetMax, Math.floor((periodEst * TARGET) / gpuMsPerCard)));
        if (budgetOn && !budgetFixed && budget > capByPeriod) budget = capByPeriod;
        const cap = Math.max(0, Math.floor(budget));
        const jobs: Job[] = [];
        let served = 0;
        const take = (list: readonly Entity[], still: boolean): void => {
          for (const e of list) {
            if (served >= cap) return;
            served += 1;
            const p = prepare(e, still);
            if (p.kind === "discharge") {
              dirty.delete(e);
              worldDebt.delete(e);
            } else if (p.kind === "ready") jobs.push(p.job);
            // `keep`: the debt stays in the set, in its place
          }
        };
        take(stillQueue, true);
        take(liveQueue, false);
        throttled += queued - served;
        const t0 = now();
        if (strategy === "batched") commitBatched(jobs, t);
        else for (const j of jobs) commitElement(j, t);
        const spent = now() - t0;
        copyMs += spent;
        // THE CONTROLLER (the header): the copies' main-thread wall per flush is the first
        // saturation signal — ten times its unsaturated value once the GPU process is behind and
        // the calls block in flow control — and a late flush cadence the second (above). Shrink
        // hard on either, grow by one only after a calm run while cards were waiting.
        // Runs for ANY served count: a guard of "enough samples" here trapped the budget at its floor
        // (measured 2026-09-09 — the mount's burst shrank it below the guard, and nothing could grow it).
        if (budgetOn && !budgetFixed && served > 0) {
          const lateCount = (lateBits & 1) + ((lateBits >> 1) & 1) + ((lateBits >> 2) & 1);
          const estimate = served * gpuMsPerCard;
          if (spent > BUDGET_HIGH_MS || (lateCount >= 2 && estimate >= LATE_GATE * periodEst)) budget = Math.max(budgetMin, Math.floor(budget * 0.7));
          else if (spent < BUDGET_LOW_MS && queued > served && lateCount === 0 && calm >= CALM_FLUSHES) budget = Math.min(capByPeriod, budget + 1);
        }
      }
      // PLACEMENT IS NOT A FUNCTION OF THE COPY DEBT (B8 R7).
      //
      // Until B8 `placeHost` was reached only through `attempt`, so a card that
      // owed nothing was never re-placed and its host stayed where the last
      // copy left it. Nothing LOOKS wrong — an L1 host is never painted — but
      // the host IS the hit-test, focus, caret and IME truth for a promoted
      // card, so a pan walks it off the card it belongs to. The ported `input`
      // rig measured it before this pass existed: 7 of 24 mid-gesture hits
      // landed, the host up to 540 px from its card.
      //
      // Runs LAST so the commit has already placed everything that copied. The
      // write is change-only against `placed`, so an idle board writes nothing
      // and idle-zero is untouched; a pan costs one style write per promoted
      // host, which is what the old leg's `dom-writeback` paid for the same
      // truth. A BOX change found here owes a fresh copy — off the paint record
      // the NEXT layout makes, never this one's.
      for (const e of placed.keys()) {
        const el = hosts.hostOf(e);
        if (el === undefined) continue;
        const geo = geometryOf(e);
        if (geo === undefined) continue;
        if (placeHost(e, el, geo, true)) dirty.add(e);
      }
    },
    stats: () => ({
      copies,
      stills,
      dirtied,
      selfDirt,
      refused,
      unavailable,
      oversize,
      backedOff,
      parked: parked.size,
      deferred: deferred.size,
      pending: dirty.size + deferred.size,
      resized,
      pagesLayers: residency.textureOf(pagesHandle) === undefined ? 0 : pagesLayers,
      growths,
      budget,
      throttled,
      batches,
      draws,
      fallbacks,
      copyMs,
    }),
    dispose() {
      disposed = true;
      collector.dispose();
      dirty.clear();
      deferred.clear();
      parked.clear();
      lastCopy.clear();
      placed.clear();
      selfWrote.clear();
      refusedRealize.clear();
      worldDebt.clear();
    },
  };
}
