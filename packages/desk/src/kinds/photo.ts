// The PHOTO print (PHOTO.md) as a kind (kind.ts): the photo pass behind the registry's door — a
// thin adapter, the pass and its WGSL as they were. Stratum `things`: a print lies among the
// desk's other things in the desk's own order (a print on a note, a note on a print) — in the
// prototype the prints lay above everything, drawn by the photo lab in a render pass of their
// own after the ground's; here they are one more kind's runs in the ground's one pass, with the
// same blend onto the same bytes. A spawned slot's pass takes the root's law every frame (`tune`), and a
// print inside a mini mat's face is lit by the lamp of the desk the mini mat lies on (the slot's `lit` —
// MINIMAT.md §4), through the pass's second pipeline, as the note's is.
// The PICTURES stay the pass's: a host makes one (`pass.picture`, `pass.pictureFrom`) and a
// print's record names it by that handle (`PhotoInstance.picture`, null = its paper alone).

import type { KindPass, KindProgram, SlotContext } from "../kind";
import type { MatPass } from "../mat/mat-pass";
import { type PhotoInstance, PhotoPass } from "../photo/photo-pass";
import { PHOTO_SHADER_FILES, photoShaders } from "../photo/shaders";
import type { ShaderText } from "../shaders";

/** The print's kind name — its key in the registry and in every slot's `objects`. */
export const PHOTO_KIND = "photo";

export class PhotoKind implements KindPass<PhotoInstance> {
  /** The photo pass itself: a host's door to the pictures (`picture`, `pictureFrom`, `dropPicture`) and the print's law (`law`). */
  readonly pass: PhotoPass;
  constructor(pass: PhotoPass) { this.pass = pass; }

  spawn(mat: MatPass): PhotoKind { return new PhotoKind(this.pass.spawn(mat)); }

  tune(root: KindPass<PhotoInstance>): void { if (root instanceof PhotoKind) this.pass.tune(root.pass); }

  /** The pass's own `prepare`, argument for argument: the slot's camera, grid, clocks, the objects' presence, the light, the lamp. */
  prepare(_encoder: GPUCommandEncoder, s: SlotContext, records: readonly PhotoInstance[]): number {
    return this.pass.prepare(s.view, s.fadeIn, s.cfg, s.frame, records, s.present, s.light, s.lit);
  }

  /** Records [first, end) — indices into the prints `prepare` was handed, each drawn with its picture. */
  drawRange(pass: GPURenderPassEncoder, first: number, end: number): void { this.pass.drawRange(pass, first, end); }

  dispose(): void { this.pass.dispose(); }
}

/** The print's program for a host's shader text: its pass made on the root's mat. */
export function photoProgram(text: ShaderText): KindProgram<PhotoInstance> {
  return {
    name: PHOTO_KIND,
    stratum: "things",
    create: async (device, format, mat) => new PhotoKind(await PhotoPass.create(device, format, photoShaders(text(PHOTO_SHADER_FILES)), mat)),
  };
}
