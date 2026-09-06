/**
 * Presentation profiles (design-012 §3, §11 Q2).
 *
 * The composited profile's checks are the interesting half. Two of them fail
 * visibly on their own — no device, no ground layer. The third is the one that
 * earns its keep: a ground layer built WITHOUT the device renders a perfectly
 * plausible screen that is quietly the stratified one, so "composited" would be
 * a claim about a build rather than about what is on screen.
 */
import { createEngine, createWorld, defineTickSystem, type CanvasEngine, type Engine, type EngineGpu, type ReflectorDef } from "@ice/core";
import { describe, expect, it } from "vitest";
import type { GroundLayerHandle } from "../src/infinite-canvas";
import { compositedProfile } from "../src/profiles/composited";
import { stratifiedProfile } from "../src/profiles/stratified";
import type { ProfileBootContext } from "../src/profiles/contract";

const gpu = { device: {}, hasCoreFeatures: true } as unknown as EngineGpu;
const compositorReflector: ReflectorDef = { name: "compositor", always: true, flush: () => {} };

// `compositorDevice`, NOT `gpu` — design-011's `engine.gpu` is the allocation
// LEDGER, a different concept that already owns that name (§11 Q7's rule).
const engineWith = (g?: EngineGpu): CanvasEngine =>
  ({ ...(g !== undefined ? { compositorDevice: g } : {}) }) as unknown as CanvasEngine;

const groundWith = (compositor?: ReflectorDef): GroundLayerHandle =>
  ({
    reflector: { name: "ground", flush: () => {}, available: () => true },
    ...(compositor !== undefined ? { compositorReflector: compositor } : {}),
    configureGrid: () => {},
    dispose: () => {},
  }) as unknown as GroundLayerHandle;

const ctx = (engine: CanvasEngine, ground: GroundLayerHandle | null): ProfileBootContext => ({
  engine,
  ground,
});

describe("stratified profile", () => {
  it("never refuses — it runs wherever the engine runs, ground or not", () => {
    expect(stratifiedProfile.check(ctx(engineWith(), null))).toBeNull();
    expect(stratifiedProfile.check(ctx(engineWith(), groundWith()))).toBeNull();
  });

  it("contributes no reflectors — it IS the roster InfiniteCanvas always had", () => {
    expect(stratifiedProfile.reflectorsAfterGround(ctx(engineWith(), groundWith()))).toEqual([]);
  });
});

describe("composited profile", () => {
  it("mounts when the device, the ground layer and its compositor are all present", () => {
    const c = ctx(engineWith(gpu), groundWith(compositorReflector));
    expect(compositedProfile.check(c)).toBeNull();
    expect(compositedProfile.reflectorsAfterGround(c)).toEqual([compositorReflector]);
  });

  it("refuses without an app-owned device, and names the call that fixes it", () => {
    const why = compositedProfile.check(ctx(engineWith(), groundWith(compositorReflector)));
    expect(why).toContain("acquireCompositorDevice");
    expect(why).toContain("createCanvasEngine({ compositorDevice })");
  });

  it("refuses without a ground layer", () => {
    expect(compositedProfile.check(ctx(engineWith(gpu), null))).toContain("needs a ground layer");
  });

  it("refuses a ground layer built WITHOUT the device — the silent-stratified trap", () => {
    // Device present, ground present, everything looks composited — and the
    // compositor does not exist. This is the failure that would otherwise ship.
    const why = compositedProfile.check(ctx(engineWith(gpu), groundWith()));
    expect(why).toContain("no compositor");
    expect(why).toContain("ground({ device: engine.compositorDevice.device })");
  });

  it("names itself, so a refusal says WHICH profile refused", () => {
    expect(compositedProfile.name).toBe("composited");
    expect(stratifiedProfile.name).toBe("stratified");
  });
});

describe("install — a profile IS the system-set it installs (design-013 Q6)", () => {
  /** A real engine, wrapped in the facade shape the boot context carries. */
  const realEngineCtx = (): { ctx: ProfileBootContext; core: Engine } => {
    const core = createEngine(createWorld());
    const engine = { engine: core, world: core.world, compositorDevice: gpu } as unknown as CanvasEngine;
    return { ctx: { engine, ground: groundWith(compositorReflector) }, core };
  };

  it("the composited profile registers Band and Demand into present:infra", () => {
    const { ctx: c, core } = realEngineCtx();
    const order: string[] = [];
    // Two markers around the group: whatever `install` added must run between
    // them, in `present:infra`, after everything in `present`.
    core.addSystems("present", defineTickSystem(() => order.push("present"), { name: "m1" }));
    const remove = compositedProfile.install?.(c);
    expect(remove).toBeTypeOf("function");
    core.addSystems("cleanup", defineTickSystem(() => order.push("cleanup"), { name: "m2" }));
    core.enableTelemetry();
    core.step(16);

    const ran = (core.lastFrame()?.systems ?? []).map((s) => s.system);
    expect(ran).toContain("surfaceBand");
    expect(ran).toContain("surfaceDemand");
    // Band before Demand, and both after the `present` marker.
    expect(ran.indexOf("surfaceBand")).toBeLessThan(ran.indexOf("surfaceDemand"));
    expect(ran.indexOf("m1")).toBeLessThan(ran.indexOf("surfaceBand"));
    expect(ran.indexOf("surfaceDemand")).toBeLessThan(ran.indexOf("m2"));
    expect(order).toEqual(["present", "cleanup"]);
  });

  it("its remover takes BOTH systems back out — one call undoes the set", () => {
    const { ctx: c, core } = realEngineCtx();
    const remove = compositedProfile.install?.(c);
    core.enableTelemetry();
    core.step(16);
    expect((core.lastFrame()?.systems ?? []).map((s) => s.system)).toEqual(
      expect.arrayContaining(["surfaceBand", "surfaceDemand"]),
    );
    remove?.();
    core.step(32);
    const after = (core.lastFrame()?.systems ?? []).map((s) => s.system);
    expect(after).not.toContain("surfaceBand");
    expect(after).not.toContain("surfaceDemand");
  });

  it("the stratified profile installs NOTHING — the group stays empty", () => {
    // `present:infra` exists to feed a compositor. A profile without one leaves
    // the group empty, and `assemble()` omits an empty group entirely.
    expect(stratifiedProfile.install).toBeUndefined();
    const core = createEngine(createWorld());
    core.enableTelemetry();
    core.step(16);
    const ran = (core.lastFrame()?.systems ?? []).map((s) => s.system);
    expect(ran).not.toContain("surfaceBand");
    expect(ran).not.toContain("surfaceDemand");
  });
});
