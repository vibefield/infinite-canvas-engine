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
