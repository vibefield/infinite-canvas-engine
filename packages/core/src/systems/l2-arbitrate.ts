/**
 * L2 — arbitration + routing (design-003 §4.3–§4.4; `ctl:arbitrate`).
 *
 * Arbitration rule (v2-proven, generalized): the first recognizer to enter a
 * claiming phase (`Active` for continuous, `Recognized` for discrete) claims
 * every pointer it watches; same-frame ties resolve by priority
 * Pinch > Drag > LongPress > Tap; every other non-terminal, non-`Simultaneous`,
 * non-suspended recognizer watching a claimed pointer → `Failed`. The claim is
 * world state: `ClaimedBy(pointer → recognizer)` (Law 4). DEV asserts at most
 * one ClaimedBy write per pointer per pass (`setRelation` is silent last-wins —
 * a mis-ordered arbitration would otherwise be undetectable).
 *
 * `dragRoute` — the ONE pan/marquee/move decision, latched at Drag activation
 * via route tags; the route never changes mid-gesture (design-003 §4.4).
 */
import type { Entity, System, SystemCtx } from "@vibecook/strata-ecs";
import { Any, Not, defineQuery, defineSystem } from "@vibecook/strata-ecs";
import {
  CanvasSurface,
  Captures,
  ClaimedBy,
  Drag,
  GesturePhases,
  GestureSuspended,
  HandleSpec,
  Keyboard,
  LongPress,
  Pinch,
  Pointer,
  PointerButtons,
  Port,
  Position,
  RoutedConnect,
  RoutedMarquee,
  RoutedMove,
  RoutedPan,
  RoutedResize,
  Simultaneous,
  Tap,
  Watches,
  WheelPan,
  WheelZoom,
} from "../catalog";
import { ActiveTool } from "../catalog/camera-derived";
import { devGuardsEnabled } from "../guards/dev";

const P = GesturePhases;

const claimCandidateQ = defineQuery([
  Any(Tap, LongPress, Drag, Pinch),
  Not(Simultaneous),
  Not(GestureSuspended),
]);

const justActiveDragQ = defineQuery([Drag, P.justTags.Active]);

function isTerminal(ctx: SystemCtx, e: Entity): boolean {
  if (ctx.hasTag(e, P.tags.Failed) || ctx.hasTag(e, P.tags.Cancelled) || ctx.hasTag(e, P.tags.Ended)) {
    return true;
  }
  return ctx.hasTag(e, P.tags.Recognized) && ctx.has(e, Tap);
}

/** Same-frame tie priority (design-003 §4.3). Higher wins. */
function priorityOf(ctx: SystemCtx, e: Entity): number {
  if (ctx.has(e, Pinch)) return 4;
  if (ctx.has(e, Drag)) return 3;
  if (ctx.has(e, LongPress)) return 2;
  return 1; // Tap
}

export function createArbitrationSystems(): { arbitration: System; dragRoute: System } {
  const arbitration = defineSystem(
    claimCandidateQ,
    (b, ctx) => {
      // Collect this frame's claimants: recognizers that JUST entered a claiming phase.
      const bestByPointer = new Map<Entity, Entity>();
      for (const r of b) {
        const e = b.entity(r);
        const claiming =
          ctx.hasTag(e, P.justTags.Active) || ctx.hasTag(e, P.justTags.Recognized);
        if (!claiming) continue;
        for (const pointer of ctx.getRelations(e, Watches)) {
          // First-wins across frames: an existing live claim stands.
          const existing = ctx.getRelation(pointer, ClaimedBy);
          if (existing !== undefined && !isTerminal(ctx, existing)) continue;
          const incumbent = bestByPointer.get(pointer);
          if (incumbent === undefined || priorityOf(ctx, e) > priorityOf(ctx, incumbent)) {
            bestByPointer.set(pointer, e);
          }
        }
      }

      const written = devGuardsEnabled() ? new Set<Entity>() : null;
      for (const [pointer, winner] of bestByPointer) {
        if (written !== null) {
          if (written.has(pointer)) {
            throw new Error("ice: arbitration wrote ClaimedBy twice for one pointer in one pass.");
          }
          written.add(pointer);
        }
        ctx.setRelation(pointer, ClaimedBy, winner);
        // Fail every other live competitor watching this pointer.
        for (const rec of ctx.getReverse(pointer, Watches)) {
          if (rec === winner) continue;
          if (isTerminal(ctx, rec)) continue;
          if (ctx.hasTag(rec, Simultaneous) || ctx.hasTag(rec, GestureSuspended)) continue;
          P.set(ctx, rec, "Failed");
        }
      }
    },
    { name: "arbitration" },
  );

  const dragRoute = defineSystem(
    justActiveDragQ,
    (b, ctx) => {
      const tool = ctx.getResource(ActiveTool)?.id ?? "select";
      const spaceHeld = ctx.getResource(Keyboard)?.space === true;
      for (const r of b) {
        const e = b.entity(r);
        const captured = ctx.getRelation(e, Captures);

        if (captured !== undefined && ctx.has(captured, HandleSpec)) {
          ctx.addTag(e, RoutedResize);
          continue;
        }
        if (captured !== undefined && ctx.has(captured, Port)) {
          ctx.addTag(e, RoutedConnect); // materializes at M8 (no ports exist before then)
          continue;
        }
        const onCanvas = captured === undefined || ctx.hasTag(captured, CanvasSurface);
        if (!onCanvas && ctx.has(captured, Position)) {
          ctx.addTag(e, RoutedMove);
          continue;
        }

        // Canvas capture: pan vs marquee (design-003 §4.4).
        const pointer = ctx.getRelations(e, Watches)[0];
        const middleButton =
          pointer !== undefined && (ctx.read(pointer, PointerButtons).buttons & 4) !== 0;
        const touch = pointer !== undefined && ctx.read(pointer, Pointer).device === "touch";
        if (tool === "pan" || spaceHeld || middleButton || touch) {
          ctx.addTag(e, RoutedPan); // one-finger touch pans (Freeform default)
        } else {
          ctx.addTag(e, RoutedMarquee);
        }
      }
    },
    { name: "dragRoute" },
  );

  return { arbitration, dragRoute };
}

/** Wheel recognizers never claim; exported so tests can assert the invariant set. */
export const NEVER_CLAIMS = [WheelPan, WheelZoom] as const;
