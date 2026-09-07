// PASS 1 — the lattice-aligned field atlas. Owns the atlas target, the bake
// pipeline, and its bind group. Records one fullscreen triangle into the atlas
// when asked; the decision to ask is the field's (dirty flags live there).

import { bindGroup, bindLayout, renderPipeline } from "../engine/pipeline";
import { compile, compose, type ShaderPart } from "../engine/shader";
import { beginPass, Target } from "../engine/target";
import { Card, Uniforms } from "./layout";

export const ATLAS_FORMAT: GPUTextureFormat = "rgba32float";

export class BakePass {
  readonly name = "field/bake";
  readonly atlas: Target;
  private group: GPUBindGroup | null = null;
  private readonly device: GPUDevice;
  private readonly pipeline: GPURenderPipeline;
  private readonly layout: GPUBindGroupLayout;

  private constructor(device: GPUDevice, pipeline: GPURenderPipeline, layout: GPUBindGroupLayout, readable: boolean) {
    this.device = device;
    this.pipeline = pipeline;
    this.layout = layout;
    this.atlas = new Target(device, { format: ATLAS_FORMAT, label: "field atlas", readable });
  }

  static async create(device: GPUDevice, modules: readonly ShaderPart[], entry: ShaderPart, opts: { readable?: boolean } = {}): Promise<BakePass> {
    const layout = bindLayout(device, [
      { binding: 0, stages: ["vertex", "fragment"], buffer: "uniform" },
      { binding: 1, stages: ["fragment"], buffer: "read-only-storage" },
    ], "field/bake");
    const module = await compile(device, compose({ structs: [Uniforms, Card], modules, entry }));
    const pipeline = await renderPipeline(device, {
      label: "field/bake",
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      module, format: ATLAS_FORMAT,
    });
    return new BakePass(device, pipeline, layout, opts.readable ?? false);
  }

  /** A second atlas on the same pipeline — a nav flight's OUTGOING slot. */
  spawn(opts: { readable?: boolean } = {}): BakePass {
    return new BakePass(this.device, this.pipeline, this.layout, opts.readable ?? false);
  }

  bind(uniforms: GPUBuffer, sources: GPUBuffer): void {
    this.group = bindGroup(this.device, this.layout, [uniforms, sources], "field/bake");
  }

  /** True when the atlas was recreated and therefore must be re-baked. */
  resize(w: number, h: number): boolean {
    return this.atlas.resize(w, h);
  }

  record(encoder: GPUCommandEncoder, sourceCount: number): void {
    if (!this.group) throw new Error("BakePass: bind() before record()");
    // b = min signed distance, cleared to "far outside"; a pass with no draw still clears.
    const pass = beginPass(encoder, this.atlas.view, [0, 0, 1e4, 0], "field/bake");
    if (sourceCount > 0) {
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, this.group);
      pass.draw(3);
    }
    pass.end();
  }

  dispose(): void { this.atlas.dispose(); }
}
