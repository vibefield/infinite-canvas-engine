// Assemble the paper pass's program from the host's shader text — the browser's generated module, the Node oracle's
// files on disk; byte-identical either way. The kit brings the slot's view block, the portal chain, the card's
// primitives and the mat's light (kit/wgsl.ts, by name); the note's own records, module and entry follow.

import type { ComposeOptions } from "../engine/shader";
import { kitWgsl, type ShaderText } from "../kit/wgsl";
import { Paper, PaperUniforms } from "./layout";

/** The note's own shader files (the kit's pieces come by name). */
export const PAPER_SHADER_FILES = { paper: "paper/paper.wgsl", paperPass: "paper/paper-pass.wgsl" } as const;

/** The paper pass's program: the kit's view · portal · sdf · light, then the note's records, module and entry. */
export type PaperShaders = ComposeOptions;

export function paperShaders(text: ShaderText): PaperShaders {
  const t = text(PAPER_SHADER_FILES);
  return kitWgsl(["view", "portal", "sdf", "light"], {
    structs: [PaperUniforms, Paper],
    modules: [{ label: "paper/paper.wgsl", text: t.paper }],
    entry: { label: "paper/paper-pass.wgsl", text: t.paperPass },
  }, text);
}
