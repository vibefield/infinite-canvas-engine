// @vitest-environment node
/**
 * D-C4.6 — the bridge's typed seams DEFAULT from the facade.
 *
 * Every host used to repeat `{ transitions: ce.transitions, gpu: ce.gpu }`, and
 * a host that forgot got a bridge whose `transitions` is `undefined` — so
 * `GLViews` registered no adapter, the `gl` plane had no owner, and a
 * cross-type enter carrying any island was gated to a SNAP with nothing in the
 * app saying why. Hand `createGLBridge` the `CanvasEngine` itself and the
 * omission is not expressible; a bare `Engine` still works and carries neither.
 */
import { createCanvasEngine, createEngine } from "@ice/core";
import { createWorld } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import { createGLBridge } from "../src/bridge";

describe("createGLBridge over the CanvasEngine facade", () => {
  it("takes `transitions` and `gpu` from the facade with no options at all", () => {
    const ce = createCanvasEngine();

    const bridge = createGLBridge(ce);

    expect(bridge.transitions).toBe(ce.transitions);
    expect(bridge.gpu).toBe(ce.gpu);
    expect(bridge.engine).toBe(ce.engine); // the bare engine, unwrapped
    ce.dispose();
  });

  it("an explicit option still overrides the facade's seam", () => {
    const ce = createCanvasEngine();
    const other = createCanvasEngine();

    const bridge = createGLBridge(ce, { transitions: other.transitions });

    expect(bridge.transitions).toBe(other.transitions);
    expect(bridge.transitions).not.toBe(ce.transitions);
    expect(bridge.gpu).toBe(ce.gpu); // the one not overridden still defaults
    ce.dispose();
    other.dispose();
  });

  it("a bare engine carries neither seam — and asking for none is not an error", () => {
    const engine = createEngine(createWorld());

    const bridge = createGLBridge(engine);

    expect(bridge.engine).toBe(engine);
    expect(bridge.transitions).toBeUndefined();
    expect(bridge.gpu).toBeUndefined();
  });
});
