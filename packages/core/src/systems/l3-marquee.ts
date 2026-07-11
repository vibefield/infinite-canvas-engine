/**
 * L3 — marquee behavior (design-003 §5 item 7, §5.7; `ctl:behave`). Rider-free.
 *
 * Two entry paths, one system (anchored on the CanvasSurface entity so the body
 * runs EVERY frame — the preview must clear the frame the gesture ends):
 *   - desktop: an Active `RoutedMarquee` Drag — rect from `Drag.start + total`
 *     (screen), both corners converted to world via the kernel seam.
 *   - touch:   a Recognized `LongPress` capturing the canvas, riding its
 *     continuous tail — rect from `start → cur` (§4.2, v2's proven path; no
 *     `Sequence` machinery).
 * Per frame the hit ENTITY SET goes into an out-of-ECS render buffer
 * (`MarqueeBuffer`, recomputed each frame — preview-as-tags would churn the
 * global tag version, design-003 §5.7). Selection commits ONCE at terminal
 * (`JustEnded`): replace with the hits, or union when the watched pointer holds
 * shift; `SelectionVersion` bumps once (the v1 marquee lesson). No `access.write`
 * — reads + the buffer + ctx selection tags only.
 *
 * Camera staleness: both corners convert with the CURRENT camera, so a mid-
 * marquee camera move re-projects the rect (accepted — design-002 §2).
 */
import type { Entity, System, SystemCtx, TickSystem, World } from "@vibecook/strata-ecs";
import { defineQuery, defineSystem, defineTickSystem } from "@vibecook/strata-ecs";
import { type CameraState, type SpatialIndex, screenToWorld } from "@ice/kernel";
import {
  Camera,
  CanvasSurface,
  Captures,
  Drag,
  GesturePhases,
  LongPress,
  PointerMods,
  RoutedMarquee,
  Selectable,
  Selected,
  Watches,
} from "../catalog";
import { SelectionVersion, bumpVersion } from "../helpers/version-stamps";
import { selectedEntities } from "../ops/selection";

const P = GesturePhases;
const IDENTITY_CAM: CameraState = { x: 0, y: 0, zoom: 1 };

const canvasSurfaceQ = defineQuery([CanvasSurface]);
const dragMarqueeQ = defineQuery([Drag, RoutedMarquee]);
const longPressQ = defineQuery([LongPress]);

/** The out-of-ECS marquee preview (design-003 §5.7): rect + hit set, recomputed each frame. */
export interface MarqueeBuffer {
  rect: { x: number; y: number; w: number; h: number } | null;
  hits: Entity[];
}

export function createMarqueeBehavior(
  world: World,
  index: SpatialIndex<Entity>,
): TickSystem & { buffer: MarqueeBuffer } {
  const buffer: MarqueeBuffer = { rect: null, hits: [] };

  const queryHits = (ctx: SystemCtx, rx: number, ry: number, rw: number, rh: number): Entity[] => {
    const out: Entity[] = [];
    for (const entry of index.search({ minX: rx, minY: ry, maxX: rx + rw, maxY: ry + rh })) {
      const e = entry.id;
      if (ctx.isAlive(e) && ctx.hasTag(e, Selectable)) out.push(e);
    }
    return out;
  };

  /** ctx-side selection flip — replace with hits (shift = union), one SelectionVersion bump. */
  const commitSelection = (ctx: SystemCtx, hits: Entity[], shift: boolean): void => {
    const current = selectedEntities(world);
    const next = new Set(hits);
    if (shift) for (const e of current) next.add(e);
    let changed = false;
    for (const e of current) {
      if (!next.has(e)) {
        ctx.removeTag(e, Selected);
        changed = true;
      }
    }
    for (const e of next) {
      if (!ctx.hasTag(e, Selected)) {
        ctx.addTag(e, Selected);
        changed = true;
      }
    }
    if (changed) bumpVersion(world, SelectionVersion);
  };

  // Tick system (strata 0.5.0): exactly once per frame by construction
  // (commitSelection is NOT idempotent within a tick: its tags defer, so a
  // re-run would re-bump SelectionVersion).
  const sys = defineTickSystem(
    (ctx) => {
      const cam = ctx.getResource(Camera) ?? IDENTITY_CAM;
      const canvas = ctx.firstOf(canvasSurfaceQ);
      let active = false;

      const process = (
        rec: Entity,
        sx0: number,
        sy0: number,
        sx1: number,
        sy1: number,
        isActive: boolean,
        justEnded: boolean,
      ): void => {
        const w0 = screenToWorld(sx0, sy0, cam);
        const w1 = screenToWorld(sx1, sy1, cam);
        const rx = Math.min(w0.x, w1.x);
        const ry = Math.min(w0.y, w1.y);
        const rw = Math.abs(w1.x - w0.x);
        const rh = Math.abs(w1.y - w0.y);
        const hits = queryHits(ctx, rx, ry, rw, rh);
        if (justEnded) {
          const pointer = ctx.getRelations(rec, Watches)[0];
          const shift = pointer !== undefined && ctx.get(pointer, PointerMods)?.shift === true;
          commitSelection(ctx, hits, shift);
          return;
        }
        if (isActive) {
          buffer.rect = { x: rx, y: ry, w: rw, h: rh };
          buffer.hits = hits;
          active = true;
        }
      };

      // Desktop: RoutedMarquee drag (start + total, screen space).
      world.query(dragMarqueeQ).each((bb) => {
        for (const r of bb) {
          const rec = bb.entity(r);
          const d = ctx.read(rec, Drag);
          process(
            rec,
            d.startX,
            d.startY,
            d.startX + d.totalX,
            d.startY + d.totalY,
            ctx.hasTag(rec, P.tags.Active),
            ctx.hasTag(rec, P.justTags.Ended),
          );
        }
      });

      // Touch: LongPress on the canvas, riding its continuous tail (start → cur).
      world.query(longPressQ).each((bb) => {
        for (const r of bb) {
          const rec = bb.entity(r);
          if (canvas === undefined || ctx.getRelation(rec, Captures) !== canvas) continue;
          const lp = ctx.read(rec, LongPress);
          process(
            rec,
            lp.startX,
            lp.startY,
            lp.curX,
            lp.curY,
            ctx.hasTag(rec, P.tags.Recognized),
            ctx.hasTag(rec, P.justTags.Ended),
          );
        }
      });

      if (!active) {
        buffer.rect = null;
        buffer.hits = [];
      }
    },
    { name: "marqueeBehavior" },
  );

  return Object.assign(sys, { buffer });
}
