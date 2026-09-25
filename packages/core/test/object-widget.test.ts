/**
 * design-015 D2a-core, items 1–3: a widget can be a GPU OBJECT.
 *
 * - The binding: `surface: "object"` carries an opaque `object` binding and a
 *   desk `stratum`; it refuses every view field, and no other surface may carry
 *   a binding. No standard surface behaviour is attached to it.
 * - Equip: an object gets its capability tags, its runtime behaviours,
 *   `WidgetEquipped` and a `Stratum` — and NONE of the six surface facts. A
 *   view widget is unchanged, except that a declared `stratum` rides along.
 * - The mount store: an object is culled like any widget (`Visible`/`Culled` is
 *   the desk renderer's working set) but never gets a mount entry.
 */
import type { Component, Entity, World } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import {
  Camera,
  Container,
  Culled,
  Movable,
  RequestedDemand,
  Selectable,
  SnapTarget,
  Stratum,
  SurfaceBand,
  SurfaceDemand,
  SurfaceKind,
  SurfaceTarget,
  TextureRef,
  Viewport,
  Visible,
  WidgetEquipped,
  alwaysGpu,
  createDocSession,
  createEngine,
  createWorld,
  defineBehavior,
  defineContainer,
  defineCanvasType,
  defineWidget,
  installWidgetRuntime,
  p,
  spawnWidget,
  widgets,
} from "../src";

/** An opaque stand-in for a desk kind binding — core must carry it and never read it. */
const PAPER_KIND = Object.freeze({ name: "paper", program: Symbol("paper-program") });

const Rise = defineBehavior("obj:rise", {
  store: "runtime",
  schema: { lift: p.number({ default: 0 }) },
});

const NOTE =
  widgets.get("obj:note") ??
  defineWidget({
    type: "obj:note",
    props: { text: p.string({ default: "" }) },
    defaultSize: { w: 200, h: 200 },
    surface: "object",
    object: PAPER_KIND,
    behaviors: [Rise],
  });

const PAD =
  widgets.get("obj:pad") ??
  defineWidget({
    type: "obj:pad",
    defaultSize: { w: 400, h: 300 },
    surface: "object",
    object: { name: "calendar" },
    component: null, // the explicit "none" is legal too
    stratum: "pads",
    interaction: { resizable: true },
  });

const CARD =
  widgets.get("obj:card") ??
  defineWidget({ type: "obj:card", surface: "dom", component: null, defaultSize: { w: 120, h: 80 } });

const SHEET_CARD =
  widgets.get("obj:sheet-card") ??
  defineWidget({
    type: "obj:sheet-card",
    surface: "dom",
    component: null,
    defaultSize: { w: 120, h: 80 },
    stratum: "sheets",
  });

const SIX_SURFACE_FACTS: readonly Component[] = [
  SurfaceKind,
  SurfaceTarget,
  RequestedDemand,
  SurfaceDemand,
  SurfaceBand,
  TextureRef,
] as Component[];

function rig() {
  const world = createWorld();
  const engine = createEngine(world);
  const session = createDocSession(world);
  const runtime = installWidgetRuntime(engine);
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  world.setResource(Viewport, { w: 1000, h: 800, dpr: 1 });
  let now = 0;
  const step = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      now += 16;
      engine.step(now);
    }
  };
  const spawn = (type: string, x: number, y: number): Entity => spawnWidget(session.store, world, type, { x, y });
  return { world, runtime, step, spawn };
}

function hasAll(world: World, e: Entity, comps: readonly Component[]): boolean[] {
  return comps.map((c) => world.has(e, c));
}

describe("defineWidget — the object binding (design-015 §5.2)", () => {
  it("compiles the binding and the stratum onto the WidgetType, a `things` by default", () => {
    expect(NOTE.surface).toBe("object");
    expect(NOTE.object).toBe(PAPER_KIND); // carried by identity, never read
    expect(NOTE.stratum).toBe("things");
    expect(PAD.stratum).toBe("pads");
    // a view widget: no binding, no stratum unless it declares one
    expect(CARD.object).toBeUndefined();
    expect(CARD.stratum).toBeUndefined();
    expect(SHEET_CARD.stratum).toBe("sheets");
  });

  it("attaches no standard surface behaviour to an object; a dom widget still gets domAtRest", () => {
    expect(NOTE.behaviors.map((b) => b.behavior.name)).toEqual(["obj:rise"]);
    expect(PAD.behaviors).toEqual([]);
    expect(CARD.behaviors.map((b) => b.behavior.name)).toEqual(["ice:surface.domAtRest"]);
  });

  it("refuses an object without a binding, and a binding on any other surface", () => {
    expect(() => defineWidget({ type: "obj:bad-unbound", surface: "object" })).toThrow(
      /object surface and carries no object binding/,
    );
    expect(() => defineWidget({ type: "obj:bad-null", surface: "object", object: null })).toThrow(
      /carries no object binding/,
    );
    for (const surface of ["dom", "gl", "video"] as const) {
      expect(() =>
        defineWidget({ type: `obj:bad-${surface}`, surface, component: null, object: PAPER_KIND }),
      ).toThrow(new RegExp(`is a ${surface} surface and carries an object binding`));
    }
  });

  it("refuses every view field on an object: a component, chrome, animated", () => {
    const base = { surface: "object" as const, object: PAPER_KIND };
    expect(() => defineWidget({ ...base, type: "obj:bad-comp", component: () => null })).toThrow(
      /declares component/,
    );
    expect(() => defineWidget({ ...base, type: "obj:bad-chrome", chrome: () => null })).toThrow(/declares chrome/);
    expect(() => defineWidget({ ...base, type: "obj:bad-anim", animated: true })).toThrow(/declares animated/);
    expect(() =>
      defineWidget({ ...base, type: "obj:bad-all", component: {}, chrome: {}, animated: true }),
    ).toThrow(/declares component, chrome, animated/);
    // the explicit "none" of each passes
    expect(() =>
      defineWidget({ ...base, type: "obj:ok-nones", component: null, chrome: null, animated: false }),
    ).not.toThrow();
  });

  it("refuses a behaviour that writes SurfaceTarget on an object — it has none to choose", () => {
    expect(() =>
      defineWidget({ type: "obj:bad-gpu", surface: "object", object: PAPER_KIND, behaviors: [alwaysGpu] }),
    ).toThrow(/object surface and lists "ice:surface.alwaysGpu", which writes SurfaceTarget/);
  });

  it("refuses an unknown stratum", () => {
    expect(() =>
      defineWidget({
        type: "obj:bad-stratum",
        surface: "object",
        object: PAPER_KIND,
        stratum: "floor" as unknown as "things",
      }),
    ).toThrow(/declares stratum "floor"/);
  });

  it("an object may be a container (a mini mat), through defineContainer", () => {
    const inside = defineCanvasType({ id: "obj:inside", semanticVersion: 1, semantic: { placement: { widgets: [NOTE] } } });
    const MAT = defineContainer({
      type: "obj:minimat",
      canvas: inside,
      surface: "object",
      object: { name: "minimat" },
      stratum: "sheets",
      provides: ["widget"],
    });
    expect(MAT.surface).toBe("object");
    expect(MAT.stratum).toBe("sheets");
    expect(MAT.container?.canvasTypeId).toBe("obj:inside");
    expect(MAT.capabilityTags).toContain(Container);
  });
});

describe("equip — an object's riders (design-015 §5.2)", () => {
  it("stamps tags, runtime behaviours, WidgetEquipped and Stratum — and none of the six surface facts", () => {
    const { world, step, spawn } = rig();
    const note = spawn(NOTE.type, 10, 10);
    const pad = spawn(PAD.type, 300, 10);
    step(2); // projection, then equip's structure lands at the derive flush

    for (const e of [note, pad]) {
      expect(world.hasTag(e, WidgetEquipped)).toBe(true);
      expect(world.hasTag(e, Selectable)).toBe(true);
      expect(world.hasTag(e, Movable)).toBe(true);
      expect(world.hasTag(e, SnapTarget)).toBe(true);
      expect(hasAll(world, e, SIX_SURFACE_FACTS)).toEqual([false, false, false, false, false, false]);
    }
    expect(world.get(note, Stratum)).toEqual({ band: 2 }); // things, by default
    expect(world.get(pad, Stratum)).toEqual({ band: 0 }); // pads
    // the runtime behaviour rides equip exactly as on any widget
    expect(world.get(note, Rise.component)).toEqual({ lift: 0 });
  });

  it("leaves a view widget as it was — the six facts, no Stratum — unless it declared a stratum", () => {
    const { world, step, spawn } = rig();
    const card = spawn(CARD.type, 10, 10);
    const sheet = spawn(SHEET_CARD.type, 200, 10);
    step(2);
    expect(hasAll(world, card, SIX_SURFACE_FACTS)).toEqual([true, true, true, true, true, true]);
    expect(world.get(card, SurfaceKind)).toEqual({ kind: "dom" });
    expect(world.get(card, SurfaceTarget)).toEqual({ target: "dom" });
    expect(world.has(card, Stratum)).toBe(false);
    // a declared stratum rides along, and takes nothing away
    expect(hasAll(world, sheet, SIX_SURFACE_FACTS)).toEqual([true, true, true, true, true, true]);
    expect(world.get(sheet, Stratum)).toEqual({ band: 1 });
  });
});

describe("the mount store — no entry for an object (design-015 §5.2)", () => {
  it("culls an object like any widget but never mounts it", () => {
    const { world, runtime, step, spawn } = rig();
    const note = spawn(NOTE.type, 10, 10);
    const card = spawn(CARD.type, 300, 10);
    step(3);
    // both are classified by the cull…
    expect(world.hasTag(note, Visible)).toBe(true);
    expect(world.hasTag(card, Visible)).toBe(true);
    // …but only the view widget is mounted
    const mounted = runtime.store.getSnapshot().map((m) => m.entity);
    expect(mounted).toContain(card);
    expect(mounted).not.toContain(note);

    // pan away: the cull still flips the object, and it still has no entry
    world.setResource(Camera, { x: 50_000, y: 50_000, zoom: 1, gesturing: false });
    step(2);
    expect(world.hasTag(note, Culled)).toBe(true);
    expect(world.hasTag(note, Visible)).toBe(false);
    const hidden = runtime.store.getSnapshot();
    expect(hidden.map((m) => m.entity)).toEqual([card]);
    expect(hidden[0]?.hidden).toBe(true);

    // and back: visible again, still unmounted
    world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    step(2);
    expect(world.hasTag(note, Visible)).toBe(true);
    expect(runtime.store.getSnapshot().map((m) => m.entity)).toEqual([card]);
  });

  it("offers an object to no transition retention (only mounted entries can be held)", () => {
    const { runtime, step, spawn } = rig();
    const note = spawn(NOTE.type, 10, 10);
    step(3);
    const hold = runtime.store.retainForTransition?.([note]);
    expect(hold?.entities).toEqual([]);
    hold?.release();
  });
});
