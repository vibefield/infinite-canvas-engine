import { ZOOM_BANDS, type Rect, type SlotSize } from "@ice/kernel";
import type { Entity } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import {
  bandIndexOf,
  createLayerAllocator,
  DEFAULT_LAYER_SIZE,
  packKey,
  type LayerAllocator,
  type ResidencyKey,
  unpackKey,
} from "../../src/residency/layer-allocator";

const G = 2;
const ent = (n: number): Entity => n as Entity;
const key = (n: number, band = 1): ResidencyKey => packKey(ent(n), band);
const sq = (n: number): SlotSize => ({ width: n, height: n });

/** 168 CSS px at dpr 2 — the hic-bench board, and the paged allocator's fixture. */
const BENCH = sq(336);

/**
 * The invariant the module exists to hold, checked against the LIVE keys the
 * caller believes it holds: every slot inside its layer's margins, no two
 * closer than a gutter, and no slot on a layer that is not there.
 */
function checkInvariants(alloc: LayerAllocator, live: Iterable<ResidencyKey>, layerSize: number): string | null {
  const known = new Map(alloc.layers().map((l) => [l.id, l]));
  const byLayer = new Map<number, { key: ResidencyKey; rect: Rect }[]>();
  for (const k of live) {
    const placement = alloc.get(k);
    if (placement === undefined) return `key ${k} is live but holds no slot`;
    const layer = known.get(placement.layer);
    if (layer === undefined) return `key ${k} sits on layer ${placement.layer}, which is retired or unknown`;
    if (layer.width !== layerSize || layer.height !== layerSize) {
      return `layer ${layer.id} is ${layer.width}x${layer.height} — a layer never grows`;
    }
    const list = byLayer.get(placement.layer) ?? [];
    list.push({ key: k, rect: placement.rect });
    byLayer.set(placement.layer, list);
  }
  for (const [id, list] of byLayer) {
    for (let i = 0; i < list.length; i++) {
      const a = (list[i] as { rect: Rect }).rect;
      if (a.x < G || a.y < G) return `slot ${JSON.stringify(a)} on layer ${id} breaks the top/left margin`;
      if (a.x + a.width + G > layerSize) return `slot ${JSON.stringify(a)} on layer ${id} breaks the right margin`;
      if (a.y + a.height + G > layerSize) return `slot ${JSON.stringify(a)} on layer ${id} breaks the bottom margin`;
      for (let j = i + 1; j < list.length; j++) {
        const b = (list[j] as { rect: Rect }).rect;
        const apart =
          a.x + a.width + G <= b.x ||
          b.x + b.width + G <= a.x ||
          a.y + a.height + G <= b.y ||
          b.y + b.height + G <= a.y;
        if (!apart) return `slots ${JSON.stringify(a)} and ${JSON.stringify(b)} on layer ${id} are closer than ${G}px`;
      }
    }
  }
  return null;
}

describe("the (entity, band) key", () => {
  it("round-trips every band, at the largest entity handle a u32 can carry", () => {
    const big = ent(2 ** 32 - 1);
    for (const band of ZOOM_BANDS) {
      const k = packKey(big, band);
      expect(Number.isSafeInteger(k)).toBe(true);
      expect(unpackKey(k)).toEqual({ entity: big, band });
    }
  });

  it("never collides across entities and bands", () => {
    const keys = new Set<ResidencyKey>();
    for (let e = 1; e <= 64; e++) {
      for (const band of ZOOM_BANDS) keys.add(packKey(ent(e), band));
    }
    expect(keys.size).toBe(64 * ZOOM_BANDS.length);
  });

  it("indexes the ladder, and refuses a number that is not a band", () => {
    expect(bandIndexOf(0.0625)).toBe(0);
    expect(bandIndexOf(1)).toBe(4);
    expect(bandIndexOf(16)).toBe(8);
    expect(ZOOM_BANDS.length).toBeLessThanOrEqual(16);
    expect(() => bandIndexOf(3)).toThrow(/not a zoom band/);
    expect(() => packKey(ent(7), 3)).toThrow(/not a zoom band/);
  });
});

describe("allocate — placement, gutters, and the fixed layer", () => {
  it("places the first slot inside the top/left margin of a full-size layer", () => {
    const alloc = createLayerAllocator();
    expect(alloc.allocate(key(1), BENCH)).toEqual({
      layer: 0,
      rect: { x: G, y: G, width: 336, height: 336 },
    });
    expect(alloc.layers()).toMatchObject([
      { id: 0, width: DEFAULT_LAYER_SIZE, height: DEFAULT_LAYER_SIZE, heldSlots: 1 },
    ]);
  });

  it("keeps a gutter at every edge and between every pair of neighbours", () => {
    const alloc = createLayerAllocator({ layerSize: 1024 });
    const live: ResidencyKey[] = [];
    for (let i = 0; i < 12; i++) {
      const k = key(i + 1);
      expect(alloc.allocate(k, sq(180 + (i % 4) * 40))).not.toBeNull();
      live.push(k);
    }
    expect(checkInvariants(alloc, live, 1024)).toBeNull();
  });

  it("opens another layer rather than growing one", () => {
    const alloc = createLayerAllocator({ layerSize: 512 });
    for (let i = 0; i < 4; i++) expect(alloc.allocate(key(i + 1), sq(250))?.layer).toBe(0);
    expect(alloc.allocate(key(5), sq(250))?.layer).toBe(1);
    expect(alloc.layers().map((l) => ({ w: l.width, h: l.height }))).toEqual([
      { w: 512, h: 512 },
      { w: 512, h: 512 },
    ]);
  });

  it("refuses a slot larger than layerSize - 2*gutter on either axis, and opens nothing", () => {
    const alloc = createLayerAllocator({ layerSize: 512 });
    expect(alloc.fits(sq(508))).toBe(true);
    expect(alloc.fits({ width: 509, height: 10 })).toBe(false);
    expect(alloc.fits({ width: 10, height: 509 })).toBe(false);
    expect(alloc.fits(sq(0))).toBe(false);
    expect(alloc.allocate(key(1), { width: 509, height: 10 })).toBeNull();
    expect(alloc.allocate(key(2), { width: 10, height: 509 })).toBeNull();
    expect(alloc.layers()).toHaveLength(0);
    expect(alloc.held()).toBe(0);
    // …and the largest slot that does fit is placed, in one layer.
    expect(alloc.allocate(key(3), sq(508))).not.toBeNull();
    expect(alloc.layers()).toHaveLength(1);
  });

  it("returns null once maxLayers is reached, leaving every held slot alone", () => {
    const alloc = createLayerAllocator({ layerSize: 512, maxLayers: 1 });
    for (let i = 0; i < 4; i++) expect(alloc.allocate(key(i + 1), sq(250))).not.toBeNull();
    const before = alloc.get(key(1));

    expect(alloc.allocate(key(5), sq(250))).toBeNull();
    expect(alloc.layers()).toHaveLength(1);
    expect(alloc.held()).toBe(4);
    expect(alloc.get(key(1))).toEqual(before);

    // The caller evicts and retries — the documented recovery.
    expect(alloc.free(key(1))).toBe(true);
    expect(alloc.allocate(key(5), sq(250))).toEqual(before);
  });
});

describe("re-allocating a held key", () => {
  it("at the same size is a no-op returning the same placement", () => {
    const alloc = createLayerAllocator({ layerSize: 1024 });
    const first = alloc.allocate(key(1), BENCH);
    expect(alloc.allocate(key(1), BENCH)).toEqual(first);
    expect(alloc.held()).toBe(1);
    expect(alloc.waste().slotArea).toBe(336 * 336);
  });

  it("at a new size re-places it and hands the old space back", () => {
    const alloc = createLayerAllocator({ layerSize: 1024 });
    const first = alloc.allocate(key(1), sq(200));
    alloc.allocate(key(2), sq(200));

    const grown = alloc.allocate(key(1), sq(400));
    expect(grown?.rect.width).toBe(400);
    expect(grown?.rect).not.toEqual(first?.rect);
    expect(alloc.held()).toBe(1 + 1);
    expect(alloc.get(key(1))).toEqual(grown);
    expect(alloc.waste().slotArea).toBe(400 * 400 + 200 * 200);
    // The released rect is reusable.
    expect(alloc.allocate(key(3), sq(200))?.rect).toEqual(first?.rect);
  });

  it("keeps the slot at its old size when the new one cannot be placed", () => {
    const alloc = createLayerAllocator({ layerSize: 512, maxLayers: 1 });
    for (let i = 0; i < 4; i++) alloc.allocate(key(i + 1), sq(250));

    expect(alloc.allocate(key(1), sq(500))).toBeNull();
    const kept = alloc.get(key(1));
    expect(kept?.rect.width).toBe(250);
    expect(kept?.rect.height).toBe(250);
    expect(alloc.held()).toBe(4);
    expect(checkInvariants(alloc, [key(1), key(2), key(3), key(4)], 512)).toBeNull();
    // …and it kept the SPACE, not just the record: the layer is still full.
    expect(alloc.allocate(key(9), sq(250))).toBeNull();
  });
});

describe("the two doors", () => {
  it("free returns a slot's space and answers false for a key it never held", () => {
    const alloc = createLayerAllocator({ layerSize: 1024 });
    const a = alloc.allocate(key(1), sq(300));
    alloc.allocate(key(2), sq(300));
    expect(alloc.free(key(1))).toBe(true);
    expect(alloc.free(key(1))).toBe(false);
    expect(alloc.get(key(1))).toBeUndefined();
    expect(alloc.held()).toBe(1);
    expect(alloc.allocate(key(3), sq(300))?.rect).toEqual(a?.rect);
  });

  it("free alone never retires a layer — that is the other door", () => {
    const alloc = createLayerAllocator({ layerSize: 512 });
    alloc.allocate(key(1), sq(250));
    expect(alloc.free(key(1))).toBe(true);
    expect(alloc.layers()).toMatchObject([{ id: 0, heldSlots: 0, usedArea: 0 }]);
  });

  it("retireEmpty drops only the layers holding nothing, and never renumbers the rest", () => {
    const alloc = createLayerAllocator({ layerSize: 512 });
    for (let i = 0; i < 12; i++) alloc.allocate(key(i + 1), sq(250));
    expect(alloc.layers().map((l) => l.id)).toEqual([0, 1, 2]);

    // Layer 1 holds keys 5..8 — empty exactly that one.
    for (let i = 4; i < 8; i++) expect(alloc.free(key(i + 1))).toBe(true);
    expect(alloc.layers().map((l) => l.heldSlots)).toEqual([4, 0, 4]);

    expect(alloc.retireEmpty()).toEqual([1]);
    expect(alloc.layers().map((l) => l.id)).toEqual([0, 2]);
    expect(alloc.retireEmpty()).toEqual([]);
    expect(alloc.held()).toBe(8);
    expect(checkInvariants(alloc, [key(1), key(9)], 512)).toBeNull();

    // Ids are monotonic: a retired id is never handed out again.
    expect(alloc.allocate(key(13), sq(250))?.layer).toBe(3);
  });

  it("retires every empty layer, keeping none standing", () => {
    const alloc = createLayerAllocator({ layerSize: 512 });
    for (let i = 0; i < 8; i++) alloc.allocate(key(i + 1), sq(250));
    for (let i = 0; i < 8; i++) alloc.free(key(i + 1));
    expect(alloc.retireEmpty()).toEqual([0, 1]);
    expect(alloc.layers()).toEqual([]);
    expect(alloc.waste().layerArea).toBe(0);
    // …and the emptied allocator still works.
    expect(alloc.allocate(key(1), sq(250))?.layer).toBe(2);
  });
});

describe("the waste instrument", () => {
  it("reports zeroes before anything is allocated", () => {
    expect(createLayerAllocator().waste()).toEqual({
      layers: 0,
      slots: 0,
      slotArea: 0,
      occupiedArea: 0,
      layerArea: 0,
      holeArea: 0,
      packingWastePct: 0,
      allocationWastePct: 0,
      fragmentationPct: 0,
    });
  });

  /**
   * THE STATED BOUND, inherited. The spike's uniform-card atlas paid 19.5 %
   * gutter waste (hic-bench FINDINGS §6: a 3744² square atlas over 100 × 336²
   * cards) and the paged allocator's bound was 12 % (measured 9.45 %). Fixed
   * 2048² layers hold the same board at 2.24 % on a full layer, because the
   * layer stops being sized to the board: what a shelf packer wastes is the
   * ragged tail, and a fixed layer's tail is one partial shelf.
   */
  it("holds packing waste under 12 % on the uniform 168x168 dpr-2 board", () => {
    const alloc = createLayerAllocator();
    for (let i = 0; i < 36; i++) expect(alloc.allocate(key(i + 1), BENCH)?.layer).toBe(0);
    expect(alloc.layers()).toHaveLength(1);

    const w = alloc.waste();
    expect(w.slots).toBe(36);
    expect(w.slotArea).toBe(36 * 336 * 336);
    expect(w.occupiedArea).toBe(2048 * 2030); // six shelves of 336, gutters included
    expect(w.packingWastePct).toBeLessThan(0.12);
    expect(w.packingWastePct).toBeCloseTo(0.0224, 4);
    expect(w.fragmentationPct).toBe(0);

    // The 37th card opens the next layer; the whole 100-card board stays under
    // the bound in aggregate.
    for (let i = 36; i < 100; i++) alloc.allocate(key(i + 1), BENCH);
    const full = alloc.waste();
    expect(full.layers).toBe(3);
    expect(full.slots).toBe(100);
    expect(full.packingWastePct).toBeLessThan(0.12);
    expect(full.packingWastePct).toBeCloseTo(0.0416, 4);
  });

  it("counts every layer as committed, because a fixed layer commits in full", () => {
    const alloc = createLayerAllocator({ layerSize: 512 });
    for (let i = 0; i < 5; i++) alloc.allocate(key(i + 1), sq(250));
    const w = alloc.waste();
    expect(w.layers).toBe(2);
    expect(w.layerArea).toBe(2 * 512 * 512);
    expect(w.allocationWastePct).toBeCloseTo(1 - (5 * 250 * 250) / (2 * 512 * 512), 6);
  });

  it("per-layer reports mirror the kernel's own instrument", () => {
    const alloc = createLayerAllocator({ layerSize: 512 });
    alloc.allocate(key(1), sq(250));
    alloc.allocate(key(2), sq(250));
    alloc.allocate(key(3), sq(250));
    alloc.free(key(1));

    const [layer] = alloc.layers();
    expect(layer?.heldSlots).toBe(2);
    expect(layer?.usedArea).toBe(2 * 250 * 250);
    expect(layer?.waste.usedArea).toBe(layer?.usedArea);
    expect(layer?.waste.holeArea).toBeGreaterThan(0); // key 1's band, back on the free list
    expect(layer?.waste.pageArea).toBe(512 * 512);
    expect(alloc.waste().holeArea).toBe(layer?.waste.holeArea);
  });
});

describe("the sweep", () => {
  it("never lets two live slots overlap on a layer, across 300 mixed operations", () => {
    const LAYER = 512;
    const alloc = createLayerAllocator({ layerSize: LAYER });
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    const live = new Set<ResidencyKey>();
    let next = 0;
    let retiredEver = 0;
    const size = (): SlotSize => ({
      width: 16 + Math.floor(rand() * 400),
      height: 16 + Math.floor(rand() * 400),
    });

    const OPS = 300;
    for (let op = 0; op < OPS; op++) {
      const roll = rand();
      const band = ZOOM_BANDS[Math.floor(rand() * ZOOM_BANDS.length)] as number;
      if (roll < 0.5) {
        const k = packKey(ent(++next), band);
        const s = size();
        expect(alloc.fits(s)).toBe(true);
        if (alloc.allocate(k, s) !== null) live.add(k);
      } else if (roll < 0.7 && live.size > 0) {
        const k = [...live][Math.floor(rand() * live.size)] as ResidencyKey;
        expect(alloc.free(k)).toBe(true);
        live.delete(k);
      } else if (roll < 0.85 && live.size > 0) {
        // Re-slot in place: a resize, or a dpr change at the same band.
        const k = [...live][Math.floor(rand() * live.size)] as ResidencyKey;
        alloc.allocate(k, size());
      } else {
        retiredEver += alloc.retireEmpty().length;
      }

      // Every fourth op, and always the last: nothing repairs an overlap on its
      // own, so a violation survives until it is looked for, and the pairwise
      // sweep is quadratic.
      if (op % 4 !== 0 && op !== OPS - 1) continue;
      expect(checkInvariants(alloc, live, LAYER), `op ${op}`).toBeNull();
      expect(alloc.held(), `op ${op}`).toBe(live.size);
      const perLayer = alloc.layers().reduce((n, l) => n + l.heldSlots, 0);
      expect(perLayer, `op ${op}: layers disagree with the slot table`).toBe(live.size);
    }

    // The sweep is worth running only if it actually exercised both doors.
    expect(live.size).toBeGreaterThan(10);
    expect(alloc.layers().length).toBeGreaterThan(1);
    expect(retiredEver).toBeGreaterThan(0);
  });
});
