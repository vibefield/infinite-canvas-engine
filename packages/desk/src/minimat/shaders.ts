// Assemble the mini mat pass's shader parts from raw text — the browser with
// `?raw` imports, the Node oracle with readFileSync; byte-identical either way.
// The pass composes the portal clip, the shared primitives and the mat's chain
// (all pure) with its own.

import type { ShaderPart } from "../engine/shader";

export interface MiniMatShaders {
  readonly modules: readonly ShaderPart[];   // portal, primitives, mat, ruler, minimat
  readonly entry: ShaderPart;                // minimat-pass
}

export interface MiniMatShaderText {
  readonly portal: string;
  readonly primitives: string;
  readonly mat: string;
  /** shaders/mat/ruler.wgsl — the rulers' label arithmetic, which the numerals reuse. */
  readonly ruler: string;
  readonly minimat: string;
  readonly minimatPass: string;
}

export const MINIMAT_SHADER_FILES: Record<keyof MiniMatShaderText, string> = {
  portal: "portal.wgsl",
  primitives: "primitives.wgsl",
  mat: "mat/mat.wgsl",
  ruler: "mat/ruler.wgsl",
  minimat: "minimat/minimat.wgsl",
  minimatPass: "minimat/minimat-pass.wgsl",
};

export function miniMatShaders(t: MiniMatShaderText): MiniMatShaders {
  const part = (label: string, text: string): ShaderPart => ({ label, text });
  return {
    modules: [part("portal.wgsl", t.portal), part("primitives.wgsl", t.primitives), part("mat/mat.wgsl", t.mat), part("mat/ruler.wgsl", t.ruler), part("minimat/minimat.wgsl", t.minimat)],
    entry: part("minimat/minimat-pass.wgsl", t.minimatPass),
  };
}
