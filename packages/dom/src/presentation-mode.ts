/**
 * Per-widget presentation policy — the ONE door (design-012 §6.3, plan §2).
 *
 * A widget presents as `live-dom` (host in the camera-transformed content
 * plane, painted natively, native caret and threaded scroll), `composited`
 * (host as an immediate child of the L1 source canvas, pixels copied into the
 * atlas and drawn as a GPU quad at true z), or `picture` (a retained texture
 * with no live source — the tray and far-zoom tiers).
 *
 * The ratified default (§11 Q5) is live-dom at rest, composited on
 * drag/effects/far-zoom. THAT POLICY IS NOT HERE — hysteresis lands with the
 * gestures it keys off (S6). This file owns only the MECHANISM, and owns it
 * alone, because the plan's §7 discipline is "promote-on-motion/demote-at-rest
 * via the ONE `setPresentation` door": a second place that reparents a host
 * would be a second place that can desynchronise the DOM from the registry.
 *
 * Promotion never remounts. The L1 host IS the same node in both modes — only
 * who paints changes — and moving a portal's container node does not remount
 * React, which is the same mechanism `domWidgets` already uses to lift a
 * dragged card into P3. Widget state survives.
 *
 * This registry is a plain observable map. The actual reparent, and the
 * registry registration that must happen in the same breath as it, belong to
 * `domWidgets` — it owns the host nodes, so it is the only place that can move
 * one and register it as a source ATOMICALLY. Registering a host that is not
 * yet an immediate child of the canvas would hand the compositor an element
 * the copy refuses.
 */
import type { Entity } from "@ice/core";

export type SurfacePresentation = "live-dom" | "composited" | "picture";

export interface PresentationRegistry {
  /** The entity's current mode; `live-dom` for anything never set (the default). */
  get(entity: Entity): SurfacePresentation;
  /**
   * The ONE door. Returns true when the mode actually changed — an unchanged
   * write is not dirt and wakes nothing.
   */
  set(entity: Entity, mode: SurfacePresentation): boolean;
  /** Forget an entity (despawn). Returns true when something was held. */
  clear(entity: Entity): boolean;
  /** Entities not in the default mode. */
  entries(): IterableIterator<readonly [Entity, SurfacePresentation]>;
  /** Bumped on every change; the reflector's cheap dirt check. */
  revision(): number;
  onChange(cb: () => void): () => void;
  dispose(): void;
}

export const DEFAULT_PRESENTATION: SurfacePresentation = "live-dom";

export function createPresentationRegistry(): PresentationRegistry {
  const modes = new Map<Entity, SurfacePresentation>();
  const listeners = new Set<() => void>();
  let revision = 0;

  const changed = (): void => {
    revision++;
    // Snapshot: a listener that unsubscribes during the sweep must not mutate
    // the set being iterated.
    for (const cb of [...listeners]) cb();
  };

  return {
    get: (entity) => modes.get(entity) ?? DEFAULT_PRESENTATION,

    set(entity, mode) {
      const current = modes.get(entity) ?? DEFAULT_PRESENTATION;
      if (current === mode) return false;
      // The default is not stored, so `entries()` stays proportional to what
      // is actually promoted rather than to the board.
      if (mode === DEFAULT_PRESENTATION) modes.delete(entity);
      else modes.set(entity, mode);
      changed();
      return true;
    },

    clear(entity) {
      if (!modes.delete(entity)) return false;
      changed();
      return true;
    },

    entries: () => modes.entries(),
    revision: () => revision,

    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    dispose() {
      listeners.clear();
      modes.clear();
    },
  };
}
