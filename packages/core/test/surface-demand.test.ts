/**
 * The demand doctrine, in two halves.
 *
 * The PURE half (design-012 §4, decision 7) — `foldDemand` and the buckets.
 * These are the decisions the compositor makes hundreds of times a second, so
 * they are pinned here rather than inferred from a rig's output.
 *
 * The SYSTEM half (design-013 §5, §6 step 3; added at A1a) — the one writer of
 * the `SurfaceDemand` COMPONENT. What it must prove is that it reproduces the
 * pure half exactly, over the whole input space rather than at chosen points:
 * a clamp with a second implementation is two answers to one question, and the
 * only way to know there is one implementation is to check the outputs agree
 * everywhere.
 *
 * (2026-09-06 erratum: this file's header used to call the plain interface
 * `SurfaceDemand`. That name belongs to the component now; the plain shape is
 * `SurfaceDemandValue` — design-013 D3.)
 */
import { createWorld, type Entity, type World } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SURFACE_DEMAND,
  PAUSED_SURFACE_DEMAND,
  demandIntervalMs,
  foldDemand,
  toFpsBucket,
  type SurfaceFpsBucket,
} from "../src/surface/contract";
import {
  Camera,
  Culled,
  Grab,
  RequestedDemand,
  SurfaceDemand,
  Viewport,
  Visible,
  createEngine,
  createSurfaceDemandSystem,
} from "../src";

describe("fps buckets", () => {
  it("rounds DOWN, so nobody buys a rate they did not ask for", () => {
    // 24 fps yields 15, not 30. Demand is a ceiling a surface must justify;
    // rounding up would hand out headroom on request.
    expect(toFpsBucket(24)).toBe(15);
    expect(toFpsBucket(59)).toBe(30);
    expect(toFpsBucket(1)).toBe(0);
  });

  it("passes exact bucket values through untouched", () => {
    for (const bucket of [0, 2, 5, 10, 15, 30, 60] as const) {
      expect(toFpsBucket(bucket)).toBe(bucket);
    }
  });

  it("clamps a rate above the top bucket rather than inventing one", () => {
    // A CSS-keyframe card self-invalidates at ~240/s (hic-bench §5); it does
    // not get a 240 bucket for asking.
    expect(toFpsBucket(240)).toBe(60);
  });
});

describe("demand intervals", () => {
  it("turns a bucket into the minimum gap between uploads", () => {
    expect(demandIntervalMs({ mode: "live", fpsBucket: 30, interactive: false })).toBeCloseTo(33.33, 1);
    expect(demandIntervalMs({ mode: "live", fpsBucket: 2, interactive: false })).toBe(500);
  });

  it("owes nothing at all when paused or at bucket 0", () => {
    // Infinity, not a large number: "never, until demand changes" is a
    // different statement from "very rarely", and the throttle parks on it.
    expect(demandIntervalMs(PAUSED_SURFACE_DEMAND)).toBe(Number.POSITIVE_INFINITY);
    expect(demandIntervalMs({ mode: "live", fpsBucket: 0, interactive: false })).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe("folding demand against what the engine knows", () => {
  it("folds invisibility to PAUSED at the source", () => {
    // What makes an off-screen animating card genuinely free rather than
    // merely cheap (design-012 §4).
    expect(foldDemand(DEFAULT_SURFACE_DEMAND, { visible: false })).toEqual(PAUSED_SURFACE_DEMAND);
  });

  it("lets interaction outrank a low bucket", () => {
    const folded = foldDemand(
      { mode: "live", fpsBucket: 2, interactive: false },
      { visible: true, interactive: true },
    );
    expect(folded.interactive).toBe(true);
    expect(folded.fpsBucket).toBe(2); // its own ceiling still stands
  });

  it("gives an interactive surface a real rate when it declared none", () => {
    const folded = foldDemand(
      { mode: "live", fpsBucket: 0, interactive: false },
      { visible: true, interactive: true },
    );
    expect(folded.fpsBucket).toBe(60);
  });

  it("but interaction NEVER outranks invisibility", () => {
    // A card being typed into while scrolled off-screen still has no pixels
    // anyone can see.
    expect(
      foldDemand(DEFAULT_SURFACE_DEMAND, { visible: false, interactive: true }),
    ).toEqual(PAUSED_SURFACE_DEMAND);
  });

  it("leaves a paused-by-choice surface paused when it is visible", () => {
    const folded = foldDemand(PAUSED_SURFACE_DEMAND, { visible: true });
    expect(folded.mode).toBe("paused");
    expect(demandIntervalMs(folded)).toBe(Number.POSITIVE_INFINITY);
  });
});

// --- the SYSTEM half (design-013 A1a) ---------------------------------------

const BUCKETS: readonly SurfaceFpsBucket[] = [0, 2, 5, 10, 15, 30, 60];

function demandRig() {
  const world: World = createWorld();
  const engine = createEngine(world);
  // A reflector arms reactivity; without one nothing journals and the guard
  // never sees the writes it gates on (design-002 §4).
  engine.registerReflector({ name: "armed", observe: { resources: [Camera] }, flush: () => {} });
  engine.addSystems("present:infra", createSurfaceDemandSystem(world));
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
  const card = (
    requested: { mode: "live" | "paused"; fpsBucket: number; interactive: boolean },
    opts: { visible?: boolean; grabbed?: boolean } = {},
  ): Entity => {
    const components: [typeof RequestedDemand | typeof SurfaceDemand | typeof Grab, object][] = [
      [RequestedDemand, requested],
      [SurfaceDemand, { mode: "paused", fpsBucket: 0, interactive: false }],
    ];
    if (opts.grabbed === true) {
      components.push([Grab, { x: 0, y: 0, w: 10, h: 10, parent: 0, prev: 0, ord: 0 }]);
    }
    return world.spawn({
      // biome-ignore lint/suspicious/noExplicitAny: heterogeneous spawn component list
      components: components as any,
      tags: opts.visible === false ? [Culled] : [Visible],
    });
  };
  const demandOf = (e: Entity) => {
    const cell = world.get(e, SurfaceDemand);
    return cell === undefined
      ? undefined
      : { mode: cell.mode, fpsBucket: cell.fpsBucket, interactive: cell.interactive };
  };
  const ran = (): boolean | undefined =>
    engine.lastFrame()?.systems.find((s) => s.system === "surfaceDemand")?.ran;
  return { world, step, card, demandOf, ran };
}

describe("the Demand system reproduces foldDemand, everywhere", () => {
  it("agrees with the pure clamp for EVERY (mode, bucket, visible, grab) combination", () => {
    // 2 × 7 × 2 × 2 = 56 cards in one world. The system is the only writer, so
    // a disagreement anywhere is a second implementation of the clamp.
    const { step, card, demandOf } = demandRig();
    const cases: Array<{
      e: Entity;
      want: ReturnType<typeof foldDemand>;
      label: string;
    }> = [];
    for (const mode of ["live", "paused"] as const) {
      for (const fpsBucket of BUCKETS) {
        for (const visible of [true, false]) {
          for (const grabbed of [true, false]) {
            const requested = { mode, fpsBucket, interactive: false };
            cases.push({
              e: card(requested, { visible, grabbed }),
              want: foldDemand(requested, { visible, interactive: grabbed }),
              label: `${mode}/${fpsBucket}/vis=${visible}/grab=${grabbed}`,
            });
          }
        }
      }
    }
    step();
    for (const c of cases) {
      expect({ label: c.label, got: demandOf(c.e) }).toEqual({
        label: c.label,
        got: { mode: c.want.mode, fpsBucket: c.want.fpsBucket, interactive: c.want.interactive },
      });
    }
  });

  it("folds a culled card to paused — at the source, so the producer stops", () => {
    const { world, step, card, demandOf } = demandRig();
    const e = card({ mode: "live", fpsBucket: 60, interactive: false });
    step();
    expect(demandOf(e)).toEqual({ mode: "live", fpsBucket: 60, interactive: false });
    world.removeTag(e, Visible);
    world.addTag(e, Culled);
    step();
    expect(demandOf(e)).toEqual(PAUSED_SURFACE_DEMAND);
    // …and it comes back on the flip, at what it asked for, not at a default.
    world.removeTag(e, Culled);
    world.addTag(e, Visible);
    step();
    expect(demandOf(e)).toEqual({ mode: "live", fpsBucket: 60, interactive: false });
  });

  it("a grab raises interactive on the edge, and a release drops it", () => {
    const { world, step, card, demandOf } = demandRig();
    const e = card({ mode: "live", fpsBucket: 2, interactive: false });
    step();
    expect(demandOf(e)?.interactive).toBe(false);
    world.addComponent(e, Grab, { x: 0, y: 0, w: 10, h: 10, parent: 0, prev: 0, ord: 0 });
    step();
    expect(demandOf(e)).toEqual({ mode: "live", fpsBucket: 2, interactive: true });
    world.removeComponent(e, Grab);
    step();
    expect(demandOf(e)?.interactive).toBe(false);
  });

  it("interaction never outranks invisibility, through the system too", () => {
    const { step, card, demandOf } = demandRig();
    const e = card({ mode: "live", fpsBucket: 60, interactive: false }, { visible: false, grabbed: true });
    step();
    expect(demandOf(e)).toEqual(PAUSED_SURFACE_DEMAND);
  });
});

describe("the Demand system writes change-only", () => {
  it("a settled card is not rewritten, and quiet frames do not enter the body", () => {
    // A declared write blanket-stamps for any system that RUNS, so the gate has
    // to live in runIf. Idle frames must skip entirely.
    const { step, card, demandOf, ran } = demandRig();
    const e = card({ mode: "live", fpsBucket: 30, interactive: false });
    step();
    expect(ran()).toBe(true); // first sight
    const settled = demandOf(e);
    for (let i = 0; i < 5; i++) {
      step();
      expect(ran()).toBe(false);
      expect(demandOf(e)).toEqual(settled);
    }
  });

  it("re-requesting the SAME demand runs the body but writes nothing", () => {
    // The guard wakes on a RequestedDemand write whether or not the value
    // moved; the change-only compare is the second line of defence, and it is
    // the one that keeps a re-request from stamping every reader.
    const { world, step, card, demandOf } = demandRig();
    const e = card({ mode: "live", fpsBucket: 15, interactive: false });
    step();
    const before = demandOf(e);
    let writes = 0;
    const collector = world.changes.collect({ components: [SurfaceDemand], coarse: false });
    collector.drain();
    for (let i = 0; i < 3; i++) {
      world.edit(e).set(RequestedDemand, { mode: "live", fpsBucket: 15, interactive: false });
      step();
      writes += collector.drain().changed.length;
    }
    collector.dispose();
    expect(demandOf(e)).toEqual(before);
    expect(writes).toBe(0);
  });

  it("a real change IS written, so the change-only compare is not just silence", () => {
    const { world, step, card, demandOf } = demandRig();
    const e = card({ mode: "live", fpsBucket: 15, interactive: false });
    step();
    world.edit(e).set(RequestedDemand, { mode: "live", fpsBucket: 5, interactive: false });
    step();
    expect(demandOf(e)).toEqual({ mode: "live", fpsBucket: 5, interactive: false });
    world.edit(e).set(RequestedDemand, { mode: "paused", fpsBucket: 5, interactive: false });
    step();
    expect(demandOf(e)?.mode).toBe("paused");
    expect(demandIntervalMs({ mode: "paused", fpsBucket: 5, interactive: false })).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it("leaves the equip default alone until it has something to say", () => {
    // Equip stamps paused/0/false and a card that is culled from birth wants
    // exactly that — the system must not write it back onto itself.
    const { step, card, demandOf } = demandRig();
    const e = card({ mode: "live", fpsBucket: 60, interactive: false }, { visible: false });
    step(3);
    expect(demandOf(e)).toEqual(PAUSED_SURFACE_DEMAND);
    expect(DEFAULT_SURFACE_DEMAND.fpsBucket).toBe(toFpsBucket(60)); // the request it kept
  });
});
