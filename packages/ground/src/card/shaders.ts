// Assemble the frame pass's shader parts from raw text — same in the browser
// (`?raw`) and in the Node oracle (readFileSync).

import type { ShaderPart } from "../engine/shader";
import type { FrameShaders } from "./frame-pass";

export interface FrameShaderText {
  /** shaders/portal.wgsl — the portal clip every pass includes. */
  readonly portal: string;
  readonly primitives: string;
  readonly frame: string;
  readonly pass: string;
}

export const FRAME_SHADER_FILES: Record<keyof FrameShaderText, string> = {
  portal: "portal.wgsl",
  primitives: "card/primitives.wgsl",
  frame: "card/frame.wgsl",
  pass: "card/frame-pass.wgsl",
};

export function frameShaders(t: FrameShaderText): FrameShaders {
  const part = (label: string, text: string): ShaderPart => ({ label, text });
  return {
    modules: [part("portal.wgsl", t.portal), part("card/primitives.wgsl", t.primitives), part("card/frame.wgsl", t.frame)],
    entry: part("card/frame-pass.wgsl", t.pass),
  };
}
