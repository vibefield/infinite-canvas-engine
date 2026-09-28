// Assemble the paper pass's program from the host's shader text — the browser's generated module, the Node oracle's
// files on disk; byte-identical either way. The kit brings the slot's view block, the portal chain, the card's
// primitives and the mat's light (kit/wgsl.ts, by name); the note's own records, module and entry follow.

import type { CardMaterial } from "@ice/desk";
import type { ComposeOptions } from "@ice/desk/engine";
import { kitWgsl, type ShaderText } from "@ice/desk/kit";
import { Paper, PaperUniforms } from "./layout";

/** The note's own shader files (the kit's pieces come by name). */
export const PAPER_SHADER_FILES = { paper: "paper/paper.wgsl", paperCard: "paper/paper-card.wgsl", paperPass: "paper/paper-pass.wgsl" } as const;

/** The paper pass's program: the kit's view · portal · sdf · light, then the note's records, module, its quad and fragment, and its entry. */
export type PaperShaders = ComposeOptions;

export function paperShaders(text: ShaderText): PaperShaders {
  const t = text(PAPER_SHADER_FILES);
  return kitWgsl(["view", "portal", "sdf", "light"], {
    structs: [PaperUniforms, Paper],
    modules: [{ label: "paper/paper.wgsl", text: t.paper }, { label: "paper/paper-card.wgsl", text: t.paperCard }],
    entry: { label: "paper/paper-pass.wgsl", text: t.paperPass },
  }, text);
}

/**
 * The note's CARD MATERIAL (K7b, design-016 §6 K7): the flat-card pipeline draws a note with paper-card.wgsl's quad and fragment
 * over the paper pass's own records, knobs, samplers and ink pages (`PaperPass.cardResources`, in this order) — every note, so
 * interleaved with the prints and the boards it is one run.
 */
export function paperCard(text: ShaderText): CardMaterial {
  return {
    shaders: () => {
      const t = text(PAPER_SHADER_FILES);
      return kitWgsl(["view", "portal", "sdf", "light"], {
        structs: [PaperUniforms, Paper],
        modules: [{ label: "paper/paper.wgsl", text: t.paper }],
        entry: { label: "paper/paper-card.wgsl", text: t.paperCard },
      }, text);
    },
    bindings: [
      { wgsl: "var<uniform> paper_k: PaperUniforms", entry: { stages: ["fragment"], buffer: "uniform" } },
      { wgsl: "var<storage, read> papers: array<Paper>", entry: { stages: ["vertex", "fragment"], buffer: "read-only-storage" } },
      { wgsl: "var paper_gobo_samp: sampler", entry: { stages: ["fragment"], sampler: "filtering" } },
      { wgsl: "var paper_noise_samp: sampler", entry: { stages: ["fragment"], sampler: "filtering" } },
      { wgsl: "var paper_ink: texture_2d_array<f32>", entry: { stages: ["fragment"], texture: "float", dimension: "2d-array" } },
      { wgsl: "var paper_ink_samp: sampler", entry: { stages: ["fragment"], sampler: "filtering" } },
    ],
    quad: "paper_quad",
    frag: "paper_frag",
  };
}
