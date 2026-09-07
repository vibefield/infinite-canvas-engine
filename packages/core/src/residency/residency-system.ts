/**
 * Residency (infra) — the ONE writer of `TextureRef` (design-013 §5, §6 step 4;
 * the implementation plan's A2 item 3).
 *
 * Band said which resolution a card is held at; Demand said how often it may
 * repaint. This says WHERE its pixels go — an atlas slot, a private texture, a
 * producer's registered one, or nowhere — and it is the last of the three infra
 * systems in `present:infra`, after every kind behaviour has spoken.
 *
 * ── The invariant (§6.4), which the property test states verbatim ──────────
 *
 *   `TextureRef.texture ≠ 0`  ⇔  `effectiveTarget(kind, target) === "gpu"`
 *                                ∧ `band > 0`
 *                                ∧ a destination is held for `(entity, band)`
 *
 * A dom card presenting on the DOM holds none. A card at band 0 holds none —
 * "never banded" is the equip default and `geometry()` throws on it, so the
 * gate here is what keeps that throw unreachable in production.
 *
 * ── Allocation, per kind ───────────────────────────────────────────────────
 *  - **dom** — an atlas slot at `geometry(size, band, dpr, zoom, raster).slotSize`,
 *    keyed `(entity, band)`. A slot too big for a layer (`!fits`) takes a
 *    PRIVATE texture instead (§9 Q10's oversize rule): the compose pass does not
 *    distinguish, so nothing is clamped and nothing is refused.
 *  - **gl** — always private, at `geometry().rasterSize`: an island renders into
 *    its own target and has nothing to share a page with.
 *  - **video** — the producer's registered stable handle (§9 Q5), or 0 until it
 *    registers. Residency allocates nothing for it and sizes nothing: the
 *    texture is the producer's, and `geometry()` is never called.
 *
 * ── Per-band retention, and the two doors ──────────────────────────────────
 * A band crossing does NOT free the old band's key. That IS the retention (§2):
 * the old slot goes cold and a zoom back is a HIT, no allocation and no write.
 * What frees a cold key is the LRU, under the byte budget, and it never takes a
 * key whose entity is `Visible` or `Retained` — `Retained` being the one tag
 * that replaced both pools' pin refcounts (§4).
 *
 * The MEMORY door opens on two triggers, not one. The budget loop retires
 * emptied layers as it evicts — and by itself that is a door that never opens
 * at rest: `createResidencyStore` derives `maxLayers` from the budget, so a
 * full atlas is exactly at the budget and never above it (sixteen 16 MB layers
 * under 256 MB), and an idle board whose cards all demote would hold every
 * empty layer for the session. So a body run that gave a slot BACK also calls
 * `retireEmpty()` once, after the walk. A demoted board costs nothing, which is
 * what "an empty atlas should cost nothing" (the allocator's header) has to
 * mean for a board that emptied without ever being over budget.
 *
 * Heat has exactly one writer — the touch pass, which stamps every held key
 * whose entity is `Visible`. A re-place is NOT a use: re-stamping there would
 * make the heat "when residency last looked at this key" rather than "when this
 * card was last on screen", and would quietly shadow the mechanism entirely.
 *
 * Bytes are counted the way the platform charges them, not the way the rects
 * add up: a layer costs `layerSize² × bytesPerPixel` from its FIRST allocation,
 * because a texture is lazily backed and commits in full on first write
 * (hic-bench FINDINGS §6). So freeing scattered slots reclaims nothing until a
 * layer empties, and `retireEmpty()` — the memory door — is what actually
 * returns memory. Private textures cost their own area.
 *
 * ── Two references per destination, on purpose ─────────────────────────────
 * A private texture is retained TWICE while it is in use: once by the residency
 * key that holds it, and once by the `TextureRef` that names it. They are
 * genuinely different holders with different lifetimes — a band crossing moves
 * the `TextureRef` to the new band's destination while the old key stays
 * resident and cold, and without the key's own reference the old texture would
 * drain and be destroyed underneath a card that is one zoom step from wanting
 * it back.
 *
 * ── When the budget cannot be met ──────────────────────────────────────────
 * If every layer is full and every key belongs to a Visible or Retained entity,
 * `allocate` returns null, there is nothing to evict, and the card gets
 * `texture = 0` for this frame — no destination, retried on the next change.
 * That is an honest degraded state; the alternative (minting a private texture
 * for a card the budget already cannot afford) would answer the budget by
 * exceeding it.
 *
 * ── The device ceiling (D11, ruled at the Phase A review) ──────────────────
 * §9 Q10 covers whether a slot FITS A LAYER; it says nothing about whether the
 * destination can exist at all. Under the `band` strategy `geometry()` asks for
 * `size × band × dpr`, and a 2000-unit card at band 16 on a dpr-2 display asks
 * for 64,000² — past `maxTextureDimension2D` on every adapter there is, and 16
 * GB in `committedBytes()` for a texture no device would create. So an `own`
 * request larger than {@link ResidencySystemOptions.maxTextureSize} on either
 * axis is CLAMPED, and the budget counts the clamped size.
 *
 * Clamped UNIFORMLY, never per-axis — the old binder's `clampToPage` rule
 * (`ground/src/compositor/dom-source-binder.ts`), for its reason: the compose
 * pass maps the whole texture onto the card's rect, so a per-axis clamp would
 * SQUASH a wide card's picture while a uniform one only lowers its resolution.
 * The default, 8192, is the floor `maxTextureDimension2D` is guaranteed to
 * reach on every WebGPU adapter (the `DEFAULT_MAX_PAGE_SIZE` precedent, from the
 * old leg's `ground/src/atlas-allocator.ts` — deleted at B8, the number kept);
 * a profile that has queried its real adapter
 * limit should pass it. B5/B6 may replace the clamp with a TILED destination if
 * a rig shows the resolution loss matters — the clamp is the honest floor until
 * one does, not the final answer.
 *
 * ── The gate ───────────────────────────────────────────────────────────────
 * A real `runIf` over the churn guard, never a body early-out: this system
 * declares `access.write`, and strata blanket-stamps a declared write for any
 * system that RUNS. Unlike Band, residency DOES subscribe to `Size` — a resize
 * changes `slotSize` at an unchanged band, which is exactly a re-slot. `extra`
 * fires on a `Viewport.dpr` change, and additionally on a `Camera.zoom` change
 * when any kind rasters `crisp`, whose `slotSize` is a function of the live
 * zoom (under the default `band` strategy it is not, and a pan or a zoom inside
 * a band must not wake this system at all).
 *
 * It also fires on the TABLE's revision. A producer calling `table.register`
 * changes no cell and no tag, so nothing journals it — the video card whose
 * destination has just appeared would sit at `texture = 0` until an unrelated
 * write happened to wake the walk (§9 Q5's door opens from OUTSIDE the world).
 * Comparing `table.revision()` is how it is noticed. The death pass's own
 * `unregister` bumps it too, so a despawned video surface costs one extra full
 * walk on the following frame — a walk that writes nothing, and the price of
 * one number instead of a second journal.
 */
import { geometry, ZOOM_BANDS, type RasterStrategy } from "@ice/kernel";
import type { Entity, SystemCtx, TickSystem, World } from "@vibecook/strata-ecs";
import { defineQuery, defineTickSystem } from "@vibecook/strata-ecs";
import { Camera, Culled, Viewport, Visible } from "../catalog/camera-derived";
import { Size } from "../catalog/scene";
import {
  effectiveTarget,
  NO_TEXTURE,
  Retained,
  SurfaceBand,
  SurfaceKind,
  SurfaceTarget,
  TextureRef,
} from "../catalog/surface";
import { makeChurnGuard } from "../helpers/churn-guard";
import { createLayerAllocator, packKey, type LayerAllocator, type ResidencyKey } from "./layer-allocator";
import { createTextureTable, type TextureHandle, type TextureTable } from "./texture-table";

/** RGBA8 — the atlas format, and the only one anything here counts in. */
export const DEFAULT_BYTES_PER_PIXEL = 4;

/**
 * 256 MB. STILL A PLACEHOLDER (Phase B closed without measuring it — the B3 rigs
 * witnessed pixels, not pressure): the number a Phase C residency-pressure rig
 * replaces with a measured one. At the default 2048² layer it is sixteen layers.
 */
export const DEFAULT_RESIDENCY_BUDGET_BYTES = 256 * 1024 * 1024;

/**
 * The largest `own` texture either axis may ask for, in device px (D11). 8192
 * is the floor `maxTextureDimension2D` is guaranteed to reach on every WebGPU
 * adapter — the same number and the same reason as `DEFAULT_MAX_PAGE_SIZE` in
 * the old leg's `ground/src/atlas-allocator.ts` (deleted at B8). A profile that
 * has queried its real adapter
 * limit should pass it instead.
 */
export const DEFAULT_MAX_TEXTURE_SIZE = 8192;

type SurfaceKindLabel = "dom" | "gl" | "video";
const KINDS: readonly SurfaceKindLabel[] = ["dom", "gl", "video"];

/**
 * Hold a request inside what a device can actually create, scaled UNIFORMLY —
 * the old binder's `clampToPage` rule (`dom-source-binder.ts`) and its reason:
 * the compose pass maps the WHOLE texture onto the card's rect, so a per-axis
 * clamp squashes the picture while a uniform one only lowers its resolution,
 * which is what a card past the device limit has to give up.
 */
function clampToDevice(
  width: number,
  height: number,
  maxSide: number,
): { readonly width: number; readonly height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width, height };
  const k = maxSide / longest;
  return { width: Math.max(1, Math.floor(width * k)), height: Math.max(1, Math.floor(height * k)) };
}

export interface ResidencySystemOptions {
  readonly table: TextureTable;
  readonly allocator: LayerAllocator;
  /** Evict cold keys until committed bytes fit. Default {@link DEFAULT_RESIDENCY_BUDGET_BYTES}. */
  readonly budgetBytes?: number;
  readonly bytesPerPixel?: number;
  /**
   * Device ceiling for an `own` texture, per axis, in device px (D11). Default
   * {@link DEFAULT_MAX_TEXTURE_SIZE}. A larger request is scaled down
   * uniformly and the budget counts the clamped size — see the header.
   */
  readonly maxTextureSize?: number;
  /**
   * LRU heat. Defaults to a per-run counter rather than a wall clock: the LRU
   * needs an ORDER, not a time, and a counter is monotonic by construction and
   * deterministic in a test. Inject a real clock if you want heat comparable
   * across systems.
   */
  readonly now?: () => number;
  /** The kind's raster strategy. Default `band` (§9 Q1). B gives it a `defineWidget` field. */
  readonly raster?: (kind: SurfaceKindLabel) => RasterStrategy;
}

/** What a held key owns. `own === 0` means the destination is an atlas slot. */
interface HeldSlot {
  readonly entity: Entity;
  readonly band: number;
  /** Device px — the budget's unit for a private texture. */
  readonly width: number;
  readonly height: number;
  readonly own: TextureHandle;
  lastUsedMs: number;
}

interface RefValue {
  readonly texture: number;
  readonly layer: number;
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
}

const NO_DESTINATION: RefValue = { texture: NO_TEXTURE, layer: 0, u0: 0, v0: 0, u1: 0, v1: 0 };
/** A whole private or registered texture — the uv is the unit square. */
const WHOLE: Omit<RefValue, "texture" | "layer"> = { u0: 0, v0: 0, u1: 1, v1: 1 };

const residentQ = defineQuery([SurfaceKind, SurfaceTarget, SurfaceBand, TextureRef, Size]);

export function createResidencySystem(world: World, opts: ResidencySystemOptions): TickSystem {
  const { table, allocator } = opts;
  const budgetBytes = opts.budgetBytes ?? DEFAULT_RESIDENCY_BUDGET_BYTES;
  const bytesPerPixel = opts.bytesPerPixel ?? DEFAULT_BYTES_PER_PIXEL;
  const maxTextureSize = opts.maxTextureSize ?? DEFAULT_MAX_TEXTURE_SIZE;
  const raster = opts.raster ?? ((): RasterStrategy => "band");
  const layerBytes = allocator.layerSize * allocator.layerSize * bytesPerPixel;

  let frame = 0;
  const now = opts.now ?? ((): number => frame);

  const held = new Map<ResidencyKey, HeldSlot>();
  /**
   * The handle each entity's `TextureRef` currently names. `writeRef` is the
   * only writer of that component, so this cannot drift from it — and it is
   * needed for exactly one path: DEATH. A destroyed entity's components are
   * already gone, so the reference its ref held could never be given back by
   * reading it, and the handle would be pinned for the session's life.
   */
  const refHandle = new Map<Entity, TextureHandle>();

  // A `crisp` kind's slotSize is a function of the LIVE zoom, so it must re-slot
  // on a zoom step. A `band` kind's is not, and waking every zoom frame for the
  // whole board is exactly the churn §3 forbids — so the subscription is taken
  // only when a strategy actually needs it.
  const zoomMatters = KINDS.some((k) => raster(k) === "crisp");

  let lastDpr: number | undefined;
  let lastZoom: number | undefined;
  let lastRevision: number | undefined;
  const guard = makeChurnGuard(
    world,
    {
      components: [SurfaceKind, SurfaceTarget, SurfaceBand, Size],
      tags: [Visible, Culled, Retained],
      coarse: false,
    },
    () => {
      const dpr = world.getResource(Viewport)?.dpr;
      const zoom = world.getResource(Camera)?.zoom;
      // A registration is not a world change — see the header on the gate.
      const revision = table.revision();
      const changed =
        dpr !== lastDpr || (zoomMatters && zoom !== lastZoom) || revision !== lastRevision;
      lastDpr = dpr;
      lastZoom = zoom;
      lastRevision = revision;
      return changed;
    },
  );

  /**
   * Whether this body run gave an ATLAS slot back. Only an atlas slot can empty
   * a layer, and only an emptied layer is memory the door can return — so this
   * is what decides whether `retireEmpty()` is worth a call after the walk.
   */
  let freedSlot = false;

  /** The slot door, with the memory door's trigger. */
  function freeAtlasSlot(key: ResidencyKey): void {
    if (allocator.free(key)) freedSlot = true;
  }

  /** Give up a key's destination: its atlas slot, or its private texture's reference. */
  function releaseKey(key: ResidencyKey): void {
    const slot = held.get(key);
    if (slot === undefined) return;
    held.delete(key);
    if (slot.own !== NO_TEXTURE) table.release(slot.own);
    else freeAtlasSlot(key);
  }

  function releaseEveryKeyOf(e: Entity): void {
    for (const band of ZOOM_BANDS) releaseKey(packKey(e, band));
  }

  /** A private texture's own bytes; 0 for an atlas slot, whose layer is charged whole. */
  function ownBytes(slot: HeldSlot | undefined): number {
    if (slot === undefined || slot.own === NO_TEXTURE) return 0;
    return slot.width * slot.height * bytesPerPixel;
  }

  /**
   * Walks every live layer and every held key, so it is counted ONCE per body
   * run: the budget loop then subtracts what each eviction gave back (exactly
   * `ownBytes` of the victim, plus `layerBytes` per layer the retire took),
   * rather than recomputing this — `allocator.layers()` builds a view and a
   * `pageWaste` per layer, which is an instrument, not a loop condition.
   *
   * LIVE layers, not `layerCount()`: pixels commit per layer on first write, so
   * the hole a retire can leave in the id set costs nothing. `layerCount()` is
   * the ARRAY LENGTH — what a card's `layer` indexes — and that is published,
   * not charged.
   */
  function committedBytes(): number {
    let bytes = allocator.layers().length * layerBytes;
    for (const slot of held.values()) bytes += ownBytes(slot);
    return bytes;
  }

  const pinned = (ctx: SystemCtx, e: Entity): boolean =>
    ctx.isAlive(e) && (ctx.hasTag(e, Visible) || ctx.hasTag(e, Retained));

  /** The coldest key the LRU may take: never Visible, never Retained, never `keep`. */
  function coldestEvictable(ctx: SystemCtx, keep?: ResidencyKey): ResidencyKey | undefined {
    let victim: ResidencyKey | undefined;
    let victimHeat = Number.POSITIVE_INFINITY;
    for (const [key, slot] of held) {
      if (key === keep) continue;
      if (pinned(ctx, slot.entity)) continue;
      if (slot.lastUsedMs < victimHeat) {
        victim = key;
        victimHeat = slot.lastUsedMs;
      }
    }
    return victim;
  }

  /**
   * Take a key back. If it is the entity's CURRENT key, its `TextureRef` must go
   * with it — a ref naming a destination we no longer hold is the "entity-keyed
   * store outliving the entity" class, from the other end.
   */
  function evict(ctx: SystemCtx, key: ResidencyKey): void {
    const slot = held.get(key);
    releaseKey(key);
    if (slot === undefined || !ctx.isAlive(slot.entity)) return;
    if (ctx.get(slot.entity, SurfaceBand)?.band === slot.band) writeRef(ctx, slot.entity, NO_DESTINATION);
  }

  function writeRef(ctx: SystemCtx, e: Entity, next: RefValue): void {
    const cur = ctx.get(e, TextureRef);
    if (cur === undefined) return;
    if (
      cur.texture === next.texture &&
      cur.layer === next.layer &&
      cur.u0 === next.u0 &&
      cur.v0 === next.v0 &&
      cur.u1 === next.u1 &&
      cur.v1 === next.v1
    ) {
      return;
    }
    if (cur.texture !== next.texture) {
      table.release(cur.texture);
      table.retain(next.texture);
      if (next.texture === NO_TEXTURE) refHandle.delete(e);
      else refHandle.set(e, next.texture);
    }
    ctx.edit(e).set(TextureRef, { ...next });
  }

  /**
   * Mint or reuse this key's private texture, sized in device px and held
   * inside the device ceiling (D11 — the header's "device ceiling" note). The
   * CLAMPED size is what the key records, so the reuse test, the budget and the
   * table entry all name one number.
   */
  function ownFor(
    key: ResidencyKey,
    e: Entity,
    band: number,
    width: number,
    height: number,
    srgb: boolean,
  ): TextureHandle {
    const { width: w, height: h } = clampToDevice(width, height, maxTextureSize);
    const slot = held.get(key);
    if (slot !== undefined && slot.own !== NO_TEXTURE && slot.width === w && slot.height === h) {
      return slot.own;
    }
    const heat = slot?.lastUsedMs; // a re-size keeps the key's heat, as above
    releaseKey(key);
    // THE KIND'S sRGB FACT, not a default (B8 R9a). An island target IS
    // `-srgb` — three's WebGPU renderer makes it so, and `composited-islands`
    // asserts `boot.srgb === true` off the realised texture's ACTUAL format —
    // so a table entry saying `false` for an island handle was a lie that only
    // held because the ground reads the format rather than the table. An
    // oversize `dom` slot is not: it is a plain colour buffer the element copy
    // writes. One fact, one writer, both readers agreeing.
    const handle = table.own(w, h, srgb);
    table.retain(handle); // the KEY's reference — see the header on two holders
    held.set(key, {
      entity: e,
      band,
      width: w,
      height: h,
      own: handle,
      lastUsedMs: heat ?? now(),
    });
    return handle;
  }

  function place(ctx: SystemCtx, key: ResidencyKey, e: Entity, band: number, w: number, h: number): RefValue {
    const existing = held.get(key);
    if (existing !== undefined && existing.own !== NO_TEXTURE) releaseKey(key); // was oversize, now fits
    const keptHeat = existing?.lastUsedMs;
    const size = { width: w, height: h };
    let placement = allocator.allocate(key, size);
    while (placement === null) {
      const victim = coldestEvictable(ctx, key);
      if (victim === undefined) break;
      evict(ctx, victim);
      placement = allocator.allocate(key, size);
    }
    if (placement === null) {
      // A refused RE-slot restores the key at its old size (the allocator's own
      // contract), so the allocator can still be holding it. Give it back
      // explicitly rather than leaving a slot no side table knows about.
      freeAtlasSlot(key);
      held.delete(key);
      return NO_DESTINATION; // honest: no destination this frame
    }
    // Heat is the touch pass's to write; a re-place is not a use. Only a key
    // that did not exist starts warm.
    held.set(key, {
      entity: e,
      band,
      width: w,
      height: h,
      own: NO_TEXTURE,
      lastUsedMs: keptHeat ?? now(),
    });
    const side = allocator.layerSize;
    const r = placement.rect;
    return {
      texture: table.pages(),
      layer: placement.layer,
      u0: r.x / side,
      v0: r.y / side,
      u1: (r.x + r.width) / side,
      v1: (r.y + r.height) / side,
    };
  }

  function resolve(ctx: SystemCtx, e: Entity): void {
    const kindCell = ctx.get(e, SurfaceKind);
    const targetCell = ctx.get(e, SurfaceTarget);
    const bandCell = ctx.get(e, SurfaceBand);
    const sizeCell = ctx.get(e, Size);
    if (kindCell === undefined || targetCell === undefined || bandCell === undefined) return;
    if (sizeCell === undefined || ctx.get(e, TextureRef) === undefined) return;

    const kind = kindCell.kind as SurfaceKindLabel;
    const band = bandCell.band;

    // No destination EXISTS for a card presenting on the DOM, or one that has
    // never been banded. That is a real teardown: every key goes.
    if (effectiveTarget(kind, targetCell.target as "dom" | "gpu") !== "gpu" || !(band > 0)) {
      releaseEveryKeyOf(e);
      writeRef(ctx, e, NO_DESTINATION);
      return;
    }

    const key = packKey(e, band);
    // `Visible ∨ Retained` gates ALLOCATION, not retention. A card that is
    // merely culled KEEPS what it already holds — that is what makes the LRU's
    // "coldest key that is neither Visible nor Retained" a live population
    // rather than an empty one, and what makes coming back a hit. What takes a
    // cold key is the budget, below; cull never does.
    if (!ctx.hasTag(e, Visible) && !ctx.hasTag(e, Retained) && !held.has(key)) {
      writeRef(ctx, e, NO_DESTINATION);
      return;
    }

    if (kind === "video") {
      // The producer owns the texture and its size; residency allocates nothing.
      const handle = table.stableOf(e);
      writeRef(ctx, e, handle === NO_TEXTURE ? NO_DESTINATION : { texture: handle, layer: 0, ...WHOLE });
      return;
    }

    const dpr = ctx.getResource(Viewport)?.dpr ?? 1;
    const zoom = ctx.getResource(Camera)?.zoom ?? 1;
    const geo = geometry({ w: sizeCell.w, h: sizeCell.h }, band, dpr, zoom, raster(kind));

    if (kind === "gl") {
      const { w, h } = geo.rasterSize;
      const handle = ownFor(key, e, band, w, h, true);   // the island target is `-srgb`
      writeRef(ctx, e, { texture: handle, layer: 0, ...WHOLE });
      return;
    }

    const { w, h } = geo.slotSize;
    if (!allocator.fits({ width: w, height: h })) {
      const handle = ownFor(key, e, band, w, h, false); // Q10: oversize takes a private texture — a plain colour buffer
      writeRef(ctx, e, { texture: handle, layer: 0, ...WHOLE });
      return;
    }
    writeRef(ctx, e, place(ctx, key, e, band, w, h));
  }

  return defineTickSystem(
    (ctx) => {
      const work = guard.take();
      if (work === undefined) return; // runIf false — unreachable with the guard wired
      frame++;
      freedSlot = false;

      // Death first: a despawned entity's components are gone, so there is no
      // ref to zero — only destinations to give back, and the producer's
      // registration to drop (§7's "entity-keyed store outliving the entity").
      for (const e of work.removed) {
        releaseEveryKeyOf(e);
        const named = refHandle.get(e);
        if (named !== undefined) {
          // The reference the dead entity's `TextureRef` held. Nothing else can
          // give it back: the component died with the entity.
          table.release(named);
          refHandle.delete(e);
        }
        table.unregister(e);
      }

      if (work.full) {
        // THE RESET SWEEP. `world.reset()` reports `reset: true` and NO
        // removals — strata subsumes the journal into one flag — and the guard
        // collapses that into `full`, so the death pass above never sees the
        // generation that just died. Without this, every key, every `refHandle`
        // reference and every registration of the old world survives it: the
        // allocator's slots, the table's counts and the layers they committed
        // are pinned for the session, by entity handles that can never come
        // back (a reset bumps every generation). So a full run reconciles the
        // side tables against LIFE, and releases exactly what a death releases.
        for (const [key, slot] of [...held]) {
          if (!ctx.isAlive(slot.entity)) releaseKey(key);
        }
        for (const [e, handle] of [...refHandle]) {
          if (ctx.isAlive(e)) continue;
          table.release(handle);
          refHandle.delete(e);
        }
        for (const owner of table.stableOwners()) {
          if (!ctx.isAlive(owner)) table.unregister(owner);
        }
        ctx.query(residentQ).each((b) => {
          for (const r of b) resolve(ctx, b.entity(r));
        });
      } else {
        for (const e of work.changed) {
          if (!ctx.isAlive(e)) continue;
          resolve(ctx, e);
        }
      }

      // The memory door, on the walk's own account. The budget loop below can
      // never open it at the default settings — `maxLayers` is derived FROM the
      // budget, so a full atlas sits exactly at it and never above — and an
      // idle board whose cards all demoted would hold every empty layer for the
      // session. A run that gave a slot back gets one retire.
      if (freedSlot) allocator.retireEmpty();

      // Heat, then the budget. Touching first is what keeps this frame's own
      // work off the eviction list.
      const stamp = now();
      for (const slot of held.values()) {
        if (ctx.isAlive(slot.entity) && ctx.hasTag(slot.entity, Visible)) slot.lastUsedMs = stamp;
      }
      let committed = committedBytes();
      while (committed > budgetBytes) {
        const victim = coldestEvictable(ctx);
        if (victim === undefined) break;
        const freed = ownBytes(held.get(victim));
        evict(ctx, victim);
        // The memory door: only a retired layer gives bytes back. Both terms
        // are exact, which is what lets the total be carried instead of rebuilt.
        committed -= freed + allocator.retireEmpty().length * layerBytes;
      }
      // The ARRAY LENGTH the GPU needs, not the live count: a retire can leave
      // the live ids sparse, and a card naming layer 2 of a two-layer array
      // samples out of bounds without a word.
      table.setPageLayers(allocator.layerCount());
    },
    { name: "residency", access: { write: [TextureRef] }, runIf: guard.runIf },
  );
}

/** The atlas + table pair `installSurfaceInfra` builds when a profile supplies none. */
export function createResidencyStore(opts: {
  readonly layerSize?: number;
  readonly gutter?: number;
  readonly budgetBytes?: number;
  readonly bytesPerPixel?: number;
}): { table: TextureTable; allocator: LayerAllocator } {
  const layerSize = opts.layerSize ?? 2048;
  const bytesPerPixel = opts.bytesPerPixel ?? DEFAULT_BYTES_PER_PIXEL;
  const budgetBytes = opts.budgetBytes ?? DEFAULT_RESIDENCY_BUDGET_BYTES;
  // The budget IS the layer ceiling: a seventeenth 16 MB layer under a 256 MB
  // budget would be evicted the moment it was committed, so it is never opened.
  // `allocate` returning null is then a live path, not a theoretical one.
  const maxLayers = Math.max(1, Math.floor(budgetBytes / (layerSize * layerSize * bytesPerPixel)));
  return {
    table: createTextureTable({ pageSize: layerSize }),
    allocator: createLayerAllocator({ layerSize, ...(opts.gutter === undefined ? {} : { gutter: opts.gutter }), maxLayers }),
  };
}
