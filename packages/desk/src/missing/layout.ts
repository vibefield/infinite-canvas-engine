// THE MISSING FACE's record (petition I24): the object's box as the desk holds it — centred, world units, square to the mat — the
// ink of the theme in force, the object's fade (a deleted one fades as every ghost does), and the face's law (theme.ts `MISSING`).
// One function makes it for both hosts — the builder (through `MISSING_OBJECT`, object.ts) and the Node oracle's scene builder — so
// the face a still pins is the face the world draws.

import { defineStruct } from "../engine/struct";
import type { ObjectRect } from "../kinds/world";
import { type GroundTheme, MISSING, type RGB, rgb } from "../theme";

/** The face's record as the pass's WGSL reads it (shaders/missing/missing-pass.wgsl). */
export const MissingFace = defineStruct("MissingFace", [
  ["rect", "vec4f"],    // centre x, y; half extents x, y — world units
  ["ink", "vec4f"],     // the ink (rgb), the object's fade (w)
  ["mix", "vec4f"],     // the wash's, the hatching's and the edge's alpha
  ["shape", "vec4f"],   // the corner (world units); the hatching's pitch and weight, the edge's weight (CSS px)
] as const);

/** What the missing face draws for one object: its box, its ink and its fade. `missing` brands it — the pass draws nothing else. */
export interface MissingRecord {
  readonly missing: true;
  readonly cx: number;
  readonly cy: number;
  readonly hx: number;
  readonly hy: number;
  readonly ink: RGB;
  readonly fade: number;
}

/** Is this record the missing face's? (A kind's own record handed to its missing pass — the frame before a quarantine took — is not.) */
export const isMissingRecord = (r: unknown): r is MissingRecord => typeof r === "object" && r !== null && (r as { missing?: unknown }).missing === true;

const INKS: Readonly<Record<string, RGB>> = { light: rgb(MISSING.ink.light), dark: rgb(MISSING.ink.dark) };

/** The face of an object whose box is `rect` (centred, world units) under `theme`, at `fade` (1 whole … 0 gone). */
export function missingFace(rect: ObjectRect, theme: Pick<GroundTheme, "name">, fade = 1): MissingRecord {
  return { missing: true, cx: rect.cx, cy: rect.cy, hx: Math.abs(rect.w) / 2, hy: Math.abs(rect.h) / 2, ink: INKS[theme.name] ?? (INKS.light as RGB), fade };
}

const NONE = { rect: [0, 0, 0, 0], ink: [0, 0, 0, 0], mix: [0, 0, 0, 0], shape: [0, 0, 0, 0] };

/** The record's values by field — a record that is not the face's packs as nothing (fade 0: the vertex stage collapses it). */
export function missingValues(r: unknown): { rect: number[]; ink: number[]; mix: number[]; shape: number[] } {
  if (!isMissingRecord(r)) return NONE;
  return {
    rect: [r.cx, r.cy, r.hx, r.hy],
    ink: [r.ink[0], r.ink[1], r.ink[2], r.fade],
    mix: [MISSING.wash, MISSING.hatch, MISSING.edge, 0],
    shape: [MISSING.corner, MISSING.pitch, MISSING.weight, MISSING.edgeWeight],
  };
}

/** The face's pick: the object itself (`content` — a tap selects it, a drag moves it) anywhere in its box; else a miss. */
export function missingHit(g: ObjectRect, wx: number, wy: number): "content" | null {
  return Math.abs(wx - g.cx) <= Math.abs(g.w) / 2 && Math.abs(wy - g.cy) <= Math.abs(g.h) / 2 ? "content" : null;
}
