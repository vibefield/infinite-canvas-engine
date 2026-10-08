/**
 * THE POINTER OUT OF THE HOST (petition I42): the adapter says, once, that the mouse LEFT the host with nowhere to go — a
 * `pointerleave` on the container itself with no related target (out of the window) and no press of its own live — as a `leave`
 * fact at the point it left; ingest tags the pointer `PointerOutside`, and presence publishes the peer `away`. Deferred one task, so
 * a leave answered by an enter at once (Chromium's pair at a resting point — petition I33's) says nothing and wakes nothing; back,
 * the enter after a said leave is a move at its point. Driven through a real engine with presence attached (the facet is the
 * engine's own eph write — read off the local peer, no room needed).
 *
 * Petition I44 — the same leave when the mouse leaves the WINDOW off a host's chrome BESIDE the desk (a sibling of the container:
 * VibeField's head and line), which the container never hears: the document's `pointerout` with no related target, heard wherever
 * the pointer is. Said at the LAST point over the host (the desk never saw it over the chrome), answered at once by the document's
 * `pointerover` with no related target, and once said cleared only by the pointer back over the HOST. An exit off the container
 * itself is heard twice (its pointerout reaches the document, then its pointerleave) and says one leave.
 */
import { createCanvasEngine, PointerOutside, PresenceCursor, defineQuery } from "@ice/core";
import { describe, expect, it, vi } from "vitest";
import { createCanvasHost } from "../src/host";
import { attachPointerAdapter } from "../src/pointer-adapter";

const RECT = { left: 50, top: 20, right: 850, bottom: 620, width: 800, height: 600, x: 50, y: 20 };
const outsideQ = defineQuery([PointerOutside]);

/** Dispatch a synthetic DOM event with assigned props (happy-dom has no PointerEvent ctor). */
function fire(target: EventTarget, type: string, props: Record<string, unknown>, bubbles = true): void {
  const ev = new Event(type, { cancelable: true, bubbles });
  Object.assign(ev, props);
  target.dispatchEvent(ev);
}
const task = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function setup() {
  const engine = createCanvasEngine();
  engine.docs.create();
  engine.docs.attachPresence({ name: "me", color: "#f00" });
  const container = document.createElement("div");
  document.body.appendChild(container);
  container.getBoundingClientRect = () => ({ ...RECT, toJSON: () => ({}) }) as DOMRect;
  const detach = attachPointerAdapter(createCanvasHost(container), engine.stack.queue);
  let t = 1000;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { t += 16; engine.engine.step(t); } };
  const mouse = { pointerType: "mouse", pointerId: 1, buttons: 0, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false };
  const at = (clientX: number, clientY: number) => ({ ...mouse, clientX, clientY });
  const facet = () => {
    const p = engine.docs.presence();
    return p === undefined ? undefined : engine.world.get(p.localPeer, PresenceCursor);
  };
  const outside = (): boolean => engine.world.firstOf(outsideQ) !== undefined;
  const queued = (): number => engine.stack.queue.size();
  const dispose = (): void => { detach(); engine.dispose(); container.remove(); };
  return { engine, container, step, at, facet, outside, queued, detach, dispose };
}

describe("the pointer out of the host (petition I42)", () => {
  it("a leave out of the window is said a task later — the facet away within the one step that ingests it — and an enter brings it back", async () => {
    const d = setup();
    try {
      fire(d.container, "pointermove", d.at(450, 320));
      d.step(2);
      expect(d.facet()).toMatchObject({ x: 400, y: 300, away: false });
      fire(d.container, "pointerleave", { ...d.at(845, 320), relatedTarget: null }, false);
      expect(d.queued()).toBe(0); // deferred: an enter may still answer it
      await task();
      expect(d.queued()).toBe(1); // the leave, at the point it left
      d.step();
      expect(d.outside()).toBe(true);
      expect(d.facet()).toMatchObject({ x: 795, y: 300, away: true });
      // back: the enter is a move at its point — even at rest, the pointer is not left away
      fire(d.container, "pointerenter", { ...d.at(845, 320), relatedTarget: null }, false);
      expect(d.queued()).toBe(1);
      d.step();
      expect(d.outside()).toBe(false);
      expect(d.facet()).toMatchObject({ away: false });
      // and a resting move after it at the same point is the I33 no-op again
      fire(d.container, "pointermove", d.at(845, 320));
      expect(d.queued()).toBe(1);   // the first move after a leave lands (the comparison started afresh)…
      d.step();
      fire(d.container, "pointermove", d.at(845, 320));
      expect(d.queued()).toBe(0);   // …the repeat does not
    } finally { d.dispose(); }
  });

  it("says nothing for a leave an enter answers at once, a leave onto the page, a descendant's leave, a leave mid-press, or after detach", async () => {
    const d = setup();
    try {
      fire(d.container, "pointermove", d.at(450, 320));
      d.step(2);
      const wakes = d.engine.engine.frame.sleepStats().wakes.input ?? 0;
      // the pair at a resting point (Chromium's — petition I33): nothing, now or a task later
      fire(d.container, "pointerleave", { ...d.at(450, 320), relatedTarget: null }, false);
      fire(d.container, "pointerenter", { ...d.at(450, 320), relatedTarget: null }, false);
      await task();
      expect(d.queued()).toBe(0);
      expect(d.engine.engine.frame.sleepStats().wakes.input ?? 0).toBe(wakes);
      // onto another element of the page: the pointer has somewhere to go (a host's chrome says away itself)
      fire(d.container, "pointerleave", { ...d.at(845, 320), relatedTarget: document.body }, false);
      // a descendant's leave bubbling up is not the host's
      const child = document.createElement("div");
      d.container.appendChild(child);
      fire(child, "pointerleave", { ...d.at(845, 320), relatedTarget: null }, true);
      await task();
      expect(d.queued()).toBe(0);
      // mid-press: the pointer is ours (captured) until it is released
      fire(d.container, "pointerdown", { ...d.at(450, 320), buttons: 1 });
      d.step();
      fire(d.container, "pointerleave", { ...d.at(845, 320), buttons: 1, relatedTarget: null }, false);
      await task();
      expect(d.engine.stack.queue.drain().map((e) => e.kind)).toEqual([]);
      fire(d.container, "pointerup", { ...d.at(450, 320), buttons: 0 });
      d.step();
      // a leave pending at detach is never said
      fire(d.container, "pointerleave", { ...d.at(845, 320), relatedTarget: null }, false);
      d.detach();
      d.engine.stack.queue.drain();
      await task();
      expect(d.queued()).toBe(0);
      expect(d.outside()).toBe(false);
    } finally { d.dispose(); }
  });
});

describe("the pointer out of the window from beside the host (petition I44)", () => {
  /** A host's chrome beside the desk — a SIBLING of the container (VibeField's head and line stand beside `[data-desk]`). */
  const beside = (): HTMLElement => {
    const line = document.createElement("div");
    document.body.appendChild(line);
    return line;
  };

  it("out of the window off a sibling: ONE leave a task later, at the last point over the host — the facet away within the step that ingests it", async () => {
    const d = setup();
    const line = beside();
    try {
      fire(d.container, "pointermove", d.at(450, 320));
      d.step(2);
      expect(d.facet()).toMatchObject({ x: 400, y: 300, away: false });
      // onto the line (Chromium's boundary events): the pointer has somewhere to go, and the line's own moves are not the desk's
      fire(d.container, "pointerout", { ...d.at(450, 619), relatedTarget: line });
      fire(d.container, "pointerleave", { ...d.at(450, 619), relatedTarget: line }, false);
      fire(line, "pointerover", { ...d.at(450, 630), relatedTarget: d.container });
      fire(line, "pointermove", d.at(450, 630));
      await task();
      expect(d.queued()).toBe(0);
      // out of the window off the line: a pointerout with no related target, which only the document hears
      fire(line, "pointerout", { ...d.at(450, 640), relatedTarget: null });
      expect(d.queued()).toBe(0); // deferred: the pointer's return may still answer it
      await task();
      expect(d.queued()).toBe(1); // the leave, once
      d.step();
      expect(d.outside()).toBe(true);
      expect(d.facet()).toMatchObject({ x: 400, y: 300, away: true }); // the last point over the host — never the line's (400, 620)
    } finally { line.remove(); d.dispose(); }
  });

  it("a resting pointerout/pointerover pair at the document says nothing — off a sibling, or at the document itself", async () => {
    const d = setup();
    const line = beside();
    try {
      fire(d.container, "pointermove", d.at(450, 320));
      d.step(2);
      const wakes = d.engine.engine.frame.sleepStats().wakes.input ?? 0;
      // Chromium's pair at a resting point (petition I33's), at the document level: nothing, now or a task later
      fire(line, "pointerout", { ...d.at(450, 640), relatedTarget: null });
      fire(line, "pointerover", { ...d.at(450, 640), relatedTarget: null });
      await task();
      expect(d.queued()).toBe(0);
      fire(document, "pointerout", { ...d.at(450, 640), relatedTarget: null });
      fire(document, "pointerover", { ...d.at(450, 640), relatedTarget: null });
      await task();
      expect(d.queued()).toBe(0);
      expect(d.engine.engine.frame.sleepStats().wakes.input ?? 0).toBe(wakes);
      d.step();
      expect(d.outside()).toBe(false);
      expect(d.facet()).toMatchObject({ x: 400, y: 300, away: false });
    } finally { line.remove(); d.dispose(); }
  });

  it("once said, only the host clears it: back in the window over the sibling it stays away (an exit again says nothing more); back over the container, not away", async () => {
    const d = setup();
    const line = beside();
    try {
      fire(d.container, "pointermove", d.at(450, 320));
      d.step(2);
      fire(line, "pointerout", { ...d.at(450, 640), relatedTarget: null });
      await task();
      d.step();
      expect(d.facet()).toMatchObject({ away: true });
      // back in the window over the line: the document's pointerover, no related target — the desk hears no fact of its own
      fire(line, "pointerover", { ...d.at(450, 640), relatedTarget: null });
      fire(line, "pointermove", d.at(450, 630));
      await task();
      expect(d.queued()).toBe(0);
      d.step();
      expect(d.outside()).toBe(true);
      expect(d.facet()).toMatchObject({ x: 400, y: 300, away: true });
      // out again off the line, still away: nothing more
      fire(line, "pointerout", { ...d.at(450, 640), relatedTarget: null });
      await task();
      expect(d.queued()).toBe(0);
      // in again over the line, then onto the container: its enter is a move at its point
      fire(line, "pointerover", { ...d.at(450, 640), relatedTarget: null });
      fire(line, "pointerout", { ...d.at(450, 615), relatedTarget: d.container });
      fire(d.container, "pointerover", { ...d.at(450, 615), relatedTarget: line });
      fire(d.container, "pointerenter", { ...d.at(450, 615), relatedTarget: line }, false);
      expect(d.queued()).toBe(1);
      d.step();
      expect(d.outside()).toBe(false);
      expect(d.facet()).toMatchObject({ x: 400, y: 595, away: false });
    } finally { line.remove(); d.dispose(); }
  });

  it("out of the window off the container says exactly ONE leave — heard at the document and on the container, in either order", async () => {
    const d = setup();
    const canvas = document.createElement("canvas"); // what the desk draws in: the element under the pointer
    d.container.appendChild(canvas);
    try {
      fire(d.container, "pointermove", d.at(450, 320));
      d.step(2);
      // Chromium's order: the pointerout off the element under the pointer reaches the document first, then the container's pointerleave
      fire(canvas, "pointerout", { ...d.at(845, 320), relatedTarget: null });
      fire(d.container, "pointerleave", { ...d.at(845, 320), relatedTarget: null }, false);
      await task();
      expect(d.queued()).toBe(1);
      d.step();
      expect(d.facet()).toMatchObject({ x: 795, y: 300, away: true }); // the point it left, as I42 says it
      // back, and out again with the two heard the other way round: one leave again
      fire(d.container, "pointerenter", { ...d.at(845, 320), relatedTarget: null }, false);
      d.step();
      expect(d.facet()).toMatchObject({ away: false });
      fire(d.container, "pointerleave", { ...d.at(845, 330), relatedTarget: null }, false);
      fire(canvas, "pointerout", { ...d.at(845, 330), relatedTarget: null });
      await task();
      expect(d.queued()).toBe(1);
      d.step();
      expect(d.facet()).toMatchObject({ x: 795, y: 310, away: true });
    } finally { d.dispose(); }
  });

  it("says nothing with a press of ours live — off a sibling, or at the document", async () => {
    const d = setup();
    const line = beside();
    try {
      fire(d.container, "pointermove", d.at(450, 320));
      d.step(2);
      fire(d.container, "pointerdown", { ...d.at(450, 320), buttons: 1 });
      d.step();
      fire(line, "pointerout", { ...d.at(450, 640), buttons: 1, relatedTarget: null });
      fire(document, "pointerout", { ...d.at(450, 640), buttons: 1, relatedTarget: null });
      await task();
      expect(d.engine.stack.queue.drain().map((e) => e.kind)).toEqual([]);
      fire(d.container, "pointerup", { ...d.at(450, 320), buttons: 0 });
      d.step();
      expect(d.outside()).toBe(false);
    } finally { line.remove(); d.dispose(); }
  });

  it("detach unwires the document: every listener it added is removed, a leave waiting is never said, and a late exit enqueues nothing", async () => {
    const added = vi.spyOn(document, "addEventListener");
    const removed = vi.spyOn(document, "removeEventListener");
    const d = setup();
    const line = beside();
    const ours = (calls: unknown[][]): unknown[][] => calls.filter(([type]) => type === "pointerout" || type === "pointerover");
    try {
      expect(ours(added.mock.calls)).toHaveLength(2);
      fire(d.container, "pointermove", d.at(450, 320));
      d.step(2);
      // a leave waiting at detach is never said
      fire(line, "pointerout", { ...d.at(450, 640), relatedTarget: null });
      d.detach();
      expect(ours(removed.mock.calls)).toEqual(ours(added.mock.calls));
      d.engine.stack.queue.drain();
      await task();
      expect(d.queued()).toBe(0);
      // a late exit, off the sibling or at the document: nothing hears it
      fire(line, "pointerout", { ...d.at(450, 640), relatedTarget: null });
      fire(document, "pointerout", { ...d.at(450, 640), relatedTarget: null });
      await task();
      expect(d.queued()).toBe(0);
      expect(d.outside()).toBe(false);
    } finally { added.mockRestore(); removed.mockRestore(); line.remove(); d.dispose(); }
  });
});
