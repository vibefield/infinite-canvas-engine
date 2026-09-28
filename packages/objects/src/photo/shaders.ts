// Assemble the photo pass's program from the host's shader text — the browser's generated module, a Node host's files
// on disk. The kit brings the slot's view block, the portal chain, the card's primitives and the mat's light
// (kit/wgsl.ts, by name); the print's own records, module and entry follow.

import type { CardMaterial } from "@ice/desk";
import type { ComposeOptions } from "@ice/desk/engine";
import { kitWgsl, type ShaderText } from "@ice/desk/kit";
import { Photo, PhotoUniforms } from "./layout";

/** The print's own shader files (the kit's pieces come by name). */
export const PHOTO_SHADER_FILES = { photo: "photo/photo.wgsl", photoCard: "photo/photo-card.wgsl", photoPass: "photo/photo-pass.wgsl" } as const;

/** The photo pass's program: the kit's view · portal · sdf · light, then the print's records, module and entry. */
export type PhotoShaders = ComposeOptions;

export function photoShaders(text: ShaderText): PhotoShaders {
  const t = text(PHOTO_SHADER_FILES);
  return kitWgsl(["view", "portal", "sdf", "light"], {
    structs: [PhotoUniforms, Photo],
    modules: [{ label: "photo/photo.wgsl", text: t.photo }, { label: "photo/photo-card.wgsl", text: t.photoCard }],
    entry: { label: "photo/photo-pass.wgsl", text: t.photoPass },
  }, text);
}

/**
 * The print's CARD MATERIAL (K7b, design-016 §6 K7): the flat-card pipeline draws a print with photo-card.wgsl's quad and
 * fragment over the photo pass's own records, knobs, samplers and the thumbnail array (`PhotoPass.cardResources`, in this
 * order) — every print whose picture has no detail bound (the card binds no pool: its `photo_texel` is the thumbnail's).
 */
export function photoCard(text: ShaderText): CardMaterial {
  return {
    shaders: () => {
      const t = text(PHOTO_SHADER_FILES);
      return kitWgsl(["view", "portal", "sdf", "light"], {
        structs: [PhotoUniforms, Photo],
        modules: [{ label: "photo/photo.wgsl", text: t.photo }],
        entry: { label: "photo/photo-card.wgsl", text: t.photoCard },
      }, text);
    },
    only: "fn photo_texel(P: Photo, uv: vec2f, lod: f32) -> vec4f { return photo_thumb(P, uv, lod); }   // the card binds no detail pool",
    bindings: [
      { wgsl: "var<uniform> photo_k: PhotoUniforms", entry: { stages: ["fragment"], buffer: "uniform" } },
      { wgsl: "var<storage, read> photos: array<Photo>", entry: { stages: ["vertex", "fragment"], buffer: "read-only-storage" } },
      { wgsl: "var photo_gobo_samp: sampler", entry: { stages: ["fragment"], sampler: "filtering" } },
      { wgsl: "var photo_noise_samp: sampler", entry: { stages: ["fragment"], sampler: "filtering" } },
      { wgsl: "var photo_pic_samp: sampler", entry: { stages: ["fragment"], sampler: "filtering" } },
      { wgsl: "var photo_thumbs: texture_2d_array<f32>", entry: { stages: ["fragment"], texture: "float", dimension: "2d-array" } },
    ],
    quad: "photo_quad",
    frag: "photo_frag",
  };
}
