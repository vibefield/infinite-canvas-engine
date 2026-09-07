// The ground's shader sets from the generated text (shaders.gen.ts): what a
// host hands `Ground.create` — `Ground.create({ device, canvas, ...GROUND_SHADERS })`.
// The oracle composes the same sets from the .wgsl files on disk, so the two
// hosts render byte-identical programs.
import { FRAME_SHADER_FILES, frameShaders } from "./card/shaders";
import { FIELD_SHADER_FILES, fieldShaders } from "./field/shaders";
import { FILL_SHADER_FILES, fillShaders } from "./nav/fill-pass";
import { WGSL, type WgslFile } from "./shaders.gen";

/** The text of every file a shader-file map names, by the map's keys. */
export function shaderText<T extends Record<string, string>>(files: T): { readonly [K in keyof T]: string } {
  const out: Record<string, string> = {};
  for (const [key, file] of Object.entries(files)) {
    const text = WGSL[file as WgslFile];
    if (text === undefined) throw new Error(`shaders: no generated text for "${file}" — run gen:shaders`);
    out[key] = text;
  }
  return out as { readonly [K in keyof T]: string };
}

/** The three shader sets, composed once. */
export const GROUND_SHADERS = {
  field: fieldShaders(shaderText(FIELD_SHADER_FILES)),
  frames: frameShaders(shaderText(FRAME_SHADER_FILES)),
  fill: fillShaders(shaderText(FILL_SHADER_FILES)),
} as const;
