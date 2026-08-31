/**
 * Lift and fade as PER-QUAD GPU FACTS (design-012 §2 consequence 2, §7, plan
 * §5 S6.1).
 *
 * What retires here is not an effect but a duplication. In the stratified
 * model a picked-up card lifts twice: the DOM host runs a CSS transition in
 * P3, and a GL widget's quad runs an engine-side ease in P2 — two
 * implementations of one visual, kept in step by hand, which is why
 * design-004 §3 carries a standing "animation lockstep" problem class. With
 * one pass there is one ease, and both kinds read it from `@ice/kernel/lift`.
 *
 * ── The scale is geometry, not a shader ───────────────────────────────────
 * A lift scales the card about its CENTRE, and a quad's destination rect is
 * already computed per frame — so the lift is applied by expanding that rect,
 * on the CPU, and the WGSL never learns the word. That is not a shortcut: a
 * scale uniform would have to be undone in the SDF's local coordinates to keep
 * the corner radius from scaling with it, and expanding the rect keeps the
 * radius in device px where the analytic AA already expects it.
 *
 * ── Retarget from the DRAWN value ─────────────────────────────────────────
 * A card dropped mid-lift must ease back from where it visibly IS, not from
 * where the previous ease started. Every retarget therefore captures the
 * current eased value as its new `from` — the same rule r3f's
 * `setCompositeScale` follows, and the reason an interrupted gesture does not
 * jump.
 *
 * ── Why it must keep the compositor awake ─────────────────────────────────
 * An ease is presentation dirt with no ECS stamp behind it: `Grab` is written
 * once at pickup, and the 180 ms of animation that follows changes no cell at
 * all. `advance()` reporting "still animating" is what the reflector re-marks
 * on, exactly as it re-marks on owed copies. Without it a lift renders one
 * frame and freezes at its first eased value.
 */
import { ChromeSettings, Grab, defineQuery } from "@ice/core";
import type { Entity, World } from "@ice/core";
import { FADE_EASE, LIFT_DURATION_MS, LIFT_EASE, easedValue } from "@ice/kernel";

export interface LiftFacts {
  /** Multiplier on the quad's rect, about its centre. 1 at rest. */
  readonly scale: number;
  /** Multiplier on the quad's opacity. 1 at rest. */
  readonly opacity: number;
}

const AT_REST: LiftFacts = { scale: 1, opacity: 1 };

/** `Grab` IS the lift signal (design-004 §1's rule, carried unchanged). */
const grabQuery = defineQuery([Grab]);

export interface LiftDriverOptions {
  /**
   * The lifted scale. Read from `ChromeSettings.liftScale` when omitted, which
   * is where the DOM card's own lift reads it — one number, one source, so the
   * two cannot disagree while both profiles exist.
   */
  readonly scale?: number;
  /** The lifted opacity. 1 (no fade) unless the app asks for one. */
  readonly opacity?: number;
  readonly durationMs?: number;
  /** Clock seam, for tests. Defaults to `performance.now()`. */
  readonly now?: () => number;
}

export interface LiftDriver {
  /**
   * Advance every live ease to the current clock. Returns TRUE while any is
   * still moving — the compositor re-marks dirt on that, or a lift would draw
   * one frame and stop.
   */
  advance(): boolean;
  /** The current lift facts for an entity; `AT_REST` for anything not lifted. */
  factsFor(entity: Entity): LiftFacts;
  /** Entities with a live or settling ease (diagnostics). */
  active(): number;
  dispose(): void;
}

interface Ease {
  from: number;
  to: number;
  startedAt: number;
  value: number;
}

const makeEase = (value: number): Ease => ({ from: value, to: value, startedAt: 0, value });

export function createLiftDriver(world: World, options: LiftDriverOptions = {}): LiftDriver {
  const now = options.now ?? (() => performance.now());
  const durationMs = options.durationMs ?? LIFT_DURATION_MS;
  const liftOpacity = options.opacity ?? 1;
  const scales = new Map<Entity, Ease>();
  const opacities = new Map<Entity, Ease>();

  /**
   * The lifted scale. A live read, because `ChromeSettings.liftScale` is an
   * app-tunable resource the settings panel writes at runtime — capturing it
   * at construction would silently pin the first value ever seen.
   */
  const liftScale = (): number => {
    if (options.scale !== undefined) return options.scale;
    const chrome = world.getResource(ChromeSettings) as { liftScale?: number } | undefined;
    return chrome?.liftScale ?? 1;
  };

  /** Point an ease at a new target, starting from where it is RIGHT NOW. */
  const retarget = (map: Map<Entity, Ease>, entity: Entity, to: number, at: number): void => {
    const ease = map.get(entity) ?? makeEase(1);
    if (ease.to === to) {
      map.set(entity, ease);
      return;
    }
    ease.from = ease.value; // from the DRAWN value — see the header
    ease.to = to;
    ease.startedAt = at;
    map.set(entity, ease);
  };

  const step = (map: Map<Entity, Ease>, at: number, ease: (t: number) => number): boolean => {
    let animating = false;
    for (const [entity, e] of map) {
      const elapsed = at - e.startedAt;
      e.value = easedValue(e.from, e.to, elapsed, durationMs, ease);
      if (elapsed < durationMs && e.from !== e.to) animating = true;
      // Settled AND at rest: forget it, so a board that never lifts again
      // carries no per-entity state at all.
      else if (e.to === 1 && e.value === 1) map.delete(entity);
    }
    return animating;
  };

  return {
    advance() {
      const at = now();
      const scale = liftScale();
      // Targets first: `Grab` is the lift signal (design-004 §1's rule, kept),
      // and a card that lost its Grab retargets home in the same pass.
      for (const entity of scales.keys()) {
        if (!world.isAlive(entity) || !world.has(entity, Grab)) {
          retarget(scales, entity, 1, at);
          retarget(opacities, entity, 1, at);
        }
      }
      world.query(grabQuery).each((chunk) => {
        for (let row = 0; row < chunk.count; row++) {
          const entity = chunk.entity(row);
          retarget(scales, entity, scale, at);
          retarget(opacities, entity, liftOpacity, at);
        }
      });
      const a = step(scales, at, LIFT_EASE);
      const b = step(opacities, at, FADE_EASE);
      return a || b;
    },

    factsFor(entity) {
      const scale = scales.get(entity)?.value;
      const opacity = opacities.get(entity)?.value;
      if (scale === undefined && opacity === undefined) return AT_REST;
      return { scale: scale ?? 1, opacity: opacity ?? 1 };
    },

    active: () => scales.size,

    dispose() {
      scales.clear();
      opacities.clear();
    },
  };
}
