// Assemble the card pass's shader parts from raw text — same in the browser
// (the generated text) and in the Node oracle (readFileSync). The set is the
// ENGINE's half (design-014): the portal chain, the SDF primitives, card.wgsl
// (the coverage filter, the content term, the seam composite) and the pass
// entry. A card program's own part (the shell's, a pack's) is composed in by
// `FramePass.create`.

import type { ShaderPart } from "../engine/shader";
import type { FrameShaders } from "./frame-pass";

export interface FrameShaderText {
  /** shaders/portal.wgsl — the portal clip every pass includes. */
  readonly portal: string;
  readonly primitives: string;
  readonly card: string;
  readonly pass: string;
}

export const FRAME_SHADER_FILES: Record<keyof FrameShaderText, string> = {
  portal: "portal.wgsl",
  primitives: "card/primitives.wgsl",
  card: "card/card.wgsl",
  pass: "card/card-pass.wgsl",
};

export function frameShaders(t: FrameShaderText): FrameShaders {
  const part = (label: string, text: string): ShaderPart => ({ label, text });
  return {
    modules: [part("portal.wgsl", t.portal), part("card/primitives.wgsl", t.primitives), part("card/card.wgsl", t.card)],
    entry: part("card/card-pass.wgsl", t.pass),
  };
}
