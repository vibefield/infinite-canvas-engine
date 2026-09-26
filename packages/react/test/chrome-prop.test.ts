/**
 * `<InfiniteCanvas chrome>` (design-015 §7, D2a-world — plan D-D0.6): the one react change of the
 * desk's first world slice. Default true: the P4 DOM chrome reflector is registered and its plane
 * inserted, byte for byte the mount before this prop. `chrome={false}`: no chrome reflector in the
 * roster and no chrome plane in the container — the desk draws its own selection on the GPU.
 * Every other reflector is where it was, and the unmount tears down cleanly either way.
 */
import { createCanvasEngine, type CanvasEngine } from "@ice/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { InfiniteCanvas } from "../src";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) {
    try { c(); } catch { /* best-effort */ }
  }
  document.body.innerHTML = "";
});

function mount(engine: CanvasEngine, props: { chrome?: boolean }): { el: HTMLElement; root: Root } {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  cleanups.push(() => act(() => root.unmount()));
  act(() => { root.render(createElement(InfiniteCanvas, { engine, ...props })); });
  return { el, root };
}

/** The chrome plane is the one host child that is neither the content plane, the lifted plane nor the remote-cursors plane: the div the chrome reflector appends. */
const planeCount = (el: HTMLElement): number => el.querySelector("[data-ice-canvas]")?.childElementCount ?? -1;

describe("<InfiniteCanvas chrome>", () => {
  it("default: the chrome reflector is in the roster (today's mount)", () => {
    const engine = createCanvasEngine();
    engine.docs.create();
    cleanups.push(() => engine.dispose());
    const { el } = mount(engine, {});
    const roster = engine.engine.reflectorNames();
    expect(roster).toContain("chrome");
    const withChrome = planeCount(el);
    act(() => { engine.step(16); });
    for (const c of cleanups.splice(0)) c();
    // chrome={false}: no chrome reflector, one plane fewer, the rest of the roster exactly as it was
    const engine2 = createCanvasEngine();
    engine2.docs.create();
    cleanups.push(() => engine2.dispose());
    const { el: el2 } = mount(engine2, { chrome: false });
    const roster2 = engine2.engine.reflectorNames();
    expect(roster2).not.toContain("chrome");
    expect(roster2).toEqual(roster.filter((n) => n !== "chrome"));
    expect(roster2.length).toBe(roster.length - 1);
    expect(planeCount(el2)).toBe(withChrome - 1);
    act(() => { engine2.step(16); });
    expect(engine2.engine.reflectorNames()).not.toContain("chrome");
  });

  it("chrome={true} is the default spelled out", () => {
    const engine = createCanvasEngine();
    engine.docs.create();
    cleanups.push(() => engine.dispose());
    mount(engine, { chrome: true });
    expect(engine.engine.reflectorNames()).toContain("chrome");
  });
});
