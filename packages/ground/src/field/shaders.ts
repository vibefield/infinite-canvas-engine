// Assemble the field's shader parts from raw text. Both hosts call this — the
// browser with `?raw` imports, the Node oracle with readFileSync — so the
// composed WGSL is byte-identical between them.

import type { ShaderPart } from "../engine/shader.ts";
import type { FieldShaders } from "./field.ts";
import { MAT_SHADER_FILES, type MatShaderText, matShaders } from "../mat/shaders.ts";

export interface FieldShaderText extends MatShaderText {
  readonly magnet: string;
  readonly bake: string;
  readonly glyphDot: string;
  readonly glyphNeedle: string;
  readonly fineDot: string;
  readonly fineNeedle: string;
}

export const FIELD_SHADER_FILES: Record<keyof FieldShaderText, string> = {
  magnet: "field/magnet.wgsl",
  bake: "field/atlas-bake.wgsl",
  glyphDot: "field/glyph-dot.wgsl",
  glyphNeedle: "field/glyph-needle.wgsl",
  fineDot: "field/fine-dot.wgsl",
  fineNeedle: "field/fine-needle.wgsl",
  ...MAT_SHADER_FILES,
};

export function fieldShaders(t: FieldShaderText): FieldShaders {
  const part = (label: string, text: string): ShaderPart => ({ label, text });
  return {
    modules: [part("portal.wgsl", t.portal), part("field/magnet.wgsl", t.magnet)],
    bake: part("field/atlas-bake.wgsl", t.bake),
    glyph: { dot: part("field/glyph-dot.wgsl", t.glyphDot), needle: part("field/glyph-needle.wgsl", t.glyphNeedle) },
    fine: { dot: part("field/fine-dot.wgsl", t.fineDot), needle: part("field/fine-needle.wgsl", t.fineNeedle) },
    mat: matShaders(t),
  };
}
