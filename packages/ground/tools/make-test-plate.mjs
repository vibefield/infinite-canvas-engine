// (Re)make oracle/fixtures/assets/content-test.rgba — the 128×128 PREMULTIPLIED rgba8 plate the
// content term is proven against (README §4g). Raw bytes, row 0 = top, the
// mat's discipline: both hosts upload the identical texture, no decoder.
//
//   node tools/make-test-plate.mjs
//
// The picture is chosen so every check has something to bite on: a diagonal
// gradient with a 16 px checker (every texel distinct from its neighbours — a
// half-texel slip reads), three saturated blocks (the sRGB round trip), a
// transparent disc (the plate shows through: content is `over` the surface),
// and a half-transparent band (the `over` at alpha ½, premultiplied).
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const PLATE_SIZE = 128;

export function testPlate() {
  const N = PLATE_SIZE;
  const px = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const o = (y * N + x) * 4;
    const check = ((x >> 4) + (y >> 4)) & 1 ? 24 : -24;
    let r = Math.min(255, Math.max(0, x * 2 + check));
    let g = Math.min(255, Math.max(0, y * 2 + check));
    let b = Math.min(255, Math.max(0, 128 + check));
    let a = 255;
    if (x >= 8 && x < 24 && y >= 8 && y < 24) { r = 255; g = 0; b = 0; }
    if (x >= 28 && x < 44 && y >= 8 && y < 24) { r = 0; g = 255; b = 0; }
    if (x >= 48 && x < 64 && y >= 8 && y < 24) { r = 0; g = 0; b = 255; }
    if ((x - 96) ** 2 + (y - 32) ** 2 < 20 * 20) { r = 0; g = 0; b = 0; a = 0; }            // transparent: the surface shows
    if (y >= 100 && y < 116) { r >>= 1; g >>= 1; b >>= 1; a = 128; }                         // half-transparent, premultiplied
    px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = a;
  }
  return px;
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const out = resolve(import.meta.dirname, "../oracle/fixtures/assets/content-test.rgba");
  writeFileSync(out, testPlate());
  console.log(`${out}: ${PLATE_SIZE}×${PLATE_SIZE} rgba8, premultiplied, ${PLATE_SIZE * PLATE_SIZE * 4} bytes`);
}
