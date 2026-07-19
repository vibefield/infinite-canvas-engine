/**
 * ctl:claim — the rider settle point (design-003 §4.5).
 *
 * This sub-phase exists for exactly one reason: riders (`Grab`) and edges
 * (`Drags`) attached via `ctx` must be readable by the behaviors that consume
 * them ON THE CLAIM FRAME — without it, the first mutation lags a frame and a
 * claim-frame `read(w, Grab)` throws (design-003 review C1).
 *
 * `moveClaim` (JustActive × RoutedMove): select-on-grab, `Drags` edges over the
 * dragged set, `Grab` per widget with the CURRENT Position/Size + the ORDER
 * MEMO embedded (petition 8: ChildOf parent, nearest non-dragged predecessor
 * sibling, original sibling index), and the sibling elevate — `moveRelation(w,
 * ChildOf, "last")`, frame-scoped, equivalent to the old global-top within the
 * frame; part of the gesture divergence, restored from the memo on cancel.
 * Edge-less widgets (legacy/runtime world) skip both memo and elevate — the
 * move would be a strata no-op and there is no sequence to restore.
 *
 * `resizeClaim` (JustActive × RoutedResize): `Drags` + `Grab` over the Selected
 * ∧ Resizable set; the anchor lives on the captured handle's `HandleSpec` — no
 * extra state.
 *
 * Same-widget double-grab guard: a widget already in another recognizer's
 * `Drags` set is skipped (first gesture owns it) — two `ctx.addComponent(Grab)`
 * for one widget in one frame would hit strata's flush-time duplicate policy.
 */
import type { Entity, System, SystemCtx, World } from "@vibecook/strata-ecs";
import { defineQuery, defineSystem } from "@vibecook/strata-ecs";
import {
  Active,
  Captures,
  ChildOf,
  Culled,
  Drag,
  Drags,
  GesturePhases,
  Grab,
  MeasuredSize,
  Movable,
  NO_ENTITY,
  PointerMods,
  Position,
  Resizable,
  RoutedMove,
  RoutedResize,
  Selected,
  Size,
  SweepsContained,
  Watches,
} from "../catalog";
import { SelectionVersion, bumpVersion } from "../helpers/version-stamps";
import { selectedEntities } from "../ops/selection";

const P = GesturePhases;

const moveClaimQ = defineQuery([Drag, P.justTags.Active, RoutedMove]);
const resizeClaimQ = defineQuery([Drag, P.justTags.Active, RoutedResize]);
const sweepCandidatesQ = defineQuery([Position, Size, Movable]);

/**
 * Comment-box sweep (2026-07-18, James: the UE-Blueprint comment): expand the
 * dragged set with every widget FULLY INSIDE each SweepsContained member's
 * bounds at claim time. Spatial membership only — no reparenting, so dragging
 * a member out later is nothing at all. Frame-scoped via the canonical
 * non-member signature (Culled ∧ ¬Active — bare test worlds have no tags, so
 * requiring Active would break them; the wires-scope lesson 2026-07-17):
 * folder innards live in frame-local coords that can NUMERICALLY overlap a
 * root comment's rect and must never be swept across frames. Nested comments
 * need no recursion: inner ⊆ outer ⇒ the inner's members are inside the
 * outer's bounds already.
 */
function expandSweep(world: World, ctx: SystemCtx, dragged: Entity[]): void {
  const roots = dragged.filter((w) => ctx.isAlive(w) && ctx.hasTag(w, SweepsContained));
  if (roots.length === 0) return;
  const inSet = new Set(dragged);
  for (const root of roots) {
    const rp = ctx.get(root, Position);
    const rs = ctx.get(root, Size);
    if (rp === undefined || rs === undefined) continue;
    world.query(sweepCandidatesQ).each((b) => {
      for (const r of b) {
        const w = b.entity(r);
        if (inSet.has(w)) continue;
        if (world.hasTag(w, Culled) && !world.hasTag(w, Active)) continue; // other frame
        const p = world.get(w, Position);
        const m = world.get(w, MeasuredSize);
        const s = m !== undefined && m.w > 0 ? m : world.get(w, Size);
        if (p === undefined || s === undefined) continue;
        if (p.x >= rp.x && p.y >= rp.y && p.x + s.w <= rp.x + rs.w && p.y + s.h <= rp.y + rs.h) {
          inSet.add(w);
          dragged.push(w);
        }
      }
    });
  }
}

/**
 * Attach the drag riders for one widget; returns false if another gesture owns
 * it. `Grab` embeds the ORDER MEMO (petition 8): the widget's ChildOf parent,
 * its nearest predecessor sibling that is NOT itself mid-drag (`taken` covers
 * this pass's claims, a live `Grab` covers earlier frames' — both sit at "last"
 * and are unstable anchors; a predecessor dragged by THIS gesture is fine, the
 * restore walk reinserts in `ord` order so it is back in place when consulted),
 * and the original sibling index. The memo reads the PRE-FLUSH sequence — ctx
 * structure is deferred, so capture and the enqueued elevates never interleave.
 */
function attachRiders(ctx: SystemCtx, recognizer: Entity, widget: Entity, taken: Set<Entity>): boolean {
  if (taken.has(widget)) return false;
  const otherOwner = ctx
    .getReverse(widget, Drags)
    .some((rec) => rec !== recognizer);
  if (otherOwner) return false;
  taken.add(widget);
  const pos = ctx.read(widget, Position);
  const size = ctx.get(widget, Size);
  const parent = ctx.getRelation(widget, ChildOf);
  let prev: Entity = NO_ENTITY;
  let ord = 0;
  if (parent !== undefined) {
    const siblings = ctx.getReverse(parent, ChildOf);
    const at = siblings.indexOf(widget);
    ord = at >= 0 ? at : 0;
    for (let i = at - 1; i >= 0; i--) {
      const sib = siblings[i] as Entity;
      if (!taken.has(sib) && !ctx.has(sib, Grab)) {
        prev = sib;
        break;
      }
    }
  }
  ctx.addRelation(recognizer, Drags, widget);
  ctx.addComponent(widget, Grab, {
    x: pos.x,
    y: pos.y,
    w: size?.w ?? 0,
    h: size?.h ?? 0,
    parent: parent ?? NO_ENTITY,
    prev,
    ord,
  });
  return true;
}

export function createClaimSystems(world: World): { moveClaim: System; resizeClaim: System } {
  const moveClaim = defineSystem(
    moveClaimQ,
    (b, ctx) => {
      // Shared across recognizers in this pass — first gesture owns a widget.
      const taken = new Set<Entity>();
      for (const r of b) {
        const rec = b.entity(r);
        const grabbed = ctx.getRelation(rec, Captures);
        if (grabbed === undefined || !ctx.has(grabbed, Position)) continue;

        // Select-on-grab (design-003 §4.5). Selection tags flip via ctx (deferred),
        // so the dragged set is computed HERE, not re-queried. Modifiers come
        // from the pointer's latched sample (Keyboard only carries key events).
        const pointer = ctx.getRelations(rec, Watches)[0];
        const shift = pointer !== undefined && ctx.get(pointer, PointerMods)?.shift === true;
        const current = selectedEntities(world);
        let dragged: Entity[];
        if (ctx.hasTag(grabbed, Selected)) {
          dragged = current;
        } else if (shift) {
          ctx.addTag(grabbed, Selected);
          bumpVersion(world, SelectionVersion);
          dragged = [...current, grabbed];
        } else {
          for (const s of current) ctx.removeTag(s, Selected);
          ctx.addTag(grabbed, Selected);
          bumpVersion(world, SelectionVersion);
          dragged = [grabbed];
        }

        // Comment-box sweep BEFORE riders: swept members ride the same
        // recognizer; rider order keeps the comment BELOW its members in the
        // elevate (comment first, members after — each successive "last"
        // lands ABOVE the previous one).
        expandSweep(world, ctx, dragged);

        for (const w of dragged) {
          if (!ctx.isAlive(w) || !ctx.has(w, Position)) continue;
          if (w !== grabbed && !ctx.hasTag(w, Movable)) continue;
          if (!attachRiders(ctx, rec, w, taken)) continue;
          // Sibling elevate (petition 8): an immediate structural move —
          // gesture divergence; the Grab memo restores on cancel/fly-back.
          // Frame-scoped "last" = the old global-top within the frame. No
          // edge (legacy/runtime world) ⇒ strata no-op, skipped.
          if (ctx.getRelation(w, ChildOf) !== undefined) {
            ctx.moveRelation(w, ChildOf, "last");
          }
        }
      }
    },
    { name: "moveClaim" },
  );

  const resizeClaim = defineSystem(
    resizeClaimQ,
    (b, ctx) => {
      const taken = new Set<Entity>();
      for (const r of b) {
        const rec = b.entity(r);
        // Anchor = the captured handle's HandleSpec (read by resizeBehavior).
        for (const w of selectedEntities(world)) {
          if (!ctx.isAlive(w) || !ctx.hasTag(w, Resizable) || !ctx.has(w, Position)) continue;
          attachRiders(ctx, rec, w, taken);
        }
      }
    },
    { name: "resizeClaim" },
  );

  return { moveClaim, resizeClaim };
}
