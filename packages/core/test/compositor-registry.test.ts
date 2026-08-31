/**
 * The compositor source registry (design-012 plan §1) — the seam producers use
 * to reach the compositor without anyone importing `ground`.
 *
 * What matters here is the DIRT contract as much as the map: the compositor's
 * "promotion / sibling-order staleness" wake comes from this object, so a
 * change that does not bump `revision` is a frame that does not repaint, and a
 * no-op that DOES bump it is a frame that repaints for nothing (idle-zero).
 */
import { describe, expect, it, vi } from "vitest";
import { createCompositorSourceRegistry, type CompositorSource } from "../src/surface/compositor-registry";
import type { Entity } from "@vibecook/strata-ecs";

const e = (n: number): Entity => n as unknown as Entity;
const domSource = (host: object = {}): CompositorSource => ({ kind: "dom", host });
const glSource = (): CompositorSource => ({ kind: "gl", texture: () => undefined, srgb: () => false });

describe("compositor source registry", () => {
  it("holds sources by entity and reports membership", () => {
    const r = createCompositorSourceRegistry();
    expect(r.size()).toBe(0);
    expect(r.get(e(1))).toBeUndefined();

    const host = {};
    r.register(e(1), domSource(host));
    expect(r.size()).toBe(1);
    expect(r.has(e(1))).toBe(true);
    expect(r.get(e(1))).toMatchObject({ kind: "dom", host });
    expect([...r.entries()]).toHaveLength(1);
  });

  it("bumps revision and notifies on register and unregister", () => {
    const r = createCompositorSourceRegistry();
    const seen = vi.fn();
    r.onChange(seen);

    const r0 = r.revision();
    const off = r.register(e(1), domSource());
    expect(r.revision()).toBeGreaterThan(r0);
    expect(seen).toHaveBeenCalledTimes(1);

    const r1 = r.revision();
    off();
    expect(r.revision()).toBeGreaterThan(r1);
    expect(seen).toHaveBeenCalledTimes(2);
    expect(r.has(e(1))).toBe(false);
  });

  it("re-registering an entity REPLACES its source (promotion swaps in place)", () => {
    const r = createCompositorSourceRegistry();
    r.register(e(1), domSource());
    const before = r.revision();
    r.register(e(1), glSource());
    expect(r.size()).toBe(1);
    expect(r.get(e(1))?.kind).toBe("gl");
    // A replacement IS dirt: the compositor must sample a different source.
    expect(r.revision()).toBeGreaterThan(before);
  });

  it("a stale disposer cannot evict the registration that replaced it", () => {
    const r = createCompositorSourceRegistry();
    const offDom = r.register(e(1), domSource());
    r.register(e(1), glSource()); // promotion: gl owns the slot now
    const revision = r.revision();

    offDom(); // the OLD registration's disposer, fired late
    expect(r.get(e(1))?.kind).toBe("gl"); // still there
    expect(r.revision()).toBe(revision); // and no phantom dirt
  });

  it("disposers are idempotent", () => {
    const r = createCompositorSourceRegistry();
    const off = r.register(e(1), domSource());
    off();
    const revision = r.revision();
    off();
    off();
    expect(r.size()).toBe(0);
    expect(r.revision()).toBe(revision);
  });

  it("a no-op clear is NOT dirt (idle-zero)", () => {
    const r = createCompositorSourceRegistry();
    const seen = vi.fn();
    r.onChange(seen);
    const revision = r.revision();
    r.clear(); // already empty
    expect(r.revision()).toBe(revision);
    expect(seen).not.toHaveBeenCalled();

    r.register(e(1), domSource());
    seen.mockClear();
    r.clear();
    expect(r.size()).toBe(0);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("unsubscribing during a notification does not skip the other listeners", () => {
    const r = createCompositorSourceRegistry();
    const later = vi.fn();
    const offSelf = r.onChange(() => offSelf());
    r.onChange(later);
    r.register(e(1), domSource());
    expect(later).toHaveBeenCalledTimes(1);
  });

  it("keeps per-kind handles opaque and readable only by their producer", () => {
    const r = createCompositorSourceRegistry();
    const texture = { label: "island" } as unknown as GPUTexture;
    r.register(e(1), { kind: "gl", texture: () => texture, srgb: () => true });
    const source = r.get(e(1));
    expect(source?.kind).toBe("gl");
    if (source?.kind === "gl") {
      // Getters, not values: island targets are reallocated on band/DPR change,
      // so a captured handle would go stale.
      expect(source.texture()).toBe(texture);
      expect(source.srgb()).toBe(true);
    }
  });
});
