// The NOTEBOOK (NOTEBOOK.md) as a kind (kind.ts): the real 3D book behind the registry's door — a
// thin adapter, the pass and its WGSL as they were. Stratum `things`, registered `composite`: the
// pass renders EVERY book into a layer of its own in `prepare` — each book's shadow map, then the 4×
// layer (the books, then the mat under them), recorded into the frame's encoder after the mat's wind —
// and its one run is the layer laid over the frame, after every other run of the stratum (the
// prototype's "books above everything": its lab drew them in a command buffer of their own after the
// ground's). The composite lays every book at once, so a thing laid ON a notebook still draws under it:
// interleaving books among other things needs a layer per run of books (design-015 §4.2 — D-D4's
// exception, named, D-D3r-b.2). The desk eye (eye.ts) is the slot's view's; the law and the ruling's
// ink are the host's (a lab's panel edits the law; the ink is the product's colour — the theme gate).
// ROOT ONLY (D-D18): a spawned slot's pass draws nothing (kinds/layer.ts).

import type { KindProgram, SlotContext } from "../kind";
import type { MatPass } from "../mat/mat-pass";
import { eyeOf } from "../notebook/eye";
import { NOTEBOOK, type NotebookLaw } from "../notebook/law";
import { type NotebookDraw, NotebookPass } from "../notebook/pass";
import { NOTEBOOK_SHADER_FILES, notebookShaders } from "../notebook/shaders";
import type { ShaderText } from "../shaders";
import { MAT_COLORS, type RGBA } from "../theme";
import { LayeredKind } from "./layer";

/** The notebook's kind name — its key in the registry and in every slot's `objects`. */
export const NOTEBOOK_KIND = "notebook";

/** No ink: what the knobs carry while no book draws (a host sets `ruleInk` before one does). */
const NO_INK: RGBA = [0, 0, 0, 0];

export class NotebookKind extends LayeredKind<NotebookDraw, NotebookPass> {
  /** The notebook's law — its eye, its light and shadow, its lift: the host's (a lab's panel edits it); `NOTEBOOK` until one says. */
  law: NotebookLaw = NOTEBOOK;
  /** The ruling's ink and its presence on the page — the PRODUCT's colour (the theme gate): a host sets it before a book draws. */
  ruleInk: RGBA | null = null;

  /** Root only (D-D18): a spawned slot's pass — a mini mat's inside, a flight's departed desk — holds nothing and draws nothing. */
  spawn(_mat: MatPass): NotebookKind { return new NotebookKind(null); }

  /** The pass's own `prepare`, as the prototype's lab called it: the slot's camera, grid, clocks and light, the desk eye over the slot's view, the law, the colours. */
  protected prepareOwn(pass: NotebookPass, s: SlotContext, records: readonly NotebookDraw[]): number {
    if (records.length > 0 && !this.ruleInk) throw new Error("notebook: the ruling's ink is the host's (the theme gate) — set the kind's `ruleInk` before a book draws");
    const v = s.view;
    const eye = eyeOf({ x: v.camX, y: v.camY, zoom: v.zoom }, { width: v.width, height: v.height }, this.law.eye);
    return pass.prepare(v, s.fadeIn, s.cfg, s.frame, s.light, eye, this.law, { cast: MAT_COLORS.cast, select: s.select, ruleInk: this.ruleInk ?? NO_INK }, records);
  }
}

/** The notebook's program for a host's shader text: its pass made on the root's mat; its objects one composite run, last in `things`. */
export function notebookProgram(text: ShaderText): KindProgram<NotebookDraw> {
  return {
    name: NOTEBOOK_KIND,
    stratum: "things",
    composite: true,
    create: async (device, format, mat) => new NotebookKind(await NotebookPass.create(device, format, notebookShaders(text(NOTEBOOK_SHADER_FILES)), mat)),
  };
}
