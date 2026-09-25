// Assemble the paper pass's shader parts from raw text — the browser with
// `?raw` imports, the Node oracle with readFileSync; byte-identical either way.
// The pass composes the card's primitives and the mat's chain (both pure).

import type { ShaderPart } from "../engine/shader";

export interface PaperShaders {
  readonly modules: readonly ShaderPart[];   // portal, primitives, mat, paper
  readonly entry: ShaderPart;                // paper-pass
}

export interface PaperShaderText {
  readonly portal: string;
  readonly primitives: string;
  readonly mat: string;
  readonly paper: string;
  readonly paperPass: string;
}

export const PAPER_SHADER_FILES: Record<keyof PaperShaderText, string> = {
  portal: "portal.wgsl",
  primitives: "primitives.wgsl",
  mat: "mat/mat.wgsl",
  paper: "paper/paper.wgsl",
  paperPass: "paper/paper-pass.wgsl",
};

export function paperShaders(t: PaperShaderText): PaperShaders {
  const part = (label: string, text: string): ShaderPart => ({ label, text });
  return {
    modules: [part("portal.wgsl", t.portal), part("primitives.wgsl", t.primitives), part("mat/mat.wgsl", t.mat), part("paper/paper.wgsl", t.paper)],
    entry: part("paper/paper-pass.wgsl", t.paperPass),
  };
}
