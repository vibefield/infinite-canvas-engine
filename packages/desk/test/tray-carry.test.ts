// @vitest-environment node
// THE CARRY (design-017 §9; K5b — tray/carry.ts): the take's motion. The copy LIFTS under the grab point at ×1.06 of its specimen's
// scale and follows the pointer; PUT BACK it glides onto its specimen and is gone; HANDED it holds its pose until the insert ghost
// comes, and the ghost GROWS out of it about the grab point — coinciding with it at the hand-off — to its own size on the drawer's
// curve, presented here until it is its size and the drawer has gone; refused (no ghost) it is put back; an insert ghost flying HOME
// shrinks to nothing as its tween runs. `carryView` puts the object's grab point at the pivot.
import { describe, expect, it } from "vitest";
import { CARRY, type CarryFacts, type CarryGhost, type CarrySpecimen, carryView, createTrayCarry } from "../src/tray/carry";
import { slideEase } from "../src/tray/drawer";

const SPEC: CarrySpecimen = { type: "k.note", zoom: 0.5, x0: 100, y0: 500, x1: 200, y1: 600 };   // a 200-unit note drawn 100 px wide
const CAM = { x: 0, y: 0, zoom: 1 };
const take = (over: Partial<CarryFacts> = {}): CarryFacts => ({ take: "k.note", u: 0.25, v: 0.5, x: 130, y: 540, handed: 0, ...over });
const ghost = (over: Partial<CarryGhost> = {}): CarryGhost => ({ entity: 77, type: "k.note", x: 0, y: 0, w: 200, h: 200, retiring: false, progress: 0, ...over });

describe("the carry (tray/carry.ts)", () => {
  it("lifts the copy under the grab point, following the pointer at ×1.06 of its specimen's scale, and settles", () => {
    const c = createTrayCarry();
    c.step(0, take({ take: "" }), [SPEC], [], CAM, 1);
    let poses = c.step(16, take(), [SPEC], [], CAM, 1);
    expect(poses).toHaveLength(1);
    expect(poses[0]).toMatchObject({ phase: "lift", type: "k.note", u: 0.25, v: 0.5, px: 130, py: 540 });
    // its lift has begun (a spring from 0, one frame in): between its specimen's scale and ×1.06 of it
    expect(poses[0]?.zoom).toBeGreaterThan(0.5);
    expect(poses[0]?.zoom).toBeLessThan(0.5 * CARRY.liftScale);
    expect(c.live()).toBe(true);
    let t = 16;
    for (let i = 0; i < 60; i++) { t += 16; poses = c.step(t, take({ x: 150, y: 520 }), [SPEC], [], CAM, 1); }
    expect(poses[0]).toMatchObject({ px: 150, py: 520, lift: 1 });
    expect(poses[0]?.zoom).toBeCloseTo(0.5 * CARRY.liftScale, 9);
    expect(c.live()).toBe(false);   // at rest under a still pointer: the facts wake the next frame, not the carry
    expect(c.presented().size).toBe(0);
  });

  it("put back (the take ends in the drawer), it glides onto its specimen's grab point at its scale on the drawer's curve, and is gone", () => {
    const c = createTrayCarry();
    c.step(0, take({ take: "" }), [SPEC], [], CAM, 1);
    let t = 0;
    for (let i = 0; i < 40; i++) { t += 16; c.step(t, take({ x: 300, y: 400 }), [SPEC], [], CAM, 1); }
    const t0 = t + 16;
    let poses = c.step(t0, take({ take: "", x: 300, y: 400 }), [SPEC], [], CAM, 1);
    expect(poses[0]).toMatchObject({ phase: "back", px: 300, py: 400 });
    poses = c.step(t0 + CARRY.backMs / 2, take({ take: "" }), [SPEC], [], CAM, 1);
    const k = slideEase(0.5);
    const home = { x: 100 + 0.25 * 100, y: 500 + 0.5 * 100 };
    expect(poses[0]?.px).toBeCloseTo(300 + (home.x - 300) * k, 9);
    expect(poses[0]?.py).toBeCloseTo(400 + (home.y - 400) * k, 9);
    expect(poses[0]?.zoom).toBeCloseTo(0.53 + (0.5 - 0.53) * k, 9);
    expect(c.live()).toBe(true);
    poses = c.step(t0 + CARRY.backMs, take({ take: "" }), [SPEC], [], CAM, 1);
    expect(poses).toEqual([]);
    expect(c.live()).toBe(false);
  });

  it("handed, it holds its pose; the ghost then grows OUT of it — the same pivot and scale at the hand-off — and is the desk's once its size with the drawer gone", () => {
    const c = createTrayCarry();
    c.step(0, take({ take: "" }), [SPEC], [], CAM, 1);
    let t = 0;
    for (let i = 0; i < 40; i++) { t += 16; c.step(t, take({ x: 300, y: 420 }), [SPEC], [], CAM, 1); }
    // the hand-off tick: the take still names it, where it left; `handed` bumps
    t += 16;
    const held = c.step(t, take({ x: 310, y: 330, handed: 1 }), [], [], CAM, 0.99);
    expect(held[0]).toMatchObject({ phase: "handing", px: 310, py: 330 });
    const z = held[0]?.zoom as number;
    expect(z).toBeCloseTo(0.5 * CARRY.liftScale, 6);
    // the frame after: the ghost is in the world, its grab point where the pointer was (0.25 · 200 = 50, 0.5 · 200 = 100)
    t += 16;
    const g = ghost({ x: 310 - 50, y: 330 - 100 });
    const grown = c.step(t, take({ take: "", x: 310, y: 330, handed: 1 }), [], [g], CAM, 0.95);
    expect(grown[0]).toMatchObject({ phase: "grow", ghost: 77, u: 0.25, v: 0.5 });
    expect(grown[0]?.px).toBeCloseTo(310, 9);
    expect(grown[0]?.py).toBeCloseTo(330, 9);
    expect(grown[0]?.zoom).toBeCloseTo(z, 9);   // THE HAND-OFF: no pop
    expect([...c.presented()]).toEqual([77]);
    // it grows about its grab point as it is carried
    const g2 = ghost({ x: 400 - 50, y: 300 - 100 });
    const mid = c.step(t + CARRY.growMs / 2, take({ take: "", handed: 1 }), [], [g2], CAM, 0.5);
    expect(mid[0]?.px).toBeCloseTo(400, 9);
    expect(mid[0]?.zoom).toBeCloseTo(z + (1 - z) * slideEase(0.5), 9);
    // its size, but the drawer not yet gone: still here (over the dim)
    const full = c.step(t + CARRY.growMs, take({ take: "", handed: 1 }), [], [g2], CAM, 0.02);
    expect(full[0]?.zoom).toBeCloseTo(1, 9);
    expect(c.presented().size).toBe(1);
    // …and the drawer gone: the desk's
    const done = c.step(t + CARRY.growMs + 16, take({ take: "", handed: 1 }), [], [g2], CAM, 0);
    expect(done).toEqual([]);
    expect(c.presented().size).toBe(0);
    expect(c.live()).toBe(false);
  });

  it("a flick (lifted and handed in one event) hands the take as it left, from its specimen's scale", () => {
    const c = createTrayCarry();
    c.step(0, take({ take: "" }), [SPEC], [], CAM, 1);
    const held = c.step(16, take({ x: 320, y: 300, handed: 1 }), [SPEC], [], CAM, 1);
    expect(held[0]).toMatchObject({ phase: "handing", px: 320, py: 300 });
    expect(held[0]?.zoom).toBeCloseTo(0.5, 9);
  });

  it("refused (no ghost comes), the handed copy is put back", () => {
    const c = createTrayCarry();
    c.step(0, take({ take: "" }), [SPEC], [], CAM, 1);
    c.step(16, take(), [SPEC], [], CAM, 1);
    c.step(32, take({ handed: 1 }), [SPEC], [], CAM, 1);
    let t = 48;
    let poses = c.step(t, take({ take: "", handed: 1 }), [SPEC], [], CAM, 1);
    for (let i = 0; i < CARRY.handFrames; i++) { t += 16; poses = c.step(t, take({ take: "", handed: 1 }), [SPEC], [], CAM, 1); }
    expect(poses[0]?.phase).toBe("back");
  });

  it("an insert ghost flying home shrinks to nothing as its tween runs — presented, not the desk's — whoever adopted it", () => {
    const c = createTrayCarry();
    c.step(0, undefined, [], [ghost()], CAM, 0);
    expect(c.presented().size).toBe(0);   // a ghost at work is the desk's
    let poses = c.step(16, undefined, [], [ghost({ retiring: true, progress: 0 })], { x: 10, y: 0, zoom: 2 }, 0);
    expect(poses[0]).toMatchObject({ phase: "home", ghost: 77, u: 0.5, v: 0.5, px: (100 - 10) * 2, py: 200 });
    expect(poses[0]?.zoom).toBeCloseTo(2, 9);
    expect([...c.presented()]).toEqual([77]);
    poses = c.step(32, undefined, [], [ghost({ retiring: true, progress: 0.5, x: 40 })], { x: 10, y: 0, zoom: 2 }, 0);
    expect(poses[0]?.zoom).toBeCloseTo(2 * (1 - slideEase(0.5)), 9);
    poses = c.step(48, undefined, [], [ghost({ retiring: true, progress: 1 })], CAM, 0);
    expect(poses[0]?.zoom).toBe(0);
    poses = c.step(64, undefined, [], [], CAM, 0);   // reaped
    expect(poses).toEqual([]);
    expect(c.presented().size).toBe(0);
  });

  it("Esc while it grows: it flies home from the scale it had", () => {
    const c = createTrayCarry();
    c.step(0, take({ take: "" }), [SPEC], [], CAM, 1);
    c.step(16, take(), [SPEC], [], CAM, 1);
    c.step(32, take({ handed: 1 }), [], [], CAM, 1);
    c.step(48, take({ take: "", handed: 1 }), [], [ghost()], CAM, 1);
    const k = c.step(48 + CARRY.growMs / 4, take({ take: "", handed: 1 }), [], [ghost()], CAM, 1)[0]?.zoom as number;
    const home = c.step(48 + CARRY.growMs / 4 + 16, take({ take: "", handed: 1 }), [], [ghost({ retiring: true, progress: 0 })], CAM, 1);
    expect(home[0]?.phase).toBe("home");
    expect(home[0]?.zoom).toBeCloseTo(k, 9);
  });

  it("carryView puts the object's grab point at the pivot, at the pose's scale", () => {
    const v = carryView({ id: 1, type: "t", phase: "lift", u: 0.25, v: 0.75, px: 400, py: 300, zoom: 0.5, lift: 1 }, { x: -100, y: -50, w: 200, h: 100 });
    // the object's point (−100 + 50, −50 + 75) = (−50, 25) → screen ((−50 − camX)·0.5, (25 − camY)·0.5) = (400, 300)
    expect((-50 - v.camX) * v.zoom).toBeCloseTo(400, 9);
    expect((25 - v.camY) * v.zoom).toBeCloseTo(300, 9);
    expect(v.zoom).toBe(0.5);
  });
});
