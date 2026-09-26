// The NOTE (STICKY.md) as a kind (kind.ts): the paper pass behind the registry's door — a thin
// adapter, the pass and its WGSL as they were. Stratum `things`: a note lies over every sheet
// and pad, in the desk's own order among the other things. A spawned slot's pass takes the
// root's law every frame (`tune`), as the ground always had it do.

import type { KindPass, KindProgram, SlotContext } from "../kind";
import type { MatPass } from "../mat/mat-pass";
import type { PaperInstance } from "../paper/layout";
import { PaperPass } from "../paper/paper-pass";
import { PAPER_SHADER_FILES, paperShaders } from "../paper/shaders";
import type { ShaderText } from "../shaders";

/** The note's kind name — its key in the registry and in every slot's `objects`. */
export const PAPER_KIND = "paper";

export class PaperKind implements KindPass<PaperInstance> {
  /** The paper pass itself: a host's door to the ink pages (`alloc`, `write`, `reset`) and the note's law (`law`, `chain`, `wipeSoft`). */
  readonly pass: PaperPass;
  constructor(pass: PaperPass) { this.pass = pass; }

  spawn(mat: MatPass): PaperKind { return new PaperKind(this.pass.spawn(mat)); }

  tune(root: KindPass<PaperInstance>): void { if (root instanceof PaperKind) this.pass.tune(root.pass); }

  /** The pass's own `prepare`, argument for argument: the slot's camera, grid, clocks, the objects' presence, the light, the ring's colour, the lamp. */
  prepare(_encoder: GPUCommandEncoder, s: SlotContext, records: readonly PaperInstance[]): number {
    return this.pass.prepare(s.view, s.fadeIn, s.cfg, s.frame, records, s.present, s.light, s.select, s.lit);
  }

  drawRange(pass: GPURenderPassEncoder, first: number, end: number): void { this.pass.drawRange(pass, first, end); }

  dispose(): void { this.pass.dispose(); }
}

/** The note's program for a host's shader text: its pass made on the root's mat. */
export function paperProgram(text: ShaderText): KindProgram<PaperInstance> {
  return {
    name: PAPER_KIND,
    stratum: "things",
    create: async (device, format, mat) => new PaperKind(await PaperPass.create(device, format, paperShaders(text(PAPER_SHADER_FILES)), mat)),
  };
}
