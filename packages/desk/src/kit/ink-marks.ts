// THE MARKS READ ON THE CPU, AND THE WASH REWRITTEN ALONE (petition I60 — the marks drawn: highlight, strike, underline, the
// selection's wash). `inkMarksAt` is the kit's `ink_marks` (shaders/kit/marks.wgsl) on the CPU: the same arithmetic over the same
// vec4s of a run's marks section (kit/ink-strokes.ts says them), for tests and hit tests. `inkWash` is what a SELECTION CHANGE
// writes: the marks' head and one vec4 a laid line — nothing else of the run, so the selection, flux that changes on every drag,
// costs a few texels, never a run rebuilt (kit/hand-gpu.ts `HandRuns.wash` writes them into the store; `washRun` lays them into a
// copy of the run, for the twin).

import { type HandRun, handEase } from "./hand-run";
import type { InkSpan } from "./ink";
import { INK_MARKS, INK_WASH, inkCentre, washLines } from "./ink-strokes";

/** What a sheet's marks laid at a point (`ink_marks`'s `InkMarks`): under the ink, over it, and what the read took. */
export interface InkMarksAt {
  /** The highlighters' cover, 0..1 (its presence in it) — the most any laid — and which (n `HIGHLIGHTERS[n − 1]`; 0 none). */
  readonly marker: number;
  readonly tint: number;
  /** The selection's wash, 0..1 (the kind lays its pencil at its own presence). */
  readonly wash: number;
  /** The lines' cover over the ink, 0..1 (its presence in it) — the most any laid — and their pen (0 the sheet's own, n `PENS[n − 1]`). */
  readonly line: number;
  readonly pen: number;
  /** Run texels the read loaded (one on paper without marks). */
  readonly loads: number;
}

const sat = (v: number): number => Math.min(1, Math.max(0, v));

/** A laid line's wash at a point (`ink_wash`): its rect grown across by `INK_WASH.pad` em, its corners rounded. */
function washAt(x0: number, y0: number, x1: number, y1: number, x: number, y: number, em: number, ramp: number): number {
  const hx = 0.5 * (x1 - x0) + INK_WASH.pad * em;
  const hy = 0.5 * (y1 - y0);
  const k = Math.min(INK_WASH.radius * em, hx, hy);
  const qx = Math.abs(x - 0.5 * (x0 + x1)) - hx + k;
  const qy = Math.abs(y - 0.5 * (y0 + y1)) - hy + k;
  const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - k;
  return sat(0.5 - d / ramp);
}

/** How much of a stroke the pen has drawn at `u` along it (`ink_drawn`). */
function drawnAt(start: number, dur: number, h0: number, h1: number, u: number, t: number, len: number, aa: number): number {
  const since = t - start;
  if (since >= dur || (u >= h0 && u <= h1)) return 1;
  if (since <= 0) return 0;
  const lo = h0 <= 0.004 ? h1 : 0;
  const hi = h1 >= 0.996 ? h0 : 1;
  return sat(0.5 + ((lo + (hi - lo) * handEase(since / dur) - u) * len) / aa);
}

/**
 * `ink_marks` on the CPU — the same arithmetic over the same vec4s: what a run's marks lay at `(x, y)` (the run's units) at `now`
 * (ms on the desk's clock), `aa` units a device pixel. A run built without an ink reads nothing, in one load.
 */
export function inkMarksAt(run: HandRun | Float32Array, x: number, y: number, now: number, aa: number): InkMarksAt {
  const d = run instanceof Float32Array ? run : run.data;
  const v = (i: number, c: number): number => d[4 * i + c] as number;
  let marker = 0;
  let tint = 0;
  let wash = 0;
  let line = 0;
  let pen = 0;
  let loads = 1;
  const out = (): InkMarksAt => ({ marker, tint, wash, line, pen, loads });
  const H = INK_MARKS.head;
  const washed = y >= v(H, 2) && y < v(H, 3);
  if (v(H, 0) === 0 || (v(H, 1) === 0 && !washed)) return out();
  const at = v(H, 0);
  loads += 1;
  const fr = (y - v(at, 0)) * v(at, 1);
  if (fr < 0 || fr >= v(at, 2)) return out();
  const row = at + 1 + Math.floor(fr);
  loads += 1;
  const em = 1 / v(at, 1);
  const ramp = Math.min(aa, INK_MARKS.ramp * em);
  if (washed) {
    for (let l = v(row, 2); l < v(row, 3); l++) {
      const r = at + v(at, 3) + l;
      loads += 1;
      if (v(r, 2) > v(r, 0)) wash = Math.max(wash, washAt(v(r, 0), v(r, 1), v(r, 2), v(r, 3), x, y, em, ramp));
    }
  }
  const n = v(row, 1);
  if (n === 0) return out();
  loads += 1;
  const t = now - (v(2, 2) * 1000 + v(2, 3));
  const strokes = at + 1 + v(at, 2);
  const list = strokes + INK_MARKS.stroke * v(H, 1);
  const first = v(row, 0);
  for (let k = 0; k < n; k++) {
    const e = first + k;
    if (k === 0 || (e & 3) === 0) loads += 1;
    const s = strokes + (d[4 * (list + (e >> 2)) + (e & 3)] as number) * INK_MARKS.stroke;
    loads += 1;
    const [x0, x1, y0, reach0] = [v(s, 0), v(s, 1), v(s, 2), v(s, 3)];
    const reach = reach0 + 0.5 * ramp;
    if (x < x0 - reach || x > x1 + reach || Math.abs(y - y0) > reach) continue;
    loads += 3;
    const [hw, slope, amp, press] = [v(s + 1, 0), v(s + 1, 1), v(s + 1, 2), v(s + 1, 3)];
    const [p1, p2, lean, code] = [v(s + 2, 0), v(s + 2, 1), v(s + 2, 2), v(s + 2, 3)];
    const c = inkCentre({ x0, x1, y: y0, slope, amp, p1, p2 }, x, em);
    const xc = Math.min(x1, Math.max(x0, x));
    const len = Math.max(x1 - x0, 1e-6);
    let cover: number;
    let u: number;
    if ((code & 3) === 0) {
      // a highlighter's band: measured straight down from its centre line, its ends cut on the chisel's lean
      const l = (y - c.y) * lean;
      cover = sat(0.5 - Math.max(Math.abs(y - c.y) - hw, x0 + l - x, x - (x1 + l)) / ramp) * press;
      u = sat((x - l - x0) / len);
    } else {
      // a pen line: the distance to its centre line, its ends round
      cover = sat(0.5 - (Math.hypot(x - xc, (y - c.y) / Math.sqrt(1 + c.dy * c.dy)) - hw) / ramp) * press;
      u = (xc - x0) / len;
    }
    if (cover <= 0) continue;
    const drawn = drawnAt(v(s + 3, 0), v(s + 3, 1), v(s + 3, 2), v(s + 3, 3), u, t, x1 - x0, aa);
    let laid = cover * drawn;
    let value = (code >> 2) & 7;
    if (code >> 5 > 0) {
      // a recolour: the value it had shows where the pen has not reached yet
      laid = cover;
      if (drawn < 0.5) value = (code >> 5) - 1;
    }
    if ((code & 3) === 0) {
      if (laid > marker) { marker = laid; tint = value; }
    } else if (laid > line) {
      line = laid;
      pen = value;
    }
  }
  return out();
}

/** A selection's WASH as a run takes it: the marks' head as it now reads and one vec4 a laid line — what `HandRuns.wash` writes. */
export interface InkWash {
  /** The marks' head (`k0`): written at the run's base + `INK_MARKS.head`. */
  readonly head: Float32Array;
  /** Where the lines begin, vec4s from the run's base (`HandRun.marks.washAt`). */
  readonly at: number;
  /** One vec4 a laid line: `x0 y0 x1 y1` (x1 ≤ x0: none). */
  readonly lines: Float32Array;
}

/**
 * The WASH of `spans` (kit/ink.ts `spansOf` over the layout the run was built from: one rect a laid line the selection touches)
 * for `run` — the only vec4s of it a selection change rewrites. A run built without an ink has no room for one (it throws).
 */
export function inkWash(run: HandRun, spans: readonly InkSpan[]): InkWash {
  const mk = run.marks;
  if (mk === undefined) throw new Error("inkWash: the run has no marks section — build it with handRun(layout, atlas, { ink })");
  const w = washLines(mk.lines, spans, mk.em);
  return { head: new Float32Array([mk.at, mk.strokes, w.extent[0], w.extent[1]]), at: mk.washAt, lines: w.lines };
}

/** A copy of `run` with `wash` laid in — what the store holds once `HandRuns.wash` has written it (for the twin, and tests). */
export function washRun(run: HandRun, wash: InkWash): HandRun {
  const data = run.data.slice();
  data.set(wash.head, 4 * INK_MARKS.head);
  data.set(wash.lines, 4 * wash.at);
  return { ...run, data };
}
