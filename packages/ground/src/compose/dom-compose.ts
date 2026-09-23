// The DOM BOUNDARY (design-013 §10.6, Q8; design-014 B3b): with the ground
// drawing every card's chrome, a DOM card's host is CONTENT only — a
// transparent rect the plate sits under, clipped to the card program's inner
// shape by `clip-path` from the same `resolve()` the ground drew, scaled by
// the lift on its transform, faded by the hold's opacity. Chrome exists once.
//
// This file is the pure part and the writer. `clipPathOf` marches a program's
// inner distance field, when it has one, from the card's centre (a notched,
// rounded card is star-shaped about its centre, so one ray per angle finds one
// boundary point) and returns a CSS `polygon()` in the content element's own
// px — the element is the UNSCALED content rect, so the lift divides out and
// the clip is invariant under it. A program without one (the engine's shell; the
// vf-frame shell since 2026-09-23, whose content is never cut) clips to the
// rounded content rect in one `inset()`, no march. `createDomHostWriter` writes the
// three properties change-only, recomputing the clip only when the program's
// `clipKey` says the shape moved (the reveal's ~300 ms; never while a card is
// merely lifted or panned). THE LIFT IS READ OFF THE GEOMETRY: the host's
// transform is the resolved inner box over the content rect, per axis — so the
// DOM and the ground cannot disagree on where a lifted card's edge is, whatever
// a program makes of the lift.
//
// THE CACHE IS KEYED BY THE ELEMENT (D-C4.8), in a `WeakMap`. What the record
// remembers is what is written ON that element, so the element is what it
// belongs to: an entity-keyed record survives a REMOUNT of the content element
// and suppresses the clip, the transform and the opacity on the new one, which
// since B9 made the cache authoritative for two more properties meant a
// remounted card kept none of its boundary. The element keys it, the collector
// sweeps it — no liveness oracle, no O(every card ever seen) sweep per write,
// and no `forget()` door (it had no callers).

import type { Entity } from "@ice/core";
import type { ShellGeometry } from "../card/geometry";
import type { CardProgram } from "../card/program";

/** The rays a clip polygon is marched on: 0.5° apart, so a 22 px corner arc on a 200 px card gets ~22 points. */
export const CLIP_RAYS = 720;
/** Bisection steps per ray: the boundary to 1/65536 of the ray's length. */
const CLIP_STEPS = 16;

/** The lift per axis: the resolved inner box over the content rect — 1 at rest, the lift scale when a program scales by it. */
export function liftOf(G: ShellGeometry, w: number, h: number): readonly [number, number] {
  return [w > 0 ? (2 * G.ih[0]) / w : 1, h > 0 ? (2 * G.ih[1]) / h : 1];
}

/** The content's corner radius in the element's own px: the resolved radius, the lift divided out. */
export const contentRadiusOf = (G: ShellGeometry, w: number): number => G.radius / Math.max(liftOf(G, w, w)[0], 1e-6);

/**
 * The content element's clip for a resolved geometry: the program's inner
 * shape in the element's px (origin its top-left, unscaled). A program with
 * no inner field clips to the rounded content rect.
 */
export function clipPathOf(program: CardProgram<ShellGeometry>, G: ShellGeometry, w: number, h: number, rays = CLIP_RAYS): string {
  const s = G.scale > 0 ? G.scale : 1;
  const inner = program.inner;
  if (inner === undefined) return `inset(0 round ${contentRadiusOf(G, w).toFixed(2)}px)`;
  const [cx, cy] = G.centre;
  if (inner(G, cx, cy) >= 0) return "inset(50%)";   // a vanished card (the delete morph's end): nothing shows
  const reach = Math.hypot(G.half[0], G.half[1]) + 4;
  const pts: string[] = [];
  for (let k = 0; k < rays; k++) {
    const a = (2 * Math.PI * k) / rays;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let lo = 0;
    let hi = reach;
    for (let i = 0; i < CLIP_STEPS; i++) {
      const m = (lo + hi) / 2;
      if (inner(G, cx + dx * m, cy + dy * m) < 0) lo = m;
      else hi = m;
    }
    const t = (lo + hi) / 2;
    pts.push(`${((dx * t) / s + w / 2).toFixed(2)}px ${((dy * t) / s + h / 2).toFixed(2)}px`);
  }
  return `polygon(${pts.join(", ")})`;
}

/** One card's content rect (unscaled) beside its resolved geometry, and the target it presents on (B4a: `gpu` = its pixels are a texture the ground samples). */
export interface HostEntry { readonly entity: Entity; readonly G: ShellGeometry; readonly w: number; readonly h: number; readonly target: "dom" | "gpu" }

export interface DomHostWriter {
  /** Write the boundary for every card on screen; returns the number of DOM properties written this call. */
  write(entries: Iterable<HostEntry>): number;
  /** Clip polygons computed so far — the churn instrument. */
  readonly clips: number;
  dispose(): void;
}

interface Written { key: string; clip: string; transform: string; opacity: string; origin: boolean }

/** The writer of a DOM card's boundary: `contentOf` is the dom reflector's content-element lookup. */
export function createDomHostWriter(program: CardProgram<ShellGeometry>, contentOf: (entity: Entity) => HTMLElement | undefined): DomHostWriter {
  const last = new WeakMap<HTMLElement, Written>();
  let clips = 0;
  const keyOf = (G: ShellGeometry, w: number, h: number): string => `${w}|${h}|${program.clipKey?.(G) ?? contentRadiusOf(G, w).toFixed(2)}`;
  return {
    get clips() { return clips; },
    write(entries) {
      let writes = 0;
      for (const { entity, G, w, h, target } of entries) {
        const el = contentOf(entity);
        if (el === undefined) continue;
        let rec = last.get(el);
        if (rec === undefined) { rec = { key: "", clip: "", transform: "", opacity: "", origin: false }; last.set(el, rec); }
        if (!rec.origin) { el.style.transformOrigin = "50% 50%"; rec.origin = true; writes++; }
        const key = keyOf(G, w, h);
        if (key !== rec.key) {
          const clip = clipPathOf(program, G, w, h);
          clips++;
          rec.key = key;
          if (clip !== rec.clip) { el.style.clipPath = clip; rec.clip = clip; writes++; }
        }
        // The lift and the hold are the DOM's to apply only on a `dom` target: a `gpu` target's raster is copied from this
        // element and the ground applies both to the sample, so a transform or opacity written here would be applied TWICE —
        // and the per-frame transform write would paint the L1 source canvas past DomRender's self-write guard (B9 review
        // blocker 3). Written as empty, so a promotion clears what the card carried as a dom target, and a demotion restores it.
        const composed = target !== "gpu";
        const [sx, sy] = liftOf(G, w, h);
        const lifted = Math.abs(sx - 1) > 1e-6 || Math.abs(sy - 1) > 1e-6;
        const transform = composed && lifted ? (Math.abs(sx - sy) < 1e-6 ? `scale(${sx.toFixed(5)})` : `scale(${sx.toFixed(5)}, ${sy.toFixed(5)})`) : "";
        if (transform !== rec.transform) { el.style.transform = transform; rec.transform = transform; writes++; }
        const opacity = composed && G.frameAlpha !== 1 ? G.frameAlpha.toFixed(4) : "";
        if (opacity !== rec.opacity) { el.style.opacity = opacity; rec.opacity = opacity; writes++; }
      }
      return writes;
    },
    // Nothing to clear: the records are held weakly by the elements they describe, so a card that
    // left the board takes its record with its element (§7's "entity-keyed store outliving the
    // entity" class, ended at the key).
    dispose() {},
  };
}
