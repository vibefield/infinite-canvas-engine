// A CARD PROGRAM — the pack seam for the card (design-014 §"the three seams").
//
// The engine owns the card pass: the vertex extent, the portal chain cover,
// the content term (plate · page · own · hole) and the seam composite
// (card.wgsl). A program owns what a card LOOKS like around and over its
// content: on the GPU, two WGSL functions — `shade_card` (below the content:
// the shadow, the chrome band, the two coverages that partition the pixel)
// and `shade_over` (above it: lines, lights, controls) — and on the CPU, the
// resolve that turns a rect and its motion into the record's HEAD (the
// generic geometry, `geometry.ts`) and its TAIL (`ext`, the program's own
// vec4 slots the engine never reads). A program also names the uniform slots
// it wants (`uext`), fills them from the theme's section for it, hit-tests
// its parts, and says what silhouette a dragged set casts as the heat's
// source.
//
// The engine ships one program, the SHELL (`shell.wgsl`, `resolveShell`):
// zero tail slots, zero uniform slots, no parts. VibeField's frame is a pack
// (`packs/vf-frame`) — the same contract with ten tail slots and twelve
// uniform slots.

import type { Component, Tag } from "@ice/core";
import type { ShaderPart } from "../engine/shader";
import type { GroundTheme, ThemeName } from "../theme";
import { WGSL } from "../shaders.gen";
import { type CardRect, type Material, type Motion, resolveShell, type ShellGeometry } from "./geometry";

/** The record HEAD's layout version a program was written against; a mismatch refuses at `Ground.create` (D3). */
export const CARD_ABI = 1;

/** What is under a world point: the card's content, its chrome (the frame band), nothing — or a program's PART by name (`close`, `lock` …). */
export type Hit = "content" | "frame" | "outside" | (string & { readonly part?: never });

/** The router's part channel for one card: the part under the pointer and the part pressed, by the program's own names. */
export interface PartState { readonly hover: string | null; readonly press: string | null }
export const NO_PART: PartState = Object.freeze({ hover: null, press: null });

/** What a program's `resolve` is handed for one card, one frame. */
export interface CardContext {
  readonly card: CardRect;
  readonly motion: Motion;
  readonly material: Material;
  /** Seconds since the last frame — a program's own springs step by it. */
  readonly dt: number;
  readonly part: PartState;
  /** The card's identity across frames (an entity, or a host's card object) — the key of a program's own per-card state. */
  readonly key?: unknown;
  /** A sink the program sets `live` on while its own springs still move — the host paints again. */
  readonly out?: { live: boolean };
}

/** A silhouette in card units: half extents and corner radius. */
export interface Silhouette { readonly hx: number; readonly hy: number; readonly r: number }

export interface CardProgram<G extends ShellGeometry = ShellGeometry> {
  readonly name: string;
  readonly abi: typeof CARD_ABI;
  /** Provides `shade_card` and `shade_over` (card.wgsl names the contract). */
  readonly shader: ShaderPart;
  /** Tail slots in the record (`ext: array<vec4f, N>`); 0 = no tail. */
  readonly ext: number;
  /** Uniform slots (`uext: array<vec4f, M>`); 0 = none. */
  readonly uniforms: number;
  /** Extra world facts the program's resolve reads — the frame builder journals them. */
  readonly reads?: { readonly components?: readonly Component[]; readonly tags?: readonly Tag[] };
  /** The card's geometry this frame: the head, and whatever the program keeps beside it. */
  resolve(ctx: CardContext): G;
  /** The tail, packed: `4 × ext` numbers from a resolved geometry. */
  tail(G: G): ArrayLike<number>;
  /** The uniform slots, packed: `4 × uniforms` numbers from the theme (its section for this program). */
  uniformValues(theme: GroundTheme): ArrayLike<number>;
  /** What is under a world point, mid-animation included — the router's frame hit test. */
  pick(G: G, x: number, y: number): Hit;
  /** The silhouette a dragged set of content size `w × h` casts as the heat's light source, lifted by `lift`. */
  source(w: number, h: number, lift: number, radius: number): Silhouette;
  /**
   * How far the chrome reaches beyond the content rect at rest, card units — the cull margin
   * and the router's pick pad grow by it. Absent = `source(0, 0, 1, radius).hx`, the band a
   * program grows around a dragged set.
   */
  reach?(radius: number): number;
  /** The theme section this program reads, projected from a host's palette; absent = the program reads only the head. */
  theme?(palette: unknown, name: ThemeName): unknown;
  /** A card left sight or the board: forget any state kept under its key. */
  release?(key: unknown): void;
  /**
   * The signed distance from a world point to the INNER boundary (the content's
   * edge, negative inside) — the CPU mirror of the shader's interior. DomCompose
   * marches it for a DOM host's `clip-path` (design-014, B3b). Absent = the
   * host clips to the rounded content rect.
   */
  inner?(G: G, x: number, y: number): number;
  /** A string that changes exactly when the inner SHAPE changes (not its position or lift): DomCompose recomputes the clip on it. */
  clipKey?(G: G): string;
}

/** The engine's own card: the shell. */
export const shellProgram: CardProgram<ShellGeometry> = {
  name: "shell",
  abi: CARD_ABI,
  shader: { label: "card/shell.wgsl", text: WGSL["card/shell.wgsl"] },
  ext: 0,
  uniforms: 0,
  resolve: (ctx) => resolveShell(ctx.card, ctx.motion, ctx.material),
  tail: () => [],
  uniformValues: () => [],
  pick(G, x, y) {
    const rr = Math.min(Math.max(G.outerR, 0), Math.min(G.half[0], G.half[1]));
    const qx = Math.abs(x - G.centre[0]) - G.half[0] + rr;
    const qy = Math.abs(y - G.centre[1]) - G.half[1] + rr;
    const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
    return d < 0 ? "content" : "outside";
  },
  source: (w, h, lift, radius) => ({ hx: (w / 2) * lift, hy: (h / 2) * lift, r: radius * lift }),
  inner(G, x, y) {
    const rr = Math.min(Math.max(G.radius, 0), Math.min(G.ih[0], G.ih[1]));
    const qx = Math.abs(x - G.centre[0]) - G.ih[0] + rr;
    const qy = Math.abs(y - G.centre[1]) - G.ih[1] + rr;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
  },
  clipKey: (G) => { const s = G.scale > 0 ? G.scale : 1; return `${(G.ih[0] / s).toFixed(3)},${(G.ih[1] / s).toFixed(3)},${(G.radius / s).toFixed(3)}`; },
};
