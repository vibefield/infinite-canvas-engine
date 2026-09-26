// What the two LAYERED kinds share — the notebook (kinds/notebook.ts) and the desk calendar (kinds/calendar.ts):
// a kind whose pass renders every one of its objects into a target of its own (depth, 4× MSAA, the
// notebook's shadow maps) and lays that target over the frame in ONE draw (design-015 §4.2: "a kind whose
// object needs depth, MSAA or shadow maps renders into its own target … its run in the main pass is a
// composite draw"). Both are ROOT-desk objects in this program (D-D18): only the root slot's pass draws.
//
// The layer is recorded in `prepare`, into the frame's command encoder — before the frame's render pass
// begins and after the mat's wind (so it reads this frame's dapple) — and `drawRange` lays it, inside the
// slot's scissor, then gives the slot its scissor back (the objects after it draw in the slot's, as the
// ground restored it after a host's `underlays`).

import type { KindPass, SlotContext } from "../kind";
import type { View } from "../lattice/lod";
import type { MatPass } from "../mat/mat-pass";
import { scissorOf } from "../nav/portal";

/** A device-px rect: x, y, width, height. */
export type Rect4 = readonly [number, number, number, number];

/**
 * The attachment a slot's view names, device px: what every host sizes its canvas to — `surface().fit`, the reflector's
 * `attach.resize`, the oracle's target — `max(1, round(css · dpr))`. A layer is made at this size, so its texel is the pixel.
 */
export const attachmentOf = (v: View & { readonly dpr: number }): { readonly w: number; readonly h: number } => ({
  w: Math.max(1, Math.round(v.width * v.dpr)),
  h: Math.max(1, Math.round(v.height * v.dpr)),
});

/** Two device-px rects intersected; a width or height of 0 when they do not meet. */
export function clip(a: Rect4, b: Rect4): Rect4 {
  const x0 = Math.max(a[0], b[0]);
  const y0 = Math.max(a[1], b[1]);
  const x1 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y1 = Math.min(a[1] + a[3], b[1] + b[3]);
  return [x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0)];
}

/** What a layered kind asks of its pass: the layer recorded into an encoder, laid by one draw, its screen box. */
export interface LayerPass {
  layer(encoder: GPUCommandEncoder, size: { readonly w: number; readonly h: number }, dpr: number): boolean;
  composite(pass: GPURenderPassEncoder, scissor?: Rect4 | null): void;
  readonly screenBox: Rect4 | null;
  dispose(): void;
}

/**
 * The part of a layered kind that is the same for both: ROOT ONLY — a spawned slot's pass holds nothing and draws nothing (its
 * `pass` is null; D-D18: a notebook or a pad is never drawn in a mini mat's inside or a flight's departed desk) — the layer recorded
 * after its pass prepared, and laid ONCE over the whole range the ground hands it (a kind registered with `composite: true`: the
 * ground draws it as one run after the rest of its stratum).
 */
export abstract class LayeredKind<R, P extends LayerPass> implements KindPass<R> {
  /** The root slot's pass — the host's door to its own API (the ink, the tiles, the law); null in a spawned slot (root only). */
  readonly pass: P | null;
  /** The slot's scissor this frame, device px — the layer is laid inside it and it is given back after (null: nothing to lay). */
  private within: Rect4 | null = null;
  /** How many records `prepare` was handed: the whole range the layer lays. */
  private handed = 0;
  constructor(pass: P | null) { this.pass = pass; }

  abstract spawn(mat: MatPass): KindPass<R>;

  /** The pass's own prepare for this slot (its records, eye and look); returns the count that will draw. */
  protected abstract prepareOwn(pass: P, s: SlotContext, records: readonly R[]): number;

  prepare(encoder: GPUCommandEncoder, s: SlotContext, records: readonly R[]): number {
    this.within = null;
    this.handed = records.length;
    const p = this.pass;
    if (!p) return 0;
    const n = this.prepareOwn(p, s, records);
    if (n === 0) return 0;
    const size = attachmentOf(s.view);
    if (p.layer(encoder, size, s.view.dpr)) this.within = scissorOf(s.present, s.view.dpr, size);
    return n;
  }

  /** The layer over the frame: once, for the whole range [0, count) — one draw lays every object; a part of it cannot be drawn from one layer. */
  drawRange(pass: GPURenderPassEncoder, first: number, end: number): void {
    const p = this.pass;
    const within = this.within;
    if (!p || !within || first !== 0 || end < this.handed || end === 0) return;
    const box = p.screenBox;
    if (!box) return;
    const r = clip(box, within);
    if (r[2] <= 0 || r[3] <= 0) return;
    p.composite(pass, r);
    pass.setScissorRect(within[0], within[1], within[2], within[3]);
  }

  dispose(): void { this.pass?.dispose(); }
}
