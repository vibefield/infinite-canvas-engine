/**
 * THE MIGRATION off `defineWidget({ presentation })`, and the Widget Surface
 * contract that outlived it (design-013 §0, §5, A1b; design-012 §6/§11 Q7).
 *
 * This file used to grade the declared presentation policy: a three-valued
 * `SurfacePresentation`, a `default`/`pin` declaration, and the resolver that
 * refused impossible pairs. All of that is DELETED — where a card presents is
 * a world fact with one writer, and which layer a KIND wants is a behaviour.
 * So the cases here are the ones that replace it:
 *
 *  - a definition that declares nothing gets its kind's default behaviour, so
 *    the ratified default is not something an app can forget to wire;
 *  - a definition that named its own gets ONLY its own, because two writers of
 *    one entity's `SurfaceTarget` is the class §5's table forbids;
 *  - the retired field THROWS rather than being ignored, because an ignored
 *    pin degrades into a perfectly plausible widget that silently does not do
 *    what it says.
 *
 * The `WidgetSurface` view cases survive unchanged in substance: a surface that
 * snapshotted its target would answer about the frame it was made in, which is
 * exactly the frame a caller is not asking about.
 */
import { describe, expect, it } from "vitest";
import {
  alwaysDom,
  alwaysGpu,
  createWidgetSurfaceView,
  defineBehavior,
  defineWidget,
  domAtRest,
  SurfaceTarget,
  type Entity,
  type SurfaceDemandValue,
} from "../src";

/** The behaviours a compiled type pre-attaches, by name. */
const attached = (w: { behaviors: readonly { behavior: { name: string } }[] }): string[] =>
  w.behaviors.map((b) => b.behavior.name);

describe("the kind's default behaviour, when a definition declares nothing", () => {
  it("gives a dom widget domAtRest — live DOM at rest, GPU on a gesture", () => {
    const w = defineWidget({ type: "sp:plain", surface: "dom", component: null });
    expect(attached(w)).toEqual([domAtRest.name]);
  });

  it("gives a gl widget alwaysGpu, the only mode its kind has", () => {
    const w = defineWidget({ type: "sp:island", surface: "gl", component: null });
    expect(attached(w)).toEqual([alwaysGpu.name]);
  });

  it("leaves a definition's OTHER behaviours alone and appends beside them", () => {
    const Note = defineBehavior("sp:note", { store: "runtime", schema: {} });
    const w = defineWidget({ type: "sp:withNote", surface: "dom", component: null, behaviors: [Note] });
    expect(attached(w)).toEqual(["sp:note", domAtRest.name]);
  });
});

describe("a definition that chose for itself", () => {
  it("is not given a second one — alwaysDom suppresses the dom default", () => {
    const w = defineWidget({ type: "sp:pinnedDom", surface: "dom", component: null, behaviors: [alwaysDom] });
    expect(attached(w)).toEqual([alwaysDom.name]);
  });

  it("keeps the data on a .with() form (the old `picture`)", () => {
    const w = defineWidget({
      type: "sp:picture",
      surface: "dom",
      component: null,
      behaviors: [alwaysGpu.with({ paused: true })],
    });
    expect(attached(w)).toEqual([alwaysGpu.name]);
    expect(w.behaviors[0]?.data).toEqual({ paused: true });
  });

  it("suppresses the default for a PACK's own kind behaviour, not just ice:surface.*", () => {
    // design-013 §0's whole point is that a kind may write its own behaviour.
    // Appending `domAtRest` beside one would put TWO writers on one entity's
    // `SurfaceTarget`, which §5's table forbids — so the question the check
    // asks is "does anything here already own the target", and a behaviour
    // that declares `SurfaceTarget` in its `writes:` answers yes.
    const Kiosk = defineBehavior("sppack:surface.kiosk", {
      store: "runtime",
      phase: "present",
      schema: {},
      writes: [SurfaceTarget],
      on: { init() {} },
    });
    const w = defineWidget({ type: "sp:kiosk", surface: "dom", component: null, behaviors: [Kiosk] });
    expect(attached(w)).toEqual(["sppack:surface.kiosk"]);
  });
});

describe("two writers of one target", () => {
  it("REFUSES two standard behaviours on one type, naming both", () => {
    // This was ACCEPTED. `defineWidget` asked "did anything choose?" with
    // `.some()`, so a list that chose TWICE satisfied it and both behaviours
    // were attached — each writing `SurfaceTarget` in `present`, on the same
    // rows, every frame. Strata's same-phase writer-pair advisory is the thing
    // that reports exactly this, and the compiler's `orderIndependent`
    // attestation for the standard three silences it, so the pair was quiet as
    // well as wrong: the card's target was whichever behaviour ran last.
    expect(() =>
      defineWidget({
        type: "sp:twoStandard",
        surface: "dom",
        component: null,
        behaviors: [alwaysDom, alwaysGpu],
      }),
    ).toThrow(/2 behaviors that write SurfaceTarget/);
    expect(() =>
      defineWidget({
        type: "sp:twoStandard2",
        surface: "dom",
        component: null,
        behaviors: [alwaysDom, alwaysGpu],
      }),
    ).toThrow(/"ice:surface\.alwaysDom", "ice:surface\.alwaysGpu"/);
  });

  it("REFUSES a pack's kind behaviour beside a standard one", () => {
    // The mixed pair is the likelier accident: an app adds its own kiosk
    // behaviour to a type that already pins `alwaysGpu`, and neither door says
    // anything. A pack co-writer is unattested, so strata WOULD warn at
    // registration — but a runtime advisory is not where this belongs, and the
    // definition is where the author can act on it.
    const Kiosk = defineBehavior("sppack:surface.kiosk2", {
      store: "runtime",
      phase: "present",
      schema: {},
      writes: [SurfaceTarget],
      on: { init() {} },
    });
    expect(() =>
      defineWidget({
        type: "sp:mixedPair",
        surface: "dom",
        component: null,
        behaviors: [Kiosk, alwaysGpu],
      }),
    ).toThrow(/an entity has ONE kind/);
  });

  it("still accepts ONE target writer beside any number of other behaviours", () => {
    // The refusal counts target WRITERS, not behaviours — a type may carry as
    // many ordinary behaviours as it likes, and the default is still suppressed
    // by the one chooser among them.
    const NoteA = defineBehavior("sp:noteA", { store: "runtime", schema: {} });
    const NoteB = defineBehavior("sp:noteB", { store: "runtime", schema: {} });
    const w = defineWidget({
      type: "sp:oneWriterManyNotes",
      surface: "dom",
      component: null,
      behaviors: [NoteA, alwaysGpu, NoteB],
    });
    expect(attached(w)).toEqual(["sp:noteA", alwaysGpu.name, "sp:noteB"]);
  });
});

describe("the retired declaration", () => {
  it("THROWS, naming the door that replaced it", () => {
    // TypeScript already refuses the field; this is the JS caller and the
    // stale build, which would otherwise pass an object nothing reads and get
    // a card that silently ignores its own pin.
    expect(() =>
      defineWidget({
        type: "sp:legacy",
        surface: "dom",
        component: null,
        presentation: { pin: "live-dom" },
      } as never),
    ).toThrow(/presentation is retired \(design-013 A1\)/);
    expect(() =>
      defineWidget({
        type: "sp:legacy2",
        surface: "gl",
        component: null,
        presentation: { default: "picture" },
      } as never),
    ).toThrow(/alwaysGpu\.with\(\{ paused: true \}\) through behaviors:/);
  });
});

describe("the WidgetSurface view", () => {
  const ENTITY = 7 as Entity;
  const LIVE: SurfaceDemandValue = { mode: "live", fpsBucket: 60, interactive: false };

  it("reads the target THROUGH the seam, never a snapshot", () => {
    let target: "dom" | "gpu" = "dom";
    const view = createWidgetSurfaceView({
      kindOf: () => "dom",
      targetOf: () => target,
      demandOf: () => LIVE,
    });
    const surface = view.get(ENTITY);
    expect(surface?.target).toBe("dom");
    target = "gpu"; // a promotion, one frame later
    expect(surface?.target).toBe("gpu");
  });

  it("answers undefined for an entity that is not a widget", () => {
    const view = createWidgetSurfaceView({
      kindOf: () => undefined,
      targetOf: () => "dom",
      demandOf: () => LIVE,
    });
    expect(view.get(ENTITY)).toBeUndefined();
  });

  it("REFUSES setDemand when the profile wired no consumer", () => {
    // The alternative is a setter that accepts and forgets, which is how a
    // throttle that was never installed reads as a throttle that is not working.
    const view = createWidgetSurfaceView({
      kindOf: () => "dom",
      targetOf: () => "dom",
      demandOf: () => LIVE,
    });
    expect(() => view.get(ENTITY)?.setDemand(LIVE)).toThrow(/no demand consumer/);
  });

  it("routes a request to the consumer the profile did wire", () => {
    const seen: Array<[Entity, SurfaceDemandValue]> = [];
    const view = createWidgetSurfaceView({
      kindOf: () => "dom",
      targetOf: () => "dom",
      demandOf: () => LIVE,
      requestDemand: (entity, demand) => seen.push([entity, demand]),
    });
    const paused: SurfaceDemandValue = { mode: "paused", fpsBucket: 0, interactive: false };
    view.get(ENTITY)?.setDemand(paused);
    expect(seen).toEqual([[ENTITY, paused]]);
  });
});
