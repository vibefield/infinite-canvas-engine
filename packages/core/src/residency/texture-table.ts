/**
 * The TEXTURE TABLE — the runtime-local handle registry `TextureRef.texture`
 * indexes into (design-013 §5's last bullet; §9 Q4 RULED "u32 handle into the
 * table", not a runtime entity; the implementation plan's A2 item 2).
 *
 * Residency owns every compositor destination — atlas layers for dom cards,
 * pooled render targets for gl islands, registered stable textures for video
 * and live surfaces (§4). A `TextureRef` names one of them by HANDLE, and this
 * table is what a handle means. Handles are u32 counting from 1; `0` is
 * `NO_TEXTURE` — "no destination", the §5 row's "ABSENT", never a handle. Both
 * `retain` and `release` accept it and do nothing, because the writer of
 * `TextureRef` calls them on every change and the old or new value is routinely 0.
 *
 * Three entry kinds, and who mints each:
 *
 * - **`pages`** — the dom atlas: ONE `texture_2d_array` of `size × size` layers
 *   (§9 Q10), allocated once and lazily by `pages()`, with `layers` following
 *   `createLayerAllocator`'s count through `setPageLayers`. It is born holding
 *   its own reference, so it never drains: the atlas outlives every card in it,
 *   and `retireEmpty` (the allocator's memory door) is what returns its pixels.
 * - **`own`** — a private texture for a card the atlas cannot serve: an
 *   oversize dom slot (Q10 — nothing is clipped or refused) or a gl island's
 *   pooled target. Minted per allocation and never looked up by identity, so a
 *   drained `own` handle is gone for good.
 * - **`stable`** — a producer's own texture, registered against an entity (§9
 *   Q5 RULED "a registered stable-texture handle" for the video kind). The
 *   registration IS a reference: registering twice for one entity replaces the
 *   first and releases it, so the old handle drains once nothing else holds it.
 *
 * ## The refcount and the drain rule
 *
 * A handle is retained by whoever writes it into a `TextureRef` and released
 * when that reference changes. **`drain()` returns every handle whose count
 * REACHED zero since the last drain, each exactly once, and forgets them.** Two
 * consequences, both deliberate:
 *
 * - A handle re-retained before the drain is NOT drained. It never became
 *   garbage: a card that loses its slot and takes it back inside one frame must
 *   not have its texture destroyed underneath it.
 * - A handle that was never retained is never drained either. Only a
 *   TRANSITION to zero enters the list, so minting is not itself a death.
 *
 * The drain is the destroy list: B's render reflectors destroy the GPU objects
 * it names, and the entry is gone from the table with them, so no drained
 * handle can be handed back out. `pages` cannot appear there (see above), an
 * `own` handle is only ever the one `own()` just returned, and a `stable`
 * handle is only reachable through `stableOf`, which by then names its
 * replacement.
 *
 * ## Realisation is Phase B's
 *
 * `realize` / `realized` are the seam where a handle gains an actual
 * `GPUTexture`. **Neither is called in Phase A** — A2 computes allocation and
 * writes `TextureRef`; no renderer reads it yet (plan §3). `GPUTexture` is
 * named here for the same reason `surface/compositor-registry.ts` names it:
 * WebGPU is not DOM, it exists in workers, and a hand-rolled structural mirror
 * would rot.
 */
import type { Entity } from "@vibecook/strata-ecs";
import { DEFAULT_LAYER_SIZE } from "./layer-allocator";

// TODO(A2 part 2): once A1a has landed, delete this local constant and
// `import { NO_TEXTURE } from "../catalog/surface"` instead — the catalog is
// its home (D2). Keep it UNEXPORTED either way: `core/index.ts` re-exports both
// the catalog and this module with `export *`, and two exported bindings of one
// name collide there.
const NO_TEXTURE = 0;

/** A u32 handle into the table, counting from 1. `0` means no destination. */
export type TextureHandle = number;

/** The dom atlas: one `texture_2d_array` of `size × size` layers. Never sRGB. */
export interface PagesTexture {
  readonly kind: "pages";
  readonly size: number;
  readonly layers: number;
  readonly srgb: false;
}

/** A private texture: an oversize dom slot, or a gl island's pooled target. */
export interface OwnTexture {
  readonly kind: "own";
  readonly width: number;
  readonly height: number;
  readonly srgb: boolean;
}

/** A producer's own texture, registered against an entity (Q5). */
export interface StableTexture {
  readonly kind: "stable";
  readonly width: number;
  readonly height: number;
  readonly srgb: boolean;
}

export type TextureEntry = PagesTexture | OwnTexture | StableTexture;

/**
 * What a producer states when it registers. `srgb` is REQUIRED here and
 * defaulted on `own`: an own texture's format is the profile's own choice, but
 * a registered one belongs to its producer, and the compose pass's re-encode is
 * guarded on the actual format and never on an assumption (design-012 §4).
 */
export interface StableTextureSpec {
  readonly width: number;
  readonly height: number;
  readonly srgb: boolean;
}

export interface TextureTableOptions {
  /** The atlas layer side reported by the `pages` entry. Default 2048 (§9 Q10). */
  readonly pageSize?: number;
}

export interface TextureTable {
  /** The dom atlas handle, minted on first ask. Idempotent. */
  pages(): TextureHandle;
  /** Track the allocator's live layer count. No-op before `pages()` exists. */
  setPageLayers(layers: number): void;
  own(width: number, height: number, srgb?: boolean): TextureHandle;
  /** Register a producer's texture for an entity, replacing and releasing any previous one. */
  register(entity: Entity, stable: StableTextureSpec): TextureHandle;
  /** Drop an entity's registration, releasing its reference. `false` when it had none. */
  unregister(entity: Entity): boolean;
  /** The entity's registered handle, or `0`. */
  stableOf(entity: Entity): TextureHandle;
  describe(handle: TextureHandle): TextureEntry | undefined;
  refs(handle: TextureHandle): number;
  /** Returns the new count. `0` for `NO_TEXTURE` and for an unknown handle. */
  retain(handle: TextureHandle): number;
  release(handle: TextureHandle): number;
  /** Handles whose count reached zero since the last drain, in the order they died. */
  drain(): TextureHandle[];
  /** Phase B's seam. `false` for an unknown handle. Never called in Phase A. */
  realize(handle: TextureHandle, texture: GPUTexture): boolean;
  realized(handle: TextureHandle): GPUTexture | undefined;
  /**
   * Forget every entry, count and realisation. Handles keep counting up, so one
   * minted before a dispose can never alias one minted after.
   */
  dispose(): void;
}

export function createTextureTable(options: TextureTableOptions = {}): TextureTable {
  const pageSize = options.pageSize ?? DEFAULT_LAYER_SIZE;

  const entries = new Map<TextureHandle, TextureEntry>();
  const counts = new Map<TextureHandle, number>();
  const realizations = new Map<TextureHandle, GPUTexture>();
  const stable = new Map<Entity, TextureHandle>();
  /** Reached zero since the last drain. Insertion-ordered: the order they died. */
  const zeroed = new Set<TextureHandle>();

  let nextHandle: TextureHandle = 1;
  let pagesHandle: TextureHandle = NO_TEXTURE;

  function mint(entry: TextureEntry, refs: number): TextureHandle {
    const handle = nextHandle++;
    entries.set(handle, entry);
    counts.set(handle, refs);
    return handle;
  }

  function releaseHandle(handle: TextureHandle): number {
    if (handle === NO_TEXTURE) return 0;
    const current = counts.get(handle);
    if (current === undefined || current <= 0) return 0;
    const next = current - 1;
    counts.set(handle, next);
    if (next === 0) zeroed.add(handle);
    return next;
  }

  return {
    pages() {
      if (pagesHandle === NO_TEXTURE) {
        // Born with its own reference: the atlas outlives every card in it.
        pagesHandle = mint({ kind: "pages", size: pageSize, layers: 0, srgb: false }, 1);
      }
      return pagesHandle;
    },

    setPageLayers(layers) {
      if (pagesHandle === NO_TEXTURE) return;
      const entry = entries.get(pagesHandle);
      if (entry === undefined || entry.kind !== "pages") return;
      entries.set(pagesHandle, { ...entry, layers });
    },

    own(width, height, srgb = false) {
      return mint({ kind: "own", width, height, srgb }, 0);
    },

    register(entity, spec) {
      const previous = stable.get(entity);
      const handle = mint(
        { kind: "stable", width: spec.width, height: spec.height, srgb: spec.srgb },
        1,
      );
      stable.set(entity, handle);
      if (previous !== undefined) releaseHandle(previous);
      return handle;
    },

    unregister(entity) {
      const handle = stable.get(entity);
      if (handle === undefined) return false;
      stable.delete(entity);
      releaseHandle(handle);
      return true;
    },

    stableOf(entity) {
      return stable.get(entity) ?? NO_TEXTURE;
    },

    describe(handle) {
      return entries.get(handle);
    },

    refs(handle) {
      return counts.get(handle) ?? 0;
    },

    retain(handle) {
      if (handle === NO_TEXTURE) return 0;
      const current = counts.get(handle);
      if (current === undefined) return 0;
      const next = current + 1;
      counts.set(handle, next);
      // Re-retained before the drain: it never became garbage.
      zeroed.delete(handle);
      return next;
    },

    release(handle) {
      return releaseHandle(handle);
    },

    drain() {
      const drained = [...zeroed];
      zeroed.clear();
      for (const handle of drained) {
        entries.delete(handle);
        counts.delete(handle);
        realizations.delete(handle);
      }
      return drained;
    },

    realize(handle, texture) {
      if (!entries.has(handle)) return false;
      realizations.set(handle, texture);
      return true;
    },

    realized(handle) {
      return realizations.get(handle);
    },

    dispose() {
      entries.clear();
      counts.clear();
      realizations.clear();
      stable.clear();
      zeroed.clear();
      pagesHandle = NO_TEXTURE;
    },
  };
}
