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
import type { Entity, System, SystemCtx, Tag } from "@vibecook/strata-ecs";
import { Any, Not, defineQuery, defineSystem } from "@vibecook/strata-ecs";
import {
  CanvasSurface,
  Captures,
  ClaimedBy,
  Drag,
  GesturePhases,
  GestureSuspended,
  HadRequiresFail,
  HadSequence,
  HandleSpec,
  Keyboard,
  LongPress,
  Movable,
  Pinch,
  Pointer,
  PointerButtons,
  Port,
  Position,
  RoutedConnect,
  RoutedDraw,
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
import { tools } from "../tools/define-tool";

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
          // Edge-parked Pending recognizers are the dependency system's to
          // resolve. v2 resolved them same-tick BEFORE arbitration (immediate
          // writes); v3's flush model runs dependency a frame behind the
          // source's claim, so arbitration must not race it — the dependency
          // verdict lands next frame either way. (Multi-tap Pendings carry no
          // edge and stay killable — tap-then-drag fails the pending tap.)
          if (
            ctx.hasTag(rec, P.tags.Pending) &&
            (ctx.hasTag(rec, HadSequence) || ctx.hasTag(rec, HadRequiresFail))
          ) {
            continue;
          }
          P.set(ctx, rec, "Failed");
        }
      }
    },
    { name: "arbitration" },
  );

  const dragRoute = defineSystem(
    justActiveDragQ,
    (b, ctx) => {
      // Tool ROUTE POLICY (design-005 §3, mechanized at M10): the active
      // tool's config decides canvas/widget/port drag routes; unknown ids
      // resolve to select semantics (tools.resolve). Device conventions
      // (space / middle / one-finger touch → pan) sit ABOVE tool policy.
      const tool = tools.resolve(ctx.getResource(ActiveTool)?.id ?? "select");
      const spaceHeld = ctx.getResource(Keyboard)?.space === true;
      const routeTag = (route: string): Tag | undefined => {
        switch (route) {
          case "marquee":
            return RoutedMarquee;
          case "pan":
            return RoutedPan;
          case "connect":
            return RoutedConnect;
          case "move":
            return RoutedMove;
          case "draw":
            return RoutedDraw;
          default:
            return undefined; // "none": claim the pointer, drive no behavior
        }
      };
      for (const r of b) {
        const e = b.entity(r);
        const captured = ctx.getRelation(e, Captures);

        if (captured !== undefined && ctx.has(captured, HandleSpec)) {
          // Resize gate (design-005 §3): a gating tool suppresses the handle
          // grab entirely — the claim still holds the pointer.
          if (tool.gates.resizable) ctx.addTag(e, RoutedResize);
          continue;
        }
        // Port captures route BEFORE the Movable gate (design-003 §4.4, M8):
        // a port-down on a movable widget starts a connect, not a move — and
        // pickTopAt's port tier returns the port even when the pointer sat on
        // the widget body.
        if (captured !== undefined && ctx.has(captured, Port)) {
          const t = routeTag(tool.route.portDrag);
          if (t !== undefined) ctx.addTag(e, t);
          continue;
        }
        const onCanvas = captured === undefined || ctx.hasTag(captured, CanvasSurface);
        if (!onCanvas && ctx.has(captured, Position)) {
          // Widget capture. "move" additionally requires the Movable
          // capability AND the tool's movable gate (review finding: a
          // non-movable widget's drag claims the pointer — no pan-through —
          // but drives no behavior).
          const route = tool.route.widgetDrag;
          if (route === "move") {
            if (tool.gates.movable && ctx.hasTag(captured, Movable)) ctx.addTag(e, RoutedMove);
          } else {
            const t = routeTag(route);
            if (t !== undefined) ctx.addTag(e, t);
          }
          continue;
        }

        // Canvas capture: device pan conventions first, then tool policy.
        const pointer = ctx.getRelations(e, Watches)[0];
        const middleButton =
          pointer !== undefined && (ctx.read(pointer, PointerButtons).buttons & 4) !== 0;
        const touch = pointer !== undefined && ctx.read(pointer, Pointer).device === "touch";
        if (spaceHeld || middleButton || touch) {
          ctx.addTag(e, RoutedPan); // one-finger touch pans (Freeform default)
        } else {
          const t = routeTag(tool.route.canvasDrag);
          if (t !== undefined) ctx.addTag(e, t);
        }
      }
    },
    { name: "dragRoute" },
  );

  return { arbitration, dragRoute };
}

/** Wheel recognizers never claim; exported so tests can assert the invariant set. */
export const NEVER_CLAIMS = [WheelPan, WheelZoom] as const;
