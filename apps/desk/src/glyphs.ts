// The rulers' glyph atlas (RULER.md), rendered here in the browser from the product's mono stack
// (`--vf-font-mono`, DESIGN.md §3) at the device's own ratio, so a label is the text the page would
// set — and re-rendered when the ratio the desk draws at or the rulers' text size changes (`glyphFeed`, K1: the
// prototype's `refreshGlyphs`, lab/main.ts; the app ticks it on the viewport's ratio). The glyphs of `GLYPHS` — the rulers' twelve, then the
// capitals and the marks a mini mat's name prints with (MINIMAT.md §2) — in a row of equal cells, each
// drawn `GLYPH_PAD` texels in from its cell's left edge on a baseline `meta.baseline` texels under the
// cell's top; the bytes are the canvas's alpha (coverage — the fill's colour never matters). The Node
// oracle cannot render text: it reads the committed copy (oracle/fixtures/assets/glyphs-mono-2x), and a
// parity scene uploads that same copy so the two hosts agree (lab/glyphs.ts, the prototype's, moved).

import { GLYPH_PAD, GLYPHS, type GlyphAtlasMeta } from "@ice/desk";

export interface GlyphAtlas {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly meta: GlyphAtlasMeta;
}

/** The mono stack the page declares — the product's token, read off the root, never a literal here. */
export const monoStack = (): string => getComputedStyle(document.documentElement).getPropertyValue("--vf-font-mono").trim() || "monospace";

/** Render the atlas for a text `size` (CSS px) at `scale` texels per CSS px. */
export function makeGlyphAtlas(size: number, scale: number, family = monoStack()): GlyphAtlas {
  const em = Math.max(1, size * scale);
  const font = `400 ${em}px ${family}`;
  const canvas = document.createElement("canvas");
  const probe = canvas.getContext("2d");
  if (!probe) throw new Error("glyphs: no 2d context");
  probe.font = font;
  const m = probe.measureText("0");
  // whole texels: the layout steps the text by `advance`, and a glyph drawn on a whole texel samples 1:1 at the device's ratio
  const advance = Math.max(1, Math.round(m.width));
  const cap = Math.ceil(m.actualBoundingBoxAscent);
  const ascent = Math.ceil(m.fontBoundingBoxAscent);
  const descent = Math.ceil(m.fontBoundingBoxDescent);
  const cellW = advance + 2 * GLYPH_PAD;
  const cellH = ascent + descent + 2 * GLYPH_PAD;
  const baseline = GLYPH_PAD + ascent;
  const width = cellW * GLYPHS.length;
  const height = cellH;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("glyphs: no 2d context");
  ctx.clearRect(0, 0, width, height);
  ctx.font = font;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = "white";   // coverage only: the alpha is what is read
  for (let i = 0; i < GLYPHS.length; i++) ctx.fillText(GLYPHS[i] as string, i * cellW + GLYPH_PAD, baseline);
  const img = ctx.getImageData(0, 0, width, height).data;
  const bytes = new Uint8Array(width * height);
  for (let i = 0; i < bytes.length; i++) bytes[i] = img[i * 4 + 3] as number;
  return { bytes, meta: { scale, cellW, cellH, advance, baseline, cap, width, height, count: GLYPHS.length } };
}

/** Texels per CSS px the desk draws at: the viewport's ratio (core's `Viewport.dpr`) under the layer's cap (reflector.ts `maxDpr`, 2). */
export const deskScale = (dpr: number): number => Math.min(dpr > 0 ? dpr : 1, 2);

/** The atlas the desk prints with, kept to the ratio and the rulers' text size. */
export interface GlyphFeed {
  /** Render and upload the atlas when the ratio or the size moved since the last upload — the same key twice is nothing; true = uploaded. */
  refresh(): boolean;
  /** Whether the ratio or the size moved since the last upload (false before the first) — cheap: nothing is rendered to answer. */
  stale(): boolean;
  /** The last upload: its key (`scale:size`) and its meta (the very object the mat was handed) — null before the first. */
  readonly last: { readonly key: string; readonly meta: GlyphAtlasMeta } | null;
  /** Atlases rendered and uploaded so far. */
  readonly uploads: number;
}

export interface GlyphFeedOptions {
  /** Whether the mat is here to take an upload (`handle.available()`): one before it would be dropped with its key kept. */
  readonly ready: () => boolean;
  /** Texels per CSS px (`deskScale` of the viewport's ratio). */
  readonly scale: () => number;
  /** The rulers' text size, CSS px — the atlas's em (the panel's). */
  readonly size: () => number;
  readonly upload: (atlas: GlyphAtlas) => void;
  /** The renderer: `makeGlyphAtlas` (a unit's double in Node). */
  readonly make?: (size: number, scale: number) => GlyphAtlas;
}

export function glyphFeed(opts: GlyphFeedOptions): GlyphFeed {
  const make = opts.make ?? ((size: number, scale: number) => makeGlyphAtlas(size, scale));
  let last: GlyphFeed["last"] = null;
  let uploads = 0;
  const keyNow = (): string => `${opts.scale()}:${opts.size()}`;
  return {
    stale: () => last !== null && keyNow() !== last.key,
    refresh() {
      if (!opts.ready()) return false;
      const scale = opts.scale();
      const size = opts.size();
      const key = `${scale}:${size}`;
      if (last?.key === key) return false;
      const atlas = make(size, scale);
      opts.upload(atlas);
      last = { key, meta: atlas.meta };
      uploads += 1;
      return true;
    },
    get last() { return last; },
    get uploads() { return uploads; },
  };
}
