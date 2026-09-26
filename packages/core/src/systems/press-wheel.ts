/**
 * THE WHEEL OF A HOLDING PRESS (design-015 §6's photo; D3t-a — PHOTO.md: "wheel while holding turns the print about the
 * finger"). While a local pointer's press holds a widget that declares `interaction.wheelTurns` (its `WheelTurns`
 * capability — a recognizer of the press captures it), the wheel on that pointer is the WIDGET's: this system stamps the
 * one-tick `WheelHandled` (both wheel consumers skip it — the camera never zooms under a carried print) and adds the tick's
 * deltas to the pointer's `PressWheel`, a running sum a reflector can still read after the tick, when `PointerWheel` has been
 * zeroed. The sum starts at the press's first wheel and leaves with the press. The head of `react`, beside the held input:
 * the ingest's facts are flushed by then and what this stamps flushes before `ctl`.
 */
import type { System, World } from "@vibecook/strata-ecs";
import { defineQuery, defineSystem } from "@vibecook/strata-ecs";
import { Captures, LocalPointer, Pointer, PointerButtons, PointerWheel, PressWheel, Watches, WheelHandled, WheelTurns } from "../catalog";

const pointersQ = defineQuery([Pointer, LocalPointer, PointerButtons]);

export function createPressWheel(world: World): System {
  return defineSystem(
    pointersQ,
    (b, ctx) => {
      for (const r of b) {
        const p = b.entity(r);
        let turns = false;
        if ((ctx.read(p, PointerButtons).buttons & 1) !== 0) {
          for (const rec of world.getReverse(p, Watches)) {
            const e = world.getRelation(rec, Captures);
            if (e !== undefined && ctx.isAlive(e) && ctx.hasTag(e, WheelTurns)) { turns = true; break; }
          }
        }
        const cur = ctx.get(p, PressWheel);
        if (!turns) { if (cur !== undefined) ctx.removeComponent(p, PressWheel); continue; }
        const w = ctx.get(p, PointerWheel);
        const dx = w?.dx ?? 0;
        const dy = w?.dy ?? 0;
        if (w !== undefined && (dx !== 0 || dy !== 0 || w.pinch !== 0) && !ctx.hasTag(p, WheelHandled)) ctx.addTag(p, WheelHandled);
        if (cur === undefined) ctx.addComponent(p, PressWheel, { dx, dy });
        else if (dx !== 0 || dy !== 0) ctx.edit(p).set(PressWheel, { dx: cur.dx + dx, dy: cur.dy + dy });
      }
    },
    { name: "pressWheel", access: { write: [PressWheel] } },
  );
}
