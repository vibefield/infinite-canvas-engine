// `line` — the LINE grid as the engine's second built-in glyph (design-013 §8,
// D-C1.4). It is a SURFACE program (field/program.ts): it owns one pipeline and
// one fullscreen draw, reads no atlas, and so the field's bake never runs while
// it is the glyph. What it draws is the engine's own lattice — the same three
// rungs, the same fade-in window — as LINES rather than as a glyph per site.
//
// The mechanism is the cutting mat's, kept and named (shaders/field/line-grid.wgsl
// against shaders/packs/mat/mat.wgsl); the mat's MATERIAL is not — no gobo, no
// grain, no double-gamma grade, no Moon. A plain line grid is generic, so it
// belongs to the engine beside the dot; the mat stays a pack (design-014).
//
// Its ink is the theme's (`GroundTheme.lineInk`, theme.ts `LINE_GRID`) and its
// alpha the field config's `inkAlpha` through the presentation's opacity —
// the dot's own alpha term. Its LAW (widths and weights, lattice/line.ts
// `LineLaw`) rides `FieldConfig.ext.line`, the seam every grid program's own
// config rides; absent, it is the engine's flat law.

import { BLEND_OVER, bindGroup, bindLayout, renderPipeline, uniformBuffer } from "../engine/pipeline";
import { compile, compose, type ShaderPart } from "../engine/shader";
import { defineStruct } from "../engine/struct";
import type { LineLaw } from "../lattice/line";
import { LINE_GRID, type GroundTheme } from "../theme";
import { type FieldConfig, type FieldFrame, Uniforms, uniformValues } from "./layout";
import type { SurfaceGlyph, SurfacePass } from "./program";

/** The glyph name, and the key its config rides `FieldConfig.ext` under. */
export const LINE_GLYPH = "line";

/** The line grid's own config — what `FieldConfig.ext.line` carries. */
export interface LineConfig {
  /**
   * Half-widths (CSS px — D-C4.10; `lineUniformValues` scales them by the frame's dpr at upload)
   * and coverage alphas at the fade-in window's top and a decade above it (lattice/line.ts).
   */
  readonly law: LineLaw;
}

/** The engine's law: one CSS px wide and one weight at every rung, every zoom and every dpr (theme.ts `LINE_GRID`). */
export const DEFAULT_LINE_CONFIG: LineConfig = { law: LINE_GRID.law };

export const lineConfigOf = (cfg: FieldConfig): LineConfig =>
  (cfg.ext?.[LINE_GLYPH] as LineConfig | undefined) ?? DEFAULT_LINE_CONFIG;

/** A field config with the line grid's own, in its slot. */
export const withLine = (cfg: FieldConfig, line: LineConfig): FieldConfig => ({ ...cfg, ext: { ...(cfg.ext ?? {}), [LINE_GLYPH]: line } });

/** The line grid's own uniforms; everything else it reads is the engine's `Uniforms` block. */
export const LineUniforms = defineStruct("LineUniforms", [
  ["ink", "vec4f"],   // the theme's line ink (sRGB), unused ×1 — the ALPHA is the engine's `Uniforms.color.w`
  ["law", "vec4f"],   // half-width thin, thick (DEVICE px: the law's CSS px × dpr), alpha thin, thick (lattice/line.ts `LineLaw`)
] as const);

/**
 * The numbers the pass uploads for a frame: the theme's ink, and the config's law with its WIDTHS
 * IN DEVICE PX (D-C4.10). The law is authored in CSS px — the unit a design has an opinion in — and
 * the shader measures in device px (`px = 1 / (zoom · dpr)` world units per device pixel), so the
 * dpr conversion belongs here, once, where the frame is known. The alphas are pure coverage and
 * scale by nothing.
 */
export function lineUniformValues(cfg: FieldConfig, theme: GroundTheme, dpr = 1) {
  const { law } = lineConfigOf(cfg);
  const d = dpr > 0 ? dpr : 1;
  return {
    ink: [theme.lineInk[0], theme.lineInk[1], theme.lineInk[2], 0],
    law: [law.thin * d, law.thick * d, law.alphaThin, law.alphaThick],
  };
}

/** What every slot shares: the layout and the pipeline. The line grid has no assets. */
interface LineShared {
  readonly layout: GPUBindGroupLayout;
  readonly pipeline: GPURenderPipeline;
}

/**
 * One SLOT of the line grid: its own two uniform buffers and its bind group, on
 * the shared pipeline. `spawn()` makes the second one a flight's departed frame
 * or a live portal needs.
 */
export class LinePass implements SurfacePass {
  readonly name = "field/line";
  private readonly device: GPUDevice;
  private readonly shared: LineShared;
  private readonly uniforms = Uniforms.alloc(1);
  private readonly line = LineUniforms.alloc(1);
  private readonly uniformBuf: GPUBuffer;
  private readonly lineBuf: GPUBuffer;
  private readonly group: GPUBindGroup;

  private constructor(device: GPUDevice, shared: LineShared) {
    this.device = device;
    this.shared = shared;
    this.uniformBuf = uniformBuffer(device, Uniforms.size, "field/line/uniforms");
    this.lineBuf = uniformBuffer(device, LineUniforms.size, "field/line/line");
    this.group = bindGroup(device, shared.layout, [this.uniformBuf, this.lineBuf], "field/line");
  }

  static async create(device: GPUDevice, format: GPUTextureFormat, modules: readonly ShaderPart[], entry: ShaderPart): Promise<LinePass> {
    const layout = bindLayout(device, [
      { binding: 0, stages: ["fragment"], buffer: "uniform" },
      { binding: 1, stages: ["fragment"], buffer: "uniform" },
    ], "field/line");
    const module = await compile(device, compose({ structs: [Uniforms, LineUniforms], modules, entry }));
    const pipeline = await renderPipeline(device, {
      label: "field/line",
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      module, format, blend: BLEND_OVER,
    });
    return new LinePass(device, { layout, pipeline });
  }

  /** A second slot on the same pipeline (no compile): its own buffers and bind group. */
  spawn(): LinePass { return new LinePass(this.device, this.shared); }

  /** Upload the frame. The line grid has no auxiliary pass, so this never reports one. */
  prepare(_encoder: GPUCommandEncoder, frame: FieldFrame, cfg: FieldConfig, theme: GroundTheme): boolean {
    // the law's widths are CSS px; the frame's dpr converts them for the shader (D-C4.10)
    this.uniforms.set(uniformValues(frame, cfg, 0));
    this.device.queue.writeBuffer(this.uniformBuf, 0, this.uniforms.view());
    this.line.set(lineUniformValues(cfg, theme, frame.view.dpr));
    this.device.queue.writeBuffer(this.lineBuf, 0, this.line.view());
    return false;
  }

  draw(pass: GPURenderPassEncoder): void {
    pass.setPipeline(this.shared.pipeline);
    pass.setBindGroup(0, this.group);
    pass.draw(3);
  }

  /** This slot's buffers; the pipeline is device-owned. */
  dispose(): void {
    this.uniformBuf.destroy();
    this.lineBuf.destroy();
  }
}

/** The engine's LINE glyph, from the entry's text — `fieldShaders` registers it beside the dot. */
export const lineGlyph = (entry: ShaderPart): SurfaceGlyph => ({
  kind: "surface",
  glyph: LINE_GLYPH,
  create: (device, format, modules) => LinePass.create(device, format, modules, entry),
});
