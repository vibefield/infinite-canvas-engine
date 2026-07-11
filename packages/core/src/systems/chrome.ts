/**
 * Chrome derive systems (design-004 §5 chrome plane, §8 LOD; `derive` phase).
 *
 * Two systems, both derive-scheduled, both write change-only:
 *
 * `selectionChrome` — maintains POOLED chrome entities mirroring the current
 *   `Selected` set: ONE selection-box entity + 8 resize-handle entities. The box
 *   entity carries ONLY the `SelectionBox` value (x,y,w,h = the union bbox); the
 *   handles carry Position + Size + `HandleSpec{anchor}` + `VisualOf → box`.
 *
 *   HANDLE PICKING (the point of the design): handles carry a world AABB, so the
 *   `react`-phase `spatialSync` indexes them automatically and `picking` resolves
 *   a corner grab to the handle (HandleSpec has pick priority) → `dragRoute`
 *   routes `RoutedResize` → `resizeBehavior` runs. Nothing here touches the index.
 *
 *   HANDLES ARE SCREEN-CONSTANT: a handle's world size is `HANDLE_PICK_PX / zoom`
 *   so its on-screen hit target stays ~constant across zoom. The tradeoff: the
 *   handles must be recomputed whenever the camera zoom changes, so this system
 *   runs every frame a selection exists and rewrites the 8 handles' Position/Size
 *   change-only (a zoom change restamps 8 entities — small, bounded N; §5's
 *   "screen-space, recomputed on camera dirt, small N").
 *
 *   THE BOX IS DELIBERATELY NOT PICKABLE. It stores its rect in the `SelectionBox`
 *   value, NOT in Position/Size, so `spatialSync` (which indexes [Position,Size])
 *   never sees it. design-003 §3's pick priority lists ONLY HandleSpec chrome as
 *   pickable; indexing the box would make it a widget-class pick (it has Position)
 *   and let a center-of-selection click be grabbed by `moveClaim`. (This diverges
 *   from a literal reading of the M6 brief's "Position+Size+SelectionBox" — the
 *   box's geometry lives on the `SelectionBox` value instead; the chrome reflector
 *   reads it from there.)
 *
 *   POOL LIFECYCLE: entities spawn once via `ctx` (runtime prefab class) when a
 *   selection appears and are reaped via `ctx.destroy` when it empties. On the
 *   spawn frame the handles are still identity-only (placement defers to the
 *   phase boundary), so their initial geometry rides the `ctx.spawn` payload and
 *   the change-only `edit().set` updates begin the next frame.
 *
 * `breakpoint` — `WidgetBreakpoint{tier,w,h}` from a widget's EFFECTIVE size
 *   (`MeasuredSize` where auto-sized and >0, else `Size`), width-thresholded into
 *   5 tiers with ±10% boundary hysteresis. Added lazily (on `WidgetEquipped`
 *   widgets, once measured) and thereafter written ONLY when the tier changes —
 *   the LOD signal must be stable within a tier so the measure→tier→content→
 *   measure loop converges (§2). The stored w,h are the effective size at the
 *   tier transition (what the tier "was computed from").
 */
import type { Entity, System, SystemCtx, TickSystem, World } from "@vibecook/strata-ecs";
import { defineQuery, defineSystem, defineTickSystem } from "@vibecook/strata-ecs";
import {
  Camera,
  HandleSpec,
  MeasuredSize,
  Position,
  SelectionBox,
  Selected,
  Size,
  VisualOf,
  WidgetBreakpoint,
} from "../catalog";
import { selectedEntities } from "../ops/selection";
import { WidgetEquipped } from "../widget/define-widget";

// --- selection chrome ---------------------------------------------------------

/** Handle world size = this / zoom → ~constant on-screen hit target across zoom. */
const HANDLE_PICK_PX = 10;

/** The 8 handle anchors, in a fixed order the pool aligns to. */
const HANDLE_ANCHORS = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
type HandleAnchor = (typeof HANDLE_ANCHORS)[number];

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The center point (world) of a handle for one anchor over the bbox. */
function anchorPoint(anchor: HandleAnchor, b: Rect): { x: number; y: number } {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const l = b.x;
  const r = b.x + b.w;
  const t = b.y;
  const bot = b.y + b.h;
  switch (anchor) {
    case "nw":
      return { x: l, y: t };
    case "n":
      return { x: cx, y: t };
    case "ne":
      return { x: r, y: t };
    case "e":
      return { x: r, y: cy };
    case "se":
      return { x: r, y: bot };
    case "s":
      return { x: cx, y: bot };
    case "sw":
      return { x: l, y: bot };
    default:
      return { x: l, y: cy }; // "w"
  }
}

/** A handle's world AABB (top-left + size), centered on its anchor point. */
function handleRect(anchor: HandleAnchor, b: Rect, worldSize: number): Rect {
  const p = anchorPoint(anchor, b);
  return { x: p.x - worldSize / 2, y: p.y - worldSize / 2, w: worldSize, h: worldSize };
}

const selectedQ = defineQuery([Selected]);

export function createSelectionChromeSystem(world: World): TickSystem {
  // Pool state (a derived cache, not world state): the box + 8 handles, aligned
  // to HANDLE_ANCHORS, plus the last-written geometry for change-only writes.
  let boxEntity: Entity | undefined;
  let handleEntities: Entity[] = [];
  let boxCache: Rect | undefined;
  const handleCache = new Map<Entity, Rect>();

  const reap = (ctx: SystemCtx): void => {
    if (boxEntity !== undefined) {
      ctx.destroy(boxEntity);
      boxEntity = undefined;
      boxCache = undefined;
    }
    for (const h of handleEntities) ctx.destroy(h);
    handleEntities = [];
    handleCache.clear();
  };

  // Tick system (strata 0.5.0): exactly one pass per frame by construction
  // (spawn/destroy are NOT idempotent — cardinality is the scheduler's now).
  const sys = defineTickSystem(
    (ctx) => {
      // Union bbox over the selection's positioned entities.
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      let any = false;
      for (const e of selectedEntities(world)) {
        if (!ctx.has(e, Position)) continue;
        const p = ctx.read(e, Position);
        // Effective size (review finding): the outline must wrap what the user
        // SEES — MeasuredSize where auto-sized and measured, else Size.
        const m = ctx.get(e, MeasuredSize);
        const s = ctx.get(e, Size);
        const w = m !== undefined && m.w > 0 ? m.w : (s?.w ?? 0);
        const h = m !== undefined && m.h > 0 ? m.h : (s?.h ?? 0);
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + w);
        maxY = Math.max(maxY, p.y + h);
        any = true;
      }

      if (!any) {
        if (boxEntity !== undefined) reap(ctx); // selection emptied → drop the pool
        return;
      }

      const bbox: Rect = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
      const zoom = ctx.getResource(Camera)?.zoom ?? 1;
      const worldSize = HANDLE_PICK_PX / zoom;

      if (boxEntity === undefined) {
        // Spawn the pool with its initial geometry on the payload — the entities
        // are identity-only until the phase boundary, so no edit() until next frame.
        boxEntity = ctx.spawn({ components: [[SelectionBox, { ...bbox }]] });
        boxCache = { ...bbox };
        for (const anchor of HANDLE_ANCHORS) {
          const hr = handleRect(anchor, bbox, worldSize);
          const he = ctx.spawn({
            components: [
              [Position, { x: hr.x, y: hr.y }],
              [Size, { w: hr.w, h: hr.h }],
              [HandleSpec, { anchor }],
            ],
          });
          ctx.setRelation(he, VisualOf, boxEntity); // VisualOf is arity "one"
          handleEntities.push(he);
          handleCache.set(he, hr);
        }
        return;
      }

      // Pool exists (placed) — change-only value writes.
      if (
        boxCache === undefined ||
        boxCache.x !== bbox.x ||
        boxCache.y !== bbox.y ||
        boxCache.w !== bbox.w ||
        boxCache.h !== bbox.h
      ) {
        ctx.edit(boxEntity).set(SelectionBox, { ...bbox });
        boxCache = { ...bbox };
      }
      for (let i = 0; i < HANDLE_ANCHORS.length; i++) {
        const he = handleEntities[i];
        const anchor = HANDLE_ANCHORS[i];
        if (he === undefined || anchor === undefined) continue;
        const hr = handleRect(anchor, bbox, worldSize);
        const prev = handleCache.get(he);
        if (prev === undefined || prev.x !== hr.x || prev.y !== hr.y || prev.w !== hr.w || prev.h !== hr.h) {
          ctx.edit(he).set(Position, { x: hr.x, y: hr.y });
          ctx.edit(he).set(Size, { w: hr.w, h: hr.h });
          handleCache.set(he, hr);
        }
      }
    },
    {
      name: "selectionChrome",
      access: { write: [SelectionBox, Position, Size] },
      // Run while there is a selection to mirror OR a pool still to reap.
      runIf: () => world.firstOf(selectedQ) !== undefined || boxEntity !== undefined,
    },
  );

  return sys;
}

// --- breakpoints --------------------------------------------------------------

/** Tier width thresholds (px). Engine defaults pending design-005 facade config. */
const TIER_THRESHOLDS = [80, 160, 320, 560] as const;
const TIER_NAMES = ["micro", "compact", "normal", "expanded", "detailed"] as const;
type Tier = (typeof TIER_NAMES)[number];
/** Boundary hysteresis: cross up at +10%, down at -10%, before the tier flips. */
const TIER_HYSTERESIS = 0.1;

/** Raw tier index (no hysteresis) — the seed for a widget's first computation. */
function rawTierIndex(w: number): number {
  let i = 0;
  while (i < TIER_THRESHOLDS.length) {
    const t = TIER_THRESHOLDS[i];
    if (t === undefined || w < t) break;
    i++;
  }
  return i;
}

/** Tier index from width, holding `cur` unless the ±10% band is crossed. */
function hysteresisTierIndex(w: number, cur: number): number {
  let i = cur;
  while (i < TIER_THRESHOLDS.length) {
    const t = TIER_THRESHOLDS[i]; // upper boundary of tier i
    if (t === undefined || w < t * (1 + TIER_HYSTERESIS)) break;
    i++;
  }
  while (i > 0) {
    const t = TIER_THRESHOLDS[i - 1]; // lower boundary of tier i
    if (t === undefined || w >= t * (1 - TIER_HYSTERESIS)) break;
    i--;
  }
  return i;
}

function clampU16(v: number): number {
  return Math.max(0, Math.min(65535, Math.round(v)));
}

const equippedWidgetQ = defineQuery([Size, WidgetEquipped]);

export function createBreakpointSystem(_world: World): System {
  return defineSystem(
    equippedWidgetQ,
    (b, ctx) => {
      const sw = b.col(Size).w;
      const sh = b.col(Size).h;
      for (const r of b) {
        const e = b.entity(r);
        const m = ctx.get(e, MeasuredSize);
        // Effective size: MeasuredSize where auto-sized and measured, else Size.
        const ew = m !== undefined && m.w > 0 ? m.w : (sw[r] as number);
        const eh = m !== undefined && m.h > 0 ? m.h : (sh[r] as number);
        const cw = clampU16(ew);
        const ch = clampU16(eh);
        // Tier input is the ON-SCREEN width: effective size × zoom (design-004
        // §8 — a zoomed-out large card shows micro content). Stored w,h remain
        // the world-effective size the tier was computed from.
        const zoom = ctx.getResource(Camera)?.zoom ?? 1;
        const screenW = ew * zoom;

        const existing = ctx.get(e, WidgetBreakpoint);
        if (existing === undefined) {
          const idx = rawTierIndex(screenW);
          ctx.addComponent(e, WidgetBreakpoint, { tier: TIER_NAMES[idx] as Tier, w: cw, h: ch });
          continue;
        }
        const curIdx = TIER_NAMES.indexOf(existing.tier as Tier);
        const idx = hysteresisTierIndex(screenW, curIdx < 0 ? rawTierIndex(screenW) : curIdx);
        // Write only on a tier change — the tier must be stable within a band so
        // the measure→tier→content→measure loop converges (w,h ride the change).
        if (idx !== curIdx) {
          ctx.edit(e).set(WidgetBreakpoint, { tier: TIER_NAMES[idx] as Tier, w: cw, h: ch });
        }
      }
    },
    { name: "breakpoint", access: { write: [WidgetBreakpoint] } },
  );
}
