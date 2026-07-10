/**
 * M7 exit (gl-board): the real L0 DOM adapter threads the router verdict onto
 * the input fact. `attachPointerAdapter(host, queue, { glRoute })` runs `glRoute`
 * on `pointerdown`; a true verdict flags the down `surfaceHandled` (recognizers
 * skip it via HandledByWidget) — the SAME opt-out contract as a native
 * interactive. A false verdict leaves the fact unflagged (absent, not `false`).
 *
 * happy-dom has no PointerEvent constructor — synthesize a bubbling Event with
 * the fields the adapter reads (same pattern as the @ice/dom adapter tests).
 */
import { createInputQueue } from "@ice/core";
import { type GLRoute, attachPointerAdapter, createCanvasHost } from "@ice/dom";
import { describe, expect, it } from "vitest";

function fire(target: EventTarget, type: string, props: Record<string, unknown>): Event {
  const ev = new Event(type, { cancelable: true, bubbles: true });
  Object.assign(ev, props);
  target.dispatchEvent(ev);
  return ev;
}

const DOWN = { pointerType: "mouse", pointerId: 1, clientX: 30, clientY: 30, buttons: 1 };

function setup(glRoute: GLRoute) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const host = createCanvasHost(container);
  const queue = createInputQueue();
  const detach = attachPointerAdapter(host, queue, { glRoute });
  return {
    container,
    queue,
    teardown: () => {
      detach();
      container.remove();
    },
  };
}

describe("gl-board M7 exit: adapter flags surfaceHandled through the real DOM adapter", () => {
  it("flags the down fact when the GL router claims the event", () => {
    const calls: Array<[string, number, number]> = [];
    const glRoute: GLRoute = (kind, x, y) => {
      calls.push([kind, x, y]);
      return true;
    };
    const { container, queue, teardown } = setup(glRoute);

    fire(container, "pointerdown", DOWN);
    const down = queue.drain()[0];
    expect(down?.kind).toBe("down");
    expect(down?.surfaceHandled).toBe(true);
    expect(calls).toEqual([["down", 30, 30]]); // adapter forwards container-relative CSS px
    teardown();
  });

  it("leaves the down unflagged when the GL router declines (undefined, not false)", () => {
    const glRoute: GLRoute = () => false;
    const { container, queue, teardown } = setup(glRoute);

    fire(container, "pointerdown", DOWN);
    const down = queue.drain()[0];
    expect(down?.kind).toBe("down");
    expect(down?.surfaceHandled).toBeUndefined();
    teardown();
  });
});
