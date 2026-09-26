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
// palette's `papers` and `pens` by the prop's value. The raster is only a committed asset in this
// slice (the host pins it, `ctx.asset`); the live text is D2c's.

import type { KindPass, KindProgram, SlotContext } from "../kind";
import type { MatPass } from "../mat/mat-pass";
import type { PaperInstance } from "../paper/layout";
import { DEFAULT_PAPER_LAW, type PaperGeometry, type PaperLaw, pickPaper, resolvePaper, tiltOf } from "../paper/paper";
import { PaperPass } from "../paper/paper-pass";
import { PAPER_SHADER_FILES, paperShaders } from "../paper/shaders";
import type { UvRect } from "../paper/pages";
import { type ShaderText, shaderText } from "../shaders";
import { type Palette, type RGB, rgb, type ThemeName, type TokenRef } from "../theme";
import { numberProp, type ObjectContext, type ObjectHit, type ObjectKind, stringProp } from "./world";

/** The note's kind name — its key in the registry and in every slot's `objects`. */
export const PAPER_KIND = "paper";

export class PaperKind implements KindPass<PaperInstance> {
  /** The paper pass itself: a host's door to the ink pages (`alloc`, `write`, `reset`) and the note's law (`law`, `chain`, `wipeSoft`). */
  readonly pass: PaperPass;
  constructor(pass: PaperPass) { this.pass = pass; }

  spawn(mat: MatPass): PaperKind { return new PaperKind(this.pass.spawn(mat)); }

  tune(root: KindPass<PaperInstance>): void { if (root instanceof PaperKind) this.pass.tune(root.pass); }

  /** The pass's own `prepare`, argument for argument: the slot's camera, grid, clocks, the objects' presence, the light, the ring's colour, the lamp. */
  prepare(_encoder: GPUCommandEncoder, s: SlotContext, records: readonly PaperInstance[]): number {
    return this.pass.prepare(s.view, s.fadeIn, s.cfg, s.frame, records, s.present, s.light, s.select, s.lit);
  }

  drawRange(pass: GPURenderPassEncoder, first: number, end: number): void { this.pass.drawRange(pass, first, end); }

  dispose(): void { this.pass.dispose(); }
}

/** The note's program for a host's shader text: its pass made on the root's mat. */
export function paperProgram(text: ShaderText): KindProgram<PaperInstance> {
  return {
    name: PAPER_KIND,
    stratum: "things",
    create: async (device, format, mat) => new PaperKind(await PaperPass.create(device, format, paperShaders(text(PAPER_SHADER_FILES)), mat)),
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

/** A committed raster's place in the ink pages, as the host pinned it (`ctx.asset`). */
export interface PaperAsset { readonly layer: number; readonly uv: UvRect }

const isPaperAsset = (a: unknown): a is PaperAsset => typeof a === "object" && a !== null && typeof (a as PaperAsset).layer === "number" && typeof (a as PaperAsset).uv === "object";

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
}

/** The note's kind, whole (kinds/world.ts `ObjectKind`): the program, and the world half on the prototype's laws. */
export function paperKind(opts: PaperKindOptions = {}): ObjectKind<PaperGeometry, PaperInstance, PaperLook> {
  const law = opts.law ?? DEFAULT_PAPER_LAW;
  const program = paperProgram(opts.text ?? shaderText);
  const parse = (table: Readonly<Record<string, TokenRef>> | undefined): Readonly<Record<string, RGB>> =>
    Object.fromEntries(Object.entries(table ?? {}).map(([k, t]) => [k, rgb(t.css)]));
  return {
    ...program,
    reach: paperReach(law),
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
      const asset = ctx.asset;
      return { geometry: G, paper, ink, ...(isPaperAsset(asset) ? { raster: { layer: asset.layer, uv: asset.uv } } : {}) };
    },
    hit(G: PaperGeometry, wx: number, wy: number): ObjectHit | null {
      return pickPaper(G, wx, wy) === "paper" ? "content" : null;
    },
    theme(palette: Palette, _name: ThemeName): PaperLook {
      const p = palette as PaperPalette;
      return { papers: parse(p.papers), pens: parse(p.pens) };
    },
  };
}
