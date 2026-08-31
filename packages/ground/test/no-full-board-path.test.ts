/**
 * THE FULL-BOARD REPAINT MUST NOT EXIST (design-012 §8 gate 2, plan §5 S4-3).
 *
 * A full-board repaint of 200 cards costs 111 ms — about 13 display frames.
 * The design's response is not "avoid it": it is that no such code path exists
 * to be reached, so nobody can add a call to one later. That is a claim about
 * ABSENCE, and absence needs two kinds of check, because each misses what the
 * other catches:
 *
 *  1. BEHAVIOURAL — the binder is driven twice over a settled board and must
 *     copy nothing the second time. This is the check that matters: it caught
 *     the real defect, which was `sync` calling `allocate` for every source
 *     every frame (allocate marks a resident slot STALE, so every composite
 *     re-uploaded the whole board — the forbidden path, arriving by accident
 *     rather than by design).
 *  2. GREP — no exported "repaint everything" verb exists to invite one. A
 *     behavioural test cannot see an API nobody calls yet.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createCompositorSourceRegistry, type Entity } from "@ice/core";
import { describe, expect, it } from "vitest";
import { createDomSourceBinder } from "../src/compositor/dom-source-binder";
import type { CompositeFrame } from "../src/compositor/widget-quad-pass";

// `import.meta.url` is not a file URL under happy-dom; vitest runs with the
// package root as cwd.
const compositorDir = join(process.cwd(), "src", "compositor");

/** Enough GPUDevice for the atlas: it allocates textures and encodes copies. */
function fakeDevice() {
  const textures: Array<{ width: number; height: number; destroyed: boolean }> = [];
  const device = {
    createTexture: ({ size }: { size: { width: number; height: number } }) => {
      const t = {
        width: size.width,
        height: size.height,
        destroyed: false,
        destroy() {
          t.destroyed = true;
        },
      };
      textures.push(t);
      return t;
    },
    createCommandEncoder: () => ({
      copyTextureToTexture: () => {},
      finish: () => ({}),
    }),
    // No `copyElementImageToTexture`: the adapter degrades rather than throwing,
    // which is exactly what a headless test needs — the SCHEDULING is under
    // test here, not the pixels.
    queue: { submit: () => {} },
  };
  return { device: device as unknown as GPUDevice, textures };
}

const frame: CompositeFrame = {
  width: 1600,
  height: 1200,
  dpr: 2,
  camera: { x: 0, y: 0, zoom: 1 },
};

const entity = (n: number): Entity => n as unknown as Entity;

describe("no full-board repaint path exists", () => {
  function board(n: number) {
    const registry = createCompositorSourceRegistry();
    const hosts: Array<{ id: number }> = [];
    for (let i = 0; i < n; i++) {
      const host = { id: i };
      hosts.push(host);
      registry.register(entity(i), { kind: "dom", host });
    }
    const { device } = fakeDevice();
    const binder = createDomSourceBinder(
      device,
      registry,
      () => ({ w: 100, h: 60 }),
      { firstPageSize: { width: 2048, height: 2048 } },
    );
    return { registry, binder, hosts };
  }

  it("copies each card ONCE, then nothing, however many times it is driven", () => {
    const { binder } = board(24);
    binder.sync(frame);
    const afterFirst = binder.copies();
    expect(afterFirst).toBe(24);

    for (let i = 0; i < 30; i++) binder.sync(frame);
    // THE PROPERTY: a settled board owes nothing. Before the fix this read 744.
    expect(binder.copies()).toBe(afterFirst);
    expect(binder.pending()).toBe(0);
  });

  it("does not re-copy while the camera PANS — only a zoom changes slot sizes", () => {
    const { binder } = board(12);
    binder.sync(frame);
    const settled = binder.copies();
    for (let i = 1; i <= 60; i++) {
      binder.sync({ ...frame, camera: { x: i * 7, y: i * 3, zoom: 1 } });
    }
    expect(binder.copies()).toBe(settled);
  });

  it("does not re-copy for a zoom INSIDE the band's window — hysteresis", () => {
    // Bands are powers of two and each covers a 4x display range, so zooming
    // from 1 to 2 stays in band: `isOutOfBand` is ratio > 2 || ratio < 0.5, and
    // 2 is not > 2. The quad samples the same slot at a different scale, which
    // is what the linear filter and the 2 px gutters are for. Before bands,
    // every frame of a continuous zoom re-slotted and re-copied the board.
    const { binder } = board(12);
    binder.sync(frame);
    const settled = binder.copies();
    for (const zoom of [1.1, 1.5, 1.9, 2]) {
      binder.sync({ ...frame, camera: { x: 0, y: 0, zoom } });
    }
    expect(binder.copies()).toBe(settled);
    expect(binder.bandOf(entity(0))).toBe(1);
  });

  it("DOES re-copy when the zoom leaves the band — the honest exception", () => {
    // The counterpart: if nothing ever re-copied, the tests above would pass
    // for the wrong reason. Crossing the edge re-bands and re-slots ONCE.
    const { binder } = board(12);
    binder.sync(frame);
    const settled = binder.copies();
    binder.sync({ ...frame, camera: { x: 0, y: 0, zoom: 3 } });
    expect(binder.copies()).toBe(settled + 12);
    expect(binder.bandOf(entity(0))).toBe(4);
    // …and then holds the new band across the rest of the gesture.
    const afterBand = binder.copies();
    for (const zoom of [3.5, 4, 5, 6, 7.9]) {
      binder.sync({ ...frame, camera: { x: 0, y: 0, zoom } });
    }
    expect(binder.copies()).toBe(afterBand);
  });

  it("sizes a slot at bounds x dpr x band, the island pool's own formula", () => {
    const { binder } = board(1);
    binder.sync(frame); // dpr 2, zoom 1 -> band 1
    const slot = binder.atlas.allocator.get(entity(0));
    // 100x60 world at dpr 2, band 1.
    expect(slot?.rect.width).toBe(200);
    expect(slot?.rect.height).toBe(120);
  });

  it("only copies the cards a paint event NAMED", () => {
    const { binder, hosts } = board(24);
    binder.sync(frame);
    const settled = binder.copies();
    binder.markDirtyHosts([hosts[3] as unknown as Element, hosts[7] as unknown as Element]);
    binder.sync(frame);
    expect(binder.copies()).toBe(settled + 2);
  });

  it("honours a copy budget, and still finishes", () => {
    const { binder, hosts } = board(20);
    binder.sync(frame);
    binder.setCopyBudget(3);
    binder.markDirtyHosts(hosts as unknown as Element[]);
    const before = binder.copies();
    binder.sync(frame);
    // Budgeted: a bulk arrival cannot spend a whole frame on copies.
    expect(binder.copies() - before).toBe(3);
    // And it is DEFERRED, not dropped — `pending` is what keeps the compositor
    // awake until the board is complete.
    expect(binder.pending()).toBe(17);
    for (let i = 0; i < 10; i++) binder.sync(frame);
    expect(binder.pending()).toBe(0);
    expect(binder.copies() - before).toBe(20);
  });

  it("exposes no 'repaint everything' verb for anyone to reach for", () => {
    // A behavioural test cannot see an API that nothing calls YET. This can.
    const forbidden =
      /\b(repaintAll|redrawAll|refreshAll|markAllDirty|invalidateAllSlots|uploadAll|copyAllSlots|recopyBoard|fullRepaint)\b/;
    const offenders: string[] = [];
    for (const file of readdirSync(compositorDir)) {
      if (!file.endsWith(".ts")) continue;
      const source = readFileSync(join(compositorDir, file), "utf8");
      if (forbidden.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("never calls the atlas flush without a budget", () => {
    // `flush()` with no argument falls back to the allocator's own default,
    // which is Infinity — a full-board drain in one frame. The binder must
    // always pass its budget.
    const source = readFileSync(join(compositorDir, "dom-source-binder.ts"), "utf8");
    expect(source).toMatch(/atlas\.flush\(budget\)/);
    expect(source).not.toMatch(/atlas\.flush\(\s*\)/);
  });
});
