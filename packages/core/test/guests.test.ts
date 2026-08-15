/**
 * The guest runtime + its circuit breaker (petition I14 — M11b/M11c exits).
 *
 * Timing is driven by a FAKE `performance.now`, so every breaker threshold is
 * exercised exactly rather than approached by spinning: a guest "costs" what
 * the test says it costs. The engine's own frame path is otherwise real.
 *
 * Schema names are file-unique ("gu*") — strata has no public schema reset.
 */
import { createWorld, field } from "@vibecook/strata-ecs";
import type { World } from "@vibecook/strata-ecs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEngine } from "../src/engine/engine";
import { GUEST_BUDGET, createGuestRegistry } from "../src/engine/guests";
import type { GuestFrame, GuestLedgerRecord } from "../src/engine/guests";
import { setDevGuards } from "../src/guards/dev";
import { defineComponent } from "../src/schema/meta";

const guVal = defineComponent("guVal", { n: field("f64", { default: 0 }) });

let nowMs = 0;
const realNow = performance.now.bind(performance);

beforeEach(() => {
  nowMs = 0;
  performance.now = () => nowMs;
});

afterEach(() => {
  performance.now = realNow;
  setDevGuards(true);
});

function makeWorld(): World {
  const w = createWorld();
  w.spawn({ components: [[guVal, { n: 0 }]] });
  return w;
}

/** A guest whose every invocation "takes" `costMs` on the fake clock. */
function costing(costMs: number, onRun?: () => void) {
  return () => (): void => {
    nowMs += costMs;
    onRun?.();
  };
}

const FRAME: GuestFrame = { dtMs: 16, tick: 1, clock: 16 };

/** Drive N guest invocations through a registry directly. */
function pump(reg: { runAll(f: GuestFrame): void }, n: number): void {
  for (let i = 0; i < n; i++) reg.runAll(FRAME);
}

describe("guests — the named frame slot", () => {
  it("runs between the tick and the publish hooks, before notify/reflect", () => {
    const world = makeWorld();
    const engine = createEngine(world);
    const order: string[] = [];

    engine.guests.add({ id: "g", make: () => () => order.push("guest") });
    engine.onPublish(() => order.push("publish"));
    engine.registerReflector({ name: "r", always: true, flush: () => order.push("reflect") });

    engine.step(16);
    expect(order).toEqual(["guest", "publish", "reflect"]);
  });

  it("hands the guest FrameInfo — dt/tick/clock, not the raw rAF stamp", () => {
    const world = makeWorld();
    const engine = createEngine(world);
    const seen: GuestFrame[] = [];
    engine.guests.add({ id: "g", make: () => (f) => seen.push({ ...f }) });

    engine.step(1000);
    engine.step(1016);

    expect(seen[0]?.tick).toBe(1);
    expect(seen[0]?.dtMs).toBe(0); // first frame has no previous `now`
    expect(seen[1]?.tick).toBe(2);
    expect(seen[1]?.dtMs).toBe(16);
    expect(seen[1]?.clock).toBe(16);
  });
});

describe("guests — the snapshot rule", () => {
  it("a guest that removes ITSELF does not skip its neighbour", () => {
    const reg = createGuestRegistry(makeWorld());
    const ran: string[] = [];
    const removeA = reg.add({
      id: "a",
      make: () => () => {
        ran.push("a");
        removeA?.();
      },
    });
    reg.add({ id: "b", make: () => () => ran.push("b") });

    reg.runAll(FRAME);
    expect(ran).toEqual(["a", "b"]);

    ran.length = 0;
    reg.runAll(FRAME);
    expect(ran).toEqual(["b"]);
  });

  it("a guest added DURING a run starts next frame", () => {
    const reg = createGuestRegistry(makeWorld());
    const ran: string[] = [];
    let added = false;
    reg.add({
      id: "a",
      make: () => () => {
        ran.push("a");
        if (!added) {
          added = true;
          reg.add({ id: "late", make: () => () => ran.push("late") });
        }
      },
    });

    reg.runAll(FRAME);
    expect(ran).toEqual(["a"]);
    reg.runAll(FRAME);
    expect(ran).toEqual(["a", "a", "late"]);
  });

  it("refuses a duplicate id and a reserved phase", () => {
    const reg = createGuestRegistry(makeWorld());
    reg.add({ id: "a", make: () => () => {} });
    expect(() => reg.add({ id: "a", make: () => () => {} })).toThrow(/already registered/);
    expect(() =>
      // @ts-expect-error — pipeline phases arrive with the behavior framework
      reg.add({ id: "b", make: () => () => {}, phase: "derive" }),
    ).toThrow(/reserved/);
  });
});

describe("guests — fault isolation", () => {
  it("a throwing guest never kills the frame, the loop, or its neighbours", () => {
    const world = makeWorld();
    const engine = createEngine(world, { onGuestFault: () => {}, onGuestNotice: () => {} });
    const ran: string[] = [];
    const faults: string[] = [];
    engine.guests.add({
      id: "bad",
      make: () => () => {
        ran.push("bad");
        throw new Error("hostile");
      },
    });
    engine.guests.add({ id: "good", make: () => () => ran.push("good") });
    engine.onPublish(() => ran.push("publish"));
    // Faults are reported through the registry's sink, not thrown.
    engine.guests.onLedgerChange((id) => faults.push(id));

    expect(() => engine.step(16)).not.toThrow();
    expect(ran).toEqual(["bad", "good", "publish"]);
    expect(faults).toContain("bad");
  });

  it("a factory that throws marks the guest failed without touching the frame", () => {
    const reg = createGuestRegistry(makeWorld(), { onFault: () => {} });
    reg.add({
      id: "bad",
      make: () => {
        throw new Error("make failed");
      },
    });
    expect(() => reg.runAll(FRAME)).not.toThrow();
    expect(reg.list()[0]?.status).toBe("failed");
  });
});

describe("guests — generation replay", () => {
  it("world.reset disposes instances, aborts their signal, and re-makes at the next step", () => {
    const world = makeWorld();
    const reg = createGuestRegistry(world);
    const events: string[] = [];
    let generation = 0;

    reg.add({
      id: "g",
      make: (gen) => {
        const mine = ++generation;
        events.push(`make${mine}`);
        gen.signal.addEventListener("abort", () => events.push(`abort${mine}`));
        return {
          run: () => events.push(`run${mine}`),
          dispose: () => events.push(`dispose${mine}`),
        };
      },
    });

    reg.runAll(FRAME);
    expect(events).toEqual(["make1", "run1"]);

    world.reset();
    // Nothing user-authored runs inside the observer emit — the rebuild waits
    // for the top of the next guest step.
    expect(events).toEqual(["make1", "run1"]);

    reg.runAll(FRAME);
    expect(events).toEqual(["make1", "run1", "dispose1", "abort1", "make2", "run2"]);
  });

  it("dispose() tears down every instance and aborts every signal", () => {
    const reg = createGuestRegistry(makeWorld());
    const events: string[] = [];
    reg.add({
      id: "g",
      make: (gen) => {
        gen.signal.addEventListener("abort", () => events.push("abort"));
        return { run: () => {}, dispose: () => events.push("dispose") };
      },
    });

    reg.dispose();
    expect(events).toEqual(["dispose", "abort"]);
    expect(() => reg.add({ id: "x", make: () => () => {} })).toThrow(/disposed/);
  });

  it("a throwing dispose does not stop the teardown sweep", () => {
    const reg = createGuestRegistry(makeWorld(), { onFault: () => {} });
    const disposed: string[] = [];
    reg.add({
      id: "a",
      make: () => ({
        run: () => {},
        dispose: () => {
          disposed.push("a");
          throw new Error("bad teardown");
        },
      }),
    });
    reg.add({ id: "b", make: () => ({ run: () => {}, dispose: () => disposed.push("b") }) });

    reg.dispose();
    expect(disposed).toEqual(["a", "b"]);
  });
});

describe("guests — the breaker ladder", () => {
  it("suspends on sustained over-budget (>30 of the last 120)", () => {
    const reg = createGuestRegistry(makeWorld(), { onNotice: () => {} });
    // 3ms against a 2ms budget: over budget, but under 4× (heavy) and 50ms
    // (stall), so ONLY the rolling-window rule can fire.
    reg.add({ id: "slow", make: costing(3), budgetMs: 2 });

    pump(reg, GUEST_BUDGET.overBudgetTrip); // 30 — still running
    expect(reg.list()[0]?.status).toBe("running");

    pump(reg, 2); // crosses 30 (the warmup invocation counts but cannot trip)
    expect(reg.list()[0]?.status).toBe("suspended");
  });

  it("suspends on 3 consecutive invocations at ≥4× budget", () => {
    const reg = createGuestRegistry(makeWorld(), { onNotice: () => {} });
    reg.add({ id: "heavy", make: costing(5), budgetMs: 1 }); // 5 ≥ 4×1, under the seam cap

    pump(reg, 1); // warmup — exempt
    expect(reg.list()[0]?.status).toBe("running");
    pump(reg, 2);
    expect(reg.list()[0]?.status).toBe("running");
    pump(reg, 1);
    expect(reg.list()[0]?.status).toBe("suspended");
  });

  it("suspends on 2 CONSECUTIVE stalls over 50ms — but never on one", () => {
    const reg = createGuestRegistry(makeWorld(), { onNotice: () => {} });
    let cost = 1;
    reg.add({ id: "gc", make: () => () => { nowMs += cost; }, budgetMs: 2 });

    pump(reg, 1); // warmup
    cost = 60; // one GC pause / breakpoint
    pump(reg, 1);
    expect(reg.list()[0]?.status).toBe("running");
    cost = 1;
    pump(reg, 1); // recovered — the counter resets
    cost = 60;
    pump(reg, 1);
    expect(reg.list()[0]?.status).toBe("running");
    pump(reg, 1); // two in a row
    expect(reg.list()[0]?.status).toBe("suspended");
  });

  it("exempts the first invocation of each generation (warmup)", () => {
    const world = makeWorld();
    const reg = createGuestRegistry(world, { onNotice: () => {} });
    let cost = 200; // a monstrous first frame: module eval, first-touch, JIT
    reg.add({ id: "warm", make: () => () => { nowMs += cost; }, budgetMs: 2 });

    pump(reg, 1);
    expect(reg.list()[0]?.status).toBe("running"); // warmup absorbed it
    cost = 1;
    pump(reg, 5);
    expect(reg.list()[0]?.status).toBe("running");

    // A new generation gets a fresh warmup pass.
    world.reset();
    cost = 200;
    pump(reg, 1);
    expect(reg.list()[0]?.status).toBe("running");
  });

  it("suspends after 3 consecutive throws", () => {
    const reg = createGuestRegistry(makeWorld(), { onFault: () => {}, onNotice: () => {} });
    reg.add({
      id: "thrower",
      make: () => () => {
        throw new Error("nope");
      },
    });

    pump(reg, 2);
    expect(reg.list()[0]?.status).toBe("running");
    pump(reg, 1);
    expect(reg.list()[0]?.status).toBe("suspended");
  });

  it("rejects an async body: it would evade both the bracket and the catch", () => {
    const reg = createGuestRegistry(makeWorld(), { onFault: () => {}, onNotice: () => {} });
    reg.add({
      id: "async",
      make: () => (async () => {}) as unknown as () => void,
    });

    pump(reg, 1);
    // Dev guards on ⇒ a contract violation suspends immediately.
    expect(reg.list()[0]?.status).toBe("suspended");
  });

  it("in production an async body takes the ordinary throw ladder instead", () => {
    setDevGuards(false);
    const reg = createGuestRegistry(makeWorld(), { onFault: () => {}, onNotice: () => {} });
    reg.add({
      id: "async",
      make: () => (async () => {}) as unknown as () => void,
    });

    pump(reg, 2);
    expect(reg.list()[0]?.status).toBe("running");
    pump(reg, 1);
    expect(reg.list()[0]?.status).toBe("suspended");
  });

  it("a suspended guest stops running and is torn down", () => {
    const reg = createGuestRegistry(makeWorld(), { onFault: () => {}, onNotice: () => {} });
    let runs = 0;
    let disposed = false;
    reg.add({
      id: "thrower",
      make: () => ({
        run: () => {
          runs++;
          throw new Error("nope");
        },
        dispose: () => {
          disposed = true;
        },
      }),
    });

    pump(reg, 5);
    expect(runs).toBe(3); // stopped at the ladder, not still burning frames
    expect(disposed).toBe(true);
  });
});

describe("guests — dev leniency", () => {
  it("reports timing overruns instead of suspending while devtools are attached", () => {
    const notices: string[] = [];
    const reg = createGuestRegistry(makeWorld(), {
      lenient: () => true,
      onNotice: (m) => notices.push(m),
    });
    reg.add({ id: "slow", make: costing(60), budgetMs: 2 });

    pump(reg, 10);
    expect(reg.list()[0]?.status).toBe("running");
    expect(notices.some((n) => n.includes("devtools attached"))).toBe(true);
  });

  it("still suspends on the THROW ladder — leniency covers timing only", () => {
    const reg = createGuestRegistry(makeWorld(), {
      lenient: () => true,
      onFault: () => {},
      onNotice: () => {},
    });
    reg.add({
      id: "thrower",
      make: () => () => {
        throw new Error("nope");
      },
    });

    pump(reg, 3);
    expect(reg.list()[0]?.status).toBe("suspended");
  });

  it("engine.enableTelemetry() is what arms leniency", () => {
    const world = makeWorld();
    const engine = createEngine(world, { onGuestNotice: () => {} });
    engine.enableTelemetry();
    engine.guests.add({ id: "slow", make: costing(60), budgetMs: 2 });

    for (let i = 0; i < 10; i++) engine.step(i * 16);
    expect(engine.guests.list()[0]?.status).toBe("running");
  });
});

describe("guests — the seam cap", () => {
  it("suspends the WORST offender when the whole seam runs over, sustained", () => {
    const reg = createGuestRegistry(makeWorld(), { onNotice: () => {} });
    // Both under their own budgets; together they blow the 8ms seam.
    reg.add({ id: "small", make: costing(2), budgetMs: 8 });
    reg.add({ id: "hog", make: costing(7), budgetMs: 8 });

    pump(reg, GUEST_BUDGET.seamOverFrames + 1);

    const byId = Object.fromEntries(reg.list().map((g) => [g.id, g.status]));
    expect(byId.hog).toBe("suspended");
    expect(byId.small).toBe("running"); // the innocent neighbour survives
  });

  it("does not fire on a single over-seam frame", () => {
    const reg = createGuestRegistry(makeWorld(), { onNotice: () => {} });
    let cost = 9;
    reg.add({ id: "spike", make: () => () => { nowMs += cost; }, budgetMs: 8 });

    pump(reg, 1);
    cost = 1;
    pump(reg, 5);
    expect(reg.list()[0]?.status).toBe("running");
  });
});

describe("guests — the settle protocol", () => {
  it("a freeze waits for a busy guest, then parks (no photograph mid-reflow)", () => {
    const world = makeWorld();
    const engine = createEngine(world);
    let owed = 3;
    engine.guests.add({
      id: "derive",
      make: () => ({
        run: () => {
          if (owed > 0) owed--;
        },
        busy: () => owed > 0,
      }),
    });

    engine.frame.freeze("chrome");
    expect(engine.frame.settling()).toContain("guests");

    // The gate keeps handing out steps while the guest owes work.
    let steps = 0;
    while (engine.frame.claimStep() && steps < 10) {
      engine.step(steps * 16);
      steps++;
    }

    expect(owed).toBe(0);
    expect(engine.frame.settling()).not.toContain("guests");
    expect(engine.frame.isParked()).toBe(true);
  });

  it("a guest with no busy() is treated as quiet — the honest default", () => {
    const world = makeWorld();
    const engine = createEngine(world);
    engine.guests.add({ id: "plain", make: () => () => {} });
    engine.frame.freeze("chrome");
    expect(engine.frame.settling()).not.toContain("guests");
  });

  it("a THROWING busy() cannot wedge the settle walk at the cap", () => {
    const world = makeWorld();
    const engine = createEngine(world, { onGuestFault: () => {} });
    engine.guests.add({
      id: "bad",
      make: () => ({
        run: () => {},
        busy: () => {
          throw new Error("bad predicate");
        },
      }),
    });
    engine.frame.freeze("chrome");
    expect(engine.frame.settling()).not.toContain("guests");
  });
});

describe("guests — the host-injectable ledger", () => {
  it("seeds suspension from the host: a chronic offender does not get a fresh probation", () => {
    const reg = createGuestRegistry(makeWorld());
    let ran = 0;
    reg.add({
      id: "known-bad",
      make: () => () => {
        ran++;
      },
      ledger: { strikes: 7, suspended: true },
    });

    pump(reg, 3);
    expect(ran).toBe(0); // never even instantiated
    expect(reg.list()[0]).toMatchObject({ status: "suspended", strikes: 7 });
  });

  it("emits every transition so the host can persist across engine generations", () => {
    const seen: Array<[string, GuestLedgerRecord]> = [];
    const reg = createGuestRegistry(makeWorld(), { onFault: () => {}, onNotice: () => {} });
    reg.onLedgerChange((id, rec) => seen.push([id, { ...rec }]));
    reg.add({
      id: "thrower",
      make: () => () => {
        throw new Error("nope");
      },
    });

    pump(reg, 3);
    expect(seen.length).toBe(3);
    expect(seen[2]?.[1]).toEqual({ strikes: 3, suspended: true });
  });

  it("resume() clears the suspension and re-instantiates, keeping cumulative strikes", () => {
    const reg = createGuestRegistry(makeWorld(), { onFault: () => {}, onNotice: () => {} });
    let runs = 0;
    let healthy = false;
    reg.add({
      id: "g",
      make: () => () => {
        runs++;
        if (!healthy) throw new Error("nope");
      },
    });

    pump(reg, 3);
    expect(reg.list()[0]?.status).toBe("suspended");

    healthy = true;
    reg.resume("g");
    const before = runs;
    pump(reg, 2);

    expect(runs).toBe(before + 2); // running again
    expect(reg.list()[0]).toMatchObject({ status: "running", strikes: 3 }); // honesty
  });
});
