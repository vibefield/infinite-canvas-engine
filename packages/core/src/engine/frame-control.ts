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
 *
 * THE SLEEP (2026-09-27, ICE M21 K7a — design-015 §2.4 idle-zero, §11.4's
 * ≤ 0.1 ms of main thread a second at rest). A freeze is taken; a sleep is
 * FALLEN INTO: a host loop that opts in (`startRafLoop(…, { sleep: true })`,
 * the desk host's default) asks {@link FrameControl.nextStep} after every step
 * and stops scheduling frames once the engine is QUIET — no wake pending, no
 * registered wake due, no settle reporter busy, for {@link SLEEP_TAIL} steps
 * in a row (the tail lets a one-tick protocol — a cleared one-tick tag, a
 * reaped recognizer, a commit at `JustEnded` — finish without a reporter of
 * its own). Nothing is polled at rest: what can change the frame from outside
 * a step says so — the world's outside doors (engine.ts: a write made outside
 * a step), the input queue, the document's and the room's arrivals (the
 * facade), a desk's own flux and its assets (`wake`) — and what is next live at
 * a TIME says when (`wakeWhen`: a flight, a caret's blink, a layer let go,
 * midnight). A step a sleeping loop takes for a registered time alone is
 * {@link FrameControl.settled}: a host that polls its parts (the desk's kinds)
 * asks only the parts that are due. A wake taken INSIDE a step asks for one
 * more frame and restarts no tail (a kind's wanted frame is not an outside event).
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

/**
 * Quiet steps a sleeping loop takes after the last outside wake (or the last
 * busy step) before it sleeps (K7a): enough for the interaction stack's
 * one-tick protocols — a pointer's up processed, its recognizer ended, the
 * one-tick tags cleared and the recognizer reaped a tick later — to land
 * without each needing a reporter. Three steps ≈ 50 ms at 60 Hz, once per
 * outside event; a registered time's step takes none.
 */
export const SLEEP_TAIL = 3;

/** What the sleep has done since the control was made (the rigs' and the units' instrument). */
export interface SleepStats {
  /** The host loop sleeps now (no frame scheduled; a wake or a registered time restarts it). */
  readonly asleep: boolean;
  /** Times the loop fell asleep. */
  readonly sleeps: number;
  /** Outside wakes by reason (`world`, `input`, `doc`, `presence`, `desk:…`, …) — each call counted, asleep or not. */
  readonly wakes: Readonly<Record<string, number>>;
  /** Steps a registered time started (the loop's own timer, nothing else pending). */
  readonly timed: number;
  /** Steps since the control was made (entered through the engine's `step`). */
  readonly steps: number;
}

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
  /**
   * The park ANNOUNCED (petition I41) — for a host that must know the loop HAS parked (a cover's budget after it rises)
   * without polling {@link isParked} every page frame. `fn(true)` once the loop has parked after a freeze: when the settle
   * walk's last step ENDS (the frame the park leaves standing is drawn — `isParked()` turned true as that step was handed
   * out), or at the first claim the gate refuses where no step followed (the settle cap; a host that claims without
   * stepping). `fn(false)` once when the last thaw reopens a gate that announced its park — after `onChange`, so the loop
   * has restarted. Once per transition, never per frame; a freeze thawed before it parked announces nothing, and a second
   * freeze taken over a park changes nothing. Not replayed on subscribe (read `isParked()` for the state now). A throwing
   * listener is reported and contained — the announcement runs inside the loop's own step and claim. A separate door, not
   * a payload on `onChange`: that one fires at the HOLD's transitions, which the park's are not (a freeze's comes before
   * its settle walk), and its listeners — the loop's restart, the facade's gesture cancel — must not run a third time a
   * cycle. Returns an unsubscribe.
   */
  onParked(fn: (parked: boolean) => void): () => void;

  // ── the sleep (K7a) ────────────────────────────────────────────────────────
  /**
   * Something happened that the next frame must see — an input, a write from outside a step, a document's or a room's
   * arrival, an asset landing, a desk's flux: outside a step it restarts a sleeping loop and the tail; inside one it asks
   * for one more frame. Counted by `reason`.
   */
  wake(reason: string): void;
  /**
   * A REGISTERED WAKE: after every step the host asks each source when it is next due, on `performance.now()`'s clock —
   * at or before `now`: the next frame (it still moves); a later time: then (a sleeping loop sets a timer); `Infinity`:
   * never on its own (only a `wake` brings it back). Returns an idempotent unregister.
   */
  wakeWhen(name: string, due: (now: number) => number): () => void;
  /** The sources due at `now` or before (debug/devtools: "why is the loop awake?") — settle reporters busy included. */
  due(now: number): readonly string[];
  /**
   * For frame hosts, once after every step: when the next step must run — `≤ now`: the next frame; a later time: then;
   * `Infinity`: only on a wake. CONSUMING (it counts the quiet steps of the tail), never a predicate to poll.
   */
  nextStep(now: number): number;
  /** The host loop fell asleep (`true`) or woke (`false`, `timed`: for a registered time alone) — bookkeeping for the stats. */
  sleeping(asleep: boolean, timed?: boolean): void;
  /** A wake arrived while the host sleeps: restart here (the host loop's subscription). Returns an unsubscribe. */
  onWake(fn: () => void): () => void;
  /**
   * The step in progress began SETTLED — nothing pending, the tail long run: a sleeping loop's step for a registered time
   * alone (or a headless host's step with nothing new). A host that polls its parts asks only those that are due.
   */
  settled(): boolean;
  /** The engine's `step` entered and left (engine.ts): wakes inside a step ask for a frame, never a tail. */
  enterStep(): void;
  leaveStep(): void;
  /** Inside the engine's `step` right now. */
  stepping(): boolean;
  sleepStats(): SleepStats;
}

export function createFrameControl(world: World): FrameControl {
  const freezes = new Map<symbol, string>();
  const reporters = new Map<symbol, { readonly name: string; readonly busy: () => boolean }>();
  const listeners = new Set<() => void>();
  let settleLeft = 0;
  let parked = false;
  // the park announced (I41)
  const parkListeners = new Set<(parked: boolean) => void>();
  /** The park the listeners last heard — each transition announced once. */
  let heardParked = false;
  /** The claim that closed the gate handed out the settle walk's last step: that step's end announces the park. */
  let parkOwed = false;
  // the sleep (K7a)
  const sources = new Map<symbol, { readonly name: string; readonly due: (now: number) => number }>();
  const wakeListeners = new Set<() => void>();
  const wakeCounts: Record<string, number> = {};
  /** An outside wake since the step in progress (or the last one) began. */
  let pending = false;
  /** Quiet steps in a row (nothing pending, nothing due or busy at their end) — a sleeping loop sleeps at SLEEP_TAIL. */
  let quiet = 0;
  let inStep = false;
  let settledStep = false;
  let asleep = false;
  let sleeps = 0;
  let timed = 0;
  let steps = 0;

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
  // Copied (a listener may unsubscribe mid-announce) and CONTAINED: the park is announced inside the loop's own step and claim,
  // and a host's throw there must not take the loop down with it (petition I14, dom/loop.ts). A listener that thaws at the park
  // announces the reopening from inside this walk — the listeners not yet called hear only that, the state now, never a park
  // already over.
  const announcePark = (on: boolean): void => {
    if (heardParked === on) return;
    heardParked = on;
    for (const fn of [...parkListeners]) {
      if (heardParked !== on) return;
      try {
        fn(on);
      } catch (err) {
        console.error("[ice] frame.onParked — a listener threw; the gate stands", err);
      }
    }
  };

  const claim = (): boolean => {
    if (freezes.size === 0) return true;
    if (!parked && settleLeft <= 0) {
      // Cap reached with work still outstanding. Park anyway — a freeze that
      // never lands is worse than one that lands on a stale pixel — but name
      // the reporters, because this is always someone's bug.
      parked = true;
      if (devGuardsEnabled()) {
        console.warn(
          `ice: frame.freeze — settle cap (${SETTLE_CAP} frames) reached with reporters still busy: ${busyNames().join(", ")}. Parking on a possibly unsettled frame.`,
        );
      }
    }
    if (parked) {
      if (heardParked) return false;
      // A park no ended step has announced — the cap's, or a host that claims without stepping — is announced at its first
      // refusal. A listener may thaw right there (or thaw and freeze again): then this claim is the reopened gate's.
      parkOwed = false;
      announcePark(true);
      return parked ? false : claim();
    }
    settleLeft -= 1;
    // Quiet: this is the LAST step, taken so the settled state reflects — its end announces the park (leaveStep).
    if (busyNames().length === 0) {
      parked = true;
      parkOwed = true;
    }
    return true;
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
        const open = freezes.size === 0;
        if (open) {
          settleLeft = 0;
          parked = false;
          parkOwed = false;
        }
        sync();
        announce();
        // The gate reopened (the loop restarted in `announce`): a park the listeners heard is over.
        if (open) announcePark(false);
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

    claimStep: claim,

    onChange(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },

    onParked(fn) {
      parkListeners.add(fn);
      return () => {
        parkListeners.delete(fn);
      };
    },

    wake(reason) {
      // Inside a step a wake is the step's own consequence: the part that owes the next frame says so through its registered
      // wake or its settle reporter (a desk's dirt, a kind still moving) — never a tail per frame a kind asked for.
      if (inStep) return;
      wakeCounts[reason] = (wakeCounts[reason] ?? 0) + 1;
      pending = true;
      quiet = 0;
      if (asleep) for (const fn of [...wakeListeners]) fn();
    },

    wakeWhen(name, due) {
      const token = Symbol(name);
      sources.set(token, { name, due });
      let released = false;
      return () => {
        if (released) return;
        released = true;
        sources.delete(token);
      };
    },

    due(now) {
      const names = busyNames();
      for (const s of sources.values()) if (s.due(now) <= now) names.push(s.name);
      return names;
    },

    nextStep(now) {
      let busy = pending;
      let soonest = Number.POSITIVE_INFINITY;
      if (!busy) for (const r of reporters.values()) if (r.busy()) { busy = true; break; }
      if (!busy) {
        for (const s of sources.values()) {
          const t = s.due(now);
          if (t <= now) { busy = true; break; }
          if (t < soonest) soonest = t;
        }
      }
      if (busy) {
        quiet = 0;
        return now;
      }
      quiet += 1;
      return quiet < SLEEP_TAIL ? now : soonest;
    },

    sleeping(on, byTimer = false) {
      if (on === asleep) return;
      asleep = on;
      if (on) sleeps += 1;
      else if (byTimer) timed += 1;
    },

    onWake(fn) {
      wakeListeners.add(fn);
      return () => {
        wakeListeners.delete(fn);
      };
    },

    settled: () => settledStep,

    enterStep() {
      inStep = true;
      steps += 1;
      settledStep = !pending && quiet >= SLEEP_TAIL;
      pending = false;
    },

    leaveStep() {
      inStep = false;
      // The settle walk's last step has ended: the park is real — announce it.
      if (parkOwed) {
        parkOwed = false;
        announcePark(true);
      }
    },

    stepping: () => inStep,

    sleepStats: () => ({ asleep, sleeps, wakes: { ...wakeCounts }, timed, steps }),
  };
}
