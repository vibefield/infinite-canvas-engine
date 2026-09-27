// THE BOOKS' LAYERS (K7a — design-016 §6 K7): the two layered kinds draw their layer only as far as it must be — the notebook's
// SHADOW MAPS are kept while the lamp and the book stand still (the lamp stands in world space and the eye is not in the map: a
// pan draws none); … On the fake device every render pass the desk begins is logged by label, so what a frame drew is counted.

import { Camera, type Entity } from "@ice/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
});
