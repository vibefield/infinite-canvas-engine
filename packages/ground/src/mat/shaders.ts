// Assemble the mat's shader parts from raw text — the browser with `?raw`
// imports, the Node oracle with readFileSync; byte-identical either way.

import type { ShaderPart } from "../engine/shader";

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
  mat: "mat/mat.wgsl",
  wind: "mat/wind.wgsl",
  matPass: "mat/mat-pass.wgsl",
};

export function matShaders(t: MatShaderText): MatShaders {
  const part = (label: string, text: string): ShaderPart => ({ label, text });
  return {
    modules: [part("portal.wgsl", t.portal), part("mat/mat.wgsl", t.mat)],
    wind: part("mat/wind.wgsl", t.wind),
    entry: part("mat/mat-pass.wgsl", t.matPass),
  };
}
