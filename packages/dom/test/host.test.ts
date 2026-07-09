/**
 * Canvas host (design-004 §1; M3 slice): container styling, one transform-ready
 * content plane, and a dispose that unwinds what it created.
 */
import { describe, expect, it } from "vitest";
import { createCanvasHost } from "../src/host";

describe("createCanvasHost", () => {
  it("styles the container and mounts one transform-ready content plane", () => {
    const container = document.createElement("div");
    const host = createCanvasHost(container);

    expect(container.style.position).toBe("relative");
    expect(container.style.overflow).toBe("hidden");
    expect(container.style.touchAction).toBe("none");
    expect(container.style.userSelect).toBe("none");

    expect(host.contentPlane.parentElement).toBe(container);
    expect(host.contentPlane.style.position).toBe("absolute");
    expect(host.contentPlane.style.transformOrigin).toBe("0 0");
    expect(host.contentPlane.style.willChange).toBe("transform");
  });

  it("removes the plane and clears its container styles on dispose", () => {
    const container = document.createElement("div");
    const host = createCanvasHost(container);
    host.dispose();

    expect(host.contentPlane.parentElement).toBeNull();
    expect(container.style.position).toBe("");
    expect(container.style.touchAction).toBe("");
  });
});
