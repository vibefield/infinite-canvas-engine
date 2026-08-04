/**
 * The frame gate (design-002 §1 amendment, 2026-08-04) — the frozen-world mode
 * design-005 §7 named and deliberately left unbuilt.
 *
 * Stage holds are PRESENTATION policy: `StageMode.backgroundHolds` freezes the
 * compositor on its retained textures while the world keeps stepping, which is
 * exactly what makes a hold safe under a PARTIAL overlay — a menu panel floats
 * over a still-live canvas, undo reflects, collab applies, tweens land. The
 * rev-2 decision recorded that a stricter mode "would be a SEPARATE concept".
 * This is that concept: while a freeze is held the host loop stops calling
 * `step` at all — no systems, no publish, no notify, no reflectors, no rAF
 * callback. It is for chrome that COVERS the canvas outright, where every
 * frame drawn behind it is work nobody can see.
 *
 * THE SETTLE — why a freeze does not park on the spot. Parking the instant a
 * freeze is taken would strand the canvas mid-churn: a cancelled gesture that
 * has not reached its commit tick, islands still owed a first paint, a
 * reflector holding a write that landed this frame. So a freeze walks the loop
 * to QUIET — every registered settle reporter idle — then takes ONE further
 * step so the quiet state itself reflects, and only then closes the gate. The
 * walk is bounded by {@link SETTLE_CAP}: a reporter that never goes quiet makes
 * a freeze park LATE, never never.
 *
 * Core stays scheduler-free (design-002 §1). This module owns no timer and
 * starts nothing — it answers {@link FrameControl.claimStep} and announces
 * transitions. The DOM package's rAF loop is what actually parks and restarts;
 * `engine.step(now)` itself stays callable by hand (headless hosts, traces),
 * because the gate governs the LOOP, not the primitive.
 */
import type { World } from "@vibecook/strata-ecs";
import { FrameMode } from "../catalog/camera-derived";
import { devGuardsEnabled } from "../guards/dev";

/**
 * Frames a freeze may spend walking to quiet before it parks regardless.
 * Two seconds at 60 Hz: comfortably longer than a cancelled gesture's path to
 * its commit tick or a cold board's first paints, short enough that a wedged
 * reporter reads as a hiccup rather than a hang.
 */
export const SETTLE_CAP = 120;

export interface FrameControl {
  /**
   * Take a named freeze. Returns an IDEMPOTENT thaw — the disposer pattern
   * that makes overlay lifecycles leak-proof (release on unmount), the name
   * that makes "why is the engine parked?" answerable. Refcounted: the loop
   * resumes when the LAST freeze thaws.
   */
  freeze(name: string): () => void;
  /** A freeze is held — the loop is settling or already parked. */
  isFrozen(): boolean;
  /** The settle finished and the gate closed: no further steps are being run. */
  isParked(): boolean;
  /** Live freeze names, in take order (debug/devtools). */
  holds(): readonly string[];
  /**
   * Register a settle reporter: while `busy()` is true, a taken freeze keeps
   * stepping instead of parking. This is how a subsystem that owes visible
   * work — the GL compositor's pending first paints, a gesture walking to its
   * commit — keeps a freeze from landing on a half-finished image. Returns an
   * idempotent unregister.
   */
  settleWhile(name: string, busy: () => boolean): () => void;
  /** Reporters answering busy right now ("why hasn't it parked yet?"). */
  settling(): readonly string[];
  /**
   * The loop gate. CONSUMING — each call advances the settle walk, so it is
   * for frame hosts only, never a predicate to poll. Use {@link isFrozen} /
   * {@link isParked} to ask questions.
   */
  claimStep(): boolean;
  /** Wake on any freeze/thaw transition (the host loop restarts here). */
  onChange(fn: () => void): () => void;
}

export function createFrameControl(world: World): FrameControl {
  const freezes = new Map<symbol, string>();
  const reporters = new Map<symbol, { readonly name: string; readonly busy: () => boolean }>();
  const listeners = new Set<() => void>();
  let settleLeft = 0;
  let parked = false;

  const sync = (): void => {
    world.setResource(FrameMode, { freezeHolds: freezes.size });
  };
  // Copy before iterating: a listener that thaws (and so unsubscribes) mid-
  // announce must not mutate the set being walked.
  const announce = (): void => {
    for (const fn of [...listeners]) fn();
  };
  const busyNames = (): string[] => {
    const names: string[] = [];
    for (const r of reporters.values()) if (r.busy()) names.push(r.name);
    return names;
  };

  return {
    freeze(name) {
      const token = Symbol(name);
      const first = freezes.size === 0;
      freezes.set(token, name);
      // Only the 0→1 transition arms a settle walk; a second freeze taken
      // while the engine is already parked changes nothing but the refcount.
      if (first) {
        settleLeft = SETTLE_CAP;
        parked = false;
      }
      sync();
      announce();
      let released = false;
      return () => {
        if (released) return; // idempotent — double-thaw must not eat another freeze
        released = true;
        freezes.delete(token);
        if (freezes.size === 0) {
          settleLeft = 0;
          parked = false;
        }
        sync();
        announce();
      };
    },

    isFrozen: () => freezes.size > 0,
    isParked: () => parked,
    holds: () => [...freezes.values()],

    settleWhile(name, busy) {
      const token = Symbol(name);
      reporters.set(token, { name, busy });
      let released = false;
      return () => {
        if (released) return;
        released = true;
        reporters.delete(token);
      };
    },

    settling: () => busyNames(),

    claimStep() {
      if (freezes.size === 0) return true;
      if (parked) return false;
      if (settleLeft <= 0) {
        // Cap reached with work still outstanding. Park anyway — a freeze that
        // never lands is worse than one that lands on a stale pixel — but name
        // the reporters, because this is always someone's bug.
        parked = true;
        if (devGuardsEnabled()) {
          console.warn(
            `ice: frame.freeze — settle cap (${SETTLE_CAP} frames) reached with reporters still busy: ${busyNames().join(", ")}. Parking on a possibly unsettled frame.`,
          );
        }
        return false;
      }
      settleLeft -= 1;
      // Quiet: this is the LAST step, taken so the settled state reflects.
      if (busyNames().length === 0) parked = true;
      return true;
    },

    onChange(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
