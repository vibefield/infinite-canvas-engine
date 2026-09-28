/**
 * The rigs' PNG decoder (scripts/png.mjs) — every capture a rig compares goes through it, so a faster decode (K-H: one loop per
 * filter, an RGBA row landed with one copy) must return the same bytes. Rows encoded here with each of the five filters, RGB and
 * RGBA, random pixels (a seeded LCG), must decode to exactly what was encoded; an interlaced or 16-bit image is refused.
 */
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
// @ts-expect-error — a rig harness module (plain ESM, no declarations)
import { decodePng } from "../scripts/png.mjs";

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};
function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  Buffer.from(data).copy(out, 8);
  return out;   // the decoder reads no CRC
}
/** Encode `px` (rows of `ch`-byte pixels) with row y's filter `filters[y % 5]`. */
function encode(width: number, height: number, ch: 3 | 4, px: Uint8Array): Buffer {
  const stride = width * ch;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const f = y % 5;
    raw[y * (stride + 1)] = f;
    for (let x = 0; x < stride; x++) {
      const v = px[y * stride + x] as number;
      const a = x >= ch ? (px[y * stride + x - ch] as number) : 0;
      const b = y > 0 ? (px[(y - 1) * stride + x] as number) : 0;
      const c = x >= ch && y > 0 ? (px[(y - 1) * stride + x - ch] as number) : 0;
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
      raw[y * (stride + 1) + 1 + x] = (v - pred) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = ch === 4 ? 6 : 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))]);
}
function pixels(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; out[i] = s >>> 24; }
  return out;
}

describe("the rigs' PNG decoder (K-H)", () => {
  for (const ch of [4, 3] as const) {
    it(`decodes every filter exactly — ${ch === 4 ? "RGBA" : "RGB"}`, () => {
      const [w, h] = [37, 23];
      const px = pixels(w * h * ch, ch);
      const img = decodePng(encode(w, h, ch, px));
      expect([img.width, img.height]).toEqual([w, h]);
      const want = new Uint8Array(w * h * 4);
      for (let i = 0; i < w * h; i++) for (let k = 0; k < 4; k++) want[i * 4 + k] = k < ch ? (px[i * ch + k] as number) : 255;
      expect(Buffer.from(img.rgba).equals(Buffer.from(want))).toBe(true);
    });
  }

  it("refuses what it does not read", () => {
    const png = encode(4, 4, 4, pixels(64, 9));
    const interlaced = Buffer.from(png);
    interlaced[8 + 8 + 12] = 1;   // IHDR's interlace byte
    expect(() => decodePng(interlaced)).toThrow(/unsupported PNG/);
  });
});
