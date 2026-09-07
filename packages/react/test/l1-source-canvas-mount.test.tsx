/**
 * The L1 SOURCE CANVAS at the mount (design-013 §8 B4, R2/R4).
 *
 * Three facts, all of them structural — this file never imports `@ice/ground`
 * (the wall forbids it) and builds the handle by hand, exactly as the profile
 * tests do:
 *
 *  1. the canvas is built IFF the ground's handle carries the adapter's
 *     effects. No handle, an old-leg handle, or a handle whose
 *     `compose.sourceCanvas` is null (a host without the origin trial) ⇒ no L1,
 *     no `layoutsubtree`, and every card stays on the content plane;
 *  2. it is the FACADE's: appended to the container, sized from the same
 *     `getBoundingClientRect` the `Viewport` resource is written from, and
 *     removed on unmount (a StrictMode remount must not stack two);
 *  3. `hostsBeforeRoster` flips the roster order — the dom host reflector runs
 *     BEFORE the profile's reflectors, so a promotion is reparented in the
 *     same flush the render copies from.
 */
import { createCanvasEngine, type ReflectorDef } from "@ice/core";
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InfiniteCanvas } from "../src";
import type { PresentationProfile } from "../src/profiles/contract";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let mountEl: HTMLElement | undefined;
afterEach(() => {
  if (root !== undefined) act(() => root?.unmount());
  mountEl?.remove();
  root = undefined;
  mountEl = undefined;
  vi.restoreAllMocks();
});

function mount(node: Parameters<Root["render"]>[0]): HTMLElement {
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 1 as unknown as number);
  vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
  mountEl = document.createElement("div");
  document.body.appendChild(mountEl);
  root = createRoot(mountEl);
  act(() => root?.render(node));
  return mountEl;
}

/** The adapter's three effects, faked — the attribute is what the test reads back. */
const effects = {
  markAsSourceCanvas: (canvas: HTMLCanvasElement) => canvas.setAttribute("layoutsubtree", ""),
  onPaint: () => () => {},
  changedElements: () => [] as readonly Element[],
};

interface GroundParts {
  /** null ⇒ the host has no HTML-in-Canvas; undefined ⇒ an old-leg handle with no `compose` at all. */
  readonly sourceCanvas?: { effects: typeof effects; onDirty(hosts: readonly Element[]): void } | null;
  readonly roster?: readonly ReflectorDef[];
}

function groundOf(parts: GroundParts, log: string[]) {
  return (ctx: { host: { container: HTMLElement; contentPlane: HTMLElement } }) => {
    const canvas = ctx.host.container.ownerDocument.createElement("canvas");
    ctx.host.container.insertBefore(canvas, ctx.host.contentPlane);
    return {
      reflector: { name: "ground", always: false, flush() { log.push("ground"); }, available: () => true },
      configureGrid() {},
      dispose() { canvas.remove(); },
      ...(parts.sourceCanvas === undefined ? {} : { compose: { sourceCanvas: parts.sourceCanvas } }),
    };
  };
}

const profileOf = (roster: readonly ReflectorDef[], hostsBeforeRoster: boolean): PresentationProfile => ({
  name: "composited",
  hostsBeforeRoster,
  check: () => null,
  reflectorsAfterGround: () => roster,
});

const l1Of = (el: HTMLElement): HTMLCanvasElement | null => el.querySelector("canvas[data-ice-source-canvas]");

describe("the L1 source canvas at the mount (B4)", () => {
  it("is built when the ground's handle carries the adapter's effects, and marked layoutsubtree", () => {
    const engine = createCanvasEngine();
    const el = mount(createElement(InfiniteCanvas, { engine, ground: groundOf({ sourceCanvas: { effects, onDirty() {} } }, []) as never }));
    const l1 = l1Of(el);
    expect(l1).toBeTruthy();
    expect(l1?.hasAttribute("layoutsubtree")).toBe(true);
    // A mixed board: `dom`-target cards live under this canvas, so it must not
    // take their hits (the hosts it adopts opt back in).
    expect(l1?.style.pointerEvents).toBe("none");
  });

  it("is NOT built when the host has no HTML-in-Canvas (`sourceCanvas: null`), and not for an old-leg handle", () => {
    const engine = createCanvasEngine();
    const el = mount(createElement(InfiniteCanvas, { engine, ground: groundOf({ sourceCanvas: null }, []) as never }));
    expect(l1Of(el)).toBeNull();
    act(() => root?.unmount());
    root = undefined;

    const engine2 = createCanvasEngine();
    const el2 = mount(createElement(InfiniteCanvas, { engine: engine2, ground: groundOf({}, []) as never }));
    expect(l1Of(el2)).toBeNull();
  });

  it("is not built at all without a ground prop", () => {
    const engine = createCanvasEngine();
    const el = mount(createElement(InfiniteCanvas, { engine }));
    expect(l1Of(el)).toBeNull();
  });

  it("is the facade's to reap: a StrictMode remount leaves exactly one, and unmount leaves none", () => {
    const engine = createCanvasEngine();
    const el = mount(createElement(StrictMode, null, createElement(InfiniteCanvas, { engine, ground: groundOf({ sourceCanvas: { effects, onDirty() {} } }, []) as never })));
    expect(el.querySelectorAll("canvas[data-ice-source-canvas]")).toHaveLength(1);
    act(() => root?.unmount());
    root = undefined;
    expect(el.querySelectorAll("canvas[data-ice-source-canvas]")).toHaveLength(0);
  });

  it("`hostsBeforeRoster` puts the dom host reflector BEFORE the profile's roster — and only for a profile that asks", () => {
    const order: string[] = [];
    const roster: ReflectorDef[] = [{ name: "dom-render", always: true, flush() { order.push("dom-render"); } }];
    const engine = createCanvasEngine();
    const seen: string[] = [];
    const el = mount(
      createElement(InfiniteCanvas, {
        engine,
        ground: groundOf({ sourceCanvas: { effects, onDirty() {} }, roster }, seen) as never,
        profile: profileOf(roster, true),
      }),
    );
    expect(l1Of(el)).toBeTruthy();
    const names = engine.engine.reflectorNames();
    expect(names.indexOf("domWidgets")).toBeLessThan(names.indexOf("dom-render"));

    act(() => root?.unmount());
    root = undefined;
    const engine2 = createCanvasEngine();
    mount(
      createElement(InfiniteCanvas, {
        engine: engine2,
        ground: groundOf({ sourceCanvas: { effects, onDirty() {} }, roster }, seen) as never,
        profile: profileOf(roster, false),
      }),
    );
    const names2 = engine2.engine.reflectorNames();
    expect(names2.indexOf("domWidgets")).toBeGreaterThan(names2.indexOf("dom-render"));
    expect(order).toEqual([]); // nothing flushed: rAF is stubbed out
  });
});
