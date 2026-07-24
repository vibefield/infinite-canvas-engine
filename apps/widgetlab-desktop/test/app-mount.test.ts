/**
 * App mount smoke (headless): <App/> must render its chrome without throwing.
 * The GL <Canvas> portal is browser-only (no WebGL here), but every crash
 * BEFORE the portal — engine construction, InfiniteCanvas mount, panels,
 * onReady bridge/router — reproduces under happy-dom exactly.
 */
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("widgetlab app mount", () => {
  it("renders the shell chrome without throwing", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(App));
    });
    expect(container.querySelector('button[title="Settings"]')).not.toBeNull();
  });
});
