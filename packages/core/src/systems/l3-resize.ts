/**
 * L3 — resize behavior (design-003 §5 item 6; `ctl:behave`).
 *
 * A drag captured on a `HandleSpec` chrome entity (route `RoutedResize`, riders
 * attached by `resizeClaim` §4.5). Per Active frame it writes ABSOLUTE Position+
 * Size for every live `Drags` target from its `Grab` origin + `Drag.total /
 * zoomAtClaim`, resized about the FIXED opposite edge/corner of the grabbed
 * handle (`n`/`s` height-only, `e`/`w` width-only, corners both). Modifiers ride
 * the watched pointer's `PointerMods`: `alt` = resize about center, `shift` =
 * preserve aspect (corner handles). Min size clamps to the target widget's
 * `defineWidget` `minSize` (via `PrefabId`), or 1×1 for non-widget resizables.
 * `JustEnded` emits ONE
 * `resize` commit (Position+Size per live target); `JustCancelled`/`JustFailed`
 * restore from `Grab`. Every terminal path removes `Grab` and the `Drags` edges
 * (mirrors l3-behave's clearGestureState; resize has no DropTarget).
 */
import type { Entity, System, SystemCtx, World } from "@vibecook/strata-ecs";
import { defineQuery, defineSystem } from "@vibecook/strata-ecs";
import {
  Captures,
  Drag,
  Drags,
  GesturePhases,
  Grab,
  HandleSpec,
  PointerMods,
  Position,
  RoutedResize,
  Size,
  Watches,
} from "../catalog";
import type { CommitSink, CommitWrite } from "../engine/commit-sink";
import { PrefabId } from "../schema/prefab";
import { widgets } from "../widget/define-widget";

const P = GesturePhases;
const resizeDragQ = defineQuery([Drag, RoutedResize]);

interface RectVals {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Resize a `Grab` rect by world deltas about the anchor handle's fixed opposite
 * edge/corner. `alt` pins the center instead; `shift` preserves aspect on corners.
 */
function computeResize(
  g: { x: number; y: number; w: number; h: number },
  anchor: string,
  dx: number,
  dy: number,
  alt: boolean,
  shift: boolean,
  minW: number,
  minH: number,
): RectVals {
  const affectsLeft = anchor === "w" || anchor === "nw" || anchor === "sw";
  const affectsRight = anchor === "e" || anchor === "ne" || anchor === "se";
  const affectsTop = anchor === "n" || anchor === "nw" || anchor === "ne";
  const affectsBottom = anchor === "s" || anchor === "se" || anchor === "sw";
  const lDelta = affectsLeft ? dx : 0;
  const rDelta = affectsRight ? dx : 0;
  const tDelta = affectsTop ? dy : 0;
  const bDelta = affectsBottom ? dy : 0;

  let left: number;
  let right: number;
  let top: number;
  let bottom: number;
  if (alt) {
    // About center: the opposite edge mirrors the grabbed edge's motion.
    left = g.x + lDelta - rDelta;
    right = g.x + g.w + rDelta - lDelta;
    top = g.y + tDelta - bDelta;
    bottom = g.y + g.h + bDelta - tDelta;
  } else {
    left = g.x + lDelta;
    right = g.x + g.w + rDelta;
    top = g.y + tDelta;
    bottom = g.y + g.h + bDelta;
  }

  const isCorner = (affectsLeft || affectsRight) && (affectsTop || affectsBottom);
  if (shift && isCorner && g.w > 0 && g.h > 0) {
    // Uniform-scale to the dominant relative change, re-anchored for the mode.
    const kW = Math.abs((right - left) / g.w);
    const kH = Math.abs((bottom - top) / g.h);
    const k = Math.max(kW, kH);
    const nw = g.w * k;
    const nh = g.h * k;
    if (alt) {
      const cx = g.x + g.w / 2;
      const cy = g.y + g.h / 2;
      left = cx - nw / 2;
      right = cx + nw / 2;
      top = cy - nh / 2;
      bottom = cy + nh / 2;
    } else {
      if (affectsRight) right = left + nw;
      else left = right - nw;
      if (affectsBottom) bottom = top + nh;
      else top = bottom - nh;
    }
  }

  // Min size — adjust the moving edge so the fixed (anchor) edge stays put.
  if (right - left < minW) {
    if (affectsLeft && !affectsRight) left = right - minW;
    else right = left + minW;
  }
  if (bottom - top < minH) {
    if (affectsTop && !affectsBottom) top = bottom - minH;
    else bottom = top + minH;
  }

  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function createResizeBehavior(world: World, sink: CommitSink): System {
  const clearResizeState = (ctx: SystemCtx, rec: Entity): void => {
    for (const w of ctx.getRelations(rec, Drags)) {
      if (ctx.isAlive(w) && ctx.has(w, Grab)) ctx.removeComponent(w, Grab);
    }
    ctx.removeRelation(rec, Drags);
  };

  // A resizable widget's declared floor (defineWidget `minSize`); non-widget
  // resizables (no `PrefabId`) keep the historical 1×1.
  const minSizeOf = (ctx: SystemCtx, w: Entity): { w: number; h: number } => {
    const type = ctx.get(w, PrefabId)?.id;
    const widget = typeof type === "string" ? widgets.get(type) : undefined;
    return widget?.minSize ?? { w: 1, h: 1 };
  };

  return defineSystem(
    resizeDragQ,
    (b, ctx) => {
      for (const r of b) {
        const rec = b.entity(r);
        const handle = ctx.getRelation(rec, Captures);
        const anchor = handle !== undefined ? ctx.get(handle, HandleSpec)?.anchor : undefined;
        const pointer = ctx.getRelations(rec, Watches)[0];
        const mods = pointer !== undefined ? ctx.get(pointer, PointerMods) : undefined;
        const alt = mods?.alt === true;
        const shift = mods?.shift === true;

        if (ctx.hasTag(rec, P.tags.Active)) {
          if (anchor === undefined) continue; // handle died — integrity cancels next frame
          const d = ctx.read(rec, Drag);
          const zoom = d.zoomAtClaim || 1;
          const dx = d.totalX / zoom;
          const dy = d.totalY / zoom;
          for (const w of ctx.getRelations(rec, Drags)) {
            if (!ctx.isAlive(w) || !ctx.has(w, Grab)) continue;
            const g = ctx.read(w, Grab);
            const min = minSizeOf(ctx, w);
            const rz = computeResize(g, anchor, dx, dy, alt, shift, min.w, min.h);
            ctx.edit(w).set(Position, { x: rz.x, y: rz.y });
            ctx.edit(w).set(Size, { w: rz.w, h: rz.h });
          }
          continue;
        }

        if (ctx.hasTag(rec, P.justTags.Ended)) {
          const writes: CommitWrite[] = [];
          if (anchor !== undefined) {
            const d = ctx.read(rec, Drag);
            const zoom = d.zoomAtClaim || 1;
            const dx = d.totalX / zoom;
            const dy = d.totalY / zoom;
            for (const w of ctx.getRelations(rec, Drags)) {
              if (!ctx.isAlive(w) || !ctx.has(w, Grab)) continue;
              const g = ctx.read(w, Grab);
              const min = minSizeOf(ctx, w);
              const rz = computeResize(g, anchor, dx, dy, alt, shift, min.w, min.h);
              writes.push({ entity: w, component: Position, value: { x: rz.x, y: rz.y } });
              writes.push({ entity: w, component: Size, value: { w: rz.w, h: rz.h } });
            }
          }
          if (writes.length > 0) sink.commit({ kind: "resize", gesture: rec, writes });
          clearResizeState(ctx, rec);
          continue;
        }

        if (ctx.hasTag(rec, P.justTags.Cancelled) || ctx.hasTag(rec, P.justTags.Failed)) {
          for (const w of ctx.getRelations(rec, Drags)) {
            if (!ctx.isAlive(w) || !ctx.has(w, Grab)) continue;
            const g = ctx.read(w, Grab);
            ctx.edit(w).set(Position, { x: g.x, y: g.y });
            ctx.edit(w).set(Size, { w: g.w, h: g.h });
          }
          clearResizeState(ctx, rec);
        }
      }
    },
    {
      name: "resizeBehavior",
      // Position co-write attested — see moveBehavior (row-disjoint routes).
      access: { write: [Position, Size], orderIndependent: [Position] },
    },
  );
}
