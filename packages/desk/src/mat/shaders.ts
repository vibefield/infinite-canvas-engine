// Assemble the mat's shader parts from raw text — the browser with `?raw`
// imports, the Node oracle with readFileSync; byte-identical either way.

import type { ShaderPart } from "../engine/shader";

export interface MatShaders {
  readonly modules: readonly ShaderPart[];   // portal.wgsl, mat.wgsl, ruler.wgsl
  readonly wind: ShaderPart;                 // wind.wgsl — the plate → silhouette pass
  readonly entry: ShaderPart;                // mat-pass.wgsl — the fullscreen mat
}

export interface MatShaderText {
  /** shaders/portal.wgsl — the portal clip every pass includes. */
  readonly portal: string;
  readonly mat: string;
  /** shaders/mat/ruler.wgsl — the rulers' print (RULER.md). */
  readonly ruler: string;
  readonly wind: string;
  readonly matPass: string;
}

export const MAT_SHADER_FILES: Record<keyof MatShaderText, string> = {
  portal: "portal.wgsl",
  mat: "mat/mat.wgsl",
  ruler: "mat/ruler.wgsl",
  wind: "mat/wind.wgsl",
  matPass: "mat/mat-pass.wgsl",
};

export function matShaders(t: MatShaderText): MatShaders {
  const part = (label: string, text: string): ShaderPart => ({ label, text });
  return {
    modules: [part("portal.wgsl", t.portal), part("mat/mat.wgsl", t.mat), part("mat/ruler.wgsl", t.ruler)],
    wind: part("mat/wind.wgsl", t.wind),
    entry: part("mat/mat-pass.wgsl", t.matPass),
  };
}
