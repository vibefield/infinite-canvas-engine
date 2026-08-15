/**
 * Claim-scoped delivery suppression (design-009 §5.3 — M13d).
 *
 * This REPLACED rev 2's deferred-commit queue, which the review broke: the
 * queued closure re-ran after the gesture's own commit had already landed, so
 * a drag produced TWO commits — the first gliding the layout to its pre-drag
 * shape, the second retargeting. "Pure and idempotent" was the wrong contract
 * because the real requirement was re-reading inputs, which no test can check.
 *
 * Suppression makes closure freshness STRUCTURAL: the hook does not run while a
 * claim is live, so when it does run it reads settled truth by construction.
 * The traces here pin the three properties that buys — nothing during the
 * gesture, exactly one coalesced delivery at the settle, and instance scope
 * (one wedged claim must not freeze an unrelated instance).
 *
 * Names are file-unique ("bsup:*").
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetBehaviorsForTests, defineBehavior } from "../src/behavior/define-behavior";
import { createBehaviorRuntime, type BehaviorRuntime } from "../src/behavior/runtime";
import { Captures, ChildOf, GestureActive, Position, createCanvasEngine, defineWidget, widgets } from "../src";
import type { CanvasEngine, Entity } from "../src";
import { p } from "../src/widget/props";

const BOX =
  widgets.get("bsup:box") ??
  defineWidget({ type: "bsup:box", surface: "dom", component: null, defaultSize: { w: 10, h: 10 } });

let ce: CanvasEngine;
let runtime: BehaviorRuntime;
let commits: number;
let frame = 0;

beforeEach(async () => {
  ce = createCanvasEngine({ widgets: [BOX] });
  await ce.docs.create();
  commits = 0;
  runtime = createBehaviorRuntime({
    world: ce.world,
    engine: ce.engine,
    session: () => {
      const s = ce.docs.current();
      if (s === undefined) return undefined;
      return {
        readOnly: s.readOnly,
        liveWriter: s.liveWriter,
        store: {
          transaction: (fn: never, opts?: never) => {
            commits++;
            return s.store.transaction(fn as never, opts);
          },
          keyOf: (e: Entity) => s.store.keyOf(e),
          resolve: (k: never) => s.store.resolve(k),
          getComponent: (e: Entity, c: never) => s.store.getComponent(e, c),
        },
      } as never;
    },
    onLog: () => {},
  });
  frame = 0;
});

afterEach(() => {
  runtime.dispose();
  ce.dispose();
  __resetBehaviorsForTests();
});

function step(): void {
  frame += 16;
  ce.step(frame);
}

function spawn(x: number, y: number): Entity {
  const e = ce.ops.spawnWidget("bsup:box", { x, y, undoable: false });
  ce.world.sync();
  return e;
}

/** Simulate a live gesture claim on `target`. Returns the release. */
function claim(target: Entity): () => void {
  const recognizer = ce.world.spawn({});
  ce.world.setRelation(recognizer, Captures, target);
  ce.world.addTag(recognizer, GestureActive);
  return () => ce.world.destroy(recognizer);
}

/** A derived behavior that records every delivery and commits a Position. */
function makeDerived(name: string, opts: { deriveDuringGesture?: boolean } = {}) {
  const seen: Entity[] = [];
  // The derive's OUTPUT, mutable from the test. It has to be able to change:
  // the differ drops writes equal to the projection, so a fixture that always
  // computes the same answer commits exactly once and then — correctly —
  // never again, which would hide whether a delivery happened at all.
  const target = { x: 1, y: 1 };
  const B = defineBehavior(name, {
    store: "durable",
    derived: true,
    ...(opts.deriveDuringGesture === true ? { deriveDuringGesture: true } : {}),
    schema: { tick: p.number({ default: 0 }) },
    reads: [Position, ChildOf],
    writes: [Position],
    on: {
      changed: (ctx) => {
        for (const e of ctx.entities()) seen.push(e);
        const members = [...ctx.entities()];
        if (members.length === 0) return;
        ctx.commit("derive", (tx) => {
          for (const e of members) tx.move(e, { x: target.x, y: target.y });
        });
      },
    },
  });
  return { B, seen, target };
}

/** Attach a durable behavior through a document transaction. */
function attach(e: Entity, component: never): void {
  ce.docs.current()?.store.transaction((tx) => tx.addComponent(e, component, {}));
  ce.world.sync();
}

describe("suppression", () => {
  it("delivers NOTHING while a claim is live, then exactly one coalesced delivery", () => {
    const { B, seen, target } = makeDerived("bsup:coalesced");
    runtime.register(B);
    const a = spawn(0, 0);
    attach(a, B.component as never);
    step();
    seen.length = 0;
    commits = 0;

    const release = claim(a);
    for (let i = 0; i < 5; i++) {
      // Churn the reads set every frame, exactly as a drag would.
      ce.world.edit(a).set(Position, { x: i * 10, y: 0 });
      step();
    }
    expect(seen).toEqual([]);
    expect(commits).toBe(0);

    target.x = 77; // real work waiting at the settle
    release();
    step();
    // ONE delivery at the settle, against settled truth — not one per suppressed
    // frame, and not a replay of the stale pre-gesture layout.
    expect(seen).toEqual([a]);
    expect(commits).toBe(1);
  });

  it("is INSTANCE-scoped — a claim on one instance never freezes another", () => {
    const { B, seen } = makeDerived("bsup:instancescope");
    runtime.register(B);
    const a = spawn(0, 0);
    const b = spawn(200, 0);
    attach(a, B.component as never);
    attach(b, B.component as never);
    step();
    seen.length = 0;

    const release = claim(a);
    ce.world.edit(b).set(Position, { x: 50, y: 50 });
    step();

    // b derives; a does not appear in the delivery at all.
    expect(seen).toContain(b);
    expect(seen).not.toContain(a);
    release();
  });

  it("suppresses a CARRIER when one of its members is claimed", () => {
    const { B, seen } = makeDerived("bsup:carrier");
    runtime.register(B);
    const carrier = spawn(0, 0);
    const member = spawn(10, 0);
    ce.docs.current()?.store.transaction((tx) => {
      tx.addComponent(carrier, B.component, {});
      tx.setRelation(member, ChildOf, carrier);
    });
    ce.world.sync();
    step();
    seen.length = 0;

    // The flagship shape: a mind map's CARRIER holds the layout behavior, but
    // the thing a user grabs is a member node. Reach through the behavior's own
    // declared read relation is what connects the two.
    const release = claim(member);
    ce.world.edit(member).set(Position, { x: 99, y: 0 });
    step();
    expect(seen).toEqual([]);

    release();
    step();
    expect(seen).toEqual([carrier]);
  });

  it("deriveDuringGesture opts OUT — live-follow, costs accepted", () => {
    const { B, seen } = makeDerived("bsup:optout", { deriveDuringGesture: true });
    runtime.register(B);
    const a = spawn(0, 0);
    attach(a, B.component as never);
    step();
    seen.length = 0;

    const release = claim(a);
    ce.world.edit(a).set(Position, { x: 42, y: 0 });
    step();
    expect(seen).toEqual([a]);
    release();
  });

  it("never suppresses init or dispose — lifecycle is not derived output", () => {
    const log: string[] = [];
    const B = defineBehavior("bsup:lifecycle", {
      store: "durable",
      derived: true,
      schema: { n: p.number({ default: 0 }) },
      reads: [Position],
      writes: [Position],
      on: {
        init: (e) => log.push(`init:${e}`),
        changed: () => log.push("changed"),
        dispose: (e) => log.push(`dispose:${e}`),
      },
    });
    runtime.register(B);
    const a = spawn(0, 0);
    const release = claim(a);
    attach(a, B.component as never);
    step();
    expect(log).toEqual([`init:${a}`]); // init ran, changed did not

    ce.docs.current()?.store.transaction((tx) => tx.removeComponent(a, B.component));
    ce.world.sync();
    step();
    expect(log).toEqual([`init:${a}`, `dispose:${a}`]);
    release();
  });

  it("a freeze taken mid-suppression PARKS instead of walking the settle cap", () => {
    const { B } = makeDerived("bsup:freeze");
    runtime.register(B);
    const a = spawn(0, 0);
    attach(a, B.component as never);
    step();

    const release = claim(a);
    ce.world.edit(a).set(Position, { x: 5, y: 0 });
    step();

    // Work held by a claim is EXCLUDED from the settle reporter: a freeze taken
    // mid-gesture must not walk to SETTLE_CAP waiting for a derive that is, by
    // design, not going to happen until the user lets go.
    ce.frame.freeze("test");
    let steps = 0;
    while (ce.frame.claimStep() && steps < 50) {
      steps++;
      step();
    }
    expect(ce.frame.isParked()).toBe(true);
    expect(steps).toBeLessThan(5);
    release();
  });
});
