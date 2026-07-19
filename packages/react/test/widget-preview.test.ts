/**
 * <WidgetPreview> — the framework preview host (design-005 §2 amendment):
 * fallback chain (declared → dom sandbox mount with curated props →
 * fallback), inert non-interactive stage, aspect-fit scaling, and error
 * containment (a throwing preview shows the fallback, never crashes the
 * palette).
 */
import { defineWidget, p, widgets } from "@ice/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WidgetPreview, setPreviewSnapshot, useWidgetProps, type WidgetComponentProps } from "../src";
import { __resetPreviewSnapshotsForTests } from "../src/preview-snapshots";
import { __resetPreviewSandboxForTests } from "../src/widget-preview";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function DeclaredPreview() {
  return createElement("div", { "data-declared": "" }, "MOCK");
}
function BoomPreview(): never {
  throw new Error("boom");
}
function RealView({ entity, world }: WidgetComponentProps) {
  const props = useWidgetProps<{ label: string }>(world, entity, "pvh:real");
  return createElement("div", { "data-real": "" }, props?.label ?? "");
}

const DECLARED =
  widgets.get("pvh:declared") ??
  defineWidget({
    type: "pvh:declared",
    surface: "dom",
    component: null,
    defaultSize: { w: 200, h: 100 },
    preview: DeclaredPreview,
  });
widgets.get("pvh:real") ??
  defineWidget({
    type: "pvh:real",
    surface: "dom",
    component: RealView,
    props: { label: p.string({ default: "default" }) },
    defaultSize: { w: 100, h: 100 },
    preview: { props: { label: "curated" } },
  });
widgets.get("pvh:boom") ??
  defineWidget({
    type: "pvh:boom",
    surface: "dom",
    component: null,
    defaultSize: { w: 100, h: 100 },
    preview: BoomPreview,
  });
widgets.get("pvh:gl") ??
  defineWidget({ type: "pvh:gl", surface: "gl", component: null, defaultSize: { w: 100, h: 100 } });

let root: Root | null = null;
let host: HTMLElement | null = null;

function render(el: ReturnType<typeof createElement>): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(el));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  __resetPreviewSandboxForTests();
  __resetPreviewSnapshotsForTests();
});

describe("WidgetPreview", () => {
  it("renders a DECLARED preview, inert, aspect-fitted into the box", () => {
    expect(DECLARED.previewComponent).toBe(DeclaredPreview);
    const el = render(createElement(WidgetPreview, { type: "pvh:declared", width: 100, height: 100 }));
    const declared = el.querySelector("[data-declared]");
    expect(declared).not.toBeNull();
    expect(declared?.closest("[inert]")).not.toBeNull(); // non-interactive by contract
    // 200×100 fitted into 100×100 → 100×50 outer box.
    const outer = el.firstElementChild as HTMLElement;
    expect(outer.style.width).toBe("100px");
    expect(outer.style.height).toBe("50px");
  });

  it("dom surface without a declaration mounts the REAL component with curated props", () => {
    const el = render(createElement(WidgetPreview, { type: "pvh:real", width: 80, height: 80 }));
    const real = el.querySelector("[data-real]");
    expect(real).not.toBeNull();
    expect(real?.textContent).toBe("curated"); // preview.props flowed through the sandbox spawn
    expect(real?.closest("[inert]")).not.toBeNull();
  });

  it("a THROWING preview degrades to the fallback — the palette survives", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const el = render(
      createElement(WidgetPreview, {
        type: "pvh:boom",
        width: 100,
        height: 100,
        fallback: createElement("div", { "data-fb": "" }),
      }),
    );
    expect(el.querySelector("[data-fb]")).not.toBeNull();
    warn.mockRestore();
    err.mockRestore();
  });

  it("a landed GL snapshot renders the snapshot layer (and beats the fallback)", () => {
    const fakeCapture = document.createElement("canvas");
    fakeCapture.width = 64;
    fakeCapture.height = 64;
    setPreviewSnapshot("pvh:gl", fakeCapture); // the P2 capture seam — no GPU needed
    const el = render(
      createElement(WidgetPreview, {
        type: "pvh:gl",
        width: 100,
        height: 100,
        fallback: createElement("div", { "data-fb": "" }),
      }),
    );
    expect(el.querySelector("[data-preview-snapshot]")).not.toBeNull();
    expect(el.querySelector("[data-fb]")).toBeNull();
    expect(el.querySelector("[data-preview-snapshot]")?.closest("[inert]")).not.toBeNull();
  });

  it("gl surface without a declaration renders the fallback (until a capture lands)", () => {
    const el = render(
      createElement(WidgetPreview, {
        type: "pvh:gl",
        width: 100,
        height: 100,
        fallback: createElement("div", { "data-fb": "" }),
      }),
    );
    expect(el.querySelector("[data-fb]")).not.toBeNull();
  });

  it("unknown type renders the fallback", () => {
    const el = render(
      createElement(WidgetPreview, {
        type: "pvh:nope",
        width: 100,
        height: 100,
        fallback: createElement("div", { "data-fb": "" }),
      }),
    );
    expect(el.querySelector("[data-fb]")).not.toBeNull();
  });
});
