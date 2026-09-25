// The calendar pass's GPU records, declared once (`defineStruct`). `CalUniforms` is the pass's knobs,
// the desk eye and the print's tile pyramid (its counts per level); `CalPad` is one calendar: its
// placement, its lamp, its build, the roll of the sheet in motion, the two sheets in play (the one
// on the pad — BASE — and the one rolling — MOVING: their grids, their tile tables), the marks the
// host draws on the sheet (the days selected, the entry selected, the caret, the newest glyph's wipe,
// the day a note would stick to) and its palette. The camera, the light and the gobo arrive through
// the mat's block (`MatUniforms`), as for the notebook — the pad is lit like the mat it lies on.

import { defineStruct } from "../engine/struct";
import type { RGB } from "../theme";
import type { CalendarLaw } from "./law";
import { GUTTER, LEVELS, TILE, TILE_TEX, type TileGrid } from "./tiles";

export const CalUniforms = defineStruct("CalUniforms", [
  ["eye", "vec4f"],      // the desk eye: foot x, y (world), height (world), zoom
  ["view", "vec4f"],     // viewport w, h (CSS px), the depth range's near and far
  ["light", "vec4f"],    // the sky's share, the lambert's cap, the dapple's share on paper, on cloth
  ["shadow", "vec4f"],   // σ at contact, σ per unit of height, the cast's alpha on the mat, the contact's alpha
  ["shadow2", "vec4f"],  // the contact's σ, unused, unused, dpr
  ["paper", "vec4f"],    // fibre, mottle, tooth, cockle
  ["cloth", "vec4f"],    // the weave's pitch, its relief, the sheen's exponent and strength
  ["castCol", "vec4f"],  // what a shadow is made of on this ground
  ["select", "vec4f"],   // the ring's colour, its width (CSS px)
  ["ring", "vec4f"],     // the ring's offset (CSS px), the debug bits, the rule's width, the heading rule's width (world)
  ["alpha", "vec4f"],    // the rules, the heading rule, the weekend's wash, a neighbour month's wash
  ["tiles", "vec4f"],    // entries in one sheet's table, a tile's texels, its gutter, its texture's side
  ["tileNx", "array<vec4f, 3>"],   // tiles across a sheet, by level (11)
  ["tileNy", "array<vec4f, 3>"],   // tiles down
  ["tileOff", "array<vec4f, 3>"],  // where a level's entries start in a sheet's table
] as const);

export const CalPad = defineStruct("CalPad", [
  ["model", "mat4x4f"],  // pad → world
  ["inv", "mat4x4f"],    // world → pad
  ["lamp", "vec4f"],     // the unit direction to the lamp (world), unused
  ["size", "vec4f"],     // the sheet's W, H; the tape's depth T; the free length L = H − T
  ["z", "vec4f"],        // the board's top, the pad's face (the base sheet), the moving sheet's face, the tape's top
  ["roll", "vec4f"],     // the moving sheet: its tangent line's a, tilt α, pivot x; the core's radius
  ["roll2", "vec4f"],    // τ (a turn's thinning), the turns drawn (radians), a sheet is moving (0/1), the past roll's radius
  ["gridA", "vec4f"],    // the BASE sheet's grid: x0, y0, a cell's w, h
  ["gridB", "vec4f"],    // … its rows, its weekend columns (a bit mask), the cells before the 1st, the month's days
  ["gridC", "vec4f"],    // the MOVING sheet's grid, the same
  ["gridD", "vec4f"],
  ["slots", "vec4f"],    // the base's and the moving sheet's tile tables (−1 = none), the sheet the marks are on (0 base, 1 moving), the ring's presence
  ["sel", "array<vec4f, 6>"],   // the days selected: up to six boxes (a range, a box a week), x0 y0 x1 y1 on the sheet
  ["mark", "vec4f"],     // the entry selected: its box
  ["drop", "vec4f"],     // the day a note held over the pad would stick to
  ["caret", "vec4f"],    // the pen's caret: x, top, bottom, its width (0 = hidden)
  ["wipe", "vec4f"],     // the newest glyph's box
  ["wipe2", "vec4f"],    // its progress (0 … 1; ≥ 1 = none), a seed, the lift, how many of `sel` are boxes
  ["recv", "vec4f"],     // the mat's rect this pad darkens (world)
  ["col0", "vec4f"], ["col1", "vec4f"], ["col2", "vec4f"], ["col3", "vec4f"], ["col4", "vec4f"],
  ["col5", "vec4f"], ["col6", "vec4f"], ["col7", "vec4f"], ["col8", "vec4f"],
] as const);

export const MAX_CALENDARS = 4;
/** Two sheets in play per calendar: its base's table and its moving sheet's. */
export const TABLE_SLOTS = MAX_CALENDARS * 2;

/** A calendar's colours, as the pass takes them (lab/theme.ts `calendarLook`). */
export interface CalendarColours {
  readonly paper: RGB; readonly ink: RGB; readonly muted: RGB; readonly weekend: RGB; readonly hot: RGB;
  readonly chipboard: RGB; readonly cloth: RGB; readonly foil: RGB;
  /** The pen the caret is drawn in. */
  readonly pen: RGB;
}

const pad4 = (a: readonly number[], n: number): number[] => { const o = a.slice(0, n); while (o.length < n) o.push(0); return o; };

/** The pass's knobs by name. */
export function calUniformValues(law: CalendarLaw, eye: { eye: number[]; view: number[] }, dpr: number, cast: RGB, select: RGB, alpha: { readonly rule: number; readonly head: number; readonly weekend: number; readonly outside: number }, grid: TileGrid, debug: number) {
  return {
    eye: eye.eye, view: eye.view,
    light: [law.light.ambient, law.light.cap, law.light.dapple, law.light.clothDapple],
    shadow: [law.shadow.sigma0, law.shadow.perUnit, law.shadow.alpha, law.shadow.contact],
    shadow2: [law.shadow.contactSigma, 0, 0, dpr],
    paper: [law.paper.fibre, law.paper.mottle, law.paper.tooth, law.paper.cockle],
    cloth: [law.cloth.pitch, law.cloth.relief, law.cloth.sheen[0], law.cloth.sheen[1]],
    castCol: [...cast, 1],
    select: [...select, law.ring.width],
    ring: [law.ring.offset, debug, law.grid.rule, law.grid.head],
    alpha: [alpha.rule, alpha.head, alpha.weekend, alpha.outside],
    tiles: [grid.count, TILE, GUTTER, TILE_TEX],
    tileNx: pad4(grid.nx, 12), tileNy: pad4(grid.ny, 12), tileOff: pad4(grid.offset, 12),
  };
}

void LEVELS;
