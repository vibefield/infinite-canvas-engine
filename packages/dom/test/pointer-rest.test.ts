/**
 * A RESTING POINTER KEEPS NO DESK AWAKE (petition I33; VibeField DK-10b): Chromium re-sends a still pointer's `pointermove` on a focus
 * or visibility change, and other windows' input raises trusted moves with no motion — before I33 each one landed as a fact, woke the
 * loop, bumped `PointerVersion` and touched the desk's wind, holding a still desk out of rest. The adapter now DROPS a move whose
 * position, target, hover verdict and modifiers are the last it enqueued for that pointer while no button is down and no press of
 * its own is live: nothing enqueued, no wake, no step's work, no bump. Every press is untouched, and a transition or a wheel starts
 * the comparison afresh. Driven through a real engine — the adapter on the stack's own (wakeful) queue, the engine stepped — so a
 * dropped move is seen as what it costs downstream: the stamp and the frame gate's input wakes.
 */
import { createCanvasEngine, PointerVersion } from "@ice/core";
import { describe, expect, it } from "vitest";
import { createCanvasHost } from "../src/host";
import { attachPointerAdapter } from "../src/pointer-adapter";

const RECT = { left: 50, top: 20, right: 850, bottom: 620, width: 800, height: 600, x: 50, y: 20 };

/** Dispatch a synthetic DOM event with assigned props (happy-dom has no PointerEvent ctor). */
function fire(target: EventTarget, type: string, props: Record<string, unknown>): void {
  const ev = new Event(type, { cancelable: true, bubbles: true });
  Object.assign(ev, props);
  target.dispatchEvent(ev);
}

function setup() {
  const engine = createCanvasEngine();
  const container = document.createElement("div");
  document.body.appendChild(container);
  container.getBoundingClientRect = () => ({ ...RECT, toJSON: () => ({}) }) as DOMRect;
  const detach = attachPointerAdapter(createCanvasHost(container), engine.stack.queue);
  let t = 1000;
  /** One engine step; `PointerVersion` after it (0 before the first bump). */
  const step = (): number => {
    t += 16;
    engine.engine.step(t);
    return engine.world.getResource(PointerVersion)?.v ?? 0;
  };
  /** The input wakes the frame gate has counted (each enqueue is one). */
  const wakes = (): number => engine.engine.frame.sleepStats().wakes.input ?? 0;
  const mouse = { pointerType: "mouse", pointerId: 1, buttons: 0, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false };
  const move = (clientX: number, clientY: number, extra: Record<string, unknown> = {}, on: EventTarget = container): void => fire(on, "pointermove", { ...mouse, clientX, clientY, ...extra });
  const dispose = (): void => { detach(); engine.dispose(); container.remove(); };
  return { engine, container, step, wakes, move, dispose };
}

describe("a resting pointer keeps no desk awake (petition I33)", () => {
  it("two moves at one position bump `PointerVersion` ONCE; a move of 1 px bumps again", () => {
    const d = setup();
    try {
      d.move(150, 120);
      const v1 = d.step();
      expect(v1).toBeGreaterThan(0);
      const w1 = d.wakes();
      d.move(150, 120);   // the same move again: dropped
      expect(d.engine.stack.queue.size()).toBe(0);
      expect(d.wakes()).toBe(w1);
      expect(d.step()).toBe(v1);
      for (let i = 0; i < 3; i++) d.move(150, 120);   // and again, any number of times
      expect(d.step()).toBe(v1);
      d.move(151, 120);   // one px: a move
      expect(d.step()).toBe(v1 + 1);
      expect(d.wakes()).toBe(w1 + 1);
      d.move(151, 120.5);   // half a px is a move too: the comparison is exact
      expect(d.step()).toBe(v1 + 2);
    } finally { d.dispose(); }
  });

  it("a button change at the same position bumps — the down, a held move, a second button, the up — and so does the first move after it", () => {
    const d = setup();
    try {
      d.move(200, 200);
      let v = d.step();
      fire(d.container, "pointerdown", { pointerType: "mouse", pointerId: 1, clientX: 200, clientY: 200, buttons: 1 });
      expect(d.step()).toBe(++v);
      // a press in flight: a held pointer's same-position moves all land (the gesture's consumer reads every one it is sent)
      d.move(200, 200, { buttons: 1 });
      expect(d.step()).toBe(++v);
      d.move(200, 200, { buttons: 1 });
      expect(d.step()).toBe(++v);
      d.move(200, 200, { buttons: 3 });   // a second button joins the press, at the same point
      expect(d.step()).toBe(++v);
      fire(d.container, "pointerup", { pointerType: "mouse", pointerId: 1, clientX: 200, clientY: 200, buttons: 0 });
      expect(d.step()).toBe(++v);
      // after a transition the comparison starts afresh: the first move at rest lands; the repeat does not
      d.move(200, 200);
      expect(d.step()).toBe(++v);
      d.move(200, 200);
      expect(d.step()).toBe(v);
    } finally { d.dispose(); }
  });

  it("a held button never dedupes, even when no down was seen (a press widget content handed over)", () => {
    const d = setup();
    try {
      d.move(300, 300, { buttons: 1 });
      let v = d.step();
      d.move(300, 300, { buttons: 1 });
      expect(d.step()).toBe(++v);
    } finally { d.dispose(); }
  });

  it("the same position under another target, another hover verdict or other modifiers is a move — the facts it carries differ", () => {
    const d = setup();
    try {
      const child = document.createElement("div");
      d.container.appendChild(child);
      const field = document.createElement("textarea");
      d.container.appendChild(field);
      d.move(400, 300);
      let v = d.step();
      d.move(400, 300, {}, child);   // another target
      expect(d.step()).toBe(++v);
      d.move(400, 300, {}, child);
      expect(d.step()).toBe(v);
      d.move(400, 300, {}, field);   // an interactive target: the hover verdict flips
      expect(d.step()).toBe(++v);
      d.move(400, 300, { shiftKey: true }, field);   // a modifier
      expect(d.step()).toBe(++v);
      d.move(400, 300, { shiftKey: true }, field);
      expect(d.step()).toBe(v);
    } finally { d.dispose(); }
  });

  it("a `pointerleave`/`pointerenter` pair at one position is a no-op, and so is the move after it; a window blur keeps the rest", () => {
    const d = setup();
    try {
      d.move(500, 400);
      const v = d.step();
      const w = d.wakes();
      fire(d.container, "pointerleave", { pointerType: "mouse", pointerId: 1, clientX: 500, clientY: 400, buttons: 0 });
      fire(d.container, "pointerenter", { pointerType: "mouse", pointerId: 1, clientX: 500, clientY: 400, buttons: 0 });
      d.move(500, 400);
      expect(d.wakes()).toBe(w);
      expect(d.step()).toBe(v);
      // the focus goes and comes back (Chromium re-sends the resting pointer's move): nothing pressed, nothing to cancel, nothing new
      fire(d.container.ownerDocument.defaultView as Window, "blur", {});
      d.move(500, 400);
      expect(d.wakes()).toBe(w);
      expect(d.step()).toBe(v);
    } finally { d.dispose(); }
  });

  it("a wheel moves the camera under the pointer: the next move lands even at the same point", () => {
    const d = setup();
    try {
      d.move(600, 300);
      let v = d.step();
      fire(d.container, "wheel", { clientX: 600, clientY: 300, deltaX: 0, deltaY: 40, deltaMode: 0, ctrlKey: false, buttons: 0 });
      expect(d.step()).toBe(++v);
      d.move(600, 300);
      expect(d.step()).toBe(++v);
      d.move(600, 300);
      expect(d.step()).toBe(v);
    } finally { d.dispose(); }
  });
});
