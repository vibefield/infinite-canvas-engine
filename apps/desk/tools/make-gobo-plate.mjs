// Make a GOBO PLATE — the 512² rgba8 the cutting mat projects (README §4e; PLATES.md is
// the recipe and the numbers). Raw bytes, row 0 = top, the mat's discipline: both hosts
// upload the identical texture, no decoder.
//
//   R  the silhouette — 1 = lit, 0 = shadow, soft-edged (a Gaussian of σ ≈ 1.4 texel)
//   G  the amplitude of the wind's first harmonic      (× the plate's strength, theme.ts)
//   B  the phase, (B − ½)·2π — ONE value per leaf, so a leaf breathes as one and its
//      neighbour on another beat
//   A  the amplitude of harmonics 2 + 3 (× strength · ½ and · 0.3)
//
// The wind pass (shaders/mat/wind.wgsl) writes, per texel,
//   v = clamp(R + G·k·sin(t + φ) + A·k·(½·sin(2t + 2φ) + 0.3·sin(3t + ½φ)), 0, 1)
// It moves no texel: it raises and lowers the silhouette where G and A are, and a SOFT
// edge raised and lowered is an edge moving in and out. So the wind lives on the leaves
// and their one-texel halo, never on the lit ground (which would darken with the wave),
// and the plate's border is lit, so the projector's finite cone has no seam.
//
//   node tools/make-gobo-plate.mjs palm      [--seed N] [--name palm-N]       a palm from above (the shape of gobo-c)
//   node tools/make-gobo-plate.mjs canopy    [--seed N] [--name canopy-N]     a broadleaf canopy from under it, in a spot (gobo-b)
//   node tools/make-gobo-plate.mjs broadleaf [--seed N] [--name broadleaf-N]  a broadleaf crown from above — dappled
//   node tools/make-gobo-plate.mjs stats a.rgba [b.rgba …]                   measure plates: the reference's numbers to match
//   node tools/make-gobo-plate.mjs --check                                   the committed plates ARE what this makes (gen:check)
//
// Options: --wind 1 (the motion budget, 1 = the reference plates') · --sigma 1.4 (the edge's softness, texels;
// a species sets its own) · --strength 0.39 (the stats' wind mirror; the theme gives c 0.388, b 0.463) · --out DIR
// (assets). A plate is its seed: the same seed is the same bytes.
//
// PROVENANCE (design-015 D7, the surface review's #9): apps/desk ships two plates — `gobo-palm-1` (slot c) and
// `gobo-canopy-1` (slot b) — made by this generator at seed 1 (`palm --seed 1`, `canopy --seed 1`); they replace the
// oryzo/Lusion study textures the oracle keeps as fixtures, which the product may not ship. Moved here from the
// prototype (vibe-field/draft/ground/tools/make-gobo-plate.mjs, whose PLATES.md holds the contract and the
// numbers) with its image path and PNG previews left behind (they need the prototype's PNG codecs); every function
// that makes the bytes is the prototype's (biome split its multi-declarators). `--check` regenerates both plates and
// fails on any byte that differs from `apps/desk/assets/` — so a committed plate is always one this file can make.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

export const PLATE_SIZE = 512;
const N = PLATE_SIZE;
const root = resolve(import.meta.dirname, "..");   // apps/desk

/** The reference plates' wind budget — the mean G and A over the MOVING region (R < `moving`) of gobo-c; `--wind 1` lands here. */
export const BUDGET = { g: 0.13, a: 0.155, moving: 0.88 };
/** The silhouette's softness: the reference plates' edges ramp at ≤ 0.28/texel — a Gaussian of σ 1.4. */
export const EDGE_SIGMA = 1.4;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

/** mulberry32 — a plate is its seed. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---- the canvas: shade (0 lit … 1 shadow) and, per texel, its OWNER's wind — amp1, amp2, phase — with the owner's coverage
export class Canvas {
  constructor() {
    this.shade = new Float32Array(N * N);
    this.amp1 = new Float32Array(N * N);
    this.amp2 = new Float32Array(N * N);
    this.phase = new Float32Array(N * N).fill(0.5);
    this.own = new Float32Array(N * N);
  }
  /** Stamp a shape given by its signed distance over a box: 1-texel AA coverage into the shade; the wind stamp reaches one texel further, so the blurred edge's halo moves with the leaf. */
  stamp(x0, y0, x1, y1, sdf, wind) {
    const X0 = Math.max(0, Math.floor(x0));
    const Y0 = Math.max(0, Math.floor(y0));
    const X1 = Math.min(N - 1, Math.ceil(x1));
    const Y1 = Math.min(N - 1, Math.ceil(y1));
    for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
      const d = sdf(x + 0.5, y + 0.5);
      if (d >= 1.5) continue;
      const i = y * N + x;
      const c = clamp01(0.5 - d);
      if (c > this.shade[i]) this.shade[i] = c;
      if (!wind) continue;
      const ca = clamp01(1.5 - d);
      if (ca > this.own[i]) { this.own[i] = ca; this.amp1[i] = wind.a1 * ca; this.amp2[i] = wind.a2 * ca; this.phase[i] = wind.phase; }
    }
  }
  /** A segment with a radius that tapers from `ra` to `rb`. */
  capsule(ax, ay, bx, by, ra, rb, wind) {
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy || 1e-9;
    const r = Math.max(ra, rb) + 2;
    this.stamp(Math.min(ax, bx) - r, Math.min(ay, by) - r, Math.max(ax, bx) + r, Math.max(ay, by) + r, (x, y) => {
      const t = clamp01(((x - ax) * dx + (y - ay) * dy) / l2);
      return Math.hypot(x - ax - dx * t, y - ay - dy * t) - lerp(ra, rb, t);
    }, wind);
  }
  ellipse(cx, cy, a, b, rot, wind) {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const r = Math.max(a, b) + 2;
    const m = Math.min(a, b);
    this.stamp(cx - r, cy - r, cx + r, cy + r, (x, y) => {
      const px = x - cx;
      const py = y - cy;
      const qx = c * px + s * py;
      const qy = -s * px + c * py;
      return (Math.hypot(qx / a, qy / b) - 1) * m;
    }, wind);
  }
  disc(cx, cy, r, wind) { this.stamp(cx - r - 2, cy - r - 2, cx + r + 2, cy + r + 2, (x, y) => Math.hypot(x - cx, y - cy) - r, wind); }
}

/** A separable Gaussian, clamped at the border. */
export function blur(src, sigma) {
  const R = Math.ceil(sigma * 3);
  const k = new Float32Array(2 * R + 1);
  let sum = 0;
  for (let i = -R; i <= R; i++) { k[i + R] = Math.exp(-(i * i) / (2 * sigma * sigma)); sum += k[i + R]; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(N * N);
  const out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let s = 0; for (let i = -R; i <= R; i++) s += k[i + R] * src[y * N + Math.min(N - 1, Math.max(0, x + i))]; tmp[y * N + x] = s; }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let s = 0; for (let i = -R; i <= R; i++) s += k[i + R] * tmp[Math.min(N - 1, Math.max(0, y + i)) * N + x]; out[y * N + x] = s; }
  return out;
}

// ---- the species

/** A cluster of leaves — ellipses scattered round a centre; the outer leaves sway more than the inner. */
function cluster(cv, rand, cx, cy, rho, ampScale, density = 7) {
  const n = Math.floor((rho * rho) / density);
  for (let i = 0; i < n; i++) {
    const r = rho * (rand() + rand()) * 0.5;
    const ang = rand() * Math.PI * 2;
    const a = 4.5 + rand() * 4;
    const b = a * (0.42 + rand() * 0.3);
    const w = (0.35 + 0.65 * rand()) * (0.35 + 0.65 * (r / rho)) * ampScale;
    cv.ellipse(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, a, b, rand() * Math.PI, { a1: w, a2: w * (0.9 + 0.7 * rand()), phase: rand() });
  }
}

/** A branch: a jittered polyline tapering `ra` → `rb`, side twigs to `depth`, leaves at its end and along its last third. */
function branch(cv, rand, ax, ay, bx, by, ra, rb, depth, ampScale, density = 7) {
  const segs = 6;
  const pts = [[ax, ay]];
  for (let k = 1; k <= segs; k++) { const t = k / segs;
const j = k < segs ? 14 : 3; pts.push([lerp(ax, bx, t) + (rand() - 0.5) * j, lerp(ay, by, t) + (rand() - 0.5) * j]); }
  const phase = rand();
  const w = 0.05 * ampScale;
  for (let k = 0; k < segs; k++) cv.capsule(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], lerp(ra, rb, k / segs), lerp(ra, rb, (k + 1) / segs), { a1: w, a2: w, phase });
  if (depth > 0) {
    const twigs = 2 + Math.floor(rand() * 2);
    for (let j = 0; j < twigs; j++) {
      const t = 0.3 + rand() * 0.6;
      const k = Math.min(segs - 1, Math.floor(t * segs));
      const u = t * segs - k;
      const qx = lerp(pts[k][0], pts[k + 1][0], u);
      const qy = lerp(pts[k][1], pts[k + 1][1], u);
      const ang = Math.atan2(by - ay, bx - ax) + (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.6);
      const len = (40 + rand() * 50) * (0.6 + 0.4 * depth / 3);
      branch(cv, rand, qx, qy, qx + Math.cos(ang) * len, qy + Math.sin(ang) * len, rb * 0.8, Math.max(0.5, rb * 0.35), depth - 1, ampScale, density);
    }
  }
  cluster(cv, rand, bx, by, 16 + rand() * 18, ampScale, density);
  if (rand() < 0.6) cluster(cv, rand, lerp(pts[4][0], pts[5][0], 0.5), lerp(pts[4][1], pts[5][1], 0.5), 12 + rand() * 10, ampScale, density);
}

/**
 * A palm from above (the shape of gobo-c): fronds radiating from a crown, each a bowed
 * rachis with pairs of leaflets sweeping forward — long a third of the way out, short at
 * the tip — that curl toward the tip. The view is oblique: fronds pointing down the plate
 * read longer than those pointing up. Amplitude grows along the frond and along each
 * leaflet (a tip sways more than a base); the phase is each leaflet's own.
 */
export function palm(cv, rand, o = {}) {
  const cx = 256 + (rand() - 0.5) * 24;
  const cy = 226 + (rand() - 0.5) * 24;
  const fronds = o.fronds ?? 12 + Math.floor(rand() * 4);
  cv.disc(cx, cy, 16, { a1: 0.1, a2: 0.1, phase: rand() });
  for (let i = 0; i < fronds; i++) {
    const th = (i / fronds) * Math.PI * 2 + (rand() - 0.5) * 0.3;
    const dx = Math.cos(th);
    const dy = Math.sin(th);
    const px = -dy;
    const py = dx;
    // the reach: longer down the plate (the oblique view), and never past the plate's lit border
    const L = Math.min(240, (185 + rand() * 45) * (1 + 0.12 * dy));
    const bend = (rand() - 0.5) * 0.6;
    const P0 = [cx + dx * 12, cy + dy * 12];
    const P1 = [cx + dx * L * 0.55 + px * bend * L * 0.25, cy + dy * L * 0.55 + py * bend * L * 0.25 + 0.06 * L];   // the droop: tips fall down the plate
    const P2 = [cx + dx * L + px * bend * L * 0.55, cy + dy * L + py * bend * L * 0.55 + 0.14 * L];
    const at = (s) => { const u = 1 - s; return [u * u * P0[0] + 2 * u * s * P1[0] + s * s * P2[0], u * u * P0[1] + 2 * u * s * P1[1] + s * s * P2[1]]; };
    const tangent = (s) => { const [ax, ay] = at(Math.max(s - 0.01, 0));
const [bx, by] = at(Math.min(s + 0.01, 1)); return Math.atan2(by - ay, bx - ax); };
    const frondPhase = rand();
    const steps = 28;
    for (let k = 0; k < steps; k++) {
      const [ax, ay] = at(k / steps);
      const [bx, by] = at((k + 1) / steps);
      const w = 0.06 + 0.12 * (k / steps);
      cv.capsule(ax, ay, bx, by, 2.8 - 2.0 * (k / steps), 2.8 - 2.0 * ((k + 1) / steps), { a1: w, a2: w, phase: frondPhase });
    }
    const lmax = 46 + rand() * 16;
    const spacing = 3.8 + rand() * 1.0;
    for (let s = 0.06; s < 0.985; s += spacing / L) {
      const [x, y] = at(s);
      const tan = tangent(s);
      const prof = Math.sin(Math.PI * Math.min(1, 0.05 + 0.95 * s)) ** 0.7;
      for (const side of [-1, 1]) {
        if (rand() < 0.06) continue;
        const len = lmax * prof * (0.8 + 0.2 * rand());
        const a1 = tan + side * (0.9 - 0.3 * s + (rand() - 0.5) * 0.25);
        const a2 = a1 - side * (0.25 + 0.2 * rand());
        const w = (0.22 + 0.78 * s) * (0.65 + 0.35 * rand());
        const phase = rand();
        const mx = x + Math.cos(a1) * len * 0.6;
        const my = y + Math.sin(a1) * len * 0.6;
        cv.capsule(x, y, mx, my, 1.6, 1.1, { a1: w * 0.7, a2: w * 0.75, phase });
        cv.capsule(mx, my, mx + Math.cos(a2) * len * 0.4, my + Math.sin(a2) * len * 0.4, 1.1, 0.5, { a1: w, a2: w * 1.1, phase });
      }
    }
  }
  return { sigma: EDGE_SIGMA };
}

/**
 * A broadleaf canopy seen from under it, inside a spot (the shape of gobo-b): branches
 * entering from the rim toward the middle, twigs, leaf clusters at their ends, and one
 * dense mass near the centre whose leaves overlap too much to move. The spot fades the
 * shade out before the border.
 */
export function canopy(cv, rand) {
  const cx = 256;
  const cy = 256;
  const nb = 4 + Math.floor(rand() * 2);
  for (let i = 0; i < nb; i++) {
    const th = (i / nb) * Math.PI * 2 + rand() * 1.0;
    branch(cv, rand, cx + Math.cos(th) * 262, cy + Math.sin(th) * 262, cx + (rand() - 0.5) * 140, cy + (rand() - 0.5) * 140, 3.5, 1.4, 3, 1, 40);
  }
  cluster(cv, rand, cx + (rand() - 0.5) * 80, cy + (rand() - 0.5) * 80, 60, 0.25, 12);
  // leaves seen against the sky are out of focus: the reference's canopy plate is a third mid-grey
  return { spot: { rIn: 205, rOut: 248 }, sigma: 2.2 };
}

/**
 * A broadleaf crown from above — the desk under a tree at noon: leaf clusters over a disc
 * with gaps between them (the dapples), the outer clusters swaying more than the inner,
 * and a few branches showing through.
 */
export function broadleaf(cv, rand) {
  const cx = 256 + (rand() - 0.5) * 20;
  const cy = 256 + (rand() - 0.5) * 20;
  const R = 175 + rand() * 20;
  const twigs = 6 + Math.floor(rand() * 3);
  for (let i = 0; i < twigs; i++) {
    const th = rand() * Math.PI * 2;
    const len = R * (0.5 + 0.4 * rand());
    branch(cv, rand, cx, cy, cx + Math.cos(th) * len, cy + Math.sin(th) * len, 1.8, 0.7, 1, 0.6, 35);
  }
  const clusters = 20 + Math.floor(rand() * 6);
  for (let i = 0; i < clusters; i++) {
    const r = R * Math.sqrt(rand()) * 0.92;
    const ang = rand() * Math.PI * 2;
    cluster(cv, rand, cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, 24 + rand() * 28, 0.45 + 0.55 * (r / R), 35);
  }
  return { sigma: 1.7 };
}

export const SPECIES = { palm, canopy, broadleaf };

// ---- the packer: shade → R (softened, the border lit), the wind normalised to the budget, the phase → B
export function pack(cv, o = {}) {
  const wind = o.wind ?? 1;
  const spot = o.spot ?? null;
  const sigma = o.sigma ?? EDGE_SIGMA;
  const shade = Float32Array.from(cv.shade);
  const gate = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    let g = smoothstep(0, 6, Math.min(x, y, N - 1 - x, N - 1 - y));            // the border is lit: the cone has no seam
    if (spot) g *= smoothstep(spot.rOut, spot.rIn, Math.hypot(x + 0.5 - N / 2, y + 0.5 - N / 2));
    gate[i] = g; shade[i] *= g;
  }
  const soft = blur(shade, sigma);
  const R = new Float32Array(N * N);
  let movingN = 0;
  let sumG = 0;
  let sumA = 0;
  for (let i = 0; i < N * N; i++) { R[i] = clamp01(1 - soft[i]); if (R[i] < BUDGET.moving) { movingN++; sumG += cv.amp1[i] * gate[i]; sumA += cv.amp2[i] * gate[i]; } }
  const kG = movingN && sumG > 0 ? (BUDGET.g * wind) / (sumG / movingN) : 0;
  const kA = movingN && sumA > 0 ? (BUDGET.a * wind) / (sumA / movingN) : 0;
  const bytes = new Uint8Array(N * N * 4);
  let clipped = 0;
  for (let i = 0; i < N * N; i++) {
    const g = cv.amp1[i] * gate[i] * kG;
    const a = cv.amp2[i] * gate[i] * kA;
    if (g > 1 || a > 1) clipped++;
    bytes[i * 4] = Math.round(R[i] * 255);
    bytes[i * 4 + 1] = Math.round(clamp01(g) * 255);
    bytes[i * 4 + 2] = Math.round(clamp01(cv.phase[i]) * 255);
    bytes[i * 4 + 3] = Math.round(clamp01(a) * 255);
  }
  return { bytes, kG, kA, clipped };
}

// ---- the wind pass on the CPU (wind.wgsl, texel for texel) and the measurements
/** The animated silhouette at gobo time `t` under plate strength `k`. */
export function windFrame(bytes, t, k) {
  const v = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    const s = bytes[i * 4] / 255;
    const amp1 = (bytes[i * 4 + 1] / 255) * k;
    const phase1 = (bytes[i * 4 + 2] / 255 - 0.5) * 6.283185;
    const amp23 = (bytes[i * 4 + 3] / 255) * k;
    const motion = amp1 * Math.sin(t + phase1) + amp23 * 0.5 * Math.sin(2 * t + 2 * phase1) + amp23 * 0.3 * Math.sin(3 * t + 0.5 * phase1);
    v[i] = clamp01(s + motion);
  }
  return v;
}

export function stats(bytes, k) {
  const n = N * N;
  let lit = 0;
  let shadow = 0;
  let slope = 0;
  let moving = 0;
  let sumG = 0;
  let sumA = 0;
  let maxG = 0;
  let maxA = 0;
  const R = (x, y) => bytes[(Math.min(N - 1, Math.max(0, y)) * N + Math.min(N - 1, Math.max(0, x))) * 4] / 255;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    const r = bytes[i * 4] / 255;
    const g = bytes[i * 4 + 1] / 255;
    const a = bytes[i * 4 + 3] / 255;
    if (r >= 0.88) lit++; if (r <= 0.13) shadow++;
    if (r < BUDGET.moving) { moving++; sumG += g; sumA += a; }
    if (g > maxG) maxG = g; if (a > maxA) maxA = a;
    const gr = Math.hypot(R(x + 1, y) - R(x - 1, y), R(x, y + 1) - R(x, y - 1)) * 0.5;
    if (gr > slope) slope = gr;
  }
  // the phase's coherence: mean circular |ΔB| between texels Δ apart where both move (random = 0.25)
  const coh = (d) => { let s = 0;
let c = 0; for (let y = 0; y < N; y++) for (let x = 0; x < N - d; x++) { const i = y * N + x; if (bytes[i * 4 + 1] > 5 && bytes[(i + d) * 4 + 1] > 5) { let dv = Math.abs(bytes[i * 4 + 2] - bytes[(i + d) * 4 + 2]) / 255; dv = Math.min(dv, 1 - dv); s += dv; c++; } } return c ? s / c : 0; };
  // the wind: how far the silhouette swings — mean |v(t) − R| over the plate at its peak over eight beats, and the texels that swing > 0.04
  const swing = new Float32Array(n);
  for (let b = 0; b < 8; b++) { const v = windFrame(bytes, (b / 8) * 6.283185, k); for (let i = 0; i < n; i++) { const d = Math.abs(v[i] - bytes[i * 4] / 255); if (d > swing[i]) swing[i] = d; } }
  let swingSum = 0;
  let swinging = 0; for (let i = 0; i < n; i++) { swingSum += swing[i]; if (swing[i] > 0.04) swinging++; }
  const corner = [...bytes.subarray(0, 4)];
  return { lit: lit / n, shadow: shadow / n, slope, meanG: moving ? sumG / moving : 0, meanA: moving ? sumA / moving : 0, maxG, maxA, coh1: coh(1), coh4: coh(4), coh8: coh(8), swing: swingSum / n, swingMoving: moving ? swingSum / moving : 0, swinging: swinging / n, corner };
}

export function statsRow(name, s) {
  const p = (v) => `${(100 * v).toFixed(1)}%`;
  return `${name.padEnd(18)} lit ${p(s.lit).padStart(6)} · shadow ${p(s.shadow).padStart(5)} · edge ≤ ${s.slope.toFixed(2)}/texel · G ${s.meanG.toFixed(3)} (max ${s.maxG.toFixed(2)}) · A ${s.meanA.toFixed(3)} (max ${s.maxA.toFixed(2)}) · phase coherence Δ1 ${s.coh1.toFixed(3)} Δ4 ${s.coh4.toFixed(3)} Δ8 ${s.coh8.toFixed(3)} · swing ${s.swing.toFixed(4)} (${s.swingMoving.toFixed(4)} per moving texel) on ${p(s.swinging)} of texels · corner ${s.corner.join(",")}`;
}

// ---- the command line
function parse(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith("--")) { const key = a.slice(2); const next = argv[i + 1]; if (next !== undefined && !next.startsWith("--")) { opt[key] = next; i++; } else opt[key] = true; } else pos.push(a); }
  return { pos, opt };
}

/** The plates apps/desk ships: each one's file under assets/ and the species + seed that make it. */
export const SHIPPED = [
  { file: "gobo-palm-1.rgba", species: "palm", seed: 1 },
  { file: "gobo-canopy-1.rgba", species: "canopy", seed: 1 },
];

/** A species' plate at a seed, as bytes (the default wind and the species' own edge). */
export function make(species, seed, o = {}) {
  const cv = new Canvas();
  const rand = rng(seed);
  const hints = SPECIES[species](cv, rand);
  return pack(cv, { wind: o.wind ?? 1, spot: hints?.spot ?? null, sigma: o.sigma !== undefined ? o.sigma : hints?.sigma });
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const { pos, opt } = parse(process.argv.slice(2));
  const [mode, ...rest] = pos;
  const strength = Number(opt.strength ?? 0.39);
  if (opt.check === true) {
    let off = 0;
    for (const p of SHIPPED) {
      const file = resolve(root, "assets", p.file);
      const committed = readFileSync(file);
      const { bytes } = make(p.species, p.seed);
      let differ = 0;
      for (let i = 0; i < Math.max(bytes.length, committed.length); i++) if (bytes[i] !== committed[i]) differ++;
      const ok = committed.length === bytes.length && differ === 0;
      if (!ok) off++;
      console.log(`${ok ? "PASS" : "FAIL"}  ${p.file}: ${ok ? `${p.species} --seed ${p.seed}, byte for byte` : `${differ.toLocaleString()} of ${bytes.length.toLocaleString()} bytes differ from ${p.species} --seed ${p.seed} (${committed.length} committed)`}`);
    }
    if (off > 0) process.exitCode = 1;
  } else if (mode === "stats") {
    for (const f of rest) { const b = readFileSync(f); console.log(statsRow(basename(f, ".rgba"), stats(new Uint8Array(b.buffer, b.byteOffset, b.byteLength), strength))); }
  } else if (mode in SPECIES) {
    const seed = Number(opt.seed ?? 1);
    const name = opt.name ?? `${mode}-${seed}`;
    const { bytes, kG, kA, clipped } = make(mode, seed, { wind: Number(opt.wind ?? 1), ...(opt.sigma !== undefined ? { sigma: Number(opt.sigma) } : {}) });
    const outDir = resolve(root, String(opt.out ?? "assets"));
    mkdirSync(outDir, { recursive: true });
    const outFile = resolve(outDir, `gobo-${name}.rgba`);
    writeFileSync(outFile, bytes);
    console.log(`${outFile}: ${N}×${N} rgba8, ${bytes.length} bytes · wind scale G ×${kG.toFixed(2)} A ×${kA.toFixed(2)}${clipped ? ` · ${clipped} texels clipped at 1` : ""}`);
    console.log(statsRow(`gobo-${name}`, stats(bytes, strength)));
  } else {
    console.error("usage: make-gobo-plate.mjs palm|canopy|broadleaf [--seed N] | stats a.rgba … | --check");
    process.exitCode = 2;
  }
}
