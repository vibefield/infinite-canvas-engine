// The notebook's MESH — the shape (`shape.ts`) as triangles, in book-local coordinates
// (NOTEBOOK.md §3). Pure: typed arrays out, no GPU. Rebuilt only when the pose changes; a
// book carried across the desk keeps its mesh and moves by its matrix.
//
// A vertex is 16 floats: position · normal · uv · (material, page, flags, ao) · the face's
// size in world units (what uv is a fraction of) · two extras. The shader reads a material
// by number (`MAT`) — the case's cloth, its endpapers, a board's edge, a page, a stack's
// edge, the spine — and the uv in that face's own world units, so the weave, the fibre and
// the ruling stay the same size on every face.

import { type BuiltMesh, FLAG_TWO_SIDED, type MeshWriter } from "@ice/desk/kit";
import type { NotebookLaw } from "./law";
import { type CoverFrame, coverFrame, curveAt, curveTable, type Frame, type NotebookPose, pageRows, relaxOf, restSheet, ride, rideDir, sampleAir, sampleRest, sheetSamples, swingOf } from "./shape";

/** The materials, by the number a vertex carries. */
export const MAT = { cover: 0, endpaper: 1, board: 2, page: 3, edge: 4, spine: 5, ribbon: 6 } as const;

// the writer is the kit's (K4a — the calendar's pad builds with it too); the book keeps its door for its own files
export { type BuiltMesh, FLAG_TWO_SIDED, MeshWriter, VERTEX_BYTES, VERTEX_FLOATS } from "@ice/desk/kit";

// ---------------------------------------------------------------- outlines

/** A point on an outline: position, outward normal, arc length so far. */
interface OutlinePoint { readonly u: number; readonly v: number; readonly nu: number; readonly nv: number; readonly l: number }

/**
 * The outline of a face with its two fore-edge corners rounded: from (0, −h/2) along the head,
 * round the corner, down the fore-edge, round, back along the tail to (0, h/2). The spine
 * side (u = 0) is not walked — the spine or the gutter is there.
 */
function foreOutline(w: number, h: number, r: number, headSegs: number, arcSegs: number, foreSegs: number, headAt?: ArrayLike<number>): OutlinePoint[] {
  const pts: OutlinePoint[] = [];
  const hy = h / 2;
  const rr = Math.min(r, w, hy);
  let l = 0;
  let pu = 0;
  let pv = -hy;
  const push = (u: number, v: number, nu: number, nv: number) => { l += Math.hypot(u - pu, v - pv); pu = u; pv = v; pts.push({ u, v, nu, nv, l }); };
  pts.push({ u: 0, v: -hy, nu: 0, nv: -1, l: 0 });
  const head: number[] = [];
  if (headAt) { for (let i = 0; i < headAt.length; i++) { const s = headAt[i] as number; if (s > 1e-6 && s < w - rr - 1e-6) head.push(s); } }
  else for (let i = 1; i < headSegs; i++) head.push(((w - rr) * i) / headSegs);
  for (const s of head) push(s, -hy, 0, -1);
  for (let i = 0; i <= arcSegs; i++) { const a = -Math.PI / 2 + (Math.PI / 2) * (i / arcSegs); push(w - rr + rr * Math.cos(a), -hy + rr + rr * Math.sin(a), Math.cos(a), Math.sin(a)); }
  for (let i = 1; i < foreSegs; i++) push(w, -hy + rr + ((2 * hy - 2 * rr) * i) / foreSegs, 1, 0);
  for (let i = 0; i <= arcSegs; i++) { const a = (Math.PI / 2) * (i / arcSegs); push(w - rr + rr * Math.cos(a), hy - rr + rr * Math.sin(a), Math.cos(a), Math.sin(a)); }
  for (let i = head.length - 1; i >= 0; i--) push(head[i] as number, hy, 0, 1);
  push(0, hy, 0, 1);
  return pts;
}

// ---------------------------------------------------------------- the case

/**
 * A board: a slab `b` thick with its fore-edge corners rounded. `place(u, w)` maps the board's
 * own (u across from the spine edge, w through it from the inner face) to book x, z; `dirU`,
 * `dirW` are its axes in x–z. Emits the inner face (an endpaper), the outer face (the cloth —
 * the design on the front board), and the walls (the cloth wrapped over the board's edge,
 * its rims rounded by their normals).
 */
function board(m: MeshWriter, F: Frame, place: (u: number, w: number) => readonly [number, number], dirU: readonly [number, number], dirW: readonly [number, number], which: 0 | 1, outer: boolean, stacked: boolean): void {
  const W = F.W;
  const H = F.H;
  const b = F.b;
  const ol = foreOutline(W, H, F.spec.coverRadius, 6, 8, 8);
  // the faces: a fan from the middle over the closed polygon (the outline and the spine edge)
  for (const [w, sign, mat] of [[0, -1, 1], [b, 1, 0]] as const) {
    if (mat === 0 && !outer) continue;
    const [cx, cz] = place(W / 2, w);
    const nx = dirW[0] * sign;
    const nz = dirW[1] * sign;
    const e1 = mat === 1 && stacked ? 1 : 0;
    const c = m.vert(cx, 0, cz, nx, 0, nz, 0.5, 0.5, mat === 0 ? 0 : 1, 0, 0, 1, W, H, which, e1);
    const first = m.nv;
    for (const p of ol) { const [x, z] = place(p.u, w); m.vert(x, p.v, z, nx, 0, nz, p.u / W, (p.v + H / 2) / H, mat === 0 ? 0 : 1, 0, 0, 1, W, H, which, e1); }
    const n = ol.length;
    for (let i = 0; i < n; i++) m.tri(c, first + i, first + ((i + 1) % n));
  }
  // the walls: three rows through the board, the rims' normals rolled toward the faces
  const rows = [[0, -0.75], [b * 0.5, 0], [b, 0.75]] as const;
  const first = m.nv;
  for (const [w, roll] of rows) {
    for (const p of ol) {
      const [x, z] = place(p.u, w);
      // outward in the board's plane, rolled toward the face it meets
      const ox = p.nu * dirU[0];
      const oz = p.nu * dirU[1];
      const oy = p.nv;
      const k = Math.abs(roll);
      const fx = dirW[0] * Math.sign(roll);
      const fz = dirW[1] * Math.sign(roll);
      m.vert(x, p.v, z, ox * (1 - k) + fx * k, oy * (1 - k), oz * (1 - k) + fz * k, p.l / W, w / b, MAT.board, 0, 0, 1, W, b, which, 0);
    }
  }
  const cols = ol.length;
  for (let j = 0; j + 1 < rows.length; j++) for (let i = 0; i + 1 < cols; i++) {
    const a = first + j * cols + i;
    m.quad(a, a + 1, a + cols + 1, a + cols);
  }
}

/** The spine: the cloth from the back board's outer spine edge round to the front board's, bowed out while closed. */
function spine(m: MeshWriter, F: Frame, C: CoverFrame, theta: number): void {
  const H = F.H;
  const ax = -F.W / 2;
  const az = 0;
  const bx = C.ox + F.b * C.wx;
  const bz = C.oz + F.b * C.wz;
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz) || 1;
  // perpendicular to the chord, away from the block (−x when closed); flattening as the book opens
  // biome-ignore lint/style/useExponentiationOperator: the prototype's arithmetic, moved verbatim — D1 rewrites no expression that feeds a record (design-015 D1)
  const bulge = F.spec.bulge * Math.pow(Math.max(1 - swingOf(theta) / Math.PI, 0), 1.2);
  const px = -dz / len;
  const pz = dx / len;
  const cx = (ax + bx) / 2 + px * bulge * 2;
  const cz = (az + bz) / 2 + pz * bulge * 2;
  const segs = 12;
  const first = m.nv;
  let arc = 0;
  let lx = ax;
  let lz = az;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const it = 1 - t;
    const x = it * it * ax + 2 * it * t * cx + t * t * bx;
    const z = it * it * az + 2 * it * t * cz + t * t * bz;
    const tx = 2 * it * (cx - ax) + 2 * t * (bx - cx);
    const tz = 2 * it * (cz - az) + 2 * t * (bz - cz);
    arc += Math.hypot(x - lx, z - lz); lx = x; lz = z;
    for (const v of [-H / 2, H / 2]) m.vert(x, v, z, -tz, 0, tx, arc / len, (v + H / 2) / H, MAT.spine, 0, FLAG_TWO_SIDED, 0.92, len, H, 0, 0);
  }
  for (let i = 0; i < segs; i++) { const a = first + i * 2; m.quad(a, a + 2, a + 3, a + 1); }
}

// ---------------------------------------------------------------- the text block

const SHEET_COLS = 40;
const WALL_ROWS = 5;

/**
 * A stack of `k` sheets in the right model (on a board at z = b), emitted through `map` (the
 * identity for the right stack, the cover's ride for the left): its top page (`page` names what
 * is printed on it) and its walls — the head, the fore-edge, the tail — built through the
 * sheets' own curves, so the fore-edge steps in toward the gutter as the sheets climb (the fan).
 */
function stack(m: MeshWriter, F: Frame, k: number, gamma: number, law: NotebookLaw, page: number, side: 0 | 1, map: (x: number, z: number) => readonly [number, number], mapDir: (nx: number, nz: number) => readonly [number, number]): void {
  if (k <= 0) return;
  const t = F.spec.sheet;
  const Hp = F.Hp;
  const top = restSheet(F, F.b + (k - 0.5) * t, gamma, law.gutter);
  const len = top.len;
  // the top page: a grid over the top sheet's curve, its upper surface (the mid-plane + half a sheet), its rows tracing the rounded corners
  const ss = sheetSamples(len, SHEET_COLS);
  const table = curveTable(top);
  const rows = pageRows(Hp, F.spec.pageRadius);
  const cur = new Float64Array(4);
  const first = m.nv;
  for (let j = 0; j < rows.ys.length; j++) {
    const y = rows.ys[j] as number;
    const f = rows.extent(len, j) / len;
    for (let i = 0; i < ss.length; i++) {
      const sArc = (ss[i] as number) * f;
      curveAt(table, sArc, cur);
      const x = cur[0] as number;
      const z = cur[1] as number;
      const c = cur[2] as number;
      const s = cur[3] as number;
      const [X, Z] = map(x - s * t * 0.5, z + c * t * 0.5);
      const [NX, NZ] = mapDir(-s, c);
      m.vert(X, y, Z, NX, 0, NZ, sArc / len, (y + Hp / 2) / Hp, MAT.page, page, 0, 1, len, Hp, side, k);
    }
  }
  m.gridQuads(first, ss.length, rows.ys.length);

  // the walls: rows through the stack from the board up to the top sheet's upper surface
  const outline = foreOutline(len, Hp, F.spec.pageRadius, 0, 6, 10, ss);
  const sList = [...new Set(outline.map((p) => p.u))].sort((a, b) => a - b);
  const at = new Map<number, number>(); sList.forEach((s, i) => at.set(s, i));
  const rowsCur: Float64Array[] = [];
  for (let r = 0; r <= WALL_ROWS; r++) {
    const h = F.b + (k * t * r) / WALL_ROWS;
    rowsCur.push(sampleRest(restSheet(F, h, gamma, law.gutter), sList));
  }
  const wfirst = m.nv;
  for (let r = 0; r <= WALL_ROWS; r++) {
    const c = rowsCur[r] as Float64Array;
    for (const p of outline) {
      const i = at.get(p.u) as number;
      const x = c[i * 4] as number;
      const z = c[i * 4 + 1] as number;
      const cs = c[i * 4 + 2] as number;
      const sn = c[i * 4 + 3] as number;
      const [X, Z] = map(x, z);
      // outward: along the sheet's own tangent for the fore-edge share, across (y) for the head and tail
      const [NX, NZ] = mapDir(p.nu * cs, p.nu * sn);
      m.vert(X, p.v, Z, NX, p.nv, NZ, p.l / len, r / WALL_ROWS, MAT.edge, page, 0, 0.78 + 0.22 * (r / WALL_ROWS), len, k * t, k, side);
    }
  }
  m.gridQuads(wfirst, outline.length, WALL_ROWS + 1);
}

/** A sheet in the air, both faces: its recto is page 2i + 1, its verso 2i + 2. */
function airSheet(m: MeshWriter, F: Frame, pose: NotebookPose, gamma: number, law: NotebookLaw, a: NotebookPose["airs"][number]): void {
  const Hp = F.Hp;
  const len = restSheet(F, F.b + (pose.right + 0.5) * F.spec.sheet, gamma, law.gutter).len;
  const ss = sheetSamples(len, SHEET_COLS);
  const rows = pageRows(Hp, F.spec.pageRadius);
  const ys = rows.ys;
  const rowSS = ss.map(() => 0);
  const { pos } = sampleAir(F, a, pose.right, pose.left, gamma, ss, ys, law, (j) => { const f = rows.extent(len, j) / len; for (let i = 0; i < ss.length; i++) rowSS[i] = (ss[i] as number) * f; return rowSS; });
  const ns = ss.length;
  const ny = ys.length;
  const first = m.nv;
  const P = (i: number, j: number, c: number) => pos[(Math.min(Math.max(j, 0), ny - 1) * ns + Math.min(Math.max(i, 0), ns - 1)) * 3 + c] as number;
  for (let j = 0; j < ny; j++) for (let i = 0; i < ns; i++) {
    // the normal from the grid: ∂/∂s × ∂/∂y (+z when it lies on the right)
    const i0 = Math.max(i - 1, 0);
    const i1 = Math.min(i + 1, ns - 1);
    const j0 = Math.max(j - 1, 0);
    const j1 = Math.min(j + 1, ny - 1);
    const sx = P(i1, j, 0) - P(i0, j, 0);
    const sy = P(i1, j, 1) - P(i0, j, 1);
    const sz = P(i1, j, 2) - P(i0, j, 2);
    const yx = P(i, j1, 0) - P(i, j0, 0);
    const yy = P(i, j1, 1) - P(i, j0, 1);
    const yz = P(i, j1, 2) - P(i, j0, 2);
    const nx = sy * yz - sz * yy;
    const ny2 = sz * yx - sx * yz;
    const nz = sx * yy - sy * yx;
    const sArc = (ss[i] as number) * rows.extent(len, j) / len;
    m.vert(P(i, j, 0), P(i, j, 1), P(i, j, 2), nx, ny2, nz, sArc / len, (ys[j] as number + Hp / 2) / Hp, MAT.page, 2 * a.index + 1, FLAG_TWO_SIDED, 1, len, Hp, 2, 0);
  }
  m.gridQuads(first, ns, ny);
}

/**
 * The RIBBON: a satin marker that lies in the gutter of the spread in view (between the stacks
 * when the book is shut), leaves the book at its tail, drapes over the board's edge and lies out
 * on the mat in a loose S, its end cut in a V. A strip along a Catmull-Rom path through a few
 * points, flat across x (it lies on the page and on the desk), both faces seen.
 */
const RIBBON_W = 7;
function ribbon(m: MeshWriter, F: Frame, pose: NotebookPose, gamma: number, law: NotebookLaw): void {
  const t = F.spec.sheet;
  const Hp = F.Hp;
  const H = F.H;
  // where it lies in the book: on the right stack's top, just out of the gutter (the block's spine edge when shut)
  let rx: number;
  let rz: number;
  if (pose.right > 0) {
    const top = restSheet(F, F.b + (pose.right - 0.5) * t, gamma, law.gutter);
    const c = sampleRest(top, [0, 2.5 + 3 * (1 - gamma)]);
    rx = (c[4] as number) - (c[7] as number) * (t * 0.5 + 0.25); rz = (c[5] as number) + (c[6] as number) * (t * 0.5 + 0.25);
  } else { rx = F.xp0 + 3; rz = F.b + 0.25; }
  const floorZ = (x: number) => (x < -F.W / 2 ? (swingOf(pose.theta) > 0.9 * Math.PI ? F.b * 0.6 : 0) : F.b);
  // the desk under it: a lifted book's ribbon hangs down the extra height, and less of it lies out on the mat
  const desk = Math.min(pose.desk ?? 0, 0);
  const hang = -desk;
  const ctrl: [number, number, number][] = [
    [rx, -Hp / 2 + 4, rz], [rx, -Hp / 4, rz], [rx, Hp / 4, rz], [rx, Hp / 2 - 6, rz], [rx, Hp / 2, rz],
    [rx + 0.3, H / 2 - 0.4, Math.max(floorZ(rx), rz * 0.55) + 0.25], [rx + 0.9, H / 2 + 1.8, floorZ(rx) * 0.55],
    [rx + 2.4, H / 2 + 5.5 + hang * 0.15, desk * 0.6 + 0.14], [rx + 6, H / 2 + 18 + hang * 0.1, desk + 0.1], [rx + 9.5, H / 2 + 31, desk + 0.1], [rx + 8.5, H / 2 + 43 - hang * 0.4, desk + 0.1],
  ];
  // Catmull-Rom through the controls, four samples a span
  const pts: [number, number, number][] = [];
  const P = (i: number) => ctrl[Math.min(Math.max(i, 0), ctrl.length - 1)] as [number, number, number];
  for (let i = 0; i < ctrl.length - 1; i++) for (let k = 0; k < 4; k++) {
    const u = k / 4;
    const p0 = P(i - 1);
    const p1 = P(i);
    const p2 = P(i + 1);
    const p3 = P(i + 2);
    const q = [0, 1, 2].map((c) => 0.5 * ((2 * (p1[c] as number)) + (-(p0[c] as number) + (p2[c] as number)) * u + (2 * (p0[c] as number) - 5 * (p1[c] as number) + 4 * (p2[c] as number) - (p3[c] as number)) * u * u + (-(p0[c] as number) + 3 * (p1[c] as number) - 3 * (p2[c] as number) + (p3[c] as number)) * u * u * u)) as [number, number, number];
    pts.push(q);
  }
  pts.push(ctrl[ctrl.length - 1] as [number, number, number]);
  const first = m.nv;
  let arc = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(i - 1, 0)] as number[];
    const b = pts[Math.min(i + 1, n - 1)] as number[];
    const p = pts[i] as number[];
    if (i > 0) arc += Math.hypot((p[0] as number) - ((pts[i - 1] as number[])[0] as number), (p[1] as number) - ((pts[i - 1] as number[])[1] as number), (p[2] as number) - ((pts[i - 1] as number[])[2] as number));
    const tx = (b[0] as number) - (a[0] as number);
    const ty = (b[1] as number) - (a[1] as number);
    const tz = (b[2] as number) - (a[2] as number);
    const tl = Math.hypot(tx, ty, tz) || 1;
    // across: level and square to the path; the face's normal: up, out of the path and the across
    let wx = -ty;
    let wy = tx; const wl = Math.hypot(wx, wy) || 1; wx /= wl; wy /= wl;
    let nx = (ty / tl) * 0 - (tz / tl) * wy;
    let ny = (tz / tl) * wx - (tx / tl) * 0;
    let nz = (tx / tl) * wy - (ty / tl) * wx;
    if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    // the V at the end: the edges run on past the middle
    const prev = pts[n - 2] as number[];
    const notch = i === n - 1 ? Math.min(3.2, 0.7 * Math.hypot((p[0] as number) - (prev[0] as number), (p[1] as number) - (prev[1] as number))) : 0;
    for (const side of [-1, 1] as const) {
      const off = (RIBBON_W / 2) * side;
      m.vert((p[0] as number) + wx * off, (p[1] as number) + wy * off, p[2] as number, nx, ny, nz, arc, (side + 1) / 2, MAT.ribbon, 0, FLAG_TWO_SIDED, 1, 1, RIBBON_W, 0, 0);
    }
    if (notch > 0) {
      // the middle of the end sits back up the ribbon: a vertex between the two edge ones
      const c = m.vert((p[0] as number) - (tx / tl) * notch, (p[1] as number) - (ty / tl) * notch, p[2] as number, nx, ny, nz, arc - notch, 0.5, MAT.ribbon, 0, FLAG_TWO_SIDED, 1, 1, RIBBON_W, 0, 0);
      const l = first + (n - 2) * 2;
      const r = l + 1;
      m.tri(l, r, c); m.tri(l, c, l + 2); m.tri(r, r + 2, c);
    }
  }
  // the strip (the last span is the notch's two triangles)
  for (let i = 0; i < n - 2; i++) { const a = first + i * 2; m.quad(a, a + 2, a + 3, a + 1); }
}

/**
 * The whole notebook for a pose, into the writer (reset first). The back board never moves;
 * the front board swings on the spine's arc; the stacks sit on their boards; the sheets in the
 * air turn between them. Bounds are tracked as it writes.
 */
export function buildMesh(m: MeshWriter, F: Frame, pose: NotebookPose, law: NotebookLaw): BuiltMesh {
  m.reset();
  const C = coverFrame(F, pose.theta);
  const gamma = relaxOf(pose.theta);
  // the back board: its inner face is the back endpaper, its outer face is on the mat (never seen)
  // (its w runs DOWN from the inner face, so the inner face is on top at z = b)
  board(m, F, (u, w) => [-F.W / 2 + u, F.b - w], [1, 0], [0, -1], 1, false, pose.right > 0);
  // the front board: the design outside, the front endpaper inside
  board(m, F, (u, w) => [C.ox + u * C.ux + w * C.wx, C.oz + u * C.uz + w * C.wz], [C.ux, C.uz], [C.wx, C.wz], 0, true, pose.left > 0);
  spine(m, F, C, pose.theta);
  // the stacks: the right on the back board as it lies; the left carried by the front board
  stack(m, F, pose.right, gamma, law, 2 * pose.rightTop + 1, 0, (x, z) => [x, z], (nx, nz) => [nx, nz]);
  stack(m, F, pose.left, gamma, law, 2 * pose.leftTop + 2, 1, (x, z) => ride(F, C, x, z), (nx, nz) => rideDir(C, nx, nz));
  for (const a of pose.airs) airSheet(m, F, pose, gamma, law, a);
  ribbon(m, F, pose, gamma, law);
  return { vertices: m.v, indices: m.ix, vcount: m.nv, icount: m.ni, min: [m.min[0], m.min[1], m.min[2]], max: [m.max[0], m.max[1], m.max[2]] };
}
