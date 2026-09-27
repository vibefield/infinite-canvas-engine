// The tray pass's shader set (tray/tray.wgsl, tray/tray-pass.wgsl) over the primitives and the mat's own colour law (mat.wgsl) — the
// file map a host's `ShaderText` fills, the set the pass compiles; byte-identical in the browser and in the Node oracle (the marks' convention).

import type { ShaderPart } from "../engine/shader";

export interface TrayShaders {
  readonly modules: readonly ShaderPart[];   // primitives, mat, tray
  readonly entry: ShaderPart;                // tray-pass
}

export interface TrayShaderText {
  readonly primitives: string;
  readonly mat: string;
  readonly tray: string;
  readonly trayPass: string;
}

export const TRAY_SHADER_FILES: Record<keyof TrayShaderText, string> = {
  primitives: "primitives.wgsl",
  mat: "mat/mat.wgsl",
  tray: "tray/tray.wgsl",
  trayPass: "tray/tray-pass.wgsl",
};

export function trayShaders(t: TrayShaderText): TrayShaders {
  const part = (label: string, text: string): ShaderPart => ({ label, text });
  return {
    modules: [part("primitives.wgsl", t.primitives), part("mat/mat.wgsl", t.mat), part("tray/tray.wgsl", t.tray)],
    entry: part("tray/tray-pass.wgsl", t.trayPass),
  };
}
