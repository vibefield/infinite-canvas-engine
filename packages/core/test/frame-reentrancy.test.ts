/**
 * The snapshot rule for the two post-tick loops (petition I14, M11a) + the
 * reflect telemetry lane it makes real.
 *
 * Both `engine.step`'s publish loop and `reflectors.flushAll` used to iterate
 * their LIVE arrays, so a hook/reflector that unregistered itself — or an
 * earlier one — shifted the array under the index-based iterator and SILENTLY
 * SKIPPED its neighbour that frame. The contract now, for both:
 *
 *   1. every entry registered at frame start runs exactly once, UNLESS it is
 *      unregistered before its turn (then it does not run at all);
 *   2. an entry registered DURING the loop runs on the NEXT frame, never this
 *      one (the same deterministic rule design-009 gives behavior instances).
 *
 * Schema names are file-unique ("re*") — strata has no public schema reset.
 */
import { createWorld, field } from "@vibecook/strata-ecs";
import type { World } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import { createEngine } from "../src/engine/engine";
import { defineComponent } from "../src/schema/meta";

const reVal = defineComponent("reVal", { n: field("f64", { default: 0 }) });

function makeWorld(): World {
  const w = createWorld();
  w.spawn({ components: [[reVal, { n: 0 }]] });
  return w;
}

describe("publish hooks — the snapshot rule", () => {
  it("a hook that removes ITSELF does not skip the next hook", () => {
    const engine = createEngine(makeWorld());
    const ran: string[] = [];

    const removeA = engine.onPublish(() => {
      ran.push("a");
      removeA?.(); // the exact shape that used to eat "b"
    });
    engine.onPublish(() => ran.push("b"));
    engine.onPublish(() => ran.push("c"));

    engine.step(16);
    expect(ran).toEqual(["a", "b", "c"]);

    ran.length = 0;
    engine.step(32);
    expect(ran).toEqual(["b", "c"]); // a is gone, the rest survive
  });

  it("a hook that removes an EARLIER hook does not skip the one after it", () => {
    const engine = createEngine(makeWorld());
    const ran: string[] = [];

    const removeA = engine.onPublish(() => ran.push("a"));
    engine.onPublish(() => {
      ran.push("b");
      removeA();
    });
    engine.onPublish(() => ran.push("c"));

    engine.step(16);
    expect(ran).toEqual(["a", "b", "c"]);
  });

  it("a hook removed BEFORE its turn does not run that frame", () => {
    const engine = createEngine(makeWorld());
    const ran: string[] = [];

    const later: { removeC?: () => void } = {};
    engine.onPublish(() => {
      ran.push("a");
      later.removeC?.(); // kills a hook that has not run yet
    });
    engine.onPublish(() => ran.push("b"));
    later.removeC = engine.onPublish(() => ran.push("c"));

    engine.step(16);
    expect(ran).toEqual(["a", "b"]); // liveness beats the stale snapshot
  });

  it("a hook registered DURING publish runs next frame, not this one", () => {
    const engine = createEngine(makeWorld());
    const ran: string[] = [];

    let added = false;
    engine.onPublish(() => {
      ran.push("a");
      if (!added) {
        added = true;
        engine.onPublish(() => ran.push("late"));
      }
    });

    engine.step(16);
    expect(ran).toEqual(["a"]);

    ran.length = 0;
    engine.step(32);
    expect(ran).toEqual(["a", "late"]);
  });

  it("the same function registered twice is removed once, and the twin survives", () => {
    const engine = createEngine(makeWorld());
    let n = 0;
    const hook = () => {
      n++;
    };

    const removeFirst = engine.onPublish(hook);
    engine.onPublish(hook);

    engine.step(16);
    expect(n).toBe(2);

    removeFirst();
    removeFirst(); // idempotent: must not take the twin down with it
    n = 0;
    engine.step(32);
    expect(n).toBe(1);
  });
});

describe("reflectors — the same snapshot rule", () => {
  it("a reflector that unregisters ITSELF does not skip the next one", () => {
    const engine = createEngine(makeWorld());
    const ran: string[] = [];

    const removeA = engine.registerReflector({
      name: "a",
      always: true,
      flush: () => {
        ran.push("a");
        removeA?.();
      },
    });
    engine.registerReflector({ name: "b", always: true, flush: () => ran.push("b") });
    engine.registerReflector({ name: "c", always: true, flush: () => ran.push("c") });

    engine.step(16);
    expect(ran).toEqual(["a", "b", "c"]);
    expect(engine.reflectorNames()).toEqual(["b", "c"]);

    ran.length = 0;
    engine.step(32);
    expect(ran).toEqual(["b", "c"]);
  });

  it("a reflector unregistered before its turn does not flush that frame", () => {
    const engine = createEngine(makeWorld());
    const ran: string[] = [];

    const later: { removeC?: () => void } = {};
    engine.registerReflector({
      name: "a",
      always: true,
      flush: () => {
        ran.push("a");
        later.removeC?.();
      },
    });
    later.removeC = engine.registerReflector({
      name: "c",
      always: true,
      flush: () => ran.push("c"),
    });

    engine.step(16);
    expect(ran).toEqual(["a"]);
  });

  it("a reflector registered during a flush paints on the NEXT frame (first-paint dirt intact)", () => {
    const engine = createEngine(makeWorld());
    const ran: string[] = [];

    let added = false;
    engine.registerReflector({
      name: "a",
      always: true,
      flush: () => {
        ran.push("a");
        if (!added) {
          added = true;
          engine.registerReflector({ name: "late", flush: () => ran.push("late") });
        }
      },
    });

    engine.step(16);
    expect(ran).toEqual(["a"]);

    ran.length = 0;
    engine.step(32);
    // "late" registers dirty, so its first flush paints unconditionally.
    expect(ran).toEqual(["a", "late"]);
  });
});

describe("reflect telemetry (the lane that never reported)", () => {
  it("reports reflector cost that phaseFlushMicros structurally cannot", () => {
    const engine = createEngine(makeWorld());
    engine.enableTelemetry();
    engine.registerReflector({
      name: "chrome",
      always: true,
      flush: () => {
        // Burn a measurable slice so the assertion is not timer-noise.
        const until = performance.now() + 2;
        while (performance.now() < until) {
          /* spin */
        }
      },
    });

    engine.step(16);
    const frame = engine.lastFrame();

    expect(frame?.phaseFlushMicros.get("reflect")).toBeUndefined(); // never was a phase
    expect(frame?.reflectMicros ?? 0).toBeGreaterThan(0);
    expect(frame?.reflectorMicros.get("chrome") ?? 0).toBeGreaterThan(0);
    expect(frame?.reflectorsFlushed).toEqual(["chrome"]);
  });

  it("stays at zero cost when telemetry is not armed", () => {
    const engine = createEngine(makeWorld());
    engine.registerReflector({ name: "chrome", always: true, flush: () => {} });

    engine.step(16);
    expect(engine.lastFrame()).toBeUndefined(); // no telemetry, no readout at all
  });

  it("charges a THROWING reflector's cost (a slow-then-throwing one must not hide)", () => {
    const engine = createEngine(makeWorld());
    engine.enableTelemetry();
    engine.registerReflector({
      name: "bad",
      always: true,
      flush: () => {
        const until = performance.now() + 2;
        while (performance.now() < until) {
          /* spin */
        }
        throw new Error("reflector fault");
      },
    });

    engine.step(16); // fault-isolated: the step survives
    const frame = engine.lastFrame();
    expect(frame?.reflectorMicros.get("bad") ?? 0).toBeGreaterThan(0);
    expect(frame?.reflectorsFlushed).toEqual([]); // threw, so never counted as flushed
  });
});
