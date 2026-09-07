// PASS 2 — the glyphs. Per registered INSTANCED glyph (field/program.ts): three
// instanced pipelines (fine/mid/coarse, specialised by the RUNG override) and
// one fullscreen pipeline for the dense fine branch. The engine's dot is one
// glyph; a pack's needle is another. The glyph is a pipeline choice; no glyph
// flag ever reaches a shader.

import { BLEND_OVER, bindGroup, bindLayout, renderPipeline } from "../engine/pipeline";
import { compile, compose, type ShaderPart } from "../engine/shader";
import type { RungCount } from "../lattice/lod";
import { Card, Uniforms } from "./layout";
import type { InstancedGlyph } from "./program";

export interface GlyphSources {
  readonly modules: readonly ShaderPart[];
  readonly glyphs: readonly InstancedGlyph[];
}

export interface GlyphSchedule {
  readonly glyph: string;
  readonly fine: "off" | "instanced" | "fullscreen";
  readonly counts: readonly [RungCount, RungCount, RungCount];
}

interface GlyphPipelines { readonly rung: readonly [GPURenderPipeline, GPURenderPipeline, GPURenderPipeline]; readonly fine: GPURenderPipeline }

export class GlyphPass {
  readonly name = "field/glyphs";
  private group: GPUBindGroup | null = null;
  /** Instances drawn last frame — the churn instrument. */
  instances = 0;
  private readonly device: GPUDevice;
  private readonly layout: GPUBindGroupLayout;
  private readonly pipelines: ReadonlyMap<string, GlyphPipelines>;

  private constructor(device: GPUDevice, layout: GPUBindGroupLayout, pipelines: ReadonlyMap<string, GlyphPipelines>) {
    this.device = device; this.layout = layout; this.pipelines = pipelines;
  }

  static async create(device: GPUDevice, format: GPUTextureFormat, src: GlyphSources): Promise<GlyphPass> {
    const layout = bindLayout(device, [
      { binding: 0, stages: ["vertex", "fragment"], buffer: "uniform" },
      { binding: 1, stages: ["vertex", "fragment"], texture: "unfilterable-float" },
    ], "field/glyphs");
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const structs = [Uniforms, Card];
    const build = async (g: InstancedGlyph): Promise<[string, GlyphPipelines]> => {
      const module = await compile(device, compose({ structs, modules: src.modules, entry: g.entry }));
      const fineModule = await compile(device, compose({ structs, modules: src.modules, entry: g.fine }));
      const rung = (await Promise.all([0, 1, 2].map((RUNG) =>
        renderPipeline(device, { label: `field/${g.glyph}/rung${RUNG}`, layout: pipelineLayout, module, format, blend: BLEND_OVER, constants: { RUNG } })))) as [GPURenderPipeline, GPURenderPipeline, GPURenderPipeline];
      const fine = await renderPipeline(device, { label: `field/${g.glyph}/fine`, layout: pipelineLayout, module: fineModule, format, blend: BLEND_OVER });
      return [g.glyph, { rung, fine }];
    };
    const built = await Promise.all(src.glyphs.map(build));
    return new GlyphPass(device, layout, new Map(built));
  }

  /** The glyph names this pass can draw. */
  has(glyph: string): boolean { return this.pipelines.has(glyph); }

  /** A second bind group on the same pipelines — a nav flight's OUTGOING slot. */
  spawn(): GlyphPass {
    return new GlyphPass(this.device, this.layout, this.pipelines);
  }

  /** Rebind after the atlas is recreated. */
  bind(uniforms: GPUBuffer, atlas: GPUTextureView): void {
    this.group = bindGroup(this.device, this.layout, [uniforms, atlas], "field/glyphs");
  }

  record(pass: GPURenderPassEncoder, s: GlyphSchedule): void {
    if (!this.group) throw new Error("GlyphPass: bind() before record()");
    const p = this.pipelines.get(s.glyph);
    if (p === undefined) throw new Error(`GlyphPass: no glyph "${s.glyph}" is registered`);
    pass.setBindGroup(0, this.group);
    let instances = 0;
    if (s.fine === "fullscreen") {
      pass.setPipeline(p.fine);
      pass.draw(3);
    }
    for (const rung of [0, 1, 2] as const) {
      if (rung === 0 && s.fine !== "instanced") continue;
      const n = s.counts[rung].count;
      if (n <= 0 || n > 6_000_000) continue;
      pass.setPipeline(p.rung[rung]);
      pass.draw(6, n);
      instances += n;
    }
    this.instances = instances;
  }

  dispose(): void { /* pipelines are device-owned */ }
}
