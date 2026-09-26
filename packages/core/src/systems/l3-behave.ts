/**
 * L3 — select + move behaviors (design-003 §5 items 1, 3, 5; `ctl:behave`).
 *
 * The behavior contract (design-003 §5): read riders/edges attached at
 * ctl:claim; per frame (persistent `Active`) apply ABSOLUTE live writes from
 * rider origins + gesture totals; on `JustEnded` emit ONE commit (through the
 * CommitSink seam — M5 swaps in the doc transaction); on `JustCancelled`
 * restore from riders — Position AND sibling order (petition 8: a forgotten
 * order restore leaves the sequence diverged forever, the old StackZ law);
 * remove riders and gesture-scoped edges on every terminal path. Discrete
 * actions edge-trigger on `Just*` markers only.
 *
 * Move outcome tree (design-003 §5.5, three-way via dropSystem's signals):
 *   DropTarget + OverlapCandidate on the container → CONSUME (reparent intent);
 *   DropTarget without OverlapCandidate → FLY-BACK (no commit; TransformTween
 *     rider per widget — the tween HOLDS the claim, design-001 §3 amended);
 *   no DropTarget → COMMIT (final Position per live Drags edge + the sibling
 *     placement as ORDER ops, so one gesture stays one transaction).
 * Without dropSystem installed no DropTarget ever exists ⇒ plain commits.
 */
import type { Entity, OrderPlace, System, SystemCtx, World } from "@vibecook/strata-ecs";
import { defineQuery, defineSystem } from "@vibecook/strata-ecs";
import { insertSlot, screenToWorld, type CameraState, type LayoutRect } from "@ice/kernel";
import {
  Camera,
  Captures,
  ChildOf,
  DownPart,
  Drag,
  Drags,
  DropTarget,
  GesturePhases,
  GhostCommitted,
  GhostRetiring,
  Grab,
  InsertGhost,
  LeavesCopy,
  MeasuredSize,
  NO_ENTITY,
  OverlapCandidate,
  OverlapRejected,
  PartTap,
  PointerMods,
  Position,
  RoutedMove,
  Selectable,
  Size,
  Selected,
  SnapState,
  Tap,
  TransformTween,
  Watches,
  Wire,
} from "../catalog";
import type { CommitCreate, CommitOrder, CommitSink, CommitWrite } from "../engine/commit-sink";
import { SelectionVersion, bumpVersion } from "../helpers/version-stamps";
import type { NavGeometrySlot } from "../nav/nav-geometry";
import { selectedEntities } from "../ops/selection";
import { dropFaceOf, insideRect, objectsOnly } from "./l3-drop";
import { widgetTypeFor } from "../canvas/engine-catalog";
import { PrefabId } from "../schema/prefab";
import { moveDelta } from "./drag-mods";

const P = GesturePhases;

const tapRecognizedQ = defineQuery([Tap, P.justTags.Recognized]);
const moveDragQ = defineQuery([Drag, RoutedMove]);

const FLY_BACK_MS = 200;

/** Min separation for consume free-slot placement (kernel insertSlot). */
const CONSUME_GUTTER = 16;

const IDENTITY_CAM: CameraState = { x: 0, y: 0, zoom: 1 };

/** InsertGhost.props (JSON) → CommitCreate.props; empty/malformed ⇒ absent. */
function parseGhostProps(raw: string): Record<string, unknown> | undefined {
  if (raw === "" || raw === "{}") return undefined;
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === "object" && v !== null && Object.keys(v).length > 0
      ? (v as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Fly a tray-insert ghost HOME (cancel / rejected drop): the tween target is
 * the tray press point re-projected through the CURRENT camera — the ghost
 * returns to the tray ON SCREEN even after a mid-drag zoom (wheel gestures are
 * Simultaneous). `GhostRetiring` hands it to the reap system, which despawns
 * it when the tween lands. No Position restore, no commit — the ghost never
 * had a document row to diverge from.
 */
function ghostFlyBack(ctx: SystemCtx, ghost: Entity): void {
  const gh = ctx.read(ghost, InsertGhost);
  const cam = ctx.getResource(Camera) ?? IDENTITY_CAM;
  const home = screenToWorld(gh.screenX, gh.screenY, cam);
  const size = ctx.get(ghost, Size) ?? { w: 0, h: 0 };
  ctx.addComponent(ghost, TransformTween, {
    toX: home.x - size.w / 2,
    toY: home.y - size.h / 2,
    durationMs: FLY_BACK_MS,
    elapsedMs: 0,
  });
  ctx.addTag(ghost, GhostRetiring);
}

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

/**
 * Reinsert the dragged set at its remembered sibling positions (petition 8 —
 * the cancel/fly-back twin of the claim elevate). Members walk in ORIGINAL
 * relative order (`Grab.ord`), each `{after: resolved anchor}`:
 *  - same-`prev` run → ride the previously-reinserted member (a contiguous
 *    block re-forms in claim order);
 *  - the original `prev` anchor, when it survived UNDER THE SAME PARENT;
 *  - else the nearest surviving earlier sibling we know — the last member
 *    already reinserted into this parent;
 *  - else "first" — NEVER "last": a mid-stack cancel must not jump to top.
 * Edge-less members (memo parent NO_ENTITY) were never elevated — skipped; a
 * parent that died mid-gesture took the whole sequence with it — skipped.
 * ctx placements apply at the flush IN ORDER, so each anchor is already
 * placed when consulted.
 */
function restoreOrder(ctx: SystemCtx, dragged: readonly Entity[]): void {
  const members: { e: Entity; parent: Entity; prev: Entity; ord: number }[] = [];
  for (const w of dragged) {
    if (!ctx.isAlive(w) || !ctx.has(w, Grab)) continue;
    const g = ctx.read(w, Grab);
    if (g.parent === NO_ENTITY || !ctx.isAlive(g.parent)) continue;
    // FOREIGN-REPARENT GUARD (rev-ice-flip finding 2): the gesture itself never changes a
    // member's parent mid-flight (elevate is same-parent; consume runs only at end), so a
    // current parent that differs from the memo means a REMOTE edit won that edge. Restoring
    // the memo parent would revert the foreign reparent in the runtime only — cancel commits
    // nothing, so runtime structure forks from the doc until some later remote op happens to
    // rewrite the row. Skip: order restore is a courtesy; membership truth is the doc's.
    if (ctx.getRelation(w, ChildOf) !== g.parent) continue;
    members.push({ e: w, parent: g.parent, prev: g.prev, ord: g.ord });
  }
  members.sort((a, b) => a.ord - b.ord);
  const lastByParent = new Map<Entity, { e: Entity; prev: Entity }>();
  for (const m of members) {
    const last = lastByParent.get(m.parent);
    let place: OrderPlace;
    if (last !== undefined && last.prev === m.prev) {
      place = { after: last.e };
    } else if (m.prev !== NO_ENTITY && ctx.isAlive(m.prev) && ctx.getRelation(m.prev, ChildOf) === m.parent) {
      place = { after: m.prev };
    } else if (last !== undefined) {
      place = { after: last.e };
    } else {
      place = "first";
    }
    ctx.setRelation(m.e, ChildOf, m.parent, place);
    lastByParent.set(m.parent, { e: m.e, prev: m.prev });
  }
}

/**
 * The plain-move commit's ORDER ops (petition 8): re-assert each member's
 * elevated placement — `{parent, "last"}` in CURRENT sibling order, so the
 * doc transaction lands exactly the runtime sequence the elevate built.
 * Edge-less members carry no placement.
 */
function commitOrders(ctx: SystemCtx, dragged: readonly Entity[]): CommitOrder[] {
  const byParent = new Map<Entity, Set<Entity>>();
  for (const w of dragged) {
    if (!ctx.isAlive(w) || !ctx.has(w, Grab)) continue;
    const parent = ctx.getRelation(w, ChildOf);
    if (parent === undefined) continue;
    let set = byParent.get(parent);
    if (set === undefined) {
      set = new Set();
      byParent.set(parent, set);
    }
    set.add(w);
  }
  const orders: CommitOrder[] = [];
  for (const [parent, set] of byParent) {
    for (const sib of ctx.getReverse(parent, ChildOf)) {
      if (set.has(sib)) orders.push({ entity: sib, parent, place: "last" });
    }
  }
  return orders;
}

export function createSelectMoveBehaviors(
  world: World,
  sink: CommitSink,
  opts: { readonly navGeometry?: NavGeometrySlot } = {},
): { selectBehavior: System; moveBehavior: System } {
  const navGeometry = opts.navGeometry;
  /** An ⌥-drag's copy of `w`: its type and every prop group as they are, at its origin (`Grab`), untaped, just under it. */
  const copyOf = (ctx: SystemCtx, w: Entity, g: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }): CommitCreate | undefined => {
    const id = ctx.get(w, PrefabId)?.id;
    const widget = typeof id === "string" ? widgetTypeFor(world, id) : undefined;
    if (widget === undefined || typeof id !== "string") return undefined;
    const props: Record<string, unknown> = {};
    for (const group of widget.groups) {
      const v = ctx.get(w, group.component) as Record<string, unknown> | undefined;
      if (v !== undefined) for (const name of Object.keys(group.fields)) props[name] = v[name];
    }
    return { type: id, x: g.x, y: g.y, w: g.w, h: g.h, props, order: { before: w } };
  };
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
        // A tap on a card program's PART (design-014, B3b) is the app's: hand it over, select nothing.
        const part = ctx.get(rec, DownPart)?.part ?? "";
        if (part !== "" && captured !== undefined) {
          const prev = world.getResource(PartTap);
          world.setResource(PartTap, { seq: (prev?.seq ?? 0) + 1, target: captured, part });
          continue;
        }
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

  const rejectCommit = (ctx: SystemCtx, dragged: readonly Entity[]): void => {
    for (const w of dragged) {
      if (!ctx.isAlive(w) || !ctx.has(w, Grab)) continue;
      if (ctx.has(w, InsertGhost)) {
        ghostFlyBack(ctx, w);
        continue;
      }
      const g = ctx.read(w, Grab);
      ctx.addComponent(w, TransformTween, {
        toX: g.x,
        toY: g.y,
        durationMs: FLY_BACK_MS,
        elapsedMs: 0,
      });
    }
    restoreOrder(ctx, dragged);
  };

  const moveBehavior = defineSystem(
    moveDragQ,
    (b, ctx) => {
      for (const r of b) {
        const rec = b.entity(r);
        const dragged = ctx.getRelations(rec, Drags); // live edges — remote despawns already gone

        if (ctx.hasTag(rec, P.tags.Active)) {
          // Per-frame absolute writes: Grab origin + the drag's delta (screen totals / zoom-at-claim, ⇧'s axis lock — drag-mods.ts) + snap.
          const delta = moveDelta(ctx, rec);
          const snap = ctx.get(rec, SnapState) ?? { dx: 0, dy: 0 };
          const wx = delta.x + snap.dx;
          const wy = delta.y + snap.dy;
          for (const w of dragged) {
            if (!ctx.isAlive(w) || !ctx.has(w, Grab)) continue; // survivor-safe (design-003 §8)
            const g = ctx.read(w, Grab);
            ctx.edit(w).set(Position, { x: g.x + wx, y: g.y + wy });
          }
          continue;
        }

        if (ctx.hasTag(rec, P.justTags.Ended)) {
          const d = ctx.read(rec, Drag);
          const delta = moveDelta(ctx, rec);
          const snap = ctx.get(rec, SnapState) ?? { dx: 0, dy: 0 };
          const wx = delta.x + snap.dx;
          const wy = delta.y + snap.dy;
          let container = ctx.getRelation(rec, DropTarget);
          // The desk's rules for an all-OBJECT set (design-015 §9, D2b): ⌥ held at the release
          // keeps the object on this desk; the centre of the FINAL bounds over the container's
          // FACE decides; the landing goes through the inside's embedding (below).
          const objects = objectsOnly(world, dragged);
          const pointer = ctx.getRelations(rec, Watches)[0];
          const alt = pointer !== undefined && ctx.get(pointer, PointerMods)?.alt === true;
          if (objects && alt) container = undefined;
          let drop: ReturnType<typeof dropFaceOf> | undefined;

          // Re-validate at RELEASE: the drop system's candidate is one frame
          // behind, and a coalesced final-move+up frame can leave a STALE
          // target the widget no longer overlaps (2026-07-12: a mid-path card
          // triggered a spurious fly-back). The FINAL bounds are the truth.
          if (container !== undefined && ctx.isAlive(container) && objects) {
            drop = dropFaceOf(world, container, navGeometry);
            let minX = Number.POSITIVE_INFINITY;
            let minY = Number.POSITIVE_INFINITY;
            let maxX = Number.NEGATIVE_INFINITY;
            let maxY = Number.NEGATIVE_INFINITY;
            for (const w of dragged) {
              if (!ctx.isAlive(w) || !ctx.has(w, Grab) || !ctx.has(w, Size)) continue;
              const g = ctx.read(w, Grab);
              const ws = ctx.read(w, Size);
              minX = Math.min(minX, g.x + wx);
              minY = Math.min(minY, g.y + wy);
              maxX = Math.max(maxX, g.x + wx + ws.w);
              maxY = Math.max(maxY, g.y + wy + ws.h);
            }
            const over = drop !== undefined && Number.isFinite(minX) && insideRect(drop.face, (minX + maxX) / 2, (minY + maxY) / 2);
            if (!over) container = undefined; // the centre left the face → plain commit
          } else if (container !== undefined && ctx.isAlive(container)) {
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
            // (design-001 §3 amended); cells reconverge when it lands. A
            // tray-insert ghost flies HOME (the tray press point) instead of
            // to a Grab origin it only ever had under the tray — and retires.
            for (const w of dragged) {
              if (!ctx.isAlive(w) || !ctx.has(w, Grab)) continue;
              if (ctx.has(w, InsertGhost)) {
                ghostFlyBack(ctx, w);
                continue;
              }
              const g = ctx.read(w, Grab);
              ctx.addComponent(w, TransformTween, {
                toX: g.x,
                toY: g.y,
                durationMs: FLY_BACK_MS,
                elapsedMs: 0,
              });
            }
            // Restore sibling ORDER now (it is not animated): fly-back commits
            // nothing, so an elevated sequence left in place would keep the
            // runtime diverged forever and hold remote reorders indefinitely —
            // the same law as the cancel path (design-003 §5.3).
            restoreOrder(ctx, dragged);
          } else if (container !== undefined) {
            // Consume: reparent + final position, one intent (one tx at M5).
            // A tray-insert ghost becomes a CREATE-inside-container instead of
            // a reparent (it has no document row to reparent): same free-slot
            // placement, container-local coords, promoted in the same single
            // transaction. `GhostCommitted` hands it to the reap swap.
            const writes: CommitWrite[] = [];
            const reparents: { entity: Entity; container: Entity }[] = [];
            const creates: CommitCreate[] = [];
            const promotingGhosts: Entity[] = [];
            const containerPos = ctx.get(container, Position) ?? { x: 0, y: 0 };
            // Free-slot placement (2026-07-17, James: folder drops "pile up on
            // each other"): the raw drop point maps everyone who aimed at the
            // folder's center onto the same container-local spot. Newcomers
            // get the nearest free slot instead; incumbents NEVER move (the
            // kernel insertSlot contract). Sizes mirror the folder preview's
            // rule: measured when real, else declared.
            const incumbents: LayoutRect[] = [];
            for (const c of ctx.getReverse(container, ChildOf)) {
              const cp = ctx.get(c, Position);
              const cm = ctx.get(c, MeasuredSize);
              const cs = cm !== undefined && cm.w > 0 ? cm : ctx.get(c, Size);
              if (cp === undefined || cs === undefined) continue;
              incumbents.push({ x: cp.x, y: cp.y, w: cs.w, h: cs.h });
            }
            // An OBJECT goes in through the inside's EMBEDDING (design-015 §9, the prototype's
            // `dropInto`): where its centre lay on the face, in the inside's own units — `(n − M.o) / M.s`
            // — its size kept, so it takes the inside's scale; no free-slot placement (it lands where
            // it was let go, as a thing put into a nested desk does).
            const M = objects ? drop?.affine : undefined;
            for (const w of dragged) {
              if (!ctx.isAlive(w) || !ctx.has(w, Grab)) continue;
              const g = ctx.read(w, Grab);
              const wm = ctx.get(w, MeasuredSize);
              const ws = wm !== undefined && wm.w > 0 ? wm : (ctx.get(w, Size) ?? { w: 0, h: 0 });
              let slot: { x: number; y: number };
              if (M !== undefined) {
                const ncx = g.x + wx + ws.w / 2;
                const ncy = g.y + wy + ws.h / 2;
                slot = { x: (ncx - M.ox) / M.s - ws.w / 2, y: (ncy - M.oy) / M.s - ws.h / 2 };
              } else {
                // Container-frame conversion: world → container-local (M8 refines
                // to the kernel container-frame path once nested canvas lands).
                const hint = { x: g.x + wx - containerPos.x, y: g.y + wy - containerPos.y };
                slot = insertSlot(incumbents, ws, hint, CONSUME_GUTTER);
                // Later cards in a multi-drop see the earlier ones as occupied.
                incumbents.push({ x: slot.x, y: slot.y, w: ws.w, h: ws.h });
              }
              if (ctx.has(w, InsertGhost)) {
                const gh = ctx.read(w, InsertGhost);
                const props = parseGhostProps(gh.props ?? "");
                creates.push({
                  type: gh.type ?? "",
                  x: slot.x,
                  y: slot.y,
                  w: ws.w,
                  h: ws.h,
                  ...(props !== undefined ? { props } : {}),
                  parent: container,
                  select: true,
                });
                promotingGhosts.push(w);
                continue;
              }
              writes.push({ entity: w, component: Position, value: slot });
              reparents.push({ entity: w, container });
              // ⌥ at the drag's start leaves a copy where it lay on THIS desk even when the original goes in (2026-09-26 —
              // the recorded D4a × D2b design), in the consume's one transaction. The original has left this frame, so the
              // copy takes its lifted place, on top ("last"): `{ before: w }` would name a sibling that is no longer here.
              if (ctx.hasTag(rec, LeavesCopy)) {
                const copy = copyOf(ctx, w, g);
                if (copy !== undefined) creates.push({ ...copy, order: "last" });
              }
            }
            if (writes.length > 0 || creates.length > 0) {
              const accepted = sink.commit({
                kind: "consume",
                gesture: rec,
                writes,
                reparents,
                ...(creates.length > 0 ? { creates } : {}),
              });
              if (accepted === false) rejectCommit(ctx, dragged);
              else for (const ghost of promotingGhosts) ctx.addTag(ghost, GhostCommitted);
            }
          } else {
            // Plain move commit: final Position per live edge + the elevated
            // sibling placement as ORDER ops — one gesture, one transaction,
            // one undo step (petition 8). A tray-insert ghost becomes the
            // gesture's CREATE at its final position (the promote — design-001
            // §3): same single transaction, selected at projection.
            const writes: CommitWrite[] = [];
            const creates: CommitCreate[] = [];
            const promotingGhosts: Entity[] = [];
            for (const w of dragged) {
              if (!ctx.isAlive(w) || !ctx.has(w, Grab)) continue;
              const g = ctx.read(w, Grab);
              if (ctx.has(w, InsertGhost)) {
                const gh = ctx.read(w, InsertGhost);
                const props = parseGhostProps(gh.props ?? "");
                const ws = ctx.get(w, Size) ?? { w: 0, h: 0 };
                creates.push({
                  type: gh.type ?? "",
                  x: g.x + wx,
                  y: g.y + wy,
                  w: ws.w,
                  h: ws.h,
                  ...(props !== undefined ? { props } : {}),
                  select: true,
                });
                promotingGhosts.push(w);
                continue;
              }
              writes.push({ entity: w, component: Position, value: { x: g.x + wx, y: g.y + wy } });
              // ⌥ at the drag's start: a copy stays where it lay, just under it — in this one transaction (D4a)
              if (ctx.hasTag(rec, LeavesCopy)) {
                const copy = copyOf(ctx, w, g);
                if (copy !== undefined) creates.push(copy);
              }
            }
            if (writes.length > 0 || creates.length > 0) {
              const accepted = sink.commit({
                kind: creates.length > 0 && writes.length === 0 ? "create" : "move",
                gesture: rec,
                writes,
                orders: commitOrders(ctx, dragged),
                ...(creates.length > 0 ? { creates } : {}),
              });
              if (accepted === false) rejectCommit(ctx, dragged);
              else for (const ghost of promotingGhosts) ctx.addTag(ghost, GhostCommitted);
            }
          }
          clearGestureState(ctx, rec, dragged);
          continue;
        }

        if (ctx.hasTag(rec, P.justTags.Cancelled) || ctx.hasTag(rec, P.justTags.Failed)) {
          // Restore Position AND sibling order from Grab (design-003 §5.3),
          // then clean up. A tray-insert ghost has nothing to restore TO —
          // it flies home to the tray and retires (Escape / blur / integrity).
          for (const w of dragged) {
            if (!ctx.isAlive(w) || !ctx.has(w, Grab)) continue;
            if (ctx.has(w, InsertGhost)) {
              ghostFlyBack(ctx, w);
              continue;
            }
            const g = ctx.read(w, Grab);
            ctx.edit(w).set(Position, { x: g.x, y: g.y });
          }
          restoreOrder(ctx, dragged);
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
      access: { write: [Position], orderIndependent: [Position] },
    },
  );

  return { selectBehavior, moveBehavior };
}
