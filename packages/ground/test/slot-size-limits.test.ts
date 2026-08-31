/**
 * A SLOT REQUEST THE ALLOCATOR MUST REFUSE (design-012 §11 Q3: pages "respect
 * device limits").
 *
 * `fboPixelSize` is unbounded — `world × dpr × band` grows with the zoom band,
 * so a big card a few bands in asks for a slot no page can hold. The allocator
 * answers honestly (`place` → false, the slot restored at its PREVIOUS size,
 * non-resident), and the binder used to throw that answer away: it recorded
 * the new size in its change guard regardless, so the slot was never re-placed
 * and every later copy of a now-larger element landed at the old rect's
 * origin — the copy takes no extent, so those pixels run across the 2 px
 * gutters into whatever is packed next door.
 *
 * Two things are checked here, and they are not the same thing: that the
 * REQUEST is held inside the device limit (so the refusal does not arise), and
 * that a refusal, if one ever does, leaves consistent state instead of a
 * permanently mismatched slot.
 */
import { createCompositorSourceRegistry, type Entity } from "@ice/core";
import { describe, expect, it } from "vitest";
import { createDomSourceBinder } from "../src/compositor/dom-source-binder";
import type { CompositeFrame } from "../src/compositor/widget-quad-pass";

/** Enough GPUDevice for the atlas, recording every element copy it is asked for. */
function fakeDevice() {
  const copies: Array<{ element: unknown; origin: { x: number; y: number } }> = [];
  const device = {
    createTexture: ({ size }: { size: { width: number; height: number } }) => ({
      width: size.width,
      height: size.height,
      destroy: () => {},
    }),
    createCommandEncoder: () => ({
      copyTextureToTexture: () => {},
      finish: () => ({}),
    }),
    queue: {
      submit: () => {},
      // The real HiC door, so the copies are observable: it writes the
      // ELEMENT's own device size at this origin, with no extent to clip it.
      copyElementImageToTexture: (
        source: { source: unknown },
        destination: { destination: { origin: { x: number; y: number } } },
      ) => {
        copies.push({ element: source.source, origin: destination.destination.origin });
      },
    },
  };
  return { device: device as unknown as GPUDevice, copies };
}

const entity = (n: number): Entity => n as unknown as Entity;

const at = (zoom: number): CompositeFrame => ({
  width: 1600,
  height: 1200,
  dpr: 2,
  camera: { x: 0, y: 0, zoom },
});

/** One card, on an atlas whose pages may not exceed `maxPageSize`. */
function board(maxPageSize: number) {
  const registry = createCompositorSourceRegistry();
  const host = { id: 0 };
  registry.register(entity(0), { kind: "dom", host });
  const { device, copies } = fakeDevice();
  const binder = createDomSourceBinder(device, registry, () => ({ w: 100, h: 60 }), {
    maxPageSize,
  });
  const slot = () => binder.atlas.allocator.get(entity(0));
  return { binder, copies, slot, host: host as unknown as Element };
}

describe("a slot request is held inside the device limit", () => {
  it("clamps an over-limit card to a page-sized slot, keeping its proportions", () => {
    // gutter 2 on each side ⇒ 508 is the largest slot a 512 page can hold.
    const { binder, slot } = board(512);
    binder.sync(at(1)); // band 1: 100x60 world at dpr 2 ⇒ 200x120, comfortably under
    expect(slot()?.rect.width).toBe(200);

    // Band 4 asks for 800x480 — bigger than any page this device allows.
    binder.sync(at(4));
    // Clamped UNIFORMLY: 800 -> 508, and the height follows the same ratio, so
    // the card loses resolution and not its shape. Before the fix the request
    // was refused, the slot stayed at its old 200x120 rect, and the guard
    // recorded 800x480 — a mismatch nothing would ever retry.
    expect(slot()?.rect.width).toBe(508);
    expect(slot()?.rect.height).toBe(304);
    expect(binder.bandOf(entity(0))).toBe(4);
  });

  it("leaves a card under the limit exactly as the band sized it", () => {
    // The control: the clamp must be a ceiling, not a policy. Same card, a
    // device that can hold it.
    const { binder, slot } = board(8192);
    binder.sync(at(4));
    expect(slot()?.rect.width).toBe(800);
    expect(slot()?.rect.height).toBe(480);
  });

  it("keeps the copy inside the slot the binder actually asked for", () => {
    const { binder, copies, slot, host } = board(512);
    binder.sync(at(1));
    binder.sync(at(4));
    copies.length = 0;

    binder.markDirtyHosts([host]);
    binder.sync(at(4));
    expect(copies).toHaveLength(1);
    const rect = slot();
    // The destination origin is the CURRENT slot's, and that slot is the size
    // the binder requested. Before the fix the two had parted company: the
    // copy landed at a 200x120 rect while the binder believed it had placed
    // 800x480, so the element's pixels ran off the end of it.
    expect(copies[0]?.origin).toMatchObject({ x: rect?.rect.x, y: rect?.rect.y });
    expect(rect?.rect.width).toBe(508);

    // And the state stays settled: a matched guard means no re-slot churn.
    const settled = binder.copies();
    for (let i = 0; i < 20; i++) binder.sync(at(4));
    expect(binder.copies()).toBe(settled);
    expect(binder.pending()).toBe(0);
  });
});
