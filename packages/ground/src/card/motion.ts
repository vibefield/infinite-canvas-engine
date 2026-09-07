// Per-card motion state: the springs and timelines behind reveal, hover,
// press, lock and delete — advanced once per frame on the CPU, then handed to
// `resolve()` as plain numbers. (Lineage: research/sdf-card/src/motion/machines.js,
// generalised from one lab card to N.)

import { LIFT } from "../theme";
import type { Motion } from "./choreography";
import { settled, spring } from "./springs";

export interface CardMotion {
  selected: boolean;
  locked: boolean;
  reveal: number; revealV: number;
  hoverC: number; hoverCV: number; pressC: number; pressCV: number;
  hoverK: number; hoverKV: number; pressK: number; pressKV: number;
  lockA: number; lockV: number;      // 0 locked … 1 open
  held: boolean; lift: number; liftV: number;   // §7 lift: grab or armed hold, 0..1
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
  readonly lockHz: number; readonly lockDamp: number;
  readonly deleteSeconds: number;
  /** The lift's spring: §6 `--vf-ease-lift` is 180ms with a slight overshoot. */
  readonly liftHz: number; readonly liftDamp: number;
  /** The heat's spring: the CardShell's `opacity 220ms ease` — critically damped, settled in ~210 ms. */
  readonly hotHz: number; readonly hotDamp: number;
}

export const MOTION_DEFAULTS: MotionTuning = { revealHz: 2.4, revealDamp: 1.0, lockHz: 3.6, lockDamp: 0.72, deleteSeconds: 0.62, liftHz: 4.5, liftDamp: 0.78, hotHz: 3.6, hotDamp: 1.0 };

export function newMotion(selected = false, locked = false): CardMotion {
  return {
    selected, locked,
    reveal: selected ? 1 : 0, revealV: 0,
    hoverC: 0, hoverCV: 0, pressC: 0, pressCV: 0,
    hoverK: 0, hoverKV: 0, pressK: 0, pressKV: 0,
    lockA: locked ? 0 : 1, lockV: 0,
    held: false, lift: 0, liftV: 0,
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

export interface MotionInputs {
  readonly hoverClose: boolean;
  readonly hoverLock: boolean;
  readonly pressClose: boolean;
  readonly pressLock: boolean;
}

/** Advance one card by dt seconds. Returns TRUE while anything is still moving. */
export function stepMotion(m: CardMotion, dt: number, input: MotionInputs, t: MotionTuning = MOTION_DEFAULTS): boolean {
  let live = false;
  const target = m.selected ? 1 : 0;
  [m.reveal, m.revealV] = spring(m.reveal, m.revealV, target, t.revealHz, t.revealDamp, dt);
  if (settled(m.reveal, m.revealV, target)) { m.reveal = target; m.revealV = 0; } else live = true;

  if (m.deleting) {
    m.del = Math.min(m.del + dt / Math.max(t.deleteSeconds, 0.05), 1);
    if (m.del >= 1) { m.deleting = false; m.gone = true; }
    live = true;
  }

  const lockTarget = m.locked ? 0 : 1;
  [m.lockA, m.lockV] = spring(m.lockA, m.lockV, lockTarget, t.lockHz, t.lockDamp, dt);
  if (settled(m.lockA, m.lockV, lockTarget)) { m.lockA = lockTarget; m.lockV = 0; } else live = true;

  const liftTarget = m.held && !m.gone ? 1 : 0;
  [m.lift, m.liftV] = spring(m.lift, m.liftV, liftTarget, t.liftHz, t.liftDamp, dt);
  if (settled(m.lift, m.liftV, liftTarget)) { m.lift = liftTarget; m.liftV = 0; } else live = true;

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

  const buttonsLive = !m.deleting && !m.gone && m.reveal > 0.5;
  const hc = buttonsLive && input.hoverClose ? 1 : 0;
  const pc = buttonsLive && input.pressClose ? 1 : 0;
  const hk = buttonsLive && input.hoverLock ? 1 : 0;
  const pk = buttonsLive && input.pressLock ? 1 : 0;
  [m.hoverC, m.hoverCV] = spring(m.hoverC, m.hoverCV, hc, 5.5, 0.75, dt);
  [m.pressC, m.pressCV] = spring(m.pressC, m.pressCV, pc, 9.0, 1.0, dt);
  [m.hoverK, m.hoverKV] = spring(m.hoverK, m.hoverKV, hk, 5.5, 0.75, dt);
  [m.pressK, m.pressKV] = spring(m.pressK, m.pressKV, pk, 9.0, 1.0, dt);
  for (const [x, v, tg] of [[m.hoverC, m.hoverCV, hc], [m.pressC, m.pressCV, pc], [m.hoverK, m.hoverKV, hk], [m.pressK, m.pressKV, pk]] as const) {
    if (!settled(x, v, tg)) live = true;
  }
  return live;
}

export function toMotion(m: CardMotion, liftScale: number = LIFT.scale): Motion {
  return {
    reveal: m.reveal, del: m.del, grow: 1, stagger: 1,
    hoverC: m.hoverC, pressC: m.pressC, hoverK: m.hoverK, pressK: m.pressK,
    lockOpen: m.lockA, lockVel: Math.min(Math.max(m.lockV / 16, -0.7), 0.7),
    held: m.lift, lift: 1 + (liftScale - 1) * m.lift,
    hot: m.hot, hotTier: m.tierK, hotAt: m.hotAt, hotHalf: m.hotHalf, hotR: m.hotR,
  };
}
