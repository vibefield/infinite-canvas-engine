// The NOTE (STICKY.md) as a kind (kind.ts): the paper pass behind the registry's door — a thin
// adapter, the pass and its WGSL as they were. Stratum `things`: a note lies over every sheet
// and pad, in the desk's own order among the other things. A spawned slot's pass takes the
// root's law every frame (`tune`), as the ground always had it do.
//
// And its WORLD half (kinds/world.ts; D2a-world): `paperKind` — an entity of the note's widget
// type becomes a `PaperInstance` through the prototype's own laws: `resolvePaper` on the rect,
// the seed's tilt (`tiltOf`), the flux the builder stepped (lift ← `Grab`, ring ← `Selected`,
// fade ← a delete ghost — a note never hovers); `pickPaper` is the mirror. The sheet's colour and
// the pen's ink are the PRODUCT's (the theme gate: no literal here) — `theme()` takes them from the
// palette's `papers` and `pens` by the prop's value.
//
// And its TEXT (D2c, design-015 §6.1): the kind's own state on each desk is a WRITING
// (paper/writing.ts — `local()`): the hand's layout from the note's durable `text` and `seeds`, the
// ink raster on the √2 band ladder in the pass's pages, the pen's wipe, the editor's caret. `record`
// takes all three from it; a raster a host pinned through the builder (`ctx.asset`) is the fallback.

import { type KindExtra, type KindPass, type KindProgram, type SlotContext, type Palette, type RGB, rgb, type ThemeName, type TokenRef, type KindHost, numberProp, type ObjectContext, type ObjectHit, type ObjectKind, stringProp } from "@ice/desk";
import { type MatPass, type MarkFrame, type ChildShape, type HandLaw, HAND, type ShaderText } from "@ice/desk/kit";
import type { PaperInstance } from "./layout";
import { DEFAULT_PAPER_LAW, type PaperGeometry, type PaperLaw, pickPaper, resolvePaper, tiltOf } from "./paper";
import { PaperPass } from "./paper-pass";
import { PAPER_SHADER_FILES, paperShaders } from "./shaders";
import type { UvRect } from "./pages";
import { createWriting, type Writing } from "./writing";
import { shaderText } from "../shaders";

/** The note's kind name — its key in the registry and in every slot's `objects`. */
export const PAPER_KIND = "paper";

export class PaperKind implements KindPass<PaperInstance> {
  /** The paper pass itself: a host's door to the ink pages (`alloc`, `write`, `reset`) and the note's law (`law`, `chain`, `wipeSoft`). */
  readonly pass: PaperPass;
  constructor(pass: PaperPass) { this.pass = pass; }

  spawn(mat: MatPass): PaperKind { return new PaperKind(this.pass.spawn(mat)); }

  tune(root: KindPass<PaperInstance>): void { if (root instanceof PaperKind) this.pass.tune(root.pass); }

  /** The pass's own `prepare`, argument for argument: the slot's camera, grid, clocks, the objects' presence, the light, the ring's colour, the lamp — and the records' keys (D6). */
  prepare(_encoder: GPUCommandEncoder, s: SlotContext, records: readonly PaperInstance[], extra?: KindExtra): number {
    return this.pass.prepare(s.view, s.fadeIn, s.cfg, s.frame, records, s.present, s.light, s.select, s.lit, extra?.keys);
  }

  dropped(): number { return this.pass.dropped; }

  drawRange(pass: GPURenderPassEncoder, first: number, end: number): void { this.pass.drawRange(pass, first, end); }
  records() { return this.pass.records; }

  dispose(): void { this.pass.dispose(); }
}

/** The note's program for a host's shader text: its pass made on the root's mat. */
export function paperProgram(text: ShaderText): KindProgram<PaperInstance> {
  return {
    name: PAPER_KIND,
    stratum: "things",
    create: async (device, format, mat) => new PaperKind(await PaperPass.create(device, format, paperShaders(text), mat)),
  };
}

// ---------------------------------------------------------------- the world half (D2a-world)

/**
 * What the note's kind takes from the host's palette (theme.ts `Palette`, extended): the sheets by
 * the `paper` prop's value and the pens' inks by the `pen` prop's — each a token (`--vf-note-surface`,
 * STICKY.md §3's pens), the product's colours, never the engine's (the theme gate).
 */
export interface PaperPalette extends Palette {
  readonly papers?: Readonly<Record<string, TokenRef>>;
  readonly pens?: Readonly<Record<string, TokenRef>>;
}

/** The note's look for a theme: its sheets and inks, parsed. */
export interface PaperLook {
  readonly papers: Readonly<Record<string, RGB>>;
  readonly pens: Readonly<Record<string, RGB>>;
}

/** A note's writing as the far LOD greeks it (MINIMAT.md §5): the text's left edge and em (note units from the sheet's top-left) and each line's baseline and width. */
export interface PaperWriting { readonly x0: number; readonly em: number; readonly lines: readonly { readonly y: number; readonly width: number }[] }

/**
 * What the host pins on a note (`ctx.asset`): a committed raster's place in the ink pages (`layer` + `uv`),
 * and/or its writing's lines for the chip (`greek` — a still states them; the live text's layout is D2c's).
 */
export interface PaperAsset { readonly layer?: number; readonly uv?: UvRect; readonly greek?: PaperWriting }

const asPaperAsset = (a: unknown): PaperAsset | undefined => (typeof a === "object" && a !== null ? (a as PaperAsset) : undefined);
const hasRaster = (a: PaperAsset | undefined): a is PaperAsset & { readonly layer: number; readonly uv: UvRect } => a !== undefined && typeof a.layer === "number" && typeof a.uv === "object" && a.uv !== null;

/**
 * How far a note's drawing reaches past its rect, world units: its shadow at full lift and curl,
 * cast along the lamp's slope and blurred; the held scale; the tilt's overhang of the sheet's box.
 */
export function paperReach(law: PaperLaw = DEFAULT_PAPER_LAW): number {
  const hmax = law.lift.height + law.curl * (1 + law.cornerCurl);
  const shadow = law.shadow.slopeMax * hmax + 2.5 * (law.shadow.sigma + law.shadow.sigmaPerUnit * hmax);
  const tilt = law.size * Math.sin((law.tilt * Math.PI) / 180);
  const held = (law.size * (law.lift.scale - 1)) / 2;
  return shadow + tilt + held;
}

export interface PaperKindOptions {
  /** The host's shader text; the generated module unless a host says (the Node oracle hands the .wgsl files on disk). */
  readonly text?: ShaderText;
  /** The paper's numbers (theme.ts `PAPER`) — the engine's unless a host tweaks them. */
  readonly law?: PaperLaw;
  /** The hand (D2c): its law (theme.ts `HAND`), its face (`caveat`) and the pen's bleed (0.3 note units). */
  readonly hand?: { readonly law?: HandLaw; readonly face?: string; readonly bleed?: number };
}

/** The root paper pass's pages behind a kind host — the writing's `pages()`. */
const pagesOf = (host: KindHost) => (): PaperPass | undefined => {
  const pass = host.pass();
  return pass instanceof PaperKind ? pass.pass : undefined;
};

/** The note's kind, whole (kinds/world.ts `ObjectKind`): the program, and the world half on the prototype's laws. */
export function paperKind(opts: PaperKindOptions = {}): ObjectKind<PaperGeometry, PaperInstance, PaperLook> {
  const law = opts.law ?? DEFAULT_PAPER_LAW;
  const program = paperProgram(opts.text ?? shaderText);
  const parse = (table: Readonly<Record<string, TokenRef>> | undefined): Readonly<Record<string, RGB>> =>
    Object.fromEntries(Object.entries(table ?? {}).map(([k, t]) => [k, rgb(t.css)]));
  return {
    ...program,
    reach: paperReach(law),
    // the record reads the view's zoom and dpr for the ink's band (paper.ts `rasterBand`) and nothing else of the camera (D6)
    rezoom: true,
    local: (host: KindHost): Writing => createWriting({
      pages: pagesOf(host),
      text: host.text,
      drawn: host.drawn,
      wipeMs: HAND.wipeMs,
      blinkMs: law.caret.blinkMs,
      ...(opts.hand?.law !== undefined ? { hand: opts.hand.law } : {}),
      ...(opts.hand?.face !== undefined ? { face: opts.hand.face } : {}),
      ...(opts.hand?.bleed !== undefined ? { bleed: opts.hand.bleed } : {}),
    }),
    resolve(ctx: ObjectContext): PaperGeometry {
      const r = ctx.rect;
      const seed = numberProp(ctx.props, "seed", 0);
      return resolvePaper({ cx: r.cx, cy: r.cy, w: r.w, h: r.h, angle: tiltOf(seed, law.tilt) }, { held: ctx.flux.lift, ring: ctx.flux.ring, fade: ctx.flux.fade }, law, ctx.lamp);
    },
    record(G: PaperGeometry, ctx: ObjectContext): PaperInstance {
      const look = ctx.look as PaperLook | undefined;
      const papers = look?.papers ?? {};
      const pens = look?.pens ?? {};
      const paper = papers[stringProp(ctx.props, "paper", "")] ?? Object.values(papers)[0];
      const ink = pens[stringProp(ctx.props, "pen", "")] ?? Object.values(pens)[0];
      if (paper === undefined || ink === undefined) throw new Error("desk/paper: the note's colours are the host's — the palette names no `papers`/`pens` (kinds/paper.ts `PaperPalette`)");
      // the writing on this desk: the live (or pinned) ink, the pen's wipe, the caret; a builder pin is the fallback
      const w = ctx.local as Writing | undefined;
      const hand = w?.draw(ctx.entity, ctx.props, ctx.rect, ctx.view, G, ctx.flux.fade < 1) ?? {};   // a ghost fades on what it has
      const asset = asPaperAsset(ctx.asset);
      const raster = hand.raster ?? (hasRaster(asset) ? { layer: asset.layer, uv: asset.uv } : undefined);
      return { geometry: G, paper, ink, ...(raster !== undefined ? { raster } : {}), ...(hand.wipe !== undefined ? { wipe: hand.wipe } : {}), ...(hand.caret !== undefined ? { caret: hand.caret } : {}) };
    },
    hit(G: PaperGeometry, wx: number, wy: number): ObjectHit | null {
      return pickPaper(G, wx, wy) === "paper" ? "content" : null;
    },
    /**
     * Inside a mini mat, a note is a paper chip with its writing greeked (the prototype's `childrenOf`): the sheet's
     * colour, the pen's ink, and the lines — the ones a still pinned (`greek`), else the hand's own layout of the note's
     * text as the writing laid it out (D2c's `layoutOf`; a note never laid out yet shows no lines, the prototype's
     * `ensureLayout` on demand is owed).
     */
    chip(G: PaperGeometry, ctx: ObjectContext): ChildShape {
      const look = ctx.look as PaperLook | undefined;
      const papers = look?.papers ?? {};
      const pens = look?.pens ?? {};
      const paper = papers[stringProp(ctx.props, "paper", "")] ?? Object.values(papers)[0] ?? ([0, 0, 0] as unknown as RGB);
      const ink = pens[stringProp(ctx.props, "pen", "")] ?? Object.values(pens)[0] ?? paper;
      const laid = (ctx.local as Writing | undefined)?.layoutOf(ctx.entity);
      const hand = opts.hand?.law ?? HAND;
      const greek = asPaperAsset(ctx.asset)?.greek ?? (laid === undefined ? undefined : { x0: hand.pad, em: hand.size, lines: laid.lines.map((L) => ({ y: L.y, width: L.width })) });
      return {
        kind: "paper", cx: G.centre[0], cy: G.centre[1], hx: G.half[0], hy: G.half[1], angle: G.angle, radius: G.radius, colour: paper, height: G.curl * 0.5,
        ...(greek !== undefined && greek.lines.length > 0 ? { writing: { ink, x0: greek.x0, em: greek.em, lines: greek.lines } } : {}),
      };
    },
    frame: paperFrame,
    theme(palette: Palette, _name: ThemeName): PaperLook {
      const p = palette as PaperPalette;
      return { papers: parse(p.papers), pens: parse(p.pens) };
    },
  };
}

/** The note's silhouette for the desk's marks (D4a): the sheet as drawn — tilted, lifted to scale — its corner scaled with it. */
export function paperFrame(G: PaperGeometry): MarkFrame {
  return { cx: G.centre[0], cy: G.centre[1], hx: G.half[0], hy: G.half[1], angle: G.angle, r: G.radius * G.scale };
}
