/**
 * The LAYER allocator — residency's pure half (design-013 §4 rev 4; the
 * implementation plan's A2 item 1). It answers one question: where may a dom
 * card's slot sit? Nothing else. No ids beyond the key, no GPU, no side
 * effects, no time. The Residency SYSTEM decides what should be resident and
 * writes `TextureRef`; this module owns only rect math over `@ice/kernel`'s
 * shelf packer.
 *
 * ## What replaced what
 *
 * design-012's `ground/src/atlas-allocator.ts` kept PAGES that grew with
 * content: a page opened at the smallest power of two that held its first slot,
 * doubled toward `maxTextureDimension2D`, and a fragmented page was repacked in
 * place. design-013 §4 replaces that with LAYERS of one FIXED size (§9 Q10
 * RULED 2048², one `texture_2d_array`), for the compose pass's sake: with the
 * array bound once, every dom card samples through one binding and a z-run is
 * never split (§10.4).
 *
 * So `initialPageSize`, `nextGrowthStep`, `planPageGrowth`, `growShelfPage` and
 * the whole repack family (`packPage`, `planRepack`, `applyRepack`) are NOT
 * used here — **repack is not ported** (D8). It existed because pages grew and
 * fragmented under a growing board; fixed layers with band-keyed retention make
 * the common case one layer holding the in-motion few. If the A2 sweep or a
 * B-phase rig ever measures a realistic board above 30 % packing waste, repack
 * comes back as its own slice, against that number. `waste()` is the instrument
 * that would say so.
 *
 * ## The key
 *
 * A slot is keyed by `(entity, band)` — per-band retention (§2) is the whole
 * mechanism the "per-band atlases" goal reduces to — packed into one number as
 * `entity * 16 + bandIndex`, where `bandIndex` indexes `ZOOM_BANDS` (nine
 * entries; `bandIndexOf` refuses anything that is not one of them, and the four
 * low bits are never full).
 *
 * An entity handle is a packed u32 (`0 … 2³² − 1`, strata design §2), so the
 * product tops out near 6.9e10: a safe integer, exact in a f64, and far below
 * `Number.MAX_SAFE_INTEGER`. It is deliberately NOT a bit field — `entity * 16`
 * exceeds 2³¹ for real handles and every JS bitwise operator would silently
 * truncate it — so packing and unpacking are arithmetic (`* 16`, `/ 16`, `% 16`).
 *
 * ## The two doors (§4)
 *
 * - **The slot door — `free(key)`.** Returns a slot's space to its layer. It
 *   returns ADDRESS space, not memory: a fixed layer commits its full
 *   `layerSize² × 4` bytes the first time anything is written into it
 *   (hic-bench FINDINGS §6, as recorded in `ground/src/compositor/dom-atlas.ts`
 *   fact 3 — textures are lazily backed and pixels commit on first write).
 *   Freeing scattered slots therefore reclaims no memory at all.
 * - **The memory door — `retireEmpty()`.** Drops every layer holding no slots
 *   and names them, so the caller's realisation can destroy those array layers.
 *   Unlike the paged allocator, no layer is kept standing: an empty atlas
 *   should cost nothing.
 *
 * ## Layer ids are array indices
 *
 * `TextureRef.layer` is the index the compose pass samples in the one bound
 * `texture_2d_array` (§4, §10.4), so the live id set has to stay DENSE. An id
 * space that only grew would leave holes the GPU array must still span and
 * would never shrink — the memory door would return nothing, which is the whole
 * point of `retireEmpty`. So a retired id is REUSED: a new layer takes the
 * lowest id no live layer holds, and `layers().length` is the array's layer
 * count. Held layers still never renumber, and `retireEmpty` only ever takes a
 * layer with no held slots, so no held slot's layer id can be reissued
 * underneath it.
 *
 * The lowest free id is DERIVED from the live set rather than kept in a free
 * pool: one source of truth cannot drift from the other, because there is no
 * other.
 *
 * What reuse does NOT reopen is a stale `TextureRef.layer` naming a reused
 * layer's content. The one-writer discipline closes that: the Residency system
 * writes `texture = 0` on every key it frees, in the same body, so a freed key
 * leaves no live index behind. Whether a slot's TEXELS are valid yet is a
 * separate, flux-side question — a "written" status the B-phase reflectors keep
 * outside the world — and it exists for every newly allocated slot on every
 * layer, reused or not.
 */
import {
  createShelfPage,
  DEFAULT_ATLAS_GUTTER,
  freeRect,
  packRect,
  pageWaste,
  ZOOM_BANDS,
  type PageWaste,
  type Rect,
  type ShelfPage,
  type SlotSize,
} from "@ice/kernel";
import type { Entity } from "@vibecook/strata-ecs";

/**
 * Band slots per entity in a packed key. `ZOOM_BANDS` has nine entries; four
 * bits hold sixteen, and the multiplier stays a small power of two so the
 * arithmetic is exact.
 */
const BAND_SLOTS = 16;

if (ZOOM_BANDS.length > BAND_SLOTS) {
  throw new Error(`residency: the key packing holds at most ${BAND_SLOTS} zoom bands`);
}

/** §9 Q10: 2048², 16 MB committed per layer on its first write. */
export const DEFAULT_LAYER_SIZE = 2048;

/** A packed `(entity, band)` slot key. See the module note on why it is arithmetic. */
export type ResidencyKey = number;

/** The index of a band in `ZOOM_BANDS`. Throws on a value that is not a band. */
export function bandIndexOf(band: number): number {
  const index = (ZOOM_BANDS as readonly number[]).indexOf(band);
  if (index < 0) {
    throw new Error(
      `residency: ${band} is not a zoom band — keys are (entity, band) over [${ZOOM_BANDS.join(", ")}]`,
    );
  }
  return index;
}

/** Pack `(entity, band)` into one key. */
export function packKey(entity: Entity, band: number): ResidencyKey {
  return entity * BAND_SLOTS + bandIndexOf(band);
}

/** The inverse of {@link packKey}. Throws when the key names no band. */
export function unpackKey(key: ResidencyKey): { entity: Entity; band: number } {
  const bandIndex = key % BAND_SLOTS;
  const band = ZOOM_BANDS[bandIndex];
  if (band === undefined) {
    throw new Error(`residency: key ${key} carries band index ${bandIndex}, which names no zoom band`);
  }
  return { entity: Math.floor(key / BAND_SLOTS) as Entity, band };
}

export interface LayerAllocatorOptions {
  /** Layer side in device px. Default 2048 (§9 Q10). Every layer is this size, always. */
  readonly layerSize?: number;
  /** Slot separation in device px. Default 2 — `@ice/kernel/atlas-pack`'s gutter note. */
  readonly gutter?: number;
  /**
   * Hard ceiling on live layers. Default: none. The BYTE budget is the
   * Residency system's door (`reclaim`), not this one; `maxLayers` is the
   * ceiling a host may impose on top of it, and reaching it is what makes
   * `allocate` return `null` so the caller can evict and retry.
   */
  readonly maxLayers?: number;
}

/** Where a slot sits: the layer's id and its device-px rect inside that layer. */
export interface LayerPlacement {
  readonly layer: number;
  readonly rect: Rect;
}

export interface LayerView {
  readonly id: number;
  /** Constant for the layer's life — a layer never grows. */
  readonly width: number;
  readonly height: number;
  readonly heldSlots: number;
  /** Live slot pixels. Mirrors `waste.usedArea`. */
  readonly usedArea: number;
  readonly waste: PageWaste;
}

/**
 * Areas only — no bytes. A fixed layer commits `layerSize² × 4` on first write,
 * so the memory number is `layers × layerSize² × bytesPerPixel` and the
 * Residency system owns it; `occupiedArea` here is the shelf-reach measure that
 * `packingWastePct` divides by, i.e. PACKING quality, not residency.
 */
export interface LayerWasteReport {
  layers: number;
  slots: number;
  /** Live slot pixels. */
  slotArea: number;
  /** Σ `layerSize × occupiedHeight` — the band the shelves reach into. */
  occupiedArea: number;
  /** Σ `layerSize²` — addressable, and (unlike a growing page) also committed. */
  layerArea: number;
  /** Interior fragmentation: reusable holes left by freed slots. */
  holeArea: number;
  /** `1 − slotArea/occupiedArea` — the number comparable to the paged allocator's 12 % bound. */
  packingWastePct: number;
  /** `1 − slotArea/layerArea` — how much of the committed atlas is unspent. */
  allocationWastePct: number;
  /** `holeArea/occupiedArea` — what would trigger a repack, if one were ported (D8). */
  fragmentationPct: number;
}

export interface LayerAllocator {
  /**
   * The side of every layer, in device px. Exposed because the Residency
   * system's byte budget counts a layer as `layerSize² × bytesPerPixel` from
   * its first allocation, and a second copy of this number living in the
   * system's options is the "two writers of one number" class (§7) waiting to
   * happen.
   */
  readonly layerSize: number;
  /**
   * Place a slot. `null` when the size does not `fits()` (no layer is opened —
   * the caller is expected to have checked, and to take an `own` texture
   * instead, §9 Q10's oversize rule), or when no live layer has room and
   * `maxLayers` is reached — then the caller evicts and retries.
   *
   * A key already held at the SAME size returns its existing placement
   * unchanged. At a DIFFERENT size it is freed and re-placed; if the re-place
   * is refused the slot keeps its old size (at a possibly different rect) and
   * the call returns `null`.
   */
  allocate(key: ResidencyKey, size: SlotSize): LayerPlacement | null;
  /** The slot door. `false` when no slot is held for the key. */
  free(key: ResidencyKey): boolean;
  get(key: ResidencyKey): LayerPlacement | undefined;
  /**
   * Whether a slot of this size could ever sit in a layer: positive on both
   * axes and no larger than `layerSize − 2·gutter`. A card that fails this is
   * given an `own` texture by Residency — nothing is clipped or refused.
   */
  fits(size: SlotSize): boolean;
  /** Held slots, across every layer. */
  held(): number;
  layers(): LayerView[];
  /**
   * The memory door: retire every layer with no held slots; returns their ids,
   * ascending. A retired id returns to the pool a new layer draws from.
   */
  retireEmpty(): number[];
  waste(): LayerWasteReport;
}

interface LayerRecord {
  readonly id: number;
  readonly page: ShelfPage;
  readonly slots: Set<ResidencyKey>;
}

interface SlotRecord {
  readonly key: ResidencyKey;
  layer: number;
  rect: Rect;
  size: SlotSize;
}

export function createLayerAllocator(options: LayerAllocatorOptions = {}): LayerAllocator {
  const layerSize = options.layerSize ?? DEFAULT_LAYER_SIZE;
  const gutter = options.gutter ?? DEFAULT_ATLAS_GUTTER;
  const maxLayers = options.maxLayers ?? Number.POSITIVE_INFINITY;
  const maxSlotSide = layerSize - 2 * gutter;

  const layers: LayerRecord[] = [];
  const slots = new Map<ResidencyKey, SlotRecord>();

  const view = (slot: SlotRecord): LayerPlacement => ({ layer: slot.layer, rect: { ...slot.rect } });

  const fitsSize = (size: SlotSize): boolean =>
    size.width > 0 && size.height > 0 && size.width <= maxSlotSide && size.height <= maxSlotSide;

  /** The lowest index no live layer holds — see the header on dense ids. */
  function freeLayerId(): number {
    const used = new Set(layers.map((l) => l.id));
    let id = 0;
    while (used.has(id)) id++;
    return id;
  }

  function openLayer(): LayerRecord {
    const layer: LayerRecord = {
      id: freeLayerId(),
      page: createShelfPage(layerSize, layerSize, gutter),
      slots: new Set<ResidencyKey>(),
    };
    layers.push(layer);
    return layer;
  }

  /** An existing layer with room, or a fresh one while `maxLayers` allows. */
  function place(size: SlotSize): { layer: LayerRecord; rect: Rect } | null {
    for (const layer of layers) {
      const rect = packRect(layer.page, size);
      if (rect !== null) return { layer, rect };
    }
    if (layers.length >= maxLayers) return null;
    // `allocate` refuses anything that does not `fits`, and an empty layer takes
    // everything that does (up to `layerSize − 2·gutter` on both axes), so this
    // is a placement, always. That one guard is what keeps an oversize slot from
    // committing a layer's pixels on its way to a refusal.
    const layer = openLayer();
    const rect = packRect(layer.page, size);
    return rect === null ? null : { layer, rect };
  }

  function detach(slot: SlotRecord): void {
    const layer = layers.find((l) => l.id === slot.layer);
    if (layer === undefined) return;
    freeRect(layer.page, slot.rect);
    layer.slots.delete(slot.key);
  }

  function attach(slot: SlotRecord, placed: { layer: LayerRecord; rect: Rect }, size: SlotSize): void {
    slot.layer = placed.layer.id;
    slot.rect = placed.rect;
    slot.size = { ...size };
    placed.layer.slots.add(slot.key);
  }

  function reslot(slot: SlotRecord, size: SlotSize): LayerPlacement | null {
    const previous = slot.size;
    detach(slot);
    const placed = place(size);
    if (placed !== null) {
      attach(slot, placed, size);
      return view(slot);
    }
    // Refused. The space just released takes the old size back, though possibly
    // at another rect — ported from the paged allocator, whose randomized suite
    // is what proved dropping the slot instead was wrong.
    const restored = place(previous);
    if (restored === null) throw new Error("residency: lost a slot's own space on a failed re-slot");
    attach(slot, restored, previous);
    return null;
  }

  return {
    layerSize,

    allocate(key, size) {
      if (!fitsSize(size)) return null;
      const held = slots.get(key);
      if (held !== undefined) {
        if (held.size.width === size.width && held.size.height === size.height) return view(held);
        return reslot(held, size);
      }
      const placed = place(size);
      if (placed === null) return null;
      const slot: SlotRecord = { key, layer: placed.layer.id, rect: placed.rect, size: { ...size } };
      slots.set(key, slot);
      placed.layer.slots.add(key);
      return view(slot);
    },

    free(key) {
      const slot = slots.get(key);
      if (slot === undefined) return false;
      detach(slot);
      slots.delete(key);
      return true;
    },

    get(key) {
      const slot = slots.get(key);
      return slot === undefined ? undefined : view(slot);
    },

    fits(size) {
      return fitsSize(size);
    },

    held() {
      return slots.size;
    },

    layers() {
      // Ordered by id, not by fill order: an id is an array index, so a dense
      // set reads as `layers()[i].id === i`.
      return [...layers].sort((a, b) => a.id - b.id).map((layer) => {
        const waste = pageWaste(layer.page);
        return {
          id: layer.id,
          width: layer.page.width,
          height: layer.page.height,
          heldSlots: layer.slots.size,
          usedArea: waste.usedArea,
          waste,
        };
      });
    },

    retireEmpty() {
      const retired: number[] = [];
      for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i] as LayerRecord;
        if (layer.slots.size > 0) continue;
        layers.splice(i, 1);
        retired.push(layer.id);
      }
      return retired.reverse();
    },

    waste() {
      let slotArea = 0;
      let occupiedArea = 0;
      let layerArea = 0;
      let holeArea = 0;
      for (const layer of layers) {
        const w = pageWaste(layer.page);
        slotArea += w.usedArea;
        occupiedArea += w.occupiedArea;
        layerArea += w.pageArea;
        holeArea += w.holeArea;
      }
      return {
        layers: layers.length,
        slots: slots.size,
        slotArea,
        occupiedArea,
        layerArea,
        holeArea,
        packingWastePct: occupiedArea === 0 ? 0 : 1 - slotArea / occupiedArea,
        allocationWastePct: layerArea === 0 ? 0 : 1 - slotArea / layerArea,
        fragmentationPct: occupiedArea === 0 ? 0 : holeArea / occupiedArea,
      };
    },
  };
}
