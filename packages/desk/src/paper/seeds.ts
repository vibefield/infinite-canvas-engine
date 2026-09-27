// The hand's SEEDS as a durable cell (design-015 D-D13; D2c). Every glyph of a note carries its own
// seed — its tilt, rise, size and pressure are a hash of it (text.ts `hashHand`) — and `carrySeeds`
// keeps them through an edit, so a letter typed before the next keeps its hand. The prototype kept
// them in memory; here they are DOCUMENT truth beside the text (the note's `ink` group: `text` and
// `seeds`, one cell, written in the same transaction), or a reload would re-draw the hand.
//
// The encoding: one little-endian u32 per UTF-16 unit of the text (the layout's own indexing),
// base64 without padding — 4 bytes a glyph, deterministic on every host (integer arithmetic, no
// `btoa`). A TOLERANT reader: a malformed string decodes to what it can (whole seeds only), and a
// glyph with no stored seed falls back to `glyphSeed(noteSeed, i)` — which is also what a NEW note's
// seeds are, so a note spawned with text and no seeds writes exactly the hand it would have written.

import { glyphSeed } from "../kit/text";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const INDEX: Readonly<Record<string, number>> = Object.fromEntries([...ALPHABET].map((c, i) => [c, i]));

/** The seeds as the cell stores them: base64 (no padding) of little-endian u32s. */
export function encodeSeeds(seeds: ArrayLike<number>): string {
  const n = seeds.length;
  const bytes = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const v = (seeds[i] as number) >>> 0;
    bytes[4 * i] = v & 255;
    bytes[4 * i + 1] = (v >>> 8) & 255;
    bytes[4 * i + 2] = (v >>> 16) & 255;
    bytes[4 * i + 3] = (v >>> 24) & 255;
  }
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = i + 1 < bytes.length ? (bytes[i + 1] as number) : 0;
    const c = i + 2 < bytes.length ? (bytes[i + 2] as number) : 0;
    const t = (a << 16) | (b << 8) | c;
    out += ALPHABET[(t >>> 18) & 63];
    out += ALPHABET[(t >>> 12) & 63];
    if (i + 1 < bytes.length) out += ALPHABET[(t >>> 6) & 63];
    if (i + 2 < bytes.length) out += ALPHABET[t & 63];
  }
  return out;
}

/** The seeds a cell holds, as i32s (the layout's `seeds`) — whole seeds only; anything unreadable ends the run. */
export function decodeSeeds(s: string): number[] {
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of s) {
    const v = INDEX[ch];
    if (v === undefined) break;
    acc = ((acc << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >>> bits) & 255);
    }
  }
  const out: number[] = [];
  for (let i = 0; i + 3 < bytes.length; i += 4) {
    out.push(((bytes[i] as number) | ((bytes[i + 1] as number) << 8) | ((bytes[i + 2] as number) << 16) | ((bytes[i + 3] as number) << 24)) | 0);
  }
  return out;
}

/**
 * The seeds a note's text is written with: the stored ones, index for index, and for every glyph
 * past them the note's own `glyphSeed(noteSeed, i)` — exactly `text.length` of them.
 */
export function seedsFor(text: string, stored: string, noteSeed: number): number[] {
  const got = decodeSeeds(stored);
  const out = new Array<number>(text.length);
  for (let i = 0; i < text.length; i++) out[i] = i < got.length ? (got[i] as number) : glyphSeed(noteSeed, i);
  return out;
}

/** A fresh seed for a glyph just written — the host's randomness (`Math.random` in a browser). */
export const freshSeed = (): number => (Math.random() * 0x7fffffff) | 0;
