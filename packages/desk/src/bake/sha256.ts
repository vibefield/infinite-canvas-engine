// SHA-256 (FIPS 180-4) over bytes, as lower-case hex: the atlas's `source.sha256` names the font file it was baked from. Pure
// 32-bit integer arithmetic, so the bake needs no `node:crypto` (the desk's src imports nothing but itself, core and kernel) and
// no async WebCrypto.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Hex(bytes: Uint8Array): string {
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  // the message, padded: a 1 bit, zeros, and the length in bits as a 64-bit big-endian number, to a multiple of 64 bytes
  const n = bytes.length;
  const padded = new Uint8Array(Math.ceil((n + 9) / 64) * 64);
  padded.set(bytes);
  padded[n] = 1 << 7;   // the 1 bit
  const bits = n * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000));
  view.setUint32(padded.length - 4, bits >>> 0);
  const W = new Uint32Array(64);
  const rotr = (x: number, k: number): number => (x >>> k) | (x << (32 - k));
  for (let block = 0; block < padded.length; block += 64) {
    for (let t = 0; t < 16; t++) W[t] = view.getUint32(block + 4 * t);
    for (let t = 16; t < 64; t++) {
      const w15 = W[t - 15] as number;
      const w2 = W[t - 2] as number;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      W[t] = ((W[t - 16] as number) + s0 + (W[t - 7] as number) + s1) >>> 0;
    }
    let a = H[0] as number;
    let b = H[1] as number;
    let c = H[2] as number;
    let d = H[3] as number;
    let e = H[4] as number;
    let f = H[5] as number;
    let g = H[6] as number;
    let h = H[7] as number;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + (K[t] as number) + (W[t] as number)) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] = ((H[0] as number) + a) >>> 0;
    H[1] = ((H[1] as number) + b) >>> 0;
    H[2] = ((H[2] as number) + c) >>> 0;
    H[3] = ((H[3] as number) + d) >>> 0;
    H[4] = ((H[4] as number) + e) >>> 0;
    H[5] = ((H[5] as number) + f) >>> 0;
    H[6] = ((H[6] as number) + g) >>> 0;
    H[7] = ((H[7] as number) + h) >>> 0;
  }
  let hex = "";
  for (const word of H) hex += word.toString(16).padStart(8, "0");
  return hex;
}
