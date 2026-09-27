// Assemble the photo pass's program from the host's shader text — the browser's generated module, a Node host's files
// on disk. The kit brings the slot's view block, the portal chain, the card's primitives and the mat's light
// (kit/wgsl.ts, by name); the print's own records, module and entry follow.

import type { ComposeOptions } from "../engine/shader";
import { kitWgsl, type ShaderText } from "../kit/wgsl";
import { Photo, PhotoUniforms } from "./layout";

/** The print's own shader files (the kit's pieces come by name). */
export const PHOTO_SHADER_FILES = { photo: "photo/photo.wgsl", photoPass: "photo/photo-pass.wgsl" } as const;

/** The photo pass's program: the kit's view · portal · sdf · light, then the print's records, module and entry. */
export type PhotoShaders = ComposeOptions;

export function photoShaders(text: ShaderText): PhotoShaders {
  const t = text(PHOTO_SHADER_FILES);
  return kitWgsl(["view", "portal", "sdf", "light"], {
    structs: [PhotoUniforms, Photo],
    modules: [{ label: "photo/photo.wgsl", text: t.photo }],
    entry: { label: "photo/photo-pass.wgsl", text: t.photoPass },
  }, text);
}
