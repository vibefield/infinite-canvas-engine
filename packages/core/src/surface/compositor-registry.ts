/**
 * The compositor SOURCE REGISTRY (design-012 plan §1 "the registry seam,
 * precisely") — how a producer reaches the compositor without anyone gaining a
 * new import.
 *
 * The problem it solves: `ground` owns the unified compositor, `dom` owns the
 * L1 hosts, `r3f` owns the island render targets, and the app owns live video
 * frames — and the import walls forbid every one of those from reaching
 * `ground` (nobody imports ground; it is a leaf like devtools). So the meeting
 * point is here, in `core`, as PLAIN DATA: producers register a source against
 * an entity, and ground's `WidgetQuadPass` consumes the registry alongside the
 * sibling-order index. This generalises design-002's "pass configs are plain
 * data in core" to opaque per-kind source handles. Nobody new imports anybody.
 *
 * Sources are OPAQUE to core on purpose. Core is headless — it must not name
 * `Element` or `VideoFrame` — so the dom host is `object` and the video frame
 * is `object`, and only the layer that registered a source ever interprets it.
 * `GPUTexture` IS named, because WebGPU is not DOM: it is available in workers,
 * and the alternative (a hand-rolled structural mirror) would rot.
 *
 * Membership is dirt. Registering, unregistering and re-registering all bump
 * `revision()` and fire `onChange` — that is the compositor's "sibling-order
 * staleness / promotion changes" input (plan §4.3), and it is PRESENTATION
 * dirt, never ECS state.
 */
import type { Entity } from "@vibecook/strata-ecs";

/** The surface kinds the compositor can sample. Terminal joins later (§11 Q6). */
export type SurfaceKind = "dom" | "gl" | "video";

/**
 * A DOM widget's L1 host — an immediate child of the `layoutsubtree` source
 * canvas (design-012 §5). Registered by the dom layer; handed to the HiC
 * adapter's `copyElementImageToTexture` by ground, and interpreted by nobody
 * else. `object` because core may not name `Element`.
 */
export interface CompositorSourceDom {
  readonly kind: "dom";
  readonly host: object;
}

/**
 * A GL island's resolved colour target. Registered by r3f, which keeps the
 * `renderer.backend.get(rt.texture).texture` read on its own side of the wall.
 *
 * `texture()` is a GETTER, not a value: the target is reallocated on zoom-band
 * and DPR changes (design-004 §3 carries over), so a captured handle goes
 * stale. `srgb()` reports whether that texture's ACTUAL GPU format is an
 * `-srgb` one — three's render targets are, the swap chain cannot be, and the
 * quad shader's re-encode is guarded on this and never on an assumption
 * (design-012 §4 sRGB law).
 */
export interface CompositorSourceGl {
  readonly kind: "gl";
  readonly texture: () => GPUTexture | undefined;
  readonly srgb: () => boolean;
}

/**
 * A live surface's RETAINED latest frame (design-012 §6.4: a surface is STATE,
 * not an event — the compositor samples the latest every composite, and a
 * frameless composite shows the last good one rather than blinking out).
 *
 * Opaque (`object`) because `VideoFrame` is not a core type. NOTE the §6.4
 * nuance for downstream consumers: retaining the frame and re-importing per
 * composite is the RIG's mechanism; a consumer under a producer lease protocol
 * must instead copy once into a stable texture and close the frame immediately.
 * The contract here is the lesson, not that mechanism.
 */
export interface CompositorSourceVideo {
  readonly kind: "video";
  readonly frame: () => object | undefined;
  /**
   * "A new frame is in." Subscribe here and the compositor wakes itself when
   * this producer delivers; returns an unsubscriber (the `onChange` shape).
   *
   * EXTERNAL-FRAME ARRIVAL IS ONE OF §4's DIRTY SOURCES, and until S8 it was
   * the only one nothing raised: S7 shipped the video leg with its rig marking
   * compositor dirt BY HAND, which made the coverage measurement honest (it let
   * composites outrun productions 3:1, the exact 15 %-defect condition) and
   * left the wiring unbuilt. A producing surface that cannot wake the
   * compositor only draws while something ELSE is moving — correct-looking on
   * any board with a camera in motion, frozen on a still one.
   *
   * OPTIONAL, and the asymmetry with the other kinds is deliberate. A `dom`
   * source's dirt comes from HiC paint events through the binder's `onDirt`,
   * and a `gl` source's from r3f's island binder `onPaint`; both of those
   * producers live inside ICE and own a binder already. A `video` producer is
   * the APP — downstream, outside this repo, under its own lease protocol — so
   * its wake has to travel with the source it registers rather than through a
   * seam it would have to find. A source that omits it still composites
   * correctly; it just cannot wake anyone, which is what every S7 source did.
   *
   * The subscription is the COMPOSITOR's to hold and drop: it subscribes on
   * registration and unsubscribes when the source is replaced or removed, so a
   * producer that outlives its registration cannot keep waking a compositor
   * that is no longer sampling it.
   */
  readonly onArrival?: (cb: () => void) => () => void;
}

export type CompositorSource = CompositorSourceDom | CompositorSourceGl | CompositorSourceVideo;

export interface CompositorSourceRegistry {
  /**
   * Register `source` for `entity`, replacing any source already held for it
   * (promotion swaps a dom source for a picture without an unregister step).
   * Returns an IDENTITY-BOUND disposer: it removes only THIS registration, so
   * a stale disposer cannot evict a replacement.
   */
  register(entity: Entity, source: CompositorSource): () => void;
  get(entity: Entity): CompositorSource | undefined;
  has(entity: Entity): boolean;
  /** Live entries. Iteration order is registration order, not paint order —
   *  paint order is the sibling-order index's job (petition 8). */
  entries(): IterableIterator<readonly [Entity, CompositorSource]>;
  size(): number;
  /** Bumped on every membership or identity change; the compositor's dirt input. */
  revision(): number;
  /** Fires after any change that bumped `revision`. Returns an unsubscriber. */
  onChange(cb: () => void): () => void;
  clear(): void;
}

export function createCompositorSourceRegistry(): CompositorSourceRegistry {
  const sources = new Map<Entity, CompositorSource>();
  const listeners = new Set<() => void>();
  let revision = 0;

  const changed = (): void => {
    revision++;
    // Snapshot: a listener that unsubscribes (or registers) during the sweep
    // must not mutate the set being iterated.
    for (const cb of [...listeners]) cb();
  };

  return {
    register(entity, source) {
      sources.set(entity, source);
      changed();
      let disposed = false;
      return () => {
        if (disposed) return; // idempotent
        disposed = true;
        // Identity-bound: if something else re-registered this entity, that
        // registration owns the slot now and this disposer owns nothing.
        if (sources.get(entity) !== source) return;
        sources.delete(entity);
        changed();
      };
    },
    get: (entity) => sources.get(entity),
    has: (entity) => sources.has(entity),
    entries: () => sources.entries(),
    size: () => sources.size,
    revision: () => revision,
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    clear() {
      if (sources.size === 0) return; // a no-op clear is not dirt
      sources.clear();
      changed();
    },
  };
}
