// The oracle's PICTURE (design-015 D3r-a): a small photograph for the print scenes, made by
// arithmetic alone — no browser, no decoder, no colour management — so the bytes are the same
// on every machine, and both hosts (the Node oracle, apps/desk's parity page) upload exactly
// them through `PhotoPass.picture` (raw sRGB rgba8, row 0 = the top). The prototype's photo
// lab had no committed picture: its harness drew canvases at runtime (`samplePicture`), which
// a Node host cannot. What it shows is chosen to exercise the print, not to be pretty: a sky's
// smooth ramp (the sRGB decode), a sun with a soft halo (the gloss reads over a bright patch),
// two ridges with hard edges (the bilinear seam), a sea of 1-texel stripes and a 2-texel
// checker (the mip chain: a print seen small averages them), and one opaque alpha throughout.
//
//   node tools/make-photo-fixture.mjs          → oracle/fixtures/assets/photo-1.{rgba,json}
//   node tools/make-photo-fixture.mjs --check  → exit 1 unless the committed bytes are these
import { readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dir = resolve(root, "oracle/fixtures/assets");
const W = 192;
const H = 128;
const HORIZON = 76;

const clamp = (v) => Math.min(255, Math.max(0, Math.round(v)));
const mix = (a, b, t) => a + (b - a) * t;
/** A triangle wave of period `p` — the ridges' profile, with no transcendental (every host rounds these alike). */
const tri = (x, p) => { const f = (x / p) % 1; return f < 0.5 ? f * 2 : 2 - f * 2; };

const bytes = new Uint8Array(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let r;
    let g;
    let b;
    if (y < HORIZON) {
      // the sky: a deep blue overhead (its red channel starting at 0 — the file's first bytes hold a NUL, so git keeps it binary), warming to the horizon
      const t = y / HORIZON;
      r = mix(0, 250, t * t); g = mix(62, 170, t); b = mix(128, 110, t);
      // the sun and its halo
      const d = Math.sqrt((x - 128) * (x - 128) + (y - 50) * (y - 50));   // sqrt is correctly rounded everywhere; hypot need not be
      if (d < 12) { r = 255; g = 236; b = 170; }
      else if (d < 40) { const f = 1 - (d - 12) / 28; const k = f * f; r = mix(r, 255, k); g = mix(g, 214, k); b = mix(b, 150, k); }
    } else {
      // the sea: 1-texel stripes, brighter in the sun's path
      const path = Math.max(0, 1 - Math.abs(x - 128) / (10 + (y - HORIZON) * 0.8));
      const stripe = y % 2 === 0 ? 1 : 0.72;
      r = mix(22, 250, path * 0.8) * stripe; g = mix(58, 200, path * 0.8) * stripe; b = mix(92, 140, path * 0.8) * stripe;
    }
    // two ridges before the horizon, the nearer darker
    const far = HORIZON - 10 - 14 * tri(x + 17, 71);
    const near = HORIZON - 2 - 9 * tri(x + 5, 43);
    if (y >= near && y < HORIZON) { r = 34; g = 44; b = 52; }
    else if (y >= far && y < HORIZON) { r = 86; g = 88; b = 110; }
    // a 2-texel checker in the lower left: what a print seen small must average, never alias
    if (x < 40 && y >= 96) { const on = ((x >> 1) + (y >> 1)) % 2 === 0; r = on ? 240 : 20; g = on ? 232 : 24; b = on ? 216 : 30; }
    const o = (y * W + x) * 4;
    bytes[o] = clamp(r); bytes[o + 1] = clamp(g); bytes[o + 2] = clamp(b); bytes[o + 3] = 255;
  }
}
const meta = `${JSON.stringify({ w: W, h: H, format: "rgba8 sRGB, straight alpha, row 0 = top", made: "tools/make-photo-fixture.mjs", generated: "2026-09-25" }, null, 2)}\n`;

const rawPath = resolve(dir, "photo-1.rgba");
const metaPath = resolve(dir, "photo-1.json");
if (process.argv.includes("--check")) {
  let ok = true;
  try { ok = Buffer.compare(readFileSync(rawPath), Buffer.from(bytes)) === 0 && readFileSync(metaPath, "utf8") === meta; } catch { ok = false; }
  if (!ok) { console.error(`${relative(root, rawPath)} is not what tools/make-photo-fixture.mjs makes — run it`); process.exit(1); }
  console.log("photo-1 is fresh");
} else {
  writeFileSync(rawPath, bytes);
  writeFileSync(metaPath, meta);
  console.log(`wrote ${relative(root, rawPath)} (${W}×${H} rgba8, ${bytes.length} bytes) and ${relative(root, metaPath)}`);
}
