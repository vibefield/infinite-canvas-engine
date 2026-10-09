// A DESK LAYER as a host mounts it, in Node, over object types of a test's own (M24 LT1 — the objects package's `desk-mount.ts`,
// whose desk is the six reference kinds, made generic: the desk's own units may not name them): the layer on a fake device whose
// passes log what they are told, over an engine with `objects` and a document open, the engine's frame gate handed in — and
// stepped as the SLEEPING loop steps it (a step, then `nextStep`).

import { createCanvasEngine, Viewport, type WidgetType } from "@ice/core";
import { vi } from "vitest";
import { deskLayer, type DeskLayerHandle } from "../src/host/layer";
import { type Palette, themeFrom } from "../src/theme";
import { fakeDevice, installGpuFlags } from "./fake-gpu";
import { fakePage } from "./fake-page";

const PALETTE: Palette = { canvasBg: { token: "--bg", css: "#101010" }, select: { token: "--sel", css: "#3080ff" } };

export interface LayerMount {
  readonly ce: ReturnType<typeof createCanvasEngine>;
  readonly handle: DeskLayerHandle;
  /** Every render pass the device began (`pass <label>`) and what it was told. */
  readonly log: string[];
  /** One step as the sleeping loop takes it; true when the gate then says sleep. */
  step(): boolean;
  /** Steps until the gate says sleep; how many it took (`cap + 1`: it never did). */
  toSleep(cap?: number): number;
  dispose(): void;
}

export async function mountLayer(objects: readonly WidgetType[], view: { readonly w: number; readonly h: number; readonly dpr: number } = { w: 1200, h: 800, dpr: 1 }): Promise<LayerMount> {
  const undo: (() => void)[] = [installGpuFlags()];
  const log: string[] = [];
  const { device } = fakeDevice(log);
  Object.assign(device, { addEventListener: () => {}, lost: new Promise(() => {}), destroy: () => {} });
  const adapter = { features: new Set<string>(), requestDevice: async () => device };
  const gpu = { requestAdapter: async () => adapter, getPreferredCanvasFormat: () => "bgra8unorm" } as unknown as GPU;
  const context = { configure: () => {}, unconfigure: () => {}, getCurrentTexture: () => ({ createView: () => ({ label: "swap" }), width: 1, height: 1 }) };
  const canvas = { style: {}, width: 1, height: 1, clientWidth: 1, clientHeight: 1, getContext: () => context, remove: () => {} };
  const page = fakePage();
  const doc = page.container.ownerDocument as unknown as { createElement(tag: string): unknown };
  const element = doc.createElement.bind(doc);
  doc.createElement = (tag: string) => (tag === "canvas" ? canvas : element(tag));
  vi.stubGlobal("navigator", { gpu });
  undo.push(() => vi.unstubAllGlobals());
  const ce = createCanvasEngine({ widgets: [...objects] });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: view.w, h: view.h, dpr: view.dpr });
  // the wind STILL (a camera move is a touch, and under the default `idle` ambient a touch blows the wind for its window — every step
  // a frame — as the rigs hold it still): only the kinds' own motion and their wakes draw
  const handle = deskLayer({ gpu, theme: themeFrom("light", PALETTE), palette: PALETTE, objects: [...objects], docs: ce.docs, ambient: "still" })({
    host: { container: page.container as unknown as HTMLElement }, world: ce.world, frame: ce.engine.frame, catalog: ce.catalog,
    framePick: ce.stack.framePick, navGeometry: ce.stack.navGeometry, heldPose: ce.stack.heldPose, trayPose: ce.stack.trayPose, spatial: ce.stack.index,
  });
  undo.push(ce.engine.registerReflector(handle.reflector));
  for (let i = 0; i < 100 && handle.status().state === "pending"; i++) await new Promise((r) => setTimeout(r, 5));
  const step = (): boolean => {
    ce.engine.step(performance.now());
    const t = performance.now();
    return ce.engine.frame.nextStep(t) > t;
  };
  return {
    ce, handle, log, step,
    toSleep(cap = 400) { for (let n = 1; n <= cap; n++) if (step()) return n; return cap + 1; },
    dispose() { handle.dispose(); ce.dispose(); for (const u of undo.splice(0).reverse()) u(); },
  };
}
