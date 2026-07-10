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
 * Colour bytes per pixel for the default RGBA8 render-target format.
 *
 * v1 accounted a flat `BYTES_PER_PIXEL = 8` constant
 * (WidgetRenderTargetPool.ts:8) reasoning "RGBA8 colour + packed depth/stencil".
 * We keep the identical byte total but express it in the design-004 §3 form
 * `colour × (samples > 1 ? 2 : 1)`: 4 colour bytes, doubled when MSAA adds the
 * resolve buffer. Because {@link SAMPLES} is 4 (> 1) this yields 8 bytes/pixel —
 * byte-for-byte the v1 figure — while remaining correct if the sample count ever
 * changes.
 */
const COLOR_BYTES_PER_PIXEL = 4;

/**
 * MSAA sample count. Matches the canvas's antialias setting so island edges look
 * the same as a direct-to-canvas pass (v1 WidgetRenderTargetPool.ts:73).
 */
const SAMPLES = 4;

/** GPU bytes for one target at the given pixel size (see {@link COLOR_BYTES_PER_PIXEL}). */
function targetBytes(pixelWidth: number, pixelHeight: number): number {
  return pixelWidth * pixelHeight * COLOR_BYTES_PER_PIXEL * (SAMPLES > 1 ? 2 : 1);
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
}

export class RenderTargetPool {
  private entries = new Map<number, PoolEntry>();
  private totalBytes = 0;
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
      existing.rt.dispose();
      this.totalBytes -= existing.bytes;
    }

    const rt = new WebGLRenderTarget(pixelWidth, pixelHeight, { samples: SAMPLES });
    // sRGB colour space — without this, Three writes tone-mapped LINEAR values
    // to the FBO. The composite shader samples raw and outputs raw, and the
    // canvas backbuffer would then read the linear values as sRGB → washed-out /
    // dark. SRGBColorSpace tells Three's built-in materials to sRGB-encode when
    // writing here, so the FBO already holds display-ready values (design-004 §3;
    // the composite shader must NOT re-encode — see composite-material.ts).
    rt.texture.colorSpace = SRGBColorSpace;
    const bytes = targetBytes(pixelWidth, pixelHeight);
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
  release(key: number): boolean {
    if (this.disposed) return false;
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

  /** Number of FBOs currently held. */
  size(): number {
    return this.entries.size;
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
      out.push({ key, bytes: entry.bytes, lastUsedMs: entry.lastUsedMs });
    }
    return out;
  }

  /** Dispose every FBO. After this, acquire throws and release returns false. */
  dispose(): void {
    if (this.disposed) return;
    for (const entry of this.entries.values()) entry.rt.dispose();
    this.entries.clear();
    this.totalBytes = 0;
    this.disposed = true;
  }
}
