/**
 * ops.arrange — the explicit desktop-style "Clean Up" (2026-07-17, James:
 * "if user click auto layout, it will try to organize the canvas nicely, bit
 * like desktop auto layout feature in windows and mac").
 *
 * Scope: explicit `ids` > the current selection (when ≥2, Figma-tidy style) >
 * every widget of the CURRENT nav frame (the same Selectable ∧ Active ∧
 * WidgetEquipped set selectAll sees — works at any nav depth, coordinates are
 * frame-local for every member by construction).
 *
 * Placement (v2 2026-07-17, James: "can this clean up be more smarter?"):
 *  - WIRED widgets arrange like Unreal Blueprint's auto-format: each
 *    connected component (WireFrom/WireTo among the movers) is laid out by
 *    kernel `layerGraph` — layered columns along wire direction — and moves
 *    as one rigid block.
 *  - Blocks + loose widgets then pack via kernel `packLayout` (bottom-left
 *    candidates: dense with mixed sizes, anchored at the cluster's own bbox
 *    top-left, idempotent — a second click is a no-op and commits nothing).
 *  - Frame widgets OUTSIDE the moving set are passed as OBSTACLES: a scoped
 *    Clean Up flows around bystanders instead of landing on top of them.
 *
 * Write protocol (design-001 §3, composed from existing primitives only):
 *   1. ONE guarded transaction sets every mover's final Position — a single
 *      undo step restores the whole arrangement. The tx write-through snaps
 *      runtime + baseline to the target synchronously (strata transaction.ts
 *      §13.2 rule 2: pre-existing component value writes are committer-wins).
 *   2. Per mover: attach TransformTween(→ target), then write the runtime
 *      cell BACK to the old position through the session LiveWriter — legal
 *      divergence (a live tween IS the claim, design-001 §3 amendment), so
 *      the card glides while the document already holds the truth. The tween
 *      reconverges with the committed value on land; no commit-at-land
 *      machinery exists or is needed. (Undo DURING the ≤240ms glide is the
 *      same accepted divergence window fly-back already has.)
 *
 * The user's hand always wins: widgets under a live Grab or an in-flight
 * TransformTween are skipped. Runtime-only widgets (no doc key) skip the tx
 * and are tweened/written directly — no doc cell, nothing to guard.
 */
import { layerGraph, packLayout, type LayoutRect } from "@ice/kernel";
import type { Entity, World } from "@vibecook/strata-ecs";
import { defineQuery } from "@vibecook/strata-ecs";
import type { DurableStore } from "@vibecook/strata-ecs/durable";
import {
  Active,
  Grab,
  MeasuredSize,
  Position,
  Selectable,
  Size,
  TransformTween,
  Wire,
  WireFrom,
  WireTo,
} from "../catalog";
import { guardedTransaction } from "../guards/guarded-tx";
import type { LiveWriter } from "../guards/live-writer";
import { WidgetEquipped } from "../widget/define-widget";
import { selectedEntities } from "./selection";

export interface ArrangeOpts {
  /** Explicit scope; wins over selection/frame resolution. */
  readonly ids?: readonly Entity[];
  /** Min separation between packed widgets (default 24). */
  readonly gutter?: number;
  /** Row wrap width; default = packLayout's near-square derivation. */
  readonly maxWidth?: number;
  /** Glide duration; 0 snaps instantly (tests/headless). Default 240ms. */
  readonly durationMs?: number;
}

const ARRANGE_MS = 240;
const ARRANGE_GUTTER = 24;

const frameWidgetsQ = defineQuery([Position, Size, Selectable, Active, WidgetEquipped]);
const wireQ = defineQuery([Wire]);

/** Returns the entities that actually moved (empty = already tidy). */
export function arrangeWidgets(
  store: DurableStore,
  liveWriter: LiveWriter,
  world: World,
  opts: ArrangeOpts = {},
): Entity[] {
  let targets: Entity[];
  if (opts.ids !== undefined && opts.ids.length > 0) {
    targets = [...opts.ids];
  } else {
    const sel = selectedEntities(world);
    if (sel.length >= 2) {
      targets = sel;
    } else {
      targets = [];
      world.query(frameWidgetsQ).each((b) => {
        for (const r of b) targets.push(b.entity(r));
      });
    }
  }

  const movable = targets.filter(
    (e) =>
      world.isAlive(e) &&
      !world.has(e, Grab) &&
      !world.has(e, TransformTween) &&
      world.get(e, Position) !== undefined,
  );
  if (movable.length < 2) return [];

  const rectOf = (e: Entity): LayoutRect => {
    const p = world.get(e, Position) as { x: number; y: number };
    const m = world.get(e, MeasuredSize);
    const s = m !== undefined && m.w > 0 ? m : (world.get(e, Size) ?? { w: 0, h: 0 });
    return { x: p.x, y: p.y, w: s.w, h: s.h };
  };
  const rects: LayoutRect[] = movable.map(rectOf);
  const gutter = opts.gutter ?? ARRANGE_GUTTER;

  // One band width rules both layers: wired blocks WRAP into stacked bands
  // when a chain would outgrow it (2026-07-17 "rigid blocks" limit lifted),
  // and the packer wraps loose rows at the same width. Explicit maxWidth
  // wins; the default is packLayout's own near-square derivation, computed
  // over the individual movers.
  const bandWidth =
    opts.maxWidth ??
    (() => {
      let area = 0;
      let widest = 0;
      for (const r of rects) {
        area += (r.w + gutter) * (r.h + gutter);
        widest = Math.max(widest, r.w);
      }
      return Math.max(widest, Math.sqrt(area * 1.6));
    })();

  // Bystanders are obstacles: every frame widget outside the moving set
  // (unselected, live-claimed, in-flight) stays put and must not be crowded.
  const movableSet = new Set(movable);
  const obstacles: LayoutRect[] = [];
  world.query(frameWidgetsQ).each((b) => {
    for (const r of b) {
      const e = b.entity(r);
      if (!movableSet.has(e)) obstacles.push(rectOf(e));
    }
  });

  // Wire edges among the movers (WireFrom/WireTo point at widgets): each
  // connected component becomes a rigid layerGraph block.
  const indexOf = new Map<Entity, number>();
  movable.forEach((e, i) => indexOf.set(e, i));
  const edges: Array<[number, number]> = [];
  world.query(wireQ).each((b) => {
    for (const r of b) {
      const wire = b.entity(r);
      const from = world.getRelation(wire, WireFrom);
      const to = world.getRelation(wire, WireTo);
      if (from === undefined || to === undefined) continue;
      const fi = indexOf.get(from);
      const ti = indexOf.get(to);
      if (fi !== undefined && ti !== undefined && fi !== ti) edges.push([fi, ti]);
    }
  });
  const parent = movable.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root] as number;
    let cursor = i;
    while (parent[cursor] !== root) {
      const next = parent[cursor] as number;
      parent[cursor] = root;
      cursor = next;
    }
    return root;
  };
  for (const [u, v] of edges) {
    const a = find(u);
    const b = find(v);
    if (a !== b) parent[a] = b;
  }
  const comps = new Map<number, number[]>();
  for (let i = 0; i < movable.length; i++) {
    const root = find(i);
    const list = comps.get(root);
    if (list === undefined) comps.set(root, [i]);
    else list.push(i);
  }

  // Pack units: wired components as blocks (internal layerGraph placement),
  // everything else as itself.
  type Unit = { members: number[]; rel: Array<{ x: number; y: number }> };
  const units: Unit[] = [];
  const unitRects: LayoutRect[] = [];
  for (const members of comps.values()) {
    if (members.length < 2) {
      const i = members[0] as number;
      units.push({ members: [i], rel: [{ x: 0, y: 0 }] });
      unitRects.push(rects[i] as LayoutRect);
      continue;
    }
    const local = new Map<number, number>();
    members.forEach((gi, li) => local.set(gi, li));
    const localEdges: Array<[number, number]> = [];
    for (const [u, v] of edges) {
      const lu = local.get(u);
      const lv = local.get(v);
      if (lu !== undefined && lv !== undefined) localEdges.push([lu, lv]);
    }
    const sizes = members.map((gi) => ({ w: (rects[gi] as LayoutRect).w, h: (rects[gi] as LayoutRect).h }));
    const measure = (placements: Array<{ x: number; y: number }>): { w: number; h: number } => {
      let w = 0;
      let h = 0;
      placements.forEach((p, li) => {
        const r = rects[members[li] as number] as LayoutRect;
        w = Math.max(w, p.x + r.w);
        h = Math.max(h, p.y + r.h);
      });
      return { w, h };
    };
    // Short chains stay LINEAR (the Blueprint promise: follow the wires);
    // only a run clearly wider than the band (>1.5×) wraps into stacked
    // bands. The decision depends only on the graph, so re-runs repeat it —
    // idempotence holds.
    let rel = layerGraph(sizes, localEdges, { gapX: gutter * 2, gapY: gutter });
    let dims = measure(rel);
    if (dims.w > bandWidth * 1.5) {
      rel = layerGraph(sizes, localEdges, { gapX: gutter * 2, gapY: gutter, maxWidth: bandWidth });
      dims = measure(rel);
    }
    let bx = Number.POSITIVE_INFINITY;
    let by = Number.POSITIVE_INFINITY;
    for (const gi of members) {
      const r = rects[gi] as LayoutRect;
      bx = Math.min(bx, r.x); // the block's CURRENT anchor: members' bbox top-left
      by = Math.min(by, r.y);
    }
    units.push({ members, rel });
    unitRects.push({ x: bx, y: by, w: dims.w, h: dims.h });
  }

  const placedUnits = packLayout(unitRects, { gutter, obstacles, maxWidth: bandWidth });

  const finalPos = new Array<{ x: number; y: number }>(movable.length);
  units.forEach((u, k) => {
    const p = placedUnits[k] as { x: number; y: number };
    u.members.forEach((gi, li) => {
      const rel = u.rel[li] as { x: number; y: number };
      finalPos[gi] = { x: p.x + rel.x, y: p.y + rel.y };
    });
  });

  const moves: Array<{ e: Entity; from: { x: number; y: number }; to: { x: number; y: number } }> = [];
  for (let i = 0; i < movable.length; i++) {
    const from = rects[i] as LayoutRect;
    const to = finalPos[i] as { x: number; y: number };
    if (Math.abs(from.x - to.x) < 0.5 && Math.abs(from.y - to.y) < 0.5) continue;
    moves.push({ e: movable[i] as Entity, from: { x: from.x, y: from.y }, to });
  }
  if (moves.length === 0) return [];

  const durable = moves.filter((m) => store.keyOf(m.e) !== undefined);
  if (durable.length > 0) {
    guardedTransaction(store, world, (tx) => {
      for (const m of durable) tx.edit(m.e).set(Position, { x: m.to.x, y: m.to.y });
    });
  }

  const dur = opts.durationMs ?? ARRANGE_MS;
  if (dur > 0) {
    for (const m of moves) {
      world.addComponent(m.e, TransformTween, { toX: m.to.x, toY: m.to.y, durationMs: dur, elapsedMs: 0 });
      liveWriter.set(m.e, Position, { x: m.from.x, y: m.from.y });
    }
  } else {
    // No glide: the tx already snapped the durable movers; runtime-only
    // movers still need their value write.
    for (const m of moves) {
      if (store.keyOf(m.e) === undefined) {
        world.edit(m.e).set(Position, { x: m.to.x, y: m.to.y });
      }
    }
  }
  return moves.map((m) => m.e);
}
