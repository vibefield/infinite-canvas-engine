/**
 * ONE contract, answered by BOTH presentation profiles (design-012 §6; plan §5
 * S8's "both profiles typecheck against one interface").
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
  createWorld,
  defineWidget,
  type Entity,
  type SurfaceDemand,
  type World,
} from "@ice/core";
import { describe, expect, it } from "vitest";
import { createPresentationRegistry } from "../src/presentation-mode";
import {
  compositedSurfaces,
  declaredPresentation,
  presentationPinned,
  stratifiedSurfaces,
  widgetPresentationPins,
  widgetSurfaceKind,
} from "../src/widget-surfaces";

defineWidget({ type: "ws:card", surface: "dom", component: null });
defineWidget({ type: "ws:island", surface: "gl", component: null });
defineWidget({ type: "ws:editor", surface: "dom", component: null, presentation: { pin: "live-dom" } });

const LIVE: SurfaceDemand = { mode: "live", fpsBucket: 60, interactive: false };

const spawn = (world: World, type?: string): Entity =>
  world.spawn({
    components: [
      [Position, { x: 0, y: 0 }],
      [Size, { w: 10, h: 10 }],
      ...(type !== undefined ? [[PrefabId, { id: type }] as const] : []),
    ],
  });

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

  it("reports a type's declaration and whether it is pinned", () => {
    const world = createWorld();
    const editor = spawn(world, "ws:editor");
    const card = spawn(world, "ws:card");
    expect(declaredPresentation(world, editor)).toEqual({ default: "live-dom", pin: "live-dom" });
    expect(presentationPinned(world, editor)).toBe(true);
    // Declaring nothing is not a pin — it is the Q5 default, which policy owns.
    expect(declaredPresentation(world, card)).toEqual({ default: "live-dom", pin: undefined });
    expect(presentationPinned(world, card)).toBe(false);
    expect(widgetPresentationPins(world)(editor)).toBe(true);
  });
});

describe("the composited profile's answers", () => {
  it("reads the live mode registry, so a promotion shows up in the surface", () => {
    const world = createWorld();
    const presentation = createPresentationRegistry();
    const view = compositedSurfaces({ world, presentation, demandOf: () => LIVE });
    const card = spawn(world, "ws:card");
    const surface = view.get(card);

    expect(surface?.kind).toBe("dom");
    expect(surface?.presentation).toBe("live-dom");
    presentation.set(card, "composited"); // the ONE door, as policy drives it
    expect(surface?.presentation).toBe("composited");
  });

  it("routes setDemand to the consumer the app wired", () => {
    const world = createWorld();
    const asked: SurfaceDemand[] = [];
    const view = compositedSurfaces({
      world,
      presentation: createPresentationRegistry(),
      demandOf: () => LIVE,
      requestDemand: (_e, d) => asked.push(d),
    });
    const paused: SurfaceDemand = { mode: "paused", fpsBucket: 0, interactive: false };
    view.get(spawn(world, "ws:card"))?.setDemand(paused);
    expect(asked).toEqual([paused]);
  });
});

describe("the stratified profile's answers", () => {
  it("DERIVES presentation from the kind, because it has no promotion to read", () => {
    // A dom widget's pixels come from a natively painted P1 host; a gl
    // widget's from a P2 island texture. Neither can change at runtime in that
    // profile, so a mode registry would be a map that never has an entry.
    const world = createWorld();
    const view = stratifiedSurfaces({ world, demandOf: () => LIVE });
    expect(view.get(spawn(world, "ws:card"))?.presentation).toBe("live-dom");
    expect(view.get(spawn(world, "ws:island"))?.presentation).toBe("composited");
  });

  it("does NOT report a pin it cannot act on", () => {
    // The honest answer for a profile with no promotion machinery. Reporting
    // `live-dom` because the type pinned it would be right by accident here
    // and wrong the moment a type pins `composited`.
    const world = createWorld();
    const view = stratifiedSurfaces({ world, demandOf: () => LIVE });
    const editor = spawn(world, "ws:editor");
    expect(declaredPresentation(world, editor)?.pin).toBe("live-dom");
    expect(view.get(editor)?.presentation).toBe("live-dom"); // its KIND's mode
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
    expect(view.get(card)?.presentation).toBe("live-dom");
  });
});

describe("the two profiles side by side", () => {
  it("differ ONLY where one of them has a choice to make", () => {
    // The same entity, the same question, two profiles. Kind agrees (it is a
    // widget-type fact); presentation diverges the moment the composited
    // profile promotes, which is the whole of what the composited profile can
    // do that the stratified one cannot.
    const world = createWorld();
    const presentation = createPresentationRegistry();
    const composited = compositedSurfaces({ world, presentation, demandOf: () => LIVE });
    const stratified = stratifiedSurfaces({ world, demandOf: () => LIVE });
    const card = spawn(world, "ws:card");

    expect(composited.get(card)?.kind).toBe(stratified.get(card)?.kind);
    expect(composited.get(card)?.presentation).toBe(stratified.get(card)?.presentation);

    presentation.set(card, "composited");
    expect(composited.get(card)?.presentation).toBe("composited");
    expect(stratified.get(card)?.presentation).toBe("live-dom");
  });

  it("both answer undefined for an entity that is not a widget", () => {
    const world = createWorld();
    const bare = spawn(world);
    expect(compositedSurfaces({ world, presentation: createPresentationRegistry(), demandOf: () => LIVE }).get(bare)).toBeUndefined();
    expect(stratifiedSurfaces({ world, demandOf: () => LIVE }).get(bare)).toBeUndefined();
  });
});
