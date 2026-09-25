// The PEN's law — pure (BOARD.md §3): pointer samples in, marker STAMPS out. A stroke is a
// dense run of footprints along the path (the research whiteboard's input.ts, moved from
// device px into the melamine's world units): each stamp carries where it sits, the direction
// of travel, how far along the stroke it is, how much ink the felt still gives (it runs dry as
// the hand speeds up), its size (a pen's pressure; a held pen's bleed) and the stroke's fibre
// seed. Deterministic: the same samples make the same stamps, so a stroke's stamps ARE the
// stroke — the history keeps them, and an undo replays them into a fresh raster at whatever
// density the board is drawn at.

import type { RGB } from "../theme";
import { BOARD } from "../theme";

/** A stamp's floats: x, y (world units from the melamine's top-left) · dir x, y · s (arc length) · flow · size · seed. */
export const STAMP_FLOATS = 8;

/** A felt tip, world units: half extents (along the tip's long axis, across it), corner radius, edge softness, the angle it is held at (radians, screen space, y down). */
export interface Tip { readonly half: readonly [number, number]; readonly radius: number; readonly softness: number; readonly angle: number }

export type TipName = keyof typeof BOARD.tips;
export const TIP_NAMES: readonly TipName[] = ["fine", "bullet", "chisel"];
const deg = (d: number) => (d * Math.PI) / 180;
/** A tip from the theme's numbers (degrees → radians). */
export const tipOf = (t: { readonly half: readonly [number, number]; readonly radius: number; readonly softness: number; readonly angle: number }): Tip => ({ half: t.half, radius: t.radius, softness: t.softness, angle: deg(t.angle) });
export const TIPS: Record<TipName, Tip> = { fine: tipOf(BOARD.tips.fine), bullet: tipOf(BOARD.tips.bullet), chisel: tipOf(BOARD.tips.chisel) };
export const ERASER_TIP: Tip = tipOf(BOARD.eraser);

/** What lays the stamps down: a marker (its ink in LINEAR rgb, the coverage one pass lays) or the eraser. */
export interface Tool {
  readonly mode: "ink" | "erase";
  readonly color: RGB;
  readonly opacity: number;
  readonly tip: Tip;
  /** The felt's streaks, 0..1 — none for the eraser's own pattern. */
  readonly streak: number;
}

export interface FeltLaw {
  readonly streak: number;
  readonly lanes: number;
  readonly along: readonly [number, number];
  readonly dry: readonly [number, number];
  readonly dryLoss: number;
  readonly bleed: { readonly after: number; readonly grow: number; readonly tau: number };
  readonly pitch: { readonly k: number; readonly min: number; readonly max: number };
}
export const DEFAULT_FELT: FeltLaw = BOARD.felt;

export function markerTool(color: RGB, opacity: number, tip: Tip, felt: FeltLaw = DEFAULT_FELT): Tool {
  return { mode: "ink", color, opacity, tip, streak: felt.streak };
}
export const ERASER_TOOL: Tool = { mode: "erase", color: [0, 0, 0], opacity: 1, tip: ERASER_TIP, streak: 0 };

/** The distance between stamps for a tip: a fraction of its narrow half, clamped (world units). */
export const pitchOf = (tip: Tip, felt: FeltLaw = DEFAULT_FELT): number =>
  Math.min(felt.pitch.max, Math.max(felt.pitch.min, Math.min(tip.half[0], tip.half[1]) * felt.pitch.k));

const smoothstep = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * One stroke being drawn. `begin` at the press, `move` per pointer sample (coalesced events
 * in order), `hold` once a frame while the pen rests (its bleed), `end` at the lift. Times are
 * milliseconds (the events' own clock), positions the melamine's world units. `pending()`
 * hands the stamps made since the last call — what the pass uploads this frame — and
 * `stamps()` all of them, for the history.
 */
export class StrokeBuilder {
  readonly tool: Tool;
  readonly seed: number;
  readonly spacing: number;
  private readonly felt: FeltLaw;
  private buf = new Float32Array(STAMP_FLOATS * 1024);
  private n = 0;
  private sent = 0;
  private x = 0; private y = 0; private t = 0;
  private dirX = 1; private dirY = 0;
  private s = 0; private carry = 0; private speed = 0;
  private flow = 1; private size = 1;
  private lastMove = 0;
  private active = false;

  constructor(tool: Tool, seed: number, felt: FeltLaw = DEFAULT_FELT) {
    this.tool = tool; this.seed = seed; this.felt = felt;
    this.spacing = pitchOf(tool.tip, felt);
  }

  get count(): number { return this.n; }
  get live(): boolean { return this.active; }

  private push(x: number, y: number, dx: number, dy: number, s: number, flow: number, size: number): void {
    if ((this.n + 1) * STAMP_FLOATS > this.buf.length) { const b = new Float32Array(this.buf.length * 2); b.set(this.buf); this.buf = b; }
    const o = this.n * STAMP_FLOATS;
    const b = this.buf;
    b[o] = x; b[o + 1] = y; b[o + 2] = dx; b[o + 3] = dy; b[o + 4] = s; b[o + 5] = flow; b[o + 6] = size; b[o + 7] = this.seed;
    this.n += 1;
  }

  /** The press: the first footprint, where the tip lands. */
  begin(x: number, y: number, t: number, size = 1): void {
    this.active = true;
    this.x = x; this.y = y; this.t = t; this.lastMove = t;
    this.dirX = 1; this.dirY = 0; this.s = 0; this.carry = this.spacing; this.speed = 0;
    this.flow = 1; this.size = size;
    this.push(x, y, 1, 0, 0, 1, size);
  }

  /** A pointer sample: footprints every `spacing` along the segment since the last, the flow and size interpolated. */
  move(x: number, y: number, t: number, size = this.size): void {
    if (!this.active) return;
    const dx = x - this.x;
    const dy = y - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist < this.spacing * 0.25) return;
    const dt = Math.max(1, t - this.t);
    const v = (dist / dt) * 1000;   // world units / s
    this.speed += (v - this.speed) * 0.35;
    const flow = 1 - this.felt.dryLoss * smoothstep(this.felt.dry[0], this.felt.dry[1], this.speed);
    const ux = dx / dist;
    const uy = dy / dist;
    let p = this.carry;
    while (p <= dist) {
      const k = p / dist;
      this.push(this.x + ux * p, this.y + uy * p, ux, uy, this.s + p, this.flow + (flow - this.flow) * k, this.size + (size - this.size) * k);
      p += this.spacing;
    }
    this.carry = p - dist;
    this.s += dist;
    this.x = x; this.y = y; this.t = t; this.lastMove = t;
    this.dirX = ux; this.dirY = uy;
    this.flow = flow; this.size = size;
  }

  /** The pen held still: past `bleed.after` ms the ink spreads into the melamine, growing toward `1 + grow`. */
  hold(now: number): void {
    if (!this.active) return;
    const idle = now - this.lastMove - this.felt.bleed.after;
    if (idle <= 0) return;
    const grow = 1 + this.felt.bleed.grow * (1 - Math.exp(-idle / this.felt.bleed.tau));
    this.push(this.x, this.y, this.dirX, this.dirY, this.s, 1, this.size * grow);
  }

  /** The lift: the last sample's footprints; the stroke is complete. */
  end(x?: number, y?: number, t?: number, size?: number): void {
    if (x !== undefined && y !== undefined && t !== undefined) this.move(x, y, t, size);
    this.active = false;
  }

  /** The stamps made since the last call (a view — copy it before the next push). */
  pending(): Float32Array {
    const out = this.buf.subarray(this.sent * STAMP_FLOATS, this.n * STAMP_FLOATS);
    this.sent = this.n;
    return out;
  }

  /** Every stamp of the stroke, as its own array. */
  stamps(): Float32Array { return this.buf.slice(0, this.n * STAMP_FLOATS); }
}

/** A stroke's path for a reader — an agent, an export: one point per `every` stamps, world units from the melamine's top-left. */
export function pathOf(stamps: Float32Array, every = 6): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [];
  const n = stamps.length / STAMP_FLOATS;
  for (let i = 0; i < n; i += every) out.push([stamps[i * STAMP_FLOATS] as number, stamps[i * STAMP_FLOATS + 1] as number]);
  if (n > 0 && (n - 1) % every !== 0) out.push([stamps[(n - 1) * STAMP_FLOATS] as number, stamps[(n - 1) * STAMP_FLOATS + 1] as number]);
  return out;
}
