// THE MONTH'S TURN at work (CALENDAR.md §4; D3t-c) — the prototype's `Turn`, `startTurn`, the pointer's roll and `step`
// (lab/calendar.ts), pure: a month rolls UP from its foot into the roll under the tape (the next laid bare beneath it), or the last
// month comes DOWN off the roll over the one showing. A turn runs on `roll [1.25 Hz, 0.92]` toward 1 (rolled) or 0 (flat); a hand
// drives it (the sheet under the finger), and let go it decides — a click takes the whole month, a flick goes where it was
// flicked, else past a third it goes and short of it falls back. The corner LIFTS (the peek) while the pointer is near it.
//
// The DOCUMENT holds the month (`desk.calendar.month`); the turn is FLUX. The pad shows the month it has laid bare (`shown`) and
// rolls toward the document's — a month turned by the bar, the keys, today, a peer, one after another, quicker the further it is.
// A month turned BY HAND ends where the document does not know yet: it is `pending` (the hand commits it — ONE transaction, off
// the undo stack, D-D3t-c.5) and the pad holds it until the document says so.

import type { CalendarLaw } from "./law";
import type { PadFrame } from "./pad";
import { rollState, type RollState } from "./roll";
import { spring } from "../springs";

/** A turn in flight. */
export interface Turn {
  readonly dir: 1 | -1;
  /** How far the moving sheet is rolled: 0 flat on the pad … 1 in the roll at rest. */
  p: number;
  v: number;
  target: 0 | 1;
  /** The corner's tilt it started with. */
  readonly tilt: number;
  /** The hand on it: the sheet point under the finger (`s` from under the tape), its velocity, whether it moved. */
  drag: { lastS: number; lastT: number; vs: number; moved: boolean } | null;
  /** A quick run (several months to go): the spring's frequency multiplied. */
  fast: number;
  /** A HAND's turn (its end a month the document does not know yet), not one toward the document's month. */
  readonly hand: boolean;
}

/** One pad's turning, the local's own. */
export interface PadRoll {
  /** The month laid bare (null until the pad is first seen: it shows the document's then). */
  shown: number | null;
  turn: Turn | null;
  peek: number;
  peekV: number;
  peekOn: boolean;
  /** A hand's finished roll asked of the document, not yet there — held until the document SPEAKS (its month moves, to this or elsewhere). */
  pending: number | null;
  /** A hand's roll finished (the hand commits `shown`); cleared by whoever drains it. */
  rolled: boolean;
  /** The document's month as last seen. */
  durable: number | null;
  /** The document's month as `stepRoll` last heard it (a move from it is the document speaking — D7 #3). */
  heard: number | null;
}

export const newRoll = (): PadRoll => ({ shown: null, turn: null, peek: 0, peekV: 0, peekOn: false, pending: null, rolled: false, durable: null, heard: null });

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** The sheets in play for a pad: the month on it and the one in motion, the roll's line — the prototype's `sheetsOf`. */
export function rollSheets(r: PadRoll, durable: number, law: CalendarLaw, F: PadFrame): { readonly shown: number; readonly base: number; readonly moving: number | null; readonly roll: RollState | null; readonly marksOn: 0 | 1; readonly turning: boolean } {
  if (r.shown === null) r.shown = durable;
  r.durable = durable;
  const shown = r.shown;
  const rollOf = (p: number, tilt: number): RollState => rollState(p, { rest: law.roll.rest + 0.6, tau: law.roll.tau }, F.L, F.W, tilt);
  const t = r.turn;
  if (t !== null) {
    const roll = rollOf(t.p, t.tilt);
    return t.dir === 1 ? { shown, base: shown + 1, moving: shown, roll, marksOn: 1, turning: true } : { shown, base: shown, moving: shown - 1, roll, marksOn: 0, turning: true };
  }
  if (r.peek > 1e-3) return { shown, base: shown + 1, moving: shown, roll: rollOf((r.peek * law.roll.peek) / (F.L - law.roll.rest), -law.roll.tilt), marksOn: 1, turning: false };
  return { shown, base: shown, moving: null, roll: null, marksOn: 0, turning: false };
}

/** The month the pad rolls toward: a hand's pending one, else the document's. */
export const targetOf = (r: PadRoll): number | null => r.pending ?? r.durable;

/** Start a turn: up (`dir` 1, from the corner's lift) or down (−1, the last month off the roll). False while one runs. */
export function startTurn(r: PadRoll, dir: 1 | -1, tilt: number, law: CalendarLaw, F: PadFrame, opts: { readonly hand?: boolean; readonly fast?: number; readonly drag?: { readonly s: number; readonly now: number } } = {}): boolean {
  if (r.turn !== null || r.shown === null) return false;
  const p0 = dir === 1 ? (r.peek * law.roll.peek) / (F.L - law.roll.rest) : 1;
  r.turn = {
    dir, p: p0, v: 0, target: dir === 1 ? 1 : 0, tilt: dir === 1 ? (r.peek > 0.05 ? -law.roll.tilt : tilt) : 0,
    drag: opts.drag === undefined ? null : { lastS: opts.drag.s, lastT: opts.drag.now, vs: 0, moved: false },
    fast: opts.fast ?? 1, hand: opts.hand === true,
  };
  r.peek = 0;
  r.peekV = 0;
  r.peekOn = false;
  return true;
}

/** A hand takes the sheet in motion mid-turn (the prototype's press on `moving`). */
export function grabMoving(r: PadRoll, s: number, now: number): boolean {
  const t = r.turn;
  if (t === null || t.drag !== null) return false;
  t.drag = { lastS: s, lastT: now, vs: 0, moved: false };
  return true;
}

/** The finger at `s` (the sheet point under it, from under the tape): the moving sheet follows it; `moved` once it has. */
export function dragTo(r: PadRoll, s: number, now: number, moved: boolean, law: CalendarLaw, F: PadFrame): void {
  const t = r.turn;
  if (t === null || t.drag === null) return;
  const d = t.drag;
  if (moved) d.moved = true;
  // the velocity follows the finger's MOVES (a frame it stands still is no sample — the pause before a release must read as a pause)
  if (s !== d.lastS) {
    const dt = Math.max((now - d.lastT) / 1000, 1e-3);
    d.vs = d.vs * 0.6 + ((s - d.lastS) / dt) * 0.4;
    d.lastS = s;
    d.lastT = now;
  }
  t.p = clamp01((F.L - s) / (F.L - law.roll.rest));
  t.v = 0;
}

/** Let go: a click takes the whole month (or brings it); a flick goes where it was flicked; else past a third it goes, short of it it falls back. */
export function letGo(r: PadRoll, now: number, law: CalendarLaw, F: PadFrame, cancel = false): void {
  const t = r.turn;
  if (t === null || t.drag === null) return;
  const d = t.drag;
  t.drag = null;
  // a hand that stopped before letting go threw nothing: the flick fades over the pause
  const vs = d.vs * Math.exp(-((now - d.lastT) / 1000) / 0.08);
  if (!d.moved && !cancel) t.target = t.dir === 1 ? 1 : 0;
  else if (vs < -260) t.target = 1;
  else if (vs > 260) t.target = 0;
  else t.target = t.dir === 1 ? (t.p > 0.3 ? 1 : 0) : t.p < 0.7 ? 0 : 1;
  t.v = -vs / Math.max(F.L - law.roll.rest, 1);
}

/**
 * Advance a pad's turning by `dt` seconds toward the document's month `durable`: the corner's peek, the turn's spring, its end (a
 * month rolled away or back — a hand's is `pending` and `rolled`), the next turn toward the target. True while anything moves.
 */
export function stepRoll(r: PadRoll, durable: number, dt: number, law: CalendarLaw, F: PadFrame): boolean {
  if (r.shown === null) r.shown = durable;
  r.durable = durable;
  // A hand's month is held only until the DOCUMENT speaks: its own word (the hand's commit landed) or another's (a peer's roll
  // won the race, LWW) — either way the pad follows the document from here. Held until the document echoed it EXACTLY, a lost
  // race left `pending` forever, and `targetOf` shadowed every later month the document took (D7 #3).
  const spoke = r.heard !== null && durable !== r.heard;
  r.heard = durable;
  if (r.pending !== null && (durable === r.pending || spoke)) r.pending = null;
  let live = false;
  const peekT = r.peekOn && r.turn === null ? 1 : 0;
  [r.peek, r.peekV] = spring(r.peek, r.peekV, peekT, law.springs.peek[0], law.springs.peek[1], dt);
  if (Math.abs(r.peek - peekT) < 1e-3 && Math.abs(r.peekV) < 1e-2) { r.peek = peekT; r.peekV = 0; } else live = true;
  const t = r.turn;
  if (t !== null) {
    live = true;
    if (t.drag === null) {
      [t.p, t.v] = spring(t.p, t.v, t.target, law.springs.roll[0] * t.fast, law.springs.roll[1], dt);
      if (Math.abs(t.p - t.target) < 2e-3 && Math.abs(t.v) < 0.02) {
        // the turn is over: a month rolled away (or back), or the sheet let go of
        const done = (t.dir === 1 && t.target === 1) || (t.dir === -1 && t.target === 0);
        if (done) {
          r.shown = (r.shown as number) + t.dir;
          if (t.hand) { r.pending = r.shown === durable ? null : r.shown; r.rolled = r.pending !== null; }
        }
        r.turn = null;
        const target = targetOf(r) as number;
        if (r.shown !== target) startToward(r, target, law, F, 1.6);
      }
    }
  } else {
    const target = targetOf(r);
    if (target !== null && r.shown !== target) { startToward(r, target, law, F, 1); live = true; }
  }
  return live;
}

/** A turn toward `target`, one month of the way, quicker the further it has to go. */
function startToward(r: PadRoll, target: number, law: CalendarLaw, F: PadFrame, base: number): void {
  const n = Math.abs(target - (r.shown as number));
  const dir: 1 | -1 = target > (r.shown as number) ? 1 : -1;
  startTurn(r, dir, dir === 1 ? -law.roll.tilt * 0.6 : 0, law, F, { fast: base + Math.min(n - 1, 6) * 0.5 });
}
