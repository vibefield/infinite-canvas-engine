/**
 * The consumer proof (design-009 §14 — M13i): the mind-map layout expressed as
 * a `changed`-only DERIVED behavior, checked against a recorded fixture of the
 * pure layout function.
 *
 * This is the flagship shape the whole framework was designed around — one
 * behavior on a CARRIER entity iterating its members, which is also §10's
 * stated scale idiom (per-node behaviors stop being the answer somewhere around
 * 2k ticking instances; a carrier never does). Everything the design promised
 * for it is asserted here end to end, through the shipped harness rather than a
 * bespoke rig: fixture parity, one-frame quiescence, non-undoable output,
 * claim suppression, and two-peer convergence.
 *
 * Names are file-unique ("bmm:*").
 */
import { afterEach, describe, expect, it } from "vitest";
import { __resetBehaviorsForTests, defineBehavior } from "../src/behavior/define-behavior";
import { createBehaviorHarness, type BehaviorHarness } from "../src/behavior/harness";
import { ChildOf, Position } from "../src/catalog";
import type { Entity } from "../src";
import { p } from "../src/widget/props";

/**
 * The PURE layout: children in a row under their carrier. Kept free of ECS so
 * it can be tested (and recorded) on its own — the behavior's only job is to
 * feed it state and commit its output, which is exactly the division the
 * framework is for.
 */
function layoutRow(
  origin: { x: number; y: number },
  count: number,
  gapX: number,
  gapY: number,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const width = (count - 1) * gapX;
  for (let i = 0; i < count; i++) {
    out.push({ x: origin.x - width / 2 + i * gapX, y: origin.y + gapY });
  }
  return out;
}

/** The RECORDED fixture — the numbers this test is actually pinning. */
const FIXTURE_3 = [
  { x: -120, y: 60 },
  { x: 0, y: 60 },
  { x: 120, y: 60 },
];

const harnesses: BehaviorHarness[] = [];

afterEach(() => {
  for (const h of [...harnesses]) h.dispose();
  harnesses.length = 0;
  __resetBehaviorsForTests();
});

function makeLayoutBehavior(name: string) {
  const stats = { recomputes: 0 };
  const B = defineBehavior(name, {
    store: "durable",
    derived: true,
    schema: { gapX: p.number({ default: 120 }), gapY: p.number({ default: 60 }) },
    reads: [Position, ChildOf],
    writes: [Position],
    on: {
      changed: (ctx) => {
        stats.recomputes++;
        const work: { e: Entity; to: { x: number; y: number } }[] = [];
        for (const carrier of ctx.entities()) {
          const origin = ctx.world.get(carrier, Position);
          if (origin === undefined) continue;
          // Navigate from the instance OUTWARD through a declared relation —
          // the framework's stated navigation model. `getReverse` on an ordered
          // relation returns the sibling SEQUENCE, so the layout is stable.
          const members = ctx.world.getReverse(carrier, ChildOf);
          if (members.length === 0) continue;
          const data = ctx.world.get(carrier, B.component) as { gapX: number; gapY: number };
          const spots = layoutRow(origin, members.length, data.gapX, data.gapY);
          members.forEach((m, i) => work.push({ e: m, to: spots[i] as { x: number; y: number } }));
        }
        if (work.length === 0) return;
        ctx.commit("mindmap.layout", (tx) => {
          for (const { e, to } of work) tx.move(e, to);
        });
      },
    },
  });
  return { B, stats };
}

function build(name: string) {
  const { B, stats } = makeLayoutBehavior(name);
  const h = createBehaviorHarness(B);
  harnesses.push(h);
  const carrier = h.spawn(0, 0);
  h.attach(carrier);
  const members: Entity[] = [];
  for (let i = 0; i < 3; i++) {
    const m = h.spawn(999, 999);
    h.doc()?.store.transaction((tx) => tx.setRelation(m, ChildOf, carrier, "last"));
    members.push(m);
  }
  h.world.sync();
  return { B, stats, h, carrier, members };
}

function posOf(h: BehaviorHarness, e: Entity): { x: number; y: number } {
  const v = h.world.get(e, Position) as { x: number; y: number };
  return { x: v.x, y: v.y };
}

describe("the mind map as a derived behavior", () => {
  it("lays its members out to the recorded fixture", () => {
    const { h, members } = build("bmm:fixture");
    h.step();
    expect(members.map((m) => posOf(h, m))).toEqual(FIXTURE_3);
    // Parity with the pure function it delegates to — if these ever disagree,
    // the behavior grew logic that belongs in the function.
    expect(layoutRow({ x: 0, y: 0 }, 3, 120, 60)).toEqual(FIXTURE_3);
  });

  it("quiesces in ONE frame — no echo recompute, no second transaction", () => {
    const { h, stats } = build("bmm:quiesce");
    h.step();
    const recomputes = stats.recomputes;
    const commits = h.commits.length;

    h.step(5);
    expect(stats.recomputes).toBe(recomputes);
    expect(h.commits).toHaveLength(commits);
  });

  it("re-derives when a member joins, and its output never enters undo", () => {
    const { h, carrier, members } = build("bmm:join");
    h.step();
    const before = h.commits.length;

    const late = h.spawn(500, 500);
    h.doc()?.store.transaction((tx) => tx.setRelation(late, ChildOf, carrier, "last"));
    h.world.sync();
    h.step();

    expect(h.commits.length).toBe(before + 1);
    const derived = h.commits.at(-1);
    // ⌘Z must never un-derive: the reflow is a consequence, not an action.
    expect(derived?.undoable).toBe(false);
    expect(derived?.meta).toEqual({ behavior: "bmm:join", label: "mindmap.layout" });
    // Four members now: width = 3 * 120, so the row runs -180 .. 180.
    expect(posOf(h, late)).toEqual({ x: 180, y: 60 });
    expect(members.map((m) => posOf(h, m).x)).toEqual([-180, -60, 60]);
  });

  it("re-derives on a pure sibling REORDER, which no collector can see", () => {
    const { h, stats, members } = build("bmm:reorder");
    h.step();
    const recomputes = stats.recomputes;

    // No component value changes at all here — only the ChildOf SEQUENCE moves.
    // Relations never reach a change collector, so the `orderStamp` poll armed
    // by `reads: [ChildOf]` is the only thing that can wake this.
    h.doc()?.store.transaction((tx) => tx.moveRelation(members[0] as Entity, ChildOf, "last"));
    h.world.sync();
    h.step();
    h.step();

    expect(stats.recomputes).toBeGreaterThan(recomputes);
    // The moved member is now LAST in the row, which is the whole point of an
    // ordered relation driving the layout.
    expect(posOf(h, members[0] as Entity)).toEqual(FIXTURE_3[2]);
  });

  it("goes quiet under a claim and coalesces once at the settle", () => {
    const { h, stats, members } = build("bmm:claim");
    h.step();
    const recomputes = stats.recomputes;
    const commits = h.commits.length;

    // The real gesture sequence: live runtime writes under the claim (legal —
    // the claim IS the divergence grant), then ONE commit at JustEnded.
    const dragged = members[0] as Entity;
    const release = h.claim(dragged);
    for (let i = 0; i < 4; i++) {
      h.world.edit(dragged).set(Position, { x: i * 10, y: 0 });
      h.step();
    }
    // A member is under the user's finger; the layout does not fight it.
    expect(stats.recomputes).toBe(recomputes);
    expect(h.commits).toHaveLength(commits);

    h.doc()?.store.transaction((tx) => tx.edit(dragged).set(Position, { x: 30, y: 0 }));
    release();
    h.step();

    // ONE coalesced recompute, against SETTLED truth — and the layout takes its
    // member back, because a derived layout owns those positions.
    expect(stats.recomputes).toBe(recomputes + 1);
    expect(h.commits).toHaveLength(commits + 1);
    expect(posOf(h, dragged)).toEqual(FIXTURE_3[0]);
  });
});

describe("two peers, one document", () => {
  it("converges, and the second peer's derive diffs to nothing", () => {
    const { h, members } = build("bmm:collab");
    h.step();

    const peer = h.pair();
    harnesses.push(peer);
    peer.step();

    // The peer opened the doc with the layout ALREADY in it. Its own derive
    // runs, computes the same values, and the differ drops every one of them —
    // so it stages no ops, opens no transaction and puts nothing on the wire.
    expect(peer.commits).toHaveLength(0);

    h.sync();
    peer.step();
    h.step();

    const local = members.map((m) => posOf(h, m));
    const remote = peer.instances(); // the carrier projects on the peer too
    expect(remote).toHaveLength(1);
    expect(local).toEqual(FIXTURE_3);
    expect(peer.commits).toHaveLength(0);
  });
});
