// The PAD — the calendar as a thing on the desk (CALENDAR.md §4): its build and its static mesh. Pure.
//
// Pad coordinates: centred, x across, y DOWN the pad (the tape at −H/2), z up off the desk. From
// the bottom: a chipboard back (`board`), the block of the months to come (its sheets' edges on the
// sides), the month showing on top — the BASE sheet, one quad printed by the shader — and across the
// head the cloth TAPE they are bound under, wrapped over the top edge. Lying on the pad under the
// tape, always, the ROLL of the months before (roll.ts: the spiral of a whole sheet wound, at rest
// against the tape). The sheet in motion is not here: it is a fine grid bent by the roll on the GPU
// (`movingGrid`). The mesh uses the notebook's vertex (16 floats) and writer; its uv are SHEET
// coordinates in world units (x from the left edge, y from the head), so the print, the paper and the
// weave are laid the same way on every face.

import type { CalendarLaw } from "./law";
import { sheetSize } from "./law";
import { type BuiltMesh, FLAG_TWO_SIDED, type MeshWriter } from "@ice/desk/kit";
import { rollPoint, rollState } from "./roll";

/** The materials, by the number a vertex carries. */
export const CMAT = { base: 0, moving: 1, past: 2, edge: 3, board: 4, tape: 5 } as const;

export interface PadFrame {
  readonly W: number;
  readonly H: number;
  /** The tape's depth down the head, and the sheet's free length below it. */
  readonly T: number;
  readonly L: number;
  /** The board's top, the pad's face (the base sheet), the moving sheet's face, the tape's top. */
  readonly zb: number;
  readonly zt: number;
  readonly zm: number;
  readonly zTape: number;
  /** The past roll's radius, and how much of its spiral is drawn (radians). */
  readonly rest: number;
  readonly turns: number;
}

export function padFrame(law: CalendarLaw): PadFrame {
  const { W, H } = sheetSize(law);
  const T = law.sheet.tape;
  const zb = law.pad.board;
  const zt = zb + law.pad.block * law.pad.sheet;
  return { W, H, T, L: H - T, zb, zt, zm: zt + law.pad.sheet, zTape: zt + 0.5, rest: law.roll.rest, turns: law.roll.turns * 2 * Math.PI };
}

/** A sheet point (x from the left edge, s down from the tape's edge) → pad coordinates. */
export const padOf = (F: PadFrame, sx: number, s: number, z: number): readonly [number, number, number] => [sx - F.W / 2, -F.H / 2 + F.T + s, z];

/**
 * The pad's static mesh: the board's and the block's sides, the base sheet, the tape, the past roll.
 * Rebuilt only when the law changes; the pad moves by its matrix.
 */
export function buildPad(m: MeshWriter, F: PadFrame, law: CalendarLaw): BuiltMesh & { readonly sheetFirst: number; readonly rollFirst: number } {
  m.reset();
  const { W, H, T, zb, zt, zm, zTape } = F;
  const x0 = -W / 2;
  const x1 = W / 2;
  const y0 = -H / 2;
  const y1 = H / 2;
  // a face: four corners (counter-clockwise seen from outside), its normal, its uv at each corner, material
  const face = (p: readonly (readonly [number, number, number])[], n: readonly [number, number, number], uv: readonly (readonly [number, number])[], mat: number, flags = 0, ao = 1) => {
    const i = p.map((q, k) => m.vert(q[0], q[1], q[2], n[0], n[1], n[2], (uv[k] as readonly [number, number])[0], (uv[k] as readonly [number, number])[1], mat, 0, flags, ao, 1, 1));
    m.quad(i[0] as number, i[1] as number, i[2] as number, i[3] as number);
  };
  // ---- the board's sides (chipboard), and the block's (the months to come, edge on)
  const sides = (za: number, zc: number, mat: number, skipHead: boolean) => {
    face([[x0, y1, za], [x1, y1, za], [x1, y1, zc], [x0, y1, zc]], [0, 1, 0], [[0, za], [W, za], [W, zc], [0, zc]], mat);            // the foot
    face([[x1, y1, za], [x1, y0, za], [x1, y0, zc], [x1, y1, zc]], [1, 0, 0], [[H, za], [0, za], [0, zc], [H, zc]], mat);            // the right
    face([[x0, y0, za], [x0, y1, za], [x0, y1, zc], [x0, y0, zc]], [-1, 0, 0], [[0, za], [H, za], [H, zc], [0, zc]], mat);          // the left
    if (!skipHead) face([[x1, y0, za], [x0, y0, za], [x0, y0, zc], [x1, y0, zc]], [0, -1, 0], [[W, za], [0, za], [0, zc], [W, zc]], mat);
  };
  sides(0, zb, CMAT.board, false);
  sides(zb, zt, CMAT.edge, true);
  // ---- the tape: its face, its lip over the sheets, the head it wraps, its ends
  face([[x0, y0, zTape], [x1, y0, zTape], [x1, y0 + T, zTape], [x0, y0 + T, zTape]], [0, 0, 1], [[0, 0], [W, 0], [W, T], [0, T]], CMAT.tape);
  face([[x0, y0 + T, zTape], [x1, y0 + T, zTape], [x1, y0 + T, zt], [x0, y0 + T, zt]], [0, 1, 0], [[0, T], [W, T], [W, T + zTape - zt], [0, T + zTape - zt]], CMAT.tape);
  face([[x1, y0, 0], [x0, y0, 0], [x0, y0, zTape], [x1, y0, zTape]], [0, -1, 0], [[W, -zTape], [0, -zTape], [0, 0], [W, 0]], CMAT.tape);
  face([[x1, y0 + T, 0], [x1, y0, 0], [x1, y0, zTape], [x1, y0 + T, zTape]], [1, 0, 0], [[W + T, 0], [W, 0], [W, zTape], [W + T, zTape]], CMAT.tape);
  face([[x0, y0, 0], [x0, y0 + T, 0], [x0, y0 + T, zTape], [x0, y0, zTape]], [-1, 0, 0], [[0, 0], [T, 0], [T, zTape], [0, zTape]], CMAT.tape);
  // ---- the PAPER from here on (its own shader): the base sheet — the month on the pad, from under the tape's edge to the foot
  const sheetFirst = m.ni;
  face([[x0, y0 + T, zt], [x1, y0 + T, zt], [x1, y1, zt], [x0, y1, zt]], [0, 0, 1], [[0, T], [W, T], [W, H], [0, H]], CMAT.base);
  // ---- the past roll: the flat of the months rolled up, then their spiral — its outer turns (the rest is inside)
  const rollFirst = m.ni;
  const R = rollState(1, law.roll, F.L, W, 0);
  const rows: number[] = [];
  rows.push(0, R.a);
  const steps = Math.ceil((F.turns / (2 * Math.PI)) * 72);
  for (let i = 1; i <= steps; i++) {
    const phi = (F.turns * i) / steps;
    const Rr = F.rest;
    rows.push(R.a + Rr * phi - (R.tau * phi * phi) / (4 * Math.PI));
  }
  const first = m.nv;
  for (const s of rows) {
    for (const sx of [0, W]) {
      const q = rollPoint(R, sx, s);
      const [px, py, pz] = padOf(F, q.x, q.s, zm + q.z);
      m.vert(px, py, pz, q.nx, q.ns, q.nz, q.x, T + s, CMAT.past, 0, FLAG_TWO_SIDED, 1, 1, 1);
    }
  }
  m.gridQuads(first, 2, rows.length);
  return { vertices: m.v, indices: m.ix, vcount: m.nv, icount: m.ni, min: [m.min[0], m.min[1], m.min[2]], max: [m.max[0], m.max[1], m.max[2]], sheetFirst, rollFirst };
}

/** The moving sheet's grid: (u, v) in [0, 1]², `cols` × `rows` quads; the vertex shader lays it on the sheet and rolls it. */
export function movingGrid(cols: number, rows: number): { readonly vertices: Float32Array<ArrayBuffer>; readonly indices: Uint32Array<ArrayBuffer> } {
  const vertices = new Float32Array((cols + 1) * (rows + 1) * 2);
  let o = 0;
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) { vertices[o++] = i / cols; vertices[o++] = j / rows; }
  const indices = new Uint32Array(cols * rows * 6);
  let k = 0;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = j * (cols + 1) + i;
    const b = a + 1;
    const c = a + cols + 2;
    const d = a + cols + 1;
    indices[k++] = a; indices[k++] = b; indices[k++] = c; indices[k++] = a; indices[k++] = c; indices[k++] = d;
  }
  return { vertices, indices };
}
