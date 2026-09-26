/**
 * design-015 D2a-core, items 1–3, as they stand after D5b: a widget's face IS its object kind.
 *
 * - The binding: an opaque `object` binding and a desk `stratum` compile onto the WidgetType; a
 *   widget without a binding is faceless (the desk draws nothing for it) and gets no stratum
 *   unless it declares one. The retired view fields (`surface`, `component`, `chrome`,
 *   `animated`, `preview`, `instancePreview`, `sizeMode`) are refused for the JS caller.
 * - Equip: an object gets its capability tags, its runtime behaviours, `WidgetEquipped` and a
 *   `Stratum`; a faceless widget the same minus the stratum (unless declared).
 * - The cull: every widget is classified (`Visible`/`Culled` is the desk renderer's working set);
 *   there is no mount store any more.
 */
import type { Entity } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import {
  Camera,
  Container,
  Culled,
  Movable,
  Selectable,
  SnapTarget,
  Stratum,
  Viewport,
  Visible,
  WidgetEquipped,
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
    object: PAPER_KIND,
    behaviors: [Rise],
  });

const PAD =
  widgets.get("obj:pad") ??
  defineWidget({
    type: "obj:pad",
    defaultSize: { w: 400, h: 300 },
    object: { name: "calendar" },
    // the explicit "none" is legal too
    stratum: "pads",
    interaction: { resizable: true },
  });

const CARD =
  widgets.get("obj:card") ??
  defineWidget({ type: "obj:card", defaultSize: { w: 120, h: 80 } });

const SHEET_CARD =
  widgets.get("obj:sheet-card") ??
  defineWidget({
    type: "obj:sheet-card",
    defaultSize: { w: 120, h: 80 },
    stratum: "sheets",
  });

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

describe("defineWidget — the object binding (design-015 §5.2)", () => {
  it("compiles the binding and the stratum onto the WidgetType, a `things` by default", () => {
    expect(NOTE.object).toBe(PAPER_KIND); // carried by identity, never read
    expect(NOTE.stratum).toBe("things");
    expect(PAD.stratum).toBe("pads");
    // a view widget: no binding, no stratum unless it declares one
    expect(CARD.object).toBeUndefined();
    expect(CARD.stratum).toBeUndefined();
    expect(SHEET_CARD.stratum).toBe("sheets");
  });

  it("attaches only the declared behaviours — no engine surface behaviour rides any widget (D5b)", () => {
    expect(NOTE.behaviors.map((b) => b.behavior.name)).toEqual(["obj:rise"]);
    expect(PAD.behaviors).toEqual([]);
    expect(CARD.behaviors).toEqual([]);
  });

  it("a widget without a binding is faceless, not refused; `null` is how a caller says none", () => {
    const bare = defineWidget({ type: "obj:faceless", defaultSize: { w: 10, h: 10 } });
    expect(bare.object).toBeUndefined();
    expect(bare.stratum).toBeUndefined();
    expect(bare.openable).toBe(false);
    const none = defineWidget({ type: "obj:null-face", object: null });
    expect(none.object).toBeUndefined();
    // …but openable needs a kind to open
    expect(() => defineWidget({ type: "obj:bad-open", openable: true })).toThrow(/declares openable and carries no object binding/);
  });

  it("refuses the retired view fields for the JS caller (design-015 D5b): surface, component, chrome, animated, preview, instancePreview, sizeMode", () => {
    const w = (extra: Record<string, unknown>) => defineWidget({ type: `obj:retired-${Object.keys(extra).join("-")}`, object: PAPER_KIND, ...extra } as never);
    expect(() => w({ surface: "object" })).toThrow(/declares surface — the view half of a widget is retired/);
    expect(() => w({ component: () => null })).toThrow(/declares component/);
    expect(() => w({ chrome: () => null })).toThrow(/declares chrome/);
    expect(() => w({ animated: true })).toThrow(/declares animated/);
    expect(() => w({ preview: {} })).toThrow(/declares preview/);
    expect(() => w({ instancePreview: { props: [] } })).toThrow(/declares instancePreview/);
    expect(() => w({ sizeMode: "auto" })).toThrow(/declares sizeMode/);
    expect(() => w({ presentation: {} })).toThrow(/declares presentation/);
    expect(() => w({ component: {}, chrome: {}, animated: true })).toThrow(/declares component, chrome, animated/);
    expect(() =>
      defineWidget({ type: "obj:retired-frame-preview", object: PAPER_KIND, container: { accepts: [], framePreview: {} } as never }),
    ).toThrow(/container declares framePreview/);
  });

  it("refuses an unknown stratum", () => {
    expect(() =>
      defineWidget({
        type: "obj:bad-stratum",
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
      object: { name: "minimat" },
      stratum: "sheets",
      provides: ["widget"],
    });
    expect(MAT.object).toEqual({ name: "minimat" });
    expect(MAT.stratum).toBe("sheets");
    expect(MAT.container?.canvasTypeId).toBe("obj:inside");
    expect(MAT.capabilityTags).toContain(Container);
  });
});

describe("equip — an object's riders (design-015 §5.2)", () => {
  it("stamps tags, runtime behaviours, WidgetEquipped and Stratum", () => {
    const { world, step, spawn } = rig();
    const note = spawn(NOTE.type, 10, 10);
    const pad = spawn(PAD.type, 300, 10);
    step(2); // projection, then equip's structure lands at the derive flush

    for (const e of [note, pad]) {
      expect(world.hasTag(e, WidgetEquipped)).toBe(true);
      expect(world.hasTag(e, Selectable)).toBe(true);
      expect(world.hasTag(e, Movable)).toBe(true);
      expect(world.hasTag(e, SnapTarget)).toBe(true);
    }
    expect(world.get(note, Stratum)).toEqual({ band: 2 }); // things, by default
    expect(world.get(pad, Stratum)).toEqual({ band: 0 }); // pads
    // the runtime behaviour rides equip exactly as on any widget
    expect(world.get(note, Rise.component)).toEqual({ lift: 0 });
  });

  it("a faceless widget gets no Stratum unless it declared one", () => {
    const { world, step, spawn } = rig();
    const card = spawn(CARD.type, 10, 10);
    const sheet = spawn(SHEET_CARD.type, 200, 10);
    step(2);
    expect(world.hasTag(card, WidgetEquipped)).toBe(true);
    expect(world.has(card, Stratum)).toBe(false);
    // a declared stratum rides along
    expect(world.get(sheet, Stratum)).toEqual({ band: 1 });
  });
});

describe("the cull — every widget is classified (design-015 §5.2; no mount store since D5b)", () => {
  it("culls an object and a faceless widget alike, and flips them back", () => {
    const { world, step, spawn } = rig();
    const note = spawn(NOTE.type, 10, 10);
    const card = spawn(CARD.type, 300, 10);
    step(3);
    expect(world.hasTag(note, Visible)).toBe(true);
    expect(world.hasTag(card, Visible)).toBe(true);

    // pan away: the cull flips both
    world.setResource(Camera, { x: 50_000, y: 50_000, zoom: 1, gesturing: false });
    step(2);
    expect(world.hasTag(note, Culled)).toBe(true);
    expect(world.hasTag(note, Visible)).toBe(false);
    expect(world.hasTag(card, Culled)).toBe(true);

    // and back
    world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    step(2);
    expect(world.hasTag(note, Visible)).toBe(true);
    expect(world.hasTag(card, Visible)).toBe(true);
  });
});
