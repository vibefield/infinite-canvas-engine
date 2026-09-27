// Assemble the notebook pass's programs from the host's shader text — the browser's generated module, a Node host's files on
// disk; byte-identical either way. The book is drawn by the kit's view block, the mat's light and the 3D kit (kit/wgsl.ts
// `book`: the eye, the shadow, the materials), then the notebook's entry; its layer is laid by the kit's composite.

import type { ComposeOptions } from "@ice/desk/engine";
import { layerComposite, kitWgsl, type ShaderText } from "@ice/desk/kit";

/** The notebook's own shader file (the kit's pieces come by name). */
export const NOTEBOOK_SHADER_FILES = { pass: "notebook/notebook-pass.wgsl" } as const;

export interface NotebookShaders {
  readonly program: ComposeOptions;     // the kit's view · light · book + notebook-pass
  readonly composite: ComposeOptions;   // the kit's layer composite
}

export function notebookShaders(text: ShaderText): NotebookShaders {
  const t = text(NOTEBOOK_SHADER_FILES);
  return {
    program: kitWgsl(["view", "light", "book"], { entry: { label: "notebook/notebook-pass.wgsl", text: t.pass } }, text),
    composite: layerComposite(text),
  };
}
