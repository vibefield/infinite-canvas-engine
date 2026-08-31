/**
 * The dom source binder — what turns `{kind:"dom", host}` registrations into
 * atlas slots, copies and sampleable quads (design-012 §4, plan §5 S2.3/S2.4).
 *
 * It sits between three things that must not know about each other: the
 * registry (core, opaque handles), the paged atlas (pure logic + a device
 * binding), and the quad pass (WGSL). Its whole job is the bookkeeping those
 * three deliberately do not do.
 *
 * ── ZOOM BANDS — the same ladder islands use ──────────────────────────────
 * A slot is sized at `bounds × dpr × BAND`, not at the live zoom, and the band
 * is held with hysteresis: it changes only when the zoom leaves
 * `[band × 0.5, band × 2]`. Bands are powers of two, each covering a 4×
 * display range (`@ice/kernel/zoom-bands`, ported from v1's RFC-002).
 *
 * That ladder is not re-derived here on purpose. design-004 §3's band
 * semantics are the vocabulary for BOTH surface kinds, and r3f's island pool
 * already allocates its FBOs through `fboPixelSize`/`isOutOfBand`. Two
 * different quantisations would mean a dom card and a GL widget on one board
 * re-rasterising at different moments during the same pinch — visibly, and for
 * no reason anyone could name.
 *
 * Without bands, sizing from the live zoom re-slots and re-copies EVERY frame
 * of a continuous zoom (each `ceil(size × zoom × dpr)` is a new size). With
 * them, a zoom costs at most one re-copy per band edge crossed, and the quad
 * simply samples its slot at a different scale in between — which is what the
 * linear filter and the 2 px gutters were always for.
 *
 * ── Slot sizing without reading layout ─────────────────────────────────────
 * A reflector may never read layout during flush (law 10), so the slot size is
 * DERIVED, not measured: world size × zoom × dpr, which is exactly what
 * `domWriteback` wrote as the host's CSS width/height. No
 * `getBoundingClientRect`, no forced reflow, and the two cannot disagree
 * because they compute from the same cells.
 *
 * The derived size is rounded UP. `copyElementImageToTexture` writes the
 * element's own rasterised size with no extent argument, so a slot one pixel
 * short of what Chromium rasterises would write past its rect. Rounding up,
 * plus the atlas's 2 px gutter — dead space no quad samples — absorbs a
 * sub-pixel disagreement without any chance of reaching a neighbour's pixels.
 *
 * ── Dirt ──────────────────────────────────────────────────────────────────
 * Paint events name the changed hosts (`changedElements`, exact on Chromium
 * 150/152), and this maps those elements back to entities and marks their
 * slots. There is NO full-board path — the 111 ms/200-card ceiling is made
 * structural, not merely avoided (§8 gate 2). The only bulk iteration is
 * `sync`, and its copies are budgeted per composite.
 */
import { fboPixelSize, isOutOfBand, selectBand } from "@ice/kernel";
import {
  DEFAULT_SURFACE_DEMAND,
  demandIntervalMs,
  type CompositorSource,
  type CompositorSourceRegistry,
  type Entity,
  type SurfaceDemand,
} from "@ice/core";
import type { CompositeFrame, QuadTexture } from "./widget-quad-pass";
import { createDomAtlas, type DomAtlas, type DomAtlasOptions } from "./dom-atlas";

export interface DomSourceBinderOptions extends DomAtlasOptions {
  /**
   * Copies allowed per composite. Boot staggering and any bulk arrival ride
   * this budget rather than a full-board pass: at ~0.21 ms per dirty card the
   * whole point is that a frame never owes more than it can pay, and the
   * 111 ms/200-card full repaint is not a slow path but an absent one.
   *
   * A budget is only safe because the compositor stays awake while copies are
   * owed — see `pending()`, which the reflector re-marks dirt on.
   */
  readonly maxCopiesPerComposite?: number;
  /**
   * Per-surface demand (design-012 §4). Absent ⇒ every surface is live at 60,
   * which is the pre-demand behaviour.
   *
   * This throttles UPLOADS, not paint events: Chromium raises those either
   * way, and a CSS-keyframe card still costs its 239.9 events/s of main-thread
   * paint. What demand buys is that its slot stops being re-copied at that rate.
   */
  readonly demand?: (entity: Entity) => SurfaceDemand | undefined;
  /** Clock seam, for tests. Defaults to `performance.now()`. */
  readonly now?: () => number;
  /**
   * Called when a paint event produces work — a slot marked, or a mark
   * deferred by a demand bucket.
   *
   * This is the WAKE, and it is not optional bookkeeping. HiC paint events are
   * one of the compositor's named dirty sources (design-012 §4), and without
   * this the chain silently breaks in the middle: the paint event marks the
   * slot, the compositor never learns anything happened, `sync` never runs,
   * and the card shows stale pixels forever while every counter says the dirt
   * was received. Measured, before it was wired: a CSS-keyframe card named its
   * host 301 times in 2.5 s and uploaded 0.
   */
  readonly onDirt?: () => void;
}

export interface DomSourceBinder {
  readonly atlas: DomAtlas<Entity>;
  /**
   * Place every live dom source at this frame's size and drive its pending
   * copies. Call BEFORE the render pass is encoded: the copies are queue
   * operations, and the queue executes them in issue order relative to the
   * submit that follows.
   */
  sync(frame: CompositeFrame): void;
  /** Resolve an entity's atlas placement into something the shader can sample. */
  resolve(entity: Entity, source: CompositorSource): QuadTexture | undefined;
  /** A paint event named these hosts: mark their slots dirty. */
  markDirtyHosts(hosts: Iterable<Element>): number;
  /** Copies made since construction (the upload instrument). */
  copies(): number;
  /** Copies still owed. Non-zero means a later frame completes the picture. */
  pending(): number;
  /**
   * Copies the platform refused since construction. A handful right after a
   * promotion is expected (no paint record yet); a number that keeps climbing
   * on a settled board is a real fault, not a warm-up.
   */
  refusedCopies(): number;
  /**
   * Dirty marks a demand bucket DEFERRED rather than dropped. A deferred mark
   * is not lost: the slot is marked as soon as its bucket allows, so a
   * throttled card is behind, never wrong.
   */
  throttled(): number;
  /** Change the per-composite copy budget (boot staggering, demand pressure). */
  setCopyBudget(limit: number): void;
  /** The zoom band a slot is currently sized for (0 when it has none). */
  bandOf(entity: Entity): number;
  dispose(): void;
}

/** The world geometry a slot's size is derived from. */
export type DomSourceGeometry = (
  entity: Entity,
) => { readonly w: number; readonly h: number } | undefined;

export function createDomSourceBinder(
  device: GPUDevice,
  registry: CompositorSourceRegistry,
  geometry: DomSourceGeometry,
  options: DomSourceBinderOptions = {},
): DomSourceBinder {
  const atlas = createDomAtlas<Entity>(device, options);
  let budget = options.maxCopiesPerComposite ?? Number.POSITIVE_INFINITY;
  const now = options.now ?? (() => performance.now());
  const demandOf = (entity: Entity): SurfaceDemand =>
    options.demand?.(entity) ?? DEFAULT_SURFACE_DEMAND;
  /** When each slot was last marked dirty — the throttle's clock. */
  const lastMarked = new Map<Entity, number>();
  /** Entities whose dirt a demand bucket deferred; released when due. */
  const deferred = new Map<Entity, number>();
  let throttled = 0;
  /** host element → entity, so a paint event's elements become slot ids. */
  const byHost = new Map<Element, Entity>();
  /** What each entity was last PLACED at — the change guard in `sync`. */
  const placed = new Map<Entity, { width: number; height: number; host: Element }>();
  /** The zoom band each slot was last sized for; hysteresis holds it. */
  const bands = new Map<Entity, number>();
  let copies = 0;

  const hostOf = (source: CompositorSource): Element | undefined =>
    source.kind === "dom" ? (source.host as Element) : undefined;

  // Membership changes rebuild the reverse map lazily — the registry bumps its
  // revision on every register/unregister, so this is a compare, not a walk.
  let mappedRevision = -1;
  function refreshHostMap(): void {
    if (registry.revision() === mappedRevision) return;
    mappedRevision = registry.revision();
    byHost.clear();
    for (const [entity, source] of registry.entries()) {
      const host = hostOf(source);
      if (host !== undefined) byHost.set(host, entity);
    }
  }

  /** Free slots for entities the registry no longer holds (demotion, despawn). */
  function reapDeparted(live: Set<Entity>): void {
    for (const slot of atlas.allocator.slots()) {
      if (!live.has(slot.id)) {
        atlas.free(slot.id);
        placed.delete(slot.id);
        bands.delete(slot.id);
        lastMarked.delete(slot.id);
        deferred.delete(slot.id);
      }
    }
  }

  return {
    atlas,

    sync(frame) {
      refreshHostMap();
      const live = new Set<Entity>();

      for (const [entity, source] of registry.entries()) {
        const host = hostOf(source);
        if (host === undefined) continue;
        const g = geometry(entity);
        if (g === undefined || g.w <= 0 || g.h <= 0) continue;
        live.add(entity);

        // BAND, with hysteresis: keep the one this slot was sized for until
        // the zoom leaves its 4× window, then step to the band for the current
        // zoom. `isOutOfBand` returns false for a slot that has never been
        // banded, so the `?? 0` first sight always takes the else branch.
        const held = bands.get(entity);
        const band =
          held === undefined || isOutOfBand(frame.camera.zoom, held)
            ? selectBand(frame.camera.zoom)
            : held;
        bands.set(entity, band);

        // `bounds × dpr × band` — the island pool's own formula, so the two
        // kinds quantise identically.
        const { width, height } = fboPixelSize(g.w, g.h, frame.dpr, band);

        // PLACE ONLY ON CHANGE. `allocate` marks an existing resident slot
        // STALE, which queues a re-copy — so calling it every frame would
        // re-upload the entire board on every composite, which is precisely
        // the full-board path design-012 §8 gate 2 makes structurally
        // impossible (111 ms at N=200). A pure pan changes no slot size, so it
        // must reach `place` for nobody at all.
        //
        // Content dirt does not come from here; it comes from paint events
        // (`markDirtyHosts`), which name exactly the cards that changed.
        const prev = placed.get(entity);
        const stale =
          prev === undefined ||
          prev.width !== width ||
          prev.height !== height ||
          prev.host !== host ||
          // A slot the refusal path released has to be re-placed to come back.
          atlas.allocator.get(entity) === undefined;
        if (stale) {
          atlas.place(entity, host, { width, height });
          placed.set(entity, { width, height, host });
        }
      }

      reapDeparted(live);

      // Release any dirt a bucket deferred and that is now due. A throttled
      // card is BEHIND, never wrong: nothing is dropped, only delayed.
      if (deferred.size > 0) {
        const t = now();
        for (const [entity, due] of deferred) {
          if (t < due) continue;
          deferred.delete(entity);
          if (atlas.markDirty(entity)) lastMarked.set(entity, t);
        }
      }

      copies += atlas.flush(budget);

      // A refused copy is normally a host the canvas has not painted yet — the
      // frame after a promotion. The allocator has already marked those slots
      // resident, so put them back: freeing releases the slot, the next `sync`
      // re-places it (arriving `empty`), and the quad is skipped until the
      // pixels really land. A card is briefly ABSENT rather than briefly WRONG.
      const refused = atlas.lastCopyFailures();
      if (refused.length > 0) {
        for (const host of refused) {
          const entity = byHost.get(host);
          if (entity === undefined) continue;
          atlas.free(entity);
          // Drop the change guard too, or the retry would see an unchanged
          // size and never re-place the slot it just released.
          placed.delete(entity);
        }
      }
    },

    resolve(entity, source) {
      if (source.kind !== "dom") return undefined;
      const placement = atlas.placementOf(entity);
      // `undefined` here means the slot holds no pixels of this entity's yet
      // (fresh, re-slotted, or just repacked). The quad pass skips it rather
      // than sampling whatever used to live at that rect.
      if (placement === undefined) return undefined;
      return {
        texture: placement.texture,
        rect: placement.rect,
        textureWidth: placement.pageWidth,
        textureHeight: placement.pageHeight,
        // Atlas pages are `rgba8unorm`: the element copy delivers sRGB-encoded
        // bytes and a non-srgb texture hands them back unchanged.
        srgb: false,
        // HiC composites the element onto transparency, so a rounded corner
        // arrives as premultiplied alpha, like every other canvas source.
        premultiplied: true,
      };
    },

    markDirtyHosts(hosts) {
      refreshHostMap();
      const t = now();
      let marked = 0;
      for (const host of hosts) {
        const entity = byHost.get(host);
        if (entity === undefined) continue;

        // THE DEMAND THROTTLE. A CSS-keyframe card self-invalidates ~240
        // times a second (hic-bench §5); without this its slot is re-copied at
        // that rate forever. The mark is DEFERRED to the next moment its
        // bucket allows, not discarded — so the card lags its own animation by
        // at most one bucket interval and never shows something that never was.
        const interval = demandIntervalMs(demandOf(entity));
        if (interval !== 0) {
          const since = t - (lastMarked.get(entity) ?? Number.NEGATIVE_INFINITY);
          if (since < interval) {
            // `Infinity` (paused, or bucket 0) parks it until demand changes.
            const due = Number.isFinite(interval) ? t + (interval - since) : Number.POSITIVE_INFINITY;
            if (!deferred.has(entity)) throttled++;
            deferred.set(entity, due);
            // Deferred work still has to be collected later, and `pending()`
            // counts it — so the compositor must wake for this too.
            options.onDirt?.();
            continue;
          }
        }
        if (atlas.markDirty(entity)) {
          lastMarked.set(entity, t);
          marked++;
        }
      }
      if (marked > 0) options.onDirt?.();
      return marked;
    },

    copies: () => copies,
    // Deferred dirt is work still owed, so the compositor must stay awake for
    // it exactly as it does for a pending copy.
    pending: () => atlas.pendingCopies() + deferred.size,
    refusedCopies: () => atlas.copyFailures(),
    throttled: () => throttled,
    setCopyBudget(limit) {
      budget = limit > 0 ? limit : Number.POSITIVE_INFINITY;
    },
    bandOf: (entity) => bands.get(entity) ?? 0,

    dispose() {
      atlas.dispose();
      byHost.clear();
      placed.clear();
      bands.clear();
      lastMarked.clear();
      deferred.clear();
    },
  };
}
