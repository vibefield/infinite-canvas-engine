/**
 * Per-entity composite facts read from the world (design-012 plan §1: the
 * quad pass consumes "the registry + the sibling-order index + per-entity
 * composite facts").
 *
 * Geometry is WORLD units and opacity is the same `Opacity.a` cell the DOM
 * host's `style.opacity` reads — design-012 §7's "one lift, one fade": the GPU
 * quad and the live-dom host fade from the same cell, so a promotion mid-fade
 * cannot step the opacity.
 *
 * RADIUS IS 0 FOR DOM SOURCES, and that is not an omission. A DOM card's
 * `border-radius` is part of what HiC rasterises: the copied pixels already
 * carry the rounded corner, with transparency outside it. Asking the shader to
 * round the quad as well would clip a corner that is already round — twice-AA'd
 * and visibly darker at the seam. The shader's rounded-rect path exists for
 * sources whose pixels are a plain rectangle: island render targets (S5) and
 * the compositor's own lift/effect chrome (S6).
 */
import { Opacity, Position, Size, MeasuredSize, type Entity, type World } from "@ice/core";
import type { QuadFacts } from "./widget-quad-pass";

export interface WorldQuadFactsOptions {
  /**
   * Corner radius in CSS px for quads whose SOURCE pixels are a plain
   * rectangle. Leave 0 for dom sources (see the header).
   */
  readonly radius?: (entity: Entity) => number;
}

/**
 * Read an entity's composite facts. Returns `undefined` for an entity with no
 * geometry — the quad pass then draws nothing for it, rather than a
 * zero-sized or origin-anchored ghost.
 */
export function createWorldQuadFacts(
  world: World,
  options: WorldQuadFactsOptions = {},
): (entity: Entity) => QuadFacts | undefined {
  return (entity) => {
    const p = world.get(entity, Position);
    if (p === undefined) return undefined;
    // Effective size is MeasuredSize where present and non-zero, else Size —
    // the same rule the host pipeline uses (design-004 §2), so the quad and
    // the host can never disagree about how big the card is.
    const measured = world.get(entity, MeasuredSize);
    const s = measured !== undefined && measured.w > 0 ? measured : world.get(entity, Size);
    if (s === undefined || s.w <= 0 || s.h <= 0) return undefined;
    const radius = options.radius?.(entity) ?? 0;
    return {
      x: p.x,
      y: p.y,
      w: s.w,
      h: s.h,
      opacity: world.get(entity, Opacity)?.a ?? 1,
      radius,
    };
  };
}
