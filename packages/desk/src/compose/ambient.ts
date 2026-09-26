// The AMBIENT — the mat's clocks and the gobo's tilt follower, and the policy that lets a quiet
// desk go still (design-015 §4.6, D-D9): the wind is a clock, and a clock is a frame, so a breeze
// that never stops is a desk that never idles. Three modes: `live` — the prototype's default,
// the wind at the display rate forever; `idle` (the default) — the wind, the grain's drift, the
// blue noise's re-roll and the tilt run while the pointer moved or a gesture or flight ran within
// `idleMs`, then the wind's SPEED eases to zero over `settleMs` (the leaves slow and stop) and the
// desk idles at ZERO submits; `still` — no wind, no tilt, ever (reduced motion ⇒ still). A parity
// still PINS the clocks (`pin`): the frame is the scene's, the tilt bypassed, the noise fixed.
//
// The ease is on the clock's RATE, not in the shader (D-D2a-world.2): the wind pass and every
// WGSL stay as the oracle pinned them, so a still frame at any goboTime is the oracle's frame.
// Pure: a fake clock and a fake random drive it in the tests; the host hands it `now` and dt.

import { smoothstep } from "../lattice/lod";
import { HERO_MATRIX, type MatFrame } from "../mat/layout";
import { tilted } from "../mat/projector";
import { type SecondOrder, secondOrder, stepSecondOrder } from "../mat/tilt";
import { MAT_GRID } from "../theme";

export type AmbientMode = "live" | "idle" | "still";

export interface AmbientOptions {
  /** `idle` by default (design-015 D-D9). */
  readonly mode?: AmbientMode;
  /** How long after the last touch the wind keeps blowing, ms (20 000). */
  readonly idleMs?: number;
  /** How long the wind takes to ease to still once idle, ms (2 000). */
  readonly settleMs?: number;
  /** Seconds of gobo time per second at full speed (theme.ts `MAT_GRID.gobo.wind`). */
  readonly wind?: number;
  /** Radians of projector tilt per unit of smoothed pointer NDC (theme.ts `MAT_GRID.gobo.tilt`). */
  readonly tilt?: number;
  /** The OS asked for reduced motion: the mode is `still` whatever was set. */
  readonly reducedMotion?: boolean;
  /** The blue noise's re-roll (Math.random); a test's fake. */
  readonly random?: () => number;
}

export type AmbientPhase = "live" | "easing" | "still" | "pinned";

export interface AmbientState {
  readonly mode: AmbientMode;
  readonly phase: AmbientPhase;
  /** The wind's speed, 0 … 1 of full. */
  readonly speed: number;
  readonly reducedMotion: boolean;
  readonly pinned: boolean;
}

/** A pinned still's clocks (a parity scene): whatever is absent keeps the engine's still values. */
export interface AmbientPin {
  readonly time?: number;
  readonly goboTime?: number;
  readonly noise?: readonly [number, number];
}

export interface Ambient {
  /** The pointer moved, a gesture or a flight ran: the wind (re)starts its `idleMs`. */
  touch(now: number): void;
  /** Advance the clocks by `dt` seconds at `now` ms, the tilt following `pointer` (NDC, or null before the pointer was seen); `live` = another frame is wanted. */
  step(dt: number, now: number, pointer: readonly [number, number] | null): { readonly frame: MatFrame; readonly live: boolean };
  /** The frame as the clocks stand, NOT advanced (the pinned one while pinned) — the desk behind the hand stands still (§8, D7). */
  frame(): MatFrame;
  /** Pin the clocks (a still) or unpin (`null`). Pinned, `step` returns the pinned frame and wants no frame. */
  pin(frame: AmbientPin | null): void;
  configure(opts: Pick<AmbientOptions, "mode" | "idleMs" | "settleMs" | "reducedMotion">): void;
  state(): AmbientState;
  /** The clocks as they stand (a rig's witness). */
  clocks(): { readonly time: number; readonly goboTime: number };
}

export const AMBIENT_DEFAULTS = { mode: "idle" as AmbientMode, idleMs: 20_000, settleMs: 2_000 } as const;

export function createAmbient(opts: AmbientOptions = {}): Ambient {
  let mode: AmbientMode = opts.mode ?? AMBIENT_DEFAULTS.mode;
  let idleMs = opts.idleMs ?? AMBIENT_DEFAULTS.idleMs;
  let settleMs = opts.settleMs ?? AMBIENT_DEFAULTS.settleMs;
  let reducedMotion = opts.reducedMotion ?? false;
  const wind = opts.wind ?? MAT_GRID.gobo.wind;
  const tiltStrength = opts.tilt ?? MAT_GRID.gobo.tilt;
  const random = opts.random ?? Math.random;
  const tilt: SecondOrder = secondOrder();
  let time = 0;
  let goboTime = 0;
  let noise: readonly [number, number] = [0, 0];
  let goboMatrix = HERO_MATRIX;
  let touchedAt = Number.NEGATIVE_INFINITY;
  let pinned: AmbientPin | null = null;
  let speed = 0;
  let phase: AmbientPhase = "still";

  const effectiveMode = (): AmbientMode => (reducedMotion ? "still" : mode);
  /** The wind's speed at `now` under the policy: 1 within the idle window, easing to 0 over the settle, 0 past it. */
  const speedAt = (now: number): number => {
    const m = effectiveMode();
    if (m === "still") return 0;
    if (m === "live") return 1;
    const since = now - touchedAt;
    if (since <= idleMs) return 1;
    return 1 - smoothstep(0, settleMs, since - idleMs);
  };

  const pinnedFrame = (p: AmbientPin): MatFrame => ({ time: p.time ?? 0, goboTime: p.goboTime ?? 0, goboMatrix: HERO_MATRIX, noise: p.noise ?? [0, 0] });

  return {
    touch(now) { touchedAt = now; },
    step(dt, now, pointer) {
      if (pinned !== null) {
        phase = "pinned";
        speed = 0;
        return { frame: pinnedFrame(pinned), live: false };
      }
      speed = speedAt(now);
      let tiltLive = false;
      if (effectiveMode() === "still") {
        tilt.target = [0, 0]; tilt.prevTarget = [0, 0]; tilt.value = [0, 0]; tilt.velocity = [0, 0];
        goboMatrix = HERO_MATRIX;
      } else {
        // the tilt follows the live pointer through the second-order filter (before it was seen, untilted); it settles on its own
        tilt.target = pointer === null ? [0, 0] : [Math.min(Math.max(pointer[0], -1), 1), Math.min(Math.max(pointer[1], -1), 1)];
        stepSecondOrder(tilt, dt);
        const v = tilt.velocity;
        goboMatrix = tilted(HERO_MATRIX, tilt.value[0] * tiltStrength, tilt.value[1] * tiltStrength, (v[0] + v[1]) * 0.35 * tiltStrength);
        tiltLive = Math.abs(tilt.value[0] - tilt.target[0]) + Math.abs(tilt.value[1] - tilt.target[1]) + Math.abs(v[0]) + Math.abs(v[1]) > 1e-4;
        // The follower is part of the wind's clock: once the wind has eased to STILL (idle, past idleMs + settleMs — the
        // pointer has not moved for that long), the filter's tail is not a reason for a frame (ζ = 0.3 rings for seconds
        // under 1e-4 — B7's trap on the tilt): it SNAPS to its target and the desk idles at zero submits (§4.6, D-D9).
        if (speed <= 0 && tiltLive) {
          tilt.value = [tilt.target[0], tilt.target[1]]; tilt.velocity = [0, 0];
          goboMatrix = tilted(HERO_MATRIX, tilt.value[0] * tiltStrength, tilt.value[1] * tiltStrength, 0);
          tiltLive = false;
        }
      }
      if (speed > 0) {
        // the prototype's clocks at the wind's speed: the grain drifts, the gobo blows (a touch faster as the tilt swings), the noise re-rolls
        time += dt * speed;
        goboTime += dt * (wind + (tilt.velocity[0] + tilt.velocity[1]) * 0.5) * speed;
        noise = [random(), random()];
      }
      phase = speed >= 1 ? "live" : speed > 0 ? "easing" : "still";
      return { frame: { time, goboTime, goboMatrix, noise }, live: speed > 0 || tiltLive };
    },
    frame: () => (pinned !== null ? pinnedFrame(pinned) : { time, goboTime, goboMatrix, noise }),
    pin(frame) { pinned = frame; },
    configure(o) {
      if (o.mode !== undefined) mode = o.mode;
      if (o.idleMs !== undefined) idleMs = o.idleMs;
      if (o.settleMs !== undefined) settleMs = o.settleMs;
      if (o.reducedMotion !== undefined) reducedMotion = o.reducedMotion;
    },
    state: () => ({ mode, phase, speed, reducedMotion, pinned: pinned !== null }),
    clocks: () => ({ time, goboTime }),
  };
}
