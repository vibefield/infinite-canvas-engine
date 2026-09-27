// The notebook's MOTION — springs, stepped by the host's clock (NOTEBOOK.md §4). Pure.
//
// Three things move: the front cover (one spring, θ 0 closed … π open, a little overshoot that
// bounces off the desk), the sheets (each one resting on the right or the left, or in the AIR
// with a root angle φ and a free edge ψ), and the book itself (a lift and a tilt while held).
//
// A sheet in the air is two coupled springs. Turned by a click or a key, the ROOT springs toward
// its side and the EDGE follows it — so the edge flicks up first (a kick), is overtaken, and
// trails as the sheet falls, the way paper does in air. Turned by hand, the EDGE is where the
// finger says and the ROOT follows it — the sheet bends toward the finger. Let go, the sheet
// goes the way it was going (past the vertical, or flung), and the springs land it.

import type { NotebookLaw } from "./law";
import type { Air, NotebookPose } from "./shape";

export interface SheetMotion {
  /** Where it rests, or is heading when in the air: 0 right, 1 left. */
  side: 0 | 1;
  air: boolean;
  phi: number; phiV: number;
  psi: number; psiV: number;
  tw: number; twV: number;
  /** Held by the pointer: the pinch's angle (and its pace, from the hand) set the sheet; its twist follows the hand. */
  held: boolean;
  psiT: number; twT: number;
  /** The held sheet's pinch angle, its pace (rad/s, smoothed), and the side it was taken from. */
  grip: number; gripV: number; from: 0 | 1;
}

export interface NotebookMotion {
  opened: boolean;
  theta: number; thetaV: number;
  held: boolean;
  lift: number; liftV: number;
  /** The tilt (radians about x and y) and where the hand's motion asks it to be. */
  tiltX: number; tiltXV: number; tiltY: number; tiltYV: number;
  tiltTX: number; tiltTY: number;
  selected: boolean;
  ring: number; ringV: number;
  sheets: SheetMotion[];
  /** The corner's peek: its amount and which corner (+1 the tail's, −1 the head's). */
  peek: number; peekV: number; peekOn: boolean; peekSide: 1 | -1;
  /** The landing flutter has played for this opening. */
  fluttered: boolean;
  /** The pointer is over the (closed) book: it rises a little. */
  hover: number; hoverV: number; hoverOn: boolean;
}

const sheet = (side: 0 | 1): SheetMotion => ({ side, air: false, phi: side * Math.PI, phiV: 0, psi: side * Math.PI, psiV: 0, tw: 0, twV: 0, held: false, psiT: 0, twT: 0, grip: side * Math.PI, gripV: 0, from: side });

/** A notebook at rest: closed (or open), `left` sheets turned. */
export function newMotion(sheets: number, left = 0, opened = false): NotebookMotion {
  const list: SheetMotion[] = [];
  for (let i = 0; i < sheets; i++) list.push(sheet(i < left ? 1 : 0));
  return {
    opened, theta: opened ? Math.PI : 0, thetaV: 0, held: false, lift: 0, liftV: 0,
    tiltX: 0, tiltXV: 0, tiltY: 0, tiltYV: 0, tiltTX: 0, tiltTY: 0,
    selected: false, ring: 0, ringV: 0, sheets: list, peek: 0, peekV: 0, peekOn: false, peekSide: 1, fluttered: opened,
    hover: 0, hoverV: 0, hoverOn: false,
  };
}

const clamp = (x: number, a: number, b: number): number => Math.min(Math.max(x, a), b);

/** One damped spring step (semi-implicit Euler): x toward `to` at `hz` with damping ratio `z`. */
function springStep(x: number, v0: number, to: number, hz: number, z: number, h: number): [number, number] {
  let v = v0;
  const w = 2 * Math.PI * hz;
  v += (w * w * (to - x) - 2 * z * w * v) * h;
  return [x + v * h, v];
}

// ---------------------------------------------------------------- the stacks

/** The lowest index resting on the right — its recto is the right page; −1 when none. */
export function rightTop(m: NotebookMotion): number { for (let i = 0; i < m.sheets.length; i++) { const s = m.sheets[i] as SheetMotion; if (!s.air && s.side === 0) return i; } return -1; }
/** The highest index resting on the left — its verso is the left page; −1 when none. */
export function leftTop(m: NotebookMotion): number { for (let i = m.sheets.length - 1; i >= 0; i--) { const s = m.sheets[i] as SheetMotion; if (!s.air && s.side === 1) return i; } return -1; }
/** Sheets resting on each side. */
export function counts(m: NotebookMotion): { right: number; left: number } {
  let right = 0;
  let left = 0;
  for (const s of m.sheets) if (!s.air) { if (s.side === 0) right++; else left++; }
  return { right, left };
}
/** The spread as a reader names it: the left page's number (0 = the endpaper) and the right's. */
export function spreadOf(m: NotebookMotion): { left: number; right: number } {
  let turned = 0;
  for (const s of m.sheets) if ((s.air ? s.side : s.side) === 1) turned++;
  return { left: 2 * turned, right: 2 * turned + 1 };
}
export const anyAir = (m: NotebookMotion): boolean => m.sheets.some((s) => s.air);
/** A page may turn only in an open book whose cover has landed. */
export const turnable = (m: NotebookMotion): boolean => m.opened && m.theta > 0.93 * Math.PI;

/**
 * Turn a page: forward (+1) lifts the right stack's top sheet, back (−1) the left's. A turn the
 * other way while sheets are still flying the first way sends the last of them back instead —
 * sheets are bound in order and can never cross. The edge is kicked up first. False when
 * there is nothing to turn.
 */
export function turnPage(m: NotebookMotion, dir: 1 | -1, law: NotebookLaw): boolean {
  if (!turnable(m)) return false;
  const flying = m.sheets.map((s, i) => ({ s, i })).filter(({ s }) => s.air && !s.held);
  const against = flying.filter(({ s }) => s.side === (dir === 1 ? 0 : 1) && s.phi > 0.02 && s.phi < Math.PI - 0.02);
  if (against.length && flying.every(({ s }) => s.side !== (dir === 1 ? 1 : 0))) {
    const pick = dir === 1 ? against[0] : against[against.length - 1];
    if (pick) { pick.s.side = dir === 1 ? 1 : 0; return true; }
  }
  const i = dir === 1 ? rightTop(m) : leftTop(m);
  if (i < 0) return false;
  const s = m.sheets[i] as SheetMotion;
  s.air = true; s.held = false; s.side = dir === 1 ? 1 : 0;
  s.phi = dir === 1 ? 0 : Math.PI; s.psi = s.phi; s.phiV = 0;
  s.psiV = dir * law.flutter.kick * 2.2;
  s.tw = 0; s.twV = dir * 0.9;
  return true;
}

/** Take hold of the top sheet on a side (0 the right page, 1 the left) — a drag begins. Null when there is none or sheets are flying. */
export function grabSheet(m: NotebookMotion, side: 0 | 1): number | null {
  if (!turnable(m) || m.sheets.some((s) => s.air && s.phi > 0.03 && s.phi < Math.PI - 0.03)) return null;
  // a peeking sheet is the right top — it lands first
  for (const s of m.sheets) if (s.air && !s.held) { s.air = false; s.phi = s.psi = s.side * Math.PI; s.phiV = s.psiV = s.tw = s.twV = 0; }
  const i = side === 0 ? rightTop(m) : leftTop(m);
  if (i < 0) return null;
  const s = m.sheets[i] as SheetMotion;
  s.air = true; s.held = true; s.psiT = s.psi; s.twT = 0;
  s.grip = s.side * Math.PI; s.gripV = 0; s.from = s.side;
  m.peek = 0; m.peekV = 0; m.peekOn = false;
  return i;
}

/**
 * The hand moves a held sheet: the page is pinched at arc length `sGrab` from the gutter, and the
 * pointer is at `xLocal` across the book (right-model x). The pinch follows the pointer's x — its
 * angle about the gutter is the GRIP — and the sheet bows toward the hand: the edge leads the
 * root by a bend that is most while the sheet stands and nothing while it lies. `yFrac` (−1 the
 * head … +1 the tail) is where along the page the pinch is: that corner leads. `dt` is the time
 * since the last move (the grip's pace, which a release reads).
 */
export function dragSheet(m: NotebookMotion, i: number, xLocal: number, xg: number, sGrab: number, _len: number, yFrac: number, law: NotebookLaw, dt = 1 / 60): void {
  const s = m.sheets[i];
  if (!s || !s.held) return;
  const reach = Math.max(sGrab, 12);
  const grip = Math.acos(clamp((xLocal - xg) / reach, -1, 1));
  const v = (grip - s.grip) / Math.max(dt, 1e-3);
  s.gripV = s.gripV * 0.5 + v * 0.5;
  s.grip = grip;
  const lead = (s.from === 0 ? 1 : -1) * 0.5 * Math.sin(grip);
  s.psiT = clamp(grip + lead, 0, Math.PI);
  s.twT = clamp(yFrac, -1, 1) * law.peek.twist * 2.2 * Math.sin(Math.max(grip, 0.25));
}

/** Let go of a held sheet: it goes where the hand was taking it — flung, or past the vertical — else back. */
export function releaseSheet(m: NotebookMotion, i: number): void {
  const s = m.sheets[i];
  if (!s || !s.held) return;
  s.held = false;
  const v = s.gripV;
  s.side = v > 2.5 ? 1 : v < -2.5 ? 0 : s.grip > Math.PI / 2 ? 1 : 0;
}

/** Open or close. Closing lands every sheet in the air on the side it was heading. */
export function setOpen(m: NotebookMotion, open: boolean): void {
  if (m.opened === open) return;
  m.opened = open;
  if (!open) {
    for (const s of m.sheets) if (s.air) { s.air = false; s.held = false; s.phi = s.psi = s.side * Math.PI; s.phiV = s.psiV = s.tw = s.twV = 0; }
    m.peekOn = false;
  } else m.fluttered = false;
}

// ---------------------------------------------------------------- the step

/** The sheets in the air, `n` substeps of `h` seconds: a held one follows the hand, the rest spring to their side and land. True while any is in the air. */
function stepSheets(m: NotebookMotion, h: number, n: number, law: NotebookLaw): boolean {
  const S = law.springs;
  let live = false;
  for (const s of m.sheets) {
    if (!s.air) continue;
    const T = s.side * Math.PI;
    for (let k = 0; k < n; k++) {
      if (s.held) {
        // the edge is where the hand says (stiffly); the root follows it, lagging — the sheet bows toward the hand
        [s.psi, s.psiV] = springStep(s.psi, s.psiV, s.psiT, 9, 0.9, h);
        [s.phi, s.phiV] = springStep(s.phi, s.phiV, s.grip - (s.psiT - s.grip), S.root[0] * 1.6, 0.9, h);
        [s.tw, s.twV] = springStep(s.tw, s.twV, s.twT, 6, 0.8, h);
      } else {
        [s.phi, s.phiV] = springStep(s.phi, s.phiV, T, S.root[0], S.root[1], h);
        [s.psi, s.psiV] = springStep(s.psi, s.psiV, s.phi, S.edge[0], S.edge[1], h);
        [s.tw, s.twV] = springStep(s.tw, s.twV, 0, S.edge[0], S.edge[1], h);
      }
      // a sheet cannot pass through a stack: it lands, it does not sink
      if (s.phi < 0) { s.phi = 0; if (s.phiV < 0) s.phiV *= -0.15; }
      if (s.phi > Math.PI) { s.phi = Math.PI; if (s.phiV > 0) s.phiV *= -0.15; }
      if (s.psi < 0) { s.psi = 0; if (s.psiV < 0) s.psiV *= -0.2; }
      if (s.psi > Math.PI) { s.psi = Math.PI; if (s.psiV > 0) s.psiV *= -0.2; }
    }
    if (!s.held && Math.abs(s.phi - T) < 2e-3 && Math.abs(s.psi - T) < 2e-3 && Math.abs(s.phiV) + Math.abs(s.psiV) < 0.03 && Math.abs(s.tw) < 2e-3) {
      s.air = false; s.phi = s.psi = T; s.phiV = s.psiV = s.tw = s.twV = 0;
    } else live = true;
  }
  return live;
}

/** The corner's peek, `n` substeps of `h` seconds: up while the pointer invites a turn of an open book with nothing in the air. True while it moves. */
function stepPeek(m: NotebookMotion, h: number, n: number, law: NotebookLaw): boolean {
  const S = law.springs;
  let live = false;
  const peekT = m.peekOn && turnable(m) && !anyAir(m) ? 1 : 0;
  for (let k = 0; k < n; k++) [m.peek, m.peekV] = springStep(m.peek, m.peekV, peekT, S.peek[0], S.peek[1], h);
  if (Math.abs(m.peek - peekT) < 1e-3 && Math.abs(m.peekV) < 1e-2) { m.peek = peekT; m.peekV = 0; } else live = true;
  return live;
}

/**
 * The SHEETS and the PEEK alone, by dt seconds (D3t-b): a book in hand, whose cover, lift and tilt are the hand's (kinds/notebook.ts
 * — the cover on the palm's spring), keeps its sheets' springs here — the same substeps `stepMotion` takes. True while any moves.
 */
export function stepLeaves(m: NotebookMotion, dt0: number, law: NotebookLaw): boolean {
  const dt = Math.min(dt0, 0.05);
  const n = 8;
  const h = dt / n;
  const a = stepSheets(m, h, n, law);
  const b = stepPeek(m, h, n, law);
  return a || b;
}

/** Advance every spring by dt seconds; true while anything still moves. */
export function stepMotion(m: NotebookMotion, dt0: number, law: NotebookLaw): boolean {
  let dt = dt0;
  const S = law.springs;
  dt = Math.min(dt, 0.05);
  const n = 8;
  const h = dt / n;
  let live = false;
  // the cover
  const thetaT = m.opened ? Math.PI : 0;
  const prev = m.theta;
  for (let k = 0; k < n; k++) [m.theta, m.thetaV] = springStep(m.theta, m.thetaV, thetaT, S.cover[0], S.cover[1], h);
  if (Math.abs(m.theta - thetaT) < 1e-4 && Math.abs(m.thetaV) < 1e-3) { m.theta = thetaT; m.thetaV = 0; } else live = true;
  // the landing flutter: as an opening cover comes down, the first sheets lift off the block and fall back
  if (m.opened && !m.fluttered && prev < 0.9 * Math.PI && m.theta >= 0.9 * Math.PI) {
    m.fluttered = true;
    let top = rightTop(m);
    for (let k = 0; k < law.flutter.sheets && top >= 0; k++) {
      const s = m.sheets[top] as SheetMotion;
      const f = 1 - k / law.flutter.sheets;
      s.air = true; s.side = 0; s.phi = 0; s.psi = 0; s.phiV = law.flutter.kick * 0.25 * f; s.psiV = law.flutter.kick * f; s.tw = 0; s.twV = 0.6 * f;
      top = rightTop(m);
    }
  }
  if (stepSheets(m, h, n, law)) live = true;
  if (stepPeek(m, h, n, law)) live = true;
  // the lift and the tilt
  const liftT = m.held ? 1 : 0;
  for (let k = 0; k < n; k++) [m.lift, m.liftV] = springStep(m.lift, m.liftV, liftT, S.lift[0], S.lift[1], h);
  if (Math.abs(m.lift - liftT) < 1e-3 && Math.abs(m.liftV) < 1e-2) { m.lift = liftT; m.liftV = 0; } else live = true;
  const tx = m.held ? m.tiltTX : 0;
  const ty = m.held ? m.tiltTY : 0;
  for (let k = 0; k < n; k++) { [m.tiltX, m.tiltXV] = springStep(m.tiltX, m.tiltXV, tx, S.tilt[0], S.tilt[1], h); [m.tiltY, m.tiltYV] = springStep(m.tiltY, m.tiltYV, ty, S.tilt[0], S.tilt[1], h); }
  if (Math.abs(m.tiltX - tx) + Math.abs(m.tiltY - ty) < 1e-4 && Math.abs(m.tiltXV) + Math.abs(m.tiltYV) < 1e-3) { m.tiltX = tx; m.tiltY = ty; m.tiltXV = m.tiltYV = 0; } else live = true;
  // the tilt target decays toward level on its own: a hand that stops, stops the swing
  m.tiltTX *= Math.exp(-dt * 7); m.tiltTY *= Math.exp(-dt * 7);
  if (Math.abs(m.tiltTX) + Math.abs(m.tiltTY) > 1e-4) live = true;
  // the hover's rise
  const hoverT = m.hoverOn && !m.held && !m.opened ? 1 : 0;
  for (let k = 0; k < n; k++) [m.hover, m.hoverV] = springStep(m.hover, m.hoverV, hoverT, S.lift[0] * 1.6, 0.85, h);
  if (Math.abs(m.hover - hoverT) < 1e-3 && Math.abs(m.hoverV) < 1e-2) { m.hover = hoverT; m.hoverV = 0; } else live = true;
  // the ring: a selected book lying closed on the mat — never under a lifted or an open one
  const ringT = m.selected && !m.held && !m.opened ? 1 : 0;
  for (let k = 0; k < n; k++) [m.ring, m.ringV] = springStep(m.ring, m.ringV, ringT, S.ring[0], S.ring[1], h);
  if (Math.abs(m.ring - ringT) < 1e-3 && Math.abs(m.ringV) < 1e-2) { m.ring = ringT; m.ringV = 0; } else live = true;
  return live;
}

/** The hand's velocity (CSS px / s) → the tilt it asks for: the leading edge dips, capped. */
export function tiltToward(m: NotebookMotion, vx: number, vy: number, law: NotebookLaw): void {
  const k = law.lift.tiltPer;
  const cap = law.lift.tiltMax;
  m.tiltTY = clamp(vx * k, -cap, cap);
  m.tiltTX = clamp(-vy * k, -cap, cap);
}

// ---------------------------------------------------------------- the pose

/** The pose the mesh is built for: the swing, the stacks' counts and tops, the sheets in the air (a peek is one). */
export function poseOf(m: NotebookMotion, law: NotebookLaw): NotebookPose {
  const airs: Air[] = [];
  m.sheets.forEach((s, i) => { if (s.air) airs.push({ index: i, phi: s.phi, psi: s.psi, twist: s.tw }); });
  const c = counts(m);
  let rt = rightTop(m);
  let right = c.right;
  if (m.peek > 1e-3 && rt >= 0 && airs.length === 0) {
    airs.push({ index: rt, phi: 0, psi: law.peek.angle * m.peek, twist: m.peekSide * law.peek.twist * m.peek });
    right -= 1;
    rt = -1;
    for (let i = 0; i < m.sheets.length; i++) { const s = m.sheets[i] as SheetMotion; if (!s.air && s.side === 0 && !airs.some((a) => a.index === i)) { rt = i; break; } }
  }
  return { theta: m.theta, right, left: c.left, rightTop: rt, leftTop: leftTop(m), airs };
}

/** The pose with the desk under the book (−its lift, in its own z): what the ribbon hangs to. */
export const withDesk = (p: NotebookPose, lift: number): NotebookPose => ({ ...p, desk: -Math.max(lift, 0) });

/** A key that changes whenever the pose would build a different mesh. */
export function poseKey(p: NotebookPose): string {
  let k = `${p.theta.toFixed(5)}|${p.right}|${p.left}|${p.rightTop}|${p.leftTop}`;
  for (const a of p.airs) k += `|${a.index}:${a.phi.toFixed(5)}:${a.psi.toFixed(5)}:${a.twist.toFixed(5)}`;
  if (p.desk) k += `|d${p.desk.toFixed(2)}`;
  return k;
}
