/**
 * Presentation profiles (design-012 §3, §11 Q2).
 *
 * The composited profile's checks are the interesting half. Two of them fail
 * visibly on their own — no device, no ground layer. The third is the one that
 * earns its keep: a ground layer built WITHOUT the device renders a perfectly
 * plausible screen that is quietly the stratified one, so "composited" would be
 * a claim about a build rather than about what is on screen.
 */
import type { CanvasEngine, EngineGpu, ReflectorDef } from "@ice/core";
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
