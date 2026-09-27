// The INK — the handwriting rasterised in the browser (design-015 §6.1; STICKY.md §3): the prototype's
// lab/ink.ts behind the TEXT RASTER seam (paper/raster.ts). The layout is the engine's (paper/text.ts,
// pure); this draws its glyph boxes with a Canvas 2D in a real hand — the faces the APP hands in by
// URL (Caveat 500/600 and Kalam 400, OFL, shipped by apps/desk; or a platform face by family alone) —
// at the band's texels per note unit, and hands back the canvas's alpha as r8 coverage for the paper
// pass's ink pages. Each glyph in its own frame: turned by its tilt, scaled by its size, at its
// pressure; under it a faint stroke widens the letter by the pen's bleed. The face's metrics for the
// layout come from the same kind of context, measured at 100 px and given in em.
//
// A face is loaded ONCE (FontFace → document.fonts), lazily on its first use; until it lands its
// metrics are `undefined` (a sheet waits, blank — never a stand-in hand re-written a moment later)
// and `version()` bumps when it does, so every layout keyed by it is laid again. One OffscreenCanvas
// is reused for every raster (`willReadFrequently`: the CPU path the readback wants).

import type { InkBitmap, TextRaster } from "../kit/raster";
import { type FaceSpec, type HandLayout, type HandMetrics, PEN_FACES } from "../kit/text";

// the faces are the HAND's (kit/text.ts since K4a — the desk calendar's print sets them too); the note's raster keeps its door
export { type FaceSpec, PEN_FACES } from "../kit/text";

/** The desk's faces with the app's files: `{ caveat: url, "caveat-bold": url, kalam: url }` → face specs. */
export function penFaces(urls: Readonly<Record<string, string>>): Readonly<Record<string, FaceSpec>> {
  return Object.fromEntries(Object.entries(PEN_FACES).map(([name, f]) => [name, urls[name] !== undefined ? { ...f, url: urls[name] } : f]));
}

export interface InkRasterOptions {
  /** The faces by name — `penFaces({ … })` for the desk's own. */
  readonly faces: Readonly<Record<string, FaceSpec>>;
  /** The document whose font set the faces join (the window's). */
  readonly document?: Document;
}

export interface InkRaster extends TextRaster {
  /** Load a face (once): resolves whether the browser can draw it. `metrics()` asks for this itself. */
  load(face: string): Promise<boolean>;
  /** Is the face loaded (and drawable)? */
  ready(face: string): boolean;
}

const fontOf = (f: Omit<FaceSpec, "url">, px: number): string => `${f.weight} ${px}px "${f.family}"`;

export function inkRaster(opts: InkRasterOptions): InkRaster {
  const doc = opts.document ?? (typeof document !== "undefined" ? document : undefined);
  const loads = new Map<string, Promise<boolean>>();
  const ok = new Set<string>();
  const metricsCache = new Map<string, HandMetrics>();
  let version = 0;
  let canvas: OffscreenCanvas | null = null;
  let ctx: OffscreenCanvasRenderingContext2D | null = null;
  const context = (w: number, h: number): OffscreenCanvasRenderingContext2D => {
    if (canvas === null) {
      canvas = new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
      ctx = canvas.getContext("2d", { willReadFrequently: true });
    } else {
      canvas.width = Math.max(1, w);   // a resize resets the context's state, as a fresh canvas would
      canvas.height = Math.max(1, h);
    }
    if (ctx === null) throw new Error("desk/ink: no 2d context on an OffscreenCanvas");
    return ctx;
  };

  const load = (face: string): Promise<boolean> => {
    let p = loads.get(face);
    if (p !== undefined) return p;
    const f = opts.faces[face];
    if (f === undefined || doc === undefined) p = Promise.resolve(false);
    else if (f.url === undefined) p = Promise.resolve(doc.fonts.check(fontOf(f, 24)));
    else {
      const ff = new FontFace(f.family, `url(${f.url})`, { weight: String(f.weight) });
      // `FontFaceSet` is setlike: its `add` lives in lib DOM.Iterable, which the desk's tsconfig leaves out
      const set = doc.fonts as unknown as { add(face: FontFace): void };
      p = ff.load().then((loaded) => { set.add(loaded); return true; }).catch(() => false);
    }
    p = p.then((drawable) => {
      if (drawable) ok.add(face);
      metricsCache.delete(face);
      version += 1;   // every layout keyed by the face is laid again — with the face, or honestly without it
      return drawable;
    });
    loads.set(face, p);
    return p;
  };

  const measure = (face: string): HandMetrics | undefined => {
    const hit = metricsCache.get(face);
    if (hit !== undefined) return hit;
    const f = opts.faces[face];
    if (f === undefined) return undefined;
    // the measuring context is its own: the raster's is resized under it
    const c = new OffscreenCanvas(8, 8).getContext("2d");
    if (c === null) throw new Error("desk/ink: no 2d context to measure with");
    c.font = fontOf(f, 100);
    c.textBaseline = "alphabetic";
    const m0 = c.measureText("x");
    const advances = new Map<string, number>();
    const kerns = new Map<string, number>();
    const advance = (ch: string): number => {
      let a = advances.get(ch);
      if (a === undefined) { c.font = fontOf(f, 100); a = c.measureText(ch).width / 100; advances.set(ch, a); }
      return a;
    };
    const metrics: HandMetrics = {
      ascent: m0.fontBoundingBoxAscent / 100,
      descent: m0.fontBoundingBoxDescent / 100,
      advance,
      kern: (a, b) => {
        const key = a + b;
        let k = kerns.get(key);
        if (k === undefined) { c.font = fontOf(f, 100); k = c.measureText(key).width / 100 - advance(a) - advance(b); kerns.set(key, k); }
        return k;
      },
    };
    metricsCache.set(face, metrics);
    return metrics;
  };

  return {
    load,
    ready: (face) => ok.has(face),
    version: () => version,
    metrics(face) {
      if (!ok.has(face)) { void load(face); return undefined; }
      return measure(face);
    },
    raster(L: HandLayout, face: string, box: { readonly w: number; readonly h: number }, band: number, bleed: number): InkBitmap {
      const f = opts.faces[face];
      if (f === undefined) throw new Error(`desk/ink: no face "${face}"`);
      const w = Math.max(1, Math.ceil(box.w * band));
      const h = Math.max(1, Math.ceil(box.h * band));
      const g = context(w, h);
      g.clearRect(0, 0, w, h);
      g.scale(band, band);
      g.font = fontOf(f, L.em);
      g.textBaseline = "alphabetic";
      g.textAlign = "left";
      g.fillStyle = "white";   // coverage only: the alpha is what is read
      g.strokeStyle = "white";
      g.lineJoin = "round";
      g.lineCap = "round";
      for (const q of L.glyphs) {
        g.save();
        g.translate(q.x, q.y);
        g.rotate(q.rot);
        g.scale(q.scale, q.scale);
        if (bleed > 0) { g.globalAlpha = q.press * 0.45; g.lineWidth = bleed / q.scale; g.strokeText(q.ch, 0, 0); }
        g.globalAlpha = q.press;
        g.fillText(q.ch, 0, 0);
        g.restore();
      }
      const img = g.getImageData(0, 0, w, h).data;
      const bytes = new Uint8Array(w * h);
      for (let i = 0; i < bytes.length; i++) bytes[i] = img[i * 4 + 3] as number;
      g.setTransform(1, 0, 0, 1, 0, 0);
      return { bytes, w, h };
    },
  };
}
