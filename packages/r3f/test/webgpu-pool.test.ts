/**
 * The WebGPU island pool — design-004 §3's constitution, API swapped beneath
 * (design-012 §7 lists the texture pool under "survives unchanged").
 *
 * These mirror `pool.test.ts` deliberately. The point of the mirror is that the
 * two profiles must be graded against the SAME policy: if the WebGPU pool were
 * allowed to drift on resize semantics, LRU, pins or byte accounting, then a
 * stratified-vs-composited memory or eviction comparison would be measuring the
 * pools rather than the profiles.
 *
 * Plus the half the WebGL pool cannot answer at all: the raw GPUTexture, the
 * actual format, and whether MSAA really survived.
 */
import { describe, expect, it, vi } from "vitest";
import { RenderTarget, SRGBColorSpace } from "three";
import {
  WEBGPU_ISLAND_SAMPLES,
  WebGpuRenderTargetPool,
  webGpuRenderTargetBytes,
} from "../src/webgpu-pool";
import type { BackendTextureRecord } from "../src/webgpu-backend";

/** Deterministic clock, so LRU assertions never depend on wall time. */
function clock(): { now: () => number; tick: (ms?: number) => void } {
  let t = 0;
  return { now: () => t, tick: (ms = 1) => { t += ms; } };
}

function pool(renderer: () => object | undefined = () => undefined): {
  pool: WebGpuRenderTargetPool;
  tick: (ms?: number) => void;
} {
  const c = clock();
  return {
    pool: new WebGpuRenderTargetPool({ renderer: renderer as never, now: c.now }),
    tick: c.tick,
  };
}

describe("acquire / resize / release", () => {
  it("returns the SAME target when the pixel size is unchanged", () => {
    const { pool: p } = pool();
    const a = p.acquire(1, 100, 50, 2);
    const b = p.acquire(1, 100, 50, 2);
    expect(b).toBe(a);
    expect(p.size()).toBe(1);
  });

  it("reallocates when effective DPR changes the pixel size (the band/DPR path)", () => {
    const { pool: p } = pool();
    const a = p.acquire(1, 100, 50, 1);
    const disposed = vi.spyOn(a, "dispose");
    const b = p.acquire(1, 100, 50, 2);
    // UNPINNED is the ordinary path and must stay ordinary: the old target is
    // disposed here and now. The retirement below is for pinned rows ONLY —
    // retiring everything would leak a target per band crossing.
    expect(disposed).toHaveBeenCalledTimes(1);
    // This is exactly why a registered source publishes a GETTER and not a
    // handle: crossing a zoom band swaps the object underneath it.
    expect(b).not.toBe(a);
    expect(p.size()).toBe(1);
    expect(b.width).toBe(200);
    expect(b.height).toBe(100);
  });

  it("clamps to at least one pixel rather than allocating a zero-size target", () => {
    const { pool: p } = pool();
    const rt = p.acquire(1, 0.1, 0.1, 0.1);
    expect(rt.width).toBe(1);
    expect(rt.height).toBe(1);
  });

  it("release frees bytes; a second release is a no-op", () => {
    const { pool: p } = pool();
    p.acquire(1, 100, 100, 1);
    expect(p.bytesUsed()).toBe(webGpuRenderTargetBytes(100, 100));
    expect(p.release(1)).toBe(true);
    expect(p.release(1)).toBe(false);
    expect(p.bytesUsed()).toBe(0);
    expect(p.size()).toBe(0);
  });
});

describe("the three-surface byte model", () => {
  // Re-derived against what three actually creates (see webgpu-pool.ts header):
  // resolve texture 4 B/px + msaaTexture 4×samples + depth 4×samples.
  it("charges 36 bytes/pixel at 4 samples, matching the WebGL pool's figure", () => {
    expect(WEBGPU_ISLAND_SAMPLES).toBe(4);
    expect(webGpuRenderTargetBytes(1, 1)).toBe(36);
    expect(webGpuRenderTargetBytes(100, 50)).toBe(100 * 50 * 36);
  });

  it("projectedBytes reports the total AFTER a replace, not the delta", () => {
    const { pool: p } = pool();
    p.acquire(1, 100, 100, 1); // 100×100
    p.acquire(2, 10, 10, 1);
    const projected = p.projectedBytes(1, 200, 200, 1);
    // key 1's old bytes come out, its new bytes go in, key 2 is untouched.
    expect(projected).toBe(webGpuRenderTargetBytes(200, 200) + webGpuRenderTargetBytes(10, 10));
  });
});

describe("LRU + pins", () => {
  it("touch refreshes lastUsedMs without reallocating", () => {
    const { pool: p, tick } = pool();
    p.acquire(1, 10, 10, 1);
    tick(100);
    p.touch(1);
    expect(p.entryInfos()[0]?.lastUsedMs).toBe(100);
    expect(p.size()).toBe(1);
  });

  it("a pinned entry survives release until the pin is released", () => {
    const { pool: p } = pool();
    p.acquire(1, 10, 10, 1);
    const pin = p.pin([1]);
    expect(p.isPinned(1)).toBe(true);
    expect(p.release(1)).toBe(false);
    pin.release();
    expect(p.isPinned(1)).toBe(false);
    expect(p.release(1)).toBe(true);
  });

  it("never destroys a PINNED target on a resize — it retires it until the pin drops", () => {
    // A pin means something is sampling that texture right now: the retained
    // outgoing quad of a nav transition holds it by reference for the length
    // of the fade. A band or DPR change in that window used to dispose it
    // under the reader — and the window is real, because the transition
    // outlives `NavTransition.active` (the fast-fade branch), which is exactly
    // when the compositor unfreezes and repaints a band-stale island.
    const { pool: p } = pool();
    const before = p.acquire(1, 100, 100, 1);
    const disposed = vi.spyOn(before, "dispose");
    const pin = p.pin([1]);

    const after = p.acquire(1, 100, 100, 2); // a band step: new pixel size
    expect(after).not.toBe(before);
    expect(disposed).not.toHaveBeenCalled();
    expect(p.size()).toBe(1);
    // The live island gets a target at the NEW band, and the retired one keeps
    // its own pixels for the clone. Handing the pinned target back instead
    // would satisfy "not disposed" while leaving the island at the old
    // resolution — and `markPainted` would then record it as correctly banded.
    expect(after.width).toBe(200);
    expect(before.width).toBe(100);
    // Still allocated, so still charged.
    expect(p.bytesUsed()).toBe(
      webGpuRenderTargetBytes(100, 100) + webGpuRenderTargetBytes(200, 200),
    );

    pin.release();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(p.bytesUsed()).toBe(webGpuRenderTargetBytes(200, 200));
  });

  it("force releases through a pin (teardown)", () => {
    const { pool: p } = pool();
    p.acquire(1, 10, 10, 1);
    p.pin([1]);
    expect(p.release(1, true)).toBe(true);
  });
});

describe("the sRGB request", () => {
  it("declares SRGBColorSpace on every target, which is what makes three encode on write", () => {
    const { pool: p } = pool();
    const rt = p.acquire(7, 10, 10, 1);
    expect(rt.texture.colorSpace).toBe(SRGBColorSpace);
    // Named so a GPU label makes an island identifiable in a capture tool.
    expect(rt.texture.name).toBe("ice:island:7");
  });

  it("asks for MSAA inside the island target", () => {
    const { pool: p } = pool();
    expect(p.acquire(1, 10, 10, 1).samples).toBe(4);
  });
});

describe("the compositor-facing reads", () => {
  /**
   * A backend that answers for whatever target the pool allocated. The holder
   * indirection exists because the backend must ask the pool which texture it
   * is holding, while the pool needs the backend at construction — the same
   * chicken-and-egg the real wiring solves with a renderer getter.
   */
  function backedPool(record: BackendTextureRecord): WebGpuRenderTargetPool {
    const holder: { pool?: WebGpuRenderTargetPool } = {};
    const renderer = {
      backend: {
        get: (o: object) => (o === holder.pool?.targetTexture(1) ? record : undefined),
      },
    };
    holder.pool = new WebGpuRenderTargetPool({ renderer: () => renderer });
    return holder.pool;
  }

  it("reads the raw GPUTexture and format through the live target", () => {
    const gpu = { label: "g" } as unknown as GPUTexture;
    const p = backedPool({
      texture: gpu,
      msaaTexture: { label: "msaa" } as unknown as GPUTexture,
      textureDescriptorGPU: { format: "rgba8unorm-srgb" } as GPUTextureDescriptor,
    });
    p.acquire(1, 10, 10, 1);
    expect(p.gpuTexture(1)).toBe(gpu);
    expect(p.isSrgb(1)).toBe(true);
    expect(p.isMultisampled(1)).toBe(true);
  });

  it("answers undefined/false for a key with no target at all", () => {
    const p = backedPool({});
    expect(p.gpuTexture(99)).toBeUndefined();
    expect(p.isSrgb(99)).toBe(false);
    expect(p.isMultisampled(99)).toBe(false);
  });

  // The renderer arrives AFTER the pool is built (R3F awaits three's init()
  // before it commits), which is the whole reason it is injected as a getter.
  it("survives being read before a renderer exists", () => {
    const { pool: p } = pool(() => undefined);
    p.acquire(1, 10, 10, 1);
    expect(p.gpuTexture(1)).toBeUndefined();
    expect(p.isSrgb(1)).toBe(false);
  });
});

describe("dispose", () => {
  it("acquire throws after dispose; release goes quiet", () => {
    const { pool: p } = pool();
    p.acquire(1, 10, 10, 1);
    p.dispose();
    expect(p.isDisposed()).toBe(true);
    expect(p.bytesUsed()).toBe(0);
    expect(p.size()).toBe(0);
    expect(p.release(1)).toBe(false);
    expect(() => p.acquire(2, 10, 10, 1)).toThrow(/after dispose/);
  });

  it("forEach walks live targets", () => {
    const { pool: p } = pool();
    p.acquire(1, 10, 10, 1);
    p.acquire(2, 10, 10, 1);
    const seen: number[] = [];
    p.forEach((key, rt) => {
      seen.push(key);
      expect(rt).toBeInstanceOf(RenderTarget);
    });
    expect(seen.sort()).toEqual([1, 2]);
  });
});
