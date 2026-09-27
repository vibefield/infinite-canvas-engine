// THE BOOKS' LAYERS (K7a — design-016 §6 K7): the two layered kinds draw their layer only as far as it must be — the notebook's
// SHADOW MAPS are kept while the lamp and the book stand still (the lamp stands in world space and the eye is not in the map: a
// pan draws none); their 4× targets are the books' SCREEN BOX, never the canvas; a layer nothing of which moved is laid again
// undrawn (a frame drawn for another object's sake with the wind still). On the fake device every render pass the desk
// begins is logged by label, and every texture it makes is kept with its size, so what a frame drew and holds is counted.

import { Camera, type Entity } from "@ice/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BOX_STEP } from "@ice/desk/kit";
import { type DeskMount, mountDesk } from "./desk-mount";

describe("the books' layers (K7a)", () => {
  let desk: DeskMount;
  let book: Entity;
  beforeAll(async () => {
    desk = await mountDesk();
    book = desk.ce.ops.spawnWidget("desk.notebook", { x: 500, y: 350 });
    desk.ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    desk.toSleep();
  });
  afterAll(() => { desk?.dispose(); });
  /** The passes logged since `from`, by label. */
  const passes = (from: number, label: string): number => desk.log.slice(from).filter((l) => l === `pass ${label}`).length;
  /** A camera moved from outside, then the frames it takes. */
  const pan = (dx: number): void => {
    const cam = desk.ce.world.getResource(Camera);
    desk.ce.world.setResource(Camera, { x: (cam?.x ?? 0) + dx, y: cam?.y ?? 0, zoom: cam?.zoom ?? 1, gesturing: false });
    desk.toSleep();
  };

  it("a pan re-renders the layer (the desk eye moves with it) but draws no shadow map; a book turned draws its map again", () => {
    const from = desk.log.length;
    for (let i = 0; i < 5; i++) pan(3);
    expect(passes(from, "notebook/layer"), "the layer: once a frame the camera moved").toBeGreaterThanOrEqual(5);
    expect(passes(from, "notebook/shadow 0"), "the shadow map: the lamp and the book stood").toBe(0);
    const turned = desk.log.length;
    desk.ce.ops.setWidgetProps(book, { angle: 0.2 });
    desk.toSleep();
    expect(passes(turned, "notebook/shadow 0"), "the book turned: its map drawn again").toBe(1);
  });

  it("a frame drawn for another object's sake lays the book's layer again UNDRAWN; a pan draws it", () => {
    desk.handle.setAmbient("still");   // the wind still: the slot's view block stands between frames
    const note = desk.ce.ops.spawnWidget("desk.note", { x: 100, y: 100 });
    desk.ce.ops.spawnWidget("desk.calendar", { x: 950, y: 450 });
    desk.toSleep();
    expect(passes(0, "calendar/layer"), "the pad's layer drawn").toBeGreaterThan(0);
    const from = desk.log.length;
    const redraws = desk.handle.redraws();
    desk.ce.ops.setSelection([note]);   // the note selected: its marks move, nothing of the book's
    desk.toSleep();
    expect(desk.handle.redraws(), "the frame was drawn").toBeGreaterThan(redraws);
    expect(passes(from, "notebook/layer"), "the book's layer: not drawn").toBe(0);
    expect(desk.log.slice(from).includes("pipeline notebook/composite"), "…but laid").toBe(true);
    expect(passes(from, "calendar/layer"), "the pad's layer: not drawn").toBe(0);
    expect(desk.log.slice(from).includes("pipeline calendar/composite"), "…but laid").toBe(true);
    const panned = desk.log.length;
    pan(4);
    expect(passes(panned, "notebook/layer"), "a pan: the layer drawn (the desk eye moved)").toBeGreaterThan(0);
    // the wind up, the camera still: the slot's view block moves (the clocks, the dapple the layer shows) — the layer is drawn
    desk.handle.setAmbient("live");
    const blown = desk.log.length;
    for (let i = 0; i < 4; i++) desk.step();
    expect(passes(blown, "notebook/layer"), "the wind: the layer drawn every frame").toBeGreaterThanOrEqual(3);
    desk.handle.setAmbient("still");
    desk.toSleep();
    // a pinned mat's noise offset moved: the slot's view block alone (no knob, no record, no silhouette) — the layer samples the
    // noise by it, so it is drawn (the view block is compared by content)
    desk.handle.pinMat({ time: 0, goboTime: 0, noise: [0.1, 0.2] });
    desk.toSleep();
    const noised = desk.log.length;
    desk.handle.pinMat({ time: 0, goboTime: 0, noise: [0.7, 0.4] });
    desk.toSleep();
    expect(passes(noised, "notebook/layer"), "the view block's noise moved: the layer drawn").toBeGreaterThan(0);
    desk.handle.pinMat(null);
    desk.toSleep();
  });

  it("the layer's targets are the book's screen box (rounded to BOX_STEP), never the canvas", () => {
    const live = (label: string) => desk.textures.filter((t) => t.label === label && !t.destroyed).map((t) => t.size as number[]);
    const [msaa] = live("notebook/layer ×4");
    const [depth] = live("notebook/depth ×4");
    const [resolve] = live("notebook/layer");
    expect(msaa, "the 4× layer is made").toBeDefined();
    // the canvas is 1200 × 800 (dpr 1); a closed book 180 × 252 with its shadow's reach: two BOX_STEPs a side at most
    for (const size of [msaa, depth, resolve]) {
      const [w = 0, h = 0] = size as number[];
      expect(w % BOX_STEP === 0 && h % BOX_STEP === 0, `rounded to the step: ${w} × ${h}`).toBe(true);
      expect(w <= 2 * BOX_STEP && h <= 2 * BOX_STEP, `a box, not the 1200 × 800 canvas: ${w} × ${h}`).toBe(true);
    }
  });
});
