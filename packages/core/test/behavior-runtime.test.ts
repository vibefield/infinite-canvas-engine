/**
 * The behavior delivery loop (design-009 §4.3 tables, §5.1–§5.2 — M13b exits).
 *
 * Every trace here is one row of a table the design pins: the delivery ORDER,
 * the instance SNAPSHOT rule, appear/depart over the drained set, the two
 * collectors ("update is about you, changed is about the world"), the polls
 * that stand in for change mechanisms strata does not have (relations and
 * resources never journal), and per-instance fault quarantine.
 *
 * Behavior names are file-unique ("brt:*") — strata's schema registry has no
 * public reset, so a name defined here must not collide with another file's.
 */
import { createWorld, field } from "@vibecook/strata-ecs";
import type { Entity, World } from "@vibecook/strata-ecs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetBehaviorsForTests, defineBehavior } from "../src/behavior/define-behavior";
import { createBehaviorRuntime, type BehaviorRuntime } from "../src/behavior/runtime";
import { createEngine, type Engine } from "../src/engine/engine";
import { defineComponent, defineResource, defineTag } from "../src/schema/meta";
import { p } from "../src/widget/props";

const Tint = defineComponent("brtTint", { v: field("f64", { default: 0 }) });
const Marked = defineTag("brtMarked");
const Mood = defineResource("brtMood", { level: field("f64", { default: 0 }) });

let world: World;
let engine: Engine;
let runtime: BehaviorRuntime;
let faults: { hook: string; entity: Entity | undefined }[];
let frame = 0;

beforeEach(() => {
  world = createWorld();
  engine = createEngine(world);
  faults = [];
  runtime = createBehaviorRuntime({
    world,
    engine,
    onFault: (_b, hook, entity) => faults.push({ hook, entity }),
    onLog: () => {},
  });
  frame = 0;
});

afterEach(() => {
  runtime.dispose();
  __resetBehaviorsForTests();
});

/** One engine frame. `now` advances so FrameInfo produces a sane dt. */
function step(): void {
  frame += 16;
  engine.step(frame);
}

describe("delivery order and lifecycle", () => {
  it("runs init before the first tick, and dispose on detach", () => {
    const log: string[] = [];
    const B = defineBehavior("brt:lifecycle", {
      store: "runtime",
      phase: "simulate",
      schema: { n: p.number({ default: 1 }) },
      on: {
        init: (e) => log.push(`init:${e}`),
        tick: (e) => log.push(`tick:${e}`),
        dispose: (e) => log.push(`dispose:${e}`),
      },
    });
    runtime.register(B);
    const e = world.spawn({ components: [[Tint, { v: 0 }]] });
    runtime.attach(e, B);

    step();
    expect(log).toEqual([`init:${e}`, `tick:${e}`]);

    step();
    expect(log).toEqual([`init:${e}`, `tick:${e}`, `tick:${e}`]);

    runtime.detach(e, B);
    step();
    expect(log.at(-1)).toBe(`dispose:${e}`);
  });

  it("delivers init for an instance that existed BEFORE the behavior registered", () => {
    const seen: Entity[] = [];
    const B = defineBehavior("brt:preexisting", {
      store: "runtime",
      phase: "simulate",
      schema: { n: p.number({ default: 0 }) },
      on: { init: (e) => seen.push(e) },
    });
    // Attach happens through the raw component before the runtime knows the
    // behavior at all — the generation-start case (§4.3 "existing at
    // generation start"), which the first-frame full walk is responsible for.
    const e = world.spawn({ components: [[B.component, { n: 0 }]] });
    runtime.register(B);
    step();
    expect(seen).toEqual([e]);
  });

  it("attach+detach inside ONE frame delivers NEITHER init nor dispose", () => {
    const log: string[] = [];
    const B = defineBehavior("brt:halfborn", {
      store: "runtime",
      phase: "simulate",
      schema: { n: p.number({ default: 0 }) },
      on: { init: () => log.push("init"), dispose: () => log.push("dispose") },
    });
    runtime.register(B);
    step(); // seed, so the next frame is a delta frame not a full walk

    const e = world.spawn({ components: [[Tint, { v: 0 }]] });
    runtime.attach(e, B);
    runtime.detach(e, B);
    step();

    // The instance-set delta is computed BETWEEN phase entries, so a pair that
    // cancels inside one frame is not an event — there are no half-born
    // instances to reason about.
    expect(log).toEqual([]);
  });

  it("a hook attaching a new instance affects the NEXT frame, never this one", () => {
    const inits: Entity[] = [];
    const later: { neighbour?: Entity } = {};
    const B = defineBehavior("brt:snapshot", {
      store: "runtime",
      phase: "simulate",
      schema: { n: p.number({ default: 0 }) },
      on: {
        init: (e, _d, ctx) => {
          inits.push(e);
          if (later.neighbour !== undefined && e !== later.neighbour) ctx.attach(later.neighbour);
        },
      },
    });
    runtime.register(B);
    const first = world.spawn({ components: [[Tint, { v: 0 }]] });
    later.neighbour = world.spawn({ components: [[Tint, { v: 1 }]] });
    runtime.attach(first, B);

    // `ctx.attach` is the DEFERRED structural op — it lands at the phase
    // boundary, so the new instance's init runs next frame. (Behaviors have no
    // spawn vocabulary at all: `world.spawn` inside a hook is illegal at
    // iteration depth, and free-standing entity kinds are a named v1 fence.)
    step();
    expect(inits).toEqual([first]);

    step();
    expect(inits).toEqual([first, later.neighbour]);
  });

  it("quarantines ONE instance after three consecutive throws, leaving its neighbours alone", () => {
    const ticked: Entity[] = [];
    const held: { bad?: Entity } = {};
    const B = defineBehavior("brt:quarantine", {
      store: "runtime",
      phase: "simulate",
      schema: { n: p.number({ default: 0 }) },
      on: {
        tick: (e) => {
          if (e === held.bad) throw new Error("boom");
          ticked.push(e);
        },
      },
    });
    runtime.register(B);
    held.bad = world.spawn({ components: [[Tint, { v: 0 }]] });
    const good = world.spawn({ components: [[Tint, { v: 0 }]] });
    runtime.attach(held.bad, B);
    runtime.attach(good, B);

    for (let i = 0; i < 5; i++) step();

    // Three throws quarantine the bad instance; the good one ticks every frame.
    expect(faults.filter((f) => f.entity === held.bad)).toHaveLength(3);
    expect(ticked.filter((e) => e === good)).toHaveLength(5);
    expect(runtime.list()[0]?.failed).toBe(1);
  });
});

describe("change delivery", () => {
  it("update fires for own-data change with the previous snapshot, not for reads churn", () => {
    const updates: { n: number; prev: number }[] = [];
    const B = defineBehavior("brt:update", {
      store: "runtime",
      phase: "simulate",
      schema: { n: p.number({ default: 0 }) },
      reads: [Tint],
      on: { update: (_e, data, prev) => updates.push({ n: data.n as number, prev: prev.n as number }) },
    });
    runtime.register(B);
    const e = world.spawn({ components: [[Tint, { v: 0 }]] });
    runtime.attach(e, B, { n: 1 });
    step();
    expect(updates).toEqual([]);

    runtime.attach(e, B, { n: 2 }); // attach-when-attached = a value write
    step();
    expect(updates).toEqual([{ n: 2, prev: 1 }]);

    // A reads-set write is NOT an update: "update is about you".
    world.edit(e).set(Tint, { v: 99 });
    step();
    expect(updates).toEqual([{ n: 2, prev: 1 }]);
  });

  it("does not fire update when the write lands the SAME value", () => {
    const updates: number[] = [];
    const B = defineBehavior("brt:samevalue", {
      store: "runtime",
      phase: "simulate",
      schema: { n: p.number({ default: 0 }) },
      on: { update: (_e, d) => updates.push(d.n as number) },
    });
    runtime.register(B);
    const e = world.spawn({ components: [[Tint, { v: 0 }]] });
    runtime.attach(e, B, { n: 5 });
    step();

    // The journal OVER-REPORTS: this write journals the entity even though the
    // value is identical. A real value compare is what keeps `update` honest.
    world.edit(e).set(B.component, { n: 5 });
    step();
    expect(updates).toEqual([]);
  });

  it("changed fires ONCE per behavior per frame, however many instances churned", () => {
    let calls = 0;
    const B = defineBehavior("brt:changedonce", {
      store: "runtime",
      phase: "simulate",
      schema: { n: p.number({ default: 0 }) },
      reads: [Tint],
      on: { changed: () => calls++ },
    });
    runtime.register(B);
    const a = world.spawn({ components: [[Tint, { v: 0 }]] });
    const b = world.spawn({ components: [[Tint, { v: 0 }]] });
    runtime.attach(a, B);
    runtime.attach(b, B);
    step();
    calls = 0;

    world.edit(a).set(Tint, { v: 1 });
    world.edit(b).set(Tint, { v: 2 });
    step();
    expect(calls).toBe(1);
  });

  it("changed sees a TAG flip through the collector, and changedEntities narrows to instances", () => {
    let changedEntities: Entity[] = [];
    const B = defineBehavior("brt:tagread", {
      store: "runtime",
      phase: "simulate",
      schema: { n: p.number({ default: 0 }) },
      reads: [Marked],
      on: {
        changed: (ctx) => {
          changedEntities = [...ctx.changedEntities()];
        },
      },
    });
    runtime.register(B);
    const mine = world.spawn({ components: [[Tint, { v: 0 }]] });
    const theirs = world.spawn({ components: [[Tint, { v: 0 }]] });
    runtime.attach(mine, B);
    step();

    world.addTag(mine, Marked);
    world.addTag(theirs, Marked);
    step();
    expect(changedEntities).toEqual([mine]);
  });

  it("wakes on a RESOURCE write, which no collector can see", () => {
    let calls = 0;
    const B = defineBehavior("brt:resourceread", {
      store: "runtime",
      phase: "simulate",
      schema: { n: p.number({ default: 0 }) },
      reads: [Mood],
      on: { changed: () => calls++ },
    });
    runtime.register(B);
    const e = world.spawn({ components: [[Tint, { v: 0 }]] });
    runtime.attach(e, B);
    step();
    calls = 0;

    step();
    expect(calls).toBe(0); // quiet frame: the poll did not fire

    world.setResource(Mood, { level: 3 });
    step();
    expect(calls).toBe(1);
  });

  it("an unattached behavior runs NOTHING even while the world churns", () => {
    const calls: string[] = [];
    const B = defineBehavior("brt:unattached", {
      store: "runtime",
      phase: "simulate",
      schema: { n: p.number({ default: 0 }) },
      reads: [Tint],
      on: { changed: () => calls.push("changed"), tick: () => calls.push("tick") },
    });
    runtime.register(B);
    const e = world.spawn({ components: [[Tint, { v: 0 }]] });
    step();
    calls.length = 0;

    for (let i = 0; i < 3; i++) {
      world.edit(e).set(Tint, { v: i });
      step();
    }
    expect(calls).toEqual([]);
  });
});

describe("generations", () => {
  it("world.reset disposes every instance and re-inits what survives", () => {
    const log: string[] = [];
    let signalAborted = false;
    const B = defineBehavior("brt:generation", {
      store: "runtime",
      phase: "simulate",
      schema: { n: p.number({ default: 0 }) },
      on: {
        init: (_e, _d, ctx) => {
          log.push("init");
          ctx.signal.addEventListener("abort", () => {
            signalAborted = true;
          });
        },
        dispose: () => log.push("dispose"),
      },
    });
    runtime.register(B);
    const e = world.spawn({ components: [[Tint, { v: 0 }]] });
    runtime.attach(e, B);
    step();
    expect(log).toEqual(["init"]);

    world.reset();
    step();

    // dispose FIRST, abort SECOND — a teardown guarding on signal.aborted must
    // still get to run its own cleanup.
    expect(log).toEqual(["init", "dispose"]);
    expect(signalAborted).toBe(true);

    const revived = world.spawn({ components: [[Tint, { v: 0 }]] });
    runtime.attach(revived, B);
    step();
    expect(log).toEqual(["init", "dispose", "init"]);
  });
});

describe("ctx.query", () => {
  it("walks the declared reads and refuses an undeclared term", () => {
    let found: Entity[] = [];
    let refused: unknown;
    const B = defineBehavior("brt:query", {
      store: "runtime",
      phase: "simulate",
      schema: { n: p.number({ default: 0 }) },
      reads: [Tint],
      on: {
        changed: (ctx) => {
          found = ctx.query({ all: [Tint] }).entities();
          try {
            ctx.query({ all: [Marked] }).entities();
          } catch (err) {
            refused = err;
          }
        },
      },
    });
    runtime.register(B);
    const a = world.spawn({ components: [[Tint, { v: 0 }]] });
    const b = world.spawn({ components: [[Tint, { v: 0 }]] });
    runtime.attach(a, B);
    step();

    world.edit(b).set(Tint, { v: 1 });
    step();
    expect(found.sort()).toEqual([a, b].sort());
    expect(String(refused)).toContain("not in its reads:");
  });
});

describe("the frame contract", () => {
  it("charges the guest breaker and reports a doctor row", () => {
    const B = defineBehavior("brt:budget", {
      store: "runtime",
      phase: "simulate",
      budgetMs: 3,
      schema: { n: p.number({ default: 0 }) },
      on: { tick: () => {} },
    });
    runtime.register(B);
    const e = world.spawn({ components: [[Tint, { v: 0 }]] });
    runtime.attach(e, B);
    step();

    const row = engine.guests.list().find((g) => g.id === "behavior:brt:budget");
    expect(row).toBeDefined();
    expect(row?.budgetMs).toBe(3);
    expect(row?.status).toBe("running");
  });

  it("uninstall removes the systems AND the guest row", () => {
    const spy = vi.fn();
    const B = defineBehavior("brt:uninstall", {
      store: "runtime",
      phase: "simulate",
      schema: { n: p.number({ default: 0 }) },
      on: { tick: spy },
    });
    const off = runtime.register(B);
    const e = world.spawn({ components: [[Tint, { v: 0 }]] });
    runtime.attach(e, B);
    step();
    expect(spy).toHaveBeenCalledTimes(1);

    off();
    step();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(engine.guests.list().some((g) => g.id === "behavior:brt:uninstall")).toBe(false);
  });
});
