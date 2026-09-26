// What the desk is FED (the render map's finding #2: the product never fed the mat before): the
// app's GENERATED gobo plates for the product desk (gobo-palm-1 into slot `c`, gobo-canopy-1 into
// `b` — never the study's), and, for a parity scene, the oracle's own fixtures — its plates, its
// committed glyph atlas, the note's committed ink raster — fetched once and kept, so `setScene`
// uploads exactly the bytes the Node oracle read from disk.

import goboBUrl from "@ice/desk/oracle/fixtures/assets/gobo-b.rgba?url";
import goboCUrl from "@ice/desk/oracle/fixtures/assets/gobo-c.rgba?url";
import glyphMetaUrl from "@ice/desk/oracle/fixtures/assets/glyphs-mono-2x.json?url";
import glyphsUrl from "@ice/desk/oracle/fixtures/assets/glyphs-mono-2x.r8?url";
import inkMetaUrl from "@ice/desk/oracle/fixtures/assets/ink-note-1.json?url";
import inkUrl from "@ice/desk/oracle/fixtures/assets/ink-note-1.r8?url";
import type { GlyphAtlasMeta } from "@ice/desk/host";
import canopyUrl from "../assets/gobo-canopy-1.rgba?url";
import palmUrl from "../assets/gobo-palm-1.rgba?url";

export async function bytesOf(url: string): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
async function jsonOf<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}

/** The product's plates — generated (tools/make-gobo-plate.mjs in the prototype; PLATES.md). */
export interface ProductPlates { readonly c: Uint8Array<ArrayBuffer>; readonly b: Uint8Array<ArrayBuffer> }
let plates: Promise<ProductPlates> | null = null;
export const productPlates = (): Promise<ProductPlates> => {
  plates ??= Promise.all([bytesOf(palmUrl), bytesOf(canopyUrl)]).then(([c, b]) => ({ c, b }));
  return plates;
};

/** The oracle's fixtures, the same bytes it reads from disk. */
export interface OracleFixtures {
  readonly goboC: Uint8Array<ArrayBuffer>;
  readonly goboB: Uint8Array<ArrayBuffer>;
  readonly glyphs: Uint8Array<ArrayBuffer>;
  readonly glyphMeta: GlyphAtlasMeta;
  readonly ink: Uint8Array<ArrayBuffer>;
  readonly inkMeta: { readonly w: number; readonly h: number; readonly band: number };
}
let fixtures: Promise<OracleFixtures> | null = null;
export const oracleFixtures = (): Promise<OracleFixtures> => {
  fixtures ??= Promise.all([bytesOf(goboCUrl), bytesOf(goboBUrl), bytesOf(glyphsUrl), jsonOf<GlyphAtlasMeta>(glyphMetaUrl), bytesOf(inkUrl), jsonOf<OracleFixtures["inkMeta"]>(inkMetaUrl)])
    .then(([goboC, goboB, glyphs, glyphMeta, ink, inkMeta]) => ({ goboC, goboB, glyphs, glyphMeta, ink, inkMeta }));
  return fixtures;
};
