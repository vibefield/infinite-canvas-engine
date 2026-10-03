// The missing face's program from raw text — the browser from the generated module, the Node oracle from the .wgsl files on disk;
// byte-identical either way (the marks pass's convention): the kit's view block, its portal chain's cover and its rounded box,
// then the face's record and its entry.

import type { ComposeOptions } from "../engine/shader";
import { kitWgsl } from "../kit/wgsl";
import { type ShaderText, shaderText } from "../shaders";
import { MissingFace } from "./layout";

export const MISSING_SHADER_FILES = { entry: "missing/missing-pass.wgsl" } as const;

/** The missing face's program for a host's shader text (default: the desk's generated module). */
export function missingShaders(text: ShaderText = shaderText): ComposeOptions {
  return kitWgsl(["view", "portal", "sdf"], {
    structs: [MissingFace],
    entry: { label: MISSING_SHADER_FILES.entry, text: text(MISSING_SHADER_FILES).entry },
  }, text);
}
