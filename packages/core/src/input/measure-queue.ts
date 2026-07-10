/**
 * The measurement queue — the ONE ingest path for auto-sized widget sizes
 * (design-004 §2 host pipeline). Mirrors {@link ../input/queue.ts} exactly:
 * pre-ingest TRANSPORT, not world state. A DOM `ResizeObserver` adapter (the
 * `measure-adapter` in @ice/dom) enqueues normalized `{ entity, w, h }` samples
 * as content boxes resize; `measureIngest` drains once per tick and folds them
 * into the `MeasuredSize` session rider. No system reads it, nothing observes
 * it, it holds nothing across a drain.
 *
 * Measurements are content-box sizes in CSS px (screen == world here — the
 * host's content plane carries the camera transform, so a widget's content is
 * laid out in world units). The adapter NEVER enqueues a `0×0` sample (from a
 * `display:none` host) and ingest skips it a second time — the §2 double wall
 * against a full→0 collapse corrupting bounds/cull on re-entry.
 */
import type { Entity } from "@vibecook/strata-ecs";

export interface MeasureEvent {
  /** The widget entity whose content element resized (a runtime handle). */
  readonly entity: Entity;
  readonly w: number;
  readonly h: number;
}

export interface MeasureQueue {
  enqueue(event: MeasureEvent): void;
  /** Drain in arrival order. Called ONLY by `measureIngest`, once per tick. */
  drain(): readonly MeasureEvent[];
  /** Samples waiting (telemetry / the ingest `runIf` guard). */
  size(): number;
}

export function createMeasureQueue(): MeasureQueue {
  let buffer: MeasureEvent[] = [];
  return {
    enqueue(event) {
      buffer.push(event);
    },
    drain() {
      const drained = buffer;
      buffer = [];
      return drained;
    },
    size() {
      return buffer.length;
    },
  };
}
