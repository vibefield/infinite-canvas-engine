// The card pass's GPU records, declared once — as a HEAD the engine's pass
// reads for every program and a TAIL a card program owns (design-014). The
// head is the resolved `ShellGeometry` (geometry.ts) plus the card's content
// binding (content.ts) and its committed surface; the tail is `ext:
// array<vec4f, N>` with `N` the program's, packed by the program and never
// read by the engine. Likewise `FrameUniforms`: a head every pass reads (the
// camera, the two line weights, the ground's colours, the portal chain, the
// slot's box) and `uext: array<vec4f, M>` the program fills from the theme's
// section for it. Both structs are BUILT per program (`frameStruct`,
// `frameUniformStruct`) — `defineStruct` generates the WGSL and the packer
// from one list, so the layout cannot drift between the two authors.

import { defineStruct, type FieldType, type StructDef } from "../engine/struct";
import { boxValues, type View } from "../lattice/lod";
import { PORTAL_CHAIN_TYPE, portalValues, type Presentation } from "../nav/portal";
import { type GroundTheme, LINES } from "../theme";
import { contentValues, type FrameContent } from "./content";
import type { ShellGeometry } from "./geometry";

/** The record's head, every program's. vec2s first, then scalars, then vec4s: packs tight under the alignment rules; the tail starts on a 16-byte boundary. */
export const FRAME_HEAD: ReadonlyArray<readonly [FrameHeadField, FieldType]> = [
  ["centre", "vec2f"], ["half", "vec2f"], ["ih", "vec2f"],
  ["chalf", "vec2f"],        // the CONTENT half extents the texel maps onto (content.ts)
  ["outerR", "f32"], ["radius", "f32"],
  ["shadowSigma", "f32"], ["shadowOffset", "f32"], ["shadowAlpha", "f32"],
  ["frameAlpha", "f32"], ["ring", "f32"], ["hover", "f32"],
  ["mode", "u32"],           // 0 plate · 1 page · 2 own · 3 portal (a hole) · 4 pane (a page around a hole)
  ["layer", "i32"],          // the page array layer (page, pane); ignored otherwise
  ["faceR", "f32"],          // a pane's face: its corner radius (the two f32s fill the padding before `surface`)
  ["spare", "f32"],
  ["surface", "vec4f"],
  ["uv", "vec4f"],           // the WRITTEN rect inside the layer / own texture, normalised: min xy, size xy — or the hole's face
  ["face", "vec4f"],         // a pane's face: centre xy from the card's, half extents xy (card units); zero otherwise
  ["hot", "vec4f"],          // the §7 heat (GLOW.md): the light SOURCE's centre xy (card units), the glow's presence, the tier 0 reject … 1 accept
  ["src", "vec4f"],          // the source's silhouette: half extents xy, corner radius, unused — the lifted card as drawn
];

export type FrameHeadField = "centre" | "half" | "ih" | "chalf" | "outerR" | "radius" | "shadowSigma" | "shadowOffset" | "shadowAlpha" | "frameAlpha" | "ring" | "hover" | "mode" | "layer" | "faceR" | "spare" | "surface" | "uv" | "face" | "hot" | "src";
export type FrameField = FrameHeadField | "ext";

/** The head's byte size — the number a program's ABI pins (D3). */
export const FRAME_HEAD_BYTES = defineStruct("FrameHead", FRAME_HEAD).size;

/** The record struct for a program with `ext` tail slots. */
export function frameStruct(ext: number): StructDef<FrameField> {
  const fields: Array<readonly [FrameField, FieldType]> = [...FRAME_HEAD];
  if (ext > 0) fields.push(["ext", `array<vec4f, ${ext}>`]);
  return defineStruct("Frame", fields);
}

export const FRAME_UNIFORMS_HEAD: ReadonlyArray<readonly [FrameUniformsHeadField, FieldType]> = [
  ["cam", "vec4f"],            // camX, camY (world), zoom, dpr
  ["view", "vec4f"],           // cssW, cssH, exact (0/1), presentation opacity
  ["lines", "vec4f"],          // hairline width, ring width (card units), unused ×2
  ["colBg", "vec4f"],          // canvas rgb, shadow strength
  ["colHair", "vec4f"],        // hairline rgb, alpha
  ["colRing", "vec4f"],        // --vf-select
  ["portals", PORTAL_CHAIN_TYPE], // the portal CHAIN (nav/portal.ts): each face's centre xy, half extents xy (CSS px)
  ["clips", PORTAL_CHAIN_TYPE],   // each face's corner radius, on (0/1 — a 0 ends the chain), unused ×2
  ["box", "vec4f"],            // the slot's box on the attachment: x, y, w, h (CSS px) — the vertex cull's extent (lod.ts `boxValues`)
];

export type FrameUniformsHeadField = "cam" | "view" | "lines" | "colBg" | "colHair" | "colRing" | "portals" | "clips" | "box";
export type FrameUniformsField = FrameUniformsHeadField | "uext";

/** The uniform block for a program with `uext` slots. */
export function frameUniformStruct(uext: number): StructDef<FrameUniformsField> {
  const fields: Array<readonly [FrameUniformsField, FieldType]> = [...FRAME_UNIFORMS_HEAD];
  if (uext > 0) fields.push(["uext", `array<vec4f, ${uext}>`]);
  return defineStruct("FrameUniforms", fields);
}

export const MAX_FRAMES = 1024;

/** The head's values from a resolved geometry, its surface and its content; `tail` is the program's packed slots (empty for the shell). */
export function frameValues(G: ShellGeometry, surface: readonly [number, number, number], content?: FrameContent, tail: ArrayLike<number> = []) {
  const c = contentValues(G, content);
  return {
    centre: G.centre, half: G.half, ih: G.ih, chalf: c.chalf,
    outerR: G.outerR, radius: G.radius,
    shadowSigma: G.shadowSigma, shadowOffset: G.shadowOffset, shadowAlpha: G.shadowAlpha,
    frameAlpha: G.frameAlpha, ring: G.ring, hover: G.hover,
    mode: c.mode, layer: c.layer, faceR: c.faceR, spare: 0,
    surface: [surface[0], surface[1], surface[2], 1],
    uv: c.uv, face: c.face,
    hot: G.hot, src: G.src,
    ...(tail.length > 0 ? { ext: tail } : {}),
  };
}

/** The uniform head's values; `uext` is the program's packed slots (empty for the shell). */
export function frameUniformValues(
  view: View & { readonly dpr: number },
  theme: GroundTheme,
  exact: boolean,
  lines: { readonly hairline: number; readonly ring: number } = LINES,
  present?: Presentation,
  uext: ArrayLike<number> = [],
) {
  return {
    cam: [view.camX, view.camY, view.zoom, view.dpr],
    view: [view.width, view.height, exact ? 1 : 0, present?.opacity ?? 1],
    lines: [lines.hairline, lines.ring, 0, 0],
    colBg: [...theme.canvasBg, theme.shadow],
    colHair: [...theme.hairline],
    colRing: [...theme.select, 1],
    ...portalValues(present),
    box: boxValues(view),
    ...(uext.length > 0 ? { uext } : {}),
  };
}
