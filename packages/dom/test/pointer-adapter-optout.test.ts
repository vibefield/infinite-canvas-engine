/**
 * Widget opt-out at the L0 adapter (the pinned widget-event contract, design-002
 * §8 / design-004 §4). A `pointerdown` that crosses a native interactive or an
 * explicit `[data-canvas-interactive]` flags the down fact `surfaceHandled: true`
 * (fact still lands; recognizers skip). A `stopPropagation()` before the container
 * is the OTHER boundary: the event never reaches the adapter, so no fact is made.
 * A down whose default a listener AHEAD of the adapter prevented (the desk's editor
 * claiming a press on its writing — petition I60) is flagged the same way; the focus
 * driver's own cancel inside a keyboard claim is focus bookkeeping, not a claim.
 */
import { createInputQueue } from "@ice/core";
import { describe, expect, it } from "vitest";
import { createCanvasHost } from "../src/host";
import { attachPointerAdapter } from "../src/pointer-adapter";
import { attachWidgetFocus } from "../src/widget-focus";

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
    host.container.appendChild(hostDiv);

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
    host.container.appendChild(el);

    fire(el, "pointerdown", DOWN);
    expect(queue.drain()[0]?.surfaceHandled).toBe(true);
    detach();
  });

  it("flags an editable region (contenteditable)", () => {
    const { host, queue, detach } = setup();
    const el = document.createElement("div");
    el.setAttribute("contenteditable", "true");
    host.container.appendChild(el);

    fire(el, "pointerdown", DOWN);
    expect(queue.drain()[0]?.surfaceHandled).toBe(true);
    detach();
  });

  it("leaves a down on plain canvas content unflagged (absent, not false)", () => {
    const { host, queue, detach } = setup();
    const plain = document.createElement("div");
    host.container.appendChild(plain);

    fire(plain, "pointerdown", DOWN);
    const down = queue.drain()[0];
    expect(down?.kind).toBe("down");
    expect(down?.surfaceHandled).toBeUndefined();
    detach();
  });

  it("makes NO fact when widget content stopPropagations before the container", () => {
    const { host, queue, detach } = setup();
    const widget = document.createElement("div");
    host.container.appendChild(widget);
    widget.addEventListener("pointerdown", (e) => e.stopPropagation());

    fire(widget, "pointerdown", DOWN);
    expect(queue.size()).toBe(0); // the container listener never ran
    detach();
  });

  it("flags a down whose default a listener AHEAD of the adapter prevented — the desk's editor claiming a press on its writing, in the capture phase (petition I60); its hover verdict stays the DOM's own, and the move after it is a plain fact", () => {
    const { container, host, queue, detach } = setup();
    const plain = document.createElement("div");
    host.container.appendChild(plain);
    const claim = (e: Event): void => { e.preventDefault(); };
    container.addEventListener("pointerdown", claim, { capture: true });

    const ev = fire(plain, "pointerdown", DOWN);
    fire(plain, "pointermove", { ...DOWN, clientX: 40 });
    const [down, move] = queue.drain();
    container.removeEventListener("pointerdown", claim, { capture: true });
    detach();
    expect(ev.defaultPrevented).toBe(true);
    expect(down?.kind).toBe("down");
    expect(down?.surfaceHandled).toBe(true);
    // the claim is no chrome: the pointer is not over an interactive, so the stack's exact hit stands for the release's tap
    expect(down?.overInteractive).toBe(false);
    expect(move?.kind).toBe("move");
    expect(move?.surfaceHandled).toBeUndefined();
  });

  it("leaves the focus driver's own cancel alone: a press on plain content inside a keyboard claim has its focus fixup suppressed (prevented), and its down still lands unflagged, as ever (petition I60's gate is a claim, not focus bookkeeping)", () => {
    const { host, queue, detach } = setup();
    const focus = attachWidgetFocus(host);
    const claimHost = document.createElement("div");
    claimHost.setAttribute("data-canvas-keyboard", "");
    claimHost.tabIndex = -1;
    const body = document.createElement("div");
    claimHost.appendChild(body);
    host.container.appendChild(claimHost);

    const ev = fire(body, "pointerdown", DOWN);
    const down = queue.drain()[0];
    focus.detach();
    detach();
    expect(ev.defaultPrevented).toBe(true);   // the driver took the focus choice
    expect(down?.kind).toBe("down");
    expect(down?.surfaceHandled).toBeUndefined();
  });

  it("only opts out on down — a move over a button is still a normal fact", () => {
    const { host, queue, detach } = setup();
    const button = document.createElement("button");
    host.container.appendChild(button);

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
    host.container.appendChild(button);
    host.container.appendChild(plain);

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
    host.container.appendChild(row);
    host.container.appendChild(plain);

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
    host.container.appendChild(button);

    fire(button, "pointerdown", DOWN);
    fire(container, "pointerup", { ...DOWN, buttons: 0 });
    const [, up] = queue.drain();
    expect(up?.kind).toBe("up");
    expect(up?.overInteractive).toBeUndefined();
    detach();
  });
});
