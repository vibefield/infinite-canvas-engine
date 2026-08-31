/**
 * The DOM source atlas — the paged allocator (design-012 §11 Q3) bound to a
 * real `GPUDevice` and to HiC's direct element copy.
 *
 * The allocator itself (`../atlas-allocator`) is pure: every side effect is
 * injected. This file is the ONLY place those effects become WebGPU calls, and
 * it is deliberately thin, because everything interesting — shelf packing,
 * page growth, retention, repack, the waste instrument — was decided and
 * property-tested on the pure side.
 *
 * Three as-built facts govern the binding:
 *
 * 1. **The copy takes no extent.** `copyElementImageToTexture` writes the
 *    element's own device-pixel size at the destination origin (gate zero,
 *    2026-08-31). A slot smaller than its element would therefore write across
 *    the 2 px gutter into a neighbour. `allocate()` is called with the MEASURED
 *    size before every copy for exactly that reason — it re-slots on a size
 *    change, so the slot is never smaller than what will land in it.
 *
 * 2. **Repack blanks what it moves** (allocator finding 3): moved slots come
 *    back `empty`, not `stale`. `empty` means the page does not hold this
 *    slot's pixels — sampling it would show whatever used to live at that rect.
 *    So a quad whose slot is `empty` is SKIPPED, never drawn. That is what
 *    "the binder must drain repack copies before compositing those quads"
 *    reduces to once the compositor can simply decline to draw one.
 *
 * 3. **Pixels commit per PAGE on first write** (hic-bench §6: textures are
 *    lazily backed). `retirePage` is what actually returns memory; freeing
 *    scattered slots returns address space. Any memory number reported from
 *    here comes from the page door.
 */
import type { Rect, SlotSize } from "@ice/kernel";
import {
  createAtlasAllocator,
  type AtlasAllocator,
  type AtlasAllocatorOptions,
  type AtlasEffects,
  type AtlasWasteReport,
} from "../atlas-allocator";
import { copyElementToTexture } from "../hic-adapter";
import { TextureUsage } from "./gpu-flags";

/** Where an entity's pixels live, ready for the quad pass to sample. */
export interface AtlasPlacement {
  readonly texture: GPUTexture;
  /** Slot rect in the page's texels — the quad's UV crop. */
  readonly rect: Rect;
  readonly pageWidth: number;
  readonly pageHeight: number;
}

export interface DomAtlas<Id> {
  /**
   * Register or re-register an element at its measured DEVICE-pixel size.
   * Re-slots when the size changed, and marks the slot for copy. `false` when
   * the size exceeds the device's texture limit — an honest refusal; the
   * caller degrades rather than compositing a clipped card.
   */
  place(id: Id, element: Element, size: SlotSize): boolean;
  /** A paint event named this element: its pixels are out of date. */
  markDirty(id: Id): boolean;
  free(id: Id): boolean;
  touch(id: Id, nowMs: number): void;
  /**
   * Where to sample this id, or `undefined` when it has no slot or the slot is
   * `empty` (nothing of this id's pixels is at that rect yet — see fact 2).
   */
  placementOf(id: Id): AtlasPlacement | undefined;
  /**
   * Drive up to `limit` pending element→slot copies. Returns the number that
   * actually SUCCEEDED — a host the canvas has not painted yet is refused by
   * the platform, and pretending otherwise would mark a blank slot resident.
   */
  flush(limit?: number): number;
  /** Elements whose copy was refused in the most recent flush. */
  lastCopyFailures(): readonly Element[];
  /** Refused copies since construction (a persistent count means a real fault). */
  copyFailures(): number;
  /** The most recent refusal, for diagnosis. */
  lastCopyError(): unknown;
  pendingCopies(): number;
  /** GPU bytes actually committed: written area on live pages (fact 3). */
  committedBytes(): number;
  waste(): AtlasWasteReport;
  pages(): number;
  /** Underlying allocator, for retention/repack policy and tests. */
  readonly allocator: AtlasAllocator<Id, Element>;
  dispose(): void;
}

export interface DomAtlasOptions extends AtlasAllocatorOptions {
  /**
   * Page texture format. `rgba8unorm` deliberately: the element copy delivers
   * sRGB-encoded bytes, and a NON-srgb texture hands those bytes back to the
   * shader unchanged, so a dom quad onto a non-srgb swap chain is a
   * passthrough with no conversion anywhere. Choosing `-srgb` here would make
   * the sample auto-decode to linear and require a re-encode that exists only
   * to undo this choice.
   */
  readonly format?: GPUTextureFormat;
  /** Copies are issued against this queue; defaults to `device.queue`. */
  readonly queue?: GPUQueue;
}

export function createDomAtlas<Id>(
  device: GPUDevice,
  options: DomAtlasOptions = {},
): DomAtlas<Id> {
  const format = options.format ?? "rgba8unorm";
  const queue = options.queue ?? device.queue;
  const pages = new Map<number, GPUTexture>();
  /** Elements whose copy failed during the most recent flush (see copySlot). */
  let failedCopies: Element[] = [];
  let lastCopyError: unknown = null;
  let copyFailures = 0;

  // COPY_SRC so a page can be grown in place (texture-to-texture) and read back
  // by a rig; RENDER_ATTACHMENT so a page can be cleared to a known value,
  // which is what makes "did anything land in this slot" decidable in a test.
  const USAGE =
    TextureUsage.TEXTURE_BINDING |
    TextureUsage.COPY_DST |
    TextureUsage.COPY_SRC |
    TextureUsage.RENDER_ATTACHMENT;

  const makeTexture = (id: number, width: number, height: number): GPUTexture =>
    device.createTexture({
      label: `dom-atlas-page-${id}`,
      size: { width, height },
      format,
      usage: USAGE,
    });

  const effects: AtlasEffects<Element> = {
    createPage(pageId, width, height) {
      pages.set(pageId, makeTexture(pageId, width, height));
    },

    copySlot(pageId, rect, source) {
      const texture = pages.get(pageId);
      if (texture === undefined) return;
      try {
        // The element's own size lands here; `place()` guarantees the slot was
        // allocated at that size. Receiver-bound through the adapter.
        copyElementToTexture(queue, source, texture, { x: rect.x, y: rect.y });
      } catch (error) {
        // A host the canvas has not painted yet raises
        // `InvalidStateError: No cached paint record for element` — the normal
        // state for one frame after a promotion, since the record appears when
        // the canvas next paints the newly reparented node.
        //
        // It must NOT propagate: this runs inside the compositor reflector, so
        // one unrecorded card would throw away the whole frame — every OTHER
        // card included. The id is collected and the binder retries it next
        // frame; until the copy lands the slot stays non-resident and its quad
        // is skipped, so the card is absent for a frame rather than wrong.
        failedCopies.push(source);
        lastCopyError = error;
      }
    },

    /**
     * In-place growth. Growth is origin-anchored (the allocator never moves a
     * slot when a page grows), so a straight texture-to-texture copy of the old
     * extent preserves every slot's pixels at its own rect — which is why this
     * can honestly return `true` and spare the whole page a re-copy.
     */
    growPage(pageId, width, height) {
      const old = pages.get(pageId);
      if (old === undefined) return false;
      const next = makeTexture(pageId, width, height);
      const encoder = device.createCommandEncoder({ label: `dom-atlas-grow-${pageId}` });
      encoder.copyTextureToTexture(
        { texture: old },
        { texture: next },
        { width: old.width, height: old.height, depthOrArrayLayers: 1 },
      );
      queue.submit([encoder.finish()]);
      old.destroy();
      pages.set(pageId, next);
      return true;
    },

    retirePage(pageId) {
      pages.get(pageId)?.destroy();
      pages.delete(pageId);
    },
  };

  const allocator = createAtlasAllocator<Id, Element>(effects, options);

  return {
    allocator,

    place(id, element, size) {
      if (size.width <= 0 || size.height <= 0) return false;
      return allocator.allocate(id, size, element) !== null;
    },

    markDirty: (id) => allocator.markDirty(id),
    free: (id) => allocator.free(id),
    touch: (id, nowMs) => allocator.touch(id, nowMs),

    placementOf(id) {
      const slot = allocator.get(id);
      // `empty` = the page does not hold this slot's pixels (fresh, re-slotted
      // or just repacked). Drawing it would sample a neighbour's pixels.
      if (slot === undefined || slot.residency === "empty") return undefined;
      const texture = pages.get(slot.page);
      if (texture === undefined) return undefined;
      return {
        texture,
        rect: slot.rect,
        pageWidth: texture.width,
        pageHeight: texture.height,
      };
    },

    flush(limit) {
      failedCopies = [];
      const copied = allocator.flush(limit);
      copyFailures += failedCopies.length;
      // The allocator marked every attempted slot `resident`, including the
      // ones that threw. Reported so the caller can put them back.
      return copied - failedCopies.length;
    },
    lastCopyFailures: () => failedCopies,
    copyFailures: () => copyFailures,
    lastCopyError: () => lastCopyError,
    pendingCopies: () => allocator.pendingCopies().length,

    committedBytes() {
      // The page door (fact 3): written area, not addressable area.
      return allocator.waste().occupiedBytes;
    },

    waste: () => allocator.waste(),
    pages: () => pages.size,

    dispose() {
      allocator.dispose();
      for (const texture of pages.values()) texture.destroy();
      pages.clear();
    },
  };
}
