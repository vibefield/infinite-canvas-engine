/**
 * The island → registry binder: publication lifecycle and the orientation
 * contract.
 *
 * Driven against core's REAL registry, because the properties that matter here
 * are the registry's own guarantees seen from the producer side — identity-bound
 * disposers, revision-as-dirt, replace-without-unregister — and a fake registry
 * would just re-assert my own assumptions about them.
 */
import { describe, expect, it, vi } from "vitest";
import { createCompositorSourceRegistry, type Entity } from "@ice/core";
import { createIslandSourceBinder, type GlSourcePoolLike } from "../src/webgpu-sources";

function fakePool(overrides: Partial<GlSourcePoolLike> = {}): GlSourcePoolLike & {
  textures: Map<number, GPUTexture | undefined>;
} {
  const textures = new Map<number, GPUTexture | undefined>();
  return {
    textures,
    gpuTexture: (key) => textures.get(key),
    isSrgb: () => true,
    ...overrides,
  };
}

describe("publication lifecycle", () => {
  it("publish is idempotent and does not churn the registry revision", () => {
    const registry = createCompositorSourceRegistry();
    const binder = createIslandSourceBinder({ registry, pool: fakePool() });

    binder.publish(1);
    const afterFirst = registry.revision();
    binder.publish(1);
    binder.publish(1);

    // Revision IS the compositor's dirt input (plan §4.3): a re-publish that
    // bumped it would wake the compositor every frame for an island that never
    // changed, which is exactly the idle-zero regression the reflector's
    // named dirt sources exist to make diagnosable.
    expect(registry.revision()).toBe(afterFirst);
    expect(registry.size()).toBe(1);
    expect(binder.keys()).toEqual([1]);
  });

  it("withdraw is idempotent and safe for a key never published", () => {
    const registry = createCompositorSourceRegistry();
    const binder = createIslandSourceBinder({ registry, pool: fakePool() });

    binder.publish(1);
    binder.withdraw(1);
    const after = registry.revision();
    binder.withdraw(1);
    binder.withdraw(404);

    expect(registry.revision()).toBe(after);
    expect(registry.size()).toBe(0);
    expect(binder.keys()).toEqual([]);
  });

  it("dispose withdraws everything it published, and nothing it did not", () => {
    const registry = createCompositorSourceRegistry();
    const binder = createIslandSourceBinder({ registry, pool: fakePool() });
    // A source someone ELSE owns — a dom host, say. The binder must not evict it.
    registry.register(99 as Entity, { kind: "dom", host: {} });

    binder.publish(1);
    binder.publish(2);
    binder.dispose();

    expect(registry.size()).toBe(1);
    expect(registry.get(99 as Entity)?.kind).toBe("dom");
    expect(binder.keys()).toEqual([]);
  });

  it("a withdrawn key can be republished (re-entry after a cull)", () => {
    const registry = createCompositorSourceRegistry();
    const binder = createIslandSourceBinder({ registry, pool: fakePool() });
    binder.publish(1);
    binder.withdraw(1);
    binder.publish(1);
    expect(registry.size()).toBe(1);
    expect(registry.get(1 as Entity)?.kind).toBe("gl");
  });

  // The registry's disposers are identity-bound; the binder must not defeat
  // that by holding a disposer across someone else's replacement.
  it("does not evict a replacement source registered by another producer", () => {
    const registry = createCompositorSourceRegistry();
    const binder = createIslandSourceBinder({ registry, pool: fakePool() });
    binder.publish(1);
    // Promotion swaps this entity's source without an unregister step.
    registry.register(1 as Entity, { kind: "dom", host: {} });

    binder.withdraw(1);

    expect(registry.get(1 as Entity)?.kind).toBe("dom");
    expect(registry.size()).toBe(1);
  });
});

describe("paint dirt", () => {
  it("fires only for a published key", () => {
    const registry = createCompositorSourceRegistry();
    const onPaint = vi.fn();
    const binder = createIslandSourceBinder({ registry, pool: fakePool(), onPaint });

    binder.painted(1); // not published yet — its publish raises membership dirt
    expect(onPaint).not.toHaveBeenCalled();

    binder.publish(1);
    binder.painted(1);
    expect(onPaint).toHaveBeenCalledTimes(1);

    binder.withdraw(1);
    binder.painted(1);
    expect(onPaint).toHaveBeenCalledTimes(1);
  });

  it("works with no consumer wired", () => {
    const registry = createCompositorSourceRegistry();
    const binder = createIslandSourceBinder({ registry, pool: fakePool() });
    binder.publish(1);
    expect(() => binder.painted(1)).not.toThrow();
  });
});

describe("the published source reads through the pool, never a snapshot", () => {
  it("reflects a texture that appears after registration (three allocates lazily)", () => {
    const registry = createCompositorSourceRegistry();
    const pool = fakePool();
    const binder = createIslandSourceBinder({ registry, pool });

    binder.publish(1);
    const source = registry.get(1 as Entity);
    if (source?.kind !== "gl") throw new Error("expected a gl source");
    // Registered before the first paint: nothing to sample yet, and saying so
    // is the contract — a compositor asking early gets undefined, not a guess.
    expect(source.texture()).toBeUndefined();

    const gpu = { label: "a" } as unknown as GPUTexture;
    pool.textures.set(1, gpu);
    expect(source.texture()).toBe(gpu);

    const replacement = { label: "b" } as unknown as GPUTexture;
    pool.textures.set(1, replacement);
    expect(source.texture()).toBe(replacement);
  });

  /**
   * THE ORIENTATION CONTRACT (design-012 §1.2 gotcha 7: "three renders y-up vs
   * a VideoFrame's y-down — flip the islands").
   *
   * r3f publishes three's render target EXACTLY as three produced it, with no
   * orientation fix-up anywhere on this side. That is a decision, not an
   * omission: the compositor samples dom slots, gl islands and video frames
   * into ONE pass, and those three kinds do not share an origin convention. A
   * flip applied here would be invisible to the shader that has to reconcile
   * them, and two half-flips are how an image ends up mirrored in one profile
   * and not the other.
   *
   * So this test pins the negative: nothing between the pool and the registry
   * touches orientation. The positive — that the composited board is the right
   * way up — is a GPU fact and is witnessed by readback in the Electron rig,
   * where an asymmetric island proves which row the content actually lands on.
   */
  it("publishes the target unflipped — orientation is the compositor's job", () => {
    const registry = createCompositorSourceRegistry();
    const gpu = { label: "raw" } as unknown as GPUTexture;
    const pool = fakePool();
    pool.textures.set(1, gpu);
    const binder = createIslandSourceBinder({ registry, pool });
    binder.publish(1);

    const source = registry.get(1 as Entity);
    if (source?.kind !== "gl") throw new Error("expected a gl source");
    // Reference identity: the very texture three resolved, handed over whole.
    expect(source.texture()).toBe(gpu);
    // And the source carries no orientation field for anyone to disagree about.
    expect(Object.keys(source).sort()).toEqual(["kind", "srgb", "texture"]);
  });
});
