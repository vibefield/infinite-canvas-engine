/**
 * Pure collector tests — the ECS→triangles halves of the guides/wires passes
 * (no three import, no GPU; the render path is Playwright e2e territory).
 */
import {
  GuideLine,
  Position,
  PrefabId,
  Size,
  SpacingBar,
  Wire,
  WireFrom,
  WirePorts,
  WireTo,
  createWorld,
  defineWidget,
  widgets,
} from "@ice/core";
import { describe, expect, it } from "vitest";
import type { GroundFrame } from "../src/pass";
import { collectGuides } from "../src/passes/guides-collect";
import { SoupBuilder, parseCssColor } from "../src/passes/soup-collect";
import { collectWires } from "../src/passes/wires-collect";

const frame = (over: Partial<GroundFrame> = {}): GroundFrame => ({
  width: 800,
  height: 600,
  dpr: 1,
  camera: { x: 0, y: 0, zoom: 1 },
  ...over,
});

describe("SoupBuilder", () => {
  it("emits 6 verts per rect with per-vertex rgba", () => {
    const b = new SoupBuilder();
    b.rect(10, 20, 30, 40, [1, 0, 0.5, 0.8]);
    const s = b.build();
    expect(s.vertexCount).toBe(6);
    expect(s.positions.length).toBe(18); // xyz
    expect(s.colors.length).toBe(24); // rgba
    expect(s.colors[3]).toBeCloseTo(0.8, 6);
  });

  it("segment quads are width-thick across the normal", () => {
    const b = new SoupBuilder();
    b.segment(0, 0, 10, 0, 2, [1, 1, 1, 1]);
    const s = b.build();
    const ys = Array.from({ length: 6 }, (_, i) => s.positions[i * 3 + 1] as number);
    expect(Math.min(...ys)).toBeCloseTo(-1, 6);
    expect(Math.max(...ys)).toBeCloseTo(1, 6);
  });
});

describe("parseCssColor", () => {
  it("parses rgba(), rgb(), #hex; falls back on junk", () => {
    expect(parseCssColor("rgba(120, 132, 145, 0.9)").map((v) => Math.round(v * 1000) / 1000)).toEqual([
      0.471, 0.518, 0.569, 0.9,
    ]);
    expect(parseCssColor("rgb(255, 0, 0)")).toEqual([1, 0, 0, 1]);
    expect(parseCssColor("#4a90d9")[2]).toBeCloseTo(217 / 255, 6);
    expect(parseCssColor("salmon")).toEqual([0.5, 0.5, 0.5, 1]);
  });
});

describe("collectGuides", () => {
  it("a full-span x guide becomes one viewport-tall rect at the camera-mapped x", () => {
    const world = createWorld();
    world.spawn({ components: [[GuideLine, { axis: "x", at: 300, from: 0, to: 0 }]] });
    const s = collectGuides(world, frame({ camera: { x: 100, y: 0, zoom: 2 } }));
    expect(s.vertexCount).toBe(6);
    const xs = Array.from({ length: 6 }, (_, i) => s.positions[i * 3] as number);
    const ys = Array.from({ length: 6 }, (_, i) => s.positions[i * 3 + 1] as number);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo((300 - 100) * 2, 5); // worldToScreen
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(600); // full span
  });

  it("a spacing bar emits segment + two ticks (18 verts) at the bar alpha", () => {
    const world = createWorld();
    world.spawn({ components: [[SpacingBar, { axis: "x", from: 180, to: 300, perp: 130, gap: 120 }]] });
    const s = collectGuides(world, frame());
    expect(s.vertexCount).toBe(18);
    expect(s.colors[3]).toBeCloseTo(0.7, 6); // spacingAlpha, not guideAlpha
  });

  it("culls off-viewport guides; empty world emits an empty soup", () => {
    const world = createWorld();
    world.spawn({ components: [[GuideLine, { axis: "x", at: 5000, from: 0, to: 0 }]] });
    expect(collectGuides(world, frame()).vertexCount).toBe(0);
    expect(collectGuides(createWorld(), frame()).vertexCount).toBe(0);
  });
});

// One widget type per FILE (global registry; no test reset).
const NODE =
  widgets.get("ground:test-node") ??
  defineWidget({
    type: "ground:test-node",
    surface: "dom",
    component: null,
    defaultSize: { w: 100, h: 60 },
    ports: [
      { id: "out", side: "e" },
      { id: "in", side: "w" },
    ],
  });

function spawnNode(world: ReturnType<typeof createWorld>, x: number, y: number) {
  return world.spawn({
    components: [
      [PrefabId, { id: NODE.type }],
      [Position, { x, y }],
      [Size, { w: 100, h: 60 }],
    ],
  });
}

describe("collectWires", () => {
  it("a committed wire tessellates into stroke quads between the port anchors", () => {
    const world = createWorld();
    const a = spawnNode(world, 0, 0);
    const b = spawnNode(world, 300, 0);
    const wire = world.spawn({ components: [[WirePorts, { from: "out", to: "in" }]], tags: [Wire] });
    world.setRelation(wire, WireFrom, a);
    world.setRelation(wire, WireTo, b);

    const s = collectWires(world, frame());
    expect(s.vertexCount).toBeGreaterThan(0);
    expect(s.vertexCount % 6).toBe(0); // per-segment quads
    // Stroke spans from a's east anchor (x=100) to b's west anchor (x=300).
    const xs = Array.from({ length: s.vertexCount }, (_, i) => s.positions[i * 3] as number);
    expect(Math.min(...xs)).toBeGreaterThan(90);
    expect(Math.max(...xs)).toBeLessThan(310);
  });

  it("an incompatible preview draws DASHED (fewer verts than the solid preview)", () => {
    const world = createWorld();
    const solid = collectWires(world, frame(), undefined, {
      active: true,
      compatible: true,
      sx: 0,
      sy: 0,
      tx: 200,
      ty: 0,
    });
    const dashed = collectWires(world, frame(), undefined, {
      active: true,
      compatible: false,
      sx: 0,
      sy: 0,
      tx: 200,
      ty: 0,
    });
    expect(solid.vertexCount).toBeGreaterThan(0);
    expect(dashed.vertexCount).toBeGreaterThan(0);
    // Dashes cover ~60% of arc length in [6,4] — strictly less geometry span.
    const spanOf = (s: typeof solid) => {
      let covered = 0;
      for (let i = 0; i < s.vertexCount / 6; i++) {
        const x0 = s.positions[i * 18] as number;
        const x1 = s.positions[i * 18 + 3] as number;
        covered += Math.abs(x1 - x0);
      }
      return covered;
    };
    expect(spanOf(dashed)).toBeLessThan(spanOf(solid));
  });

  it("a culled endpoint still draws (schema anchors, never port entities)", () => {
    const world = createWorld();
    const a = spawnNode(world, 0, 0);
    const b = spawnNode(world, 300, 0);
    const wire = world.spawn({ components: [[WirePorts, { from: "out", to: "in" }]], tags: [Wire] });
    world.setRelation(wire, WireFrom, a);
    world.setRelation(wire, WireTo, b);
    // No Port/PortAnchor entities exist at all — geometry must not need them.
    expect(collectWires(world, frame()).vertexCount).toBeGreaterThan(0);
  });
});
