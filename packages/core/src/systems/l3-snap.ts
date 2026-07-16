/**
 * L3 — snap (design-003 §5 item 2, §6; `ctl:behave`, ordered BEFORE moveBehavior).
 *
 * For Active `RoutedMove` drags whose dragged set is a `SnapSource`: compute the
 * intended PRE-SNAP rect as `Grab.origin + Drag.total / zoomAtClaim`, unioned
 * over the dragged widgets — NEVER last-applied `Position` (one frame stale ⇒
 * guide-chasing oscillation, design-003 §5.2 red-team; `Grab` is readable here
 * thanks to the ctl:claim settle point, §4.5). Candidates come from the SHARED
 * spatial index (rect query = intended bounds ∪ VIEWPORT, expanded by
 * threshold — design-003 §5.2: a distant same-axis edge IN VIEW must
 * contribute a guide, the Figma behavior; the widgetlab field check 2026-07-16
 * caught the intended-rect-only query never seeing a card 115px above the
 * drag). Filtered to `SnapTarget ∧ ¬Culled ∧ ∉dragged` — ¬Culled is the
 * design's "Visible" scoping in cull-less rigs too (no cull system ⇒ nothing
 * is Culled ⇒ all candidates pass). Threshold is
 * `thresholdPx / zoomAtClaim` (screen-constant). The kernel `computeSnapGuides`
 * does the Figma math; we write `SnapState{dx,dy}` on the recognizer (moveBehavior
 * adds it to the absolute write). SnapState clears to 0,0 when snap is off / no
 * source / no candidate.
 *
 * GUIDE CHROME (design-003 §6, as-built 2026-07-16 — the once-deferred half):
 * the kernel result's `guides`/`spacings` become pooled runtime `GuideLine` /
 * `SpacingBar` entities the P0 snap-guides reflector draws (design-004 §1
 * amendment: ground stratum, under content — James's call). Pool mechanics
 * mirror selectionChrome: a TICK system (exactly one pass per frame — spawn/
 * destroy are not idempotent, and the pool must reap on the frame the last
 * snapping drag ENDS, when the recognizer query is empty), `ctx.spawn` on
 * grow, `ctx.destroy` on shrink, change-only `edit().set` in steady state
 * (same guide held across frames ⇒ zero writes). Alignment guides write
 * `from = to = 0` — the full-viewport sentinel (v1's full-canvas lines);
 * spacing indicators flatten one entity per segment (v1 `u_spacings` parity).
 * No silent caps: the pool grows to whatever the kernel returns (v1's
 * MAX_GUIDES=16 truncation is banned).
 */
import type { Entity, SystemCtx, TickSystem, World } from "@vibecook/strata-ecs";
import { defineQuery, defineTickSystem } from "@vibecook/strata-ecs";
import { type EntityBounds, type SpatialIndex, computeSnapGuides } from "@ice/kernel";
import {
  Camera,
  Captures,
  Culled,
  Drag,
  Drags,
  GestureActive,
  Grab,
  GuideLine,
  RoutedMove,
  SnapConfig,
  SnapSource,
  SnapState,
  SnapTarget,
  SpacingBar,
  Viewport,
} from "../catalog";
import { SNAP_DEFAULTS } from "../settings/defaults";

const snapDragQ = defineQuery([Drag, GestureActive, RoutedMove]);

interface GuideWant {
  axis: "x" | "y";
  at: number;
}

interface BarWant {
  axis: "x" | "y";
  from: number;
  to: number;
  perp: number;
  gap: number;
}

export function createSnapSystem(world: World, index: SpatialIndex<Entity>): TickSystem {
  // Guide-chrome pools (derived caches, not world state — selectionChrome
  // pattern): live entities aligned to this frame's wanted visuals, plus the
  // last-written values for change-only writes.
  const guidePool: Entity[] = [];
  const guideCache = new Map<Entity, GuideWant>();
  const barPool: Entity[] = [];
  const barCache = new Map<Entity, BarWant>();

  const syncGuides = (ctx: SystemCtx, want: readonly GuideWant[]): void => {
    for (let i = 0; i < want.length; i++) {
      const w = want[i] as GuideWant;
      const existing = guidePool[i];
      if (existing === undefined) {
        const e = ctx.spawn({
          components: [[GuideLine, { axis: w.axis, at: w.at, from: 0, to: 0 }]],
        });
        guidePool.push(e);
        guideCache.set(e, w);
        continue;
      }
      const c = guideCache.get(existing);
      if (c === undefined || c.axis !== w.axis || c.at !== w.at) {
        ctx.edit(existing).set(GuideLine, { axis: w.axis, at: w.at, from: 0, to: 0 });
        guideCache.set(existing, w);
      }
    }
    while (guidePool.length > want.length) {
      const e = guidePool.pop() as Entity;
      ctx.destroy(e);
      guideCache.delete(e);
    }
  };

  const syncBars = (ctx: SystemCtx, want: readonly BarWant[]): void => {
    for (let i = 0; i < want.length; i++) {
      const w = want[i] as BarWant;
      const existing = barPool[i];
      if (existing === undefined) {
        const e = ctx.spawn({
          components: [[SpacingBar, { axis: w.axis, from: w.from, to: w.to, perp: w.perp, gap: w.gap }]],
        });
        barPool.push(e);
        barCache.set(e, w);
        continue;
      }
      const c = barCache.get(existing);
      if (
        c === undefined ||
        c.axis !== w.axis ||
        c.from !== w.from ||
        c.to !== w.to ||
        c.perp !== w.perp ||
        c.gap !== w.gap
      ) {
        ctx.edit(existing).set(SpacingBar, { axis: w.axis, from: w.from, to: w.to, perp: w.perp, gap: w.gap });
        barCache.set(existing, w);
      }
    }
    while (barPool.length > want.length) {
      const e = barPool.pop() as Entity;
      ctx.destroy(e);
      barCache.delete(e);
    }
  };

  return defineTickSystem(
    (ctx) => {
      const cfg = ctx.getResource(SnapConfig);
      const enabled = cfg?.enabled ?? SNAP_DEFAULTS.enabled;
      const thresholdPx = cfg?.thresholdPx ?? SNAP_DEFAULTS.thresholdPx;

      const setSnap = (rec: Entity, dx: number, dy: number): void => {
        const cur = ctx.get(rec, SnapState);
        if (cur === undefined || cur.dx !== dx || cur.dy !== dy) ctx.edit(rec).set(SnapState, { dx, dy });
      };

      // This frame's wanted visuals, accumulated across every snapping drag
      // (multi-pointer drags each contribute; usually one).
      const wantGuides: GuideWant[] = [];
      const wantBars: BarWant[] = [];

      ctx.query(snapDragQ).each((b) => {
        for (const r of b) {
          const rec = b.entity(r);
          const dragged = ctx.getRelations(rec, Drags);
          const captured = ctx.getRelation(rec, Captures);
          const hasSource =
            (captured !== undefined && ctx.hasTag(captured, SnapSource)) ||
            dragged.some((w) => ctx.hasTag(w, SnapSource));
          if (!enabled || !hasSource) {
            setSnap(rec, 0, 0);
            continue;
          }

          // Intended union rect from Grab + total/zoom (never last-applied Position).
          const d = ctx.read(rec, Drag);
          const zoom = d.zoomAtClaim || 1;
          const draggedSet = new Set<Entity>(dragged);
          let minX = Number.POSITIVE_INFINITY;
          let minY = Number.POSITIVE_INFINITY;
          let maxX = Number.NEGATIVE_INFINITY;
          let maxY = Number.NEGATIVE_INFINITY;
          let any = false;
          for (const w of dragged) {
            if (!ctx.isAlive(w) || !ctx.has(w, Grab)) continue;
            const g = ctx.read(w, Grab);
            const x = g.x + d.totalX / zoom;
            const y = g.y + d.totalY / zoom;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x + g.w);
            maxY = Math.max(maxY, y + g.h);
            any = true;
          }
          if (!any) {
            setSnap(rec, 0, 0);
            continue;
          }

          const threshold = thresholdPx / zoom;
          const intended: EntityBounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };

          // Candidates: index rect query over intended ∪ viewport (± threshold),
          // SnapTarget ∧ ¬Culled ∧ ∉dragged (design-003 §5.2).
          let qMinX = minX - threshold;
          let qMinY = minY - threshold;
          let qMaxX = maxX + threshold;
          let qMaxY = maxY + threshold;
          const cam = ctx.getResource(Camera);
          const vp = ctx.getResource(Viewport);
          if (cam !== undefined && vp !== undefined && vp.w > 0) {
            const vz = cam.zoom || 1; // Camera.x/y = world top-left (grid contract)
            qMinX = Math.min(qMinX, cam.x);
            qMinY = Math.min(qMinY, cam.y);
            qMaxX = Math.max(qMaxX, cam.x + vp.w / vz);
            qMaxY = Math.max(qMaxY, cam.y + vp.h / vz);
          }
          const refs: EntityBounds[] = [];
          for (const entry of index.search({ minX: qMinX, minY: qMinY, maxX: qMaxX, maxY: qMaxY })) {
            const e = entry.id;
            if (draggedSet.has(e) || !ctx.isAlive(e) || !ctx.hasTag(e, SnapTarget) || ctx.hasTag(e, Culled)) continue;
            refs.push({
              x: entry.minX,
              y: entry.minY,
              width: entry.maxX - entry.minX,
              height: entry.maxY - entry.minY,
            });
          }
          if (refs.length === 0) {
            setSnap(rec, 0, 0);
            continue;
          }

          const res = computeSnapGuides(intended, refs, threshold);
          setSnap(rec, res.snapDx, res.snapDy);
          for (const g of res.guides) wantGuides.push({ axis: g.axis, at: g.position });
          for (const sp of res.spacings) {
            for (const seg of sp.segments) {
              wantBars.push({ axis: sp.axis, from: seg.from, to: seg.to, perp: sp.perpPosition, gap: sp.gap });
            }
          }
        }
      });

      // Pool reconcile runs EVERY frame — the drag-ended frame (empty query)
      // is exactly the one that must reap; steady state is zero ops.
      syncGuides(ctx, wantGuides);
      syncBars(ctx, wantBars);
    },
    { name: "snapSystem", access: { write: [SnapState, GuideLine, SpacingBar] } },
  );
}
