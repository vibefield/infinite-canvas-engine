import { SRGBColorSpace, WebGLRenderTarget } from "three";

/**
 * Per-island FBO pool (design-004 §3). Each compositor island paints into its
 * own persistent `WebGLRenderTarget` instead of the shared canvas backbuffer,
 * so the compositor can sample islands as textures and stack them with correct
 * z / opacity.
 *
 * Ported from v1 `WidgetRenderTargetPool` (../infinite-canvas
 * .../r3f/compositor/WidgetRenderTargetPool.ts) with the design-004 §3 rev 2
 * deltas: the pool is keyed by a plain `number` (the caller's island/entity id)
 * and imports NOTHING from the ECS — it is a pure three resource, so it never
 * depends on the entity representation. Timestamps are injected (see `now`) so
 * the LRU is deterministic under test.
 *
 * Acquire returns an existing FBO when its pixel resolution matches the request;
 * otherwise the old FBO is disposed and a new one is created at the new
 * resolution. Eviction under memory pressure is a higher layer's concern — this
 * pool grows monotonically until islands are `release`d.
 */

/**
 * Real GPU-allocation model for one target's bytes (2026-07-13 review finding).
 *
 * An MSAA `WebGLRenderTarget` (RGBA8, three's default `depthBuffer: true`,
 * `stencilBuffer: false`) is NOT one surface — three allocates three:
 *   - the sampleable resolve texture: {@link COLOR_BYTES_PER_PIXEL} × 1;
 *   - a multisample colour renderbuffer: {@link COLOR_BYTES_PER_PIXEL} × {@link SAMPLES};
 *   - a multisample depth renderbuffer: {@link DEPTH_BYTES_PER_PIXEL} × {@link SAMPLES}.
 * At {@link SAMPLES} = 4 that is 4 + 16 + 16 = 36 bytes/pixel.
 *
 * v1 (and this file until now) charged a flat 8 bytes/pixel (`colour × 2`),
 * which under-counts the real allocation ~4.5×. The eviction pass in
 * compositor-pass.ts trusts `bytesUsed()` against RUNTIME_BUDGETS.fboBytes
 * (256 MB), so the undercount let real GPU use approach a gigabyte before
 * eviction fired. The model below charges the true figure so the budget bounds
 * reality.
 *
 * Single-sample ({@link SAMPLES} ≤ 1): the texture IS the colour buffer — no
 * separate resolve, no multisample multiplier — so it degrades to colour + depth.
 */
const COLOR_BYTES_PER_PIXEL = 4;

/** Depth renderbuffer bytes per pixel (three's default depth24). */
const DEPTH_BYTES_PER_PIXEL = 4;

/**
 * MSAA sample count. Matches the canvas's antialias setting so island edges look
 * the same as a direct-to-canvas pass (v1 WidgetRenderTargetPool.ts:73).
 */
const SAMPLES = 4;

/** GPU bytes for one target at the given pixel size — see the allocation model above. */
export function renderTargetBytes(pixelWidth: number, pixelHeight: number): number {
  const msaa = SAMPLES > 1;
  const colorBytes = COLOR_BYTES_PER_PIXEL * (msaa ? 1 + SAMPLES : 1);
  const depthBytes = DEPTH_BYTES_PER_PIXEL * (msaa ? SAMPLES : 1);
  return pixelWidth * pixelHeight * (colorBytes + depthBytes);
}

interface PoolEntry {
  rt: WebGLRenderTarget;
  /** Pixel width = worldWidth × effectiveDpr, rounded, clamped ≥ 1. */
  pixelWidth: number;
  pixelHeight: number;
  effectiveDpr: number;
  bytes: number;
  /** Injected-clock timestamp of the most recent acquire/touch — drives LRU. */
  lastUsedMs: number;
}

/** Snapshot row returned by {@link RenderTargetPool.entryInfos}. */
export interface PoolEntryInfo {
  key: number;
  bytes: number;
  lastUsedMs: number;
  pinned: boolean;
}

export interface PoolPin {
  readonly keys: readonly number[];
  release(): void;
}

export class RenderTargetPool {
  private entries = new Map<number, PoolEntry>();
  private totalBytes = 0;
  private pins = new Map<number, number>();
  /**
   * Targets replaced while PINNED — kept alive until the pin releases.
   * A pin means something is sampling that texture right now (a retained
   * outgoing quad holds it by reference through its own material), so
   * disposing it on a resize would destroy the reader's texture mid-fade.
   */
  private retired = new Map<number, Array<{ rt: WebGLRenderTarget; bytes: number }>>();
  private disposed = false;
  private readonly now: () => number;

  /**
   * @param now Injected monotonic clock for LRU timestamps. Defaults to
   *   `performance.now()`; tests pass a deterministic stub so `lastUsedMs`
   *   assertions do not depend on wall-clock timing.
   */
  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  /**
   * Get or create an FBO for `key` at the requested world size and effective
   * device-pixel-ratio. Returns the existing target unchanged when its pixel
   * dimensions already match; otherwise disposes the stale target and allocates
   * a new one sized to the new resolution.
   */
  acquire(key: number, worldW: number, worldH: number, effectiveDpr: number): WebGLRenderTarget {
    if (this.disposed) {
      throw new Error("RenderTargetPool: cannot acquire after dispose");
    }
    const pixelWidth = Math.max(1, Math.round(worldW * effectiveDpr));
    const pixelHeight = Math.max(1, Math.round(worldH * effectiveDpr));
    const nowMs = this.now();

    const existing = this.entries.get(key);
    if (existing && existing.pixelWidth === pixelWidth && existing.pixelHeight === pixelHeight) {
      existing.lastUsedMs = nowMs;
      return existing.rt;
    }

    if (existing) {
      if (this.isPinned(key)) {
        // PINNED MEANS IN USE, and a resize is not a licence to destroy it.
        // `release()` has always refused a pinned row and the compositor's
        // eviction pass calls pinned targets immune, but the resize path here
        // disposed one outright — and the reader it would take out is the
        // retained quad of an outgoing nav frame, which samples this exact
        // texture for the length of the fade. Retire it instead: the island
        // gets its new target now, the clone keeps the pixels it is drawing,
        // and the pin's release frees the old one. Its bytes stay counted
        // until then, because it is still allocated.
        const held = this.retired.get(key);
        if (held === undefined) this.retired.set(key, [{ rt: existing.rt, bytes: existing.bytes }]);
        else held.push({ rt: existing.rt, bytes: existing.bytes });
      } else {
        existing.rt.dispose();
        this.totalBytes -= existing.bytes;
      }
    }

    const rt = new WebGLRenderTarget(pixelWidth, pixelHeight, { samples: SAMPLES });
    // sRGB colour space — without this, Three writes tone-mapped LINEAR values
    // to the FBO. The composite shader samples raw and outputs raw, and the
    // canvas backbuffer would then read the linear values as sRGB → washed-out /
    // dark. SRGBColorSpace tells Three's built-in materials to sRGB-encode when
    // writing here, so the FBO already holds display-ready values (design-004 §3;
    // the composite shader must NOT re-encode — see composite-material.ts).
    rt.texture.colorSpace = SRGBColorSpace;
    const bytes = renderTargetBytes(pixelWidth, pixelHeight);
    this.entries.set(key, { rt, pixelWidth, pixelHeight, effectiveDpr, bytes, lastUsedMs: nowMs });
    this.totalBytes += bytes;
    return rt;
  }

  /** Look up an FBO without creating one. */
  get(key: number): WebGLRenderTarget | null {
    return this.entries.get(key)?.rt ?? null;
  }

  /**
   * Refresh `lastUsedMs` without re-acquiring. The compositor calls this for
   * every island it samples in the composition pass — without it, warm islands
   * that never repaint would freeze their timestamp at their last paint and the
   * LRU would treat still-visible islands as stale (design-004 §3).
   */
  touch(key: number): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.lastUsedMs = this.now();
  }

  /**
   * Release `key`'s FBO. Returns true if something was released. Safe after
   * dispose — returns false rather than corrupting the byte counter or
   * double-disposing the target.
   */
  release(key: number, force = false): boolean {
    if (this.disposed) return false;
    if (!force && (this.pins.get(key) ?? 0) > 0) return false;
    const entry = this.entries.get(key);
    if (!entry) return false;
    entry.rt.dispose();
    // Clamp at zero so out-of-order teardown never drives the counter negative.
    this.totalBytes = Math.max(0, this.totalBytes - entry.bytes);
    this.entries.delete(key);
    return true;
  }

  /** Total GPU bytes consumed by the pool. */
  bytesUsed(): number {
    return this.totalBytes;
  }

  /** Total pool bytes after acquiring/replacing this key at the requested size. */
  projectedBytes(
    key: number,
    worldW: number,
    worldH: number,
    effectiveDpr: number,
  ): number {
    const pixelWidth = Math.max(1, Math.round(worldW * effectiveDpr));
    const pixelHeight = Math.max(1, Math.round(worldH * effectiveDpr));
    const existing = this.entries.get(key)?.bytes ?? 0;
    return this.totalBytes - existing + renderTargetBytes(pixelWidth, pixelHeight);
  }

  /** Number of FBOs currently held. */
  size(): number {
    return this.entries.size;
  }

  isPinned(key: number): boolean {
    return (this.pins.get(key) ?? 0) > 0;
  }

  /** Pin existing textures for one outgoing GL presentation. */
  pin(keys: readonly number[]): PoolPin {
    const retained = [...new Set(keys)].filter((key) => this.entries.has(key));
    for (const key of retained) this.pins.set(key, (this.pins.get(key) ?? 0) + 1);
    let released = false;
    return {
      keys: Object.freeze(retained),
      release: () => {
        if (released) return;
        released = true;
        for (const key of retained) {
          const refs = this.pins.get(key) ?? 0;
          if (refs > 1) {
            this.pins.set(key, refs - 1);
            continue;
          }
          this.pins.delete(key);
          // Last reader gone: anything this key outgrew while pinned is now
          // free to go, and its bytes come back with it.
          for (const stale of this.retired.get(key) ?? []) {
            stale.rt.dispose();
            this.totalBytes = Math.max(0, this.totalBytes - stale.bytes);
          }
          this.retired.delete(key);
        }
      },
    };
  }

  /** True after `dispose()` — callers should re-create the pool instead of using it. */
  isDisposed(): boolean {
    return this.disposed;
  }

  /** Iterate live entries (key + target). */
  forEach(cb: (key: number, rt: WebGLRenderTarget) => void): void {
    for (const [key, entry] of this.entries) cb(key, entry.rt);
  }

  /**
   * Snapshot of every live entry's `bytes` + `lastUsedMs` — the input an
   * eviction pass ranks by LRU.
   */
  entryInfos(): PoolEntryInfo[] {
    const out: PoolEntryInfo[] = [];
    for (const [key, entry] of this.entries) {
      out.push({
        key,
        bytes: entry.bytes,
        lastUsedMs: entry.lastUsedMs,
        pinned: this.isPinned(key),
      });
    }
    return out;
  }

  /** Dispose every FBO. After this, acquire throws and release returns false. */
  dispose(): void {
    if (this.disposed) return;
    for (const entry of this.entries.values()) entry.rt.dispose();
    for (const held of this.retired.values()) for (const stale of held) stale.rt.dispose();
    this.retired.clear();
    this.entries.clear();
    this.pins.clear();
    this.totalBytes = 0;
    this.disposed = true;
  }
}
