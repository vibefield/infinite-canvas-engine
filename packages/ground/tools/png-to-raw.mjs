// Decode an 8-bit non-interlaced RGB/RGBA PNG to raw RGBA bytes, row 0 = top.
// The gobo plates and the blue-noise tile enter the engine as RAW bytes so the
// browser lab and the Node oracle upload the identical texture: no decoder in
// the loop (createImageBitmap premultiplies and colour-manages; the plate's
// alpha is an amplitude, not coverage). Node's zlib is the only dependency.
//   node tools/png-to-raw.mjs in.png out.rgba
import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

export function decodePng(buf) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error("not a PNG");
  let off = 8;
  let w = 0;
  let h = 0;
  let depth = 0;
  let ctype = 0;
  let interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString("latin1", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (ctype !== 2 && ctype !== 6)) throw new Error(`unsupported PNG: depth ${depth} type ${ctype} interlace ${interlace}`);
  const ch = ctype === 6 ? 4 : 3;
  const stride = w * ch;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length !== (stride + 1) * h) throw new Error(`IDAT size ${raw.length} != ${(stride + 1) * h}`);
  const out = new Uint8Array(w * h * 4);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  const paeth = (a, b, c) => { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev[x];
      const c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1; else if (f === 4) v += paeth(a, b, c); else if (f !== 0) throw new Error(`filter ${f}`);
      cur[x] = v & 255;
    }
    for (let x = 0; x < w; x++) { const s = x * ch; const d = (y * w + x) * 4; out[d] = cur[s]; out[d + 1] = cur[s + 1]; out[d + 2] = cur[s + 2]; out[d + 3] = ch === 4 ? cur[s + 3] : 255; }
    prev.set(cur);
  }
  return { width: w, height: h, data: out };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const [, , input, output] = process.argv;
  const png = decodePng(readFileSync(input));
  writeFileSync(output, png.data);
  console.log(`${input} → ${output}: ${png.width}×${png.height} rgba, ${png.data.length} bytes`);
}
