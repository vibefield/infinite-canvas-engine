/**
 * The ephemeral store class — the local-peer SINGLETON facet (design-009 §4.4,
 * BF-D15 — M13f).
 *
 * Rev 2 fenced ephemeral behaviors to "facets on existing entities only", which
 * fenced out the only legal mechanism: strata's ephemeral partition is
 * ABSOLUTE — every mutator `requireOwn`-throws for entities this peer did not
 * mint — so a facet can never ride a durable widget. What a peer CAN write is
 * its own presence entity, and there is exactly one of those. Hence: one
 * instance, no entity argument on `ctx.write`, and remote peers read-only
 * through `ctx.peers()`.
 *
 * Names are file-unique ("beph:*").
 */
import { createWorld, field } from "@vibecook/strata-ecs";
import type { Entity, World } from "@vibecook/strata-ecs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetBehaviorsForTests, defineBehavior } from "../src/behavior/define-behavior";
import { createBehaviorRuntime, type BehaviorPresence, type BehaviorRuntime } from "../src/behavior/runtime";
import { createEngine, type Engine } from "../src/engine/engine";
import { attachPresence, type PresenceSession } from "../src/presence/presence-kit";
import { p } from "../src/widget/props";

let world: World;
let engine: Engine;
let runtime: BehaviorRuntime;
let presence: PresenceSession | undefined;
let frame = 0;

function build(withPresence: boolean): void {
  world = createWorld();
  engine = createEngine(world);
  presence = withPresence ? attachPresence(world, { name: "me", color: "#f00" }) : undefined;
  runtime = createBehaviorRuntime({
    world,
    engine,
    presence: () => presence as BehaviorPresence | undefined,
    onLog: () => {},
    onFault: () => {}, // the I17 suite faults deliberately; keep the output clean
  });
  frame = 0;
}

beforeEach(() => build(true));

afterEach(() => {
  runtime.dispose();
  presence?.detach();
  presence = undefined;
  __resetBehaviorsForTests();
});

function step(): void {
  frame += 16;
  engine.step(frame);
}

describe("the singleton facet", () => {
  it("mints exactly ONE instance on the local peer and publishes through ctx.write", () => {
    const inits: Entity[] = [];
    const B = defineBehavior("beph:tool", {
      store: "ephemeral",
      schema: { tool: p.string({ default: "select" }) },
      on: { init: (e) => inits.push(e) },
    });
    runtime.register(B);
    step();

    const peer = (presence as PresenceSession).localPeer;
    expect(inits).toEqual([peer]);
    expect(world.get(peer, B.component)).toEqual({ tool: "select" });
    expect(runtime.list()[0]?.instances).toBe(1);
  });

  it("leaves the behavior DORMANT with no presence — honest state, not a throw", () => {
    build(false);
    const log: string[] = [];
    const B = defineBehavior("beph:dormant", {
      store: "ephemeral",
      schema: { n: p.number({ default: 0 }) },
      on: { init: () => log.push("init"), tick: () => log.push("tick") },
    });
    runtime.register(B);
    step();
    step();
    expect(log).toEqual([]);
    expect(runtime.list()[0]?.instances).toBe(0);
  });

  it("re-mints across a world reset — the fresh peer carries no facets", async () => {
    const log: string[] = [];
    const B = defineBehavior("beph:remint", {
      store: "ephemeral",
      schema: { n: p.number({ default: 1 }) },
      on: { init: () => log.push("init"), dispose: () => log.push("dispose") },
    });
    runtime.register(B);
    step();
    expect(log).toEqual(["init"]);

    world.reset();
    // Presence re-mints its local peer a MICROTASK later (attaching an
    // ephemeral store is illegal inside an observer emit). A frame landing
    // inside that window finds a DEAD handle — it must skip, not throw, or the
    // breaker charges a behavior for the engine's own scheduling.
    step();
    expect(log).toEqual(["init", "dispose"]);
    await Promise.resolve();
    step();

    const peer = (presence as PresenceSession).localPeer;
    expect(log).toEqual(["init", "dispose", "init"]);
    expect(world.isAlive(peer)).toBe(true);
    expect(world.get(peer, B.component)).toEqual({ n: 1 });
  });

  it("ctx.write takes NO entity — the instance is the peer", () => {
    let publish: ((v: string) => void) | undefined;
    const B = defineBehavior("beph:write", {
      store: "ephemeral",
      schema: { tool: p.string({ default: "select" }) },
      on: {
        init: (_e, _d, ctx) => {
          publish = (tool) => ctx.write({ tool });
        },
      },
    });
    runtime.register(B);
    step();

    publish?.("pen");
    const peer = (presence as PresenceSession).localPeer;
    expect(world.get(peer, B.component)).toEqual({ tool: "pen" });
  });
});

describe("ctx.peers()", () => {
  it("sees a REMOTE peer's facet and never adopts it as an instance", () => {
    const inits: Entity[] = [];
    let peers: readonly { entity: Entity; data: Readonly<{ tool: string }> }[] = [];
    const B = defineBehavior("beph:peers", {
      store: "ephemeral",
      schema: { tool: p.string({ default: "select" }) },
      on: {
        init: (e) => inits.push(e),
        tick: (_e, _d, _f, ctx) => {
          peers = ctx.peers();
        },
      },
    });
    runtime.register(B);
    step();

    // A remote peer's facet, as it arrives after projection: the component
    // without strata's `Local` marker.
    const remote = world.spawn({ components: [[B.component, { tool: "pen" }]] });
    step();

    expect(inits).toEqual([(presence as PresenceSession).localPeer]); // NOT the remote one
    expect(runtime.list()[0]?.instances).toBe(1);
    expect(peers).toEqual([{ entity: remote, data: { tool: "pen" } }]);
  });
});

describe("declaration rules", () => {
  it("refuses a phase other than publish", () => {
    expect(() => defineBehavior("beph:badphase", { store: "ephemeral", phase: "simulate" })).toThrow(
      /not legal/,
    );
  });
});

describe("facet withdrawal (petition I17)", () => {
  // The remote half — that `presence.eph.removeComponent` encodes a tombstone
  // remote projections honor — is the presence kit's own tested contract; what
  // these tests pin at THIS boundary is that every producer-stops edge goes
  // through that writer (never `world.removeComponent`) and that the facet is
  // actually gone.

  it("unregister withdraws the facet synchronously, through the PRESENCE writer", () => {
    const writerRemovals: string[] = [];
    const real = presence as PresenceSession;
    const recording: BehaviorPresence = {
      get localPeer() {
        return real.localPeer;
      },
      eph: {
        addComponent: (e, c, v) => real.eph.addComponent(e, c as never, v as never),
        removeComponent: (e, c) => {
          writerRemovals.push("eph");
          real.eph.removeComponent(e, c as never);
        },
        edit: (e) => real.eph.edit(e),
      },
    };
    runtime.dispose();
    runtime = createBehaviorRuntime({
      world,
      engine,
      presence: () => recording,
      onLog: () => {},
    });
    const B = defineBehavior("beph:withdraw", {
      store: "ephemeral",
      schema: { tool: p.string({ default: "select" }) },
    });
    const remove = runtime.register(B);
    step();
    const peer = real.localPeer;
    expect(world.has(peer, B.component)).toBe(true);

    remove();
    expect(world.has(peer, B.component)).toBe(false); // synchronous, not next-frame
    expect(writerRemovals).toEqual(["eph"]);

    // Re-registration remints declared defaults.
    runtime.register(B);
    step();
    expect(world.get(peer, B.component)).toEqual({ tool: "select" });
  });

  it("withdraws on live suspension+quarantine, refuses resume-remint, remints on re-registration", () => {
    // A thenable tick is the one fault a SINGLETON can commit that reaches the
    // guest ladder (ordinary throws never span instances) — three frames buy
    // suspension AND instance quarantine on the same edge.
    const B = defineBehavior("beph:async-quarantine", {
      store: "ephemeral",
      schema: { n: p.number({ default: 5 }) },
      on: {
        async tick() {
          await Promise.resolve();
        },
      },
    });
    const remove = runtime.register(B);
    step();
    const peer = (presence as PresenceSession).localPeer;
    expect(world.has(peer, B.component)).toBe(true);

    step();
    step();
    step();
    expect(engine.guests.list()[0]).toMatchObject({ status: "suspended", strikes: 3 });
    expect(world.has(peer, B.component)).toBe(false); // producer stopped ⇒ publication reversed

    // The doctor resumes the GUEST — but the quarantine memo lives on the node,
    // so the facet must NOT re-mint into an infinite quarantine/remint
    // oscillation. It returns only with a fresh registration.
    engine.guests.resume("behavior:beph:async-quarantine");
    step();
    step();
    expect(world.has(peer, B.component)).toBe(false);

    remove();
    runtime.register(B);
    step();
    expect(world.get(peer, B.component)).toEqual({ n: 5 });
  });

  it("withdraws on synchronous-throw quarantine — the edge with NO guest-ledger transition", () => {
    let inits = 0;
    const B = defineBehavior("beph:sync-quarantine", {
      store: "ephemeral",
      schema: { n: p.number({ default: 2 }) },
      on: {
        init: () => {
          inits++;
        },
        tick: () => {
          throw new Error("boom");
        },
      },
    });
    const remove = runtime.register(B);
    step(); // init + first faulting tick
    step();
    step(); // third consecutive throw ⇒ instance quarantine
    const peer = (presence as PresenceSession).localPeer;
    expect(world.has(peer, B.component)).toBe(false);
    // The counterexample the petition pinned: a singleton's throws cannot span
    // instances, so the guest saw NOTHING — a ledger-watching host could never
    // have done this withdrawal itself.
    expect(engine.guests.list()[0]).toMatchObject({ status: "running", strikes: 0 });

    remove();
    runtime.register(B);
    step();
    expect(world.has(peer, B.component)).toBe(true);
    expect(inits).toBe(2); // once per registration, never from a remint loop
  });

  it("a ledger-seeded suspended registration never publishes; resume remints defaults", () => {
    const B = defineBehavior("beph:seeded", {
      store: "ephemeral",
      schema: { n: p.number({ default: 9 }) },
    });
    runtime.register(B, { ledger: { strikes: 4, suspended: true } });
    step();
    step();
    const peer = (presence as PresenceSession).localPeer;
    expect(world.has(peer, B.component)).toBe(false); // suspended-at-birth: no facet, ever

    // A VALUE-based suspension carries no quarantine, so the doctor's resume
    // brings the facet back through the ordinary ensureFacet path.
    engine.guests.resume("behavior:beph:seeded");
    step();
    expect(world.get(peer, B.component)).toEqual({ n: 9 });
  });

  it("stays a quiet no-op with no presence attached", () => {
    build(false);
    const B = defineBehavior("beph:noop", {
      store: "ephemeral",
      schema: { n: p.number({ default: 0 }) },
    });
    const remove = runtime.register(B);
    step();
    expect(() => remove()).not.toThrow();
  });
});
