/**
 * Residency (infra) — the ONE writer of `TextureRef` (design-013 §5, §6 step 4).
 *
 * The statement under test is §6.4's invariant, and it is checked as a PROPERTY
 * over a seeded walk rather than at hand-picked points, because the interesting
 * states are the combinations: a card that is culled while retained, at a band
 * it crossed two zooms ago, whose size changed while it was off-screen. Nobody
 * picks those.
 *
 *   `TextureRef.texture ≠ 0` ⇔ `effectiveTarget = gpu` ∧ `band > 0`
 *                              ∧ a destination is held for `(entity, band)`
 *
 * "A destination is held" is checked against the ALLOCATOR and the TABLE, not
 * against the system's own bookkeeping — a system agreeing with itself proves
 * nothing. For an atlas slot the uv is re-derived from the allocator's rect, so
 * a uv that drifts from the slot it names fails here. That is the zoom-drift
 * class (§7 row one) checked from the residency end.
 */
import { geometry, ZOOM_BANDS } from "@ice/kernel";
import { createWorld, type Entity, type World } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import {
  Camera,
  createEngine,
  createLayerAllocator,
  createTextureTable,
  Culled,
  effectiveTarget,
  installSurfaceInfra,
  packKey,
  Position,
  Retained,
  Size,
  SurfaceBand,
  SurfaceKind,
  SurfaceTarget,
  TextureRef,
  Viewport,
  Visible,
  type LayerAllocator,
  type TextureTable,
} from "../../src";

const LAYER = 512;
const GENEROUS = 64 * 1024 * 1024;

interface RigOpts {
  layerSize?: number;
  maxLayers?: number;
  budgetBytes?: number;
  raster?: (kind: "dom" | "gl" | "video") => "band" | "crisp";
}

interface CardOpts {
  kind?: "dom" | "gl" | "video";
  target?: "dom" | "gpu";
  visible?: boolean;
  retained?: boolean;
  w?: number;
  h?: number;
}

interface Ref {
  texture: number;
  layer: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

function rig(opts: RigOpts = {}) {
  const layerSize = opts.layerSize ?? LAYER;
  const world: World = createWorld();
  const engine = createEngine(world);
  // A reflector arms reactivity — without one nothing journals and the churn
  // guard is fed an empty world (design-002 §4).
  engine.registerReflector({ name: "armed", observe: { resources: [Camera] }, flush: () => {} });

  const table: TextureTable = createTextureTable({ pageSize: layerSize });
  const allocator: LayerAllocator = createLayerAllocator({
    layerSize,
    maxLayers: opts.maxLayers ?? 8,
  });
  let clock = 0;
  installSurfaceInfra(engine, {
    residency: {
      table,
      allocator,
      budgetBytes: opts.budgetBytes ?? GENEROUS,
      now: () => clock,
      ...(opts.raster === undefined ? {} : { raster: opts.raster }),
    },
  });
  engine.enableTelemetry();
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  world.setResource(Viewport, { w: 800, h: 600, dpr: 2 });

  let t = 0;
  const step = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      t += 16;
      clock += 1;
      engine.step(t);
    }
  };
  const card = (o: CardOpts = {}): Entity =>
    world.spawn({
      components: [
        [Position, { x: 0, y: 0 }],
        [Size, { w: o.w ?? 80, h: o.h ?? 48 }],
        [SurfaceKind, { kind: o.kind ?? "dom" }],
        [SurfaceTarget, { target: o.target ?? (o.kind === undefined || o.kind === "dom" ? "gpu" : "gpu") }],
        [SurfaceBand, { band: 0 }],
        [TextureRef, { texture: 0, layer: 0, u0: 0, v0: 0, u1: 0, v1: 0 }],
      ],
      tags: [
        ...(o.visible === false ? [Culled] : [Visible]),
        ...(o.retained === true ? [Retained] : []),
      ],
    });

  const refOf = (e: Entity): Ref => {
    const r = world.get(e, TextureRef);
    return {
      texture: r?.texture ?? -1,
      layer: r?.layer ?? -1,
      u0: r?.u0 ?? -1,
      v0: r?.v0 ?? -1,
      u1: r?.u1 ?? -1,
      v1: r?.v1 ?? -1,
    };
  };
  const bandOf = (e: Entity): number => world.get(e, SurfaceBand)?.band ?? Number.NaN;
  const zoomTo = (z: number): void => {
    const cam = world.getResource(Camera);
    world.setResource(Camera, { ...(cam ?? { x: 0, y: 0, gesturing: false }), zoom: z });
  };
  const panBy = (dx: number, dy: number): void => {
    const cam = world.getResource(Camera);
    if (cam !== undefined) world.setResource(Camera, { ...cam, x: cam.x + dx, y: cam.y + dy });
  };
  const setTarget = (e: Entity, target: "dom" | "gpu"): void => {
    world.edit(e).set(SurfaceTarget, { target });
  };
  const cull = (e: Entity): void => {
    world.removeTag(e, Visible);
    world.addTag(e, Culled);
  };
  const show = (e: Entity): void => {
    world.removeTag(e, Culled);
    world.addTag(e, Visible);
  };
  const ran = (name: string): boolean | undefined =>
    engine.lastFrame()?.systems.find((s) => s.system === name)?.ran;
  const order = (): string[] =>
    (engine.lastFrame()?.systems ?? []).map((s) => s.system as string);

  /** §6.4, checked against the allocator and the table — never against the system. */
  const checkInvariant = (e: Entity): string | null => {
    const ref = refOf(e);
    const kind = world.get(e, SurfaceKind)?.kind as "dom" | "gl" | "video";
    const target = world.get(e, SurfaceTarget)?.target as "dom" | "gpu";
    const band = bandOf(e);
    const gpu = effectiveTarget(kind, target) === "gpu";

    if (ref.texture === 0) {
      if (gpu && band > 0 && (world.hasTag(e, Visible) || world.hasTag(e, Retained))) {
        // A want that went unmet is only legal when the budget could not be met;
        // the property walk runs generous, so here it is a failure.
        return `entity ${e} wants a destination (gpu, band ${band}, visible/retained) and holds none`;
      }
      return null;
    }
    if (!gpu) return `entity ${e} presents on the DOM but holds texture ${ref.texture}`;
    if (!(band > 0)) return `entity ${e} is at band 0 but holds texture ${ref.texture}`;

    const entry = table.describe(ref.texture);
    if (entry === undefined) return `entity ${e} names texture ${ref.texture}, which the table does not know`;

    if (entry.kind === "pages") {
      const slot = allocator.get(packKey(e, band));
      if (slot === undefined) return `entity ${e} names the atlas but holds no slot at band ${band}`;
      if (slot.layer !== ref.layer) return `entity ${e} names layer ${ref.layer}, holds ${slot.layer}`;
      const side = allocator.layerSize;
      const want = {
        u0: slot.rect.x / side,
        v0: slot.rect.y / side,
        u1: (slot.rect.x + slot.rect.width) / side,
        v1: (slot.rect.y + slot.rect.height) / side,
      };
      if (ref.u0 !== want.u0 || ref.v0 !== want.v0 || ref.u1 !== want.u1 || ref.v1 !== want.v1) {
        return `entity ${e}'s uv ${JSON.stringify(ref)} does not name its slot ${JSON.stringify(slot.rect)}`;
      }
      return null;
    }
    if (ref.u0 !== 0 || ref.v0 !== 0 || ref.u1 !== 1 || ref.v1 !== 1) {
      return `entity ${e} holds a whole ${entry.kind} texture but its uv is not the unit square`;
    }
    if (entry.kind === "stable" && table.stableOf(e) !== ref.texture) {
      return `entity ${e} names a stable texture that is not its registration`;
    }
    return null;
  };

  return {
    world, engine, table, allocator, step, card, refOf, bandOf, zoomTo, panBy,
    setTarget, cull, show, ran, order, checkInvariant, clockNow: () => clock,
  };
}

describe("the §6.4 invariant, under a seeded walk", () => {
  it("holds after every step of a mixed walk over target, zoom, size, cull, retain and death", () => {
    const r = rig({ maxLayers: 16 });
    let seed = 20260906;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    const live: Entity[] = [];
    for (let i = 0; i < 8; i++) live.push(r.card({ kind: i % 4 === 3 ? "gl" : "dom" }));
    r.step();

    let zoom = 1;
    let atlasPeak = 0;
    let ownPeak = 0;
    for (let op = 0; op < 220; op++) {
      const pick = (): Entity | undefined =>
        live.length === 0 ? undefined : (live[Math.floor(rand() * live.length)] as Entity);
      const roll = rand();
      if (roll < 0.24) {
        zoom = Math.min(12, Math.max(0.05, zoom * (0.55 + rand() * 1.4)));
        r.zoomTo(zoom);
      } else if (roll < 0.4) {
        r.panBy(rand() * 40 - 20, rand() * 40 - 20);
      } else if (roll < 0.55) {
        const e = pick();
        // Only a dom KIND has a dom target to choose; writing `dom` on a gl card
        // is the illegal state A1a's Band guard throws on (D5), not a state a
        // walk should manufacture.
        if (e !== undefined && r.world.get(e, SurfaceKind)?.kind === "dom") {
          r.setTarget(e, rand() < 0.5 ? "dom" : "gpu");
        }
      } else if (roll < 0.68) {
        const e = pick();
        if (e !== undefined) r.world.edit(e).set(Size, { w: 20 + rand() * 120, h: 20 + rand() * 90 });
      } else if (roll < 0.8) {
        const e = pick();
        if (e !== undefined) {
          if (r.world.hasTag(e, Visible)) r.cull(e);
          else r.show(e);
        }
      } else if (roll < 0.9) {
        const e = pick();
        if (e !== undefined) {
          if (r.world.hasTag(e, Retained)) r.world.removeTag(e, Retained);
          else r.world.addTag(e, Retained);
        }
      } else if (roll < 0.96 && live.length > 3) {
        const e = pick() as Entity;
        r.world.destroy(e);
        live.splice(live.indexOf(e), 1);
      } else {
        live.push(r.card({ kind: rand() < 0.25 ? "gl" : "dom" }));
      }
      r.step();

      for (const e of live) {
        expect(r.checkInvariant(e), `op ${op}`).toBeNull();
      }
      atlasPeak = Math.max(atlasPeak, r.allocator.held());
      for (const e of live) {
        if (r.table.describe(r.refOf(e).texture)?.kind === "own") ownPeak += 1;
      }
    }
    expect(live.length).toBeGreaterThan(4);
    // The walk is only worth its runtime if it visited both destinations —
    // a final state of "everything oversize" would satisfy the invariant while
    // never touching the allocator at all.
    expect(atlasPeak, "the walk never used the atlas").toBeGreaterThan(2);
    expect(ownPeak, "the walk never used a private texture").toBeGreaterThan(10);
  });
});

describe("what does NOT wake it, and what does not move", () => {
  it("a pan does not run the system at all", () => {
    const r = rig();
    const e = r.card();
    r.step(3);
    expect(r.ran("residency"), "settled before the pan").toBe(false);
    const before = r.refOf(e);
    r.panBy(120, -80);
    r.step();
    expect(r.ran("residency"), "a pan is not residency's business").toBe(false);
    expect(r.refOf(e)).toEqual(before);
  });

  it("a zoom INSIDE the held band does not even run the system", () => {
    const r = rig();
    const e = r.card();
    r.step(2);
    const before = r.refOf(e);
    expect(before.texture).not.toBe(0);
    for (const z of [0.6, 0.9, 1.4, 1.99, 2]) {
      r.zoomTo(z);
      r.step();
      // Band runs (the zoom moved) and writes nothing, so nothing journals and
      // residency never wakes. Under the default `band` strategy the zoom is
      // not a residency input at all.
      expect(r.ran("residency"), `zoom ${z}`).toBe(false);
      expect(r.refOf(e)).toEqual(before);
    }
    expect(r.allocator.held()).toBe(1);
  });

  /**
   * Change-only is not observable by comparing values: a system that rewrote
   * the same six numbers every frame would pass every value assertion in this
   * file and cost a stamp per resident card per frame — the churn §3 exists to
   * forbid. So this counts WRITES, by draining a collector of its own.
   */
  it("writes the ref change-only — a settled board journals nothing", () => {
    const r = rig();
    const cards = [r.card({ w: 8, h: 8 }), r.card({ w: 8, h: 8 }), r.card({ w: 8, h: 8 })];
    r.step(3);

    const collector = r.world.changes.collect({ components: [TextureRef], coarse: false });
    collector.drain(); // discard everything up to here

    r.step(6);
    expect(collector.drain().changed, "a settled board rewrites no ref").toEqual([]);

    // A real move writes exactly the cards that moved, once each.
    r.zoomTo(5);
    r.step(2);
    const wrote = [...collector.drain().changed];
    expect(new Set(wrote)).toEqual(new Set(cards));
    expect(wrote.length, "once each, not once per frame").toBe(cards.length);

    r.step(4);
    expect(collector.drain().changed, "and it settles again").toEqual([]);
  });

  it("a band crossing writes exactly one ref per visible gpu card, and leaves the old key cold", () => {
    const r = rig();
    const cards = [r.card({ w: 8, h: 8 }), r.card({ w: 8, h: 8 }), r.card({ w: 8, h: 8 })];
    r.step(2);
    const before = cards.map(r.refOf);
    const band0 = r.bandOf(cards[0] as Entity);
    expect(band0).toBe(1);

    r.zoomTo(5); // out of [0.5, 2] — a real crossing
    r.step(2);

    const after = cards.map(r.refOf);
    for (let i = 0; i < cards.length; i++) {
      expect(r.bandOf(cards[i] as Entity)).toBe(8);
      expect(after[i]).not.toEqual(before[i]); // exactly one move, to the new band's slot
    }
    // Per-band retention: the OLD key is still held, cold, waiting for a zoom back.
    for (const e of cards) {
      expect(r.allocator.get(packKey(e, band0)), "the old band's slot went cold, not away").toBeDefined();
      expect(r.allocator.get(packKey(e, 8))).toBeDefined();
    }
    expect(r.allocator.held()).toBe(6);
  });

  it("zooming back to a held band is a hit: no allocation, and the same slot", () => {
    const r = rig();
    const e = r.card({ w: 8, h: 8 });
    r.step(2);
    const at1 = r.refOf(e);

    r.zoomTo(5);
    r.step(2);
    expect(r.refOf(e)).not.toEqual(at1);
    const slotsAfterOut = r.allocator.held();

    r.zoomTo(1);
    r.step(2);
    expect(r.refOf(e)).toEqual(at1); // the very same rect, uv for uv
    expect(r.allocator.held()).toBe(slotsAfterOut); // nothing new was allocated
  });
});

describe("the destinations, per kind", () => {
  it("a dom card too big for a layer takes a private texture, uv 0..1", () => {
    const r = rig();
    // 400 world px at band 1, dpr 2 = 800 device px > 512 - 4.
    const big = r.card({ w: 400, h: 400 });
    const small = r.card({ w: 40, h: 40 });
    r.step(2);

    const ref = r.refOf(big);
    expect(r.table.describe(ref.texture)).toEqual({ kind: "own", width: 800, height: 800, srgb: false });
    expect([ref.u0, ref.v0, ref.u1, ref.v1]).toEqual([0, 0, 1, 1]);
    expect(r.allocator.get(packKey(big, 1))).toBeUndefined(); // no slot, nothing clipped
    // …and it did not disturb the card that does fit.
    expect(r.table.describe(r.refOf(small).texture)).toMatchObject({ kind: "pages" });
  });

  it("a gl island always takes a private texture, at rasterSize", () => {
    const r = rig();
    const e = r.card({ kind: "gl", w: 60, h: 30 });
    r.step(2);
    const geo = geometry({ w: 60, h: 30 }, r.bandOf(e), 2, 1, "band");
    expect(r.table.describe(r.refOf(e).texture)).toEqual({
      kind: "own",
      width: geo.rasterSize.w,
      height: geo.rasterSize.h,
      srgb: false,
    });
    expect(r.allocator.held()).toBe(0); // an island shares no page
  });

  it("a video surface holds nothing until its producer registers, then the stable handle", () => {
    const r = rig();
    const e = r.card({ kind: "video" });
    r.step(2);
    expect(r.refOf(e).texture).toBe(0);

    const handle = r.table.register(e, { width: 1920, height: 1080, srgb: true });
    r.world.edit(e).set(Size, { w: 81, h: 48 }); // any journaled change wakes the walk
    r.step();
    const ref = r.refOf(e);
    expect(ref.texture).toBe(handle);
    expect([ref.u0, ref.v0, ref.u1, ref.v1]).toEqual([0, 0, 1, 1]);
    expect(r.allocator.held()).toBe(0); // the producer owns it; residency allocates nothing
  });

  it("a dom-target card holds nothing, and gives back every key when it flips", () => {
    const r = rig();
    const e = r.card({ w: 8, h: 8 });
    r.step(2);
    expect(r.refOf(e).texture).not.toBe(0);
    r.zoomTo(5);
    r.step(2);
    expect(r.allocator.held()).toBe(2); // two bands held

    r.setTarget(e, "dom");
    r.step();
    expect(r.refOf(e)).toEqual({ texture: 0, layer: 0, u0: 0, v0: 0, u1: 0, v1: 0 });
    expect(r.allocator.held()).toBe(0); // EVERY key, not just the current band's
  });

  it("a resize at the same band re-slots in place", () => {
    const r = rig();
    const e = r.card({ w: 40, h: 40 });
    r.step(2);
    const before = r.refOf(e);
    const band = r.bandOf(e);

    r.world.edit(e).set(Size, { w: 90, h: 90 });
    r.step();

    expect(r.bandOf(e)).toBe(band); // same band…
    const after = r.refOf(e);
    expect(after).not.toEqual(before); // …new slot
    const slot = r.allocator.get(packKey(e, band));
    expect(slot?.rect.width).toBe(180); // 90 × dpr 2
    expect(r.allocator.held()).toBe(1); // re-slotted, not doubled
  });
});

describe("the budget, and what it may never take", () => {
  it("a culled card keeps its TextureRef — cull alone never evicts", () => {
    const r = rig();
    const e = r.card({ w: 40, h: 40 });
    r.step(2);
    const held = r.refOf(e);
    expect(held.texture).not.toBe(0);

    r.cull(e);
    r.step(3);
    expect(r.refOf(e), "retention is what makes coming back a hit").toEqual(held);
    expect(r.allocator.held()).toBe(1);
  });

  it("…until the budget bites, and then it goes", () => {
    // One 512² layer costs 1 MB; a budget below that evicts everything the LRU
    // is allowed to take, which is every key that is neither Visible nor Retained.
    const r = rig({ maxLayers: 1, budgetBytes: 1 });
    const e = r.card({ w: 40, h: 40 });
    r.step(2);
    expect(r.refOf(e).texture).not.toBe(0);

    r.cull(e);
    r.step(3);
    expect(r.refOf(e).texture, "the budget took the cold key").toBe(0);
    expect(r.allocator.held()).toBe(0);
  });

  /**
   * Coldest-FIRST is only observable where a single eviction is enough, which
   * is the evict-and-retry inside an allocation — not the budget loop, whose
   * bytes do not fall until a whole layer empties, so it takes everything it is
   * allowed to take and the order cannot be seen.
   */
  function pressureRig() {
    // 125 world px at band 1, dpr 2 = 250² device: exactly four to a 512² layer.
    const r = rig({ maxLayers: 1 });
    const cards = [0, 1, 2, 3].map(() => r.card({ w: 125, h: 125 }));
    r.step(2);
    expect(r.allocator.held()).toBe(4);
    expect(r.allocator.layers()).toHaveLength(1);
    // Stagger the heat in REVERSE insertion order: the last card goes cold
    // first, so it is the coldest while being the LAST entry in every side
    // table. Iteration order and heat order now disagree, which is what makes
    // this a test of the heat rather than of a Map's ordering.
    for (let i = cards.length - 1; i >= 0; i--) {
      r.cull(cards[i] as Entity);
      r.step(2);
    }
    return { r, cards };
  }

  it("evict-and-retry takes the COLDEST key, and only as many as it needs", () => {
    const { r, cards } = pressureRig();
    const before = cards.map(r.refOf);

    const late = r.card({ w: 125, h: 125 }); // needs a slot; the layer is full
    r.step(2);

    expect(r.refOf(late).texture, "the newcomer got its slot").not.toBe(0);
    const coldest = cards.length - 1;
    expect(r.refOf(cards[coldest] as Entity).texture, "the coldest went").toBe(0);
    for (let i = 0; i < coldest; i++) {
      expect(r.refOf(cards[i] as Entity), `card ${i} was warmer and stayed`).toEqual(before[i]);
    }
    expect(r.allocator.held()).toBe(4);
  });

  it("evict-and-retry skips a Retained key however cold it is", () => {
    const { r, cards } = pressureRig();
    const coldest = cards.length - 1;
    r.world.addTag(cards[coldest] as Entity, Retained); // the coldest, now pinned
    r.step();
    const before = cards.map(r.refOf);

    r.card({ w: 125, h: 125 });
    r.step(2);

    expect(r.refOf(cards[coldest] as Entity), "Retained is never taken").toEqual(before[coldest]);
    expect(r.refOf(cards[coldest - 1] as Entity).texture, "the coldest UNPINNED key went").toBe(0);
  });

  it("a Visible card is never evicted, however tight the budget", () => {
    const r = rig({ maxLayers: 1, budgetBytes: 1 });
    const cards = [r.card({ w: 40, h: 40 }), r.card({ w: 40, h: 40 })];
    r.step(6);
    for (const e of cards) {
      expect(r.refOf(e).texture).not.toBe(0);
      expect(r.checkInvariant(e)).toBeNull();
    }
  });

  it("a card the budget cannot serve gets no destination, not a private texture", () => {
    // Every slot belongs to a Visible card, so there is nothing to evict and
    // nothing to open. The honest answer is texture 0, retried next change.
    const r = rig({ maxLayers: 1 });
    for (let i = 0; i < 4; i++) r.card({ w: 125, h: 125 });
    r.step(2);
    expect(r.allocator.held()).toBe(4);

    const late = r.card({ w: 125, h: 125 });
    r.step(2);
    expect(r.refOf(late).texture).toBe(0);
    expect(r.table.describe(r.refOf(late).texture)).toBeUndefined();
    expect(r.allocator.held(), "and it took nobody's slot").toBe(4);
  });
});

describe("the states nothing else visits", () => {
  it("a card culled from birth is never banded, holds nothing, and does not throw", () => {
    // Band's query requires `Visible`, so a card culled at spawn keeps band 0 —
    // the "never banded" state. `geometry()` throws on band 0, so residency's
    // own `band > 0` gate is what keeps that throw unreachable in production.
    const r = rig();
    const e = r.card({ visible: false });
    expect(() => r.step(3)).not.toThrow();
    expect(r.bandOf(e)).toBe(0);
    expect(r.refOf(e).texture).toBe(0);
    expect(r.allocator.held()).toBe(0);

    // …and it allocates the moment it is shown.
    r.show(e);
    r.step(2);
    expect(r.bandOf(e)).toBe(1);
    expect(r.refOf(e).texture).not.toBe(0);
  });

  it("a journaled change that moves no destination writes no ref", () => {
    // `Retained` is in the guard's tag list, so toggling it WAKES the system —
    // which is the point: the body runs, walks the card, and must decide to
    // write nothing. A value-comparison test cannot tell this from a system
    // that never ran.
    const r = rig();
    const e = r.card({ w: 8, h: 8 });
    r.step(3);
    const before = r.refOf(e);

    const collector = r.world.changes.collect({ components: [TextureRef], coarse: false });
    collector.drain();

    r.world.addTag(e, Retained);
    r.step();
    expect(r.ran("residency"), "the toggle woke it").toBe(true);
    expect(collector.drain().changed, "…and it wrote nothing").toEqual([]);
    expect(r.refOf(e)).toEqual(before);

    r.world.removeTag(e, Retained);
    r.step();
    expect(collector.drain().changed).toEqual([]);
  });

  it("re-sizing an oversize card releases the private texture it replaces", () => {
    const r = rig();
    const e = r.card({ w: 400, h: 400 }); // 800² device — past a 512 layer
    r.step(2);
    const first = r.refOf(e).texture;
    expect(r.table.describe(first)).toMatchObject({ kind: "own", width: 800 });
    r.table.drain(); // clear anything already dead

    r.world.edit(e).set(Size, { w: 500, h: 500 });
    r.step(2);
    const second = r.refOf(e).texture;
    expect(second).not.toBe(first);
    expect(r.table.describe(second)).toMatchObject({ kind: "own", width: 1000 });
    // Both references to the old handle are gone: the key's and the ref's.
    expect(r.table.refs(first)).toBe(0);
    expect(r.table.drain(), "the replaced texture is destroyable").toContain(first);
  });
});

describe("death", () => {
  it("a despawn frees every key, drains the handle and drops the registration", () => {
    const r = rig();
    const dom = r.card({ w: 8, h: 8 });
    const gl = r.card({ kind: "gl", w: 40, h: 40 });
    const vid = r.card({ kind: "video" });
    const stable = r.table.register(vid, { width: 640, height: 480, srgb: false });
    r.step(2);
    r.zoomTo(5);
    r.step(2); // dom now holds two bands

    const glHandle = r.refOf(gl).texture;
    expect(r.allocator.held()).toBe(2);
    expect(r.table.stableOf(vid)).toBe(stable);

    for (const e of [dom, gl, vid]) r.world.destroy(e);
    r.step();

    expect(r.allocator.held(), "every band's key, not just the current one").toBe(0);
    expect(r.table.stableOf(vid)).toBe(0);
    const drained = r.table.drain();
    expect(drained).toContain(glHandle);
    expect(drained).toContain(stable);
  });
});

describe("the schedule", () => {
  it("Residency runs after Demand, which runs after Band, inside present:infra", () => {
    const r = rig();
    r.card();
    r.step();
    const seen = r.order();
    const band = seen.indexOf("surfaceBand");
    const demand = seen.indexOf("surfaceDemand");
    const residency = seen.indexOf("residency");
    expect(band).toBeGreaterThanOrEqual(0);
    expect(demand).toBeGreaterThan(band);
    expect(residency).toBeGreaterThan(demand);
  });

  it("omitting the residency option installs Band and Demand alone", () => {
    const world: World = createWorld();
    const engine = createEngine(world);
    engine.registerReflector({ name: "armed", observe: { resources: [Camera] }, flush: () => {} });
    installSurfaceInfra(engine);
    engine.enableTelemetry();
    world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    world.setResource(Viewport, { w: 800, h: 600, dpr: 2 });
    engine.step(16);
    const seen = (engine.lastFrame()?.systems ?? []).map((s) => s.system as string);
    expect(seen).toContain("surfaceBand");
    expect(seen).toContain("surfaceDemand");
    expect(seen).not.toContain("residency");
  });

  it("every band on the ladder is a legal key for a card that reaches it", () => {
    const r = rig({ maxLayers: 16 });
    const e = r.card({ w: 8, h: 8 });
    const seen = new Set<number>();
    for (const band of ZOOM_BANDS) {
      r.zoomTo(band);
      r.step(2);
      seen.add(r.bandOf(e));
      expect(r.checkInvariant(e)).toBeNull();
    }
    expect(seen.size).toBeGreaterThan(4);
  });
});
