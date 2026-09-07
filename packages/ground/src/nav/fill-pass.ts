// The portal fill — the canvas background through a portal (portal-fill.wgsl).
// A slot clipped to a portal draws this first, so what it shows on the card
// face is ITS canvas (bg, grid, frames), not its grid over the other frame's.
// One pipeline, one uniform block per slot (`spawn()`); the ground prepares
// one for every portal-clipped slot: each live portal's, the arriving frame's
// on enter, the departed inside's on exit. A slot drawn beneath a HOLE (a live
// portal, the arriving frame through the container) fills its face grown by a
// device px, so the hole's edge partitions with the plate (PORTAL.md §10).

import { BLEND_OVER, bindGroup, bindLayout, renderPipeline, uniformBuffer } from "../engine/pipeline";
import { compile, compose, type ShaderPart } from "../engine/shader";
import { defineStruct } from "../engine/struct";
import type { RGB } from "../theme";
import { PORTAL_CHAIN_TYPE, portalValues, type Presentation } from "./portal";

export const FillUniforms = defineStruct("FillUniforms", [
  ["view", "vec4f"],    // cssW, cssH, dpr, presentation opacity
  ["bg", "vec4f"],      // the fill colour (the canvas bg, or the plate → bg cross of a fading portal), grow (device px)
  ["portals", PORTAL_CHAIN_TYPE], // the portal CHAIN (portal.ts): each face's centre xy, half extents xy (CSS px)
  ["clips", PORTAL_CHAIN_TYPE],   // each face's corner radius, on (0/1 — a 0 ends the chain), unused ×2
] as const);

export interface FillShaders {
  readonly modules: readonly ShaderPart[];   // portal.wgsl
  readonly entry: ShaderPart;                // portal-fill.wgsl
}

export interface FillShaderText {
  readonly portal: string;
  readonly portalFill: string;
}

export const FILL_SHADER_FILES: Record<keyof FillShaderText, string> = {
  portal: "portal.wgsl",
  portalFill: "portal-fill.wgsl",
};

export function fillShaders(t: FillShaderText): FillShaders {
  const part = (label: string, text: string): ShaderPart => ({ label, text });
  return { modules: [part("portal.wgsl", t.portal)], entry: part("portal-fill.wgsl", t.portalFill) };
}

export class FillPass {
  readonly name = "nav/fill";
  private readonly uniforms = FillUniforms.alloc(1);
  private readonly uniformBuf: GPUBuffer;
  private readonly group: GPUBindGroup;
  private readonly device: GPUDevice;
  private readonly pipeline: GPURenderPipeline;

  private readonly layout: GPUBindGroupLayout;

  private constructor(device: GPUDevice, pipeline: GPURenderPipeline, layout: GPUBindGroupLayout) {
    this.device = device; this.pipeline = pipeline; this.layout = layout;
    this.uniformBuf = uniformBuffer(device, FillUniforms.size, "nav/fill");
    this.group = bindGroup(device, layout, [this.uniformBuf], "nav/fill");
  }

  static async create(device: GPUDevice, format: GPUTextureFormat, src: FillShaders): Promise<FillPass> {
    const layout = bindLayout(device, [{ binding: 0, stages: ["fragment"], buffer: "uniform" }], "nav/fill");
    const module = await compile(device, compose({ structs: [FillUniforms], modules: src.modules, entry: src.entry }));
    const pipeline = await renderPipeline(device, { label: "nav/fill", layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), module, format, blend: BLEND_OVER });
    return new FillPass(device, pipeline, layout);
  }

  /** A second fill on the same pipeline — its own uniforms: one per slot (a live portal's, a flight's). */
  spawn(): FillPass { return new FillPass(this.device, this.pipeline, this.layout); }

  /** Upload the chain and the colour it fills with; `grow` = device px the slot's own face is grown by (1 beneath a hole). */
  prepare(view: { readonly width: number; readonly height: number; readonly dpr: number }, bg: RGB, present: Presentation, grow = 0): void {
    this.uniforms.set({ view: [view.width, view.height, view.dpr, present.opacity], bg: [bg[0], bg[1], bg[2], grow], ...portalValues(present) });
    this.device.queue.writeBuffer(this.uniformBuf, 0, this.uniforms.view());
  }

  draw(pass: GPURenderPassEncoder): void {
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.group);
    pass.draw(3);
  }

  dispose(): void { this.uniformBuf.destroy(); }
}
