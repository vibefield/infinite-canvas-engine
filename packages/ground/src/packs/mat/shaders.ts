// Assemble the mat's shader parts — the pack's own .wgsl files (shaders/packs/
// mat), from the generated text or from disk (the oracle); byte-identical
// either way.

import type { ShaderPart } from "../../engine/shader";
import { WGSL, type WgslFile } from "../../shaders.gen";

export interface MatShaders {
  readonly modules: readonly ShaderPart[];   // portal.wgsl, mat.wgsl
  readonly wind: ShaderPart;                 // wind.wgsl — the plate → silhouette pass
  readonly entry: ShaderPart;                // mat-pass.wgsl — the fullscreen mat
}

export interface MatShaderText {
  /** shaders/portal.wgsl — the portal clip every pass includes. */
  readonly portal: string;
  readonly mat: string;
  readonly wind: string;
  readonly matPass: string;
}

export const MAT_SHADER_FILES: Record<keyof MatShaderText, string> = {
  portal: "portal.wgsl",
  mat: "packs/mat/mat.wgsl",
  wind: "packs/mat/wind.wgsl",
  matPass: "packs/mat/mat-pass.wgsl",
};

export function matShaders(t: MatShaderText): MatShaders {
  const part = (label: string, text: string): ShaderPart => ({ label, text });
  return {
    modules: [part("portal.wgsl", t.portal), part("packs/mat/mat.wgsl", t.mat)],
    wind: part("packs/mat/wind.wgsl", t.wind),
    entry: part("packs/mat/mat-pass.wgsl", t.matPass),
  };
}

/** The mat's set from the generated text — what the pack registers. */
export function matShadersFromGen(): MatShaders {
  const t = Object.fromEntries(Object.entries(MAT_SHADER_FILES).map(([k, f]) => [k, WGSL[f as WgslFile]])) as unknown as MatShaderText;
  return matShaders(t);
}
