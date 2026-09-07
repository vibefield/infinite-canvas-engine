/**
 * The A2 exit rehearsal — a 12-card board driven through the S6 drag script
 * (grab → move → release → settle), asserting the `TextureRef` timeline FRAME
 * BY FRAME (plan §2 A2 exit).
 *
 * What it is for. Every other residency test states one rule and checks it.
 * This one checks that the rules compose over a gesture: that the promotion a
 * grab causes reaches Residency in the SAME step (the D1 settle point — an
 * infra system in `present:infra` runs after the kind behaviour has spoken, so
 * a card is never "absent for a frame"), that a move writes NOTHING because a
 * card's position is not a residency input, that the slot survives the whole
 * settle window, and that the demotion gives it back.
 *
 * What it deliberately does NOT use. The kind behaviours — `ice:surface.domAtRest`
 * and the settle window it debounces demotion with — land in A1b, which is being
 * built in parallel with this slice. So the gesture is driven by writing
 * `SurfaceTarget` directly, exactly as that behaviour will: promotion on the
 * grab edge, demotion once the window expires. The timeline asserted here is
 * the one the behaviour must produce, and when A1b lands this rehearsal is what
 * says it does.
 *
 * No pixels. B3 is where pixels are the witness (plan §3).
 */
import { createWorld, type Entity, type World } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import {
  Camera,
  createEngine,
  createLayerAllocator,
  createTextureTable,
  installSurfaceInfra,
  packKey,
  Position,
  Size,
  SurfaceBand,
  SurfaceKind,
  SurfaceTarget,
  TextureRef,
  Viewport,
  Visible,
} from "../../src";

const CARDS = 12;
const SETTLE_FRAMES = 15; // what a 250 ms window is at 16 ms/frame

interface Ref {
  texture: number;
  layer: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

function board() {
  const world: World = createWorld();
  const engine = createEngine(world);
  engine.registerReflector({ name: "armed", observe: { resources: [Camera] }, flush: () => {} });

  const table = createTextureTable({ pageSize: 2048 });
  const allocator = createLayerAllocator({ layerSize: 2048, maxLayers: 4 });
  installSurfaceInfra(engine, { residency: { table, allocator, budgetBytes: 256 * 1024 * 1024 } });
  engine.enableTelemetry();
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  world.setResource(Viewport, { w: 1280, h: 800, dpr: 2 });

  let t = 0;
  const step = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      t += 16;
      engine.step(t);
    }
  };

  // A resting board: every card live-dom, which is `domAtRest`'s standing state.
  const cards: Entity[] = [];
  for (let i = 0; i < CARDS; i++) {
    cards.push(
      world.spawn({
        components: [
          [Position, { x: (i % 4) * 200, y: Math.floor(i / 4) * 140 }],
          [Size, { w: 160, h: 100 }],
          [SurfaceKind, { kind: "dom" }],
          [SurfaceTarget, { target: "dom" }],
          [SurfaceBand, { band: 0 }],
          [TextureRef, { texture: 0, layer: 0, u0: 0, v0: 0, u1: 0, v1: 0 }],
        ],
        tags: [Visible],
      }),
    );
  }

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
  const holds = (e: Entity): boolean => refOf(e).texture !== 0;
  const promote = (e: Entity): void => {
    world.edit(e).set(SurfaceTarget, { target: "gpu" });
  };
  const demote = (e: Entity): void => {
    world.edit(e).set(SurfaceTarget, { target: "dom" });
  };
  const moveBy = (e: Entity, dx: number, dy: number): void => {
    const p = world.get(e, Position);
    if (p !== undefined) world.edit(e).set(Position, { x: p.x + dx, y: p.y + dy });
  };
  const ranResidency = (): boolean | undefined =>
    engine.lastFrame()?.systems.find((s) => s.system === "residency")?.ran;

  return { world, engine, table, allocator, step, cards, refOf, holds, promote, demote, moveBy, ranResidency };
}

describe("the 12-card rehearsal: grab → move → release → settle", () => {
  it("walks the whole gesture with the TextureRef timeline asserted frame by frame", () => {
    const b = board();
    const dragged = b.cards[5] as Entity;
    const others = b.cards.filter((e) => e !== dragged);

    // ── At rest: every card is live-dom, so the board holds no destination.
    b.step(2);
    for (const e of b.cards) expect(b.holds(e), "a resting board holds nothing").toBe(false);
    expect(b.allocator.held()).toBe(0);
    expect(b.allocator.layers()).toHaveLength(0);

    // ── The grab edge. Promotion and allocation land in the SAME step: Band
    // writes the card's first band and Residency, later in `present:infra`,
    // reads it in that same tick. A card is never absent for a frame.
    b.promote(dragged);
    b.step();
    const onGrab = b.refOf(dragged);
    expect(onGrab.texture, "allocated the same frame the grab promoted it").not.toBe(0);
    expect(b.world.get(dragged, SurfaceBand)?.band).toBe(1);
    expect(b.allocator.held()).toBe(1);
    expect(b.table.describe(onGrab.texture)).toMatchObject({ kind: "pages" });
    // 160 × 100 world at band 1, dpr 2 → a 320 × 200 device-px slot.
    const slot = b.allocator.get(packKey(dragged, 1));
    expect(slot?.rect.width).toBe(320);
    expect(slot?.rect.height).toBe(200);
    for (const e of others) expect(b.holds(e), "the other eleven are untouched").toBe(false);

    // ── The move. Position is NOT a residency input: eleven frames of dragging
    // must not run the system at all, let alone rewrite a ref.
    for (let frame = 0; frame < 11; frame++) {
      b.moveBy(dragged, 7, -3);
      b.step();
      expect(b.ranResidency(), `move frame ${frame}: a move is not residency's business`).toBe(false);
      expect(b.refOf(dragged), `move frame ${frame}`).toEqual(onGrab);
    }
    expect(b.allocator.held()).toBe(1);

    // ── The release edge. `domAtRest` debounces demotion, so the card stays on
    // the GPU for the whole settle window — and its slot stays exactly where it
    // was, which is what makes the window free rather than merely short.
    for (let frame = 0; frame < SETTLE_FRAMES; frame++) {
      b.step();
      expect(b.refOf(dragged), `settle frame ${frame}: the slot is held, unchanged`).toEqual(onGrab);
    }
    expect(b.allocator.held()).toBe(1);

    // ── The window expires. The demotion gives the slot back and zeroes the ref
    // in one step, and the atlas comes back to nothing — layer included. A run
    // that freed a slot opens the memory door itself, so the board that emptied
    // is not still holding a layer nobody is in (the Phase A review's fix: the
    // budget loop could never open it at the default settings).
    b.demote(dragged);
    b.step();
    expect(b.refOf(dragged)).toEqual({ texture: 0, layer: 0, u0: 0, v0: 0, u1: 0, v1: 0 });
    expect(b.allocator.held()).toBe(0);
    expect(b.allocator.layers(), "the emptied layer was reclaimed in the step").toHaveLength(0);
    expect(b.allocator.retireEmpty(), "…so there is nothing left to retire").toEqual([]);
    for (const e of b.cards) expect(b.holds(e)).toBe(false);
  });

  it("a re-grab inside the window is a HIT: the same slot, no second allocation", () => {
    const b = board();
    const e = b.cards[3] as Entity;

    b.step(2);
    b.promote(e);
    b.step();
    const first = b.refOf(e);
    expect(first.texture).not.toBe(0);

    // Release, wait part of the window, grab again — `domAtRest` cancels the
    // pending demotion, so nothing ever wrote `dom` and nothing was given back.
    b.step(5);
    b.promote(e); // idempotent: the value is already gpu, so it is not even a write
    b.step(3);

    expect(b.refOf(e), "the very same slot, uv for uv").toEqual(first);
    expect(b.allocator.held()).toBe(1);
    expect(b.allocator.layers()).toHaveLength(1);
  });

  it("a whole board promoted at once shares one layer, and gives it all back", () => {
    const b = board();
    b.step(2);

    for (const e of b.cards) b.promote(e);
    b.step();

    for (const e of b.cards) expect(b.holds(e), "every card got its slot in one step").toBe(true);
    expect(b.allocator.held()).toBe(CARDS);
    expect(b.allocator.layers(), "twelve 320×200 slots share one 2048² layer").toHaveLength(1);
    // Every card samples through ONE binding — the whole reason layers are fixed
    // (§10.4). So every ref names the same texture handle and the same layer.
    const handles = new Set(b.cards.map((e) => b.refOf(e).texture));
    const layers = new Set(b.cards.map((e) => b.refOf(e).layer));
    expect(handles.size).toBe(1);
    expect(layers.size).toBe(1);
    // …and no two of them name the same rect.
    const rects = b.cards.map((e) => JSON.stringify(b.refOf(e)));
    expect(new Set(rects).size).toBe(CARDS);

    // The table's `pages` entry tracks the allocator's layer COUNT — the array
    // length, which is what tells B how many array layers to realise.
    const pages = b.refOf(b.cards[0] as Entity).texture;
    expect(b.table.describe(pages)).toMatchObject({ kind: "pages", size: 2048, layers: 1 });

    for (const e of b.cards) b.demote(e);
    b.step();
    expect(b.allocator.held()).toBe(0);
    expect(b.allocator.layers(), "the emptied layer is retired in the same step").toHaveLength(0);
    expect(b.table.describe(pages), "and the published array shrinks with it").toMatchObject({
      layers: 0,
    });
  });
});
