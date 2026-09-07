// Per-card motion state: the ENGINE's springs — reveal, lift, hover and the
// §7 heat — advanced once per frame on the CPU, then handed to a card
// program's `resolve` as plain numbers (`Motion`, geometry.ts). A pack's own
// springs (VibeField's two buttons and its lock) live in the pack
// (packs/vf-frame). (Lineage: research/sdf-card/src/motion/machines.js,
// generalised from one lab card to N; the engine's before design-014.)

import { LIFT } from "../theme";
import type { Motion } from "./geometry";
import { settled, spring } from "./springs";

export interface CardMotion {
  selected: boolean;
  reveal: number; revealV: number;
  held: boolean; lift: number; liftV: number;   // §7 lift: grab or armed hold, 0..1
  /** A hover fact's target and spring (none in ICE yet: stays 0). */
  hovered: boolean; hover: number; hoverV: number;
  del: number; deleting: boolean; gone: boolean;
  /**
   * §7 the overlap heat (GLOW.md): the drop signal (`hotTarget`), the tier it
   * came with, the light SOURCE — the lifted card's silhouette: centre, half
   * extents, radius (held on clear — the fade-out needs a place) — the
   * presence spring and the tier's cross-fade.
   */
  hotTarget: boolean; hotTier: number; hotAt: [number, number]; hotHalf: [number, number]; hotR: number;
  hot: number; hotV: number; tierK: number; tierKV: number;
}

export interface MotionTuning {
  readonly revealHz: number; readonly revealDamp: number;
  /** A pack's lock spring (packs/vf-frame reads these); the engine steps no lock. */
  readonly lockHz: number; readonly lockDamp: number;
  readonly deleteSeconds: number;
  /** The lift's spring: §6 `--vf-ease-lift` is 180ms with a slight overshoot. */
  readonly liftHz: number; readonly liftDamp: number;
  /** The heat's spring: the CardShell's `opacity 220ms ease` — critically damped, settled in ~210 ms. */
  readonly hotHz: number; readonly hotDamp: number;
  /** The hover presence's spring. */
  readonly hoverHz: number; readonly hoverDamp: number;
}

export const MOTION_DEFAULTS: MotionTuning = { revealHz: 2.4, revealDamp: 1.0, lockHz: 3.6, lockDamp: 0.72, deleteSeconds: 0.62, liftHz: 4.5, liftDamp: 0.78, hotHz: 3.6, hotDamp: 1.0, hoverHz: 5.5, hoverDamp: 0.75 };

export function newMotion(selected = false): CardMotion {
  return {
    selected,
    reveal: selected ? 1 : 0, revealV: 0,
    held: false, lift: 0, liftV: 0,
    hovered: false, hover: 0, hoverV: 0,
    del: 0, deleting: false, gone: false,
    hotTarget: false, hotTier: 0, hotAt: [0, 0], hotHalf: [0, 0], hotR: 0, hot: 0, hotV: 0, tierK: 0, tierKV: 0,
  };
}

/** A light source as a scene states it: the lifted card's silhouette in card units, the tier, the presence (1). */
export interface HotPin { readonly x: number; readonly y: number; readonly hx: number; readonly hy: number; readonly r: number; readonly tier: number; readonly presence?: number }

/**
 * A STILL's pins — what a harness scene sets on both hosts so the Node oracle
 * and Chrome draw the same frame: a held (lifted) card, a card lit by a source
 * at a presence (1 unless said otherwise), its tier settled.
 */
export function pinMotion(m: CardMotion, pin: { readonly held?: boolean; readonly hot?: HotPin }): CardMotion {
  if (pin.held) { m.held = true; m.lift = 1; m.liftV = 0; }
  if (pin.hot) {
    m.hotTarget = true; m.hotAt = [pin.hot.x, pin.hot.y]; m.hotHalf = [pin.hot.hx, pin.hot.hy]; m.hotR = pin.hot.r;
    m.hotTier = pin.hot.tier; m.tierK = pin.hot.tier; m.hot = pin.hot.presence ?? 1; m.hotV = 0;
  }
  return m;
}

/** Advance one card by dt seconds. Returns TRUE while anything is still moving. */
export function stepMotion(m: CardMotion, dt: number, t: MotionTuning = MOTION_DEFAULTS): boolean {
  let live = false;
  const target = m.selected ? 1 : 0;
  [m.reveal, m.revealV] = spring(m.reveal, m.revealV, target, t.revealHz, t.revealDamp, dt);
  if (settled(m.reveal, m.revealV, target)) { m.reveal = target; m.revealV = 0; } else live = true;

  if (m.deleting) {
    m.del = Math.min(m.del + dt / Math.max(t.deleteSeconds, 0.05), 1);
    if (m.del >= 1) { m.deleting = false; m.gone = true; }
    live = true;
  }

  const liftTarget = m.held && !m.gone ? 1 : 0;
  [m.lift, m.liftV] = spring(m.lift, m.liftV, liftTarget, t.liftHz, t.liftDamp, dt);
  if (settled(m.lift, m.liftV, liftTarget)) { m.lift = liftTarget; m.liftV = 0; } else live = true;

  const hoverTarget = m.hovered && !m.gone ? 1 : 0;
  [m.hover, m.hoverV] = spring(m.hover, m.hoverV, hoverTarget, t.hoverHz, t.hoverDamp, dt);
  if (settled(m.hover, m.hoverV, hoverTarget)) { m.hover = hoverTarget; m.hoverV = 0; } else live = true;

  // §7 the heat: presence springs on the drop signal. The tier follows at once while the
  // card is cold (a new episode starts at its own tier) and cross-fades once it is warm.
  if (m.hot < 1e-3 && Math.abs(m.hotV) < 1e-2) { m.tierK = m.hotTier; m.tierKV = 0; }
  else {
    [m.tierK, m.tierKV] = spring(m.tierK, m.tierKV, m.hotTier, t.hotHz, t.hotDamp, dt);
    if (settled(m.tierK, m.tierKV, m.hotTier)) { m.tierK = m.hotTier; m.tierKV = 0; } else live = true;
  }
  const hotTarget = m.hotTarget && !m.gone ? 1 : 0;
  [m.hot, m.hotV] = spring(m.hot, m.hotV, hotTarget, t.hotHz, t.hotDamp, dt);
  if (settled(m.hot, m.hotV, hotTarget)) { m.hot = hotTarget; m.hotV = 0; } else live = true;
  return live;
}

export function toMotion(m: CardMotion, liftScale: number = LIFT.scale): Motion {
  return {
    reveal: m.reveal, del: m.del, grow: 1, stagger: 1,
    held: m.lift, lift: 1 + (liftScale - 1) * m.lift,
    hover: m.hover,
    hot: m.hot, hotTier: m.tierK, hotAt: m.hotAt, hotHalf: m.hotHalf, hotR: m.hotR,
  };
}
