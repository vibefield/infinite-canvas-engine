// K8a (design-016 §5 · K-L2 — "being a container … a plugin kind declares the same way"): a container's face draws its children as
// CHIPS, and until K8a a chip was a `ChipKind` — `"paper" | "mat"`, the two built-ins' own names — so a plugin kind could have no chip
// of its own and a plugin container could draw none but those two. A chip names its FINISH now (open), the container declares the
// finishes its face draws (`ObjectKind.faceLaw`), and the builder hands it the chips in finishes it draws — a chip in none is left
// out and counted, never redressed. And a container's NUMBERS are its own (K8a): the corner its face clips its inside by and the
// most chips its face draws were the kit's `FACE_RADIUS`/`FACE_CHIPS_MAX` — the mini mat's, imposed on every container — and are
// its `faceLaw`'s now. Here a CONTAINER and its CHILDREN are all kinds of the test's own: no reference kind in sight.
import { createCanvasEngine, type Entity } from "@ice/core";
import { describe, expect, it } from "vitest";
import { createDeskBuilder } from "../src/compose/builder";
import type { KindPass } from "../src/kind";
import type { ObjectContext, ObjectKind, ObjectRect } from "../src/kinds/world";
import type { ChildShape, ChipFinish, FaceLaw } from "../src/kit/inside";
import { DEFAULT_GRID } from "../src/mat/grid";
import { defineObject } from "../src/object";
import { type Palette, themeFrom } from "../src/theme";

const PALETTE: Palette = { canvasBg: { token: "--bg", css: "#101010" }, select: { token: "--sel", css: "#3080ff" } };
const VP = { width: 1200, height: 800, dpr: 1 };
const CAM = { x: 0, y: 0, zoom: 1 };

/** A container of the test's own: a box whose face is its rect inset 10, under the face law it declares; its records keep the chips it was handed. */
function boxKind(faceLaw: FaceLaw, seen: (readonly ChildShape[])[]): ObjectKind<ObjectRect, object> {
  return {
    name: "box", stratum: "sheets", reach: 0, create: async () => ({}) as KindPass,
    resolve: (ctx) => ctx.rect,
    record: (_G, ctx) => { seen.push(ctx.inside?.chips ?? []); return {}; },
    hit: () => "content",
    face: (G) => ({ x: G.cx - G.w / 2 + 10, y: G.cy - G.h / 2 + 10, width: G.w - 20, height: G.h - 20 }),
    faceLaw,
  };
}
/** A child of the test's own whose chip is a square in `finish` (or none at all). */
function tokenKind(name: string, finish: ChipFinish | readonly ChipFinish[] | null): ObjectKind<ObjectRect, object> {
  return {
    name, stratum: "things", reach: 0, create: async () => ({}) as KindPass,
    resolve: (ctx) => ctx.rect, record: () => ({}), hit: () => "content",
    ...(finish === null ? {} : { chip: (G: ObjectRect, _ctx: ObjectContext): ChildShape => ({ finish, cx: G.cx, cy: G.cy, hx: 5, hy: 5, angle: 0, radius: 0, colour: [1, 0, 0], height: 1 }) }),
  };
}

/** Widget types are process-global: each desk declares its own. */
let desks = 0;
function desk(law: Partial<FaceLaw>) {
  const n = ++desks;
  const seen: (readonly ChildShape[])[] = [];
  const Box = defineObject({ type: `test.box-${n}`, version: 1, props: {}, kind: boxKind({ radius: 0, chips: 64, finishes: [], ...law }, seen), container: { accepts: ["test.boxed"] } });
  const token = (type: string, finish: ChipFinish | readonly ChipFinish[] | null) => defineObject({ type: `${type}-${n}`, version: 1, props: {}, kind: tokenKind(type, finish), provides: ["test.boxed"] });
  const Foil = token("test.foil", "foil");
  const Either = token("test.either", ["gold", "paper"]);
  const Gold = token("test.gold", "gold");
  const Bare = token("test.bare", null);
  const objects = [Box, Foil, Either, Gold, Bare];
  const ce = createCanvasEngine({ widgets: objects });
  ce.docs.create();
  const box = ce.ops.spawnWidget(Box.type, { x: -300, y: -200, w: 600, h: 400, undoable: false });
  ce.step(16);
  for (const [i, t] of [Foil, Either, Gold, Bare].entries()) ce.ops.spawnWidget(t.type, { x: 40 * i, y: 0, w: 20, h: 20, parent: box as Entity, undoable: false });
  ce.step(32);
  const builder = createDeskBuilder(ce.world, { objects });
  builder.changed();
  const built = builder.build(CAM, VP, 1 / 60, themeFrom("light", PALETTE), DEFAULT_GRID, new Map(), { now: 0 });
  return { ce, seen, built, builder, box };
}

describe("a chip names its finish, the container declares the finishes it draws (K8a)", () => {
  it("the builder hands a plugin container its children's chips in the finishes it draws — a list's first it draws wins; one it draws none of is left out, counted", () => {
    const { ce, seen, built } = desk({ finishes: ["paper", "foil"] });
    try {
      const chips = seen.at(-1) ?? [];
      expect(chips.map((c) => c.finish)).toEqual(["foil", "paper"]);
      expect(built.stats.work.unchipped).toBe(1);   // the gold one: its container draws no gold
    } finally {
      ce.dispose();
    }
  });

  it("a container that declares no finish draws no chip at all — its face law is its own, not a default", () => {
    const { ce, seen, built } = desk({ finishes: [] });
    try {
      expect(seen.at(-1)).toEqual([]);
      expect(built.stats.work.unchipped).toBe(3);   // three children had chips; none in a finish it draws
    } finally {
      ce.dispose();
    }
  });
});

describe("a container's numbers are its own face law (K8a): its face's corner and its chip cap", () => {
  it("the builder cuts a container's chips at ITS cap — not the kit's 64", () => {
    const { ce, seen, built } = desk({ chips: 1, finishes: ["paper", "foil"] });
    try {
      expect((seen.at(-1) ?? []).map((c) => c.finish)).toEqual(["foil"]);   // the first child's, and no more
      expect(built.stats.work.unchipped).toBe(0);   // the cap stopped the walk before the gold one was asked
    } finally {
      ce.dispose();
    }
  });

  it("the inside is clipped by ITS corner — the view through its face reads the container's radius, not the kit's 0", () => {
    const { ce, builder, box } = desk({ radius: 12, finishes: ["paper"] });
    try {
      expect(builder.insideViewOf(box)?.clip.r).toBe(12);
      const square = desk({ radius: 0, finishes: ["paper"] });
      try {
        expect(square.builder.insideViewOf(square.box)?.clip.r).toBe(0);
      } finally {
        square.ce.dispose();
      }
    } finally {
      ce.dispose();
    }
  });
});
