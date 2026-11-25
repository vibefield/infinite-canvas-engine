// THE PEN'S PATH THROUGH A GLYPH (petition I59): what a hand does, derived from an OUTLINE face. For every part of a glyph
// (a simple glyph is one part; a composite is its letter, then its accent — `ttf.ts` keeps them apart):
//
//   outline → a mask at SKELETON_PX an em → its distance transform (the nib's radius: the medial axis) → thinning
//   (Zhang–Suen) → the skeleton's graph → spurs pruned, two forks a bridge apart one crossing → strokes: the edges joined
//   through a junction where two run straight on → a blob shorter than its own radius a dot → smoothed → each stroke a
//   direction by a hand's habits (top first, left first, rings counterclockwise from the top) → the strokes an order (left
//   to right, the taller first, the higher first; the dots last) → the face's CORRECTIONS (corrections.ts) → each open end
//   run on to the ink's tip.
//
// Then the glyph's pen: its samples along every stroke in order (a lift between two strokes counts HAND_PEN_LIFT em of
// path, a dot HAND_PEN_DOT em), each with the nib's radius there; and its FIELD over the glyph's rect at `em` texels an
// em — R the signed distance to the outline (128 the edge), G the ARRIVAL: the moment the nib's disc first covers the texel
// along the whole writing (where strokes cross, the first to reach it; a texel no disc covers takes the moment of the disc
// whose rim is nearest).
//
// The derivation is the spike's that proved the pen (2026-11-25), moved here whole; what changed on the way is said where it
// is. Its numbers are the same on every host and every run: only + − × ÷ and √ (correctly rounded — never `Math.hypot`,
// `Math.acos` or another library function whose last bit an engine may choose), integer raster arithmetic, stable sorts,
// no randomness.

import { HAND_ATLAS_EDGE, HAND_PEN_DOT, HAND_PEN_LIFT } from "../kit/hand-atlas";
import type { HandCorrection } from "./corrections";
import { contourSegments, type FontContour, type FontFile } from "./ttf";

/** The skeleton's raster, px an em (the spike's `HR`). */
export const SKELETON_PX = 200;
/** The R channel's reach each side of the edge, texels: ±6 texels fill 0..255, so the atlas's `range` is 12 texels in em. */
export const EDGE_TEXELS = 6;
/** The margin round each glyph's ink inside its rect, texels (R is 0 there: the edge's reach and two more). */
export const PAD_TEXELS = EDGE_TEXELS + 2;
/** The skeleton raster's margin, px. */
const MARGIN = 4;
/** A quadratic's line segments when an outline is flattened. */
const QUAD_STEPS = 10;
/** A free branch shorter than this × its junction's radius is a spur. */
const SPUR = 1.45;
/** Two branches at a junction are one stroke when they turn less than 58°: the cosine the turn is held to (cos 58°). */
const STRAIGHT_COS = 0.5299192642332049;
/** Two junctions nearer than this × their radius are one crossing (an X thins to two forks and a bridge). */
const BRIDGE = 2.4;

type Pt = [number, number];
const sq = (x: number): number => x * x;
const dist = (a: Pt, b: Pt): number => Math.sqrt(sq(b[0] - a[0]) + sq(b[1] - a[1]));
const at = <T>(list: readonly T[], i: number): T => list[i] as T;
const lengthOf = (pts: readonly Pt[]): number => {
  let l = 0;
  for (let k = 1; k < pts.length; k++) l += dist(at(pts, k - 1), at(pts, k));
  return l;
};

// ---------------------------------------------------------------- the outline

/** Contours as closed polygons, font units (y up): each quadratic as QUAD_STEPS lines. */
export function flatten(contours: readonly FontContour[]): Pt[][] {
  const out: Pt[][] = [];
  for (const contour of contours) {
    const poly: Pt[] = [];
    for (const seg of contourSegments(contour)) {
      const p0 = seg[0];
      if (seg.length === 2) poly.push([p0.x, p0.y]);
      else {
        const [, c, p1] = seg;
        for (let k = 0; k < QUAD_STEPS; k++) {
          const t = k / QUAD_STEPS;
          const u = 1 - t;
          poly.push([u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, u * u * p0.y + 2 * u * t * c.y + t * t * p1.y]);
        }
      }
    }
    if (poly.length > 2) out.push(poly);
  }
  return out;
}

/** A polygon's edges: `[ax, ay, bx, by]` each, flat. */
function edgesOf(polys: readonly Pt[][]): Float64Array {
  let n = 0;
  for (const p of polys) n += p.length;
  const e = new Float64Array(4 * n);
  let o = 0;
  for (const p of polys) {
    for (let i = 0; i < p.length; i++) {
      const a = at(p, i);
      const b = at(p, (i + 1) % p.length);
      e[o++] = a[0];
      e[o++] = a[1];
      e[o++] = b[0];
      e[o++] = b[1];
    }
  }
  return e;
}

/** The squared distance from (x, y) to edge `k` (the spike's `distToEdges`, before its root). */
function edgeDist2(e: Float64Array, k: number, x: number, y: number): number {
  const ax = e[4 * k] as number;
  const ay = e[4 * k + 1] as number;
  const dx = (e[4 * k + 2] as number) - ax;
  const dy = (e[4 * k + 3] as number) - ay;
  const ll = dx * dx + dy * dy;
  const t = ll > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / ll)) : 0;
  return sq(x - ax - dx * t) + sq(y - ay - dy * t);
}

/** Where edge `k` crosses the scanline y and which way (+1 up, −1 down), or null — the nonzero rule's one test. */
function crossing(e: Float64Array, k: number, y: number): [number, number] | null {
  const ax = e[4 * k] as number;
  const ay = e[4 * k + 1] as number;
  const bx = e[4 * k + 2] as number;
  const by = e[4 * k + 3] as number;
  if (ay <= y && by > y) return [ax + ((y - ay) / (by - ay)) * (bx - ax), 1];
  if (by <= y && ay > y) return [ax + ((y - ay) / (by - ay)) * (bx - ax), -1];
  return null;
}

/** A scanline's crossings, sorted by x (stable): the winding at x is the sum of the directions left of it. */
function rowCrossings(e: Float64Array, y: number): { xs: Float64Array; dirs: Int8Array } {
  const list: [number, number][] = [];
  for (let k = 0; k < e.length / 4; k++) {
    const c = crossing(e, k, y);
    if (c !== null) list.push(c);
  }
  list.sort((p, q) => p[0] - q[0]);
  return { xs: Float64Array.from(list, (c) => c[0]), dirs: Int8Array.from(list, (c) => c[1]) };
}

// ---------------------------------------------------------------- the skeleton's raster

interface Raster {
  readonly w: number;
  readonly h: number;
  /** Raster px → font units, and back. */
  readonly toX: (i: number) => number;
  readonly toY: (j: number) => number;
}

/** The ink's mask at the raster's pixel centres, by the nonzero rule. */
function fillMask(e: Float64Array, r: Raster): Uint8Array {
  const mask = new Uint8Array(r.w * r.h);
  for (let j = 0; j < r.h; j++) {
    const { xs, dirs } = rowCrossings(e, r.toY(j + 0.5));
    let wn = 0;
    let k = 0;
    for (let i = 0; i < r.w; i++) {
      const x = r.toX(i + 0.5);
      while (k < xs.length && (xs[k] as number) < x) { wn += dirs[k] as number; k++; }
      if (wn !== 0) mask[j * r.w + i] = 1;
    }
  }
  return mask;
}

/** The exact Euclidean distance (px) from every set pixel to the nearest unset one (Felzenszwalb–Huttenlocher). */
function edt(mask: Uint8Array, w: number, h: number): Float64Array {
  const INF = 1e12;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const d = new Float64Array(w * h);
  const pass = (len: number, get: (q: number) => number, set: (q: number, val: number) => void): void => {
    for (let q = 0; q < len; q++) f[q] = get(q);
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s: number;
      for (;;) {
        const p = v[k] as number;
        s = ((f[q] as number) + q * q - ((f[p] as number) + p * p)) / (2 * q - 2 * p);
        if (s <= (z[k] as number) && k > 0) k--;
        else if (s <= (z[k] as number)) { k = -1; break; }
        else break;
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while ((z[k + 1] as number) < q) k++;
      const p = v[k] as number;
      set(q, (q - p) * (q - p) + (f[p] as number));
    }
  };
  for (let i = 0; i < w * h; i++) d[i] = mask[i] ? INF : 0;
  for (let x = 0; x < w; x++) pass(h, (q) => d[q * w + x] as number, (q, val) => { d[q * w + x] = val; });
  for (let y = 0; y < h; y++) pass(w, (q) => d[y * w + q] as number, (q, val) => { d[y * w + q] = val; });
  for (let i = 0; i < w * h; i++) d[i] = Math.sqrt(d[i] as number);
  return d;
}

/** The mask's islands: each 8-connected run of ink its own label (1, 2, … in raster order), 0 where there is none. */
function islands(mask: Uint8Array, w: number, h: number): Int32Array {
  const label = new Int32Array(w * h);
  let next = 0;
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || label[start]) continue;
    next++;
    label[start] = next;
    stack.push(start);
    while (stack.length > 0) {
      const p = stack.pop() as number;
      const x = p % w;
      const y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const qx = x + dx;
          const qy = y + dy;
          if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
          const q = qy * w + qx;
          if (mask[q] && !label[q]) { label[q] = next; stack.push(q); }
        }
      }
    }
  }
  return label;
}

/** Zhang–Suen thinning: the mask worn down to a one-pixel skeleton. */
function thin(mask: Uint8Array, w: number, h: number): Uint8Array {
  const s = Uint8Array.from(mask);
  const px = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : (s[y * w + x] as number));
  let changed = true;
  while (changed) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      const kill: number[] = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!s[y * w + x]) continue;
          const p2 = px(x, y - 1);
          const p3 = px(x + 1, y - 1);
          const p4 = px(x + 1, y);
          const p5 = px(x + 1, y + 1);
          const p6 = px(x, y + 1);
          const p7 = px(x - 1, y + 1);
          const p8 = px(x - 1, y);
          const p9 = px(x - 1, y - 1);
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (B < 2 || B > 6) continue;
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let A = 0;
          for (let k = 0; k < 8; k++) if (!seq[k] && seq[k + 1]) A++;
          if (A !== 1) continue;
          if (step === 0 ? p2 * p4 * p6 === 0 && p4 * p6 * p8 === 0 : p2 * p4 * p8 === 0 && p2 * p6 * p8 === 0) kill.push(y * w + x);
        }
      }
      if (kill.length > 0) {
        changed = true;
        for (const i of kill) s[i] = 0;
      }
    }
  }
  return s;
}

// ---------------------------------------------------------------- the skeleton's graph

interface GNode {
  x: number;
  y: number;
  r: number;
  members: number[];
}
interface GEdge {
  /** The node at each end, or −1 (a free end). */
  a: number;
  b: number;
  pts: Pt[];
  closed?: boolean;
  dot?: boolean;
}
type Side = "a" | "b";
interface Graph {
  nodes: GNode[];
  edges: GEdge[];
}

function graphOf(skel: Uint8Array, w: number, h: number, radius: Float64Array): Graph {
  const on = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && skel[y * w + x] === 1;
  const nbrs = (i: number): number[] => {
    const x = i % w;
    const y = (i / w) | 0;
    const out: number[] = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (on(x + dx, y + dy)) out.push((y + dy) * w + x + dx);
    for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      if (on(x + dx, y + dy) && !on(x + dx, y) && !on(x, y + dy)) out.push((y + dy) * w + x + dx);
    }
    return out;
  };
  const pixels: number[] = [];
  for (let i = 0; i < w * h; i++) if (skel[i]) pixels.push(i);
  const N = new Map<number, number[]>(pixels.map((i) => [i, nbrs(i)]));
  const nb = (i: number): number[] => N.get(i) ?? [];
  const isJ = new Uint8Array(w * h);
  const cluster = new Int32Array(w * h).fill(-1);
  for (const i of pixels) if (nb(i).length >= 3) isJ[i] = 1;
  const nodes: GNode[] = [];
  for (const i of pixels) {
    if (!isJ[i] || (cluster[i] as number) >= 0) continue;
    const id = nodes.length;
    const stack = [i];
    const members: number[] = [];
    cluster[i] = id;
    while (stack.length > 0) {
      const p = stack.pop() as number;
      members.push(p);
      for (const q of nb(p)) if (isJ[q] && (cluster[q] as number) < 0) { cluster[q] = id; stack.push(q); }
    }
    let sx = 0;
    let sy = 0;
    let r = 0;
    for (const p of members) { sx += p % w; sy += (p / w) | 0; r = Math.max(r, radius[p] as number); }
    nodes.push({ x: sx / members.length + 0.5, y: sy / members.length + 0.5, r, members });
  }
  const P = (i: number): Pt => [(i % w) + 0.5, ((i / w) | 0) + 0.5];
  const visited = new Uint8Array(w * h);
  const edges: GEdge[] = [];
  const walk = (start: number, q: number, fromNode: number): { chain: number[]; end: number } => {
    const chain = [q];
    let prev = start;
    let cur = q;
    let end = -1;
    visited[q] = 1;
    for (;;) {
      const ns = nb(cur).filter((n) => n !== prev);
      const jn = ns.filter((n) => isJ[n] && !(chain.length === 1 && cluster[n] === fromNode));
      if (jn.length > 0) { end = cluster[at(jn, 0)] as number; break; }
      const nx = ns.filter((n) => !isJ[n] && !visited[n]);
      if (nx.length === 0) break;
      prev = cur;
      cur = at(nx, 0);
      chain.push(cur);
      visited[cur] = 1;
    }
    return { chain, end };
  };
  for (let id = 0; id < nodes.length; id++) {
    const node = at(nodes, id);
    for (const p of node.members) {
      for (const q of nb(p)) {
        if (isJ[q] || visited[q]) continue;
        const { chain, end } = walk(p, q, id);
        const pts: Pt[] = [[node.x, node.y], ...chain.map(P)];
        if (end >= 0) pts.push([at(nodes, end).x, at(nodes, end).y]);
        edges.push({ a: id, b: end, pts });
      }
    }
  }
  for (const i of pixels) {   // open strokes with no junction
    if (isJ[i] || visited[i] || nb(i).length !== 1) continue;
    visited[i] = 1;
    const first = at(nb(i), 0);
    if (isJ[first] || visited[first]) continue;
    const { chain } = walk(i, first, -1);
    edges.push({ a: -1, b: -1, pts: [P(i), ...chain.map(P)] });
  }
  for (const i of pixels) {   // rings with no junction, and lone pixels
    if (isJ[i] || visited[i]) continue;
    const n = nb(i);
    visited[i] = 1;
    if (n.length === 0) { edges.push({ a: -1, b: -1, pts: [P(i)], dot: true }); continue; }
    const { chain } = walk(i, at(n, 0), -1);
    edges.push({ a: -1, b: -1, pts: [P(i), ...chain.map(P), P(i)], closed: true });
  }
  return { nodes, edges };
}

/** Drop the spurs, merge two forks a short bridge apart into one crossing, then dissolve the junctions left with two branches. */
function prune(graph: Graph): Graph {
  const nodes = graph.nodes;
  let edges = graph.edges;
  for (let guard = 0; guard < 12; guard++) {
    const degree = nodes.map(() => 0);
    for (const e of edges) {
      if (e.a >= 0) degree[e.a] = (degree[e.a] as number) + 1;
      if (e.b >= 0) degree[e.b] = (degree[e.b] as number) + 1;
    }
    const before = edges.length;
    edges = edges.filter((e) => {
      const free = e.a < 0 !== e.b < 0;
      if (!free) return true;
      const id = e.a >= 0 ? e.a : e.b;
      if ((degree[id] as number) < 3) return true;
      return lengthOf(e.pts) >= SPUR * at(nodes, id).r;
    });
    let merged = false;
    for (;;) {
      const k = edges.findIndex((e) => e.a >= 0 && e.b >= 0 && e.a !== e.b && lengthOf(e.pts) < BRIDGE * Math.max(at(nodes, e.a).r, at(nodes, e.b).r));
      if (k < 0) break;
      const { a, b } = at(edges, k);
      const A = at(nodes, a);
      const B = at(nodes, b);
      const one: GNode = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2, r: Math.max(A.r, B.r), members: [...A.members, ...B.members] };
      nodes[a] = one;
      edges.splice(k, 1);
      merged = true;
      for (const e of edges) {
        if (e.a === b) e.a = a;
        if (e.b === b) e.b = a;
        if (e.a === a) e.pts[0] = [one.x, one.y];
        if (e.b === a) e.pts[e.pts.length - 1] = [one.x, one.y];
      }
    }
    for (let id = 0; id < nodes.length; id++) {
      const ends: [number, Side][] = [];
      edges.forEach((e, k) => {
        if (e.a === id) ends.push([k, "a"]);
        if (e.b === id) ends.push([k, "b"]);
      });
      if (ends.length !== 2) continue;
      const [[k1, s1], [k2, s2]] = ends as [[number, Side], [number, Side]];
      if (k1 === k2) {
        edges[k1] = { a: -1, b: -1, pts: at(edges, k1).pts, closed: true };
        merged = true;
        continue;
      }
      const e1 = at(edges, k1);
      const e2 = at(edges, k2);
      const p1 = s1 === "b" ? e1.pts : [...e1.pts].reverse();   // ends at the node
      const p2 = s2 === "a" ? e2.pts : [...e2.pts].reverse();   // starts at the node
      const next: GEdge = { a: s1 === "b" ? e1.a : e1.b, b: s2 === "a" ? e2.b : e2.a, pts: [...p1, ...p2.slice(1)] };
      edges = edges.filter((_, k) => k !== k1 && k !== k2);
      edges.push(next);
      merged = true;
      id--;
    }
    if (edges.length === before && !merged) break;
  }
  return { nodes, edges };
}

interface RawStroke {
  pts: Pt[];
  closed: boolean;
  dot: boolean;
}

/** The graph's edges joined into strokes: at a junction, the two branches that run straightest on are one stroke. */
function strokesOf({ nodes, edges }: Graph): RawStroke[] {
  const partner = new Map<string, [number, Side]>();
  const dirAt = (e: GEdge, side: Side, reach: number): Pt => {
    const pts = side === "a" ? e.pts : [...e.pts].reverse();
    let l = 0;
    let k = 1;
    for (; k < pts.length - 1; k++) {
      l += dist(at(pts, k - 1), at(pts, k));
      if (l >= reach) break;
    }
    const dx = at(pts, k)[0] - at(pts, 0)[0];
    const dy = at(pts, k)[1] - at(pts, 0)[1];
    const n = Math.sqrt(dx * dx + dy * dy) || 1;
    return [dx / n, dy / n];
  };
  for (let id = 0; id < nodes.length; id++) {
    const node = at(nodes, id);
    const ends: [number, Side][] = [];
    edges.forEach((e, k) => {
      if (e.a === id) ends.push([k, "a"]);
      if (e.b === id) ends.push([k, "b"]);
    });
    if (ends.length < 2) continue;
    const dirs = ends.map(([k, s]) => dirAt(at(edges, k), s, Math.max(2.2 * node.r, 8)));
    // the straighter a pair runs on, the larger the cosine of its turn: the spike sorted by the turn's angle, which orders alike
    const pairs: [number, number, number][] = [];
    for (let i = 0; i < ends.length; i++) {
      for (let j = i + 1; j < ends.length; j++) {
        const di = at(dirs, i);
        const dj = at(dirs, j);
        pairs.push([Math.max(-1, Math.min(1, -(di[0] * dj[0] + di[1] * dj[1]))), i, j]);
      }
    }
    pairs.sort((p, q) => q[0] - p[0]);
    const taken = new Set<number>();
    for (const [cos, i, j] of pairs) {
      if (cos < STRAIGHT_COS || taken.has(i) || taken.has(j)) continue;
      taken.add(i);
      taken.add(j);
      const ei = at(ends, i);
      const ej = at(ends, j);
      partner.set(`${ei[0]}:${ei[1]}`, ej);
      partner.set(`${ej[0]}:${ej[1]}`, ei);
    }
  }
  const used = new Set<number>();
  const strokes: RawStroke[] = [];
  const follow = (k0: number, side0: Side): RawStroke => {
    const pts: Pt[] = [];
    let closed = false;
    let k = k0;
    let side = side0;
    for (;;) {
      used.add(k);
      const e = at(edges, k);
      const seq = side === "a" ? e.pts : [...e.pts].reverse();
      pts.push(...(pts.length > 0 ? seq.slice(1) : seq));
      if (e.closed) { closed = true; break; }
      const far: Side = side === "a" ? "b" : "a";
      if (e[far] < 0) break;
      const next = partner.get(`${k}:${far}`);
      if (next === undefined) break;
      if (used.has(next[0])) { closed = dist(at(pts, 0), at(pts, pts.length - 1)) < 2; break; }
      [k, side] = next;
    }
    return { pts, closed, dot: false };
  };
  edges.forEach((e, k) => {
    if (used.has(k)) return;
    if (e.dot) { used.add(k); strokes.push({ pts: e.pts, closed: false, dot: true }); return; }
    for (const side of ["a", "b"] as const) {
      if (used.has(k)) break;
      const terminal = e[side] < 0 || !partner.has(`${k}:${side}`);
      if (terminal && !e.closed) strokes.push(follow(k, side));
    }
  });
  edges.forEach((_, k) => { if (!used.has(k)) strokes.push(follow(k, "a")); });
  return strokes;
}

// ---------------------------------------------------------------- the hand's habits

function smooth(pts: readonly Pt[], closed: boolean, passes = 4): Pt[] {
  let p: Pt[] = pts.map((q) => [q[0], q[1]]);
  for (let n = 0; n < passes; n++) {
    const q: Pt[] = p.map((v) => [v[0], v[1]]);
    for (let k = 0; k < p.length; k++) {
      const a = p[k - 1] ?? (closed ? p[p.length - 2] : undefined);
      const b = p[k + 1] ?? (closed ? p[1] : undefined);
      if (a === undefined || b === undefined) continue;
      const c = at(p, k);
      q[k] = [(a[0] + 2 * c[0] + b[0]) / 4, (a[1] + 2 * c[1] + b[1]) / 4];
    }
    p = q;
  }
  return p;
}

/** A stroke's direction as a hand takes it: a ring from its top (a little right of it) counterclockwise; a line top first, a flat one left first. */
function habit(stroke: RawStroke): RawStroke {
  let pts = stroke.pts;
  if (stroke.dot || pts.length < 2) return { ...stroke, pts };
  if (stroke.closed) {
    let area = 0;
    for (let k = 1; k < pts.length; k++) area += at(pts, k - 1)[0] * at(pts, k)[1] - at(pts, k)[0] * at(pts, k - 1)[1];
    if (area > 0) pts = [...pts].reverse();
    let top = 0;
    for (let k = 0; k < pts.length; k++) if (at(pts, k)[1] - at(pts, k)[0] * 0.25 < at(pts, top)[1] - at(pts, top)[0] * 0.25) top = k;
    const ring = pts.slice(0, -1);
    pts = [...ring.slice(top), ...ring.slice(0, top)];
    pts.push(at(pts, 0));
    return { ...stroke, pts };
  }
  const a = at(pts, 0);
  const b = at(pts, pts.length - 1);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const flat = Math.abs(dx) > 1.6 * Math.abs(dy);
  if (flat ? dx < 0 : dy < 0) pts = [...pts].reverse();
  return { ...stroke, pts };
}

/**
 * The strokes' order: left to right (0.07 em apart), else the taller first, else the higher first; then the ACCENTS, in that
 * order; the dots last, top down. An accent is a stroke on an island of ink of its own (`island`: not the one the longest
 * stroke is on), shorter than half the longest, its middle above or below the longest's extent — a grave over an A, the point
 * of a ! drawn as a short stroke. (Not the spike's, which drew no accented letter: a face that draws its accented letters
 * whole — Kalam does — wrote À's grave before the A's bar, and the point of its ! and ? before the stroke above it. A
 * composite's accent is a part of its own and comes after its letter by the parts' order alone.)
 */
function order(strokes: readonly RawStroke[], em: number, island: (s: RawStroke) => number): RawStroke[] {
  const info = strokes.map((s) => {
    let x0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    for (const p of s.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    return { s, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, y0, y1, tall: y1 - y0, len: lengthOf(s.pts) };
  });
  type Info = (typeof info)[number];
  const body = info.filter((i) => !i.s.dot);
  const dots = info.filter((i) => i.s.dot);
  const before = (p: Info, q: Info): boolean => {
    if (Math.abs(p.cx - q.cx) > 0.07 * em) return p.cx < q.cx;
    if (Math.abs(p.tall - q.tall) > 0.2 * Math.max(p.tall, q.tall)) return p.tall > q.tall;
    return p.cy < q.cy;
  };
  const sorted: Info[] = [];
  for (const item of body) {
    let k = sorted.length;
    while (k > 0 && before(item, at(sorted, k - 1))) k--;
    sorted.splice(k, 0, item);
  }
  let longest: Info | undefined;
  for (const i of body) if (longest === undefined || i.len > longest.len) longest = i;
  const main = longest === undefined ? -1 : island(longest.s);
  const accent = (i: Info): boolean =>
    longest !== undefined && i !== longest && island(i.s) !== main && i.len < 0.5 * longest.len && (i.cy < longest.y0 || i.cy > longest.y1);
  dots.sort((p, q) => p.cy - q.cy || p.cx - q.cx);
  return [...sorted.filter((i) => !accent(i)), ...sorted.filter(accent), ...dots].map((i) => i.s);
}

/**
 * Apply a correction (`order`, then `flip`), or answer null when it no longer fits what was derived — an `order` that is not a
 * permutation of the strokes, a `flip` of a stroke that is not there or is a dot. (The spike applied what it could; a correction
 * that has stopped fitting is a change in the derivation to look at, so the bake refuses it whole and says so.)
 */
function correct<S extends { readonly dot: boolean }>(strokes: readonly S[], fix: HandCorrection, reverse: (s: S) => S): S[] | null {
  let out = [...strokes];
  if (fix.order !== undefined) {
    const o = fix.order;
    if (o.length !== strokes.length || new Set(o).size !== o.length || o.some((k) => strokes[k] === undefined)) return null;
    out = o.map((k) => at(strokes, k));
  }
  for (const k of fix.flip ?? []) {
    const st = out[k];
    if (st === undefined || st.dot) return null;
    out[k] = reverse(st);
  }
  return out;
}

// ---------------------------------------------------------------- a glyph's pen

/** One sample of the pen, in the glyph's frame: SKELETON_PX an em from the pen's origin, y down. */
export interface PenSample {
  readonly x: number;
  readonly y: number;
  /** The nib's radius there (the distance to the outline, smoothed along the stroke). */
  readonly r: number;
  /** How far the pen has come when it is here, px of path. */
  readonly t: number;
  /** A dot's fill, px of path (0 on a stroke): the arrival runs from the dot's centre to its rim over this. */
  readonly dot: number;
  /** The stroke it belongs to. */
  readonly stroke: number;
}

/** A glyph's derived pen. */
export interface GlyphPen {
  /** The pen's samples in written order. */
  readonly samples: readonly PenSample[];
  /** The whole path, px (at least 1). */
  readonly total: number;
  /** Per stroke, the em points the atlas lists (y down from the origin), and whether it is a dot. */
  readonly strokes: readonly { readonly pts: readonly Pt[]; readonly dot: boolean; readonly closed: boolean }[];
  /** The outline as polygons, font units (y up) — every part's, for the field. */
  readonly polys: readonly Pt[][];
  /** The ids of the corrections applied, and those that no longer fit what was derived (refused, never half-applied). */
  readonly applied: readonly string[];
  readonly refused: readonly string[];
}

export interface DerivedGlyph {
  readonly code: number;
  /** Font units. */
  readonly advance: number;
  /** null: no ink (the space). */
  readonly pen: GlyphPen | null;
}

interface PartStroke {
  /** em, y down from the pen's origin. */
  pts: Pt[];
  /** The nib's radius at each point, skeleton px. */
  r: number[];
  dot: boolean;
  closed: boolean;
}

/** One part's strokes: the skeleton, the habits, the order, its corrections, the tips. */
function partStrokes(polys: Pt[][], upm: number, fixes: readonly HandCorrection[], applied: string[], refused: string[]): PartStroke[] {
  const e = edgesOf(polys);
  let xMin = Number.POSITIVE_INFINITY;
  let xMax = Number.NEGATIVE_INFINITY;
  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  for (const poly of polys) for (const p of poly) { xMin = Math.min(xMin, p[0]); xMax = Math.max(xMax, p[0]); yMin = Math.min(yMin, p[1]); yMax = Math.max(yMax, p[1]); }
  const s = SKELETON_PX / upm;
  const w = Math.ceil((xMax - xMin) * s) + 2 * MARGIN;
  const h = Math.ceil((yMax - yMin) * s) + 2 * MARGIN;
  const raster: Raster = { w, h, toX: (i) => xMin + (i - MARGIN) / s, toY: (j) => yMax - (j - MARGIN) / s };
  const mask = fillMask(e, raster);
  const radius = edt(mask, w, h);
  const skel = thin(mask, w, h);
  let strokes = strokesOf(prune(graphOf(skel, w, h, radius)));
  // a blob whose whole skeleton is shorter than its own radius is a dot
  strokes = strokes.map((st) => {
    if (st.dot) return st;
    const mid = at(st.pts, (st.pts.length / 2) | 0);
    const r = (radius[(mid[1] | 0) * w + (mid[0] | 0)] as number) || 1;
    return lengthOf(st.pts) < 1.3 * r ? { pts: [mid], closed: false, dot: true } : st;
  });
  // (not the spike's: ink the thinning wore to nothing — a speck — is a dot where the ink is deepest, never a glyph with no pen)
  if (strokes.length === 0) {
    let best = -1;
    for (let i = 0; i < w * h; i++) if (mask[i] && (best < 0 || (radius[i] as number) > (radius[best] as number))) best = i;
    if (best >= 0) strokes = [{ pts: [[(best % w) + 0.5, ((best / w) | 0) + 0.5]], closed: false, dot: true }];
  }
  strokes = strokes.map((st) => (st.dot ? st : { ...st, pts: smooth(st.pts, st.closed) })).map(habit);
  const land = islands(mask, w, h);
  const islandOf = (st: RawStroke): number => {
    for (const p of st.pts) {
      const i = p[0] | 0;
      const j = p[1] | 0;
      const l = i >= 0 && j >= 0 && i < w && j < h ? (land[j * w + i] as number) : 0;
      if (l > 0) return l;
    }
    return 0;
  };
  strokes = order(strokes, SKELETON_PX, islandOf);
  for (const fix of fixes) {
    const next = correct(strokes, fix, (st) => ({ ...st, pts: [...st.pts].reverse() }));
    if (next === null) refused.push(fix.id);
    else { strokes = next; applied.push(fix.id); }
  }
  const rAt = (p: Pt): number => {
    const i = Math.max(0, Math.min(w - 1, p[0] | 0));
    const j = Math.max(0, Math.min(h - 1, p[1] | 0));
    return Math.max(radius[j * w + i] as number, 1);
  };
  // run each open end on to the stroke's tip, while the ink is deep enough to hold the nib
  for (const st of strokes) {
    if (st.dot || st.closed || st.pts.length < 6) continue;
    for (const end of [0, 1]) {
      const pts = end ? st.pts : [...st.pts].reverse();
      const a = at(pts, pts.length - 5);
      const b = at(pts, pts.length - 1);
      const n = dist(a, b) || 1;
      const ux = (b[0] - a[0]) / n;
      const uy = (b[1] - a[1]) / n;
      const reach = 1.6 * rAt(b);
      for (let d = 1; d < reach; d++) {
        const p: Pt = [b[0] + ux * d, b[1] + uy * d];
        const i = p[0] | 0;
        const j = p[1] | 0;
        if (i < 0 || j < 0 || i >= w || j >= h || !mask[j * w + i] || (radius[j * w + i] as number) < 1.2) break;
        pts.push(p);
      }
      st.pts = end ? pts : pts.reverse();
    }
  }
  return strokes.map((st) => {
    const rs = st.pts.map(rAt);
    return {
      pts: st.pts.map((p): Pt => [raster.toX(p[0]) / upm, -raster.toY(p[1]) / upm]),
      r: st.dot ? rs : rs.map((_, i) => {
        let sum = 0;
        let n = 0;
        for (let d = -3; d <= 3; d++) { const v = rs[i + d]; if (v !== undefined) { sum += v; n++; } }
        return sum / n;
      }),
      dot: st.dot,
      closed: st.closed,
    };
  });
}

/**
 * Derive a glyph's pen: each part's strokes in component order (a composite's letter, then its accent), the corrections that
 * name the part's glyph (N's in Ñ too) and then the glyph's own, the pen's samples along the whole. null: the face maps no glyph.
 */
export function deriveGlyph(face: FontFile, code: number, fixes: readonly HandCorrection[]): DerivedGlyph | null {
  const id = face.glyphId(code);
  if (id === 0) return null;
  const upm = face.unitsPerEm;
  const advance = face.advance(id);
  const parts = face.parts(id).map((p) => ({ id: p.id, polys: flatten(p.contours) })).filter((p) => p.polys.length > 0);
  if (parts.length === 0) return { code, advance, pen: null };
  const applied: string[] = [];
  const refused: string[] = [];
  const isComposite = face.composite(id);
  let strokes: PartStroke[] = [];
  for (const part of parts) {
    const own = fixes.filter((f) => face.glyphId(f.code) === part.id);
    strokes.push(...partStrokes(part.polys, upm, own, applied, refused));
  }
  if (isComposite) {
    // a composite's own corrections order and turn the whole: its parts' strokes, as one list (a stroke turned keeps its radii with its points)
    for (const fix of fixes.filter((f) => f.code === code)) {
      const next = correct(strokes, fix, (st) => ({ ...st, pts: [...st.pts].reverse(), r: [...st.r].reverse() }));
      if (next === null) refused.push(fix.id);
      else { strokes = next; applied.push(fix.id); }
    }
  }
  // the pen's samples: the glyph's frame is SKELETON_PX an em, y down, from the pen's origin
  const samples: PenSample[] = [];
  let along = 0;
  strokes.forEach((st, k) => {
    if (k > 0) along += HAND_PEN_LIFT * SKELETON_PX;
    const pts = st.pts.map((p): Pt => [p[0] * SKELETON_PX, p[1] * SKELETON_PX]);
    if (st.dot) {
      const p = at(pts, 0);
      samples.push({ x: p[0], y: p[1], r: at(st.r, 0), t: along, dot: HAND_PEN_DOT * SKELETON_PX, stroke: k });
      along += HAND_PEN_DOT * SKELETON_PX;
      return;
    }
    pts.forEach((p, i) => {
      if (i > 0) along += dist(at(pts, i - 1), p);
      samples.push({ x: p[0], y: p[1], r: at(st.r, i), t: along, dot: 0, stroke: k });
    });
  });
  return {
    code, advance,
    pen: {
      samples, total: Math.max(along, 1), polys: parts.flatMap((p) => p.polys), applied, refused,
      strokes: strokes.map((st) => ({ pts: st.pts, dot: st.dot, closed: st.closed })),
    },
  };
}

/** The atlas's stroke list for a pen: each stroke's every fourth sample and its last, em rounded to 1e-4 (a dot: its one point). */
export function strokeLists(pen: GlyphPen): number[][] {
  const round = (v: number): number => +v.toFixed(4) || 0;
  return pen.strokes.map((st) => {
    const keep = st.dot ? st.pts.slice(0, 1) : st.pts.filter((_, i) => i % 4 === 0 || i === st.pts.length - 1);
    return keep.flatMap((p) => [round(p[0]), round(p[1])]);
  });
}

// ---------------------------------------------------------------- the field

/** A glyph's texels: its rect's size, the pen's origin in it, and `w × h × 2` bytes (R the edge, G the arrival). */
export interface GlyphField {
  readonly w: number;
  readonly h: number;
  /** Texels from the rect's top-left to the pen's origin (whole texels). */
  readonly origin: readonly [number, number];
  readonly bytes: Uint8Array;
}

/** The em the R channel spans at `em` texels an em (the atlas's `range`). */
export const edgeRange = (em: number): number => (2 * EDGE_TEXELS) / em;

/**
 * The glyph's field at `em` texels an em: the rect is the ink's box in whole texels and PAD_TEXELS round it, so the origin is
 * whole texels too. `exhaustive` answers by the plain loops over every edge and every sample — the spike's — which the grids
 * below must equal byte for byte (test/bake-field.test.ts holds them so); the bake runs the grids.
 */
export function glyphField(pen: GlyphPen, upm: number, em: number, exhaustive = false): GlyphField {
  const e = edgesOf(pen.polys);
  const edgeCount = e.length / 4;
  let xMin = Number.POSITIVE_INFINITY;
  let xMax = Number.NEGATIVE_INFINITY;
  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  for (const poly of pen.polys) for (const p of poly) { xMin = Math.min(xMin, p[0]); xMax = Math.max(xMax, p[0]); yMin = Math.min(yMin, p[1]); yMax = Math.max(yMax, p[1]); }
  const a = em / upm;   // texels a font unit
  const left = Math.floor(xMin * a) - PAD_TEXELS;
  const right = Math.ceil(xMax * a) + PAD_TEXELS;
  const bottom = Math.floor(yMin * a) - PAD_TEXELS;
  const top = Math.ceil(yMax * a) + PAD_TEXELS;
  const w = right - left;
  const h = top - bottom;
  // the pen's origin in the rect (`0 - left`, never `-left`: a rect from x 0 would say −0, which JSON writes as 0)
  const origin: [number, number] = [0 - left, top];
  const bytes = new Uint8Array(w * h * 2);
  const range = edgeRange(em);
  const s = SKELETON_PX / upm;   // the pen's px a font unit
  const slack = (0.5 * SKELETON_PX) / em;   // half a texel, in the pen's px
  const samples = pen.samples;
  const total = pen.total;
  // R: ±(range / 2) em fills 0..255; past CUT (font units) a texel's byte is 0 or 255 whatever the distance, so the grid may stop there
  const cut = 0.51 * range * upm;
  const edgeByte = (inside: boolean, d2: number): number => {
    const d = Math.sqrt(d2) / upm;
    return Math.max(0, Math.min(255, Math.round(HAND_ATLAS_EDGE + ((inside ? d : -d) / range) * 255)));
  };
  const arrivalByte = (t: number): number => Math.round(Math.min(1, t / total) * 255);

  if (exhaustive) {
    for (let j = 0; j < h; j++) {
      const fy = (top - j - 0.5) / a;
      for (let i = 0; i < w; i++) {
        const fx = (left + i + 0.5) / a;
        let wn = 0;
        for (let k = 0; k < edgeCount; k++) { const c = crossing(e, k, fy); if (c !== null && c[0] < fx) wn += c[1]; }
        let best = Number.POSITIVE_INFINITY;
        for (let k = 0; k < edgeCount; k++) best = Math.min(best, edgeDist2(e, k, fx, fy));
        const gx = fx * s;
        const gy = -fy * s;
        let arrive = Number.POSITIVE_INFINITY;
        let near = Number.POSITIVE_INFINITY;
        let nearT = 0;
        for (const sp of samples) {
          const d = Math.sqrt(sq(gx - sp.x) + sq(gy - sp.y));
          const t = sp.dot > 0 ? sp.t + sp.dot * Math.min(1, d / sp.r) : sp.t;
          if (d <= sp.r + slack && t < arrive) arrive = t;
          if (d - sp.r < near) { near = d - sp.r; nearT = t; }
        }
        const o = 2 * (j * w + i);
        bytes[o] = edgeByte(wn !== 0, best);
        bytes[o + 1] = arrivalByte(arrive === Number.POSITIVE_INFINITY ? nearT : arrive);
      }
    }
    return { w, h, origin, bytes };
  }

  // ---- the edges' grid (font units): an edge sits in every cell its box, grown by CUT, meets — a texel's own cell then holds
  // every edge within CUT of it, so its nearest edge whenever that is nearer than CUT, and a byte past CUT is 0 or 255 anyway
  const ex0 = left / a;
  const ey0 = bottom / a;
  const ecols = Math.max(1, Math.ceil((right / a - ex0) / cut));
  const erows = Math.max(1, Math.ceil((top / a - ey0) / cut));
  const ecell = (v: number, v0: number, n: number): number => Math.max(0, Math.min(n - 1, Math.floor((v - v0) / cut)));
  const ebins: number[][] = Array.from({ length: ecols * erows }, () => []);
  for (let k = 0; k < edgeCount; k++) {
    const x0 = Math.min(e[4 * k] as number, e[4 * k + 2] as number) - cut - 1;
    const x1 = Math.max(e[4 * k] as number, e[4 * k + 2] as number) + cut + 1;
    const y0 = Math.min(e[4 * k + 1] as number, e[4 * k + 3] as number) - cut - 1;
    const y1 = Math.max(e[4 * k + 1] as number, e[4 * k + 3] as number) + cut + 1;
    for (let cy = ecell(y0, ey0, erows); cy <= ecell(y1, ey0, erows); cy++) {
      for (let cx = ecell(x0, ex0, ecols); cx <= ecell(x1, ex0, ecols); cx++) (ebins[cy * ecols + cx] as number[]).push(k);
    }
  }
  // ---- the samples' grids (the pen's px): COVER holds a sample in every cell its disc (grown by the slack) meets, so a
  // texel's cell holds every disc that covers it; NEAR holds each sample once, by its centre, for the rim nearest a texel
  // no disc covers — searched ring by ring outward until no farther ring could hold a nearer rim
  const gx0 = left * (SKELETON_PX / em) - 1;
  const gy0 = -top * (SKELETON_PX / em) - 1;
  let gx1 = right * (SKELETON_PX / em) + 1;
  let gy1 = -bottom * (SKELETON_PX / em) + 1;
  const lo = { x: gx0, y: gy0 };
  let rMax = 0;
  for (const sp of samples) {
    lo.x = Math.min(lo.x, sp.x - 1);
    lo.y = Math.min(lo.y, sp.y - 1);
    gx1 = Math.max(gx1, sp.x + 1);
    gy1 = Math.max(gy1, sp.y + 1);
    rMax = Math.max(rMax, sp.r);
  }
  const C = (2 * SKELETON_PX) / em;   // two texels
  const cols = Math.max(1, Math.ceil((gx1 - lo.x) / C));
  const rows = Math.max(1, Math.ceil((gy1 - lo.y) / C));
  const cellOf = (v: number, v0: number, n: number): number => Math.max(0, Math.min(n - 1, Math.floor((v - v0) / C)));
  const cover: number[][] = Array.from({ length: cols * rows }, () => []);
  const near: number[][] = Array.from({ length: cols * rows }, () => []);
  samples.forEach((sp, n) => {
    const reach = sp.r + slack + 1;
    for (let cy = cellOf(sp.y - reach, lo.y, rows); cy <= cellOf(sp.y + reach, lo.y, rows); cy++) {
      for (let cx = cellOf(sp.x - reach, lo.x, cols); cx <= cellOf(sp.x + reach, lo.x, cols); cx++) (cover[cy * cols + cx] as number[]).push(n);
    }
    (near[cellOf(sp.y, lo.y, rows) * cols + cellOf(sp.x, lo.x, cols)] as number[]).push(n);
  });
  const timeAt = (sp: PenSample, d: number): number => (sp.dot > 0 ? sp.t + sp.dot * Math.min(1, d / sp.r) : sp.t);

  for (let j = 0; j < h; j++) {
    const fy = (top - j - 0.5) / a;
    const { xs, dirs } = rowCrossings(e, fy);
    let wn = 0;
    let q = 0;
    for (let i = 0; i < w; i++) {
      const fx = (left + i + 0.5) / a;
      while (q < xs.length && (xs[q] as number) < fx) { wn += dirs[q] as number; q++; }
      let best = Number.POSITIVE_INFINITY;
      for (const k of ebins[ecell(fy, ey0, erows) * ecols + ecell(fx, ex0, ecols)] as number[]) best = Math.min(best, edgeDist2(e, k, fx, fy));
      const gx = fx * s;
      const gy = -fy * s;
      const ci = cellOf(gx, lo.x, cols);
      const cj = cellOf(gy, lo.y, rows);
      let arrive = Number.POSITIVE_INFINITY;
      for (const n of cover[cj * cols + ci] as number[]) {
        const sp = at(samples, n);
        const d = Math.sqrt(sq(gx - sp.x) + sq(gy - sp.y));
        const t = timeAt(sp, d);
        if (d <= sp.r + slack && t < arrive) arrive = t;
      }
      if (arrive === Number.POSITIVE_INFINITY && samples.length > 0) {
        // the nearest rim, the first sample on a tie (the plain loop's strict <)
        let bestRim = Number.POSITIVE_INFINITY;
        let bestN = -1;
        let bestT = 0;
        for (let ring = 0; ; ring++) {
          // no sample in this ring or past it is nearer than (ring − 1) cells; with the widest nib and a px of play, its rim neither
          const floor = (ring - 1) * C - rMax - 1;
          if (bestN >= 0 && bestRim < floor) break;
          if (ci - ring < 0 && cj - ring < 0 && ci + ring >= cols && cj + ring >= rows) break;
          for (let cy = cj - ring; cy <= cj + ring; cy++) {
            if (cy < 0 || cy >= rows) continue;
            const edge = cy === cj - ring || cy === cj + ring;
            for (let cx = ci - ring; cx <= ci + ring; cx += edge || ring === 0 ? 1 : 2 * ring) {
              if (cx < 0 || cx >= cols) continue;
              for (const n of near[cy * cols + cx] as number[]) {
                const sp = at(samples, n);
                const d = Math.sqrt(sq(gx - sp.x) + sq(gy - sp.y));
                const rim = d - sp.r;
                if (rim < bestRim || (rim === bestRim && n < bestN)) { bestRim = rim; bestN = n; bestT = timeAt(sp, d); }
              }
            }
          }
        }
        arrive = bestT;
      }
      const o = 2 * (j * w + i);
      bytes[o] = best <= cut * cut ? edgeByte(wn !== 0, best) : wn !== 0 ? 255 : 0;
      bytes[o + 1] = samples.length > 0 ? arrivalByte(arrive) : 0;
    }
  }
  return { w, h, origin, bytes };
}
