/**
 * A press CLAIMED ahead of the pointer adapter starts no gesture (petition I60) — the real adapter feeding a real engine. The
 * desk's one editor, lent to a part that says where its writing lies, prevents a primary press's default in the capture phase on
 * the container; the adapter hears the press after it and lands the fact `surfaceHandled`, as a native control's (design-002 §8),
 * so the recognizers skip it: the press carries nothing, draws no marquee and pans nothing — while every fact still lands (the
 * pointer is where the drag left it). The claimant here is a capture-phase listener standing in for the editor (dom may not import
 * the desk; the desk's own tests pin that its editor claims such a press, and only such a press). Each case beside its control: the
 * same press, unclaimed, carries, marquees and pans as ever.
 */
import { Camera, createCanvasEngine, defineQuery, defineWidget, LocalPointer, Pointer, PointerScreen, Position, Selected, Viewport, widgets } from "@ice/core";
import { describe, expect, it } from "vitest";
import { createCanvasHost } from "../src/host";
import { attachPointerAdapter } from "../src/pointer-adapter";

// One widget type per FILE (core's registry is global; no test reset).
const CARD =
  widgets.get("claim:card") ??
  defineWidget({ type: "claim:card", object: { name: "card" }, stratum: "things", defaultSize: { w: 200, h: 200 }, interaction: { snap: "none" } });

const mouseQ = defineQuery([Pointer, LocalPointer, PointerScreen]);

function rig(claim: boolean) {
  const ce = createCanvasEngine({ widgets: [CARD], settings: { snap: { enabled: false } } });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 800, h: 600, dpr: 1 });
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });   // screen = world
  const container = document.createElement("div");
  const surface = document.createElement("div");   // what a press lands on: the desk's canvas
  container.append(surface);
  document.body.append(container);
  container.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
  // the editor's stand-in: a primary press claimed in the capture phase, before the adapter's own listener hears it
  const claimant = (e: Event): void => { if ((e as PointerEvent).button === 0) e.preventDefault(); };
  if (claim) container.addEventListener("pointerdown", claimant, { capture: true });
  const detach = attachPointerAdapter(createCanvasHost(container), ce.stack.queue);
  let now = 1000;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  /** Dispatch a synthetic pointer event on the surface (happy-dom has no PointerEvent ctor the adapter's tests use). */
  const fire = (type: string, x: number, y: number, buttons: number): Event => {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(ev, { pointerType: "mouse", pointerId: 1, isPrimary: true, button: type === "pointermove" ? -1 : 0, buttons, clientX: x, clientY: y, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false });
    surface.dispatchEvent(ev);
    return ev;
  };
  /** Space held or let go, on the window (the adapter's pan modifier, design-003 §4.4). */
  const space = (down: boolean): void => {
    const ev = new Event(down ? "keydown" : "keyup", { bubbles: true, cancelable: true });
    Object.assign(ev, { key: " ", code: "Space", shiftKey: false, ctrlKey: false, altKey: false, metaKey: false });
    window.dispatchEvent(ev);
    step();
  };
  /** A primary press at `from` dragged to `to` in 8 moves and released there, a step after each fact: the press's own event. */
  const drag = (from: readonly [number, number], to: readonly [number, number]): Event => {
    fire("pointermove", from[0], from[1], 0);
    step();
    const down = fire("pointerdown", from[0], from[1], 1);
    step();
    for (let i = 1; i <= 8; i++) {
      fire("pointermove", from[0] + ((to[0] - from[0]) * i) / 8, from[1] + ((to[1] - from[1]) * i) / 8, 1);
      step();
    }
    fire("pointerup", to[0], to[1], 0);
    step(4);
    return down;
  };
  const card = ce.ops.spawnWidget(CARD.type, { x: 200, y: 150, w: 200, h: 200, undoable: false });
  ce.world.sync();
  step(3);
  /** The mouse pointer's screen point as the world holds it. */
  const mouse = (): { x: number; y: number } | undefined => {
    let at: { x: number; y: number } | undefined;
    ce.world.query(mouseQ).each((b) => { for (const r of b) { const s = ce.world.read(b.entity(r), PointerScreen); at = { x: s.x, y: s.y }; } });
    return at;
  };
  const camera = (): { x: number; y: number; zoom: number } => {
    const c = ce.world.getResource(Camera);
    if (c === undefined) throw new Error("Camera unset");
    return { x: c.x, y: c.y, zoom: c.zoom };
  };
  return { ce, world: ce.world, card, drag, space, mouse, camera, dispose() { detach(); ce.dispose(); container.remove(); } };
}

describe("a press claimed ahead of the pointer adapter starts no gesture (petition I60)", () => {
  it("a claimed drag on an object carries nothing — the object where it lay, the pointer where the drag left it; unclaimed, the same drag carries it (control)", () => {
    const r = rig(true);
    try {
      expect(r.drag([300, 250], [500, 400]).defaultPrevented).toBe(true);
      expect(r.world.get(r.card, Position)).toEqual({ x: 200, y: 150 });
      expect(r.mouse()).toEqual({ x: 500, y: 400 });   // every fact landed: the pointer is where it went
    } finally { r.dispose(); }
    const c = rig(false);
    try {
      expect(c.drag([300, 250], [500, 400]).defaultPrevented).toBe(false);
      // carried with the drag (most of its way: the release lands with the last sample)
      const p = c.world.get(c.card, Position);
      expect(p?.x).toBeGreaterThan(300);
      expect(p?.y).toBeGreaterThan(250);
    } finally { c.dispose(); }
  });

  it("a claimed drag on the bare desk draws no marquee — what it swept stays unselected; unclaimed, the marquee selects the object (control)", () => {
    const r = rig(true);
    try {
      r.drag([60, 60], [640, 480]);
      expect(r.world.hasTag(r.card, Selected)).toBe(false);
      expect(r.world.get(r.card, Position)).toEqual({ x: 200, y: 150 });
    } finally { r.dispose(); }
    const c = rig(false);
    try {
      c.drag([60, 60], [640, 480]);
      expect(c.world.hasTag(c.card, Selected)).toBe(true);
    } finally { c.dispose(); }
  });

  it("a claimed drag with Space held pans nothing — the camera stays; unclaimed, the same drag pans it (control)", () => {
    const r = rig(true);
    try {
      r.space(true);
      r.drag([600, 500], [700, 560]);
      r.space(false);
      expect(r.camera()).toEqual({ x: 0, y: 0, zoom: 1 });
    } finally { r.dispose(); }
    const c = rig(false);
    try {
      c.space(true);
      c.drag([600, 500], [700, 560]);
      c.space(false);
      expect(c.camera()).not.toEqual({ x: 0, y: 0, zoom: 1 });
      expect(c.camera().zoom).toBe(1);
    } finally { c.dispose(); }
  });
});
