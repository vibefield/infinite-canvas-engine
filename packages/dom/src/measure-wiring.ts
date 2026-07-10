/**
 * Measurement wiring (design-004 §2 host pipeline; measure side, the store half).
 *
 * `attachMeasureAdapter` owns the `ResizeObserver` and the element→entity
 * mapping; THIS module owns *when* to observe/unobserve, driven by the engine's
 * widget mount store. It subscribes and reconciles each snapshot diff into four
 * transitions (design-004 §2 / decision 4):
 *
 *  - **fresh mount + visible** → `observe` (the RO fires its own first sample);
 *  - **visible → hidden** (culled-but-kept-mounted) → `unobserve` (disconnect on
 *    hide — a `display:none` host measures `0×0` and a full→0 sample corrupts
 *    bounds/cull on re-entry);
 *  - **hidden → shown** → re-`observe` AND a FORCED synchronous re-measure: a
 *    `ResizeObserver` does not re-fire for an element hidden and shown at the
 *    same box size, so the reconnect alone would leave the rider stale;
 *  - **unmount** (exits the snapshot) → `unobserve`.
 *
 * Ordering note: the mount store notifies from the widget-runtime flush
 * reflector, which is registered BEFORE the `domWidgets` host reflector — so at
 * notify time the host `<div>` for a just-mounted (or just-shown) widget may not
 * exist / may still be `display:none`. Like the React portal hook (which defers
 * via its own scheduler), this defers the reconcile to a microtask so it runs
 * AFTER the whole synchronous reflector pass, by which point `domWidgets` has
 * created/unhidden the host and `hostFor` + the forced re-measure see a real box.
 *
 * Law 2 holds: everything here only enqueues (through the adapter or the forced
 * sample) — no world writes, no ECS reads.
 */
import type { Entity, MeasureQueue, WidgetMountStore } from "@ice/core";
import { attachMeasureAdapter } from "./measure-adapter";

/** The element source (the `domWidgets` reflector supplies this via `hostFor`). */
export interface MeasureWiringHosts {
  hostFor(entity: Entity): HTMLElement | undefined;
}

export interface MeasureWiringOpts {
  /**
   * Border-box read for the forced re-measure on show. Defaults to
   * `getBoundingClientRect`; tests inject a deterministic stub.
   */
  readonly measure?: (el: HTMLElement) => { w: number; h: number };
}

function defaultMeasure(el: HTMLElement): { w: number; h: number } {
  const rect = el.getBoundingClientRect();
  return { w: rect.width, h: rect.height };
}

/**
 * Begin observing auto-sized widget hosts against `store`, pushing measurements
 * into `queue` (drained by `measureIngest`). Returns a teardown that
 * unsubscribes and disposes the underlying `ResizeObserver`.
 */
export function wireMeasurement(
  store: WidgetMountStore,
  hosts: MeasureWiringHosts,
  queue: MeasureQueue,
  opts: MeasureWiringOpts = {},
): () => void {
  const adapter = attachMeasureAdapter((e) => hosts.hostFor(e), queue);
  const measure = opts.measure ?? defaultMeasure;
  // Last-applied per-entity state — the diff basis. Absent = not mounted.
  const state = new Map<Entity, "visible" | "hidden">();
  let scheduled = false;
  let disposed = false;

  /** Reconnect leaves the rider stale for an unchanged box — force one sample (§2). */
  const forceRemeasure = (e: Entity): void => {
    const el = hosts.hostFor(e);
    if (el === undefined) return;
    const { w, h } = measure(el);
    if (w <= 0 && h <= 0) return; // never enqueue a hidden / 0×0 sample (§2)
    queue.enqueue({ entity: e, w, h });
  };

  const reconcile = (): void => {
    if (disposed) return;
    const snapshot = store.getSnapshot();
    const present = new Set<Entity>();
    for (const entry of snapshot) {
      present.add(entry.entity);
      const prev = state.get(entry.entity);
      if (entry.hidden) {
        if (prev === "visible") adapter.unobserve(entry.entity); // visible → hidden: disconnect
        state.set(entry.entity, "hidden");
      } else {
        if (prev === undefined) {
          adapter.observe(entry.entity); // fresh mount: the RO fires its own first sample
        } else if (prev === "hidden") {
          adapter.observe(entry.entity); // reconnect on show…
          forceRemeasure(entry.entity); // …and force it (the RO won't re-fire same-box)
        }
        state.set(entry.entity, "visible");
      }
    }
    for (const [e, s] of [...state]) {
      if (present.has(e)) continue;
      if (s === "visible") adapter.unobserve(e); // unmount from visible: disconnect
      state.delete(e);
    }
  };

  // Defer to a microtask so the reconcile runs AFTER the synchronous reflector
  // pass (the host reflector creates/unhides the host later this frame).
  const onStoreChange = (): void => {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      reconcile();
    });
  };

  const unsub = store.subscribe(onStoreChange);
  onStoreChange(); // pick up any entries already present at wire time

  return () => {
    disposed = true;
    unsub();
    adapter.dispose();
    state.clear();
  };
}
