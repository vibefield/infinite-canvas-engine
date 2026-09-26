// The ORACLE's fixtures, fetched once and kept (the rigs' — src/rig/, loaded by rig.html only: design-015 D7, D-D7-C.3):
// its plates, its committed glyph atlas, the note's committed ink raster — so `setScene` uploads exactly the bytes the
// Node oracle read from disk. The product's own plates are src/fixtures.ts.

import goboBUrl from "@ice/desk/oracle/fixtures/assets/gobo-b.rgba?url";
import goboCUrl from "@ice/desk/oracle/fixtures/assets/gobo-c.rgba?url";
import glyphMetaUrl from "@ice/desk/oracle/fixtures/assets/glyphs-mono-2x.json?url";
import glyphsUrl from "@ice/desk/oracle/fixtures/assets/glyphs-mono-2x.r8?url";
import inkMetaUrl from "@ice/desk/oracle/fixtures/assets/ink-note-1.json?url";
import inkUrl from "@ice/desk/oracle/fixtures/assets/ink-note-1.r8?url";
import type { GlyphAtlasMeta } from "@ice/desk";
import { bytesOf } from "../fixtures";

async function jsonOf<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}

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
