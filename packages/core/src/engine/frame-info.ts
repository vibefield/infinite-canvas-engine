/**
 * FrameInfo — the pre-tick frame clock (design-002 §1).
 *
 * Written by `engine.step()` BEFORE `world.sync()` every frame (a plain resource
 * value write, legal outside the tick). Systems read it via `ctx.getResource` —
 * time-based systems are correct by construction (F1: tick-by-default), and dt
 * clamps at `CAMERA_DEFAULTS.dtClampMs` so a background-tab hiccup never turns
 * into a teleport (design-002 §1: "dt clamps at 64 ms").
 */
import { field } from "@vibecook/strata-ecs";
import type { World } from "@vibecook/strata-ecs";
import { defineResource } from "../schema/meta";
import { CAMERA_DEFAULTS } from "../settings/defaults";

/** { tick, dt ≤ dtClampMs (ms), now (ms timeline of the caller's clock) }. */
export const FrameInfo = defineResource("FrameInfo", {
  tick: field("u32", { default: 0 }),
  dt: field("f32", { default: 0 }),
  now: field("f64", { default: 0 }),
});

/**
 * Advance the frame clock. First frame gets dt 0 (no previous `now` to diff
 * against); negative deltas (clock adjustment) clamp to 0.
 */
export function setFrameInfo(world: World, now: number): void {
  const prev = world.getResource(FrameInfo);
  const dt =
    prev === undefined ? 0 : Math.min(Math.max(now - prev.now, 0), CAMERA_DEFAULTS.dtClampMs);
  world.setResource(FrameInfo, { tick: (prev?.tick ?? 0) + 1, dt, now });
}
