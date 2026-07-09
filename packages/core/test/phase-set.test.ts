import { createWorld, defineQuery, defineSystem, phase } from "@vibecook/strata-ecs";
import { describe, expect, it, vi } from "vitest";
import { definePhaseSet } from "../src/helpers/phase-set";

// Schema handles are process-global and strata exports no reset, so define ONE phase set at
// module scope and give each test a fresh world (tag VALUES are per-world; tag SCHEMA is global).
const gesture = definePhaseSet("test-gesture", ["possible", "active", "ended"] as const);

describe("definePhaseSet", () => {
  it("mints a persistent tag and a distinct Just marker per phase", () => {
    expect(gesture.phases).toEqual(["possible", "active", "ended"]);
    expect(gesture.tags.possible).not.toBe(gesture.justTags.possible);
    expect(gesture.allMarkerTags).toEqual([
      gesture.justTags.possible,
      gesture.justTags.active,
      gesture.justTags.ended,
    ]);
    expect(gesture.tags.possible.name).toBe("test-gesture:possible");
    expect(gesture.justTags.possible.name).toBe("test-gesture:just-possible");
  });

  it("set moves the phase tag exclusively and current() reads it back", () => {
    const w = createWorld();
    const e = w.spawn();

    expect(gesture.current(w, e)).toBeUndefined();

    gesture.set(w, e, "possible");
    expect(w.hasTag(e, gesture.tags.possible)).toBe(true);
    expect(gesture.current(w, e)).toBe("possible");

    gesture.set(w, e, "active");
    expect(w.hasTag(e, gesture.tags.possible)).toBe(false);
    expect(w.hasTag(e, gesture.tags.active)).toBe(true);
    expect(gesture.current(w, e)).toBe("active");
  });

  it("emits the Just marker for the entered phase and drops the stale one", () => {
    const w = createWorld();
    const e = w.spawn();

    gesture.set(w, e, "possible");
    expect(w.hasTag(e, gesture.justTags.possible)).toBe(true);

    // Entering `active` drops `just-possible` (stale) and raises `just-active`.
    gesture.set(w, e, "active");
    expect(w.hasTag(e, gesture.justTags.possible)).toBe(false);
    expect(w.hasTag(e, gesture.justTags.active)).toBe(true);
  });

  it("clearMarkers strips markers but leaves the persistent phase tag", () => {
    const w = createWorld();
    const e = w.spawn();

    gesture.set(w, e, "active");
    expect(w.hasTag(e, gesture.justTags.active)).toBe(true);

    gesture.clearMarkers(w, e);
    expect(w.hasTag(e, gesture.justTags.active)).toBe(false);
    // The persistent phase survives a marker clear — behaviors edge-trigger, per-frame work persists.
    expect(w.hasTag(e, gesture.tags.active)).toBe(true);
    expect(gesture.current(w, e)).toBe("active");
  });

  it("throws on an unknown phase", () => {
    const w = createWorld();
    const e = w.spawn();
    expect(() => {
      // @ts-expect-error — "nope" is not a declared phase; set must reject it at runtime.
      gesture.set(w, e, "nope");
    }).toThrow(/unknown phase/);
  });

  it("warns and no-ops on a set to the phase the entity already holds", () => {
    const w = createWorld();
    const e = w.spawn();
    gesture.set(w, e, "active");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    gesture.set(w, e, "active");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();

    // The no-op left the phase intact.
    expect(gesture.current(w, e)).toBe("active");
  });

  it("transitions applied through a SystemCtx land at the phase flush", () => {
    const w = createWorld();
    const e = w.spawn();
    gesture.set(w, e, "possible"); // seed so the query below matches e

    // A ctx-driven transition is DEFERRED to the phase boundary (design-002 §3): the system sets
    // `active` via ctx during iteration; only the flush makes it visible.
    const q = defineQuery([gesture.tags.possible]);
    const advance = defineSystem(q, (_batch, ctx) => gesture.set(ctx, e, "active"), { name: "advance" });
    w.tick([phase("phase", [advance])]);

    expect(gesture.current(w, e)).toBe("active");
    expect(w.hasTag(e, gesture.justTags.active)).toBe(true);
  });
});
