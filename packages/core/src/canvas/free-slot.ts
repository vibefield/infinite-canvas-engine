/**
 * One source for WHERE an object that comes with no pointer lands in a frame (petition I57, 2026-11-24).
 *
 * The placement vocabulary has three words and this is the third's missing case. MAY a type live in a frame is the
 * placement authority's (canvas/placement.ts — semantic, no geometry). HOW a spawn hangs is the spawn's own
 * (widget/spawn.ts — its parent, its sibling order). WHERE is the caller's point: a pointer's for a drag or a drop
 * (and, consumed into a container, the kernel's `insertSlot`) — and for an object a tool, a script or a menu makes,
 * which brings no point, it was the middle of the view, on top of whatever lay there. `resolveFreeSlot` answers that
 * case: it gathers a frame's incumbents and the view from the world and asks the kernel's `freeSlot`.
 *
 * A READ. No write, no tag, no stamp; legal between frames, and under a frozen frame gate (a host that covers the
 * desk and places meanwhile). It reads the world AS IT STANDS and deliberately not the interaction stack's spatial
 * index: the index is the hit path — the Active set as of the last tick — so it lacks every spawn made since the
 * last step (all of them, under a freeze), holds nothing of a frame that is not on screen, and holds handles, wires
 * and ports that are no object on a desk. `ops.arrange`, `ops.frameContent` and the drop's consume walk the world
 * for the same reason. A transaction's spawn reaches the world at the next `world.sync()` (a step's first act): a
 * host that places several objects in one turn syncs between them, or names what it placed in `avoid`.
 *
 * WHAT COUNTS AS OCCUPIED: every direct child of the frame that has a `Position` and a `Size` — every object on that
 * board or in that mat, whatever its kind, its stratum or its tape (a `Locked` object never moves: all the more in
 * the way). A container is one rectangle on its parent's frame; what lies inside it is on its own. An object in the
 * person's hand (a drag, a tray take in flight) counts where it is now. An object GLIDING (`TransformTween` — a Clean
 * Up, a fly-back) counts where it is AND where it lands. Not occupied: LANDSCAPE — an object whose type sweeps what
 * lies inside it (`interaction.sweepContained`, the comment box): things are meant to lie on it (l3-drop.ts says the
 * same of a drop). The type is asked, never the runtime tag, so a spawn not yet equipped is judged the same.
 */
import type { Entity, World } from "@vibecook/strata-ecs";
import { freeSlot, type FreeSlot, type LayoutPoint, type LayoutRect, type LayoutSize } from "@ice/kernel";
import { Camera, Position, Size, SweepsContained, TransformTween, Viewport } from "../catalog";
import { frameParent } from "../ops/sibling-order";
import { PrefabId } from "../schema/prefab";
import { FREE_SLOT_DEFAULTS } from "../settings/defaults";
import { widgetTypeFor } from "./engine-catalog";
import { resolveFrameChildren } from "./frame-view";

export interface FreeSlotQuery {
  /**
   * The frame to place in: the board root, or a container (its inside). Default: the frame on screen
   * (`frameParent` — the container the person is inside, else the board).
   */
  readonly frame?: Entity;
  /**
   * Where the newcomer's CENTRE wants to be, in the frame's units. Default: the middle of the view; with no view,
   * the middle of what the frame holds; in an empty frame, its origin.
   */
  readonly anchor?: LayoutPoint;
  /** Min separation from every incumbent, the frame's units, ≥ 0. Default `FREE_SLOT_DEFAULTS.gutter`. Never scaled by the zoom. */
  readonly gutter?: number;
  /**
   * The view, in the frame's units: a slot wholly inside it is preferred to any that is not. Default: what the camera
   * shows (`Camera` × `Viewport`, at its zoom) when `frame` is the frame on screen, else none. A host whose chrome
   * covers part of the view passes the part it leaves clear; `null` — no view, the nearest slot within the reach.
   */
  readonly view?: LayoutRect | null;
  /**
   * How far the slot may lie from the anchored position, on either axis; nothing free within it → `undefined`.
   * Default: the larger side of the view (with no view: of the box of what the frame holds), plus the newcomer's
   * larger side and the gutter — one screen away at most; with no view, just past everything the frame holds.
   */
  readonly reach?: number;
  /** Rectangles to keep clear of beside the frame's objects, in the frame's units (what the world does not hold yet; a band a host's chrome covers). */
  readonly avoid?: readonly LayoutRect[];
}

/** A free slot, and the frame it was resolved in — `ops.spawnWidget(type, { x, y, parent: frame, … })`. */
export interface ResolvedFreeSlot extends FreeSlot {
  readonly frame: Entity;
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/**
 * The free slot for a `size` newcomer in a frame, or `undefined` when the reach holds none — never an overlap by
 * silence: the caller decides (refuse, or overlap by its own rule and say so). The order, the gutter's law and the
 * cost are the kernel's (`freeSlot`); what counts as occupied is this module's header. Deterministic: the same world
 * answers the same place. Throws — as an op does — on a size that is not two positive finite numbers, a gutter or a
 * reach that is not a usable number, and when there is no live frame to place in (no document, a dead `frame`).
 */
export function resolveFreeSlot(world: World, size: LayoutSize, query: FreeSlotQuery = {}): ResolvedFreeSlot | undefined {
  if (!finite(size?.w) || !finite(size.h) || size.w <= 0 || size.h <= 0) {
    throw new Error(`ice: resolveFreeSlot — the size is ${JSON.stringify(size) ?? String(size)}: { w, h }, two positive finite numbers.`);
  }
  const gutter = query.gutter ?? FREE_SLOT_DEFAULTS.gutter;
  if (!finite(gutter) || gutter < 0) {
    throw new Error(`ice: resolveFreeSlot — the gutter is ${String(gutter)}: a finite number, 0 or more.`);
  }
  if (query.reach !== undefined && (!finite(query.reach) || query.reach < 0)) {
    throw new Error(`ice: resolveFreeSlot — the reach is ${String(query.reach)}: a finite number, 0 or more.`);
  }
  const onScreen = frameParent(world);
  const frame = query.frame ?? onScreen;
  if (frame === undefined || !world.isAlive(frame)) {
    throw new Error("ice: resolveFreeSlot — no live frame to place in (a document's board root, or a container).");
  }

  // the view: the caller's, or what the camera shows of the frame on screen
  let view: LayoutRect | undefined;
  if (query.view !== undefined) {
    view = query.view ?? undefined;
  } else if (frame === onScreen) {
    const cam = world.getResource(Camera);
    const vp = world.getResource(Viewport);
    if (cam !== undefined && vp !== undefined && vp.w > 0 && vp.h > 0 && cam.zoom > 0) {
      view = { x: cam.x, y: cam.y, w: vp.w / cam.zoom, h: vp.h / cam.zoom };
    }
  }

  // the incumbents, and the box of what the frame holds
  const incumbents: LayoutRect[] = [];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const occupy = (x: number, y: number, w: number, h: number): void => {
    incumbents.push({ x, y, w, h });
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  };
  for (const child of resolveFrameChildren(world, frame)) {
    const at = world.get(child, Position);
    const span = world.get(child, Size);
    if (at === undefined || span === undefined) continue;
    const type = world.get(child, PrefabId)?.id;
    if (typeof type === "string" && widgetTypeFor(world, type)?.capabilityTags.includes(SweepsContained) === true) continue; // landscape
    occupy(at.x, at.y, span.w, span.h);
    const glide = world.get(child, TransformTween);
    if (glide !== undefined && (glide.toX !== at.x || glide.toY !== at.y)) occupy(glide.toX, glide.toY, span.w, span.h);
  }
  const held = Number.isFinite(minX) ? { w: maxX - minX, h: maxY - minY } : { w: 0, h: 0 };
  const anchor =
    query.anchor ??
    (view !== undefined
      ? { x: view.x + view.w / 2, y: view.y + view.h / 2 }
      : Number.isFinite(minX)
        ? { x: minX + held.w / 2, y: minY + held.h / 2 }
        : { x: 0, y: 0 });
  if (!finite(anchor?.x) || !finite(anchor.y)) {
    throw new Error(`ice: resolveFreeSlot — the anchor is ${JSON.stringify(anchor) ?? String(anchor)}: { x, y }, a point of the frame, two finite numbers.`);
  }
  if (query.avoid !== undefined) incumbents.push(...query.avoid);

  const reach =
    query.reach ??
    (view !== undefined ? Math.max(view.w, view.h) : Math.max(held.w, held.h)) + Math.max(size.w, size.h) + gutter;
  const slot = freeSlot(incumbents, size, view === undefined ? { anchor, gutter, reach } : { anchor, gutter, reach, view });
  return slot === undefined ? undefined : { ...slot, frame };
}
