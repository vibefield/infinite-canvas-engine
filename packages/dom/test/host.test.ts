/**
 * Canvas host (design-004 §1; screen-space only since design-015 D5b): container styling and a
 * dispose that unwinds what it wrote. The camera-transformed content plane it used to mount is
 * gone — no DOM element carries a camera transform (design-015 §2 law 2).
 */
import { describe, expect, it } from "vitest";
import { createCanvasHost } from "../src/host";

describe("createCanvasHost", () => {
  it("styles the container as a gesture-clean viewport and mounts NOTHING in it", () => {
    const container = document.createElement("div");
    const host = createCanvasHost(container);

    expect(container.style.position).toBe("relative");
    expect(container.style.overflow).toBe("hidden");
    expect(container.style.touchAction).toBe("none");
    expect(container.style.userSelect).toBe("none");
    expect(container.children).toHaveLength(0); // no content plane: nothing under the camera is DOM
    expect(host.container).toBe(container);
  });

  it("clears its container styles on dispose", () => {
    const container = document.createElement("div");
    const host = createCanvasHost(container);
    host.dispose();

    expect(container.style.position).toBe("");
    expect(container.style.touchAction).toBe("");
  });

  it("keeps an already-positioned container's positioning (the inset-sized #app pattern)", () => {
    // Regression: stomping `position: absolute` with inline `relative` collapses
    // an `inset: 0`-sized container to zero height — overflow:hidden then clips
    // the whole scene (the graybox demo's black screen).
    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.inset = "0";

    const host = createCanvasHost(container);
    expect(container.style.position).toBe("absolute");
    expect(container.style.overflow).toBe("hidden");

    // Dispose must not strip the app's own positioning either.
    host.dispose();
    expect(container.style.position).toBe("absolute");
  });

  it("restores a caller's pre-existing inline container style on dispose", () => {
    // Regression: dispose blanket-cleared its owned properties, destroying any
    // inline value the caller set on the same property (here overflow:auto).
    const container = document.createElement("div");
    container.style.overflow = "auto";

    const host = createCanvasHost(container);
    expect(container.style.overflow).toBe("hidden"); // host takes over while mounted

    host.dispose();
    expect(container.style.overflow).toBe("auto"); // caller's value restored, not cleared
  });
});
