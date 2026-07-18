/**
 * Widget opt-out at the L0 adapter (the pinned widget-event contract, design-002
 * §8 / design-004 §4). A `pointerdown` that crosses a native interactive or an
 * explicit `[data-canvas-interactive]` flags the down fact `surfaceHandled: true`
 * (fact still lands; recognizers skip). A `stopPropagation()` before the container
 * is the OTHER boundary: the event never reaches the adapter, so no fact is made.
 */
import { createInputQueue } from "@ice/core";
import { describe, expect, it } from "vitest";
import { createCanvasHost } from "../src/host";
import { attachPointerAdapter } from "../src/pointer-adapter";

function setup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const host = createCanvasHost(container);
  const queue = createInputQueue();
  const detach = attachPointerAdapter(host, queue);
  return { container, host, queue, detach };
}

/** Dispatch a synthetic bubbling event with assigned props (happy-dom has no PointerEvent ctor). */
function fire(target: EventTarget, type: string, props: Record<string, unknown>): Event {
  const ev = new Event(type, { cancelable: true, bubbles: true });
  Object.assign(ev, props);
  target.dispatchEvent(ev);
  return ev;
}

const DOWN = { pointerType: "mouse", pointerId: 1, clientX: 5, clientY: 5, buttons: 1 };

describe("pointer adapter — widget opt-out", () => {
  it("flags a down that crosses a native interactive (button) as surfaceHandled", () => {
    const { host, queue, detach } = setup();
    const hostDiv = document.createElement("div");
    const button = document.createElement("button");
    hostDiv.appendChild(button);
    host.contentPlane.appendChild(hostDiv);

    fire(button, "pointerdown", DOWN);
    const down = queue.drain()[0];
    expect(down?.kind).toBe("down");
    expect(down?.surfaceHandled).toBe(true);
    detach();
  });

  it("flags an explicit [data-canvas-interactive] opt-out", () => {
    const { host, queue, detach } = setup();
    const el = document.createElement("div");
    el.setAttribute("data-canvas-interactive", "");
    host.contentPlane.appendChild(el);

    fire(el, "pointerdown", DOWN);
    expect(queue.drain()[0]?.surfaceHandled).toBe(true);
    detach();
  });

  it("flags an editable region (contenteditable)", () => {
    const { host, queue, detach } = setup();
    const el = document.createElement("div");
    el.setAttribute("contenteditable", "true");
    host.contentPlane.appendChild(el);

    fire(el, "pointerdown", DOWN);
    expect(queue.drain()[0]?.surfaceHandled).toBe(true);
    detach();
  });

  it("leaves a down on plain canvas content unflagged (absent, not false)", () => {
    const { host, queue, detach } = setup();
    const plain = document.createElement("div");
    host.contentPlane.appendChild(plain);

    fire(plain, "pointerdown", DOWN);
    const down = queue.drain()[0];
    expect(down?.kind).toBe("down");
    expect(down?.surfaceHandled).toBeUndefined();
    detach();
  });

  it("makes NO fact when widget content stopPropagations before the container", () => {
    const { host, queue, detach } = setup();
    const widget = document.createElement("div");
    host.contentPlane.appendChild(widget);
    widget.addEventListener("pointerdown", (e) => e.stopPropagation());

    fire(widget, "pointerdown", DOWN);
    expect(queue.size()).toBe(0); // the container listener never ran
    detach();
  });

  it("only opts out on down — a move over a button is still a normal fact", () => {
    const { host, queue, detach } = setup();
    const button = document.createElement("button");
    host.contentPlane.appendChild(button);

    fire(button, "pointermove", { ...DOWN, buttons: 0 });
    const move = queue.drain()[0];
    expect(move?.kind).toBe("move");
    expect(move?.surfaceHandled).toBeUndefined();
    detach();
  });
});

describe("pointer adapter — hover-time overInteractive (design-002 §8 amendment)", () => {
  it("stamps a move over an interactive true, a move over plain content false", () => {
    const { host, queue, detach } = setup();
    const button = document.createElement("button");
    const plain = document.createElement("div");
    host.contentPlane.appendChild(button);
    host.contentPlane.appendChild(plain);

    fire(button, "pointermove", { ...DOWN, buttons: 0 });
    fire(plain, "pointermove", { ...DOWN, buttons: 0 });
    const [over, off] = queue.drain();
    expect(over?.overInteractive).toBe(true);
    expect(off?.overInteractive).toBe(false);
    detach();
  });

  it("stamps downs with the same truth the opt-out derived", () => {
    const { host, queue, detach } = setup();
    const row = document.createElement("div");
    row.setAttribute("data-canvas-interactive", "");
    const plain = document.createElement("div");
    host.contentPlane.appendChild(row);
    host.contentPlane.appendChild(plain);

    fire(row, "pointerdown", DOWN);
    fire(plain, "pointerdown", { ...DOWN, pointerId: 2 });
    const [optedOut, normal] = queue.drain();
    expect(optedOut?.overInteractive).toBe(true);
    expect(normal?.overInteractive).toBe(false);
    detach();
  });

  it("leaves up/cancel and blur-cancel facts UNSTAMPED (capture retargeting lies)", () => {
    const { container, host, queue, detach } = setup();
    const button = document.createElement("button");
    host.contentPlane.appendChild(button);

    fire(button, "pointerdown", DOWN);
    fire(container, "pointerup", { ...DOWN, buttons: 0 });
    const [, up] = queue.drain();
    expect(up?.kind).toBe("up");
    expect(up?.overInteractive).toBeUndefined();
    detach();
  });

  it("folds a rich GLRouteVerdict into the move stamp (hover over claim-capable island content)", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const host = createCanvasHost(container);
    const queue = createInputQueue();
    const detach = attachPointerAdapter(host, queue, {
      glRoute: (kind) => (kind === "move" ? { handled: false, overInteractive: true } : false),
    });
    const plain = document.createElement("div");
    host.contentPlane.appendChild(plain);

    fire(plain, "pointermove", { ...DOWN, buttons: 0 });
    const move = queue.drain()[0];
    expect(move?.surfaceHandled).toBeUndefined(); // unclaimed — recognizers still see it
    expect(move?.overInteractive).toBe(true); // but the hover truth carries
    detach();
  });

  it("a boolean-returning glRoute still flags handled moves AND counts them as overInteractive", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const host = createCanvasHost(container);
    const queue = createInputQueue();
    const detach = attachPointerAdapter(host, queue, {
      glRoute: (kind) => kind === "move", // legacy boolean: captured island drag
    });
    const plain = document.createElement("div");
    host.contentPlane.appendChild(plain);

    fire(plain, "pointermove", { ...DOWN, buttons: 1 });
    const move = queue.drain()[0];
    expect(move?.surfaceHandled).toBe(true);
    expect(move?.overInteractive).toBe(true);
    detach();
  });
});
