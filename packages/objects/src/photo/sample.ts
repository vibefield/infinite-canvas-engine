// THE PRINT'S SAMPLE PICTURE (K5b, D-K5b.4) — what the print on the pegboard shows: a small landscape the photo kind SHIPS, made from
// arithmetic alone (no network, no blob store, no decoder), so every host — a browser, the Node oracle — makes the same bytes. A print
// names it as it names any picture, by its blob (`SAMPLE_PICTURE`); the kind's pictures make it where they would fetch one. A dusk
// over water: a sky warming to the horizon, a low sun, two ranges of hills, the water taking the sky's light, a little grain.

/** The sample's name — a print whose `blob` is this shows the sample (its `width` × `height` the sample's 3 : 2). */
export const SAMPLE_PICTURE = "sample:dusk";
/** The sample's size, texels (a 6 × 4's aspect — the print's extent at rest). */
export const SAMPLE_SIZE = { w: 240, h: 160 } as const;

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (a: number, b: number, x: number): number => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
/** A small integer hash → [0, 1). */
function hash(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** A ridge line: a few sines, 0 … 1 of the height. */
const ridge = (u: number, a: number, b: number, c: number): number => a + 0.035 * Math.sin(u * 7.1 + b) + 0.02 * Math.sin(u * 17.3 + c) + 0.008 * Math.sin(u * 41.0 + b * 2);

/** The sample at `width` × `height` texels: sRGB rgba8, row-major from the top. */
export function samplePicture(width: number = SAMPLE_SIZE.w, height: number = SAMPLE_SIZE.h): Uint8Array<ArrayBuffer> {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const out = new Uint8Array(w * h * 4);
  const horizon = 0.58;
  const sun = { u: 0.68, v: 0.47, r: 0.055 };
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      // the sky: deep blue overhead warming to apricot at the horizon
      const k = smooth(0.0, horizon, v);
      let r = mix(58, 246, k * k);
      let g = mix(86, 190, k * k);
      let b = mix(140, 150, k);
      // the sun and its glow
      const d = Math.hypot((u - sun.u) * (w / h), v - sun.v);
      const glow = Math.exp(-d * 9) * 0.55;
      r = mix(r, 255, glow); g = mix(g, 214, glow); b = mix(b, 160, glow);
      if (d < sun.r) { const e = smooth(sun.r, sun.r * 0.8, d); r = mix(r, 255, e); g = mix(g, 238, e); b = mix(b, 200, e); }
      // the far range, then the near one
      const far = ridge(u, 0.5, 1.3, 0.4);
      if (v > far && v < horizon) { const t = smooth(far, horizon, v) * 0.35; r = mix(118, 92, t); g = mix(112, 98, t); b = mix(146, 130, t); }
      const near = ridge(u, 0.555, 4.2, 2.9) + 0.025 * smooth(0.2, 0.0, u);
      if (v > near && v < horizon) { const t = smooth(near, horizon, v); r = mix(62, 44, t); g = mix(78, 64, t); b = mix(70, 60, t); }
      // the water: the sky's light upside down, darker, broken into ripples; the sun's path on it
      if (v >= horizon) {
        const m = horizon - (v - horizon) * 1.6;
        const km = smooth(0.0, horizon, Math.max(m, 0));
        const ripple = 0.5 + 0.5 * Math.sin(v * h * 1.9 + Math.sin(u * 23.0) * 1.7);
        r = mix(46, 214, km * km) * (0.78 + 0.08 * ripple);
        g = mix(70, 166, km * km) * (0.78 + 0.08 * ripple);
        b = mix(118, 146, km) * (0.82 + 0.06 * ripple);
        const path = Math.exp(-Math.abs(u - sun.u) * 26) * smooth(1.0, horizon, v) * ripple;
        r = mix(r, 255, path * 0.7); g = mix(g, 212, path * 0.6); b = mix(b, 150, path * 0.4);
      }
      // a little grain, as a print has
      const n = (hash(x, y) - 0.5) * 6;
      const o = (y * w + x) * 4;
      out[o] = Math.min(255, Math.max(0, Math.round(r + n)));
      out[o + 1] = Math.min(255, Math.max(0, Math.round(g + n)));
      out[o + 2] = Math.min(255, Math.max(0, Math.round(b + n)));
      out[o + 3] = 255;
    }
  }
  return out;
}
