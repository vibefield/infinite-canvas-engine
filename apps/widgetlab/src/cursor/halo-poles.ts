/**
 * Halo → magnet-pole adapter — the REFERENCE PoleSource wiring (design-010
 * §7; vibe-field's `haloPoles()` is the same shape over its own `Cur`). The
 * ground pass never learns what a halo is: this adapter reads the app's
 * cursor vocabulary and hands the grid plain screen-space poles.
 *
 * Why the halo beats the raw pointer as the field driver:
 *  - `Cur` eases toward the pointer (FOLLOW_TAU), so the field trails with
 *    the same spring the visible cursor has — needle and halo move as one.
 *  - the morph scale already telegraphs ownership; the field inheriting it
 *    (full on free canvas → quiet over a card → ~zero at the DOT stop)
 *    REINFORCES the handoff instead of fighting it.
 *  - `easeSettle` stops writing once settled, so the observeQuery wake goes
 *    quiet ~100ms after motion ends — hover redraws self-terminate.
 */
import { defineQuery, type World } from "@ice/core";
import type { Pole, PoleSource } from "@ice/ground";
import { Cur, DOT_SCALE } from "./components";

const curQ = defineQuery([Cur]);

/** Morph scale → strength: 1 on free canvas, 0 at (and below) the DOT stop. */
function strengthFromScale(scale: number): number {
  return Math.min(Math.max((scale - DOT_SCALE) / (1 - DOT_SCALE), 0), 1);
}

export function haloPoles(): PoleSource {
  return {
    read(world: World) {
      const out: Pole[] = [];
      world.query(curQ).each((b) => {
        for (const r of b) {
          const c = world.read(b.entity(r), Cur);
          const strength = strengthFromScale(c.scale);
          if (strength <= 0) continue;
          out.push({ x: c.x, y: c.y, strength, space: "screen" });
        }
      });
      return out;
    },
    subscribe(world, wake) {
      return world.reactive.observeQuery(curQ, wake, { cols: [Cur] });
    },
  };
}
