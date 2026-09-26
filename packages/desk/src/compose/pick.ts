// The desk's PICK SOURCE (design-015 §4.5; core's `FramePickSource`, the B3b seam): the router
// asks what is under a world point on an object, and the answer comes from the kind's CPU mirror
// on the SAME geometry the builder resolved and the pass drew this frame — springs included,
// topmost first in paint order (core takes the max by `compareStackOrder`, the same comparator
// the builder sorts with). `content`/`frame` are the object itself, another string a PART, and a
// kind's miss (`null`) is `outside` — the box tier falls through and the next object down is
// asked. An object the builder has NO GEOMETRY for — before the first build, culled, or never
// met — answers `undefined`, never `outside` (B9's first blocker: a source that said `outside`
// there made every card unclickable until the first frame). `pad` is the widest kind reach:
// the spatial index holds rects, and a kind's drawing may reach past its rect. `live` while a
// spring moves — or a kind's own body (a print in the air, D3t-a): the part under a still pointer is the part that is
// there now. `lifted` (D3t-a): what the builder painted lifted by its kind's word, asked first where it is drawn.

import type { Entity, FramePickSource } from "@ice/core";
import type { DeskBuilder } from "./builder";

export function createPickSource(builder: Pick<DeskBuilder, "geometryOf" | "kindOf" | "live" | "reach" | "lifted"> & Partial<Pick<DeskBuilder, "veiled">>, opts: { readonly moving?: () => boolean } = {}): FramePickSource {
  return {
    pad: () => builder.reach(),
    // what a kind draws lifted (D3t-a — a print carried or gliding) is asked first, where it is drawn, not where its facts are
    lifted: () => builder.lifted(),
    hit(e: Entity, wx: number, wy: number): string | undefined {
      if (builder.veiled?.(e) === true) return "outside";   // veiled by a kind's state (D3t-c — a note gone with its month): never picked
      const G = builder.geometryOf(e);
      const kind = builder.kindOf(e);
      if (G === undefined || kind === undefined) return undefined;
      return kind.hit(G, wx, wy) ?? "outside";
    },
    live: () => builder.live() || opts.moving?.() === true,
  };
}
