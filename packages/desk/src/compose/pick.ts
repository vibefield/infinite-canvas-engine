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
// spring moves: the part under a still pointer is the part that is there now.

import type { Entity, FramePickSource } from "@ice/core";
import type { DeskBuilder } from "./builder";

export function createPickSource(builder: Pick<DeskBuilder, "geometryOf" | "kindOf" | "live" | "reach">): FramePickSource {
  return {
    pad: () => builder.reach(),
    hit(e: Entity, wx: number, wy: number): string | undefined {
      const G = builder.geometryOf(e);
      const kind = builder.kindOf(e);
      if (G === undefined || kind === undefined) return undefined;
      return kind.hit(G, wx, wy) ?? "outside";
    },
    live: () => builder.live(),
  };
}
