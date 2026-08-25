/**
 * Magnet collector tests — the pure ECS→packed-sources half of the magnet
 * grid (design-010 §9 step 2; no three import, no GPU — collectors.test.ts
 * convention). Covers the D3 pole degeneracy (half = 0, r = 0), the D2
 * broad-phase halo query, `maxSources` prioritization (poles never evicted),
 * the `fadeZoom` valve, lattice windows, and the §5.4 coincidence skip.
 */
import {
  LocalPointer,
  MeasuredSize,
  Pointer,
  PointerWorld,
  Position,
  Size,
  createWorld,
  DEFAULT_GRID_CONFIG,
  DEFAULT_GRID_MAGNET_CONFIG,
  type GridConfig,
  type GridMagnetConfig,
  type World,
} from "@ice/core";
import { SpatialIndex, type AABB } from "@ice/kernel";
import type { Entity } from "@ice/core";
import { describe, expect, it } from "vitest";
import type { GroundFrame } from "../src/pass";
import {
  MAGNET_SOURCE_FLOATS,
  MAX_MAGNET_SOURCES,
  collectMagnetLevels,
  collectMagnetSources,
  fadeOpacity,
  magnetFieldScale,
  resolveMagnet,
} from "../src/passes/magnet-collect";
import { localPointerPoles, type Pole } from "../src/poles";

const frame = (over: Partial<GroundFrame> = {}): GroundFrame => ({
  width: 800,
  height: 600,
  dpr: 1,
  camera: { x: 0, y: 0, zoom: 1 },
  ...over,
});

const magnet = (over: Partial<GridMagnetConfig> = {}): GridMagnetConfig => ({
  ...DEFAULT_GRID_MAGNET_CONFIG,
  enabled: true,
  ...over,
});

const grid = (over: Partial<GridConfig> = {}): GridConfig => ({ ...DEFAULT_GRID_CONFIG, ...over });

/** A widget with the standard Position (top-left) + Size pair. */
function spawnWidget(world: World, x: number, y: number, w: number, h: number): Entity {
  return world.spawn({
    components: [
      [Position, { x, y }],
      [Size, { w, h }],
    ],
  });
}

function indexOf(world: World, entities: Entity[]): SpatialIndex<Entity> {
  const index = new SpatialIndex<Entity>();
  for (const e of entities) {
    const p = world.read(e, Position);
    const s = world.read(e, Size);
    index.upsert(e, { minX: p.x, minY: p.y, maxX: p.x + s.w, maxY: p.y + s.h });
  }
  return index;
}

const scratch = (): Float32Array => new Float32Array(MAX_MAGNET_SOURCES * MAGNET_SOURCE_FLOATS);

describe("fadeOpacity / magnetFieldScale", () => {
  it("rises across fadeIn, plateaus, falls across fadeOut", () => {
    expect(fadeOpacity(4, [8, 16], [120, 200])).toBe(0);
    expect(fadeOpacity(12, [8, 16], [120, 200])).toBeCloseTo(0.5, 6);
    expect(fadeOpacity(60, [8, 16], [120, 200])).toBe(1);
    expect(fadeOpacity(160, [8, 16], [120, 200])).toBeCloseTo(0.5, 6);
    expect(fadeOpacity(240, [8, 16], [120, 200])).toBe(0);
  });

  it("fadeZoom 0 disables the valve; otherwise lerps over [0.7z, z]", () => {
    expect(magnetFieldScale(0.01, 0)).toBe(1);
    expect(magnetFieldScale(0.5, 0.5)).toBe(1);
    expect(magnetFieldScale(0.35, 0.5)).toBe(0);
    expect(magnetFieldScale(0.425, 0.5)).toBeCloseTo(0.5, 6);
  });
});

describe("collectMagnetLevels", () => {
  it("windows cover the viewport with a 1-site apron (draft latticeWindow parity)", () => {
    const [fine] = collectMagnetLevels(frame(), grid());
    expect(fine).toBeDefined();
    if (fine === undefined) return;
    // 800×600 at zoom 1, spacing 20: indices −1 … 41 / −1 … 31.
    expect(fine.i0).toBe(-1);
    expect(fine.j0).toBe(-1);
    expect(fine.cols).toBe(42);
    expect(fine.rows).toBe(32);
    expect(fine.count).toBe(42 * 32);
    expect(fine.alpha).toBe(1); // css 20px is on the plateau, weight 1, dotAlpha 1
  });

  it("faded-out levels draw nothing (coarse at zoom 1 = css 500px)", () => {
    const levels = collectMagnetLevels(frame(), grid());
    expect(levels[2]?.count).toBe(0);
    expect(levels[2]?.alpha).toBe(0);
  });

  it("integer-ratio nested levels get the coincidence skipModulo when both visible", () => {
    // zoom 0.6: css 12/60/300 — fine is at fade-in edge (opacity 0 at exactly 12)…
    const levels = collectMagnetLevels(frame({ camera: { x: 0, y: 0, zoom: 0.65 } }), grid());
    // css: 13, 65, 325 → fine visible (opacity .625), medium visible, coarse 0.
    expect(levels[0]?.count).toBeGreaterThan(0);
    expect(levels[0]?.skipModulo).toBe(5); // 100/20
    expect(levels[1]?.skipModulo).toBe(0); // 500/100 = 5 but coarse is faded out
  });

  it("non-integer spacing ratios never skip", () => {
    const cfg = grid({ spacings: [20, 90, 500] });
    const levels = collectMagnetLevels(frame({ camera: { x: 0, y: 0, zoom: 0.9 } }), cfg);
    expect(levels[0]?.skipModulo).toBe(0);
  });
});

describe("collectMagnetSources — poles", () => {
  it("packs world poles through worldToScreen and screen poles verbatim (degenerate SDF)", () => {
    const world = createWorld();
    const out = scratch();
    const poles: Pole[] = [
      { x: 150, y: 80, strength: 1, space: "world" },
      { x: 25, y: 35, strength: 0.5, space: "screen" },
    ];
    const n = collectMagnetSources(
      world,
      frame({ camera: { x: 100, y: 50, zoom: 2 } }),
      magnet({ widgets: false }),
      1,
      poles,
      undefined,
      out,
    );
    expect(n).toBe(2);
    // World pole: (150−100)·2, (80−50)·2 — and half/radius are ZERO (D3).
    expect([out[0], out[1]]).toEqual([100, 60]);
    expect([out[2], out[3], out[4]]).toEqual([0, 0, 0]);
    expect(out[5]).toBe(1);
    // Screen pole: verbatim.
    const o = MAGNET_SOURCE_FLOATS;
    expect([out[o], out[o + 1]]).toEqual([25, 35]);
    expect(out[o + 5]).toBe(0.5);
  });

  it("skips ≤0-strength poles; fieldScale 0 short-circuits to zero sources", () => {
    const world = createWorld();
    const out = scratch();
    const poles: Pole[] = [{ x: 0, y: 0, strength: 0 }];
    expect(collectMagnetSources(world, frame(), magnet({ widgets: false }), 1, poles, undefined, out)).toBe(0);
    const live: Pole[] = [{ x: 0, y: 0, strength: 1 }];
    expect(collectMagnetSources(world, frame(), magnet({ widgets: false }), 0, live, undefined, out)).toBe(0);
  });
});

describe("collectMagnetSources — widgets (broad-phase)", () => {
  it("packs visible widgets as screen-space rounded rects via the index", () => {
    const world = createWorld();
    const w = spawnWidget(world, 100, 200, 240, 140);
    const index = indexOf(world, [w]);
    const out = scratch();
    const n = collectMagnetSources(
      world,
      frame(),
      magnet(),
      1,
      [],
      (b: AABB) => index.search(b),
      out,
    );
    expect(n).toBe(1);
    expect([out[0], out[1]]).toEqual([220, 270]); // center
    expect([out[2], out[3]]).toEqual([120, 70]); // half extents
    expect(out[4]).toBe(12); // widgetRadius default at zoom 1
    expect(out[5]).toBe(1);
  });

  it("prefers non-zero MeasuredSize over Size (the ONE rect rule)", () => {
    const world = createWorld();
    const w = world.spawn({
      components: [
        [Position, { x: 0, y: 0 }],
        [Size, { w: 100, h: 100 }],
        [MeasuredSize, { w: 50, h: 40 }],
      ],
    });
    const index = new SpatialIndex<Entity>();
    index.upsert(w, { minX: 0, minY: 0, maxX: 100, maxY: 100 });
    const out = scratch();
    collectMagnetSources(world, frame(), magnet(), 1, [], (b) => index.search(b), out);
    expect([out[2], out[3]]).toEqual([25, 20]);
  });

  it("queries with the 5·reach influence halo (nothing the shader could show is culled)", () => {
    const world = createWorld();
    let queried: AABB | null = null;
    const out = scratch();
    collectMagnetSources(
      world,
      frame({ camera: { x: 0, y: 0, zoom: 1 } }),
      magnet({ reach: 60, widgetStrength: 1 }),
      1,
      [],
      (b) => {
        queried = b;
        return [];
      },
      out,
    );
    expect(queried).not.toBeNull();
    const q = queried as unknown as AABB;
    expect(q.minX).toBeCloseTo(-300, 5); // 5·60 CSS px at zoom 1
    expect(q.maxX).toBeCloseTo(800 + 300, 5);
  });

  it("non-widget index entries (wires/ports carry no Size) are filtered out", () => {
    const world = createWorld();
    const bare = world.spawn({ components: [[Position, { x: 10, y: 10 }]] });
    const index = new SpatialIndex<Entity>();
    index.upsert(bare, { minX: 10, minY: 10, maxX: 20, maxY: 20 });
    const out = scratch();
    expect(collectMagnetSources(world, frame(), magnet(), 1, [], (b) => index.search(b), out)).toBe(0);
  });

  it("maxSources keeps the largest widgets and NEVER evicts poles", () => {
    const world = createWorld();
    const small = spawnWidget(world, 0, 0, 10, 10);
    const big = spawnWidget(world, 300, 300, 200, 200);
    const mid = spawnWidget(world, 600, 100, 80, 80);
    const index = indexOf(world, [small, big, mid]);
    const out = scratch();
    const poles: Pole[] = [{ x: 5, y: 5, strength: 1, space: "screen" }];
    const n = collectMagnetSources(
      world,
      frame(),
      magnet({ maxSources: 3 }),
      1,
      poles,
      (b) => index.search(b),
      out,
    );
    expect(n).toBe(3); // pole + big + mid; small evicted
    expect([out[0], out[1]]).toEqual([5, 5]); // the pole survives, first
    const halves = [out[MAGNET_SOURCE_FLOATS + 2], out[2 * MAGNET_SOURCE_FLOATS + 2]];
    expect(halves).toContain(100); // big
    expect(halves).toContain(40); // mid
  });

  it("widget radius clamps to the half extents and scales with zoom", () => {
    const world = createWorld();
    const w = spawnWidget(world, 0, 0, 10, 40); // hx 5 < radius 12
    const index = indexOf(world, [w]);
    const out = scratch();
    collectMagnetSources(world, frame(), magnet(), 1, [], (b) => index.search(b), out);
    expect(out[4]).toBe(5);
  });
});

describe("resolveMagnet / pole helpers", () => {
  it("resolves a partial block over the defaults", () => {
    const m = resolveMagnet(grid({ magnet: { enabled: true, reach: 90 } }));
    expect(m.enabled).toBe(true);
    expect(m.reach).toBe(90);
    expect(m.glyph).toBe(DEFAULT_GRID_MAGNET_CONFIG.glyph);
  });

  it("localPointerPoles reads LocalPointer+PointerWorld entities, world-space", () => {
    const world = createWorld();
    world.spawn({
      components: [
        [Pointer, { id: "p1", device: "mouse", owner: "" }],
        [PointerWorld, { x: 42, y: 7 }],
      ],
      tags: [LocalPointer],
    });
    const source = localPointerPoles({ strength: 2 });
    const poles = source.read(world);
    expect(poles).toEqual([{ x: 42, y: 7, strength: 2, space: "world" }]);
  });
});
