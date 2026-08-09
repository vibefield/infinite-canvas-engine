/**
 * L0 pointer adapter: DOM events map to normalized InputEvents on the queue and
 * NOTHING else (no world writes — Law 2). Covers id/coord/button/mods mapping,
 * wheel pinch vs pan (+ deltaMode scaling), Space preventDefault, and the
 * window-blur cancel sweep (design-003 §8).
 */
import { NO_MODS, createInputQueue, type InputEvent } from "@ice/core";
import { describe, expect, it } from "vitest";
import { createCanvasHost } from "../src/host";
import { attachPointerAdapter } from "../src/pointer-adapter";

const RECT = { left: 50, top: 20, right: 850, bottom: 620, width: 800, height: 600, x: 50, y: 20 };

function setup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  container.getBoundingClientRect = () => ({ ...RECT, toJSON: () => ({}) }) as DOMRect;
  const queue = createInputQueue();
  const detach = attachPointerAdapter(createCanvasHost(container), queue);
  return { container, queue, detach };
}

/** Dispatch a synthetic DOM event with assigned props (happy-dom has no PointerEvent ctor). */
function fire(target: EventTarget, type: string, props: Record<string, unknown>): Event {
  const ev = new Event(type, { cancelable: true, bubbles: true });
  Object.assign(ev, props);
  target.dispatchEvent(ev);
  return ev;
}

describe("attachPointerAdapter", () => {
  it("maps a mouse down/move/up to container-relative InputEvents", () => {
    const { container, queue, detach } = setup();
    fire(container, "pointerdown", { pointerType: "mouse", pointerId: 1, clientX: 150, clientY: 120, buttons: 1, shiftKey: false });
    fire(container, "pointermove", { pointerType: "mouse", pointerId: 1, clientX: 170, clientY: 120, buttons: 1 });
    fire(container, "pointerup", { pointerType: "mouse", pointerId: 1, clientX: 170, clientY: 120, buttons: 0 });

    const events = queue.drain();
    expect(events.map((e) => e.kind)).toEqual(["down", "move", "up"]);
    const down = events[0] as InputEvent;
    expect(down.pointerId).toBe("mouse");
    expect(down.device).toBe("mouse");
    expect(down.screenX).toBe(100); // 150 - rect.left(50)
    expect(down.screenY).toBe(100); // 120 - rect.top(20)
    expect(down.buttons).toBe(1);
    expect(down.mods.space).toBe(false);
    detach();
  });

  it("assigns stable per-contact ids for touch and pen", () => {
    const { container, queue, detach } = setup();
    fire(container, "pointerdown", { pointerType: "touch", pointerId: 7, clientX: 50, clientY: 20, buttons: 1 });
    fire(container, "pointerdown", { pointerType: "pen", pointerId: 9, clientX: 50, clientY: 20, buttons: 1 });
    const events = queue.drain();
    expect(events[0]?.pointerId).toBe("touch:7");
    expect(events[0]?.device).toBe("touch");
    expect(events[1]?.pointerId).toBe("pen");
    expect(events[1]?.device).toBe("pen");
    detach();
  });

  it("carries the buttons bitmask (middle button = 4)", () => {
    const { container, queue, detach } = setup();
    fire(container, "pointerdown", { pointerType: "mouse", pointerId: 1, clientX: 100, clientY: 100, buttons: 4 });
    expect(queue.drain()[0]?.buttons).toBe(4);
    detach();
  });

  it("routes a ctrl-wheel to wheel.pinch and preventDefaults", () => {
    const { container, queue, detach } = setup();
    const ev = fire(container, "wheel", { clientX: 100, clientY: 100, deltaX: 0, deltaY: -120, deltaMode: 0, ctrlKey: true });
    expect(ev.defaultPrevented).toBe(true);
    const wheel = queue.drain()[0];
    expect(wheel?.kind).toBe("wheel");
    expect(wheel?.wheel).toEqual({ dx: 0, dy: 0, pinch: -120 });
    detach();
  });

  it("routes a plain wheel to dx/dy, scaling line deltas to px", () => {
    const { container, queue, detach } = setup();
    fire(container, "wheel", { clientX: 100, clientY: 100, deltaX: 2, deltaY: 3, deltaMode: 1, ctrlKey: false }); // line mode
    const wheel = queue.drain()[0];
    expect(wheel?.wheel).toEqual({ dx: 32, dy: 48, pinch: 0 }); // ×16
    detach();
  });

  it("tracks Space as the pan modifier and preventDefaults it", () => {
    const { container, queue, detach } = setup();
    const view = container.ownerDocument.defaultView as Window;
    const down = fire(view, "keydown", { key: " ", code: "Space", shiftKey: false, ctrlKey: false, altKey: false, metaKey: false });
    expect(down.defaultPrevented).toBe(true);

    // A pointer event now carries space:true through mods.
    fire(container, "pointerdown", { pointerType: "mouse", pointerId: 1, clientX: 100, clientY: 100, buttons: 1 });
    const events = queue.drain();
    const key = events.find((e) => e.kind === "key");
    expect(key?.mods.space).toBe(true);
    const ptr = events.find((e) => e.kind === "down");
    expect(ptr?.mods.space).toBe(true);

    fire(view, "keyup", { key: " ", code: "Space", shiftKey: false, ctrlKey: false, altKey: false, metaKey: false });
    expect(queue.drain().find((e) => e.kind === "key")?.mods.space).toBe(false);
    detach();
  });

  it("emits a key fact only when the modifier tuple changes", () => {
    const { container, queue, detach } = setup();
    const view = container.ownerDocument.defaultView as Window;
    // A non-modifier key with no mods held changes nothing → no key fact.
    fire(view, "keydown", { key: "p", code: "KeyP", shiftKey: false, ctrlKey: false, altKey: false, metaKey: false });
    expect(queue.drain().length).toBe(0);
    detach();
  });

  it("cancels every still-down pointer on window blur (design-003 §8)", () => {
    const { container, queue, detach } = setup();
    const view = container.ownerDocument.defaultView as Window;
    fire(container, "pointerdown", { pointerType: "touch", pointerId: 3, clientX: 90, clientY: 70, buttons: 1 });
    fire(container, "pointerdown", { pointerType: "touch", pointerId: 4, clientX: 110, clientY: 70, buttons: 1 });
    queue.drain(); // clear the downs

    fire(view, "blur", {});
    const cancels = queue.drain();
    expect(cancels.map((e) => e.kind)).toEqual(["cancel", "cancel"]);
    expect(cancels.map((e) => e.pointerId).sort()).toEqual(["touch:3", "touch:4"]);
    expect(cancels[0]?.screenX).toBe(40); // 90 - rect.left(50), last-known sample
    expect(cancels[0]?.mods).toEqual({ ...NO_MODS });

    // A pointer already cancelled is not re-cancelled by a second blur.
    fire(view, "blur", {});
    expect(queue.drain().length).toBe(0);
    detach();
  });

  it("cancels live pointers and clears latched mods on detach (mid-gesture unmount)", () => {
    const { container, queue, detach } = setup();
    const view = container.ownerDocument.defaultView as Window;
    // Latch Space (the pan modifier) and start a drag, then detach mid-gesture.
    fire(view, "keydown", { key: " ", code: "Space", shiftKey: false, ctrlKey: false, altKey: false, metaKey: false });
    fire(container, "pointerdown", { pointerType: "mouse", pointerId: 1, clientX: 100, clientY: 100, buttons: 1 });
    queue.drain(); // clear the key + down

    detach();
    const facts = queue.drain();
    const cancel = facts.find((e) => e.kind === "cancel");
    expect(cancel?.pointerId).toBe("mouse"); // the still-down pointer is cancelled
    const key = facts.find((e) => e.kind === "key");
    expect(key?.mods).toEqual({ ...NO_MODS }); // latched Space cleared, not stranded
  });
});

/**
 * Widget input ownership (design-007 §3.4/§3.5, petitions I1/I4): Space and
 * wheel read the target's ownership — editable, claim marker, scroller-with-
 * room — before latching/preventDefaulting.
 */
describe("attachPointerAdapter — widget input ownership (design-007)", () => {
  const spaceProps = { key: " ", code: "Space", shiftKey: false, ctrlKey: false, altKey: false, metaKey: false };

  /** A claiming widget host inside the container with mocked scrollable content. */
  function claimWithScroller(container: HTMLElement, scrollTop: number) {
    const host = document.createElement("div");
    host.setAttribute("data-canvas-keyboard", "");
    const list = document.createElement("div");
    list.style.overflowY = "auto";
    Object.defineProperty(list, "clientHeight", { value: 100, configurable: true });
    Object.defineProperty(list, "scrollHeight", { value: 400, configurable: true });
    list.scrollTop = scrollTop;
    host.appendChild(list);
    container.appendChild(host);
    return { host, list };
  }

  it("Space into an editable field TYPES: no preventDefault, no pan latch (§1.6 live-bug fix)", () => {
    const { container, queue, detach } = setup();
    const textarea = document.createElement("textarea");
    container.appendChild(textarea);

    const down = fire(textarea, "keydown", spaceProps);
    expect(down.defaultPrevented).toBe(false);
    // The pan modifier never latched: the next pointer fact carries space:false.
    fire(container, "pointerdown", { pointerType: "mouse", pointerId: 1, clientX: 100, clientY: 100, buttons: 1 });
    expect(queue.drain().find((e) => e.kind === "down")?.mods.space).toBe(false);
    detach();
  });

  it("Space into a claiming widget cedes the pan semantics but keeps killing page-scroll", () => {
    const { container, queue, detach } = setup();
    const { host } = claimWithScroller(container, 0);

    const down = fire(host, "keydown", spaceProps);
    expect(down.defaultPrevented).toBe(true); // page must not scroll (§3.3 residual)
    fire(container, "pointerdown", { pointerType: "mouse", pointerId: 1, clientX: 100, clientY: 100, buttons: 1 });
    expect(queue.drain().find((e) => e.kind === "down")?.mods.space).toBe(false); // semantics ceded
    detach();
  });

  it("Space keyup clears the latch even after focus moved into an editable", () => {
    const { container, queue, detach } = setup();
    const view = container.ownerDocument.defaultView as Window;
    const textarea = document.createElement("textarea");
    container.appendChild(textarea);

    fire(view, "keydown", spaceProps); // latched over canvas
    queue.drain();
    const up = fire(textarea, "keyup", spaceProps); // up lands on the editable
    expect(up.defaultPrevented).toBe(false);
    fire(container, "pointerdown", { pointerType: "mouse", pointerId: 1, clientX: 100, clientY: 100, buttons: 1 });
    expect(queue.drain().find((e) => e.kind === "down")?.mods.space).toBe(false); // not stranded
    detach();
  });

  it("plain wheel over a scroller-with-room cedes: no preventDefault, fact flagged wheelHandled", () => {
    const { container, queue, detach } = setup();
    const { list } = claimWithScroller(container, 0);

    const ev = fire(list, "wheel", { clientX: 100, clientY: 100, deltaX: 0, deltaY: 120, deltaMode: 0, ctrlKey: false });
    expect(ev.defaultPrevented).toBe(false); // native scroll proceeds
    const fact = queue.drain()[0];
    expect(fact?.kind).toBe("wheel");
    expect(fact?.wheelHandled).toBe(true);
    expect(fact?.wheel).toEqual({ dx: 0, dy: 120, pinch: 0 }); // the fact still lands, truthfully
    detach();
  });

  it("the same wheel at the scroll bottom falls through to canvas pan (at-bounds)", () => {
    const { container, queue, detach } = setup();
    const { list } = claimWithScroller(container, 300); // 300 + 100 = scrollHeight

    const ev = fire(list, "wheel", { clientX: 100, clientY: 100, deltaX: 0, deltaY: 120, deltaMode: 0, ctrlKey: false });
    expect(ev.defaultPrevented).toBe(true);
    expect(queue.drain()[0]?.wheelHandled).toBeUndefined();
    detach();
  });

  it("ctrl/pinch over ceding content is STILL the canvas zoom (F4 — page pinch-zoom never fires)", () => {
    const { container, queue, detach } = setup();
    const { list } = claimWithScroller(container, 0);

    const ev = fire(list, "wheel", { clientX: 100, clientY: 100, deltaX: 0, deltaY: -80, deltaMode: 0, ctrlKey: true });
    expect(ev.defaultPrevented).toBe(true);
    const fact = queue.drain()[0];
    expect(fact?.wheel).toEqual({ dx: 0, dy: 0, pinch: -80 });
    expect(fact?.wheelHandled).toBeUndefined();
    detach();
  });

  it("a widget that already handled Space (defaultPrevented) is left alone", () => {
    const { container, queue, detach } = setup();
    const view = container.ownerDocument.defaultView as Window;
    // A capture-phase content handler consumes Space before the adapter's
    // window listener sees it ("preventDefault = handled by content").
    const consume = (e: Event): void => e.preventDefault();
    view.addEventListener("keydown", consume, true);
    fire(view, "keydown", spaceProps);
    view.removeEventListener("keydown", consume, true);

    fire(container, "pointerdown", { pointerType: "mouse", pointerId: 1, clientX: 100, clientY: 100, buttons: 1 });
    expect(queue.drain().find((e) => e.kind === "down")?.mods.space).toBe(false); // no latch
    detach();
  });
});
