/**
 * Islands → `CompositorSourceRegistry` (design-012 plan §1: "`gl` sources by
 * r3f (a getter for the raw `GPUTexture` — the `backend.get(rt.texture).texture`
 * read stays inside r3f)").
 *
 * This is the whole of r3f's outbound seam in the composited profile. r3f does
 * NOT import `ground`, does not know a quad pass exists, and publishes no
 * transforms: an island's rect, opacity and paint order are ECS facts the
 * compositor reads for itself (Position/Size/Opacity plus the sibling-order
 * index), so duplicating them here would create a second source of truth for
 * geometry that petition 8 already settled.
 *
 * What r3f alone knows, and therefore all this publishes, is: which entities
 * have a live island target, how to reach its `GPUTexture` right now, and
 * whether that texture's format needs the sRGB re-encode.
 *
 * TWO KINDS OF DIRT, deliberately separated (design-004 §3's two-level
 * invalidation, carried into §4.3's dirty union):
 *
 *  - MEMBERSHIP dirt — an island appeared or went away. The registry raises it
 *    itself: `register`/`unregister` bump `revision()` and fire `onChange`,
 *    which ground's compositor reflector already latches as `"promotion"`.
 *  - PAINT dirt — the same texture object, new pixels in it. NOTHING about the
 *    registry changes, so nothing fires, and a compositor that only watched
 *    membership would show the first frame of an animating island forever.
 *    `onPaint` is that signal, and it is the reason this binder exists as a
 *    seam rather than as two inline `registry.register` calls.
 */
import type { CompositorSourceRegistry, Entity } from "@ice/core";

/**
 * What the binder needs of a pool. Structural so the headless tests drive it
 * with a fake and so the WebGL pool is a compile-time impossibility here.
 */
export interface GlSourcePoolLike {
  gpuTexture(key: number): GPUTexture | undefined;
  isSrgb(key: number): boolean;
}

export interface IslandSourceBinderOpts {
  readonly registry: CompositorSourceRegistry;
  readonly pool: GlSourcePoolLike;
  /**
   * Latch compositor PAINT dirt. Called when an island repaints into a texture
   * the compositor is already sampling — see the header. Optional: a binder
   * with no consumer still keeps the registry correct.
   */
  readonly onPaint?: () => void;
}

/**
 * The frame pass's view of source membership — deliberately the same shape as
 * `QuadsLike`, because in the composited profile publishing a source IS what
 * ensuring a quad was in the stratified one. The pass therefore reconciles the
 * same way against either, and the profile branch stays one `if`.
 */
export interface SourcesLike {
  /** Publish `key` as a composited `gl` source. Idempotent. */
  publish(key: number): void;
  /** Withdraw `key`'s source. Idempotent, and safe for a key never published. */
  withdraw(key: number): void;
  /** Keys this binder currently has published (NOT the whole registry). */
  keys(): readonly number[];
  /** Note that `key` repainted — raises paint dirt if it is published. */
  painted(key: number): void;
}

export interface IslandSourceBinder extends SourcesLike {
  /** Withdraw everything this binder published (Canvas teardown). */
  dispose(): void;
}

export function createIslandSourceBinder(opts: IslandSourceBinderOpts): IslandSourceBinder {
  const { registry, pool } = opts;
  /** key → the identity-bound disposer the registry handed back. */
  const published = new Map<number, () => void>();

  return {
    publish(key) {
      if (published.has(key)) return; // idempotent: re-publishing would churn revision()
      // GETTERS, not values. The target is reallocated on zoom-band and
      // paint-DPR changes (design-004 §3, which §4 carries over verbatim), so a
      // handle captured at registration goes stale the first time the camera
      // crosses a band — and a stale GPUTexture is not an error the compositor
      // can see, it is a frame of the wrong pixels. Reading through the pool by
      // KEY makes reallocation invisible to the consumer.
      const dispose = registry.register(key as Entity, {
        kind: "gl",
        texture: () => pool.gpuTexture(key),
        srgb: () => pool.isSrgb(key),
      });
      published.set(key, dispose);
    },

    withdraw(key) {
      const dispose = published.get(key);
      if (dispose === undefined) return;
      published.delete(key);
      // Identity-bound (core's registry contract): if something re-registered
      // this entity in between, this disposer owns nothing and does nothing.
      dispose();
    },

    keys: () => [...published.keys()],

    painted(key) {
      // Only a PUBLISHED island's repaint is compositor dirt. An island painting
      // before it is published (its very first paint, which is what makes it
      // publishable) is not — the publish that follows raises membership dirt of
      // its own, and marking here too would double-wake the same frame.
      if (published.has(key)) opts.onPaint?.();
    },

    dispose() {
      for (const dispose of published.values()) dispose();
      published.clear();
    },
  };
}
