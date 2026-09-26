// The MINI MAT (MINIMAT.md) as a kind (kind.ts): the mini mat pass behind the registry's door —
// a thin adapter, the pass and its WGSL as they were. Stratum `sheets`: a mini mat lies flat on
// the mat beneath every thing, and it HOLDS a desk — the ground draws a live inside right after
// its mini mat and tells the pass (the `extra`'s `live`) which faces give way to one, and the
// chips come back over the inside while its objects fade in (`drawOver`, MINIMAT.md §5).

import type { KindExtra, KindPass, KindProgram, SlotContext } from "../kind";
import type { MatPass } from "../mat/mat-pass";
import type { MiniMatInstance } from "../minimat/layout";
import { MiniMatPass } from "../minimat/pass";
import { MINIMAT_SHADER_FILES, miniMatShaders } from "../minimat/shaders";
import type { ShaderText } from "../shaders";

/** The mini mat's kind name — its key in the registry and in every slot's `objects`. */
export const MINIMAT_KIND = "minimat";

export class MiniMatKind implements KindPass<MiniMatInstance> {
  /** The mini mat pass itself: a host's door to its law (`law`) and this frame's chips. */
  readonly pass: MiniMatPass;
  constructor(pass: MiniMatPass) { this.pass = pass; }

  spawn(mat: MatPass): MiniMatKind { return new MiniMatKind(this.pass.spawn(mat)); }

  tune(root: KindPass<MiniMatInstance>): void { if (root instanceof MiniMatKind) this.pass.tune(root.pass); }

  /**
   * The pass's own `prepare`, argument for argument; the ground's word on each mini mat's live inside (`extra.live`,
   * by this kind's record index) overrides the instance's own — absent, the instances say.
   */
  prepare(_encoder: GPUCommandEncoder, s: SlotContext, records: readonly MiniMatInstance[], extra?: KindExtra): number {
    return this.pass.prepare(s.view, s.fadeIn, s.cfg, s.frame, records, s.present, s.light, s.select, s.lit, extra?.live);
  }

  drawRange(pass: GPURenderPassEncoder, first: number, end: number): void { this.pass.drawRange(pass, first, end); }

  /** Mini mat `index`'s chips over its live inside, while the inside's objects are not whole. */
  drawOver(pass: GPURenderPassEncoder, index: number): void { this.pass.drawChips(pass, index); }

  dispose(): void { this.pass.dispose(); }
}

/** The mini mat's program for a host's shader text: its pass made on the root's mat. */
export function miniMatProgram(text: ShaderText): KindProgram<MiniMatInstance> {
  return {
    name: MINIMAT_KIND,
    stratum: "sheets",
    create: async (device, format, mat) => new MiniMatKind(await MiniMatPass.create(device, format, miniMatShaders(text(MINIMAT_SHADER_FILES)), mat)),
  };
}
