// The MINI MAT (MINIMAT.md) as a kind (kind.ts): the mini mat pass behind the registry's door —
// a thin adapter, the pass and its WGSL as they were. Stratum `sheets`: a mini mat lies flat on
// the mat beneath every thing, and it HOLDS a desk — the ground draws a live inside right after
// its mini mat and tells the pass (the `extra`'s `live`) which faces give way to one, and the
// chips come back over the inside while its objects fade in (`drawOver`, MINIMAT.md §5).
//
// And its WORLD half (kinds/world.ts; D2a-world): `minimatKind` — an entity of the mini mat's
// widget type becomes a `MiniMatInstance` through the prototype's own laws: `resolveMiniMat` on
// the rect and the flux (lift ← `Grab`, hover ← the pointer's exact hit — a mini mat RISES under
// the pointer, Marks on the Mat Q-j —, ring ← `Selected`, fade ← a ghost), `miniMatInstance` over
// an EMPTY inside — no chips, `live` −1 — the far LOD's lattice dressed for the inside's arrival
// as `insideView` makes it (D2b brings the inside's members, the chips and the live slot);
// `pickMiniMat` is the mirror: the face is `content`, the border `frame`. Its vinyl is the
// product's (`theme()`, the palette's `vinyls`); `sage` is the desk's own ground.

import type { KindExtra, KindPass, KindProgram, SlotContext } from "../kind";
import { DEFAULT_GRID, type GridConfig } from "../mat/grid";
import type { MatPass } from "../kit/view";
import { insideView } from "../minimat/inside";
import type { MiniMatInstance } from "../minimat/layout";
import type { ChildShape } from "../kit/inside";
import { chipOf, DEFAULT_MINIMAT_LAW, faceClip, faceOf, type MiniMatGeometry, type MiniMatLaw, pickMiniMat, resolveMiniMat } from "../minimat/minimat";
import { miniMatInstance } from "../minimat/inside";
import { MiniMatPass } from "../minimat/pass";
import { MINIMAT_SHADER_FILES, miniMatShaders } from "../minimat/shaders";
import type { MarkFrame } from "../marks/layout";
import { FIT } from "../nav/flight";
import { PORTAL_GATE } from "../nav/portal";
import { type ShaderText, shaderText } from "../shaders";
import { type Palette, type RGB, rgb, type ThemeName, type TokenRef } from "../theme";
import { type ObjectContext, type ObjectHit, type ObjectKind, stringProp } from "./world";

/** The mini mat's kind name — its key in the registry and in every slot's `objects`. */
export const MINIMAT_KIND = "minimat";

export class MiniMatKind implements KindPass<MiniMatInstance> {
  /** The mini mat pass itself: a host's door to its law (`law`) and this frame's chips. */
  readonly pass: MiniMatPass;
  constructor(pass: MiniMatPass) { this.pass = pass; }

  spawn(mat: MatPass): MiniMatKind { return new MiniMatKind(this.pass.spawn(mat)); }

  tune(root: KindPass<MiniMatInstance>): void { if (root instanceof MiniMatKind) this.pass.tune(root.pass); }

  setLaw(law: unknown): void { this.pass.law = law as MiniMatLaw; }

  /**
   * The pass's own `prepare`, argument for argument; the ground's word on each mini mat's live inside (`extra.live`,
   * by this kind's record index) overrides the instance's own — absent, the instances say.
   */
  prepare(_encoder: GPUCommandEncoder, s: SlotContext, records: readonly MiniMatInstance[], extra?: KindExtra): number {
    return this.pass.prepare(s.view, s.fadeIn, s.cfg, s.frame, records, s.present, s.light, s.select, s.lit, extra?.live, extra?.keys);
  }

  dropped(): number { return this.pass.dropped; }

  drawRange(pass: GPURenderPassEncoder, first: number, end: number): void { this.pass.drawRange(pass, first, end); }
  records() { return this.pass.records; }

  /** Mini mat `index`'s chips over its live inside, while the inside's objects are not whole. */
  drawOver(pass: GPURenderPassEncoder, index: number): void { this.pass.drawChips(pass, index); }

  dispose(): void { this.pass.dispose(); }
}

/** The mini mat's program for a host's shader text: its pass made on the root's mat. */
export function miniMatProgram(text: ShaderText): KindProgram<MiniMatInstance> {
  return {
    name: MINIMAT_KIND,
    stratum: "sheets",
    create: async (device, format, mat) => new MiniMatKind(await MiniMatPass.create(device, format, miniMatShaders(text(MINIMAT_SHADER_FILES)), mat)),
  };
}

// ---------------------------------------------------------------- the world half (D2a-world)

/** What the mini mat's kind takes from the host's palette: the vinyls by the `vinyl` prop's value (`sage` needs none — it is the desk's own ground). */
export interface MiniMatPalette extends Palette {
  readonly vinyls?: Readonly<Record<string, TokenRef>>;
}

/** The mini mat's look for a theme: its vinyls, parsed. */
export interface MiniMatLook {
  readonly vinyls: Readonly<Record<string, RGB>>;
}

/** The vinyl the desk's own mat is: the `vinyl` prop's value that means "the ground's colour". */
export const SAGE = "sage";

/** How far a mini mat's drawing reaches past its rect, world units: the slab's shadow swept from its top, its penumbra and contact term, the held scale. */
export function miniMatReach(law: MiniMatLaw = DEFAULT_MINIMAT_LAW): number {
  const top = law.lift.height + law.thick;
  const p = law.shadow.penumbra;
  const shadow = law.shadow.slopeMax * top + 2.5 * (p.sigma0 + p.sigmaPerHeight * top) + 2.5 * law.shadow.contact.sigma;
  const held = (Math.max(law.size.w, law.size.h) * (law.lift.scale - 1)) / 2;
  return shadow + held;
}

export interface MiniMatKindOptions {
  /** The host's shader text; the generated module unless a host says. */
  readonly text?: ShaderText;
  /** The mini mat's numbers (theme.ts `MINIMAT`) — the engine's unless a host tweaks them. */
  readonly law?: MiniMatLaw;
}

/** The mini mat's kind, whole (kinds/world.ts `ObjectKind`): the program, and the world half on the prototype's laws over an empty inside. */
/** The grid a mini mat's inside draws with: the desk's own fade-in, the mat in the mini mat's vinyl, no rulers (a portal's inside never prints them). */
function insideGrid(ctx: Pick<ObjectContext, "props" | "look">, root: GridConfig): GridConfig {
  const look = ctx.look as MiniMatLook | undefined;
  const vinylName = stringProp(ctx.props, "vinyl", SAGE);
  const vinyl = vinylName === SAGE ? root.mat.ground : (look?.vinyls[vinylName] ?? root.mat.ground);
  return { fadeIn: root.fadeIn, mat: { ...root.mat, ground: vinyl, ruler: { ...root.mat.ruler, on: false } } };
}

export function minimatKind(opts: MiniMatKindOptions = {}): ObjectKind<MiniMatGeometry, MiniMatInstance, MiniMatLook> {
  let law = opts.law ?? DEFAULT_MINIMAT_LAW;
  const program = miniMatProgram(opts.text ?? shaderText);
  return {
    ...program,
    // the reach is the construction law's: a live law moves the face, not the shadow's reach (the dev panel's rows — D5a)
    reach: miniMatReach(law),
    // the record reads the inside camera's zoom for the face's far-LOD lattice and its numerals (inside.ts `miniMatInstance`) and nothing else of the camera (D6)
    rezoom: true,
    tune(next: unknown): void { law = next as MiniMatLaw; },
    resolve(ctx: ObjectContext): MiniMatGeometry {
      const r = ctx.rect;
      return resolveMiniMat({ cx: r.cx, cy: r.cy, w: r.w, h: r.h }, { held: ctx.flux.lift, hover: ctx.flux.hover, ring: ctx.flux.ring, fade: ctx.flux.fade }, law, ctx.lamp);
    },
    record(G: MiniMatGeometry, ctx: ObjectContext): MiniMatInstance {
      const grid = insideGrid(ctx, ctx.grid);
      const cam = { x: ctx.view.camX, y: ctx.view.camY, zoom: ctx.view.zoom };
      const vp = { width: ctx.view.width, height: ctx.view.height };
      // the inside as the builder saw it (D2b: its content's bounds, its view through this face, its children as chips); with no
      // word from the builder — a bare kind — the inside is EMPTY: its arrival is the origin at zoom 1, its face's far LOD the lattice
      // of that desk, no chips. The view is the flight's own numbers, so the far LOD and the live inside agree to the bit.
      const view = ctx.inside?.view ?? insideView(G, ctx.inside?.content ?? null, cam, vp, FIT, PORTAL_GATE) ?? {
        M: { s: 1, ox: G.centre[0], oy: G.centre[1] }, arrival: cam, cam, clip: faceClip(G, cam), presence: 0, box: { x: 0, y: 0, w: 0, h: 0 },
      };
      const chips = (ctx.inside?.chips ?? []).map((c) => chipOf(c, view.M, law.chips.greekWeight));
      const name = stringProp(ctx.props, "name", "");
      return { ...miniMatInstance(G, view, grid, chips, name || undefined, true, law), live: -1 };
    },
    hit(G: MiniMatGeometry, wx: number, wy: number): ObjectHit | null {
      const h = pickMiniMat(G, wx, wy);
      return h === "face" ? "content" : h === "border" ? "frame" : null;
    },
    /** The face as drawn: the sheet inset by its printed border, through its springs (`faceOf` — what the live inside and the nav cut read). */
    face(G: MiniMatGeometry) { return faceOf(G); },
    /** Inside another mini mat, a mini mat is a vinyl chip with its border (the prototype's `childrenOf`). */
    chip(G: MiniMatGeometry, ctx: ObjectContext): ChildShape {
      const look = ctx.look as MiniMatLook | undefined;
      const vinylName = stringProp(ctx.props, "vinyl", SAGE);
      const vinyl = vinylName === SAGE ? ctx.grid.mat.ground : (look?.vinyls[vinylName] ?? ctx.grid.mat.ground);
      return { kind: "mat", cx: G.centre[0], cy: G.centre[1], hx: G.half[0], hy: G.half[1], angle: 0, radius: G.radius, colour: vinyl, height: G.thick, margin: G.margin };
    },
    insideGrid,
    frame: miniMatFrame,
    theme(palette: Palette, _name: ThemeName): MiniMatLook {
      const p = palette as MiniMatPalette;
      return { vinyls: Object.fromEntries(Object.entries(p.vinyls ?? {}).map(([k, t]) => [k, rgb(t.css)])) };
    },
  };
}

/** The grid a mini mat's inside is drawn with when a host names none: the engine's (re-exported for D2b's live insides). */
export const INSIDE_GRID: GridConfig = DEFAULT_GRID;

/** The mini mat's silhouette for the desk's marks (D4a): the sheet as drawn, square to the mat, its die-cut corner. */
export function miniMatFrame(G: MiniMatGeometry): MarkFrame {
  return { cx: G.centre[0], cy: G.centre[1], hx: G.half[0], hy: G.half[1], angle: 0, r: G.radius };
}
