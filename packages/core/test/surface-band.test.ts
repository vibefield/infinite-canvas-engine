/**
 * Band (infra) — the ONE writer of `SurfaceBand` (design-013 §5, §6 step 2).
 *
 * The rule under test is the dom source binder's, moved into the world
 * unchanged: hold the band a card's pixels were sized for until the live zoom
 * leaves `[band × 0.5, band × 2]`, then step to the band for the current zoom.
 * The invariant that matters is not "which band" but "the held band always
 * brackets the zoom", and it is checked as a PROPERTY over a seeded zoom walk
 * rather than at hand-picked points — the boundary cases (`ratio > 2` is still
 * false at exactly 2×) are where a re-derivation of this rule would drift, and
 * a walk visits them without anyone choosing them.
 *
 * The write COUNT is checked beside it, because a band system that re-wrote the
 * same number every frame would satisfy the invariant perfectly and cost a
 * stamp per visible card per frame — the churn this design's §3 exists to
 * forbid.
 */
import { createWorld, type Entity, type World } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import {
  Camera,
  Culled,
  Position,
  Size,
  SurfaceBand,
  SurfaceKind,
  SurfaceTarget,
  Viewport,
  Visible,
  createEngine,
  createSurfaceBandSystem,
  setDevGuards,
} from "../src";
import { ZOOM_BANDS, isOutOfBand, selectBand } from "@ice/kernel";

/** The ladder's clamped ends — a zoom past either legitimately sits outside the window. */
const LADDER_FLOOR = ZOOM_BANDS[0] as number;
const LADDER_CEILING = ZOOM_BANDS[ZOOM_BANDS.length - 1] as number;

interface CardOpts {
  kind?: "dom" | "gl" | "video";
  target?: "dom" | "gpu";
  visible?: boolean;
  band?: number;
}

function rig() {
  const world: World = createWorld();
  const engine = createEngine(world);
  // A reflector arms reactivity — without one, nothing journals and the guard
  // is fed an empty world (design-002 §4; the breakpoint suite's precedent).
  engine.registerReflector({ name: "armed", observe: { resources: [Camera] }, flush: () => {} });
  engine.addSystems("present:infra", createSurfaceBandSystem(world));
  engine.enableTelemetry();
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  world.setResource(Viewport, { w: 800, h: 600, dpr: 2 });
  let now = 0;
  const step = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      now += 16;
      engine.step(now);
    }
  };
  const card = (opts: CardOpts = {}): Entity =>
    world.spawn({
      components: [
        [Position, { x: 0, y: 0 }],
        [Size, { w: 80, h: 48 }],
        [SurfaceKind, { kind: opts.kind ?? "dom" }],
        [SurfaceTarget, { target: opts.target ?? "gpu" }],
        [SurfaceBand, { band: opts.band ?? 0 }],
      ],
      tags: opts.visible === false ? [Culled] : [Visible],
    });
  const bandOf = (e: Entity): number => world.get(e, SurfaceBand)?.band ?? Number.NaN;
  const zoomTo = (z: number): void => {
    const cam = world.getResource(Camera);
    world.setResource(Camera, { ...(cam ?? { x: 0, y: 0, gesturing: false }), zoom: z });
  };
  const panBy = (dx: number, dy: number): void => {
    const cam = world.getResource(Camera);
    if (cam === undefined) return;
    world.setResource(Camera, { ...cam, x: cam.x + dx, y: cam.y + dy });
  };
  const ran = (): boolean | undefined =>
    engine.lastFrame()?.systems.find((s) => s.system === "surfaceBand")?.ran;
  return { world, engine, step, card, bandOf, zoomTo, panBy, ran };
}

describe("the hysteresis invariant, under a seeded zoom walk", () => {
  it("every visible gpu card's held band brackets the zoom: band/2 ≤ zoom ≤ 2·band", () => {
    const { step, card, bandOf, zoomTo, world } = rig();
    const cards = [card(), card(), card()];
    // The repo's LCG (kernel/test/prng.ts, ground/test/atlas-allocator.test.ts).
    let seed = 20260906;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    step(); // first sight: everything gets a band

    let zoom = 1;
    for (let i = 0; i < 400; i++) {
      // A multiplicative walk visits band edges from both sides, including the
      // exact 2× boundary where `ratio > 2` is still false.
      zoom = Math.min(20, Math.max(0.03, zoom * (0.55 + rand() * 1.4)));
      zoomTo(zoom);
      step();
      for (const e of cards) {
        const band = bandOf(e);
        expect(band).toBeGreaterThan(0);
        // The window the rule promises. The ladder is clamped at both ends, so
        // a zoom past the top or bottom band legitimately sits outside it —
        // that is `selectBand`'s clamp, not a hysteresis failure.
        if (band > LADDER_FLOOR && band < LADDER_CEILING) {
          expect(zoom).toBeGreaterThanOrEqual(band * 0.5);
          expect(zoom).toBeLessThanOrEqual(band * 2);
        }
        // And the band is always ON the ladder — never an interpolated value.
        expect(ZOOM_BANDS).toContain(band);
      }
      // Every card sees the same zoom, so they must agree.
      expect(new Set(cards.map(bandOf)).size).toBe(1);
    }
    expect(world.getResource(Camera)?.zoom).toBeCloseTo(zoom, 10);
  });

  it("writes EXACTLY as often as the rule says the band changes — no more", () => {
    const { step, card, bandOf, zoomTo } = rig();
    const e = card();
    let seed = 424242;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    step();

    let writes = 0;
    let held = bandOf(e);
    let expected = 0;
    // A walk in LOG-zoom space, reflected at the ladder's ends rather than
    // clamped: a clamped walk drifts to a rail and sits there, crossing almost
    // nothing, which would let a system that writes far too rarely pass.
    let logZoom = 0;
    for (let i = 0; i < 300; i++) {
      logZoom += (rand() - 0.5) * 2.4;
      if (logZoom > 4) logZoom = 8 - logZoom;
      if (logZoom < -4) logZoom = -8 - logZoom;
      const zoom = 2 ** logZoom;
      // The rule, computed independently of the system under test.
      const shouldBe = held === 0 || isOutOfBand(zoom, held) ? selectBand(zoom) : held;
      if (shouldBe !== held) expected += 1;
      held = shouldBe;

      zoomTo(zoom);
      const before = bandOf(e);
      step();
      if (bandOf(e) !== before) writes += 1;
    }
    expect(writes).toBe(expected);
    expect(expected).toBeGreaterThan(30); // the walk really did cross bands
    expect(bandOf(e)).toBe(held);
  });

  it("a zoom that stays INSIDE the window writes nothing at all", () => {
    const { step, card, bandOf, zoomTo } = rig();
    const e = card();
    zoomTo(1);
    step();
    expect(bandOf(e)).toBe(1);
    for (const z of [0.51, 0.9, 1.4, 1.99, 2]) {
      zoomTo(z);
      step();
      expect(bandOf(e)).toBe(1); // 2× band is still inside: `ratio > 2` is false
    }
    zoomTo(2.01);
    step();
    expect(bandOf(e)).toBe(4); // smallest band ≥ 2.01
  });
});

describe("what the system leaves alone", () => {
  it("a SIZE write never enters the body — the band is not a function of size", () => {
    // The plan's collect list named `Size`; it was an over-subscription,
    // corrected at the grading. A resize drag writes Size every frame, and a
    // declared write blanket-stamps for any system that RUNS — so collecting it
    // would stamp `SurfaceBand` on every frame of every resize, for a number
    // that cannot have moved. Size belongs to `geometry()` and to Residency.
    const { world, step, card, bandOf, ran } = rig();
    const e = card();
    step();
    expect(ran()).toBe(true); // first sight
    const band = bandOf(e);

    const collector = world.changes.collect({ components: [SurfaceBand], coarse: false });
    collector.drain();
    for (let i = 0; i < 4; i++) {
      world.edit(e).set(Size, { w: 100 + i * 10, h: 60 + i * 5 });
      step();
      expect(ran()).toBe(false); // the guard's runIf said no
    }
    expect(collector.drain().changed).toEqual([]); // and nothing was written
    collector.dispose();
    expect(bandOf(e)).toBe(band);
  });

  it("a pure PAN never enters the body — the gate is a real runIf", () => {
    // A declared write blanket-stamps for any system that RUNS, so an
    // early-out in the body would cost a stamp per pan frame. The gate has to
    // be in runIf, and this is how we know it is.
    const { step, card, panBy, ran, bandOf } = rig();
    const e = card();
    step();
    expect(ran()).toBe(true); // first sight
    const band = bandOf(e);
    for (let i = 0; i < 5; i++) {
      panBy(37, -19);
      step();
      expect(ran()).toBe(false);
    }
    expect(bandOf(e)).toBe(band);
  });

  it("a CULLED card keeps its band — retention is keyed on (entity, band)", () => {
    const { world, step, card, bandOf, zoomTo } = rig();
    const e = card();
    zoomTo(4);
    step();
    expect(bandOf(e)).toBe(4);
    // Off-screen, and the zoom moves a long way while it is gone.
    world.removeTag(e, Visible);
    world.addTag(e, Culled);
    zoomTo(0.125);
    step(2);
    expect(bandOf(e)).toBe(4); // dropping it would throw away the cache key
    // Back on-screen: it re-bands on the flip, in that frame.
    world.removeTag(e, Culled);
    world.addTag(e, Visible);
    step();
    expect(bandOf(e)).toBe(0.125);
  });

  it("…and keeps it through the DELTA path too, not only the query's filter", () => {
    // The full path is protected by the query, which is `Visible`-termed. The
    // DELTA path re-reads journaled entities one by one, so it needs its own
    // check — and the way to reach it is to journal a culled card while the
    // zoom sits still, which a re-written `SurfaceTarget` does.
    const { world, step, card, bandOf, zoomTo, ran } = rig();
    const e = card();
    zoomTo(4);
    step();
    expect(bandOf(e)).toBe(4);

    world.removeTag(e, Visible);
    world.addTag(e, Culled);
    zoomTo(0.125); // a full pass; the query already excludes it
    step();
    expect(bandOf(e)).toBe(4);

    // Zoom now still. A `SurfaceTarget` write journals the culled card, so the
    // guard fires with a DELTA rather than `full` and the body sees this entity
    // by id — which is the path the `Visible` check in it exists for.
    world.edit(e).set(SurfaceTarget, { target: "gpu" });
    step();
    expect(ran()).toBe(true); // the body really did run this frame
    expect(bandOf(e)).toBe(4);
  });

  it("a DOM-target card is never banded — it has no texture to size", () => {
    const { step, card, bandOf, zoomTo } = rig();
    const dom = card({ kind: "dom", target: "dom" });
    const gpu = card({ kind: "dom", target: "gpu" });
    for (const z of [0.25, 1, 3, 9]) {
      zoomTo(z);
      step();
      expect(bandOf(dom)).toBe(0);
    }
    // The gpu twin walked 0.25 → 1 → 4 → 16 over the same zooms (each step left
    // the previous 4× window), so "never banded" is a fact about the target,
    // not about a quiet system.
    expect(bandOf(gpu)).toBe(16);
  });

  it("promoting a dom card bands it in the SAME frame the target flips", () => {
    const { world, step, card, bandOf, zoomTo } = rig();
    const e = card({ kind: "dom", target: "dom" });
    zoomTo(1);
    step();
    expect(bandOf(e)).toBe(0);
    world.edit(e).set(SurfaceTarget, { target: "gpu" });
    step();
    expect(bandOf(e)).toBe(1);
  });
});

describe("the D5 dev guard", () => {
  it("throws on a non-dom kind carrying SurfaceTarget dom, naming entity, kind and value", () => {
    const { step, card } = rig();
    const e = card({ kind: "gl", target: "dom" });
    let message = "";
    try {
      step();
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain(String(e));
    expect(message).toContain("gl");
    expect(message).toContain("dom");
    expect(message).toContain("design-013 D5");
  });

  it("coerces silently with dev guards off — production never blanks", () => {
    setDevGuards(false);
    try {
      const { step, card, bandOf, zoomTo } = rig();
      const e = card({ kind: "gl", target: "dom" });
      zoomTo(2);
      expect(() => step()).not.toThrow();
      // effectiveTarget coerced it to gpu, so it banded like any other texture.
      expect(bandOf(e)).toBe(2);
    } finally {
      setDevGuards(true);
    }
  });
});
