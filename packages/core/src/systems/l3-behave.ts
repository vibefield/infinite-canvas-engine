/**
 * L3 — select + move behaviors (design-003 §5 items 1, 3, 5; `ctl:behave`).
 *
 * The behavior contract (design-003 §5): read riders/edges attached at
 * ctl:claim; per frame (persistent `Active`) apply ABSOLUTE live writes from
 * rider origins + gesture totals; on `JustEnded` emit ONE commit (through the
 * CommitSink seam — M5 swaps in the doc transaction); on `JustCancelled`
 * restore from riders — Position AND StackZ (a forgotten StackZ restore leaves
 * the cell diverged forever); remove riders and gesture-scoped edges on every
 * terminal path. Discrete actions edge-trigger on `Just*` markers only.
 *
 * Move outcome tree (design-003 §5.5, three-way via dropSystem's signals):
 *   DropTarget + OverlapCandidate on the container → CONSUME (reparent intent);
 *   DropTarget without OverlapCandidate → FLY-BACK (no commit; TransformTween
 *     rider per widget — the tween HOLDS the claim, design-001 §3 amended);
 *   no DropTarget → COMMIT (final Position + StackZ per live Drags edge).
 * Without dropSystem installed no DropTarget ever exists ⇒ plain commits.
 */
import type { Entity, System, SystemCtx, World } from "@vibecook/strata-ecs";
import { defineQuery, defineSystem } from "@vibecook/strata-ecs";
import {
  Captures,
  Drag,
  Drags,
  DropTarget,
  GesturePhases,
  Grab,
  OverlapCandidate,
  OverlapRejected,
  PointerMods,
  Position,
  RoutedMove,
  Selectable,
  Size,
  Selected,
  SnapState,
  StackZ,
  Tap,
  TransformTween,
  Watches,
  Wire,
} from "../catalog";
import type { CommitSink, CommitWrite } from "../engine/commit-sink";
import { SelectionVersion, bumpVersion } from "../helpers/version-stamps";
import { selectedEntities } from "../ops/selection";

const P = GesturePhases;

const tapRecognizedQ = defineQuery([Tap, P.justTags.Recognized]);
const moveDragQ = defineQuery([Drag, RoutedMove]);

const FLY_BACK_MS = 200;

/** ctx-side selection flip (setSelection is the app-handler/world variant). */
function applySelection(
  world: World,
  ctx: SystemCtx,
  target: Entity | undefined,
  toggle: boolean,
): void {
  const current = selectedEntities(world);
  if (target === undefined) {
    if (current.length === 0) return;
    for (const s of current) ctx.removeTag(s, Selected);
    bumpVersion(world, SelectionVersion);
    return;
  }
  if (toggle) {
    if (ctx.hasTag(target, Selected)) ctx.removeTag(target, Selected);
    else ctx.addTag(target, Selected);
    bumpVersion(world, SelectionVersion);
    return;
  }
  const alreadySole = current.length === 1 && current[0] === target;
  if (alreadySole) return;
  for (const s of current) if (s !== target) ctx.removeTag(s, Selected);
  if (!ctx.hasTag(target, Selected)) ctx.addTag(target, Selected);
  bumpVersion(world, SelectionVersion);
}

export function createSelectMoveBehaviors(
  world: World,
  sink: CommitSink,
): { selectBehavior: System; moveBehavior: System } {
  const selectBehavior = defineSystem(
    tapRecognizedQ,
    (b, ctx) => {
      for (const r of b) {
        const rec = b.entity(r);
        // Modifiers come from the POINTER's latched sample (PointerMods rides
        // every event) — the Keyboard resource only carries key-event state.
        const pointer = ctx.getRelations(rec, Watches)[0];
        const shift = pointer !== undefined && ctx.get(pointer, PointerMods)?.shift === true;
        const captured = ctx.getRelation(rec, Captures);
        const selectable =
          captured !== undefined &&
          (ctx.hasTag(captured, Selectable) || ctx.hasTag(captured, Wire));
        // Tap on canvas/none/unselectable clears; on a selectable, replace (shift = toggle).
        applySelection(world, ctx, selectable ? captured : undefined, shift && selectable);
      }
    },
    { name: "selectBehavior" },
  );

  /** Remove this gesture's riders + edges (every terminal path, design-003 §5). */
  const clearGestureState = (ctx: SystemCtx, rec: Entity, dragged: readonly Entity[]): void => {
    for (const w of dragged) {
      if (ctx.isAlive(w) && ctx.has(w, Grab)) ctx.removeComponent(w, Grab);
    }
    ctx.removeRelation(rec, Drags);
    const container = ctx.getRelation(rec, DropTarget);
    if (container !== undefined) {
      if (ctx.hasTag(container, OverlapCandidate)) ctx.removeTag(container, OverlapCandidate);
      if (ctx.hasTag(container, OverlapRejected)) ctx.removeTag(container, OverlapRejected);
      ctx.removeRelation(rec, DropTarget);
    }
  };

  const moveBehavior = defineSystem(
    moveDragQ,
    (b, ctx) => {
      for (const r of b) {
        const rec = b.entity(r);
        const dragged = ctx.getRelations(rec, Drags); // live edges — remote despawns already gone

        if (ctx.hasTag(rec, P.tags.Active)) {
          // Per-frame absolute writes: Grab origin + screen totals / zoom-at-claim + snap.
          const d = ctx.read(rec, Drag);
          const snap = ctx.get(rec, SnapState) ?? { dx: 0, dy: 0 };
          const wx = d.totalX / d.zoomAtClaim + snap.dx;
          const wy = d.totalY / d.zoomAtClaim + snap.dy;
          for (const w of dragged) {
            if (!ctx.isAlive(w) || !ctx.has(w, Grab)) continue; // survivor-safe (design-003 §8)
            const g = ctx.read(w, Grab);
            ctx.edit(w).set(Position, { x: g.x + wx, y: g.y + wy });
          }
          continue;
        }

        if (ctx.hasTag(rec, P.justTags.Ended)) {
          const d = ctx.read(rec, Drag);
          const snap = ctx.get(rec, SnapState) ?? { dx: 0, dy: 0 };
          const wx = d.totalX / d.zoomAtClaim + snap.dx;
          const wy = d.totalY / d.zoomAtClaim + snap.dy;
          let container = ctx.getRelation(rec, DropTarget);

          // Re-validate at RELEASE: the drop system's candidate is one frame
          // behind, and a coalesced final-move+up frame can leave a STALE
          // target the widget no longer overlaps (2026-07-12: a mid-path card
          // triggered a spurious fly-back). The FINAL bounds are the truth.
          if (container !== undefined && ctx.isAlive(container)) {
            const cp = ctx.get(container, Position);
            const cs = ctx.get(container, Size);
            let overlaps = false;
            if (cp !== undefined && cs !== undefined) {
              for (const w of dragged) {
                if (!ctx.isAlive(w) || !ctx.has(w, Grab) || !ctx.has(w, Size)) continue;
                const g = ctx.read(w, Grab);
                const ws = ctx.read(w, Size);
                const x = g.x + wx;
                const y = g.y + wy;
                if (x < cp.x + cs.w && x + ws.w > cp.x && y < cp.y + cs.h && y + ws.h > cp.y) {
                  overlaps = true;
                  break;
                }
              }
            }
            if (!overlaps) container = undefined; // stale → plain commit
          }

          if (container !== undefined && !ctx.hasTag(container, OverlapCandidate)) {
            // Rejected drop → fly-back, NO commit. The tween holds the claim
            // (design-001 §3 amended); cells reconverge when it lands.
            for (const w of dragged) {
              if (!ctx.isAlive(w) || !ctx.has(w, Grab)) continue;
              const g = ctx.read(w, Grab);
              ctx.addComponent(w, TransformTween, {
                toX: g.x,
                toY: g.y,
                durationMs: FLY_BACK_MS,
                elapsedMs: 0,
              });
              // Restore StackZ NOW (it is not animated): fly-back commits
              // nothing, so an elevated z left in place would keep the cell
              // diverged forever and hold remote z-edits indefinitely — the
              // same law as the cancel path (design-003 §5.3).
              if (ctx.has(w, StackZ)) ctx.edit(w).set(StackZ, { z: g.z });
            }
          } else if (container !== undefined) {
            // Consume: reparent + final position, one intent (one tx at M5).
            const writes: CommitWrite[] = [];
            const reparents: { entity: Entity; container: Entity }[] = [];
            const containerPos = ctx.get(container, Position) ?? { x: 0, y: 0 };
            for (const w of dragged) {
              if (!ctx.isAlive(w) || !ctx.has(w, Grab)) continue;
              const g = ctx.read(w, Grab);
              // Container-frame conversion: world → container-local (M8 refines
              // to the kernel container-frame path once nested canvas lands).
              writes.push({
                entity: w,
                component: Position,
                value: { x: g.x + wx - containerPos.x, y: g.y + wy - containerPos.y },
              });
              reparents.push({ entity: w, container });
            }
            if (writes.length > 0) sink.commit({ kind: "consume", gesture: rec, writes, reparents });
          } else {
            // Plain move commit: final Position + StackZ per live edge.
            const writes: CommitWrite[] = [];
            for (const w of dragged) {
              if (!ctx.isAlive(w) || !ctx.has(w, Grab)) continue;
              const g = ctx.read(w, Grab);
              writes.push({ entity: w, component: Position, value: { x: g.x + wx, y: g.y + wy } });
              const z = ctx.get(w, StackZ);
              if (z !== undefined) {
                writes.push({ entity: w, component: StackZ, value: { z: z.z } });
              }
            }
            if (writes.length > 0) sink.commit({ kind: "move", gesture: rec, writes });
          }
          clearGestureState(ctx, rec, dragged);
          continue;
        }

        if (ctx.hasTag(rec, P.justTags.Cancelled) || ctx.hasTag(rec, P.justTags.Failed)) {
          // Restore Position AND StackZ from Grab (design-003 §5.3), then clean up.
          for (const w of dragged) {
            if (!ctx.isAlive(w) || !ctx.has(w, Grab)) continue;
            const g = ctx.read(w, Grab);
            ctx.edit(w).set(Position, { x: g.x, y: g.y });
            if (ctx.has(w, StackZ)) ctx.edit(w).set(StackZ, { z: g.z });
          }
          clearGestureState(ctx, rec, dragged);
        }
      }
    },
    {
      name: "moveBehavior",
      // Position is co-written with resizeBehavior in ctl:behave BY DESIGN
      // (design-003 §5 in-phase order) and row-disjoint by construction
      // (dragRoute: RoutedMove xor RoutedResize) — attested (strata 0.4.0,
      // petition 3a), so the writer-pair advisory stays quiet here and loud
      // for real mistakes.
      access: { write: [Position, StackZ], orderIndependent: [Position] },
    },
  );

  return { selectBehavior, moveBehavior };
}
