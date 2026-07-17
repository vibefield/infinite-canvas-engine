/**
 * Frame-contract tests (design-002 §1–§5, the M3 core exit gate):
 * outer-frame ordering, FrameInfo clamping, group ordering, sub-phase settle
 * points, runIf-skip ⇒ no stamp, reflector dirty/always/fault/unregister,
 * publish-step legality, and run/skip telemetry.
 *
 * Schema names are file-unique ("eng*") — strata has no public schema reset.
 */
import { createWorld, defineQuery, defineSystem, field } from "@vibecook/strata-ecs";
import type { System, World } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import { createEngine } from "../src/engine/engine";
import { FrameInfo } from "../src/engine/frame-info";
import { PHASE_GROUPS } from "../src/engine/pipeline";
import { defineComponent, defineResource } from "../src/schema/meta";

const engVal = defineComponent("engVal", { n: field("f64", { default: 0 }) });
const engAnchor = defineComponent("engAnchor", { id: field("u32", { default: 0 }) });
const engSpawned = defineComponent("engSpawned", { n: field("f64", { default: 0 }) });
const engGate = defineResource("engGate", { open: field("bool", { default: true }) });

const valQ = defineQuery([engVal]);
const anchorQ = defineQuery([engAnchor]);
const spawnedQ = defineQuery([engSpawned]);

/** A world with one engVal entity and one engAnchor entity (bodies need a match to run). */
function makeWorld(): World {
  const w = createWorld();
  w.spawn({ components: [[engVal, { n: 0 }]] });
  w.spawn({ components: [[engAnchor, { id: 1 }]] });
  return w;
}

/** A system on anchorQ whose body runs once per frame (single anchor chunk). */
function onFrame(name: string, body: (ctx: Parameters<System["body"]>[1]) => void): System {
  return defineSystem(anchorQ, (_b, ctx) => body(ctx), { name });
}

describe("engine.step — the outer frame", () => {
  it("runs tick → publish → notify → reflect in order, once per step", () => {
    const world = makeWorld();
    const engine = createEngine(world);
    const order: string[] = [];

    engine.addSystems(
      "simulate",
      defineSystem(
        valQ,
        (b, ctx) => {
          order.push("tick");
          for (const r of b) ctx.edit(b.entity(r)).set(engVal, { n: 1 });
        },
        { name: "writer", access: { write: [engVal] } },
      ),
    );
    engine.onPublish(() => {
      order.push("publish");
      world.spawn(); // structural world.* is LEGAL here — post-tick (design-002 §3)
    });
    world.reactive.observeQuery(valQ, () => order.push("notify"), { cols: [engVal] });
    engine.registerReflector({
      name: "probe",
      observe: { queries: [{ q: valQ, cols: [engVal] }] },
      flush: () => order.push("reflect"),
    });

    engine.step(0);
    expect(order).toEqual(["tick", "publish", "notify", "reflect"]);
  });

  it("a structural world.* inside a system body still throws through step()", () => {
    const world = makeWorld();
    const engine = createEngine(world);
    engine.addSystems(
      "input",
      onFrame("illegal", () => {
        world.spawn();
      }),
    );
    expect(() => engine.step(0)).toThrow(/cannot|iteration/i);
  });
});

describe("FrameInfo", () => {
  it("ticks monotonically; dt diffs against previous now, clamped to 64ms, floored at 0", () => {
    const world = createWorld();
    const engine = createEngine(world);

    engine.step(100);
    expect(world.getResource(FrameInfo)).toEqual({ tick: 1, dt: 0, now: 100, clock: 0 });

    engine.step(116);
    expect(world.getResource(FrameInfo)).toEqual({ tick: 2, dt: 16, now: 116, clock: 16 });

    engine.step(1000); // background-tab hiccup — clamps
    expect(world.getResource(FrameInfo)?.dt).toBe(64);
    expect(world.getResource(FrameInfo)?.clock).toBe(80); // the gesture clock absorbs only the CLAMPED dt

    engine.step(900); // clock went backwards — floors at 0
    expect(world.getResource(FrameInfo)).toEqual({ tick: 4, dt: 0, now: 900, clock: 80 });
  });
});

describe("phase groups", () => {
  it("runs groups in canonical order regardless of registration order", () => {
    const world = makeWorld();
    const engine = createEngine(world);
    const order: string[] = [];

    // Registered deliberately out of order.
    engine.addSystems("cleanup", onFrame("c", () => order.push("cleanup")));
    engine.addSystems("input", onFrame("i", () => order.push("input")));
    engine.addSystems("ctl:behave", onFrame("b", () => order.push("ctl:behave")));
    engine.addSystems("derive", onFrame("d", () => order.push("derive")));

    engine.step(0);
    expect(order).toEqual(["input", "ctl:behave", "derive", "cleanup"]);
  });

  it("within a group, registration order is run order; removers work", () => {
    const world = makeWorld();
    const engine = createEngine(world);
    const order: string[] = [];

    engine.addSystems("derive", onFrame("first", () => order.push("first")));
    const remove = engine.addSystems("derive", onFrame("second", () => order.push("second")));
    engine.addSystems("derive", onFrame("third", () => order.push("third")));

    engine.step(0);
    expect(order).toEqual(["first", "second", "third"]);

    order.length = 0;
    remove();
    engine.step(1);
    expect(order).toEqual(["first", "third"]);
  });

  it("a ctl:spawn ctx.spawn is visible to ctl:recognize the SAME frame (sub-phase settle point)", () => {
    const world = makeWorld();
    const engine = createEngine(world);
    let seen = 0;
    let didSpawn = false;

    engine.addSystems(
      "ctl:spawn",
      onFrame("spawner", (ctx) => {
        // Spawn exactly once (first frame): flushes at ctl:spawn's phase boundary.
        if (!didSpawn) {
          didSpawn = true;
          ctx.spawn({ components: [[engSpawned, { n: 7 }]] });
        }
      }),
    );
    // Runs only if the query matches — a miss means the settle point failed.
    engine.addSystems(
      "ctl:recognize",
      defineSystem(
        spawnedQ,
        (b) => {
          seen += b.count;
        },
        { name: "counter" },
      ),
    );

    engine.step(0);
    expect(seen).toBe(1); // spawned in ctl:spawn, seen in ctl:recognize, frame 1
  });

  it("exposes the canonical group list", () => {
    expect(PHASE_GROUPS[0]).toBe("input");
    expect(PHASE_GROUPS).toContain("ctl:claim");
    expect(PHASE_GROUPS[PHASE_GROUPS.length - 1]).toBe("cleanup");
  });
});

describe("runIf guard doctrine (design-002 §4)", () => {
  it("a runIf-skipped system stamps nothing — Tier-1 observers stay silent", () => {
    const world = makeWorld();
    const engine = createEngine(world);
    world.setResource(engGate, { open: true });
    let fires = 0;
    world.reactive.observeQuery(valQ, () => fires++, { cols: [engVal] });

    engine.addSystems(
      "simulate",
      defineSystem(
        valQ,
        (b, ctx) => {
          for (const r of b) ctx.edit(b.entity(r)).set(engVal, { n: 2 });
        },
        {
          name: "gatedWriter",
          access: { write: [engVal] },
          runIf: (ctx) => ctx.getResource(engGate)?.open === true,
        },
      ),
    );

    engine.step(0); // gate open: runs, stamps, observer fires
    expect(fires).toBe(1);

    world.setResource(engGate, { open: false });
    engine.step(1); // skipped: no body, no stamp, no wake
    engine.step(2);
    expect(fires).toBe(1);

    world.setResource(engGate, { open: true });
    engine.step(3);
    expect(fires).toBe(2);
  });
});

describe("reflector registry (design-002 §5)", () => {
  it("first flush is unconditional (first-paint seed), then dirty-driven", () => {
    const world = makeWorld();
    const engine = createEngine(world);
    world.setResource(engGate, { open: false });
    let flushes = 0;

    engine.addSystems(
      "simulate",
      defineSystem(
        valQ,
        (b, ctx) => {
          for (const r of b) ctx.edit(b.entity(r)).set(engVal, { n: 3 });
        },
        {
          name: "writer",
          access: { write: [engVal] },
          runIf: (ctx) => ctx.getResource(engGate)?.open === true,
        },
      ),
    );
    engine.registerReflector({
      name: "boxes",
      observe: { queries: [{ q: valQ, cols: [engVal] }] },
      flush: () => flushes++,
    });

    engine.step(0); // nothing stamped, but first paint
    expect(flushes).toBe(1);
    engine.step(1); // still nothing stamped — quiet
    expect(flushes).toBe(1);

    world.setResource(engGate, { open: true });
    engine.step(2); // writer ran → stamped → dirty → flushed
    expect(flushes).toBe(2);
  });

  it("`always` reflectors flush every frame; unregister stops flushing", () => {
    const world = makeWorld();
    const engine = createEngine(world);
    let always = 0;
    let dirtyOnly = 0;

    const unregister = engine.registerReflector({ name: "hud", always: true, flush: () => always++ });
    engine.registerReflector({
      name: "quiet",
      observe: { queries: [{ q: valQ, cols: [engVal] }] },
      flush: () => dirtyOnly++,
    });

    engine.step(0);
    engine.step(1);
    engine.step(2);
    expect(always).toBe(3);
    expect(dirtyOnly).toBe(1); // first paint only — no writes ever

    unregister();
    engine.step(3);
    expect(always).toBe(3);
  });

  it("a throwing reflector is skipped this frame; later reflectors still flush; faults are reported", () => {
    const world = makeWorld();
    const faults: string[] = [];
    const engine = createEngine(world, { onReflectorFault: (name) => faults.push(name) });
    const flushed: string[] = [];

    engine.registerReflector({
      name: "faulty",
      always: true,
      flush: () => {
        flushed.push("faulty");
        throw new Error("boom");
      },
    });
    engine.registerReflector({ name: "healthy", always: true, flush: () => flushed.push("healthy") });

    expect(() => engine.step(0)).not.toThrow();
    expect(flushed).toEqual(["faulty", "healthy"]);
    expect(faults).toEqual(["faulty"]);

    engine.step(1); // still isolated, still ordered
    expect(flushed).toEqual(["faulty", "healthy", "faulty", "healthy"]);
  });

  it("resource observation marks dirty on actual value change only (Tier-3 equality)", () => {
    const world = makeWorld();
    const engine = createEngine(world);
    world.setResource(engGate, { open: true });
    let flushes = 0;

    engine.registerReflector({
      name: "gateWatcher",
      observe: { resources: [engGate] },
      flush: () => flushes++,
    });

    engine.step(0); // first paint
    expect(flushes).toBe(1);

    world.setResource(engGate, { open: true }); // same value — equality-suppressed
    engine.step(1);
    expect(flushes).toBe(1);

    world.setResource(engGate, { open: false }); // real change
    engine.step(2);
    expect(flushes).toBe(2);
  });
});

describe("telemetry (design-002 §4: run/skip visible)", () => {
  it("reports ran/skipped per system with the tick number and reflector flushes", () => {
    const world = makeWorld();
    const engine = createEngine(world);
    world.setResource(engGate, { open: false });

    engine.addSystems("input", onFrame("alwaysRuns", () => {}));
    engine.addSystems(
      "derive",
      defineSystem(valQ, () => {}, {
        name: "gatedOff",
        runIf: (ctx) => ctx.getResource(engGate)?.open === true,
      }),
    );
    engine.registerReflector({ name: "hud", always: true, flush: () => {} });

    expect(engine.lastFrame()).toBeUndefined();
    engine.enableTelemetry();
    engine.step(0);

    const frame = engine.lastFrame();
    expect(frame).toBeDefined();
    expect(frame?.tick).toBeGreaterThan(0);
    expect(frame?.systems).toContainEqual(
      expect.objectContaining({ phase: "input", system: "alwaysRuns", ran: true }),
    );
    expect(frame?.systems).toContainEqual(
      expect.objectContaining({ phase: "derive", system: "gatedOff", ran: false }),
    );
    expect(frame?.reflectorsFlushed).toContain("hud");
    expect(frame?.totalMicros).toBeGreaterThanOrEqual(0);
  });
});
