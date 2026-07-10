/**
 * The measurement adapter (design-004 §2 host pipeline; measure side).
 *
 * Wraps a `ResizeObserver` over auto-sized widgets' CONTENT elements and pushes
 * `{ entity, w, h }` samples into the engine's {@link MeasureQueue} — the
 * adapter-only path (Law 2: adapters ONLY enqueue; `measureIngest` turns samples
 * into `MeasuredSize` facts inside the frame contract). It resolves an entity's
 * content element on demand via the caller's `hostFor` (the widget host reflector
 * owns the element↔entity mapping).
 *
 * §2 hidden-measure rule: a `display:none` host collapses to `0×0`, and a
 * full→0 sample would pass any dead-band and corrupt bounds/cull on re-entry —
 * so the adapter NEVER enqueues while the host is hidden (computed `display:none`
 * / no `offsetParent`), and also drops a literal `0×0`. It is the CALLER's job to
 * re-`observe` (or otherwise force a remeasure) on re-show — a `ResizeObserver`
 * does not re-fire for an element that was hidden and shown at the same box size.
 *
 * One shared `ResizeObserver` multiplexes every observed element (fewer objects,
 * identical semantics to one-per-element); `element → entity` maps a callback
 * entry back to its widget.
 */
import type { Entity, MeasureQueue } from "@ice/core";

export interface MeasureAdapter {
  /** Begin observing the entity's content element (no-op if `hostFor` yields none). */
  observe(entity: Entity): void;
  /** Stop observing the entity's content element. */
  unobserve(entity: Entity): void;
  /** Disconnect the observer and drop all mappings. */
  dispose(): void;
}

/** True when the element is `display:none` (collapsed to 0×0) and must not be measured. */
function isHidden(el: HTMLElement): boolean {
  // offsetParent is null for display:none — but also for position:fixed and the
  // <body>, so a null offsetParent is only conclusive with a computed-display check.
  if (el.offsetParent !== null) return false;
  const display = el.ownerDocument.defaultView?.getComputedStyle(el).display;
  return display === "none";
}

export function attachMeasureAdapter(
  hostFor: (e: Entity) => HTMLElement | undefined,
  queue: MeasureQueue,
): MeasureAdapter {
  const byElement = new Map<Element, Entity>();
  const byEntity = new Map<Entity, Element>();

  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const el = entry.target as HTMLElement;
      const entity = byElement.get(el);
      if (entity === undefined) continue;
      if (isHidden(el)) continue; // never ingest from a hidden host (§2)
      const box = entry.borderBoxSize?.[0];
      const w = box !== undefined ? box.inlineSize : entry.contentRect.width;
      const h = box !== undefined ? box.blockSize : entry.contentRect.height;
      if (w === 0 && h === 0) continue; // double wall with ingest's 0×0 skip
      queue.enqueue({ entity, w, h });
    }
  });

  return {
    observe(entity) {
      const el = hostFor(entity);
      if (el === undefined) return;
      const prev = byEntity.get(entity);
      if (prev !== undefined && prev !== el) {
        ro.unobserve(prev);
        byElement.delete(prev);
      }
      byElement.set(el, entity);
      byEntity.set(entity, el);
      ro.observe(el);
    },
    unobserve(entity) {
      const el = byEntity.get(entity);
      if (el === undefined) return;
      ro.unobserve(el);
      byElement.delete(el);
      byEntity.delete(entity);
    },
    dispose() {
      ro.disconnect();
      byElement.clear();
      byEntity.clear();
    },
  };
}
