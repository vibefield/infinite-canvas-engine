/**
 * cleanup phase — nothing transient crosses frames (design-002 §2; design-003
 * §4.1 reap, §8 CancelRequest one-tick rule).
 *
 * `recognizerReap` destroys terminal recognizers at terminal +1 frame: a Just*
 * marker means the transition happened THIS tick (markers clear later this
 * phase, but ctx reads are pre-flush) — no marker means the tag has lingered a
 * full frame and every edge-triggered consumer has run. `ClaimedBy`/`Watches`/
 * `Captures`/`Drags` edges auto-clear with the despawn.
 *
 * `oneTickClear` then clears pointer transition tags, zeroes wheel deltas,
 * clears all Just* markers, and consumes CancelRequest (a latched cancel would
 * kill every future gesture forever).
 */
import { Any, defineQuery, defineSystem, type System, type World } from "@vibecook/strata-ecs";
import {
  CancelRequest,
  Drag,
  GesturePhases,
  HandledByWidget,
  LongPress,
  Pinch,
  Pointer,
  PointerWheel,
  Tap,
  WentCancelled,
  WentDown,
  WentUp,
  WheelPan,
  WheelZoom,
} from "../catalog";

const P = GesturePhases;

const anyKindQ = defineQuery([Any(Tap, LongPress, Drag, Pinch, WheelPan, WheelZoom)]);
const pointerQ = defineQuery([Pointer, PointerWheel]);

export function createCleanupSystems(world: World): { recognizerReap: System; oneTickClear: System } {
  const recognizerReap = defineSystem(
    anyKindQ,
    (b, ctx) => {
      for (const r of b) {
        const e = b.entity(r);
        const terminal =
          ctx.hasTag(e, P.tags.Failed) ||
          ctx.hasTag(e, P.tags.Cancelled) ||
          ctx.hasTag(e, P.tags.Ended) ||
          (ctx.hasTag(e, P.tags.Recognized) && ctx.has(e, Tap)); // Recognized is terminal for Tap only
        if (!terminal) continue;
        const transitionedThisTick =
          ctx.hasTag(e, P.justTags.Failed) ||
          ctx.hasTag(e, P.justTags.Cancelled) ||
          ctx.hasTag(e, P.justTags.Ended) ||
          ctx.hasTag(e, P.justTags.Recognized);
        if (!transitionedThisTick) ctx.destroy(e); // terminal + 1 frame
      }
    },
    { name: "recognizerReap" },
  );

  const oneTickClear = defineSystem(
    pointerQ,
    (b, ctx) => {
      for (const r of b) {
        const e = b.entity(r);
        if (ctx.hasTag(e, WentDown)) ctx.removeTag(e, WentDown);
        if (ctx.hasTag(e, WentUp)) ctx.removeTag(e, WentUp);
        if (ctx.hasTag(e, WentCancelled)) ctx.removeTag(e, WentCancelled);
        if (ctx.hasTag(e, HandledByWidget)) ctx.removeTag(e, HandledByWidget);
        const w = ctx.read(e, PointerWheel);
        if (w.dx !== 0 || w.dy !== 0 || w.pinch !== 0) {
          ctx.edit(e).set(PointerWheel, { dx: 0, dy: 0, pinch: 0 });
        }
      }
      // Recognizer markers (reap above already consumed them pre-flush).
      world.query(anyKindQ).each((rb) => {
        for (const rr of rb) P.clearMarkers(ctx, rb.entity(rr));
      });
      // Consume the one-tick cancel request.
      if (ctx.getResource(CancelRequest)?.active === true) {
        world.setResource(CancelRequest, { active: false });
      }
    },
    { name: "oneTickClear", access: { write: [PointerWheel] } },
  );

  return { recognizerReap, oneTickClear };
}
