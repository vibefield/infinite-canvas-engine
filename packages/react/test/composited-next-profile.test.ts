// @vitest-environment node
// The new composited profile's boot gate and roster (design-013 §8 B2): it refuses a
// device-less engine, a missing ground and the OLD leg's ground; with the ground's own
// layer it registers the five reflectors of §6 in order — the four stubs, then GpuCompose.
import { createCanvasEngine, type ReflectorDef, type TextureTable } from "@ice/core";
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
  it("owns the chrome (design-014, B3b) and takes the ground's DomCompose into the roster when the handle carries it", () => {
    expect(compositedNextProfile.chromeOwner).toBe("ground");
    const domCompose: ReflectorDef = { name: "ground/dom-compose", always: true, flush() {} };
    const ctx = { ...ctxOf(true, "compose"), ground: { reflector: slot, configureGrid() {}, dispose() {}, compose: { gpuCompose, domCompose } } as unknown as ProfileBootContext["ground"] };
    expect(compositedNextProfile.reflectorsAfterGround(ctx).map((r) => r.name)).toEqual(["dom-render", "island-render", "video-ingest", "ground/dom-compose", "ground/gpu-compose"]);
  });
  it("registers §6's roster in order, GpuCompose last; nothing for a foreign ground", () => {
    const names = compositedNextProfile.reflectorsAfterGround(ctxOf(true, "compose")).map((r) => r.name);
    expect(names).toEqual(["dom-render", "island-render", "video-ingest", "dom-compose", "ground/gpu-compose"]);
    expect(compositedNextProfile.reflectorsAfterGround(ctxOf(true, "compose")).at(-1)).toBe(gpuCompose);
    expect(compositedNextProfile.reflectorsAfterGround(ctxOf(true, "old"))).toEqual([]);
  });
  it("owns the texture table (B4a): install attaches it to the ground's residency, sizes own textures to the device, and disposes it last", () => {
    const ce = createCanvasEngine();
    let attached: TextureTable | null = null;
    const ctx = {
      engine: { engine: ce.engine, compositorDevice: { device: { limits: { maxTextureDimension2D: 4096 } } } },
      ground: { reflector: slot, configureGrid() {}, dispose() {}, compose: { gpuCompose, residency: { attach(t: TextureTable) { attached = t; } } } },
    } as unknown as ProfileBootContext;
    const remove = must(compositedNextProfile.install)(ctx);
    const table = attached as TextureTable | null;
    if (table === null) throw new Error("the profile did not attach its table");
    const pages = table.pages();
    expect(table.describe(pages)).toMatchObject({ kind: "pages", size: 2048 });
    remove();
    expect(table.describe(pages)).toBeUndefined();   // disposed with the profile
  });
});
const must = <T>(v: T | undefined): T => { if (v === undefined) throw new Error("expected a value"); return v; };
