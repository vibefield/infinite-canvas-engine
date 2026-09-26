// Assemble the marks pass's shader parts from raw text — the browser from the generated module, the
// Node oracle from the .wgsl files on disk; byte-identical either way (the paper pass's convention).

import type { ShaderPart } from "../engine/shader";

export interface MarksShaders {
  readonly modules: readonly ShaderPart[];   // primitives, marks
  readonly entry: ShaderPart;                // marks-pass
}

export interface MarksShaderText {
  readonly primitives: string;
  readonly marks: string;
  readonly marksPass: string;
}

export const MARKS_SHADER_FILES: Record<keyof MarksShaderText, string> = {
  primitives: "primitives.wgsl",
  marks: "marks/marks.wgsl",
  marksPass: "marks/marks-pass.wgsl",
};

export function marksShaders(t: MarksShaderText): MarksShaders {
  const part = (label: string, text: string): ShaderPart => ({ label, text });
  return {
    modules: [part("primitives.wgsl", t.primitives), part("marks/marks.wgsl", t.marks)],
    entry: part("marks/marks-pass.wgsl", t.marksPass),
  };
}
