/**
 * The island FBO pool for the composited profile (design-012 §4 "island (gl)":
 * "the FBO pool, zoom bands, paint-DPR caps, phase machine, stagger and
 * dt-banking carry over with the API swapped under them").
 *
 * This is `pool.ts` with exactly one thing changed: the target class. Every
 * policy — acquire-or-resize, LRU timestamps on an injected clock, pins,
 * byte accounting against the shared budget, disposed-awareness — is the same
 * constitution, because design-012 §7 lists the texture pool under "survives
 * unchanged (API swapped beneath)". Divergence here would be a silent
 * re-litigation of design-004 §3.
 *
 * WHY A SECOND FILE rather than a generic over the target type: the two pools
 * differ in what they can answer, not only in what they allocate. This one can
 * report the raw `GPUTexture` and its ACTUAL format (the compositor's whole
 * reason for existing); the WebGL one cannot, and a shared abstraction would
 * have to pretend otherwise. They meet at `PoolLike` in `compositor-pass.ts`,
 * which is the seam the frame pass actually needs, and nowhere else.
 *
 * `RenderTarget` comes from the `three` ROOT entry (`Three.Core.js:92`), not
 * from `three/webgpu`: it is the backend-neutral base class, so this file adds
 * no `three/webgpu` edge to the module graph. That matters — three declares
 * `sideEffects: ["./src/nodes/**\/*"]`, so a `three/webgpu` import is not
 * tree-shaken, and putting one here would push the node material system into
 * every stratified app's bundle.
 */
import { RenderTarget, SRGBColorSpace } from "three";
import {
  islandIsMultisampled,
  islandIsSrgb,
  islandTexture,
  type RenderTargetTexture,
  type WebGpuRendererLike,
} from "./webgpu-backend";
import type { PoolEntryInfo, PoolPin } from "./pool";

/**
 * MSAA sample count inside island targets — the same 4 the WebGL pool uses.
 *
 * design-012 §4: "MSAA lives inside island render targets only", and the
 * compositor target itself stays MSAA-free (its quad edges are analytic
 * rounded-rect AA, and the ground lattice is smoothstepped). So this number is
 * the ONLY MSAA in the composited profile, which is why
 * `acquireCompositorDevice`'s rule 1 (never ask for a compatibility adapter)
 * is load-bearing rather than defensive: on a compatibility device three sets
 * `renderer._samples = 0` and this 4 silently becomes 1.
 */
export const WEBGPU_ISLAND_SAMPLES = 4;

/**
 * GPU bytes for one WebGPU island target.
 *
 * Same three-surface allocation model as the WebGL pool, re-derived against
 * what three actually creates rather than carried over on faith:
 *   - the resolve texture, single-sample (`WebGPUTextureUtils.js:374` with
 *     `primarySamples = 1` from `WebGPUUtils.js:128`) — 4 bytes/px;
 *   - `msaaTexture` at `sampleCount = samples` (`:413-416`) — 4 × samples;
 *   - the depth texture, also multisampled — 4 × samples.
 * At 4 samples that is 4 + 16 + 16 = 36 bytes/px, identical to the WebGL
 * figure, so the two profiles are graded against the same budget and a
 * cross-profile memory comparison stays honest.
 */
export function webGpuRenderTargetBytes(pixelWidth: number, pixelHeight: number): number {
  const msaa = WEBGPU_ISLAND_SAMPLES > 1;
  const colorBytes = 4 * (msaa ? 1 + WEBGPU_ISLAND_SAMPLES : 1);
  const depthBytes = 4 * (msaa ? WEBGPU_ISLAND_SAMPLES : 1);
  return pixelWidth * pixelHeight * (colorBytes + depthBytes);
}

interface PoolEntry {
  rt: RenderTarget;
  pixelWidth: number;
  pixelHeight: number;
  effectiveDpr: number;
  bytes: number;
  lastUsedMs: number;
}

export interface WebGpuRenderTargetPoolOpts {
  /**
   * The renderer whose backend holds the GPU objects. Injected as a GETTER
   * because the pool outlives no renderer but is constructed before one exists:
   * `<Canvas gl={…}>` resolves its renderer asynchronously (three's `init()` is
   * a promise), so a value captured at construction would be `undefined`
   * forever.
   */
  readonly renderer: () => WebGpuRendererLike | undefined;
  /** Injected monotonic clock for LRU timestamps (tests pass a stub). */
  readonly now?: () => number;
}

/**
 * Per-island WebGPU render targets, keyed by entity id. Imports nothing from
 * the ECS — a pure three resource, exactly as design-004 §3 requires of the
 * WebGL pool.
 */
export class WebGpuRenderTargetPool {
  private entries = new Map<number, PoolEntry>();
  private totalBytes = 0;
  private pins = new Map<number, number>();
  /**
   * Targets replaced while PINNED — kept alive until the pin releases.
   * A pin means something is sampling that texture right now (a retained
   * outgoing quad holds it by reference through its own material), so
   * disposing it on a resize would destroy the reader's texture mid-fade.
   */
  private retired = new Map<number, Array<{ rt: RenderTarget; bytes: number }>>();
  private disposed = false;
  private readonly now: () => number;
  private readonly rendererOf: () => WebGpuRendererLike | undefined;

  constructor(opts: WebGpuRenderTargetPoolOpts) {
    this.rendererOf = opts.renderer;
    this.now = opts.now ?? ((): number => performance.now());
  }

  /**
   * Get or create a target for `key` at the requested world size and effective
   * DPR. Returns the existing target unchanged when its pixel dimensions already
   * match; otherwise disposes the stale one and allocates at the new resolution.
   */
  acquire(key: number, worldW: number, worldH: number, effectiveDpr: number): RenderTarget {
    if (this.disposed) {
      throw new Error("WebGpuRenderTargetPool: cannot acquire after dispose");
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
        // WHY RETIRE RATHER THAN SIMPLY HAND THE PINNED TARGET BACK (the
        // shorter fix, weighed and rejected 2026-08-31): the caller paints into
        // whatever this returns and then stamps the size it ASKED for.
        // `markPainted` writes the new band into `paintedAt` (island-state.ts)
        // and `bandStale` reads exactly that field (compositor-pass.ts), so an
        // old-size target handed back would go on record as correctly banded —
        // and a Dormant retained island would then sit at the wrong resolution
        // with nothing left to trigger the resize. It would also render INTO
        // the texture the frozen outgoing clone is sampling, which is the one
        // thing the pin exists to prevent.
        const held = this.retired.get(key);
        if (held === undefined) this.retired.set(key, [{ rt: existing.rt, bytes: existing.bytes }]);
        else held.push({ rt: existing.rt, bytes: existing.bytes });
      } else {
        existing.rt.dispose();
        this.totalBytes -= existing.bytes;
      }
    }

    const rt = new RenderTarget(pixelWidth, pixelHeight, {
      samples: WEBGPU_ISLAND_SAMPLES,
      depthBuffer: true,
      stencilBuffer: false,
    });
    // Declaring the colour space is what makes three's materials sRGB-ENCODE on
    // write, so the target holds display-ready values — the same contract the
    // WebGL pool states. The consequence differs though, and it is the sRGB law
    // (design-012 §4): three backs an SRGBColorSpace target with an `-srgb` GPU
    // format, whose sampler DECODES to linear on read, while the swap chain
    // cannot be `-srgb`. So the compositor MUST re-encode — guarded by the
    // format `islandIsSrgb()` reads back, never by this line, because this line
    // is a request and that one is the answer.
    rt.texture.colorSpace = SRGBColorSpace;
    rt.texture.name = `ice:island:${key}`;
    const bytes = webGpuRenderTargetBytes(pixelWidth, pixelHeight);
    this.entries.set(key, { rt, pixelWidth, pixelHeight, effectiveDpr, bytes, lastUsedMs: nowMs });
    this.totalBytes += bytes;
    return rt;
  }

  get(key: number): RenderTarget | null {
    return this.entries.get(key)?.rt ?? null;
  }

  /** Refresh `lastUsedMs` without re-acquiring (every composited island, per pass). */
  touch(key: number): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.lastUsedMs = this.now();
  }

  release(key: number, force = false): boolean {
    if (this.disposed) return false;
    if (!force && (this.pins.get(key) ?? 0) > 0) return false;
    const entry = this.entries.get(key);
    if (!entry) return false;
    entry.rt.dispose();
    this.totalBytes = Math.max(0, this.totalBytes - entry.bytes);
    this.entries.delete(key);
    return true;
  }

  bytesUsed(): number {
    return this.totalBytes;
  }

  projectedBytes(key: number, worldW: number, worldH: number, effectiveDpr: number): number {
    const pixelWidth = Math.max(1, Math.round(worldW * effectiveDpr));
    const pixelHeight = Math.max(1, Math.round(worldH * effectiveDpr));
    const existing = this.entries.get(key)?.bytes ?? 0;
    return this.totalBytes - existing + webGpuRenderTargetBytes(pixelWidth, pixelHeight);
  }

  size(): number {
    return this.entries.size;
  }

  isPinned(key: number): boolean {
    return (this.pins.get(key) ?? 0) > 0;
  }

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

  isDisposed(): boolean {
    return this.disposed;
  }

  forEach(cb: (key: number, rt: RenderTarget) => void): void {
    for (const [key, entry] of this.entries) cb(key, entry.rt);
  }

  entryInfos(): PoolEntryInfo[] {
    const out: PoolEntryInfo[] = [];
    for (const [key, entry] of this.entries) {
      out.push({ key, bytes: entry.bytes, lastUsedMs: entry.lastUsedMs, pinned: this.isPinned(key) });
    }
    return out;
  }

  // --- the compositor-facing half (what the WebGL pool cannot answer) --------

  /** The three-side texture object for `key` — the argument to the backend read. */
  targetTexture(key: number): RenderTargetTexture | undefined {
    return this.entries.get(key)?.rt.texture;
  }

  /**
   * The raw resolved `GPUTexture` for `key`, or `undefined` before its first
   * paint (three allocates lazily). This is what a registered `gl` source's
   * `texture()` getter returns — a getter, not a captured value, because a
   * zoom-band or DPR change reallocates the target underneath it.
   */
  gpuTexture(key: number): GPUTexture | undefined {
    const texture = this.targetTexture(key);
    return texture === undefined ? undefined : islandTexture(this.rendererOf(), texture);
  }

  /** Whether `key`'s ACTUAL GPU format is an `-srgb` one — the re-encode guard. */
  isSrgb(key: number): boolean {
    const texture = this.targetTexture(key);
    return texture === undefined ? false : islandIsSrgb(this.rendererOf(), texture);
  }

  /** Whether the GPU really allocated a multisampled surface for `key`. */
  isMultisampled(key: number): boolean {
    const texture = this.targetTexture(key);
    return texture === undefined ? false : islandIsMultisampled(this.rendererOf(), texture);
  }

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
