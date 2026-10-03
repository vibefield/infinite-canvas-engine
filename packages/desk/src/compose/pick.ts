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
// THE KIND BOUNDARY (petition I24): through the builder's `hitAt`, an object drawn as the MISSING face is picked by its box (the
// object itself — a tap selects it, a drag moves it), and a kind whose `hit` throws takes a strike and MISSES — the pick goes on to
// the next object down, nothing else is lost.

import type { Entity, FramePickSource } from "@ice/core";
import type { DeskBuilder } from "./builder";

export function createPickSource(builder: Pick<DeskBuilder, "geometryOf" | "kindOf" | "live" | "reach" | "lifted"> & Partial<Pick<DeskBuilder, "veiled" | "heldPoint" | "hand" | "hitAt">>, opts: { readonly moving?: () => boolean } = {}): FramePickSource {
  return {
    pad: () => builder.reach(),
    // what a kind draws lifted (D3t-a — a print carried or gliding) is asked first, where it is drawn, not where its facts are —
    // and the hand's object too (D7 #11): flying home its facts still say its rest while it is drawn along the way
    lifted: () => { const h = builder.hand?.(); return h === undefined ? builder.lifted() : [h.entity, ...builder.lifted()]; },
    hit(e: Entity, wx: number, wy: number): string | undefined {
      if (builder.veiled?.(e) === true) return "outside";   // veiled by a kind's state (D3t-c — a note gone with its month): never picked
      const G = builder.geometryOf(e);
      const kind = builder.kindOf(e);
      if (G === undefined || kind === undefined) return undefined;
      // the hand's object (held, or flying home — D7 #11): its geometry was resolved under the held slot's camera, so the desk point
      // goes through the pose the last build drew; anywhere else it is picked where it is drawn, its rest rect answers nothing
      const hp = builder.heldPoint?.(e, wx, wy);
      const [x, y] = hp ?? [wx, wy];
      if (builder.hitAt !== undefined) { const part = builder.hitAt(e, x, y); return part === undefined ? undefined : (part ?? "outside"); }
      return kind.hit(G, x, y) ?? "outside";
    },
    live: () => builder.live() || opts.moving?.() === true,
  };
}
