// Assemble the photo pass's shader parts from raw text — the browser with
// `?raw` imports, a Node host with readFileSync. The pass composes the portal
// clip, the card's primitives and the mat's chain (all pure) with its own.

import type { ShaderPart } from "../engine/shader";

export interface PhotoShaders {
  readonly modules: readonly ShaderPart[];   // portal, primitives, mat, photo
  readonly entry: ShaderPart;                // photo-pass
}

export interface PhotoShaderText {
  readonly portal: string;
  readonly primitives: string;
  readonly mat: string;
  readonly photo: string;
  readonly photoPass: string;
}

export const PHOTO_SHADER_FILES: Record<keyof PhotoShaderText, string> = {
  portal: "portal.wgsl",
  primitives: "primitives.wgsl",
  mat: "mat/mat.wgsl",
  photo: "photo/photo.wgsl",
  photoPass: "photo/photo-pass.wgsl",
};

export function photoShaders(t: PhotoShaderText): PhotoShaders {
  const part = (label: string, text: string): ShaderPart => ({ label, text });
  return {
    modules: [part("portal.wgsl", t.portal), part("primitives.wgsl", t.primitives), part("mat/mat.wgsl", t.mat), part("photo/photo.wgsl", t.photo)],
    entry: part("photo/photo-pass.wgsl", t.photoPass),
  };
}
