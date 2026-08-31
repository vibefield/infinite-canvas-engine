/**
 * The declared presentation policy and the finalised Widget Surface contract
 * (design-012 §6.3 + §11 Q5/Q7; the design-005 `defineWidget` amendment S8
 * landed).
 *
 * Two things are pinned here. First, that a widget type can OPT OUT of the Q5
 * default and that the opt-out is refused when it names a mode the kind does
 * not have — a pin nobody can honour is worse than no pin, because it reads at
 * the call site as a guarantee. Second, that a `WidgetSurface` READS THROUGH to
 * its seams: a surface that snapshotted its presentation would answer about the
 * frame it was made in, which is exactly the frame a caller is not asking about.
 */
import { describe, expect, it } from "vitest";
import {
  createWidgetSurfaceView,
  defaultPresentationFor,
  defineWidget,
  presentationIsLegal,
  resolveSurfacePresentation,
  surfacePresentationDeclError,
  type Entity,
  type SurfaceDemand,
  type SurfacePresentation,
} from "../src";

describe("what a kind's modes are", () => {
  it("rests a dom surface in live-dom and a gl surface in composited", () => {
    // The Q5 default is a DOM answer: native caret, selection and threaded
    // scroll while the user reads and types. An island has no native paint to
    // rest into — its pixels are a texture in every mode it has.
    expect(defaultPresentationFor("dom")).toBe("live-dom");
    expect(defaultPresentationFor("gl")).toBe("composited");
    expect(defaultPresentationFor("video")).toBe("composited");
  });

  it("gives live-dom to dom surfaces and to nothing else", () => {
    expect(presentationIsLegal("dom", "live-dom")).toBe(true);
    expect(presentationIsLegal("gl", "live-dom")).toBe(false);
    expect(presentationIsLegal("video", "live-dom")).toBe(false);
    // Every kind can hold a retained picture — that is what a tray preview and
    // a far-zoom tier are, whatever produced the pixels.
    expect(presentationIsLegal("gl", "picture")).toBe(true);
  });
});

describe("resolving a declaration", () => {
  it("treats 'declared nothing' and 'declared the default' identically", () => {
    // Every widget on a board is in the first case. If the two resolved
    // differently, policy would need two paths through it.
    expect(resolveSurfacePresentation("dom", undefined)).toEqual({
      default: "live-dom",
      pin: undefined,
    });
    expect(resolveSurfacePresentation("dom", { default: "live-dom" })).toEqual({
      default: "live-dom",
      pin: undefined,
    });
  });

  it("makes a pin the starting mode as well as the fixed one", () => {
    // A pinned card must not spend its first frame in a mode it is pinned out
    // of and get corrected on its second.
    expect(resolveSurfacePresentation("dom", { pin: "composited" })).toEqual({
      default: "composited",
      pin: "composited",
    });
  });

  it("moves the starting mode without taking policy out of the decision", () => {
    const resolved = resolveSurfacePresentation("dom", { default: "composited" });
    expect(resolved.default).toBe("composited");
    expect(resolved.pin).toBeUndefined(); // still promotable and demotable
  });
});

describe("declarations that are refused", () => {
  it("refuses live-dom on a kind that has no native paint", () => {
    expect(surfacePresentationDeclError("gl", { pin: "live-dom" })).toContain(
      'presentation.pin is "live-dom"',
    );
    expect(surfacePresentationDeclError("gl", { default: "live-dom" })).toContain(
      'presentation.default is "live-dom"',
    );
    expect(surfacePresentationDeclError("dom", { pin: "live-dom" })).toBeNull();
  });

  it("refuses a default beside a pin — including a default that AGREES", () => {
    // The agreeing one is the trap: it reads at the call site as an intent
    // policy will honour, when the pin has already taken policy out of it.
    expect(surfacePresentationDeclError("dom", { pin: "composited", default: "composited" })).toContain(
      "drop the default",
    );
    expect(surfacePresentationDeclError("dom", { pin: "composited", default: "live-dom" })).toContain(
      "can never apply",
    );
  });
});

describe("defineWidget carries the declaration", () => {
  it("compiles the Q5 default for a widget that declares nothing", () => {
    const w = defineWidget({ type: "sp:plain", surface: "dom", component: null });
    expect(w.presentation).toEqual({ default: "live-dom", pin: undefined });
  });

  it("compiles a pin, and a gl widget's composited-only default", () => {
    const pinned = defineWidget({
      type: "sp:editor",
      surface: "dom",
      component: null,
      presentation: { pin: "live-dom" },
    });
    expect(pinned.presentation).toEqual({ default: "live-dom", pin: "live-dom" });

    const island = defineWidget({ type: "sp:island", surface: "gl", component: null });
    expect(island.presentation).toEqual({ default: "composited", pin: undefined });
  });

  it("THROWS at definition time rather than ignoring an impossible declaration", () => {
    // A definition error, not a warning: an ignored pin degrades into a
    // perfectly plausible widget that silently does not do what it says.
    expect(() =>
      defineWidget({
        type: "sp:bad-island",
        surface: "gl",
        component: null,
        presentation: { pin: "live-dom" },
      }),
    ).toThrow(/sp:bad-island.*live-dom/);
    expect(() =>
      defineWidget({
        type: "sp:bad-pair",
        surface: "dom",
        component: null,
        presentation: { pin: "composited", default: "live-dom" },
      }),
    ).toThrow(/can never apply/);
  });
});

describe("the WidgetSurface view", () => {
  const ENTITY = 7 as Entity;
  const LIVE: SurfaceDemand = { mode: "live", fpsBucket: 60, interactive: false };

  it("reads presentation THROUGH the seam, never a snapshot", () => {
    let mode: SurfacePresentation = "live-dom";
    const view = createWidgetSurfaceView({
      kindOf: () => "dom",
      presentationOf: () => mode,
      demandOf: () => LIVE,
    });
    const surface = view.get(ENTITY);
    expect(surface?.presentation).toBe("live-dom");
    mode = "composited"; // a promotion, one flush later
    expect(surface?.presentation).toBe("composited");
  });

  it("answers undefined for an entity that is not a widget", () => {
    const view = createWidgetSurfaceView({
      kindOf: () => undefined,
      presentationOf: () => "live-dom",
      demandOf: () => LIVE,
    });
    expect(view.get(ENTITY)).toBeUndefined();
  });

  it("REFUSES setDemand when the profile wired no consumer", () => {
    // The alternative is a setter that accepts and forgets, which is how a
    // throttle that was never installed reads as a throttle that is not working.
    const view = createWidgetSurfaceView({
      kindOf: () => "dom",
      presentationOf: () => "live-dom",
      demandOf: () => LIVE,
    });
    expect(() => view.get(ENTITY)?.setDemand(LIVE)).toThrow(/no demand consumer/);
  });

  it("routes a request to the consumer the profile did wire", () => {
    const seen: Array<[Entity, SurfaceDemand]> = [];
    const view = createWidgetSurfaceView({
      kindOf: () => "dom",
      presentationOf: () => "live-dom",
      demandOf: () => LIVE,
      requestDemand: (entity, demand) => seen.push([entity, demand]),
    });
    const paused: SurfaceDemand = { mode: "paused", fpsBucket: 0, interactive: false };
    view.get(ENTITY)?.setDemand(paused);
    expect(seen).toEqual([[ENTITY, paused]]);
  });
});
