// `vf-frame` — VibeField's card frame as a CARD PROGRAM pack (design-014): the
// composed corners with their bays, the close and lock buttons, the delete
// morph, the §7 overlap heat as cast light. Registered by an app
// (`groundCompose({ card: vfFrame() })`, `Ground.create({ card })`); the
// engine's own card is the shell. This file is the seam's CPU half: the
// program object — its style (settable, the lab's panel edits it), its heat
// knobs, its own per-card springs (the two buttons' hover and press, the
// lock's state — the engine's motion carries the reveal, the lift and the
// heat), the tail packer, the uniform slots from the theme's `vf-frame`
// section, the hit test, and the light source a dragged set casts.

import { type CardContext, type CardProgram, type Hit, CARD_ABI, type Silhouette } from "../../card/program";
import { spring, settled } from "../../card/springs";
import type { MotionTuning } from "../../card/motion";
import { WGSL } from "../../shaders.gen";
import { cssColor, type GroundTheme, type RGB, type RGBA, rgb, type ThemeName, type TokenRef } from "../../theme";
import { resolve, tailOf, VF_EXT, type VfGeometry, type VfMotion } from "./choreography";
import { HEAT, type Heat, heatValues } from "./heat";
import { pick } from "./sdf";
import { type FrameStyle, PRODUCT } from "./sheet";

export * from "./choreography";
export * from "./heat";
export * from "./sdf";
export * from "./sheet";

/** The theme section's name — `theme.packs["vf-frame"]`. */
export const VF_FRAME = "vf-frame";

/** The colours this frame paints beyond the head's, one token each (the product's DESIGN.md roles). */
export interface VfPalette {
  readonly frame: TokenRef;        // §2.2 solid chrome — the revealed frame's material
  readonly destructive: TokenRef;  // §2.5 failed / destructive — the close button, armed
  readonly onSolid: TokenRef;      // the glyph on a §2.5 solid
  readonly inkStrong: TokenRef;    // §2.4 the ramp: primary
  readonly ink: TokenRef;          //             secondary — button glyphs at rest
  readonly inkMuted: TokenRef;     //             tertiary — the open lock
  readonly fill: TokenRef;         // §7 button fill, resting
  readonly fillHover: TokenRef;    // §7 button fill, hover
  readonly glow: TokenRef;         // §7 overlap glow — the inset haze toward the hot point (GLOW.md)
  readonly rim: TokenRef;          // §7 overlap rim — the edge band lit at the hot point
}

/** The section, parsed — what `uniformValues` packs. */
export interface VfThemeSection {
  readonly frame: RGB;
  readonly destructive: RGB;
  readonly onSolid: RGB;
  readonly inkStrong: RGBA;
  readonly ink: RGBA;
  readonly inkMuted: RGBA;
  readonly fill: RGBA;
  readonly fillHover: RGBA;
  readonly glow: RGB;
  readonly rim: RGB;
}

export function vfThemeSection(p: VfPalette): VfThemeSection {
  return {
    frame: rgb(p.frame.css), destructive: rgb(p.destructive.css), onSolid: rgb(p.onSolid.css),
    inkStrong: cssColor(p.inkStrong.css), ink: cssColor(p.ink.css), inkMuted: cssColor(p.inkMuted.css),
    fill: cssColor(p.fill.css), fillHover: cssColor(p.fillHover.css),
    glow: rgb(p.glow.css), rim: rgb(p.rim.css),
  };
}

/** The theme section, as `themeFrom` reads it. */
export const VF_THEME_SOURCE = { name: VF_FRAME, theme: (palette: unknown, _name: ThemeName): VfThemeSection => vfThemeSection(palette as VfPalette) } as const;

/** The theme's section for this pack, or a loud refusal — a theme built without it would render the frame black. */
export function vfSectionOf(theme: GroundTheme): VfThemeSection {
  const s = theme.packs[VF_FRAME] as VfThemeSection | undefined;
  if (s === undefined) throw new Error(`vf-frame: the theme "${theme.name}" has no "${VF_FRAME}" section — build it with themeFrom(name, palette, grid, [vfFrame()])`);
  return s;
}

/** The uniform slots, in the order frame.wgsl reads them (12 vec4 slots). */
export const VF_UNIFORMS = 12;
export function vfUniformValues(t: VfThemeSection, heat: Heat): number[] {
  const h = heatValues(t, heat);
  return [
    ...t.frame, 1, ...t.fill, ...t.fillHover, ...t.destructive, 1,
    ...t.ink, ...t.inkStrong, ...t.inkMuted, ...t.onSolid, 1,
    ...h.colGlow, ...h.colRim, ...h.glowK, ...h.rimK,
  ];
}

/** The pack's own springs for one card: the buttons' hover and press, the lock. */
export interface VfSprings {
  hoverC: number; hoverCV: number; pressC: number; pressCV: number;
  hoverK: number; hoverKV: number; pressK: number; pressKV: number;
  locked: boolean; lockA: number; lockV: number;   // 0 locked … 1 open
}
export const newVfSprings = (locked = true): VfSprings => ({ hoverC: 0, hoverCV: 0, pressC: 0, pressCV: 0, hoverK: 0, hoverKV: 0, pressK: 0, pressKV: 0, locked, lockA: locked ? 0 : 1, lockV: 0 });

/** The lock's spring tuning (the engine's motion tuning carried these before design-014). */
export const VF_TUNING = { lockHz: 3.6, lockDamp: 0.72 } as const;

/** The pack's part names — what `pick` returns and the router's part channel carries. */
export const VF_PARTS = { close: "close", lock: "lock" } as const;

export interface VfFrameOptions {
  /** The frame style; the product's composed corners by default. */
  readonly style?: FrameStyle;
  /** The heat's knobs (height, the tier alphas, the rim); theme.ts's `HEAT` by default. */
  readonly heat?: Heat;
  /** The lock's spring; a host's motion tuning may lend its own. */
  readonly tuning?: Pick<MotionTuning, "lockHz" | "lockDamp">;
}

export interface VfFramePack extends CardProgram<VfGeometry> {
  /** The style in force — settable: the lab's panel edits it between frames. */
  style: FrameStyle;
  /** The heat's knobs — settable, the same way. */
  heat: Heat;
  /** The springs for a card key (made on first sight, locked). */
  springsOf(key: unknown): VfSprings;
  /** The lock's state for a card key: `locked` closes it, the spring animates. */
  setLocked(key: unknown, locked: boolean): void;
  /** Forget a card's springs (it left the board). */
  forget(key: unknown): void;
}

/** Step a card's own springs by `dt` seconds toward the part channel's targets; true while any still moves. */
export function stepVfSprings(s: VfSprings, dt: number, part: { readonly hover: string | null; readonly press: string | null }, buttonsLive: boolean, tuning: Pick<MotionTuning, "lockHz" | "lockDamp"> = VF_TUNING): boolean {
  let live = false;
  const lockTarget = s.locked ? 0 : 1;
  [s.lockA, s.lockV] = spring(s.lockA, s.lockV, lockTarget, tuning.lockHz, tuning.lockDamp, dt);
  if (settled(s.lockA, s.lockV, lockTarget)) { s.lockA = lockTarget; s.lockV = 0; } else live = true;
  const hc = buttonsLive && part.hover === VF_PARTS.close ? 1 : 0;
  const pc = buttonsLive && part.press === VF_PARTS.close ? 1 : 0;
  const hk = buttonsLive && part.hover === VF_PARTS.lock ? 1 : 0;
  const pk = buttonsLive && part.press === VF_PARTS.lock ? 1 : 0;
  [s.hoverC, s.hoverCV] = spring(s.hoverC, s.hoverCV, hc, 5.5, 0.75, dt);
  [s.pressC, s.pressCV] = spring(s.pressC, s.pressCV, pc, 9.0, 1.0, dt);
  [s.hoverK, s.hoverKV] = spring(s.hoverK, s.hoverKV, hk, 5.5, 0.75, dt);
  [s.pressK, s.pressKV] = spring(s.pressK, s.pressKV, pk, 9.0, 1.0, dt);
  for (const [x, v, tg] of [[s.hoverC, s.hoverCV, hc], [s.pressC, s.pressCV, pc], [s.hoverK, s.hoverKV, hk], [s.pressK, s.pressKV, pk]] as const) {
    if (!settled(x, v, tg)) live = true;
  }
  return live;
}

/** The engine's motion plus a card's own springs, as `resolve` reads them. */
export function vfMotionOf(m: CardContext["motion"], s: VfSprings): VfMotion {
  return { ...m, hoverC: s.hoverC, pressC: s.pressC, hoverK: s.hoverK, pressK: s.pressK, lockOpen: s.lockA, lockVel: Math.min(Math.max(s.lockV / 16, -0.7), 0.7) };
}

export function vfFrame(opts: VfFrameOptions = {}): VfFramePack {
  const table = new Map<unknown, VfSprings>();
  const tuning = opts.tuning ?? VF_TUNING;
  const pack: VfFramePack = {
    name: VF_FRAME,
    abi: CARD_ABI,
    shader: { label: "packs/vf-frame/frame.wgsl", text: WGSL["packs/vf-frame/frame.wgsl"] },
    ext: VF_EXT,
    uniforms: VF_UNIFORMS,
    style: opts.style ?? PRODUCT,
    heat: opts.heat ?? HEAT,
    springsOf(key) {
      let s = table.get(key);
      if (s === undefined) { s = newVfSprings(); table.set(key, s); }
      return s;
    },
    setLocked(key, locked) { pack.springsOf(key).locked = locked; },
    forget(key) { table.delete(key); },
    resolve(ctx) {
      // a card without a key (a still: the oracle) resolves at rest — fresh springs, the lock closed
      const s = ctx.key === undefined ? newVfSprings() : pack.springsOf(ctx.key);
      const buttonsLive = ctx.motion.del <= 0 && ctx.motion.reveal > 0.5;
      if (stepVfSprings(s, ctx.dt, ctx.part, buttonsLive, tuning) && ctx.out) ctx.out.live = true;
      return resolve(pack.style, ctx.card, vfMotionOf(ctx.motion, s), ctx.material);
    },
    tail: (G) => tailOf(G),
    release: (key) => { table.delete(key); },
    uniformValues: (theme) => vfUniformValues(vfSectionOf(theme), pack.heat),
    pick: (G, x, y): Hit => pick(G, x, y),
    source(w, h, lift, radius): Silhouette {
      const T = pack.style.thickness;
      const Ro = pack.style.outerR ?? radius + T;
      return { hx: (w / 2 + T) * lift, hy: (h / 2 + T) * lift, r: Ro * lift };
    },
    theme: VF_THEME_SOURCE.theme,
  };
  return pack;
}
