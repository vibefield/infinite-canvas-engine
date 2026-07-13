/**
 * Measurement wiring (design-004 §2 measure side): the mount store drives
 * observe/unobserve on the shared ResizeObserver, disconnects on hide, and — the
 * bit the RO can't do itself — force-enqueues one measurement on show (a
 * hidden→shown element at the same box size never re-fires the RO). The RO is
 * faked (observe/unobserve/disconnect recorded); the store is the same 2-method
 * fake the host-reflector test uses; the reconcile is microtask-deferred so each
 * `store.set` is followed by a `tick()`.
 */
import { type Entity, type MountEntry, createMeasureQueue } from "@ice/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { wireMeasurement } from "../src/measure-wiring";

// --- a fake ResizeObserver that records observe/unobserve/disconnect ---
const roInstances: FakeRO[] = [];
class FakeRO {
  readonly observed = new Set<Element>();
  disconnected = false;
  constructor(_cb: ResizeObserverCallback) {
    roInstances.push(this);
  }
  observe(el: Element): void {
    this.observed.add(el);
  }
  unobserve(el: Element): void {
    this.observed.delete(el);
  }
  disconnect(): void {
    this.disconnected = true;
    this.observed.clear();
  }
}

let prevRO: unknown;
beforeEach(() => {
  roInstances.length = 0;
  prevRO = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeRO;
});
afterEach(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = prevRO;
});

/** Minimal WidgetMountStore fake: identity changes only when the test replaces it. */
function fakeStore() {
  let snapshot: readonly MountEntry[] = [];
  const listeners = new Set<() => void>();
  return {
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getSnapshot: () => snapshot,
    set(entries: readonly MountEntry[]) {
      snapshot = entries;
      for (const l of listeners) l();
    },
  };
}

const ent = (n: number): Entity => n as unknown as Entity;
/** Drain the deferred reconcile (wireMeasurement schedules it on a microtask). */
const tick = (): Promise<void> => Promise.resolve();

describe("wireMeasurement", () => {
  it("observes on mount, disconnects on hide, reconnects + force-remeasures on show, unobserves on unmount", async () => {
    const store = fakeStore();
    const e = ent(1);
    const el = document.createElement("div");
    const sizes = new Map<HTMLElement, { w: number; h: number }>([[el, { w: 220, h: 140 }]]);
    const queue = createMeasureQueue();

    const teardown = wireMeasurement(store, { hostFor: (x) => (x === e ? el : undefined) }, queue, {
      measure: (m) => sizes.get(m) ?? { w: 0, h: 0 },
    });
    await tick(); // the initial (empty) reconcile
    const ro = roInstances[0];
    expect(ro).toBeDefined();
    if (ro === undefined) return;
    expect(ro.observed.size).toBe(0);

    // fresh mount + visible → observe; the RO fires its own first sample, so NO force.
    store.set([{ entity: e, hidden: false }]);
    await tick();
    expect(ro.observed.has(el)).toBe(true);
    expect(queue.size()).toBe(0);

    // visible → hidden → disconnect (never measure a display:none 0×0 host).
    store.set([{ entity: e, hidden: true }]);
    await tick();
    expect(ro.observed.has(el)).toBe(false);

    // hidden → shown → reconnect AND force one synchronous re-measure (the RO
    // won't re-fire for an unchanged box size).
    store.set([{ entity: e, hidden: false }]);
    await tick();
    expect(ro.observed.has(el)).toBe(true);
    expect(queue.size()).toBe(1);
    expect(queue.drain()).toEqual([{ entity: e, w: 220, h: 140 }]);

    // unmount (exits the snapshot) → unobserve.
    store.set([]);
    await tick();
    expect(ro.observed.has(el)).toBe(false);

    teardown();
    expect(ro.disconnected).toBe(true);
  });

  it("forced remeasure records the UNSCALED border-box (offsetWidth), not the camera transform's inflated getBoundingClientRect", async () => {
    const store = fakeStore();
    const e = ent(3);
    // The host lives under a content plane that carries the camera zoom as a CSS
    // transform; getBoundingClientRect would fold that scale in (zoomed CSS px
    // recorded as world size), while offsetWidth/offsetHeight are the layout
    // border-box — transform-independent, matching the ResizeObserver path.
    const plane = document.createElement("div");
    plane.style.transform = "scale(2)";
    const el = document.createElement("div");
    plane.appendChild(el);
    // happy-dom does no layout, so fake both reads: layout border-box 220×140,
    // visual rect doubled by the scale(2).
    Object.defineProperty(el, "offsetWidth", { value: 220, configurable: true });
    Object.defineProperty(el, "offsetHeight", { value: 140, configurable: true });
    el.getBoundingClientRect = () => ({ width: 440, height: 280 }) as unknown as DOMRect;
    const queue = createMeasureQueue();

    // No `measure` override — this exercises the real defaultMeasure.
    wireMeasurement(store, { hostFor: (x) => (x === e ? el : undefined) }, queue);
    await tick();

    store.set([{ entity: e, hidden: false }]); // mount
    await tick();
    store.set([{ entity: e, hidden: true }]); // hide
    await tick();
    store.set([{ entity: e, hidden: false }]); // show → forced remeasure
    await tick();

    expect(queue.drain()).toEqual([{ entity: e, w: 220, h: 140 }]); // UNSCALED, not 440×280
  });

  it("never force-enqueues a 0×0 sample on show (a still-collapsed host stays out of the queue)", async () => {
    const store = fakeStore();
    const e = ent(2);
    const el = document.createElement("div");
    const sizes = new Map<HTMLElement, { w: number; h: number }>([[el, { w: 0, h: 0 }]]); // still hidden/collapsed
    const queue = createMeasureQueue();

    wireMeasurement(store, { hostFor: (x) => (x === e ? el : undefined) }, queue, {
      measure: (m) => sizes.get(m) ?? { w: 0, h: 0 },
    });
    await tick();

    store.set([{ entity: e, hidden: false }]); // mount
    await tick();
    store.set([{ entity: e, hidden: true }]); // hide
    await tick();
    store.set([{ entity: e, hidden: false }]); // show, but the measure still reads 0×0
    await tick();

    expect(queue.size()).toBe(0); // the §2 double wall: no 0×0 sample ever enqueued
  });

  it("tracks multiple widgets independently across a mixed diff", async () => {
    const store = fakeStore();
    const e1 = ent(10);
    const e2 = ent(11);
    const el1 = document.createElement("div");
    const el2 = document.createElement("div");
    const hostFor = (x: Entity): HTMLElement | undefined =>
      x === e1 ? el1 : x === e2 ? el2 : undefined;
    const queue = createMeasureQueue();

    wireMeasurement(store, { hostFor }, queue, { measure: () => ({ w: 50, h: 50 }) });
    await tick();
    const ro = roInstances[0];
    if (ro === undefined) throw new Error("no RO");

    store.set([{ entity: e1, hidden: false }, { entity: e2, hidden: false }]);
    await tick();
    expect(ro.observed.has(el1)).toBe(true);
    expect(ro.observed.has(el2)).toBe(true);

    // e1 hides (unobserve), e2 stays visible (untouched).
    store.set([{ entity: e1, hidden: true }, { entity: e2, hidden: false }]);
    await tick();
    expect(ro.observed.has(el1)).toBe(false);
    expect(ro.observed.has(el2)).toBe(true);
  });
});
