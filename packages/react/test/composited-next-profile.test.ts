// @vitest-environment node
// The new composited profile's boot gate and roster (design-013 §8 B2): it refuses a
// device-less engine, a missing ground and the OLD leg's ground; with the ground's own
// layer it registers the five reflectors of §6 in order — the four stubs, then GpuCompose.
import type { ReflectorDef } from "@ice/core";
import { describe, expect, it } from "vitest";
import { compositedNextProfile } from "../src/profiles/composited-next";
import type { ProfileBootContext } from "../src/profiles/contract";

const gpuCompose: ReflectorDef = { name: "ground/gpu-compose", always: true, flush() {} };
const slot: ReflectorDef & { available(): boolean } = { name: "ground/compose-slot", always: false, flush() {}, available: () => true };
const ctxOf = (device: boolean, ground: "none" | "old" | "compose"): ProfileBootContext => ({
  engine: { compositorDevice: device ? {} : undefined } as unknown as ProfileBootContext["engine"],
  ground: ground === "none" ? null : ground === "old"
    ? { reflector: slot, compositorReflector: { name: "compositor", always: true, flush() {} }, configureGrid() {}, dispose() {} }
    : ({ reflector: slot, configureGrid() {}, dispose() {}, compose: { gpuCompose } } as unknown as ProfileBootContext["ground"]),
});

describe("compositedNextProfile", () => {
  it("is named for the program and refuses loudly", () => {
    expect(compositedNextProfile.name).toBe("composited-next");
    expect(compositedNextProfile.check(ctxOf(false, "compose"))).toMatch(/app-owned GPUDevice/);
    expect(compositedNextProfile.check(ctxOf(true, "none"))).toMatch(/ground layer/);
    expect(compositedNextProfile.check(ctxOf(true, "old"))).toMatch(/groundCompose/);
    expect(compositedNextProfile.check(ctxOf(true, "compose"))).toBeNull();
  });
  it("registers §6's roster in order, GpuCompose last; nothing for a foreign ground", () => {
    const names = compositedNextProfile.reflectorsAfterGround(ctxOf(true, "compose")).map((r) => r.name);
    expect(names).toEqual(["dom-render", "island-render", "video-ingest", "dom-compose", "ground/gpu-compose"]);
    expect(compositedNextProfile.reflectorsAfterGround(ctxOf(true, "compose")).at(-1)).toBe(gpuCompose);
    expect(compositedNextProfile.reflectorsAfterGround(ctxOf(true, "old"))).toEqual([]);
  });
});
