// @vitest-environment node
// The new composited profile's boot gate and roster (design-013 §8 B2): it refuses a
// device-less engine, a missing ground and the OLD leg's ground; with the ground's own
// layer it registers the five reflectors of §6 in order — the four stubs, then GpuCompose.
import { alwaysGpu, Camera, createCanvasEngine, defineCanvasType, defineWidget, type ReflectorDef, TextureRef, type TextureTable, tools, Viewport, widgets } from "@ice/core";
import { describe, expect, it } from "vitest";
import { compositedNextProfile } from "../src/profiles/composited-next";
import type { ProfileBootContext } from "../src/profiles/contract";

// A promoted dom card, for the raster-strategy measurement below.
const CARD = widgets.get("cnp:card") ?? defineWidget({ type: "cnp:card", surface: "dom", component: null, defaultSize: { w: 100, h: 60 }, behaviors: [alwaysGpu] });
const CARD_ROOT = defineCanvasType({ id: "cnp:root", semanticVersion: 1, semantic: { placement: { widgets: [CARD] } }, presentation: { camera: { arrival: "identity" } } });
function need<T>(v: T | undefined, what: string): T { if (v === undefined) throw new Error(`expected ${what}`); return v; }
const PROFILE_TOOLS = [need(tools.get("select"), "the select tool"), need(tools.get("pan"), "the pan tool")];

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
  it("carries the ground's raster strategy to Residency (B4, §9 Q1) — declared once, read by two, MEASURED on the slot", () => {
    // The strategy reaches the system that sizes the slot; DomRender calls
    // `geometry()` with the SAME function, which is what makes the host box and
    // the slot one number rather than two that happen to agree. Measured by the
    // slot Residency actually reserves at a zoom where the two strategies
    // disagree: at zoom 3 the band is 4 (`selectBand`), so `band` reserves
    // `Size × 4 × dpr` and `crisp` reserves `Size × 3 × dpr`.
    const slotFor = (raster?: () => "band" | "crisp"): number => {
      const ce = createCanvasEngine({ widgets: [CARD], canvasTypes: [CARD_ROOT], rootCanvas: CARD_ROOT, presentationFallback: CARD_ROOT, tools: PROFILE_TOOLS });
      ce.docs.create();
      ce.world.setResource(Viewport, { w: 1600, h: 900, dpr: 1 });
      ce.world.setResource(Camera, { x: 0, y: 0, zoom: 3, gesturing: false });
      const ctx = {
        engine: { engine: ce.engine, compositorDevice: { device: { limits: { maxTextureDimension2D: 4096 } } } },
        ground: { reflector: slot, configureGrid() {}, dispose() {}, compose: { gpuCompose, residency: { attach() {} }, ...(raster !== undefined ? { raster } : {}) } },
      } as unknown as ProfileBootContext;
      const remove = must(compositedNextProfile.install)(ctx);
      const card = ce.ops.spawnWidget("cnp:card", { x: 0, y: 0, w: 100, h: 60, undoable: false });
      ce.world.sync();
      for (let i = 1; i <= 6; i++) ce.step(i * 16);
      const ref = ce.world.get(card, TextureRef);
      remove();
      if (ref === undefined) throw new Error("no TextureRef");
      // The slot's width in texels, read back off the uv over the layer side.
      return Math.round((ref.u1 - ref.u0) * 2048);
    };
    expect(slotFor()).toBe(400);                              // band 4 — the default
    expect(slotFor(() => "band")).toBe(400);
    expect(slotFor(() => "crisp")).toBe(300);                 // the live zoom, the ground's choice
  });
});
const must = <T>(v: T | undefined): T => { if (v === undefined) throw new Error("expected a value"); return v; };
