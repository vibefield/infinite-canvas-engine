// @vitest-environment node
/**
 * The COPY, pinned to its original (design-013 C1, D-C1.3). The Phase-C wall
 * forbids the new leg importing the old one, so `passes/{soup,wires,guides}-collect.ts`
 * moved across it by copy into `compose/{soup,wires-collect,guides-collect}.ts`.
 * A copy is only as good as the thing that catches it drifting: every case here
 * runs BOTH implementations over the SAME world and asserts the two soups agree
 * element for element — positions, colours and vertex count.
 *
 * A test file may import either leg (dependency-cruiser binds its walls on `src`
 * only), which is what makes this possible. It dies with the old leg at C2, and
 * `test/collectors.test.ts` — the original's own tests, untouched by C1 — is
 * what survives to be re-pointed then.
 */
import {
  Active,
  Culled,
  GuideLine,
  Position,
  PrefabId,
  RoutedConnect,
  Selected,
  Size,
  SpacingBar,
  Wire,
  WireFrom,
  WirePorts,
  WireTo,
  createWorld,
  defineWidget,
  widgets,
  type World,
} from "@ice/core";
import { describe, expect, it } from "vitest";
import { collectGuides as newGuides } from "../src/compose/guides-collect";
import { SoupBuilder as NewBuilder, parseCssColor as newParse } from "../src/compose/soup";
import { collectWires as newWires } from "../src/compose/wires-collect";
import { collectGuides as oldGuides } from "../src/passes/guides-collect";
import { SoupBuilder as OldBuilder, parseCssColor as oldParse } from "../src/passes/soup-collect";
import { collectWires as oldWires } from "../src/passes/wires-collect";
import type { GroundFrame } from "../src/pass";

const frame = (over: Partial<GroundFrame> = {}): GroundFrame => ({
  width: 800,
  height: 600,
  dpr: 1,
  camera: { x: 0, y: 0, zoom: 1 },
  ...over,
});

/**
 * The two soups agree on every number, compared as plain arrays so the two legs'
 * `TriSoup` types (which differ only in their buffer parameter) both fit.
 */
type AnySoup = { readonly positions: ArrayLike<number>; readonly colors: ArrayLike<number>; readonly vertexCount: number };
function same(a: AnySoup, b: AnySoup): void {
  expect(a.vertexCount).toBe(b.vertexCount);
  expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
  expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
}

// One widget type per FILE (global registry; no test reset).
const NODE =
  widgets.get("overlay:test-node") ??
  defineWidget({
    type: "overlay:test-node",
    surface: "dom",
    component: null,
    defaultSize: { w: 100, h: 60 },
    ports: [
      { id: "out", side: "e" },
      { id: "in", side: "w" },
    ],
  });

function spawnNode(world: World, x: number, y: number) {
  return world.spawn({ components: [[PrefabId, { id: NODE.type }], [Position, { x, y }], [Size, { w: 100, h: 60 }]] });
}

function wiredWorld(): World {
  const world = createWorld();
  const a = spawnNode(world, 0, 0);
  const b = spawnNode(world, 300, 40);
  const c = spawnNode(world, 120, 300);
  for (const [from, to] of [[a, b], [b, c]] as const) {
    const wire = world.spawn({ components: [[WirePorts, { from: "out", to: "in" }]], tags: [Wire] });
    world.setRelation(wire, WireFrom, from);
    world.setRelation(wire, WireTo, to);
  }
  return world;
}

describe("SoupBuilder — the copy emits the original's bytes", () => {
  it("agrees on every primitive: rect, segment, polyline, disc", () => {
    const build = (B: typeof OldBuilder | typeof NewBuilder) => {
      const s = new B();
      s.rect(10.5, 20.25, 30, 40, [1, 0, 0.5, 0.8]);
      s.segment(0, 0, 137, 91, 2.5, [0.2, 0.4, 0.6, 1]);
      s.polyline([0, 0, 40, 10, 90, -30, 130, 55], 3, [0.1, 0.9, 0.3, 0.65]);
      s.disc(64.5, 32.25, 7.5, [1, 1, 0, 0.4]);
      s.disc(10, 10, 4, [0, 1, 1, 1], 5);
      return s.build();
    };
    same(build(NewBuilder), build(OldBuilder));
  });

  it("a degenerate segment is dropped by both, and an empty soup is empty in both", () => {
    const build = (B: typeof OldBuilder | typeof NewBuilder) => {
      const s = new B();
      s.segment(5, 5, 5, 5, 4, [1, 1, 1, 1]);
      return s.build();
    };
    expect(build(NewBuilder).vertexCount).toBe(0);
    same(build(NewBuilder), build(OldBuilder));
  });

  it("parseCssColor answers identically, junk included", () => {
    for (const css of ["rgba(120, 132, 145, 0.9)", "rgb(255, 0, 0)", "#4a90d9", "#000000", "salmon", ""]) {
      expect(newParse(css)).toEqual(oldParse(css));
    }
  });
});

describe("collectWires — the copy is the original", () => {
  it("committed wires, at two cameras", () => {
    const world = wiredWorld();
    for (const cam of [{ x: 0, y: 0, zoom: 1 }, { x: -37.5, y: 96.25, zoom: 2.35 }]) {
      same(newWires(world, frame({ camera: cam })), oldWires(world, frame({ camera: cam })));
      expect(newWires(world, frame({ camera: cam })).vertexCount).toBeGreaterThan(0);
    }
  });

  it("the connect preview, snapped and unsnapped (the dashed branch)", () => {
    const world = wiredWorld();
    for (const compatible of [true, false]) {
      const preview = { active: true, compatible, sx: 12, sy: -30, tx: 260, ty: 140 };
      same(newWires(world, frame(), undefined, preview), oldWires(world, frame(), undefined, preview));
    }
  });

  it("the port dots, and their active colour under a routed connect", () => {
    const world = wiredWorld();
    world.spawn({ tags: [RoutedConnect] });
    same(newWires(world, frame()), oldWires(world, frame()));
  });

});

describe("collectGuides — the copy is the original", () => {
  it("full-span guides, bounded spans and spacing bars on both axes", () => {
    const world = createWorld();
    world.spawn({ components: [[GuideLine, { axis: "x", at: 300, from: 0, to: 0 }]] });
    world.spawn({ components: [[GuideLine, { axis: "y", at: 180, from: 0, to: 0 }]] });
    world.spawn({ components: [[GuideLine, { axis: "x", at: 120, from: 40, to: 260 }]] });
    world.spawn({ components: [[SpacingBar, { axis: "x", from: 180, to: 300, perp: 130, gap: 120 }]] });
    world.spawn({ components: [[SpacingBar, { axis: "y", from: 60, to: 240, perp: 400, gap: 180 }]] });
    for (const cam of [{ x: 0, y: 0, zoom: 1 }, { x: 100, y: -25, zoom: 2 }]) {
      same(newGuides(world, frame({ camera: cam })), oldGuides(world, frame({ camera: cam })));
      expect(newGuides(world, frame({ camera: cam })).vertexCount).toBeGreaterThan(0);
    }
  });

  it("the off-viewport cull, and an empty world", () => {
    const world = createWorld();
    world.spawn({ components: [[GuideLine, { axis: "x", at: 5000, from: 0, to: 0 }]] });
    same(newGuides(world, frame()), oldGuides(world, frame()));
    expect(newGuides(world, frame()).vertexCount).toBe(0);
    same(newGuides(createWorld(), frame()), oldGuides(createWorld(), frame()));
  });
});

// The tags the scope filter and the selection ride, exercised through the same world.
describe("collectWires — the tag branches", () => {
  it("Culled ∧ ¬Active hides a wire in both; Culled ∧ Active keeps it in both; Selected widens it in both", () => {
    const world = createWorld();
    const a = spawnNode(world, 0, 0);
    const b = spawnNode(world, 300, 0);
    const wire = world.spawn({ components: [[WirePorts, { from: "out", to: "in" }]], tags: [Wire] });
    world.setRelation(wire, WireFrom, a);
    world.setRelation(wire, WireTo, b);
    const drawn = newWires(world, frame()).vertexCount;
    expect(drawn).toBeGreaterThan(0);
    same(newWires(world, frame()), oldWires(world, frame()));

    world.addTag(a, Culled);
    expect(newWires(world, frame()).vertexCount).toBe(0);
    same(newWires(world, frame()), oldWires(world, frame()));

    world.addTag(a, Active);
    expect(newWires(world, frame()).vertexCount).toBe(drawn);
    same(newWires(world, frame()), oldWires(world, frame()));

    const plain = Array.from(newWires(world, frame()).positions);
    world.addTag(wire, Selected);
    const wide = newWires(world, frame());
    expect(wide.vertexCount).toBe(drawn);
    // the selected stroke is WIDER — the same segment count, a different spread — and both legs widen it the same way
    expect(Array.from(wide.positions)).not.toEqual(plain);
    same(wide, oldWires(world, frame()));
  });
});
