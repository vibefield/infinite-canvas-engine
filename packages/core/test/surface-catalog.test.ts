/**
 * The surface vocabulary (design-013 §5, A1a) — the six presentation facts,
 * their DEFAULTS, and where they come from.
 *
 * Two things are pinned here that a rig could never show. First the defaults,
 * because D2's whole argument is that each one is the SAFE side: a card between
 * equip and its first clamp must claim no uploads, no band and no texture, and
 * "safe" is a property of the number, not of the code that reads it. Second the
 * boundary — equip stamps a widget and nothing else, so a port, a ghost or a
 * chrome entity carries none of the six and no reader has to filter them out.
 */
import { createWorld, type Component, type Entity } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import {
  Camera,
  createEngine,
  createWidgetEquipSystem,
  defineWidget,
  NO_TEXTURE,
  p,
  RequestedDemand,
  Retained,
  SurfaceBand,
  SurfaceDemand,
  SurfaceKind,
  SurfaceTarget,
  TextureRef,
  Viewport,
  WidgetEquipped,
  effectiveTarget,
} from "../src";
import { schemaMeta } from "../src/schema/meta";
import { PrefabId } from "../src/schema/prefab";

/** Declared default of a field, or undefined if it has none (catalog.test.ts's helper). */
function defaultOf(comp: Component, name: string): unknown {
  return comp.fieldByName.get(name)?.spec.default;
}

/** Enum labels of a field, in declaration order. */
function enumLabels(comp: Component, name: string): string[] {
  const t = comp.fieldByName.get(name)?.spec.type;
  return t !== undefined && typeof t === "object" ? [...t.labelToDisc.keys()] : [];
}

function scalarType(comp: Component, name: string): string | undefined {
  const t = comp.fieldByName.get(name)?.spec.type;
  return typeof t === "string" ? t : undefined;
}

// Module scope: strata's schema registry is process-global and throws on a
// duplicate name, so these are defined once, with file-unique types.
const DomCard = defineWidget({
  type: "sc:domCard",
  props: { title: p.string({ default: "" }) },
  surface: "dom",
  component: null,
});
const GlCard = defineWidget({
  type: "sc:glCard",
  props: { seed: p.number({ default: 0 }) },
  surface: "gl",
  component: null,
});

const SIX: readonly Component[] = [
  SurfaceKind,
  SurfaceTarget,
  RequestedDemand,
  SurfaceDemand,
  SurfaceBand,
  TextureRef,
];

function equipRig() {
  const world = createWorld();
  const engine = createEngine(world);
  engine.addSystems("derive", createWidgetEquipSystem(world));
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  world.setResource(Viewport, { w: 800, h: 600, dpr: 2 });
  let now = 0;
  return {
    world,
    step: (n = 1) => {
      for (let i = 0; i < n; i++) {
        now += 16;
        engine.step(now);
      }
    },
    spawnPrefab: (id: string): Entity => world.spawn({ components: [[PrefabId, { id }]] }),
  };
}

describe("the six components, as declared", () => {
  it("names and enum labels match design-013 §5 exactly", () => {
    expect(SurfaceKind.name).toBe("SurfaceKind");
    expect(enumLabels(SurfaceKind, "kind")).toEqual(["dom", "gl", "video"]);
    expect(SurfaceTarget.name).toBe("SurfaceTarget");
    expect(enumLabels(SurfaceTarget, "target")).toEqual(["dom", "gpu"]);
    expect(enumLabels(RequestedDemand, "mode")).toEqual(["live", "paused"]);
    expect(enumLabels(SurfaceDemand, "mode")).toEqual(["live", "paused"]);
    expect(scalarType(SurfaceBand, "band")).toBe("f32");
    expect(scalarType(TextureRef, "texture")).toBe("u32");
    expect(scalarType(TextureRef, "layer")).toBe("u16");
    for (const uv of ["u0", "v0", "u1", "v1"]) expect(scalarType(TextureRef, uv)).toBe("f32");
  });

  it("every field carries a default — none is required at spawn", () => {
    // The equip stamp supplies them all, but a `ctx.spawn` or an ad-hoc attach
    // in a test or a rig must not need boilerplate (catalog/index.ts's
    // defaults policy for runtime riders).
    for (const c of SIX) expect(schemaMeta.component(c)?.requiredFields).toEqual([]);
  });

  it("the defaults are the SAFE side (D2)", () => {
    // Target by kind. `dom` is only correct BECAUSE effectiveTarget coerces
    // every other kind — see the table below.
    expect(defaultOf(SurfaceKind, "kind")).toBe("dom");
    expect(defaultOf(SurfaceTarget, "target")).toBe("dom");
    // A kind that has said nothing wants what it would have got before demand
    // existed: live at display rate.
    expect(defaultOf(RequestedDemand, "mode")).toBe("live");
    expect(defaultOf(RequestedDemand, "fpsBucket")).toBe(60);
    expect(defaultOf(RequestedDemand, "interactive")).toBe(false);
    // The CLAMP starts owing nothing: a card is not visible until cull says so.
    expect(defaultOf(SurfaceDemand, "mode")).toBe("paused");
    expect(defaultOf(SurfaceDemand, "fpsBucket")).toBe(0);
    expect(defaultOf(SurfaceDemand, "interactive")).toBe(false);
    // 0 = never banded — NOT band 1, which is a real band the hysteresis would
    // then hold, leaving a card at the wrong resolution rather than at none.
    expect(defaultOf(SurfaceBand, "band")).toBe(0);
    // No destination, the NO_ENTITY precedent.
    expect(defaultOf(TextureRef, "texture")).toBe(NO_TEXTURE);
    expect(NO_TEXTURE).toBe(0);
  });

  it("Retained is a tag, and it is reachable by name", () => {
    expect(schemaMeta.tagName(Retained)).toBe("Retained");
  });

  it("SurfaceKind reaches consumers as a VALUE through the package index", () => {
    // `core/index.ts` also re-exports a TYPE-only `SurfaceKindValue` from the
    // compositor registry. An explicit type export of the same NAME would have
    // shadowed this component out of the star export silently — the build
    // compiles and the symbol is gone (the A1a errata at
    // `surface/compositor-registry.ts`). This asserts the value survived.
    expect(typeof SurfaceKind).toBe("object");
    expect(SurfaceKind.fieldByName.get("kind")).toBeDefined();
  });
});

describe("effectiveTarget (D5) — every reader goes through it", () => {
  it("is the whole table", () => {
    // A dom card's target is its behaviour's choice, either way.
    expect(effectiveTarget("dom", "dom")).toBe("dom");
    expect(effectiveTarget("dom", "gpu")).toBe("gpu");
    // A gl island and a video surface ARE textures — no live-DOM mode exists,
    // so `dom` is coerced rather than honoured. Production never blanks.
    expect(effectiveTarget("gl", "dom")).toBe("gpu");
    expect(effectiveTarget("gl", "gpu")).toBe("gpu");
    expect(effectiveTarget("video", "dom")).toBe("gpu");
    expect(effectiveTarget("video", "gpu")).toBe("gpu");
  });
});

describe("equip stamps the six — and only on widgets", () => {
  it("a dom widget lands with kind dom and target dom", () => {
    const { world, step, spawnPrefab } = equipRig();
    const e = spawnPrefab(DomCard.prefab.id);
    step();
    expect(world.hasTag(e, WidgetEquipped)).toBe(true);
    expect(world.get(e, SurfaceKind)?.kind).toBe("dom");
    expect(world.get(e, SurfaceTarget)?.target).toBe("dom");
    expect(world.get(e, RequestedDemand)).toEqual({ mode: "live", fpsBucket: 60, interactive: false });
    expect(world.get(e, SurfaceDemand)).toEqual({ mode: "paused", fpsBucket: 0, interactive: false });
    expect(world.get(e, SurfaceBand)?.band).toBe(0);
    expect(world.get(e, TextureRef)).toEqual({ texture: 0, layer: 0, u0: 0, v0: 0, u1: 0, v1: 0 });
  });

  it("a gl widget lands with kind gl and target GPU — the only target it has", () => {
    const { world, step, spawnPrefab } = equipRig();
    const e = spawnPrefab(GlCard.prefab.id);
    step();
    expect(world.get(e, SurfaceKind)?.kind).toBe("gl");
    expect(world.get(e, SurfaceTarget)?.target).toBe("gpu");
    const cell = world.get(e, SurfaceTarget);
    expect(cell).toBeDefined();
    if (cell !== undefined) {
      expect(effectiveTarget("gl", cell.target as "dom" | "gpu")).toBe("gpu");
    }
  });

  it("a NON-widget prefab gets the Equipped mark and none of the six", () => {
    // Ports, ghosts and chrome carry a PrefabId and reach the equip query, so
    // "widgets only" has to be true of the code, not of who happens to spawn.
    const { world, step, spawnPrefab } = equipRig();
    const e = spawnPrefab("sc:notAWidget");
    step();
    expect(world.hasTag(e, WidgetEquipped)).toBe(true);
    for (const c of SIX) expect(world.has(e, c)).toBe(false);
  });

  it("stamps ONCE — a second frame adds nothing and rewrites nothing", () => {
    // design-001 §7 bans interaction-rate add/remove; the WidgetEquipped mark
    // is what makes the query zero-match at steady state.
    const { world, step, spawnPrefab } = equipRig();
    const e = spawnPrefab(DomCard.prefab.id);
    step();
    world.edit(e).set(SurfaceTarget, { target: "gpu" });
    step(3);
    // If equip re-ran it would stamp the default back over the behaviour's
    // choice — the second-writer defect this test exists to catch.
    expect(world.get(e, SurfaceTarget)?.target).toBe("gpu");
  });
});
