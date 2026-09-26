// The desk's shader text from the generated module (shaders.gen.ts): what a
// browser host composes its sets from — `matShaders(shaderText(MAT_SHADER_FILES))`,
// and the same for every pass's `*_SHADER_FILES` map. The Node oracle composes the
// same sets from the .wgsl files on disk (oracle/render.mjs), so the two hosts
// compile byte-identical programs; `gen:check` keeps the module fresh.
// (packages/ground/src/shaders.ts's helper, the B1 convention.)
import { WGSL, type WgslFile } from "./shaders.gen";

/**
 * A host's shader text: a shader-file map (`MAT_SHADER_FILES`, …) → the text of every file it names, by the map's
 * keys — `shaderText` below (the generated module) in a browser, the .wgsl files read from disk in the Node oracle.
 * A kind's program is made for one (kinds/: `paperProgram(text)`, `deskKinds(text)`).
 */
export type ShaderText = <T extends Record<string, string>>(files: T) => { readonly [K in keyof T]: string };

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
