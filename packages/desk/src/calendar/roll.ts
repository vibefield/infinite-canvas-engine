// The ROLL — how a month leaves the pad and comes back (CALENDAR.md §4). Pure; `calendar.wgsl`'s
// `cal_roll` is the same arithmetic on the GPU (the moving sheet's grid is bent in its vertex
// shader), this is its twin for the hit test and the tests.
//
// A sheet is bound under the tape at its head. Rolled up, it winds into a roll that sits ON the
// pad and travels toward the tape, laying bare the month beneath; at the tape it joins the roll of
// the months before, which lies there always (the past). Unrolled, the last month comes off that
// roll and is laid back down over the one showing. The roll is an Archimedean spiral: the sheet's
// part past the TANGENT LINE (where it leaves the pad) is wound on it, its free edge innermost, each
// turn `tau` thinner than the last, round a core sized so a whole sheet wound is exactly the roll at
// rest — a month rolling up arrives as the roll it joins. Rolled from a corner, the tangent line
// starts tilted (the corner lifts first) and straightens as the roll goes on.
//
// Sheet coordinates: x across (0 … W), s down the sheet from the tape's edge (0 … L); z up from the
// sheet's own face. d is how far past the tangent line a point is (along the line's normal, toward
// the free edge): d ≤ 0 lies flat, d > 0 is wound — the outer turn nearest the line.

export interface RollState {
  /** Where the tangent line crosses x = `px`, from the tape's edge (L = nothing wound). */
  readonly a: number;
  /** The line's tilt (radians): negative lifts the right-hand corner first, positive the left. */
  readonly alpha: number;
  readonly px: number;
  /** The core's radius, and how much thinner each turn is. */
  readonly r0: number;
  readonly tau: number;
  /** The sheet's free length (the tape's edge to its foot). */
  readonly L: number;
}

export interface RollPoint {
  /** Sheet x, s and height above the sheet's face. */
  readonly x: number;
  readonly s: number;
  readonly z: number;
  /** The FRONT face's normal (the printed side): up when flat, toward the roll's axis when wound. */
  readonly nx: number;
  readonly ns: number;
  readonly nz: number;
  /** How far round the spiral (radians); 0 flat. */
  readonly phi: number;
}

/** The core that makes a whole sheet wound (tangent line at `rest`) a roll of radius `rest`. */
export function coreOf(rest: number, tau: number, L: number): number {
  return Math.sqrt(Math.max(rest * rest - (tau * Math.max(L - rest, 0)) / Math.PI, 1));
}

/** The radius of the roll where the wound length is D. */
export const radiusOf = (r0: number, tau: number, D: number): number => Math.sqrt(r0 * r0 + (tau * Math.max(D, 0)) / Math.PI);

/** The roll's outer radius and its axis's place, at x (a tilted roll is a little fatter at its lifted end). */
export function rollAt(R: RollState, x: number): { readonly radius: number; readonly wound: number } {
  const sa = Math.sin(R.alpha);
  const ca = Math.cos(R.alpha);
  const wound = Math.max((x - R.px) * -sa + (R.L - R.a) * ca, 0);
  return { radius: radiusOf(R.r0, R.tau, wound), wound };
}

/** A sheet point (x, s) as the roll bends it. */
export function rollPoint(R: RollState, x: number, s: number): RollPoint {
  const sa = Math.sin(R.alpha);
  const ca = Math.cos(R.alpha);
  const d = (x - R.px) * -sa + (s - R.a) * ca;
  if (d <= 0) return { x, s, z: 0, nx: 0, ns: 0, nz: 1, phi: 0 };
  // the wound length of this fibre (to the sheet's foot), and the roll's radius there
  const D = Math.max((x - R.px) * -sa + (R.L - R.a) * ca, d);
  const Rr = radiusOf(R.r0, R.tau, D);
  // φ(d): Rφ − τφ²/4π = d (the arc length of the spiral from the tangent point)
  const phi = R.tau > 1e-6 ? ((2 * Math.PI) / R.tau) * (Rr - Math.sqrt(Math.max(Rr * Rr - (R.tau * d) / Math.PI, 0))) : d / Rr;
  const rho = Rr - (R.tau * phi) / (2 * Math.PI);
  // the line's normal toward the free edge, in (x, s)
  const nx = -sa;
  const ns = ca;
  const bx = x - d * nx;
  const bs = s - d * ns;
  const sp = Math.sin(phi);
  const cp = Math.cos(phi);
  return { x: bx + nx * rho * sp, s: bs + ns * rho * sp, z: Rr - rho * cp, nx: -nx * sp, ns: -ns * sp, nz: cp, phi };
}

/**
 * The roll for a sheet a fraction `p` of the way up (0 flat … 1 at rest against the tape), with a
 * corner's tilt `tilt0` that straightens over the first third, pivoting at the grabbed side.
 */
export function rollState(p: number, law: { readonly rest: number; readonly tau: number }, L: number, W: number, tilt0: number): RollState {
  const q = Math.min(Math.max(p, 0), 1);
  const a = L - q * (L - law.rest);
  const k = Math.min(Math.max(q / 0.34, 0), 1);
  const alpha = tilt0 * (1 - k * k * (3 - 2 * k));
  return { a, alpha, px: tilt0 < 0 ? W : 0, r0: coreOf(law.rest, law.tau, L), tau: law.tau, L };
}

/** Where the tangent line lies at x (the flat part's end, along s). */
export const tangentAt = (R: RollState, x: number): number => R.a + (x - R.px) * Math.tan(R.alpha);
