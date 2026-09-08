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
//   the host's CSS box  := geometry().cssSize      (this file writes it)
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
// allows, so a throttled card is BEHIND, never wrong; 0 copies now. A paused
// card that has never been copied stays on the plate, and that is honest —
// the plate is a real picture of a card with no pixels yet.
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
import { copyElementToTexture } from "../hic-adapter";
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
}

export interface DomRenderStats {
  /** Element copies that landed. */
  readonly copies: number;
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
    lastCopy.delete(e);
    placed.delete(e);
    refusedRealize.delete(e);
    const el = hosts.hostOf(e);
    if (el !== undefined) selfWrote.delete(el);
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
    const width = `${w}px`;
    const height = `${h}px`;
    // Reading an INLINE style is a string lookup, never a layout read.
    const boxMoved = el.style.width !== width || el.style.height !== height;
    if (boxMoved) {
      el.style.width = width;
      el.style.height = height;
      resized += 1;
    }
    el.style.transformOrigin = "0 0";
    el.style.transform = `matrix(${k},0,0,${k},${tx},${ty})`;
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

  /**
   * One card's copy attempt. Returns whether the debt is DISCHARGED — a
   * refusal, a missing host or a resize keeps it, because a card that owes a
   * copy and forgets it is a card that shows the plate for good.
   */
  const attempt = (e: Entity, t: number): boolean => {
    const table = residency.table;
    if (table === null) return false;
    // Not on the GPU (a demotion): nothing to copy, and every side table of
    // this card goes with it — a later promotion starts clean.
    if (targetOf(world, e) !== "gpu") {
      forget(e);
      return true;
    }
    const ref = world.get(e, TextureRef);
    // No destination this frame (culled and unheld, or refused by the
    // allocator). Residency journals the ref it eventually writes, so the debt
    // comes back named rather than being carried blind.
    if (ref === undefined || ref.texture === NO_TEXTURE) return true;

    const el = hosts.hostOf(e);
    if (el === undefined) return false; // not hosted yet — keep the debt
    const geo = geometryOf(e);
    if (geo === undefined) return false;
    if (placeHost(e, el, geo, false)) return false; // the box moved: copy on the next flush, off the new paint record

    const entry = table.describe(ref.texture);
    if (entry === undefined) return false;
    // BACKED OFF (D-C4.7): the table refused this destination's realisation and nothing that
    // decides the answer has moved. Keep the debt, mint nothing.
    const back = refusedRealize.get(e);
    if (back !== undefined) {
      if (back.handle === ref.texture && back.revision === residency.revision()) { backedOff += 1; return false; }
      refusedRealize.delete(e);
    }
    let texture: GPUTexture | undefined;
    let origin: { x: number; y: number; z: number };
    let dest: { w: number; h: number };
    if (entry.kind === "pages") {
      texture = ensurePages(ref.texture, entry.size, entry.layers);
      // The written rect's origin in texels: the uv Residency derived from the
      // allocator's rect over the layer's side, read back through that side.
      origin = { x: Math.round(ref.u0 * entry.size), y: Math.round(ref.v0 * entry.size), z: ref.layer };
      dest = { w: Math.round((ref.u1 - ref.u0) * entry.size), h: Math.round((ref.v1 - ref.v0) * entry.size) };
    } else if (entry.kind === "own") {
      texture = ensureOwn(ref.texture, entry.width, entry.height);
      origin = { x: 0, y: 0, z: 0 };
      dest = { w: entry.width, h: entry.height };
    } else {
      return true; // a `stable` handle is a video producer's (B6), never copied from a host
    }
    // The realisation was refused (all three paths above destroy what they minted): remember the
    // destination and the revision, so the next flushes cost nothing until one of them moves.
    if (texture === undefined) {
      refusedRealize.set(e, { handle: ref.texture, revision: residency.revision() });
      return false;
    }
    if (geo.written.w > dest.w || geo.written.h > dest.h) {
      oversize += 1;
      // NOT claimed — and any STANDING claim is dropped (D-C4.7). A card that copied once and then
      // grew past its destination inside the same band keeps its ref (`ownFor` clamps to the same
      // numbers and `writeRef` early-returns), so the old write would stand and the card would draw
      // the stale raster STRETCHED. It draws its plate instead, which is honest.
      residency.unwrote(e);
      return true; // refused: the copy would run past the destination's edge
    }

    try {
      if (!copy(device.queue, el, texture, origin)) {
        unavailable += 1; // no method: the trial is absent, and no retry will find one
        return false;
      }
    } catch {
      // `InvalidStateError: No cached paint record for element` — the frame
      // after a promotion, before the host has been painted once. Counted and
      // retried; never propagated, or one unrecorded card throws away the
      // whole frame (the old atlas's lesson, `compositor/dom-atlas.ts`).
      refused += 1;
      return false;
    }
    copies += 1;
    lastCopy.set(e, t);
    residency.wrote(e); // the card draws from its destination now — and this touches, so the ground redraws
    return true;
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
        if (targetOf(world, e) === "gpu") dirty.add(e);
        else forget(e);
      }
      // Nothing else scans the board for unwritten destinations: `TextureRef`
      // is written CHANGE-ONLY, so every new debt — a promotion, a re-slot
      // after an eviction, a re-size — arrives through that journal, named.
      const t = now();
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
        for (const e of [...dirty]) {
          const interval = demandIntervalMs(demandOf(world, e));
          if (interval === Number.POSITIVE_INFINITY) {
            // PAUSED. No copy and no wake — and a card that has never been
            // copied stays on the plate, which is the honest picture of a
            // paused card with no pixels yet (design-013 D3).
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
          if (attempt(e, t)) dirty.delete(e);
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
      // Runs LAST so `attempt` has already placed everything that copied. The
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
    },
  };
}
