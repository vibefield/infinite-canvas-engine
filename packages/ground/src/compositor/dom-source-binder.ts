/**
 * The dom source binder — what turns `{kind:"dom", host}` registrations into
 * atlas slots, copies and sampleable quads (design-012 §4, plan §5 S2.3/S2.4).
 *
 * It sits between three things that must not know about each other: the
 * registry (core, opaque handles), the paged atlas (pure logic + a device
 * binding), and the quad pass (WGSL). Its whole job is the bookkeeping those
 * three deliberately do not do.
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
import type { CompositorSource, CompositorSourceRegistry, Entity } from "@ice/core";
import type { CompositeFrame, QuadTexture } from "./widget-quad-pass";
import { createDomAtlas, type DomAtlas, type DomAtlasOptions } from "./dom-atlas";

export interface DomSourceBinderOptions extends DomAtlasOptions {
  /**
   * Copies allowed per composite. Boot staggering (S4) and any bulk arrival
   * ride this budget rather than a full-board pass: at ~0.21 ms per dirty card
   * the whole point is that a frame never owes more than it can pay.
   */
  readonly maxCopiesPerComposite?: number;
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
  const budget = options.maxCopiesPerComposite ?? Number.POSITIVE_INFINITY;
  /** host element → entity, so a paint event's elements become slot ids. */
  const byHost = new Map<Element, Entity>();
  /** What each entity was last PLACED at — the change guard in `sync`. */
  const placed = new Map<Entity, { width: number; height: number; host: Element }>();
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
      }
    }
  }

  return {
    atlas,

    sync(frame) {
      refreshHostMap();
      const scale = frame.camera.zoom * frame.dpr;
      const live = new Set<Entity>();

      for (const [entity, source] of registry.entries()) {
        const host = hostOf(source);
        if (host === undefined) continue;
        const g = geometry(entity);
        if (g === undefined || g.w <= 0 || g.h <= 0) continue;
        live.add(entity);
        // Round UP — see the header.
        const width = Math.ceil(g.w * scale);
        const height = Math.ceil(g.h * scale);

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
      let marked = 0;
      for (const host of hosts) {
        const entity = byHost.get(host);
        if (entity !== undefined && atlas.markDirty(entity)) marked++;
      }
      return marked;
    },

    copies: () => copies,
    pending: () => atlas.pendingCopies(),
    refusedCopies: () => atlas.copyFailures(),

    dispose() {
      atlas.dispose();
      byHost.clear();
      placed.clear();
    },
  };
}
