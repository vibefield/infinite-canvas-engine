/**
 * Arbitration decides ONCE per pointer per tick, over every claimant of the tick (2026-09-26).
 *
 * A strata system body runs once per matching CHUNK, and the recognizer kinds live in different archetypes; the arbitration's
 * `bestByPointer` was a per-call map, so the tie rule (Pinch > Drag > LongPress > Tap) never compared a Tap with a Drag. The
 * first batch's claimant won and failed the others; the later batch, reading `ClaimedBy` before the flush, claimed too and
 * failed back: a pointer could end claimed by a Failed recognizer, with both claimants dead (found in the fix-click work).
 *
 * The rule, now held: the tick's claimants are collected first; the highest priority wins; every other live competitor
 * fails — and so does a claimant that lost THIS tick's tie from a terminal phase (a Tap's `Recognized`), so a pointer
 * gets one outcome, never a drag AND the tap it beat.
 */
import type { Entity, World } from "@vibecook/strata-ecs";
import { createWorld } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import {
  ClaimedBy,
  Drag,
  FrameInfo,
  GESTURE_DEFAULTS,
  GesturePhases,
  GestureSettings,
  Grab,
  LongPress,
  MultiTap,
  Pointer,
  Position,
  Selected,
  Tap,
  Down,
  Watches,
  createEngine,
  defineQuery,
} from "../../src";
import { createArbitrationSystems } from "../../src/systems/l2-arbitrate";
import { createTraceRig } from "./rig";

const P = GesturePhases;
type Kind = "tap" | "longPress" | "drag";

/** The arbitration system alone over hand-made recognizers — each kind in its own archetype, spawned in `order`. */
function arbitrate(order: readonly Kind[]): { world: World; pointer: Entity; rec: Record<Kind, Entity> } {
  const world = createWorld();
  const engine = createEngine(world);
  engine.addSystems("ctl:arbitrate", createArbitrationSystems(world).arbitration);
  const pointer = world.spawn({ components: [[Pointer, { id: "mouse", device: "mouse" }]] });
  const rec = {} as Record<Kind, Entity>;
  for (const kind of order) {
    // a discrete kind claims at Recognized, a continuous one at Active — and each JUST entered it, this tick
    const phase = kind === "drag" ? "Active" : "Recognized";
    const kindComponent =
      kind === "tap"
        ? ([Tap, { downAt: 0, count: 1 }] as const)
        : kind === "longPress"
          ? ([LongPress, { downAt: 0, startX: 0, startY: 0, curX: 0, curY: 0 }] as const)
          : ([Drag, { startX: 0, startY: 0, totalX: 0, totalY: 0, velX: 0, velY: 0, zoomAtClaim: 1 }] as const);
    // biome-ignore lint/suspicious/noExplicitAny: heterogeneous spawn component list
    const e = world.spawn({ components: [kindComponent as any], tags: [P.tags[phase], P.justTags[phase]] });
    world.addRelation(e, Watches, pointer);
    rec[kind] = e;
  }
  engine.step(1000);
  return { world, pointer, rec };
}

const phaseOf = (world: World, e: Entity) => P.current(world, e);

describe("arbitration over every claimant of the tick (Pinch > Drag > LongPress > Tap, across archetypes)", () => {
  for (const order of [["tap", "drag"], ["drag", "tap"]] as const) {
    it(`a Tap and a Drag claiming one pointer in one tick — spawned ${order.join(" then ")}: the Drag claims, the Tap fails`, () => {
      const { world, pointer, rec } = arbitrate(order);
      expect(world.getRelation(pointer, ClaimedBy)).toBe(rec.drag);
      expect(phaseOf(world, rec.drag)).toBe("Active");
      expect(phaseOf(world, rec.tap)).toBe("Failed"); // it lost this tick's tie: its tap never happens
    });
  }

  for (const order of [["longPress", "drag"], ["drag", "longPress"]] as const) {
    it(`a LongPress and a Drag claiming one pointer in one tick — spawned ${order.join(" then ")}: the Drag claims, the LongPress fails`, () => {
      const { world, pointer, rec } = arbitrate(order);
      expect(world.getRelation(pointer, ClaimedBy)).toBe(rec.drag);
      expect(phaseOf(world, rec.drag)).toBe("Active");
      expect(phaseOf(world, rec.longPress)).toBe("Failed");
    });
  }

  it("a LongPress and a Tap in one tick: the LongPress claims (LongPress > Tap)", () => {
    const { world, pointer, rec } = arbitrate(["tap", "longPress"]);
    expect(world.getRelation(pointer, ClaimedBy)).toBe(rec.longPress);
    expect(phaseOf(world, rec.longPress)).toBe("Recognized");
    expect(phaseOf(world, rec.tap)).toBe("Failed");
  });
});

const longPressQ = defineQuery([LongPress]);
const dragQ = defineQuery([Drag]);
const tapQ = defineQuery([Tap]);
const only = (world: World, q: typeof dragQ, where: (e: Entity) => boolean = () => true): Entity => {
  const out: Entity[] = [];
  world.query(q).each((b) => {
    for (const r of b) if (where(b.entity(r))) out.push(b.entity(r));
  });
  if (out.length !== 1) throw new Error(`expected one, found ${out.length}`);
  return out[0] as Entity;
};
const clock = (world: World): number => world.getResource(FrameInfo)?.clock ?? 0;

describe("the ties the stack can produce, through the real pipeline", () => {
  it("a long-press hold that lands on the tick the drag leaves its dead zone (long-press slop 20 > drag slop 10): the Drag claims and moves the box", () => {
    const rig = createTraceRig();
    rig.world.setResource(GestureSettings, { ...GESTURE_DEFAULTS, longPressSlopPx: 20 });
    const box = rig.spawnBox({ x: 100, y: 100 });
    rig.target("mouse", box);
    rig.down("mouse", 110, 110);
    rig.step();
    const lp = only(rig.world, longPressQ);
    const drag = only(rig.world, dragQ);
    const downAt = rig.world.read(lp, LongPress).downAt;
    // hold still until the NEXT tick is the hold's
    while (clock(rig.world) + 16 - downAt < GESTURE_DEFAULTS.longPressMs) rig.step();
    expect(phaseOf(rig.world, lp)).toBe("Possible"); // the precondition: nothing has claimed yet
    expect(phaseOf(rig.world, drag)).toBe("Possible");
    rig.move("mouse", 125, 110); // 15 px: past the drag's slop, inside the long press's
    rig.step();
    const pointer = rig.pointerEntity("mouse") as Entity;
    expect(rig.world.getRelation(pointer, ClaimedBy)).toBe(drag);
    expect(phaseOf(rig.world, drag)).toBe("Active");
    expect(phaseOf(rig.world, lp)).toBe("Failed");
    expect(rig.world.has(box, Grab)).toBe(true); // the move claim took the box
    rig.move("mouse", 145, 130);
    rig.step();
    expect(rig.world.read(box, Position)).toEqual({ x: 120, y: 120 });
    rig.up("mouse", 145, 130);
    rig.step(2);
  });

  it("a multi-tap window that closes on the tick a new drag on the same pointer activates: the Drag claims, the late tap fails", () => {
    const rig = createTraceRig();
    const a = rig.spawnBox({ x: 100, y: 100 });
    rig.world.addComponent(a, MultiTap, { max: 2, windowMs: 280, slopPx: 20 });
    const b = rig.spawnBox({ x: 400, y: 300 });
    rig.target("mouse", a);
    rig.down("mouse", 110, 110);
    rig.step();
    rig.up("mouse", 110, 110);
    rig.step();
    const tap1 = only(rig.world, tapQ);
    expect(phaseOf(rig.world, tap1)).toBe("Pending"); // the precondition: a tap waiting for its second
    const releasedAt = rig.world.read(tap1, Down).ms;
    // a press on B, 300 px away — outside the rejoin slop, so a new gesture on the same (mouse) pointer
    rig.target("mouse", b);
    rig.down("mouse", 410, 310);
    rig.step();
    const drag2 = only(rig.world, dragQ);
    // hold still until the NEXT tick closes tap1's window
    while (clock(rig.world) + 16 - releasedAt <= 280) rig.step();
    expect(phaseOf(rig.world, tap1)).toBe("Pending");
    expect(phaseOf(rig.world, drag2)).toBe("Possible");
    rig.move("mouse", 430, 310); // 20 px: the drag leaves its dead zone on the window's last tick
    rig.step();
    const pointer = rig.pointerEntity("mouse") as Entity;
    expect(rig.world.getRelation(pointer, ClaimedBy)).toBe(drag2);
    expect(phaseOf(rig.world, drag2)).toBe("Active");
    expect(phaseOf(rig.world, tap1)).toBe("Failed"); // as when the drag claims first: tap-then-drag fails the pending tap
    expect(rig.world.hasTag(a, Selected)).toBe(false);
    expect(rig.world.has(b, Grab)).toBe(true);
    rig.move("mouse", 450, 330);
    rig.step();
    expect(rig.world.read(b, Position)).toEqual({ x: 420, y: 320 });
    rig.up("mouse", 450, 330);
    rig.step(2);
  });
});
