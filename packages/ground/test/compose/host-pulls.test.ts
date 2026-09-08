// @vitest-environment happy-dom
/**
 * THE JOURNALS DRAIN BEFORE THE GROUND EXISTS.
 *
 * `ensureBuilt`'s comment says both pulls run unconditionally — a short-circuit would leave a
 * journal undrained and its next `changed()` would answer for two frames at once. The one window
 * where that was false was the widest: `if (ground === null) return false` sat ABOVE them, so from
 * the mount until the adapter, the device and the pipelines all resolved — a real fraction of a
 * second, and for ever on a machine that refuses — nothing drained at all.
 *
 * The three pulls are spied at their factories, so what is asserted is the host calling them and
 * not a copy of the host. `Ground.create` never resolves here: the pre-ready window is the subject.
 */
import { Camera, createCanvasEngine, defineCanvasType, defineWidget, tools, Viewport, widgets, type World } from "@ice/core";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { must } from "./must";
import { installGpuGlobals, stubDevice, stubGpu } from "./stub-gpu";

/** The pull counts, hoisted so `vi.mock`'s factories can see them. */
const pulls = vi.hoisted(() => ({ builder: 0, overlays: 0 }));

vi.mock("../../src/compose/overlays", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/compose/overlays")>();
  return {
    ...mod,
    createOverlays: (...args: Parameters<typeof mod.createOverlays>) => {
      const driver = mod.createOverlays(...args);
      return { ...driver, changed: () => { pulls.overlays += 1; return driver.changed(); } };
    },
  };
});

vi.mock("../../src/compose/frame-inputs", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/compose/frame-inputs")>();
  return {
    ...mod,
    createFrameBuilder: (...args: Parameters<typeof mod.createFrameBuilder>) => {
      const builder = mod.createFrameBuilder(...args);
      return { ...builder, changed: () => { pulls.builder += 1; return builder.changed(); } };
    },
  };
});

const { Ground } = await import("../../src/compose/ground");
const { groundField } = await import("../../src/compose/host");
const { NO_POINTER } = await import("../../src/compose/poles");

const CARD = widgets.get("hp:card") ?? defineWidget({ type: "hp:card", surface: "dom", component: null, defaultSize: { w: 200, h: 120 } });
const ROOT = defineCanvasType({ id: "hp:root", semanticVersion: 1, semantic: { placement: { widgets: [CARD] } }, presentation: { ground: { glyph: "dot" } } });
const TOOLS = [must(tools.get("select"), "the select tool"), must(tools.get("pan"), "the pan tool")];

beforeAll(() => installGpuGlobals());
beforeEach(() => {
  pulls.builder = 0;
  pulls.overlays = 0;
  vi.spyOn(globalThis.console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

describe("groundField · every journal drains while the ground is still pending", () => {
  it("drains the builder's, the overlays' and every pole's once per tick, before the ground resolves", async () => {
    const gpu = stubDevice();
    // the ground never resolves: this test is only ever inside the pre-ready window
    vi.spyOn(Ground, "create").mockReturnValue(new Promise(() => {}));
    const ce = createCanvasEngine({ widgets: [CARD], canvasTypes: [ROOT], rootCanvas: ROOT, presentationFallback: ROOT, tools: TOOLS });
    ce.docs.create();
    ce.world.setResource(Viewport, { w: 1600, h: 900, dpr: 1 });
    ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    const container = document.createElement("div");
    const contentPlane = document.createElement("div");
    container.appendChild(contentPlane);
    document.body.appendChild(container);

    let polePulls = 0;
    const handle = groundField({
      gpu: stubGpu(gpu.device),
      poles: { read: () => [], subscribe: () => () => {}, changed: (_w: World) => { polePulls += 1; return false; } },
    })({ host: { container, contentPlane }, world: ce.world, canvas: ce.canvas });
    ce.engine.registerReflector(handle.reflector);
    await new Promise<void>((r) => setTimeout(r, 0));   // the device is acquired; `Ground.create` hangs

    expect(handle.field.available()).toBe(false);
    expect(handle.field.status().state).toBe("pending");
    let now = 0;
    for (let i = 0; i < 6; i++) { now += 16; ce.step(now); }
    expect(pulls.builder).toBe(6);
    expect(pulls.overlays).toBe(6);
    expect(polePulls).toBe(6);
    expect(handle.field.redraws()).toBe(0);   // …and nothing was drawn: there is nothing to draw with
    expect(handle.field.lastInputs()).toBeNull();
    expect(NO_POINTER.on).toBe(false);
    handle.dispose();
  });
});
