// Assemble the field's shader parts from raw text. Both hosts call this — the
// browser with the generated text, the Node oracle with readFileSync — so the
// composed WGSL is byte-identical between them. The engine's set carries ONE
// glyph, the dot (design-014); the needle and the mat are packs an app
// registers (`Ground.create({ grids })`).

import type { ShaderPart } from "../engine/shader";
import type { FieldShaders } from "./field";
import type { InstancedGlyph } from "./program";

export interface FieldShaderText {
  /** shaders/portal.wgsl — the portal clip every pass includes. */
  readonly portal: string;
  readonly magnet: string;
  readonly bake: string;
  readonly glyphDot: string;
  readonly fineDot: string;
}

export const FIELD_SHADER_FILES: Record<keyof FieldShaderText, string> = {
  portal: "portal.wgsl",
  magnet: "field/magnet.wgsl",
  bake: "field/atlas-bake.wgsl",
  glyphDot: "field/glyph-dot.wgsl",
  fineDot: "field/fine-dot.wgsl",
};

const part = (label: string, text: string): ShaderPart => ({ label, text });

/** The engine's glyph: the dot. */
export const dotGlyph = (t: Pick<FieldShaderText, "glyphDot" | "fineDot">): InstancedGlyph => ({
  kind: "instanced", glyph: "dot", entry: part("field/glyph-dot.wgsl", t.glyphDot), fine: part("field/fine-dot.wgsl", t.fineDot),
});

export function fieldShaders(t: FieldShaderText): FieldShaders {
  return {
    modules: [part("portal.wgsl", t.portal), part("field/magnet.wgsl", t.magnet)],
    bake: part("field/atlas-bake.wgsl", t.bake),
    glyphs: [dotGlyph(t)],
  };
}
