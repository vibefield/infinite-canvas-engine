// (The kit's since K4a, design-016 §5 — moved from notebook/paper-tex.ts: the desk calendar's sheets are the same paper.)
//
// The PAPER's texture — baked once, sampled everywhere a page is (NOTEBOOK.md §4). Pure: bytes
// out, no GPU. A tileable 256² rgba8:
//   R  the mottle — the pulp's slow clouds (periodic value noise, 4 and 8 cells to the tile)
//   G  the fibres — a few hundred short curved strokes, lighter and darker, laid at random with a
//      bias along the machine direction, wrapping at the tile's edges (0.5 = none)
//   B  A  the tooth's slope — the gradient of a fine periodic height (32 cells to the tile),
//      signed about 0.5
// Sampled with mipmaps and explicit gradients, the tooth and the fibres fade into the pixel as a
// page is zoomed out — filtered, not cut — and a page costs two fetches, not a dozen noises.

export const PAPER_TEX = 256;
/** How much of the tooth's slope one step of B/A encodes (the decode multiplies back). */
export const TOOTH_SCALE = 48;

const fract = (x: number): number => x - Math.floor(x);
function hash(i: number, j: number, seed: number): number {
  let h = (Math.imul(i, 668265261) ^ Math.imul(j, 374761393) ^ Math.imul(seed, 1274126177)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Periodic value noise on a lattice of `cells` to the unit square (smoothstep between corners), and its gradient. */
function vnoise(u: number, v: number, cells: number, seed: number): [number, number, number] {
  const x = u * cells;
  const y = v * cells;
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const w = (t: number) => t * t * (3 - 2 * t);
  const dw = (t: number) => 6 * t * (1 - t);
  const at = (a: number, b: number) => hash(((a % cells) + cells) % cells, ((b % cells) + cells) % cells, seed);
  const a = at(i, j);
  const b = at(i + 1, j);
  const c = at(i, j + 1);
  const d = at(i + 1, j + 1);
  const k = a - b - c + d;
  const wx = w(fx);
  const wy = w(fy);
  return [a + (b - a) * wx + (c - a) * wy + k * wx * wy - 0.5, dw(fx) * (b - a + k * wy) * cells, dw(fy) * (c - a + k * wx) * cells];
}

/** The texture's bytes (deterministic: the same page everywhere, every run). */
export function paperTexture(seed = 7): Uint8Array<ArrayBuffer> {
  const N = PAPER_TEX;
  const out = new Uint8Array(N * N * 4);
  const fib = new Float32Array(N * N);
  // the fibres: strokes of a few texels, a gaussian stamp stepped along each, wrapping
  let r = seed * 9973;
  const rnd = () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296; };
  for (let f = 0; f < 420; f++) {
    const x0 = rnd() * N;
    const y0 = rnd() * N;
    // most fibres run near the machine direction (along the page's height), some anywhere
    const a = rnd() < 0.65 ? Math.PI / 2 + (rnd() - 0.5) * 0.9 : rnd() * Math.PI;
    const len = 5 + rnd() * 16;
    const bend = (rnd() - 0.5) * 0.12;
    const tone = (rnd() < 0.55 ? 1 : -1) * (0.35 + rnd() * 0.65);
    const wid = 0.45 + rnd() * 0.5;
    let x = x0;
    let y = y0;
    let ang = a;
    for (let s = 0; s < len; s += 0.5) {
      x += Math.cos(ang) * 0.5; y += Math.sin(ang) * 0.5; ang += bend;
      const fade = Math.sin((s / len) * Math.PI);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const px = Math.floor(x) + dx;
        const py = Math.floor(y) + dy;
        const ddx = px + 0.5 - x;
        const ddy = py + 0.5 - y;
        const g = Math.exp(-(ddx * ddx + ddy * ddy) / (2 * wid * wid));
        const ix = ((px % N) + N) % N;
        const iy = ((py % N) + N) % N;
        fib[iy * N + ix] = (fib[iy * N + ix] as number) + tone * g * fade * 0.18;
      }
    }
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const u = (i + 0.5) / N;
    const v = (j + 0.5) / N;
    const m = vnoise(u, v, 4, seed)[0] + 0.5 * vnoise(u, v, 8, seed + 1)[0];
    const t1 = vnoise(u, v, 32, seed + 2);
    const t2 = vnoise(u, v, 64, seed + 3);
    const gx = t1[1] + 0.5 * t2[1];
    const gy = t1[2] + 0.5 * t2[2];
    const o = (j * N + i) * 4;
    out[o] = Math.round(Math.min(Math.max(0.5 + m * 0.9, 0), 1) * 255);
    out[o + 1] = Math.round(Math.min(Math.max(0.5 + (fib[j * N + i] as number), 0), 1) * 255);
    out[o + 2] = Math.round(Math.min(Math.max(0.5 + gx / TOOTH_SCALE / 2, 0), 1) * 255);
    out[o + 3] = Math.round(Math.min(Math.max(0.5 + gy / TOOTH_SCALE / 2, 0), 1) * 255);
  }
  void fract;
  return out;
}
