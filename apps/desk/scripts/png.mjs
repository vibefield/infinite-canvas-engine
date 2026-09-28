// A PNG decoder for the rigs' captures — 8-bit, non-interlaced RGB or RGBA (what Chrome's CDP screenshots are) to raw
// RGBA bytes, row 0 = top — so two captures are compared in Node as pixels, with no browser decode (colour management,
// premultiplication) between them. The prototype's tools/png-to-raw.mjs, conformed; Node's zlib is the only dependency.
import { inflateSync } from "node:zlib";

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** `{ width, height, rgba }` of an 8-bit non-interlaced RGB/RGBA PNG. */
export function decodePng(buf) {
  for (let i = 0; i < 8; i++) if (buf[i] !== SIGNATURE[i]) throw new Error("not a PNG");
  let off = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let ctype = 0;
  let interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (ctype !== 2 && ctype !== 6)) throw new Error(`unsupported PNG: depth ${depth} type ${ctype} interlace ${interlace}`);
  const ch = ctype === 6 ? 4 : 3;
  const stride = width * ch;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length !== (stride + 1) * height) throw new Error(`IDAT holds ${raw.length} bytes, not ${(stride + 1) * height}`);
  const rgba = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  // one loop per filter, the filter read once a row (K-H: a 2400 × 1600 capture decoded in 0.5–1.3 s on a loaded host with the
  // filter tested per byte — a rig decodes a dozen and more); an RGBA row lands with one copy
  for (let y = 0; y < height; y++) {
    const at = y * (stride + 1);
    const filter = raw[at];
    const line = raw.subarray(at + 1, at + 1 + stride);
    if (filter === 0) cur.set(line);
    else if (filter === 1) {
      for (let x = 0; x < ch; x++) cur[x] = line[x];
      for (let x = ch; x < stride; x++) cur[x] = (line[x] + cur[x - ch]) & 255;
    } else if (filter === 2) {
      for (let x = 0; x < stride; x++) cur[x] = (line[x] + prev[x]) & 255;
    } else if (filter === 3) {
      for (let x = 0; x < ch; x++) cur[x] = (line[x] + (prev[x] >> 1)) & 255;
      for (let x = ch; x < stride; x++) cur[x] = (line[x] + ((cur[x - ch] + prev[x]) >> 1)) & 255;
    } else if (filter === 4) {
      for (let x = 0; x < ch; x++) cur[x] = (line[x] + prev[x]) & 255;   // paeth(0, b, 0) = b
      for (let x = ch; x < stride; x++) cur[x] = (line[x] + paeth(cur[x - ch], prev[x], prev[x - ch])) & 255;
    } else throw new Error(`PNG filter ${filter}`);
    if (ch === 4) rgba.set(cur, y * width * 4);
    else {
      for (let x = 0; x < width; x++) {
        const s = x * 3;
        const d = (y * width + x) * 4;
        rgba[d] = cur[s]; rgba[d + 1] = cur[s + 1]; rgba[d + 2] = cur[s + 2]; rgba[d + 3] = 255;
      }
    }
    const t = prev;
    prev = cur;
    cur = t;
  }
  return { width, height, rgba };
}
