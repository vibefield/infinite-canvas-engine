/**
 * Pending-machinery frame traces (v2 gesture.ts port: multi-tap counting +
 * Sequence/RequiresFail dependency edges; design-003 §4.2 "dead machinery"
 * deferral superseded — the trigger condition "a real gesture ships" fired
 * with the pointerlab demo).
 *
 * Timing note vs v2: dependency resolutions observe a source's phase flip one
 * frame after it happens (v3 flushes at sub-phase boundaries; v2 wrote
 * immediately). Every trace below asserts the v3 frame count explicitly.
 */
import { describe, expect, it } from "vitest";
import {
  Captures,
  ClaimedBy,
  Down,
  Drag,
  GesturePhases,
  HadRequiresFail,
  HadSequence,
  LongPress,
  MultiTap,
  RequiresFail,
  Selected,
  Sequence,
  SnapState,
  Tap,
  Watches,
} from "../../src";
import { defineQuery, type Entity, type World } from "@vibecook/strata-ecs";
import { createTraceRig } from "./rig";

const P = GesturePhases;
const tapRecQ = defineQuery([Tap]);
const lpRecQ = defineQuery([LongPress]);
const dragRecQ = defineQuery([Drag]);

function entitiesOf(world: World, q: ReturnType<typeof defineQuery>): Entity[] {
  const out: Entity[] = [];
  world.query(q).each((b) => {
    for (const r of b) out.push(b.entity(r));
  });
  return out;
}

describe("trace: multi-tap counting (MultiTap opt-in)", () => {
  it("double-tap on a MultiTap target: park → rejoin (same recognizer) → Recognized at count 2", () => {
    const rig = createTraceRig();
    const box = rig.spawnBox({ x: 100, y: 100 });
    rig.world.addComponent(box, MultiTap, { max: 2, windowMs: 280, slopPx: 20 });

    rig.target("mouse", box);
    rig.down("mouse", 110, 110);
    rig.step(); // recognizers spawn (Possible)
    rig.up("mouse", 111, 110);
    rig.step(); // clean release, count 1 < max 2 → parked Pending, NOT selected

    const taps = entitiesOf(rig.world, tapRecQ);
    expect(taps).toHaveLength(1);
    const tap = taps[0] as Entity;
    expect(rig.world.hasTag(tap, P.tags.Pending)).toBe(true);
    expect(rig.world.read(tap, Tap).count).toBe(1);
    expect(rig.world.hasTag(box, Selected)).toBe(false); // recognition withheld

    rig.down("mouse", 114, 112); // within the 20px rejoin slop
    rig.step(); // REJOIN: same entity Pending → Possible; no fresh tap spawned
    expect(entitiesOf(rig.world, tapRecQ)).toHaveLength(1);
    expect(rig.world.hasTag(tap, P.tags.Possible)).toBe(true);
    expect(rig.world.read(tap, Tap).count).toBe(1); // count preserved

    rig.up("mouse", 114, 112);
    rig.step(); // count 2 ≥ max → Recognized → selectBehavior fires
    expect(rig.world.read(tap, Tap).count).toBe(2);
    expect(rig.world.hasTag(tap, P.tags.Recognized)).toBe(true);
    expect(rig.world.hasTag(box, Selected)).toBe(true);

    rig.step(2); // terminal +1 → reaped; selection stable (no double-fire)
    expect(rig.world.isAlive(tap)).toBe(false);
    expect(rig.world.hasTag(box, Selected)).toBe(true);
  });

  it("single tap on a MultiTap target recognizes with count 1 when the window closes", () => {
    const rig = createTraceRig();
    const box = rig.spawnBox({ x: 100, y: 100 });
    rig.world.addComponent(box, MultiTap, { max: 2, windowMs: 280, slopPx: 20 });

    rig.target("mouse", box);
    rig.down("mouse", 110, 110);
    rig.step();
    rig.up("mouse", 110, 110);
    rig.step();
    const tap = entitiesOf(rig.world, tapRecQ)[0] as Entity;
    expect(rig.world.hasTag(tap, P.tags.Pending)).toBe(true);

    rig.step(10); // 160ms into the 280ms window — still withheld
    expect(rig.world.hasTag(tap, P.tags.Pending)).toBe(true);
    expect(rig.world.hasTag(box, Selected)).toBe(false);

    rig.step(8); // past 280ms (288) → window closed → final count stands
    expect(rig.world.hasTag(tap, P.tags.Recognized)).toBe(true);
    expect(rig.world.read(tap, Tap).count).toBe(1);
    expect(rig.world.hasTag(box, Selected)).toBe(true); // the delayed single-tap

    rig.step(2); // terminal +1 → reaped
    expect(rig.world.isAlive(tap)).toBe(false);
  });

  it("a claim kills an edge-less Pending tap (tap-then-drag fails the pending multi-tap)", () => {
    const rig = createTraceRig();
    const box = rig.spawnBox({ x: 100, y: 100 });
    rig.world.addComponent(box, MultiTap, { max: 2, windowMs: 280, slopPx: 20 });

    rig.target("mouse", box);
    rig.down("mouse", 110, 110);
    rig.step();
    rig.up("mouse", 110, 110);
    rig.step();
    const tap = entitiesOf(rig.world, tapRecQ)[0] as Entity;
    expect(rig.world.hasTag(tap, P.tags.Pending)).toBe(true);

    // Second down far away on the canvas (no rejoin: different capture), drag past slop.
    rig.target("mouse", undefined);
    rig.down("mouse", 400, 400);
    rig.step();
    rig.move("mouse", 420, 420);
    rig.step(); // drag Active → claims the mouse → arbitration fails the pending tap
    expect(rig.world.hasTag(tap, P.tags.Failed)).toBe(true);

    rig.step(); // reaped
    expect(rig.world.isAlive(tap)).toBe(false);
    expect(rig.world.hasTag(box, Selected)).toBe(false);
  });

  it("a Pending tap outlives its lifted TOUCH pointer (integrity exemption) and still recognizes", () => {
    const rig = createTraceRig();
    const box = rig.spawnBox({ x: 100, y: 100 });
    rig.world.addComponent(box, MultiTap, { max: 2, windowMs: 280, slopPx: 20 });

    rig.target("touch1", box);
    rig.down("touch1", 110, 110);
    rig.step();
    rig.up("touch1", 110, 110);
    rig.step();
    const tap = entitiesOf(rig.world, tapRecQ)[0] as Entity;
    expect(rig.world.hasTag(tap, P.tags.Pending)).toBe(true);

    rig.step(3); // touch pointer despawns (up+1); Watches auto-clears — integrity must NOT cancel
    expect(rig.world.isAlive(tap)).toBe(true);
    expect(rig.world.getRelations(tap, Watches)).toHaveLength(0);
    expect(rig.world.hasTag(tap, P.tags.Pending)).toBe(true);

    rig.step(16); // window closes → Recognized (count 1) → selection
    expect(rig.world.hasTag(box, Selected)).toBe(true);
  });

  it("plain target (no MultiTap) stays instant: first clean release recognizes at count 1", () => {
    const rig = createTraceRig();
    const box = rig.spawnBox({ x: 100, y: 100 });
    rig.target("mouse", box);
    rig.down("mouse", 110, 110);
    rig.step();
    rig.up("mouse", 110, 110);
    rig.step(); // NO parking — Recognized on the release frame (zero added latency)
    const tap = entitiesOf(rig.world, tapRecQ)[0] as Entity;
    expect(rig.world.hasTag(tap, P.tags.Recognized)).toBe(true);
    expect(rig.world.read(tap, Tap).count).toBe(1);
    expect(rig.world.hasTag(box, Selected)).toBe(true);
  });
});

describe("trace: RequiresFail (exit gate)", () => {
  function parkTapRequiring(rig: ReturnType<typeof createTraceRig>, other: Entity): Entity {
    const parked = rig.world.spawn({
      components: [
        [Tap, { downAt: 0, count: 0 }],
        [Down, { x: 0, y: 0, ms: 0 }],
      ],
      tags: [P.tags.Pending, HadRequiresFail],
    });
    rig.world.setRelation(parked, RequiresFail, other);
    return parked;
  }

  it("recognizes the parked discrete recognizer when `other` fails", () => {
    const rig = createTraceRig();
    rig.down("mouse", 500, 500);
    rig.step();
    const drag = entitiesOf(rig.world, dragRecQ)[0] as Entity;
    const parked = parkTapRequiring(rig, drag);

    rig.step(); // other still Possible → waiting
    expect(rig.world.hasTag(parked, P.tags.Pending)).toBe(true);

    rig.up("mouse", 502, 500); // release inside the dead zone → drag Failed
    rig.step(); // drag flips Failed this frame…
    rig.step(); // …dependency observes it next frame → parked Recognized
    expect(rig.world.hasTag(parked, P.tags.Recognized)).toBe(true);
  });

  it("fails the parked recognizer when `other` wins, and survives arbitration in between", () => {
    const rig = createTraceRig();
    rig.down("mouse", 500, 500);
    rig.step();
    const drag = entitiesOf(rig.world, dragRecQ)[0] as Entity;
    const parked = parkTapRequiring(rig, drag);
    rig.world.addRelation(parked, Watches, rig.pointerEntity("mouse") as Entity);

    rig.move("mouse", 530, 500);
    rig.step(); // drag Active → claims the mouse; edge-parked Pending is arbitration-EXEMPT
    expect(rig.world.hasTag(parked, P.tags.Pending)).toBe(true);

    rig.step(); // dependency observes the win → parked loses
    expect(rig.world.hasTag(parked, P.tags.Failed)).toBe(true);
  });

  it("fails the parked recognizer when its edge orphans (target despawned)", () => {
    const rig = createTraceRig();
    rig.down("mouse", 500, 500);
    rig.step();
    const drag = entitiesOf(rig.world, dragRecQ)[0] as Entity;
    const parked = parkTapRequiring(rig, drag);

    rig.world.destroy(drag); // edge auto-clears; HadRequiresFail remembers
    rig.step();
    expect(rig.world.hasTag(parked, P.tags.Failed)).toBe(true);
  });
});

describe("trace: Sequence (entrance gate / hand-off)", () => {
  it("long-press → parked drag hand-off: rebase, enter Possible, retire the source, claim on activation", () => {
    const rig = createTraceRig();
    const box = rig.spawnBox({ x: 500, y: 500, w: 200, h: 200 });
    rig.target("mouse", box);
    rig.down("mouse", 500, 500);
    rig.step();
    const lp = entitiesOf(rig.world, lpRecQ)[0] as Entity;
    const mouse = rig.pointerEntity("mouse") as Entity;

    const parked = rig.world.spawn({
      components: [
        [Drag, { startX: 0, startY: 0, totalX: 0, totalY: 0, velX: 0, velY: 0, zoomAtClaim: 1 }],
        [SnapState, { dx: 0, dy: 0 }],
        [Down, { x: 0, y: 0, ms: 0 }],
      ],
      tags: [P.tags.Pending, HadSequence],
    });
    rig.world.addRelation(parked, Watches, mouse);
    rig.world.setRelation(parked, Sequence, lp);

    rig.step(32); // hold ~530ms → LongPress Recognized (claims; parked is exempt from the fail sweep)
    expect(rig.world.hasTag(lp, P.tags.Recognized)).toBe(true);
    expect(rig.world.hasTag(parked, P.tags.Pending)).toBe(true);

    rig.step(); // dependency observes the pass → HAND-OFF
    expect(rig.world.hasTag(parked, P.tags.Possible)).toBe(true);
    expect(rig.world.read(parked, Down).x).toBe(500); // rebased to the current pointer
    expect(rig.world.hasTag(lp, P.tags.Ended)).toBe(true); // source retired (still-live rule)

    rig.move("mouse", 520, 515); // past the 10px drag slop from the rebased origin
    rig.step(2); // Activation + claim (the stale LP claim is terminal → overridden)
    expect(rig.world.hasTag(parked, P.tags.Active)).toBe(true);
    expect(rig.world.getRelation(mouse, ClaimedBy)).toBe(parked);
  });

  it("fails the parked recognizer when its source fails", () => {
    const rig = createTraceRig();
    rig.down("mouse", 500, 500);
    rig.step();
    const lp = entitiesOf(rig.world, lpRecQ)[0] as Entity;
    const parked = rig.world.spawn({
      components: [
        [Drag, { startX: 0, startY: 0, totalX: 0, totalY: 0, velX: 0, velY: 0, zoomAtClaim: 1 }],
        [SnapState, { dx: 0, dy: 0 }],
        [Down, { x: 0, y: 0, ms: 0 }],
      ],
      tags: [P.tags.Pending, HadSequence],
    });
    rig.world.setRelation(parked, Sequence, lp);

    rig.move("mouse", 530, 500); // move past long-press slop → LP Failed
    rig.step();
    rig.step(); // dependency observes next frame
    expect(rig.world.hasTag(parked, P.tags.Failed)).toBe(true);
  });
});
