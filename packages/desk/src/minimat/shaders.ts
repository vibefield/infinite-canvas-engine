// Assemble the mini mat pass's program from the host's shader text — the browser's generated module, the Node oracle's
// files on disk; byte-identical either way. The kit brings the slot's view block, the portal chain, the shared
// primitives, the mat's light and the rulers' label arithmetic, which the numerals reuse (kit/wgsl.ts, by name); the
// mini mat's own records, module and entry follow.

import type { ComposeOptions } from "../engine/shader";
import { kitWgsl, type ShaderText } from "../kit/wgsl";
import { ChipRecord, MiniMat, MiniMatUniforms } from "./layout";

/** The mini mat's own shader files (the kit's pieces come by name). */
export const MINIMAT_SHADER_FILES = { minimat: "minimat/minimat.wgsl", minimatPass: "minimat/minimat-pass.wgsl" } as const;

/** The mini mat pass's program: the kit's view · portal · sdf · light · ruler, then the mini mat's records, module and entry. */
export type MiniMatShaders = ComposeOptions;

export function miniMatShaders(text: ShaderText): MiniMatShaders {
  const t = text(MINIMAT_SHADER_FILES);
  return kitWgsl(["view", "portal", "sdf", "light", "ruler"], {
    structs: [MiniMatUniforms, MiniMat, ChipRecord],
    modules: [{ label: "minimat/minimat.wgsl", text: t.minimat }],
    entry: { label: "minimat/minimat-pass.wgsl", text: t.minimatPass },
  }, text);
}
