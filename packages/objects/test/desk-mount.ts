// A DESK as a host mounts it, in Node (K7a): the desk layer on a fake device (every render pass it begins logged into `log`, a
// texture's make and destroy counted), over an engine with the six objects, the engine's frame gate handed in — and stepped as the
// SLEEPING loop steps it (a step, then `nextStep`). The objects' DOM halves mount on a page whose elements take anything.

import { createCanvasEngine, Viewport } from "@ice/core";
import { vi } from "vitest";
import { deskLayer, type DeskLayerHandle } from "@ice/desk";
import { DESK_ENGINE, DESK_OBJECTS, deskPalette, deskTheme } from "../src";
import { fakeDevice, installGpuFlags } from "../../desk/test/fake-gpu";
import { fakePage } from "../../desk/test/fake-page";

export interface DeskMount {
  readonly ce: ReturnType<typeof createCanvasEngine>;
  readonly handle: DeskLayerHandle;
  /** Every render pass the device began, by label (`pass <label>`), and each draw inside them. */
  readonly log: string[];
  /** The textures the device made: label, size, whether destroyed since. */
  readonly textures: { readonly label: string; readonly size: GPUExtent3D; destroyed: boolean }[];
  /** One step as the sleeping loop takes it; true when the gate then says sleep. */
  step(): boolean;
  /** Steps until the gate says sleep; how many it took (`cap + 1`: it never did). */
  toSleep(cap?: number): number;
  dispose(): void;
}

export async function mountDesk(view: { readonly w: number; readonly h: number; readonly dpr: number } = { w: 1200, h: 800, dpr: 1 }): Promise<DeskMount> {
  const undo: (() => void)[] = [installGpuFlags()];
  const log: string[] = [];
  const { device } = fakeDevice(log);
  const textures: DeskMount["textures"] = [];
  const make = device.createTexture.bind(device);
  (device as { createTexture: GPUDevice["createTexture"] }).createTexture = (d) => {
    const t = make(d);
    const kept = { label: d.label ?? "", size: d.size, destroyed: false };
    textures.push(kept);
    (t as { destroy: () => void }).destroy = () => { kept.destroyed = true; };
    return t;
  };
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
  const ce = createCanvasEngine(DESK_ENGINE);
  ce.docs.create();
  ce.world.setResource(Viewport, { w: view.w, h: view.h, dpr: view.dpr });
  const handle = deskLayer({ gpu, theme: deskTheme("light"), palette: deskPalette("light"), objects: [...DESK_OBJECTS], docs: ce.docs })({ host: { container: page.container as unknown as HTMLElement }, world: ce.world, frame: ce.engine.frame, catalog: ce.catalog });
  undo.push(ce.engine.registerReflector(handle.reflector));
  for (let i = 0; i < 100 && handle.status().state === "pending"; i++) await new Promise((r) => setTimeout(r, 5));
  const step = (): boolean => {
    ce.engine.step(performance.now());
    const t = performance.now();
    return ce.engine.frame.nextStep(t) > t;
  };
  return {
    ce, handle, log, textures, step,
    toSleep(cap = 400) { for (let n = 1; n <= cap; n++) if (step()) return n; return cap + 1; },
    dispose() { handle.dispose(); ce.dispose(); for (const u of undo.splice(0).reverse()) u(); },
  };
}
