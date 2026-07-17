/**
 * ops.arrange — the explicit desktop-style "Clean Up" (2026-07-17, James:
 * "if user click auto layout, it will try to organize the canvas nicely, bit
 * like desktop auto layout feature in windows and mac").
 *
 * Scope: explicit `ids` > the current selection (when ≥2, Figma-tidy style) >
 * every widget of the CURRENT nav frame (the same Selectable ∧ Active ∧
 * WidgetEquipped set selectAll sees — works at any nav depth, coordinates are
 * frame-local for every member by construction). Placement is kernel
 * `packLayout`: order-preserving shelf rows from the cluster's own bbox
 * top-left — "my mess, straightened", idempotent (a second click is a no-op
 * and commits nothing).
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
import { packLayout, type LayoutRect } from "@ice/kernel";
import type { Entity, World } from "@vibecook/strata-ecs";
import { defineQuery } from "@vibecook/strata-ecs";
import type { DurableStore } from "@vibecook/strata-ecs/durable";
import { Active, Grab, MeasuredSize, Position, Selectable, Size, TransformTween } from "../catalog";
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

  const rects: LayoutRect[] = movable.map((e) => {
    const p = world.get(e, Position) as { x: number; y: number };
    const m = world.get(e, MeasuredSize);
    const s = m !== undefined && m.w > 0 ? m : (world.get(e, Size) ?? { w: 0, h: 0 });
    return { x: p.x, y: p.y, w: s.w, h: s.h };
  });
  const placed = packLayout(rects, {
    gutter: opts.gutter ?? ARRANGE_GUTTER,
    ...(opts.maxWidth !== undefined ? { maxWidth: opts.maxWidth } : {}),
  });

  const moves: Array<{ e: Entity; from: { x: number; y: number }; to: { x: number; y: number } }> = [];
  for (let i = 0; i < movable.length; i++) {
    const from = rects[i] as LayoutRect;
    const to = placed[i] as { x: number; y: number };
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
