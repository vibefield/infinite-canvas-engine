// PASS 2 — the glyphs. Six instanced pipelines (dot/needle × fine/mid/coarse,
// specialised by the RUNG override) and two fullscreen ones for the dense fine
// branch. The glyph is a pipeline choice; no glyph flag ever reaches a shader.

import { BLEND_OVER, bindGroup, bindLayout, renderPipeline } from "../engine/pipeline.ts";
import { compile, compose, type ShaderPart } from "../engine/shader.ts";
import type { RungCount } from "../lattice/lod.ts";
import { Card, Uniforms } from "./layout.ts";

export type Glyph = "dot" | "needle";
export interface GlyphSources {
  readonly modules: readonly ShaderPart[];
  readonly glyph: Record<Glyph, ShaderPart>;
  readonly fine: Record<Glyph, ShaderPart>;
}

export interface GlyphSchedule {
  readonly glyph: Glyph;
  readonly fine: "off" | "instanced" | "fullscreen";
  readonly counts: readonly [RungCount, RungCount, RungCount];
}

export class GlyphPass {
  readonly name = "field/glyphs";
  private group: GPUBindGroup | null = null;
  /** Instances drawn last frame — the churn instrument. */
  instances = 0;
  private readonly device: GPUDevice;
  private readonly layout: GPUBindGroupLayout;
  private readonly rung: Record<Glyph, readonly [GPURenderPipeline, GPURenderPipeline, GPURenderPipeline]>;
  private readonly fine: Record<Glyph, GPURenderPipeline>;

  private constructor(
    device: GPUDevice, layout: GPUBindGroupLayout,
    rung: Record<Glyph, readonly [GPURenderPipeline, GPURenderPipeline, GPURenderPipeline]>,
    fine: Record<Glyph, GPURenderPipeline>,
  ) {
    this.device = device; this.layout = layout; this.rung = rung; this.fine = fine;
  }

  static async create(device: GPUDevice, format: GPUTextureFormat, src: GlyphSources): Promise<GlyphPass> {
    const layout = bindLayout(device, [
      { binding: 0, stages: ["vertex", "fragment"], buffer: "uniform" },
      { binding: 1, stages: ["vertex", "fragment"], texture: "unfilterable-float" },
    ], "field/glyphs");
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const structs = [Uniforms, Card];
    const build = async (glyph: Glyph) => {
      const module = await compile(device, compose({ structs, modules: src.modules, entry: src.glyph[glyph] }));
      const fineModule = await compile(device, compose({ structs, modules: src.modules, entry: src.fine[glyph] }));
      const rungs = (await Promise.all([0, 1, 2].map((RUNG) =>
        renderPipeline(device, { label: `field/${glyph}/rung${RUNG}`, layout: pipelineLayout, module, format, blend: BLEND_OVER, constants: { RUNG } })))) as [GPURenderPipeline, GPURenderPipeline, GPURenderPipeline];
      const fine = await renderPipeline(device, { label: `field/${glyph}/fine`, layout: pipelineLayout, module: fineModule, format, blend: BLEND_OVER });
      return { rungs, fine };
    };
    const [dot, needle] = await Promise.all([build("dot"), build("needle")]);
    return new GlyphPass(device, layout, { dot: dot.rungs, needle: needle.rungs }, { dot: dot.fine, needle: needle.fine });
  }

  /** A second bind group on the same eight pipelines — a nav flight's OUTGOING slot. */
  spawn(): GlyphPass {
    return new GlyphPass(this.device, this.layout, this.rung, this.fine);
  }

  /** Rebind after the atlas is recreated. */
  bind(uniforms: GPUBuffer, atlas: GPUTextureView): void {
    this.group = bindGroup(this.device, this.layout, [uniforms, atlas], "field/glyphs");
  }

  record(pass: GPURenderPassEncoder, s: GlyphSchedule): void {
    if (!this.group) throw new Error("GlyphPass: bind() before record()");
    pass.setBindGroup(0, this.group);
    let instances = 0;
    if (s.fine === "fullscreen") {
      pass.setPipeline(this.fine[s.glyph]);
      pass.draw(3);
    }
    for (const rung of [0, 1, 2] as const) {
      if (rung === 0 && s.fine !== "instanced") continue;
      const n = s.counts[rung].count;
      if (n <= 0 || n > 6_000_000) continue;
      pass.setPipeline(this.rung[s.glyph][rung]);
      pass.draw(6, n);
      instances += n;
    }
    this.instances = instances;
  }

  dispose(): void { /* pipelines are device-owned */ }
}
