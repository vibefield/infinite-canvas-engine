// The desk calendar's COMMITTED PRINT (D3t-c) — a sheet's tiles at ONE level as the live print drew them in Chrome (the host's
// Canvas 2D: apps/desk `scripts/print-fixture.mjs --write` reads them back from the world's own pad), committed so that both hosts
// pin the SAME bytes on a still (the Node oracle has no canvas; rig:world and rig:parity pin them too, and rig:world holds the live
// print to them byte for byte): `oracle/fixtures/assets/<name>.json` — `{ level, tex, tiles: ["tx:ty", …], empty: ["tx:ty", …] }` —
// and `<name>.bin`, the tiles' RGBA (tex² × 4 each, straight alpha, in the meta's order) raw-deflated. Pure: the caller inflates
// (Node's zlib, a browser's DecompressionStream) and hands the bytes in.

/** The committed prints the oracle's scenes name — each a month of the scenes' one set of entries (scenes.mjs `PAD_EVENTS`). */
export const PRINT_FIXTURES = ["print-2026-09", "print-2026-10"];

/**
 * The ZONE the committed prints were drawn in (D7): the Moon's phases fall on a day by a zone (September 2026's full moon is the 26th
 * in Los Angeles, the 27th in Tokyo), so a scene that holds a live print to these bytes pins this zone beside its today — the pads'
 * clock seam (kinds/calendar.ts `pinZone`) — and the bytes are the same on any machine.
 */
export const PRINT_ZONE = "America/Los_Angeles";

/** A sheet pinned with nothing on it: every tile MISSING — the paper and its ruled grid (a still that states no print). */
export const BLANK_SHEET = Object.freeze({ level: 0, tiles: new Map(), empty: new Set() });

/** A committed print as the tile driver pins it (calendar/printing.ts `PinnedSheet`), from its meta and its inflated bytes. */
export function printSheetOf(meta, bytes) {
  const size = meta.tex * meta.tex * 4;
  if (bytes.byteLength !== meta.tiles.length * size) throw new Error(`oracle: a committed print holds ${meta.tiles.length} tiles of ${size} bytes, not ${bytes.byteLength}`);
  const tiles = new Map(meta.tiles.map((k, i) => [k, bytes.slice(i * size, (i + 1) * size)]));
  return { level: meta.level, tiles, empty: new Set(meta.empty) };
}
