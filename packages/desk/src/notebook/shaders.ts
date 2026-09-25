// Assemble the notebook pass's shader parts from raw text — the browser with `?raw` imports, a
// Node host with readFileSync; byte-identical either way.

import type { ShaderPart } from "../engine/shader";

export interface NotebookShaders {
  readonly modules: readonly ShaderPart[];   // mat (the light, the gobo, the night, the noise), notebook
  readonly entry: ShaderPart;                // notebook-pass
  readonly composite: ShaderPart;            // notebook-composite
}

export interface NotebookShaderText {
  /** shaders/mat/mat.wgsl — the desk's light: the gobo term, the night's eye, the noise. */
  readonly mat: string;
  readonly notebook: string;
  readonly pass: string;
  readonly composite: string;
}

export const NOTEBOOK_SHADER_FILES: Record<keyof NotebookShaderText, string> = {
  mat: "mat/mat.wgsl",
  notebook: "notebook/notebook.wgsl",
  pass: "notebook/notebook-pass.wgsl",
  composite: "notebook/notebook-composite.wgsl",
};

export function notebookShaders(t: NotebookShaderText): NotebookShaders {
  const part = (label: string, text: string): ShaderPart => ({ label, text });
  return {
    modules: [part("mat/mat.wgsl", t.mat), part("notebook/notebook.wgsl", t.notebook)],
    entry: part("notebook/notebook-pass.wgsl", t.pass),
    composite: part("notebook/notebook-composite.wgsl", t.composite),
  };
}
