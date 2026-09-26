// The hand's shader set (hold/hold.wgsl): the focus behind the object in hand and the object over it — as
// the mat's and the marks' sets are composed (mat/shaders.ts, marks/shaders.ts): the file map a host's
// `ShaderText` fills, the set the pass compiles.
import type { ShaderPart } from "../engine/shader";

export interface HoldShaders {
  readonly entry: ShaderPart;   // hold/hold.wgsl
}

export interface HoldShaderText {
  readonly hold: string;
}

export const HOLD_SHADER_FILES: Record<keyof HoldShaderText, string> = {
  hold: "hold/hold.wgsl",
};

export function holdShaders(t: HoldShaderText): HoldShaders {
  return { entry: { label: "hold/hold.wgsl", text: t.hold } };
}
