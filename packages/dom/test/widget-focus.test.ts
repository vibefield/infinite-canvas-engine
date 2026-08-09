/**
 * The focus driver (design-007 §2.3–§2.5, petition I1): click-to-focus
 * acquisition on keyboard-claiming hosts (proxy preferred, host fallback,
 * native-focusable untouched) + the programmatic focusWidget/blurFocus handle.
 */
import type { Entity } from "@ice/core";
import { describe, expect, it } from "vitest";
import { createCanvasHost } from "../src/host";
import { KEYBOARD_CLAIM_ATTR } from "../src/input-ownership";
import { FOCUS_PROXY_ATTR, attachWidgetFocus } from "../src/widget-focus";

/** Mimics a dom-widgets host for a claiming widget: marker + tabindex + content child. */
function claimingHost(container: HTMLElement): { hostEl: HTMLDivElement; content: HTMLDivElement } {
  const hostEl = document.createElement("div");
  hostEl.setAttribute(KEYBOARD_CLAIM_ATTR, "");
  hostEl.tabIndex = -1;
  const content = document.createElement("div");
  content.setAttribute("data-ice-content", "");
  hostEl.appendChild(content);
  container.appendChild(hostEl);
  return { hostEl, content };
}

function setup(lookup?: { hostFor(entity: Entity): HTMLElement | undefined }) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const host = createCanvasHost(container);
  const handle = attachWidgetFocus(host, lookup ?? { hostFor: () => undefined });
  return { container, handle };
}

function pointerdown(target: EventTarget): Event {
  const ev = new Event("pointerdown", { bubbles: true, cancelable: true });
  target.dispatchEvent(ev);
  return ev;
}

describe("attachWidgetFocus — acquisition", () => {
  it("focuses the claiming host on a down over plain widget content", () => {
    const { container, handle } = setup();
    const { hostEl, content } = claimingHost(container);
    const body = document.createElement("div");
    content.appendChild(body);

    const ev = pointerdown(body);
    expect(ev.defaultPrevented).toBe(true); // driver owns the focus choice
    expect(document.activeElement).toBe(hostEl);
    handle.detach();
    container.remove();
  });

  it("prefers the declared [data-canvas-focus] proxy", () => {
    const { container, handle } = setup();
    const { content } = claimingHost(container);
    const proxy = document.createElement("div");
    proxy.setAttribute(FOCUS_PROXY_ATTR, "");
    proxy.tabIndex = -1;
    content.appendChild(proxy);
    const body = document.createElement("div");
    content.appendChild(body);

    pointerdown(body);
    expect(document.activeElement).toBe(proxy);
    handle.detach();
    container.remove();
  });

  it("leaves a natively-focusable target to the browser (textarea, canvas[tabindex])", () => {
    const { container, handle } = setup();
    const { content } = claimingHost(container);
    const textarea = document.createElement("textarea");
    content.appendChild(textarea);

    const ev = pointerdown(textarea);
    expect(ev.defaultPrevented).toBe(false); // native mousedown focus is correct here
    handle.detach();
    container.remove();
  });

  it("ignores downs outside any claim (click-away stays native)", () => {
    const { container, handle } = setup();
    const plain = document.createElement("div");
    container.appendChild(plain);
    const ev = pointerdown(plain);
    expect(ev.defaultPrevented).toBe(false);
    handle.detach();
    container.remove();
  });

  it("does not disturb a claim that already holds focus", () => {
    const { container, handle } = setup();
    const { hostEl, content } = claimingHost(container);
    const body = document.createElement("div");
    content.appendChild(body);
    hostEl.focus();
    expect(document.activeElement).toBe(hostEl);

    const ev = pointerdown(body);
    expect(ev.defaultPrevented).toBe(false); // already held — no re-focus, no default suppression
    expect(document.activeElement).toBe(hostEl);
    handle.detach();
    container.remove();
  });
});

describe("attachWidgetFocus — programmatic handle", () => {
  it("focusWidget resolves entity → host via the lookup; blurFocus releases", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const host = createCanvasHost(container);
    const { hostEl, content } = claimingHost(container);
    const entity = 1 as unknown as Entity;
    const handle = attachWidgetFocus(host, { hostFor: (e) => (e === entity ? content : undefined) });

    expect(handle.focusWidget(entity)).toBe(true);
    expect(document.activeElement).toBe(hostEl);
    expect(handle.blurFocus()).toBe(true);
    expect(document.activeElement).not.toBe(hostEl);
    expect(handle.blurFocus()).toBe(false); // nothing claimed holds focus now
    handle.detach();
    container.remove();
  });

  it("focusWidget refuses entities without a mounted claiming host", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const host = createCanvasHost(container);
    // A NON-claiming widget host (no marker): declaration drives focusability.
    const bare = document.createElement("div");
    const content = document.createElement("div");
    bare.appendChild(content);
    container.appendChild(bare);
    const entity = 2 as unknown as Entity;
    const handle = attachWidgetFocus(host, { hostFor: (e) => (e === entity ? content : undefined) });

    expect(handle.focusWidget(entity)).toBe(false);
    expect(handle.focusWidget(999 as unknown as Entity)).toBe(false); // unmounted
    handle.detach();
    container.remove();
  });
});
