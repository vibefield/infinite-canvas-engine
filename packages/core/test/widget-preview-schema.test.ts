/**
 * defineWidget `preview` declaration (design-005 §2 amendment, 2026-07-19):
 * three tiers normalized onto WidgetType — bare component, options with
 * curated props, both — with unknown previewProps names failing at
 * DEFINITION time (a typo must not surface as a silent placeholder inside
 * the preview host's error boundary).
 */
import { describe, expect, it } from "vitest";
import { defineWidget, p, widgets } from "../src";

describe("defineWidget preview declaration", () => {
  it("bare component form → previewComponent, no props", () => {
    const C = (): null => null;
    const w =
      widgets.get("pv:bare") ??
      defineWidget({ type: "pv:bare", surface: "dom", component: null, defaultSize: { w: 100, h: 80 }, preview: C });
    expect(w.previewComponent).toBe(C);
    expect(w.previewProps).toBeUndefined();
  });

  it("props-only form curates the default real-component mount", () => {
    const w =
      widgets.get("pv:props") ??
      defineWidget({
        type: "pv:props",
        surface: "dom",
        component: null,
        props: { label: p.string({ default: "x" }) },
        defaultSize: { w: 100, h: 80 },
        preview: { props: { label: "hello" } },
      });
    expect(w.previewComponent).toBeNull();
    expect(w.previewProps).toEqual({ label: "hello" });
  });

  it("component + props form carries both", () => {
    const C = (): null => null;
    const w =
      widgets.get("pv:both") ??
      defineWidget({
        type: "pv:both",
        surface: "dom",
        component: null,
        props: { label: p.string({ default: "x" }) },
        defaultSize: { w: 100, h: 80 },
        preview: { component: C, props: { label: "y" } },
      });
    expect(w.previewComponent).toBe(C);
    expect(w.previewProps).toEqual({ label: "y" });
  });

  it("exotic components (objects carrying $$typeof — memo/forwardRef) are components, not options", () => {
    const exotic = { $$typeof: Symbol.for("react.memo") };
    const w =
      widgets.get("pv:exotic") ??
      defineWidget({ type: "pv:exotic", surface: "dom", component: null, defaultSize: { w: 100, h: 80 }, preview: exotic });
    expect(w.previewComponent).toBe(exotic);
  });

  it("unknown preview.props name throws at definition time", () => {
    expect(() =>
      defineWidget({
        type: "pv:bad",
        surface: "dom",
        component: null,
        props: { label: p.string({ default: "x" }) },
        defaultSize: { w: 100, h: 80 },
        preview: { props: { nope: 1 } },
      }),
    ).toThrow(/unknown prop "nope"/);
  });

  it("absent preview normalizes to null (the sandbox-default tier)", () => {
    const w =
      widgets.get("pv:none") ??
      defineWidget({ type: "pv:none", surface: "dom", component: null, defaultSize: { w: 100, h: 80 } });
    expect(w.previewComponent).toBeNull();
    expect(w.previewProps).toBeUndefined();
  });
});
