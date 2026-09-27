// The notebook's SHAPE — pure geometry, no GPU (NOTEBOOK.md §3). A notebook is a case (two
// boards and a spine, cloth-covered) around a text block of sheets bound at one line. This
// file says where every part is for a pose: the front cover's hinge and swing, the stacks'
// resting curves out of the gutter, a sheet in the air. `mesh.ts` turns it into triangles and
// `pick.ts` reads the same numbers, so what is clicked is what is drawn.
//
// Book-local coordinates: the closed book's back cover lies on the mat at x ∈ [−W/2, W/2],
// y ∈ [−H/2, H/2], z ∈ [0, b]; the spine is on the left (x = −W/2). Opening swings the front
// cover over to the LEFT, so the open spread spans [−W/2 − s − W, W/2] (s = the spine's width).
//
// THE RIGHT MODEL. Every stack is described as if it were the right-hand stack on the back
// cover: sheets bound at the gutter, each rising out of it to its own height and lying flat
// beyond. The left stack is the same description carried by the front cover (`ride`): at the
// cover's full swing that map is exactly the mirror about the gutter, so one set of curves
// serves both sides and a sheet that turns lands on exactly the curve it will rest on.

import type { NotebookLaw } from "./law";

/** One notebook's dimensions (the law's, unless a scene gives its own). */
export interface NotebookSpec {
  readonly width: number;
  readonly height: number;
  readonly board: number;
  readonly coverRadius: number;
  readonly sheets: number;
  readonly sheet: number;
  readonly square: number;
  readonly joint: number;
  readonly pageRadius: number;
  readonly band: number;
  readonly bulge: number;
}

export const specOf = (law: NotebookLaw, over: Partial<NotebookSpec> = {}): NotebookSpec => ({
  width: law.cover.width, height: law.cover.height, board: law.cover.board, coverRadius: law.cover.radius,
  sheets: law.block.sheets, sheet: law.block.sheet, square: law.block.square, joint: law.block.joint, pageRadius: law.block.radius,
  band: law.spine.band, bulge: law.spine.bulge, ...over,
});

/** The numbers derived from a spec that every part reads. */
export interface Frame {
  readonly spec: NotebookSpec;
  /** Cover width, height, board. */
  readonly W: number; readonly H: number; readonly b: number;
  /** The whole block's thickness. */
  readonly T: number;
  /** The spine's width (the closed book's thickness) — the gap between the two covers when open. */
  readonly sw: number;
  /** A page: its height; its width as bound in the closed book (`Wp`) and as it lies open, out of the gutter (`Wo`). */
  readonly Hp: number; readonly Wp: number; readonly Wo: number;
  /** The closed block's spine edge, x. */
  readonly xp0: number;
  /** The gutter, open: x, and the valley floor's height. */
  readonly xg: number; readonly zg: number;
}

export function frameOf(spec: NotebookSpec): Frame {
  const W = spec.width;
  const H = spec.height;
  const b = spec.board;
  const T = spec.sheets * spec.sheet;
  const sw = T + 2 * b;
  const xp0 = -W / 2 + spec.joint;
  const Wp = W - spec.joint - spec.square;
  const xg = -W / 2 - sw / 2;
  // open, a page reaches from the gutter to where the closed fore-edge was (the binding's margin revealed)
  const Wo = W / 2 - spec.square - xg;
  return { spec, W, H, b, T, sw, Hp: H - 2 * spec.square, Wp, Wo, xp0, xg, zg: b * 0.5 };
}

/** The ease every curve here uses. */
export const smooth = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const clamp = (x: number, a: number, b: number): number => Math.min(Math.max(x, a), b);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// ---------------------------------------------------------------- the cover's swing

/** A swing past either end bounces back up off the desk or the block — never through it. */
export const swingOf = (theta: number): number => (theta > Math.PI ? 2 * Math.PI - theta : theta < 0 ? -theta : theta);

/** How far the gutter has relaxed into its open curve: none until the cover is nearly down. */
export const relaxOf = (theta: number): number => smooth((swingOf(theta) - 0.78 * Math.PI) / (0.22 * Math.PI));

/**
 * The front cover's frame at a swing θ: its origin (the INNER face's spine edge), its u axis
 * (across, spine → fore-edge) and its w axis (through the board, inner → outer), all in the
 * x–z plane. Closed it rests on the block (inner face at b + T); open it lies on the desk to
 * the left of the spine. The hinge travels on the spine's own arc — up like a door, over, and
 * down onto the desk — the spine rotating a quarter turn while the cover rotates a half.
 */
export interface CoverFrame { readonly ox: number; readonly oz: number; readonly ux: number; readonly uz: number; readonly wx: number; readonly wz: number }
export function coverFrame(F: Frame, theta: number): CoverFrame {
  const th = clamp(swingOf(theta), 0, Math.PI);
  const beta = Math.PI / 2 + th / 2;
  const ox = -F.W / 2 + F.sw * Math.cos(beta);
  const oz = lerp(F.b + F.T - F.sw, F.b, th / Math.PI) + F.sw * Math.sin(beta);
  return { ox, oz, ux: Math.cos(th), uz: Math.sin(th), wx: -Math.sin(th), wz: Math.cos(th) };
}
/** A point in the cover's frame (u across from the spine edge, w through the board from the inner face) → book x, z. */
export const coverPoint = (C: CoverFrame, u: number, w: number): readonly [number, number] => [C.ox + u * C.ux + w * C.wx, C.oz + u * C.uz + w * C.wz];

/**
 * The RIDE: a point of the right model (x′, z′) carried by the front cover — the left stack.
 * At the full swing this is the mirror about the gutter (x ↦ 2·xg − x, z unchanged).
 */
export const ride = (F: Frame, C: CoverFrame, x: number, z: number): readonly [number, number] => coverPoint(C, x + F.W / 2, F.b - z);
/** A right-model direction (nx, nz) carried by the cover (the ride's linear part — a reflection with a turn). */
export const rideDir = (C: CoverFrame, nx: number, nz: number): readonly [number, number] => [nx * C.ux - nz * C.wx, nx * C.uz - nz * C.wz];

// ---------------------------------------------------------------- the gutter's curves

/**
 * A sheet's rise out of the gutter: tangent angle a·(1 − smooth(s/dc)) for s < dc, flat beyond —
 * `a` from the rise (steeper for a thicker stack), `dc` the length the climb takes.
 */
export interface Profile { readonly a: number; readonly dc: number }

/** ∫₀¹ sin(a·(1 − smooth(u))) du, by Simpson on 32 intervals — the mean climb per unit of curve. */
function meanSin(a: number): number {
  const n = 32;
  let acc = 0;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const w = i === 0 || i === n ? 1 : i % 2 === 1 ? 4 : 2;
    acc += w * Math.sin(a * (1 - smooth(u)));
  }
  return acc / (3 * n);
}

export function profileOf(rise: number, law: NotebookLaw["gutter"]): Profile {
  if (!(rise > 1e-4)) return { a: 0, dc: 0 };
  const a = clamp(law.entry0 + law.entryPer * rise, 0.05, law.entryMax);
  return { a, dc: rise / Math.max(meanSin(a), 1e-4) };
}

export const angleAt = (p: Profile, s: number): number => (p.dc > 0 && s < p.dc ? p.a * (1 - smooth(s / p.dc)) : 0);

/**
 * A resting sheet of the right model at height `h` (its mid-plane) with the gutter relaxed by
 * `gamma`: where it starts, how long it is, and its climb. Closed (γ 0) it is flat from the
 * block's spine edge; open (γ 1) it is bound at the gutter and climbs to `h`.
 */
export interface RestSheet { readonly x0: number; readonly z0: number; readonly len: number; readonly profile: Profile }
export function restSheet(F: Frame, h: number, gamma: number, law: NotebookLaw["gutter"]): RestSheet {
  const zfloor = Math.max(Math.min(F.zg, h - law.dip), 0.6);
  const x0 = lerp(F.xp0, F.xg, gamma);
  const z0 = lerp(h, zfloor, gamma);
  return { x0, z0, len: lerp(F.Wp, F.Wo, gamma), profile: profileOf(h - z0, law) };
}

/** The integrator's longest step, world units: the curves are exact to a hundredth wherever they are sampled. */
const STEP = 0.75;

/**
 * Integrate a curve of tangent angle α(s) from (x0, z0) and sample it at `ss` (ascending, from 0):
 * out[i] = x, z, cos α, sin α. Midpoint rule, at least `sub` steps per interval and none longer
 * than `STEP` — the one integrator every curve here goes through, so a sheet in the air, the
 * stack it lands on and the hit test agree however each is sampled.
 */
export function integrate(alpha: (s: number) => number, x0: number, z0: number, ss: ArrayLike<number>, sub = 2, out?: Float64Array): Float64Array {
  const o = out ?? new Float64Array(ss.length * 4);
  let x = x0;
  let z = z0;
  let s = 0;
  for (let i = 0; i < ss.length; i++) {
    const target = ss[i] as number;
    const n = Math.max(sub, Math.ceil((target - s) / STEP));
    const h = (target - s) / n;
    if (h > 0) for (let k = 0; k < n; k++) { const a = alpha(s + (k + 0.5) * h); x += Math.cos(a) * h; z += Math.sin(a) * h; }
    s = target;
    const a = alpha(s);
    o[i * 4] = x; o[i * 4 + 1] = z; o[i * 4 + 2] = Math.cos(a); o[i * 4 + 3] = Math.sin(a);
  }
  return o;
}

/** A resting sheet sampled at arc lengths `ss`: x, z, cos, sin per sample. */
export function sampleRest(r: RestSheet, ss: ArrayLike<number>, out?: Float64Array): Float64Array {
  return integrate((s) => angleAt(r.profile, s), r.x0, r.z0, ss, 2, out);
}

// ---------------------------------------------------------------- the pose

/** A sheet in the air: its root's angle φ and its free edge's ψ (0 = lying right … π = lying left), and the twist that lets one corner lead. */
export interface Air { readonly index: number; readonly phi: number; readonly psi: number; readonly twist: number }

/** What the mesh needs: the swing, the counts at rest on each side, and the sheets in the air. */
export interface NotebookPose {
  readonly theta: number;
  /** Sheets at rest on the right (on the back cover) and on the left (on the front cover). */
  readonly right: number;
  readonly left: number;
  /** The right stack's top sheet (its recto shows) and the left stack's (its verso shows); −1 = none. */
  readonly rightTop: number;
  readonly leftTop: number;
  readonly airs: readonly Air[];
  /** Where the desk is under the book, in its own z (0 lying; −lift held) — what the ribbon hangs down to. */
  readonly desk?: number;
}

export const CLOSED_POSE: NotebookPose = { theta: 0, right: 0, left: 0, rightTop: -1, leftTop: -1, airs: [] };

/** A stack's top and bottom mid-plane heights for k sheets (right model: on a board at z = b). */
export const stackHeights = (F: Frame, k: number): readonly [number, number] => [F.b + 0.5 * F.spec.sheet, F.b + (k - 0.5) * F.spec.sheet];

/**
 * A sheet in the air, sampled on the grid (ss × ys), in BOOK coordinates (valid at the full
 * swing — sheets only turn in an open book): each row's tangent angle blends the right stack's
 * resting curve into the left's, by a turn fraction that runs from the root's φ to the edge's
 * ψ (bent by `bend` — the edge curls most), the edge's ψ twisted along the row so one corner
 * leads. Out: per vertex x, y, z and the tangent along s (cos, sin in x–z).
 */
export function sampleAir(F: Frame, air: Air, right: number, left: number, gamma: number, ss: ArrayLike<number>, ys: ArrayLike<number>, law: NotebookLaw, rowSS?: (j: number) => ArrayLike<number>): { pos: Float64Array; tan: Float64Array } {
  const t = F.spec.sheet;
  const R = restSheet(F, F.b + (right + 0.5) * t, gamma, law.gutter);
  const L = restSheet(F, F.b + (left + 0.5) * t, gamma, law.gutter);
  const len = R.len;
  const ns = ss.length;
  const ny = ys.length;
  const pos = new Float64Array(ns * ny * 3);
  const tan = new Float64Array(ns * ny * 2);
  const row = new Float64Array(ns * 4);
  const half = F.Hp / 2;
  for (let j = 0; j < ny; j++) {
    const y = ys[j] as number;
    const psiY = clamp(air.psi + air.twist * (y / half), 0, Math.PI);
    // biome-ignore lint/style/useExponentiationOperator: the prototype's arithmetic, moved verbatim — D1 rewrites no expression that feeds a record (design-015 D1)
    const w = (s: number): number => clamp((air.phi + (psiY - air.phi) * Math.pow(clamp(s / len, 0, 1), law.bend)) / Math.PI, 0, 1);
    const alpha = (s: number): number => { const f = w(s); return (1 - f) * angleAt(R.profile, s) + f * (Math.PI - angleAt(L.profile, s)); };
    // the root moves between the two stacks' gutter points with the root's own fraction (L's is the mirror's: same x)
    const f0 = w(0);
    integrate(alpha, lerp(R.x0, 2 * F.xg - L.x0, f0), lerp(R.z0, L.z0, f0), rowSS ? rowSS(j) : ss, 2, row);
    for (let i = 0; i < ns; i++) {
      const k = (j * ns + i);
      pos[k * 3] = row[i * 4] as number; pos[k * 3 + 1] = y; pos[k * 3 + 2] = row[i * 4 + 1] as number;
      tan[k * 2] = row[i * 4 + 2] as number; tan[k * 2 + 1] = row[i * 4 + 3] as number;
    }
  }
  return { pos, tan };
}

/**
 * A page's rows, down from the head: a few tracing each fore-edge corner's arc (so the grid's
 * last column IS the rounded corner — no pixel is cut away in the shader, and the GPU can hide
 * what lies under a page before shading it), `mid` between. `extent(len, j)` is how far along
 * the page row j reaches.
 */
export function pageRows(Hp: number, r: number, mid = 12, arc = 5): { ys: Float64Array; extent: (len: number, j: number) => number } {
  const ys: number[] = [];
  const sin: number[] = [];
  const rr = Math.min(r, Hp / 2);
  for (let k = 0; k <= arc; k++) { const t = (Math.PI / 2) * (k / arc); ys.push(-Hp / 2 + rr - rr * Math.cos(t)); sin.push(Math.sin(t)); }
  for (let k = 1; k < mid; k++) { ys.push(-Hp / 2 + rr + ((Hp - 2 * rr) * k) / mid); sin.push(1); }
  for (let k = arc; k >= 0; k--) { const t = (Math.PI / 2) * (k / arc); ys.push(Hp / 2 - rr + rr * Math.cos(t)); sin.push(Math.sin(t)); }
  return { ys: Float64Array.from(ys), extent: (len, j) => len - rr + rr * (sin[j] as number) };
}

/** A resting sheet as a dense table (one sample per world unit), read by `curveAt` — rows of any extent from one integration. */
export interface CurveTable { readonly data: Float64Array; readonly step: number; readonly n: number }
export function curveTable(r: RestSheet, step = 1): CurveTable {
  const n = Math.ceil(r.len / step) + 1;
  const ss = new Float64Array(n);
  for (let i = 0; i < n; i++) ss[i] = Math.min(i * step, r.len);
  return { data: sampleRest(r, ss), step, n };
}
/** x, z, cos, sin at arc length s (linear between the table's samples). */
export function curveAt(t: CurveTable, s: number, out: Float64Array): Float64Array {
  const f = Math.min(Math.max(s / t.step, 0), t.n - 1);
  const i = Math.min(Math.floor(f), t.n - 2);
  const u = f - i;
  for (let k = 0; k < 4; k++) out[k] = (t.data[i * 4 + k] as number) * (1 - u) + (t.data[(i + 1) * 4 + k] as number) * u;
  return out;
}

/** Arc-length samples across a page: denser toward the gutter, where the curves are. */
export function sheetSamples(len: number, n: number): Float64Array {
  const ss = new Float64Array(n + 1);
  // biome-ignore lint/style/useExponentiationOperator: the prototype's arithmetic, moved verbatim — D1 rewrites no expression that feeds a record (design-015 D1)
  for (let i = 0; i <= n; i++) ss[i] = len * Math.pow(i / n, 1.45);
  return ss;
}
