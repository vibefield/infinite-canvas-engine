// THE PEGBOARD'S LATTICE (design-017 §6.1–§6.2) — the research board's geometry (research/sdf-pegboard, shader.js
// `sdBoard` · `cellCoord` · `sdStadiumV`) in units of the PITCH, and the CPU half of the CARRY that keeps the pattern
// exact at any scroll. A PURE module: shaders/tray/tray.wgsl is the same arithmetic on the GPU; the tests and the rigs
// read this mirror.
//
// A board point is (x, Y) in pitches: x from the drawer's left edge, Y down the board from its top at scroll 0. Y is
// never formed as one float on the GPU: the scroll's whole rows are carried as an integer (`carry`) and the shader adds
// the rows on screen to it in i32, so every row index, every stagger parity and every noise lattice point is an exact
// integer however far down the board is scrolled.

/** The board in pitches (the research's unit, ≈ 20 mm): SKÅDIS-style vertical stadium holes, odd rows shifted half a pitch. */
export const PEG = {
  /** The stadium's radius and its straight half-length: a hole 0.26 × 0.66 of a pitch. */
  holeR: 0.13,
  holeHalf: 0.2,
  /** The smooth-max fillet on the punched rims. */
  rimK: 0.018,
  /** The hardboard's thickness, and the spacer gap to the wall behind it. */
  thick: 0.3,
  gap: 0.6,
  /** The phase (§6.1): holes at x = c + ¼ + ½·(r odd) from the drawer's left edge, rows at Y = r + ¾ below its top at scroll 0. */
  colPhase: 0.25,
  rowPhase: 0.75,
  /**
   * The solid BORDER along the sides (D-K3.1): a hole is punched only where its centre lies this far from both — as a manufactured
   * board's is. (Across both parities the holes stand every ½ pitch, so no phase alone keeps them all clear of a sawn side.)
   */
  border: 0.75,
} as const;

/**
 * The scroll's CARRY (§6.2): the shown scroll (CSS px, any size) split into whole ROWS — an integer the shader adds to its
 * rows on screen in i32 — and the FRACTION of a row, the only part of the scroll that ever enters an f32.
 */
export function carry(scroll: number, pitch: number): { readonly rowBase: number; readonly frac: number } {
  const rows = scroll / pitch;
  const rowBase = Math.floor(rows);
  if (!(Math.abs(rowBase) < 2 ** 31)) throw new Error(`tray: a scroll of ${scroll} px is past the i32 rows the carry holds`);
  return { rowBase, frac: rows - rowBase };
}

/** A board point as the shader forms it: `x` in pitches, `R` the whole row of Y (an integer), `fy` ∈ [0,1) the rest. */
export interface PegPoint {
  readonly x: number;
  readonly R: number;
  readonly fy: number;
}

/** A point on screen, on the board: `y` CSS px below the drawer's top, under the carry — `R` = rowBase + ⌊ly⌋ in integers (the shader's `peg_point`). */
export function pointAt(xPitches: number, yPx: number, pitch: number, c: { readonly rowBase: number; readonly frac: number }): PegPoint {
  const ly = yPx / pitch + c.frac;
  const fl = Math.floor(ly);
  return { x: xPitches, R: c.rowBase + fl, fy: ly - fl };
}

/** The hole nearest a board point — its row (the nearest row: a hole's half-height, 0.33, is under half a pitch), its column, and the point's offset from its centre. */
export interface PegCell {
  readonly row: number;
  readonly col: number;
  readonly odd: boolean;
  readonly qx: number;
  readonly qy: number;
}

/** The cell of a board point (the shader's `peg_hole`; half-up rounding throughout — WGSL's `round` ties to even, so neither side uses it). */
export function cellOf(p: PegPoint): PegCell {
  const dr = Math.floor(p.fy - PEG.rowPhase + 0.5);   // −1 or 0: the row whose centre is nearest
  const row = p.R + dr;
  const odd = (row & 1) !== 0;
  const hx = p.x - PEG.colPhase - (odd ? 0.5 : 0);
  const col = Math.floor(hx + 0.5);
  return { row, col, odd, qx: hx - col, qy: p.fy - dr - PEG.rowPhase };
}

/** Is the cell's hole punched on a board `width` pitches wide — its centre at least the border from both sides? (The shader's `peg_hole` answers the same.) */
export function punched(cell: PegCell, width: number): boolean {
  const x = cell.col + PEG.colPhase + (cell.odd ? 0.5 : 0);
  return x >= PEG.border && x <= width - PEG.border;
}

/** The vertical stadium's signed distance at an offset from its centre, pitches: negative inside the hole. */
export function holeSdf(qx: number, qy: number): number {
  const dy = qy - Math.min(Math.max(qy, -PEG.holeHalf), PEG.holeHalf);
  return Math.hypot(qx, dy) - PEG.holeR;
}

/** The centre of hole (row, col), in board pitches (x from the left edge, Y from the top at scroll 0) — the stagger's law. */
export function holeCentre(row: number, col: number): { readonly x: number; readonly y: number } {
  return { x: col + PEG.colPhase + ((row & 1) !== 0 ? 0.5 : 0), y: row + PEG.rowPhase };
}
