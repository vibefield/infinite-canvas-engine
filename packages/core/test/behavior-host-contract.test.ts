import { defineComponent as strataDefineComponent, field } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import {
  createCanvasEngine,
  defineBehavior,
  defineTickSystem,
  describeBehavior,
  p,
  type GuestLedgerRecord,
} from "../src";
import { setDevGuards } from "../src/guards/dev";

function spawn(engine: ReturnType<typeof createCanvasEngine>) {
  return engine.world.spawn({});
}

describe("downstream behavior host contract", () => {
  it("projects one canonical JSON-safe declaration without function or process identity", () => {
    const Behavior = defineBehavior("host:descriptor", {
      store: "durable",
      version: 2,
      budgetMs: 3,
      schema: {
        count: p.number({ default: 2, min: 0, max: 20 }),
        mode: p.enum(["compact", "wide"], { default: "wide" }),
      },
      migrate: {
        1(previous) {
          return previous;
        },
      },
      on: {
        init() {},
        tick() {},
      },
    });

    const descriptor = describeBehavior(Behavior);
    expect(JSON.parse(JSON.stringify(descriptor))).toEqual(descriptor);
    expect(descriptor).toMatchObject({
      id: "host:descriptor",
      store: "durable",
      version: 2,
      budgetMs: 3,
      migrationFrom: [1],
      hooks: ["init", "tick"],
    });
    expect(JSON.stringify(descriptor)).not.toContain("fieldByName");
    expect(JSON.stringify(descriptor)).not.toContain("~standard");
  });

  it("orders live behavior execution by host key without reinitializing unaffected nodes", () => {
    const events: string[] = [];
    let secondInits = 0;
    const First = defineBehavior("host:ordered-first", {
      store: "runtime",
      phase: "simulate",
      on: { tick: () => events.push("first") },
    });
    const Second = defineBehavior("host:ordered-second", {
      store: "runtime",
      phase: "simulate",
      on: {
        init() {
          secondInits++;
        },
        tick: () => events.push("second"),
      },
    });
    const engine = createCanvasEngine();
    const removeSecond = engine.behaviors.register(Second, { orderKey: "002" });
    const removeFirst = engine.behaviors.register(First, { orderKey: "001" });
    const entity = spawn(engine);
    engine.behaviors.attach(entity, First);
    engine.behaviors.attach(entity, Second);
    engine.step(16);
    expect(events).toEqual(["first", "second"]);
    expect(secondInits).toBe(1);

    events.length = 0;
    removeFirst();
    const removeFirstAgain = engine.behaviors.register(First, { orderKey: "001" });
    engine.step(32);
    expect(events).toEqual(["first", "second"]);
    expect(secondInits).toBe(1);

    removeFirstAgain();
    removeSecond();
    engine.dispose();
  });

  it("applies the same host order to publish-slot behaviors", () => {
    const events: string[] = [];
    const First = defineBehavior("host:publish-first", {
      store: "runtime",
      phase: "publish",
      on: { tick: () => events.push("first") },
    });
    const Second = defineBehavior("host:publish-second", {
      store: "runtime",
      phase: "publish",
      on: { tick: () => events.push("second") },
    });
    const engine = createCanvasEngine();
    engine.behaviors.register(Second, { orderKey: "002" });
    engine.behaviors.register(First, { orderKey: "001" });
    const entity = spawn(engine);
    engine.behaviors.attach(entity, First);
    engine.behaviors.attach(entity, Second);
    engine.step(16);

    expect(events).toEqual(["first", "second"]);
    engine.dispose();
  });

  it("seeds the driven guest ledger at behavior registration", () => {
    const Behavior = defineBehavior("host:ledger", { store: "runtime" });
    const engine = createCanvasEngine();
    const changes: GuestLedgerRecord[] = [];
    const stop = engine.engine.guests.onLedgerChange((id, record) => {
      if (id === "behavior:host:ledger") changes.push(record);
    });
    const remove = engine.behaviors.register(Behavior, {
      orderKey: "host:ledger",
      ledger: { strikes: 7, suspended: true },
    });

    expect(engine.engine.guests.list()).toContainEqual(
      expect.objectContaining({
        id: "behavior:host:ledger",
        status: "suspended",
        strikes: 7,
      }),
    );
    engine.engine.guests.resume("behavior:host:ledger");
    expect(changes.at(-1)).toEqual({ strikes: 7, suspended: false });

    stop();
    remove();
    engine.dispose();
  });

  it("routes behavior fault and log provenance separately from generic guest hooks", () => {
    const logs: unknown[][] = [];
    const faults: unknown[][] = [];
    const Behavior = defineBehavior("host:routing", {
      store: "runtime",
      on: {
        init(_entity, _data, ctx) {
          ctx.log("hello", { source: "behavior" });
          throw new Error("boom");
        },
      },
    });
    const engine = createCanvasEngine({
      onBehaviorLog: (...args) => logs.push(args),
      onBehaviorFault: (...args) => faults.push(args),
    });
    engine.behaviors.register(Behavior);
    const entity = spawn(engine);
    engine.behaviors.attach(entity, Behavior);
    engine.step(16);

    expect(logs).toEqual([["host:routing", "hello", [{ source: "behavior" }]]]);
    expect(faults).toHaveLength(1);
    expect(faults[0]?.slice(0, 3)).toEqual(["host:routing", "init", entity]);
    expect(faults[0]?.[3]).toBeInstanceOf(Error);
    engine.dispose();
  });

  it("turns thenable hook returns into attributed synchronous faults", async () => {
    const faults: unknown[][] = [];
    const guestFaults: unknown[][] = [];
    const guestNotices: string[] = [];
    let continuations = 0;
    const Behavior = defineBehavior("host:thenable", {
      store: "runtime",
      phase: "simulate",
      on: {
        async tick() {
          await Promise.resolve();
          continuations++;
        },
      },
    });
    const engine = createCanvasEngine({
      onBehaviorFault: (...args) => faults.push(args),
      onGuestFault: (...args) => guestFaults.push(args),
      onGuestNotice: (message) => guestNotices.push(message),
    });
    engine.behaviors.register(Behavior);
    engine.behaviors.attach(spawn(engine), Behavior);
    engine.step(16);
    engine.step(32);
    engine.step(48);
    await Promise.resolve();

    expect(continuations).toBe(3);
    expect(faults).toHaveLength(3);
    expect(guestFaults).toHaveLength(3);
    expect(guestNotices).toHaveLength(1);
    expect(String(faults[0]?.[3])).toContain("returned a thenable");
    expect(engine.behaviors.list()[0]?.failed).toBe(1);
    expect(engine.engine.guests.list()[0]).toMatchObject({
      status: "suspended",
      strikes: 3,
    });
    engine.dispose();
  });

  // --- host-side pins beyond the petition's six controls ---------------------

  it("runs the keyed lane before unkeyed registrations regardless of arrival order", () => {
    const events: string[] = [];
    const Unkeyed = defineBehavior("host:lane-unkeyed", {
      store: "runtime",
      phase: "simulate",
      on: { tick: () => events.push("unkeyed") },
    });
    const Keyed = defineBehavior("host:lane-keyed", {
      store: "runtime",
      phase: "simulate",
      on: { tick: () => events.push("keyed") },
    });
    const engine = createCanvasEngine();
    engine.behaviors.register(Unkeyed);
    engine.behaviors.register(Keyed, { orderKey: "001" });
    const entity = spawn(engine);
    engine.behaviors.attach(entity, Unkeyed);
    engine.behaviors.attach(entity, Keyed);
    engine.step(16);

    expect(events).toEqual(["keyed", "unkeyed"]);
    engine.dispose();
  });

  it("refuses an empty orderKey loudly instead of silently sorting it first", () => {
    const Behavior = defineBehavior("host:empty-key", { store: "runtime" });
    const engine = createCanvasEngine();
    expect(() => engine.behaviors.register(Behavior, { orderKey: "" })).toThrow(
      /orderKey must be a non-empty string/,
    );
    // The refused registration must leave no residue: a clean retry succeeds.
    const remove = engine.behaviors.register(Behavior, { orderKey: "001" });
    remove();
    engine.dispose();
  });

  it("attributes thenable dispose hooks without letting them stop teardown", async () => {
    const faults: unknown[][] = [];
    let continuations = 0;
    const Behavior = defineBehavior("host:async-dispose", {
      store: "runtime",
      on: {
        async dispose() {
          await Promise.resolve();
          continuations++;
        },
      },
    });
    const engine = createCanvasEngine({
      onBehaviorFault: (...args) => faults.push(args),
    });
    const remove = engine.behaviors.register(Behavior);
    const one = spawn(engine);
    const two = spawn(engine);
    engine.behaviors.attach(one, Behavior);
    engine.behaviors.attach(two, Behavior);
    engine.step(16);

    // Teardown must not stop teardown (§4.3): BOTH instances get their dispose
    // call and their attributed fault, and the uninstall itself completes.
    remove();
    await Promise.resolve();
    expect(continuations).toBe(2);
    expect(faults).toHaveLength(2);
    // The asymmetry is deliberate and pinned: dispose thenables are attributed
    // but never strike the breaker — teardown must not stop teardown.
    expect(engine.engine.guests.list().some((g) => g.strikes > 0)).toBe(false);
    expect(faults.map((f) => f[1])).toEqual(["dispose", "dispose"]);
    expect(faults.map((f) => f[0])).toEqual(["host:async-dispose", "host:async-dispose"]);
    expect(String(faults[0]?.[3])).toContain("returned a thenable");
    expect(engine.behaviors.registered()).toHaveLength(0);
    engine.dispose();
  });

  // --- pre-publish adversarial review pins (findings 2–5) --------------------

  it("register() from inside a publish hook never skips a later publish behavior that frame", () => {
    const events: string[] = [];
    const engine = createCanvasEngine();
    const Late = defineBehavior("host:pub-late", {
      store: "runtime",
      phase: "publish",
      on: { tick: () => events.push("late") },
    });
    const Newcomer = defineBehavior("host:pub-newcomer", {
      store: "runtime",
      phase: "publish",
      on: { tick: () => events.push("newcomer") },
    });
    let registered = false;
    const Early = defineBehavior("host:pub-early", {
      store: "runtime",
      phase: "publish",
      on: {
        tick: () => {
          events.push("early");
          if (!registered) {
            registered = true;
            engine.behaviors.register(Newcomer);
          }
        },
      },
    });
    engine.behaviors.register(Early, { orderKey: "001" });
    engine.behaviors.register(Late, { orderKey: "002" });
    const e = spawn(engine);
    engine.behaviors.attach(e, Early);
    engine.behaviors.attach(e, Late);
    engine.step(16);
    // Under the per-node-hook shape this frame ran ["early"] only — the
    // reorder killed Late's snapshot entry mid-pass.
    expect(events).toEqual(["early", "late"]);

    engine.behaviors.attach(e, Newcomer);
    events.length = 0;
    engine.step(32);
    expect(events).toEqual(["early", "late", "newcomer"]);
    engine.dispose();
  });

  it("appending behaviors never moves them past host systems registered between", () => {
    // Review finding 3: reorderExecution must not re-append EVERYTHING on an
    // ordinary registration — 0.6.0's interleaving with host systems holds
    // for append-order registrations (the only reorder is an out-of-order
    // keyed insert, and then only the suffix moves).
    const order: string[] = [];
    const A = defineBehavior("host:interleave-a", {
      store: "runtime",
      phase: "simulate",
      on: { tick: () => order.push("behavior-a") },
    });
    const B = defineBehavior("host:interleave-b", {
      store: "runtime",
      phase: "simulate",
      on: { tick: () => order.push("behavior-b") },
    });
    const engine = createCanvasEngine();
    engine.behaviors.register(A);
    engine.engine.addSystems(
      "simulate",
      defineTickSystem(() => order.push("host-between"), { name: "host-between" }),
    );
    engine.behaviors.register(B);
    const e = spawn(engine);
    engine.behaviors.attach(e, A);
    engine.behaviors.attach(e, B);
    engine.step(16);
    expect(order).toEqual(["behavior-a", "host-between", "behavior-b"]);
    engine.dispose();
  });

  it("a thenable across many instances strikes the guest ONCE per frame, not per instance", async () => {
    // Review finding 4: strikes are a cumulative record hosts PERSIST across
    // engine generations — one bad frame must not write the population count
    // into the ledger. Attribution stays per-instance; the ladder counts
    // frames.
    const behaviorFaults: unknown[] = [];
    const B = defineBehavior("host:thenable-flood", {
      store: "runtime",
      phase: "simulate",
      on: {
        async tick() {
          await Promise.resolve();
        },
      },
    });
    const engine = createCanvasEngine({
      onBehaviorFault: (...args) => behaviorFaults.push(args),
      onGuestFault: () => {},
      onGuestNotice: () => {},
    });
    engine.behaviors.register(B);
    for (let i = 0; i < 5; i++) engine.behaviors.attach(spawn(engine), B);
    engine.step(16);
    expect(behaviorFaults).toHaveLength(5); // full per-instance attribution…
    expect(engine.engine.guests.list()[0]).toMatchObject({ strikes: 1, status: "running" }); // …ONE strike
    engine.step(32);
    engine.step(48);
    await Promise.resolve();
    expect(engine.engine.guests.list()[0]).toMatchObject({ strikes: 3, status: "suspended" });
    engine.dispose();
  });

  it("describes what RUNS: unclassifiable reads are skipped, never a production crash", () => {
    // Review finding 5: reads/writes validation is dev-guard-gated, so a
    // production build accepts (and runs) a behavior whose unregistered read
    // partitionReads silently drops. describeBehavior must describe that
    // reality, not crash the host's manifest build on it.
    const raw = strataDefineComponent("host:raw-unregistered", { v: field("f32", { default: 0 }) });
    setDevGuards(false);
    try {
      const B = defineBehavior("host:prod-describe", {
        store: "runtime",
        reads: [raw],
        on: {},
      });
      const d = describeBehavior(B);
      expect(d.reads).toEqual([]); // dropped, mirroring the runtime
    } finally {
      setDevGuards(true);
    }
  });
});
