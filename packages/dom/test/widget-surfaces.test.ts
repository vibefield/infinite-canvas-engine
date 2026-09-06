/**
 * ONE contract, answered by BOTH presentation profiles (design-012 §6; plan §5
 * S8's "both profiles typecheck against one interface"; the answers rebuilt on
 * the world at design-013 A1b).
 *
 * Typechecking is the cheap half — both factories return `WidgetSurfaceView`,
 * so a divergence is a compile error. What these grade is the half a type
 * cannot: that the two profiles give DIFFERENT and CORRECT answers to the same
 * question. A contract both profiles satisfy by reporting the same constant
 * would typecheck perfectly and mean nothing.
 */
import {
  Grab,
  NO_ENTITY,
  Position,
  PrefabId,
  Size,
  SurfaceDemand,
  SurfaceKind,
  SurfaceTarget,
  createWorld,
  defineWidget,
  type Entity,
  type SurfaceDemandValue,
  type World,
} from "@ice/core";
import { describe, expect, it } from "vitest";
import { compositedSurfaces, stratifiedSurfaces, widgetSurfaceKind } from "../src/widget-surfaces";

defineWidget({ type: "ws:card", surface: "dom", component: null });
defineWidget({ type: "ws:island", surface: "gl", component: null });

const LIVE: SurfaceDemandValue = { mode: "live", fpsBucket: 60, interactive: false };

/**
 * A spawn that also stamps what `widgetEquip` would have (design-013 D2) — the
 * kind, and the target that kind rests on. These tests drive the answers, not
 * the equip pass, so they owe the stamp.
 */
const spawn = (world: World, type?: string): Entity => {
  const e = world.spawn({
    components: [
      [Position, { x: 0, y: 0 }],
      [Size, { w: 10, h: 10 }],
      ...(type !== undefined ? [[PrefabId, { id: type }] as const] : []),
    ],
  });
  const kind = type === undefined ? undefined : widgetSurfaceKind(world, e);
  if (kind !== undefined) {
    world.addComponent(e, SurfaceKind, { kind });
    world.addComponent(e, SurfaceTarget, { target: kind === "dom" ? "dom" : "gpu" });
  }
  return e;
};

describe("reading a widget's kind", () => {
  it("comes from the widget-type registry, not from the compositor's sources", () => {
    // A widget has a kind from the moment it spawns; a SOURCE appears only
    // once the compositor has something to sample. Asking the source registry
    // would answer `undefined` for every live-dom card on the board.
    const world = createWorld();
    expect(widgetSurfaceKind(world, spawn(world, "ws:card"))).toBe("dom");
    expect(widgetSurfaceKind(world, spawn(world, "ws:island"))).toBe("gl");
    expect(widgetSurfaceKind(world, spawn(world))).toBeUndefined();
  });
});

describe("the composited profile's answers", () => {
  it("reads the world's SurfaceTarget, so a promotion shows up in the surface", () => {
    const world = createWorld();
    const view = compositedSurfaces({ world, demandOf: () => LIVE });
    const card = spawn(world, "ws:card");
    const surface = view.get(card);

    expect(surface?.kind).toBe("dom");
    expect(surface?.target).toBe("dom");
    // The kind behaviour's write — the ONE writer of this fact.
    world.edit(card).set(SurfaceTarget, { target: "gpu" });
    expect(surface?.target).toBe("gpu");
  });

  it("coerces a gl card to gpu however its target reads", () => {
    // `effectiveTarget` (D5): an island IS a texture, so `dom` on one is a bug
    // the read side refuses rather than a mode. Production coerces; the Band
    // system carries the dev throw.
    const world = createWorld();
    const view = compositedSurfaces({ world, demandOf: () => LIVE });
    const island = spawn(world, "ws:island");
    expect(view.get(island)?.target).toBe("gpu");
    world.edit(island).set(SurfaceTarget, { target: "dom" });
    expect(view.get(island)?.target).toBe("gpu");
  });

  it("answers demand from the CLAMP when the host wires no callback (D10)", () => {
    // The old leg took an app callback and, absent one, throttled nothing —
    // so parking depended on an app remembering a seam. `SurfaceDemand` is
    // what the Demand system wrote, and it is the default answer now.
    const world = createWorld();
    const view = compositedSurfaces({ world });
    const card = spawn(world, "ws:card");
    // Unstamped reads as equip's own safe default: owing nothing.
    expect(view.get(card)?.demand).toEqual({ mode: "paused", fpsBucket: 0, interactive: false });
    world.addComponent(card, SurfaceDemand, { mode: "live", fpsBucket: 30, interactive: true });
    expect(view.get(card)?.demand).toEqual({ mode: "live", fpsBucket: 30, interactive: true });
  });

  it("routes setDemand to the consumer the app wired", () => {
    const world = createWorld();
    const asked: SurfaceDemandValue[] = [];
    const view = compositedSurfaces({
      world,
      demandOf: () => LIVE,
      requestDemand: (_e, d) => asked.push(d),
    });
    const paused: SurfaceDemandValue = { mode: "paused", fpsBucket: 0, interactive: false };
    view.get(spawn(world, "ws:card"))?.setDemand(paused);
    expect(asked).toEqual([paused]);
  });
});

describe("the stratified profile's answers", () => {
  it("DERIVES the target from the kind, because it has no promotion to read", () => {
    // A dom widget's pixels come from a natively painted P1 host; a gl
    // widget's from a P2 island texture. Neither changes at runtime in that
    // profile, so reading a promotion would report one it cannot perform.
    const world = createWorld();
    const view = stratifiedSurfaces({ world, demandOf: () => LIVE });
    expect(view.get(spawn(world, "ws:card"))?.target).toBe("dom");
    expect(view.get(spawn(world, "ws:island"))?.target).toBe("gpu");
  });

  it("does NOT report a promotion the world holds but it cannot act on", () => {
    // The standard behaviours run in a stratified app too and still write
    // `SurfaceTarget` on a grab. Nothing there observes it, and reporting it
    // would be a promotion this profile has no machinery to perform.
    const world = createWorld();
    const view = stratifiedSurfaces({ world, demandOf: () => LIVE });
    const card = spawn(world, "ws:card");
    world.edit(card).set(SurfaceTarget, { target: "gpu" });
    expect(view.get(card)?.target).toBe("dom");
  });

  it("is unmoved by a grab — the stratified profile promotes nothing", () => {
    const world = createWorld();
    const view = stratifiedSurfaces({ world, demandOf: () => LIVE });
    const card = spawn(world, "ws:card");
    world.addComponent(card, Grab, {
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      parent: NO_ENTITY,
      prev: NO_ENTITY,
      ord: 0,
    });
    expect(view.get(card)?.target).toBe("dom");
  });
});

describe("the two profiles side by side", () => {
  it("differ ONLY where one of them has a choice to make", () => {
    // The same entity, the same question, two profiles. Kind agrees (it is a
    // widget-type fact); the target diverges the moment the kind behaviour
    // promotes, which is the whole of what the composited profile can do that
    // the stratified one cannot.
    const world = createWorld();
    const composited = compositedSurfaces({ world, demandOf: () => LIVE });
    const stratified = stratifiedSurfaces({ world, demandOf: () => LIVE });
    const card = spawn(world, "ws:card");

    expect(composited.get(card)?.kind).toBe(stratified.get(card)?.kind);
    expect(composited.get(card)?.target).toBe(stratified.get(card)?.target);

    world.edit(card).set(SurfaceTarget, { target: "gpu" });
    expect(composited.get(card)?.target).toBe("gpu");
    expect(stratified.get(card)?.target).toBe("dom");
  });

  it("both answer undefined for an entity that is not a widget", () => {
    const world = createWorld();
    const bare = spawn(world);
    expect(compositedSurfaces({ world, demandOf: () => LIVE }).get(bare)).toBeUndefined();
    expect(stratifiedSurfaces({ world, demandOf: () => LIVE }).get(bare)).toBeUndefined();
  });
});
