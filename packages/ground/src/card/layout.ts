// The frame pass's GPU records, declared once. `Frame` is exactly the resolved
// geometry `choreography.resolve()` returns, plus the card's committed surface
// and its CONTENT (content.ts — plate · page · own: the compositor's quad is
// this same record, design-013 §10.2) — one card, one element. `FrameUniforms`
// is what all cards share for a frame: the camera and the theme, as
// `theme.ts` projects it.

import { defineStruct } from "../engine/struct";
import { boxValues, type View } from "../lattice/lod";
import { HEAT, LINES, type GroundTheme, type Heat, type RGB } from "../theme";
import { PORTAL_CHAIN_TYPE, portalValues, type Presentation } from "../nav/portal";
import type { Geometry } from "./choreography";
import { contentValues, type FrameContent } from "./content";
import { heatValues } from "./heat";

// vec2s first, then scalars, then vec4s: packs tight under the alignment rules.
export const Frame = defineStruct("Frame", [
  ["centre", "vec2f"], ["half", "vec2f"], ["ih", "vec2f"], ["closeC", "vec2f"], ["lockC", "vec2f"],
  ["chalf", "vec2f"],   // the CONTENT half extents the texel maps onto (content.ts)
  ["outerR", "f32"], ["closeR", "f32"], ["closeGlyphW", "f32"], ["closeGlyphR", "f32"],
  ["lockR", "f32"], ["lockGlyphScale", "f32"], ["lockOpen", "f32"], ["lockSquash", "f32"],
  ["hoverC", "f32"], ["hoverK", "f32"], ["shadowSigma", "f32"], ["shadowOffset", "f32"], ["shadowAlpha", "f32"],
  ["frameAlpha", "f32"], ["ring", "f32"],
  ["mode", "u32"],      // 0 plate · 1 page · 2 own
  ["layer", "i32"],     // the page array layer (page); ignored otherwise
  ["surface", "vec4f"],
  ["uv", "vec4f"],      // the WRITTEN rect inside the layer / own texture, normalised: min xy, size xy
  ["nw", "vec4f"], ["nh", "vec4f"], ["rho", "vec4f"], ["rfH", "vec4f"], ["rfV", "vec4f"], ["baseR", "vec4f"],
  ["hot", "vec4f"],     // the §7 heat (GLOW.md): the light SOURCE's centre xy (card units), the glow's presence, the tier 0 reject … 1 accept
  ["src", "vec4f"],     // the source's silhouette: half extents xy, corner radius, unused — the lifted card as drawn
] as const);

export const FrameUniforms = defineStruct("FrameUniforms", [
  ["cam", "vec4f"],            // camX, camY (world), zoom, dpr
  ["view", "vec4f"],           // cssW, cssH, exact (0/1), presentation opacity
  ["lines", "vec4f"],          // hairline width, ring width (card units), unused ×2
  ["colBg", "vec4f"],          // canvas rgb, shadow strength
  ["colFrame", "vec4f"],       // solid chrome
  ["colHair", "vec4f"],        // hairline rgb, alpha
  ["colRing", "vec4f"],        // --vf-select
  ["colBtn", "vec4f"],         // button fill rgb, alpha — resting
  ["colBtnHover", "vec4f"],    // button fill — hover
  ["colDestructive", "vec4f"], // --vf-red — the armed close
  ["colInk", "vec4f"],         // glyph ink rgb, alpha — resting (text-secondary)
  ["colInkStrong", "vec4f"],   // glyph ink — hover (foreground)
  ["colInkMuted", "vec4f"],    // glyph ink — the open lock (text-tertiary)
  ["colOnSolid", "vec4f"],     // the glyph on a solid state colour
  ["portals", PORTAL_CHAIN_TYPE], // the portal CHAIN (nav/portal.ts): each face's centre xy, half extents xy (CSS px)
  ["clips", PORTAL_CHAIN_TYPE],   // each face's corner radius, on (0/1 — a 0 ends the chain), unused ×2
  ["colGlow", "vec4f"],        // §7 overlap glow colour (--ic-glow-color), unused
  ["colRim", "vec4f"],         // §7 overlap rim colour (--ic-rim-color), unused
  ["glowK", "vec4f"],          // the source's height over the receiver (card units), alpha reject, alpha accept, unused
  ["rimK", "vec4f"],           // rim width (card units), alpha reject, alpha accept, unused
  ["box", "vec4f"],            // the slot's box on the attachment: x, y, w, h (CSS px) — the vertex cull's extent (lod.ts `boxValues`)
] as const);

export const MAX_FRAMES = 1024;

export function frameValues(G: Geometry, surface: RGB, content?: FrameContent) {
  const c = contentValues(G, content);
  return {
    centre: G.centre, half: G.half, ih: G.ih, closeC: G.closeC, lockC: G.lockC, chalf: c.chalf,
    mode: c.mode, layer: c.layer, uv: c.uv,
    outerR: G.outerR, closeR: G.closeR, closeGlyphW: G.closeGlyphW, closeGlyphR: G.closeGlyphR,
    lockR: G.lockR, lockGlyphScale: G.lockGlyphScale, lockOpen: G.lockOpen, lockSquash: G.lockSquash,
    hoverC: G.hoverC, hoverK: G.hoverK, shadowSigma: G.shadowSigma, shadowOffset: G.shadowOffset, shadowAlpha: G.shadowAlpha,
    frameAlpha: G.frameAlpha, ring: G.ring,
    surface: [surface[0], surface[1], surface[2], 1],
    nw: G.nw, nh: G.nh, rho: G.rho, rfH: G.rfH, rfV: G.rfV, baseR: G.baseR,
    hot: G.hot, src: G.src,
  };
}

export function frameUniformValues(
  view: View & { readonly dpr: number },
  theme: GroundTheme,
  exact: boolean,
  lines: { readonly hairline: number; readonly ring: number } = LINES,
  present?: Presentation,
  heat: Heat = HEAT,
) {
  return {
    cam: [view.camX, view.camY, view.zoom, view.dpr],
    view: [view.width, view.height, exact ? 1 : 0, present?.opacity ?? 1],
    lines: [lines.hairline, lines.ring, 0, 0],
    colBg: [...theme.canvasBg, theme.shadow],
    colFrame: [...theme.frame, 1],
    colHair: [...theme.hairline],
    colRing: [...theme.select, 1],
    colBtn: [...theme.fill],
    colBtnHover: [...theme.fillHover],
    colDestructive: [...theme.destructive, 1],
    colInk: [...theme.ink],
    colInkStrong: [...theme.inkStrong],
    colInkMuted: [...theme.inkMuted],
    colOnSolid: [...theme.onSolid, 1],
    ...portalValues(present),
    ...heatValues(theme, heat),
    box: boxValues(view),
  };
}
