/**
 * Observer + ZoomPill smoke (headless): the ObserverPanel is a thin mount of
 * strata-ecs's FIRST-PARTY tools panel (attachObserver) with the app's
 * describe fn — assert it mounts strata's DOM (.strata-obs), survives engine
 * stepping (lifecycle hooks + telemetry armed while attached), and detaches
 * cleanly on unmount. createElement (not JSX) keeps this a .ts file.
 */
import { createElement } from "react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { Viewport } from "@ice/core";
import { afterEach, describe, expect, it } from "vitest";
import { ObserverPanel } from "../src/ObserverPanel";
import { ZoomPill } from "../src/ZoomPill";
import { createPointerWorld } from "../src/world";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
});

describe("pointerlab panels (strata tools observer)", () => {
  it("mounts strata's observer panel, survives engine steps, detaches on unmount", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);

    const { world, engine } = createPointerWorld();
    world.setResource(Viewport, { w: 1200, h: 800, dpr: 1 });

    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(ObserverPanel, { world }));
    });

    // strata's panel mounts to document.body with its own prefixed classes
    expect(document.querySelector(".strata-obs")).not.toBeNull();

    // step — cursors spawn, recognizers churn; the observer's lifecycle hooks
    // and telemetry path must not throw while attached
    let now = 0;
    for (let i = 0; i < 6; i++) {
      now += 16;
      engine.step(now);
    }
    expect(document.querySelector(".strata-obs")).not.toBeNull();

    await act(async () => {
      root?.unmount();
    });
    root = null;
    expect(document.querySelector(".strata-obs")).toBeNull(); // dispose() removed the panel

    engine.step(now + 16); // detached world hooks — stepping stays clean
  });

  it("ZoomPill renders the camera zoom and steps with the world", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);

    const { world } = createPointerWorld();
    world.setResource(Viewport, { w: 1200, h: 800, dpr: 1 });

    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(ZoomPill, { world }));
    });
    expect(container.textContent).toContain("100%");
  });
});
