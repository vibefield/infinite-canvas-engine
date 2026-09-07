// The CONTENT term of the card fragment — COMPOSE.md, design-013 §10. A card's
// interior is one of three things: the surface PLATE (a colour — today's card,
// and the card whose DOM host paints content above it), a PAGE of the atlas
// array (a dom card's rasterised pixels, one binding for the whole board), or
// its OWN texture (an island's render target, a live surface's stable
// texture). The widget quad and the card frame are one draw: the texel lands
// at coverage `cI`, where `surface.rgb` lands today.
//
// This file is the pure part: the vocabulary, the uv maths, the run builder,
// and the raw-bytes uploads a host (ICE's Residency) uses to put pixels where
// the record says they are.

import type { Geometry } from "./choreography.ts";

/** The WRITTEN rect inside a layer or a texture, normalised — design-013 §5's `u0 v0 u1 v1`. */
export interface UvRect { readonly u0: number; readonly v0: number; readonly u1: number; readonly v1: number }
export const FULL_UV: UvRect = { u0: 0, v0: 0, u1: 1, v1: 1 };

export type FrameContent =
  | { readonly mode: "plate" }
  | { readonly mode: "page"; readonly layer: number; readonly uv: UvRect }
  | { readonly mode: "own"; readonly texture: GPUTextureView; readonly srgb: boolean; readonly uv: UvRect }
  /** A HOLE (PORTAL.md §2.2, §10): the container's inside was drawn beneath, through its FACE — inside it nothing paints, outside it the plate; no face = the whole interior. */
  | { readonly mode: "portal"; readonly face?: PortalFace };

/** The face a container shows its inside through, in the card's own frame (world units): centre, half extents, corner radius — `faceRect` of the content rect, as the hole is cut. */
export interface PortalFace { readonly cx: number; readonly cy: number; readonly hx: number; readonly hy: number; readonly r: number }

export const PLATE: FrameContent = { mode: "plate" };
/** The hole with no face: the whole interior. */
export const PORTAL: FrameContent = { mode: "portal" };
/** The hole cut to a face. */
export const portalContent = (face: PortalFace): FrameContent => ({ mode: "portal", face });

/** The record's `mode` — a pipeline reads it per instance; the sRGB variant is an `override`, never a mode. */
export const CONTENT_MODE = { plate: 0, page: 1, own: 2, portal: 3 } as const;

/** A written rect in texels as the record's normalised uv. */
export function uvOf(x: number, y: number, w: number, h: number, texW: number, texH: number): UvRect {
  return { u0: x / texW, v0: y / texH, u1: (x + w) / texW, v1: (y + h) / texH };
}

/** The record's `uv` (min xy, size xy), `layer`, `mode` and `chalf` for a content, on a resolved geometry. */
export function contentValues(G: Geometry, c: FrameContent = PLATE): { mode: number; layer: number; uv: number[]; chalf: readonly [number, number] } {
  // a hole's FACE rides the content slots: uv = its centre from the card's, its radius, 1 (on); chalf = its half extents (frame.wgsl)
  if (c.mode === "portal" && c.face) return { mode: CONTENT_MODE.portal, layer: 0, uv: [c.face.cx - G.centre[0], c.face.cy - G.centre[1], c.face.r, 1], chalf: [c.face.hx, c.face.hy] };
  const uv = c.mode === "plate" || c.mode === "portal" ? [0, 0, 0, 0] : [c.uv.u0, c.uv.v0, c.uv.u1 - c.uv.u0, c.uv.v1 - c.uv.v0];
  // chalf = the inner box: under grow = 1 the content is pinned, so it IS the widget's own rect × the lift scale
  // (COMPOSE.md); mid-delete it follows the shrinking interior, which is the zoom the morph wants.
  return { mode: CONTENT_MODE[c.mode], layer: c.mode === "page" ? c.layer : 0, uv, chalf: G.ih };
}

/** One instanced draw of the card pass: `draw(6, count, 0, first)` against ONE own texture (or none). */
export interface FrameRun { readonly first: number; readonly count: number; readonly own: GPUTextureView | null; readonly srgb: boolean }

/**
 * Split records (already in paint order) into z-runs. A run breaks ONLY
 * where the `own` texture changes — plate and page cards read no own
 * texture, so they ride whichever run they fall in. A board of dom cards is
 * one run; islands and live surfaces split it only where they interleave.
 */
export function runsOf(contents: ReadonlyArray<FrameContent | undefined>): FrameRun[] {
  const runs: { first: number; count: number; own: GPUTextureView | null; srgb: boolean }[] = [];
  for (let i = 0; i < contents.length; i++) {
    const c = contents[i];
    const own = c?.mode === "own" ? c.texture : null;
    const srgb = c?.mode === "own" ? c.srgb : false;
    const cur = runs[runs.length - 1];
    if (cur === undefined) runs.push({ first: i, count: 1, own, srgb });
    else if (own === null || cur.own === null || cur.own === own) { cur.count += 1; if (cur.own === null) { cur.own = own; cur.srgb = srgb; } }
    else runs.push({ first: i, count: 1, own, srgb });
  }
  return runs;
}

// ---------------------------------------------------------------- pixels, where the record says

/** HiC's destination usage (design-013 §4): a page is copied into, sampled, copied out of, and rendered to. */
const PAGE_USAGE = () => GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT;

/** A page ARRAY: `layers` layers of one fixed `size` (design-013 §4, Q10 — the layer size is Residency's parameter). */
export function createPages(device: GPUDevice, size: number, layers: number, label = "content/pages"): GPUTexture {
  return device.createTexture({ label, size: [size, size, layers], format: "rgba8unorm", dimension: "2d", usage: PAGE_USAGE() });
}

/** Write raw premultiplied rgba8 rows (row 0 = top) into a layer at (x, y). Returns the written rect as uv. */
export function writeLayer(device: GPUDevice, pages: GPUTexture, layer: number, x: number, y: number, w: number, h: number, bytes: Uint8Array<ArrayBuffer>): UvRect {
  if (bytes.byteLength !== w * h * 4) throw new Error(`writeLayer: expected ${w}×${h} rgba8 (${w * h * 4} bytes), got ${bytes.byteLength}`);
  device.queue.writeTexture({ texture: pages, origin: [x, y, layer] }, bytes, { bytesPerRow: w * 4 }, [w, h, 1]);
  return uvOf(x, y, w, h, pages.width, pages.height);
}

/** A card's OWN texture from raw premultiplied rgba8 bytes — `-srgb` when the pixels are what an island renders (sampling then decodes). */
export function createOwn(device: GPUDevice, w: number, h: number, bytes: Uint8Array<ArrayBuffer>, srgb: boolean, label = "content/own"): GPUTexture {
  if (bytes.byteLength !== w * h * 4) throw new Error(`createOwn: expected ${w}×${h} rgba8 (${w * h * 4} bytes), got ${bytes.byteLength}`);
  const t = device.createTexture({ label, size: [w, h], format: srgb ? "rgba8unorm-srgb" : "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: t }, bytes, { bytesPerRow: w * 4 }, [w, h]);
  return t;
}

// ---------------------------------------------------------------- the test residency

/**
 * What both hosts build from `lab/assets/content-test.rgba` (128², premultiplied;
 * tools/make-test-plate.mjs) so the oracle's textured cards are the same
 * texels in Node and in Chrome: a two-layer 512² page array holding the plate
 * at the origin of layer 0 and off-centre in layer 1 (so `layer` and a
 * written sub-rect both matter), and the plate again as an own texture, plain
 * and `-srgb` (the same bytes — the sRGB variant must round-trip them).
 */
export const TEST_PLATE = { size: 128, pages: { size: 512, layers: 2, at: [[0, 0], [256, 128]] as const } } as const;

export type ContentChoice = "plate" | "page0" | "page1" | "own" | "own-srgb";
export const CONTENT_CHOICES: readonly ContentChoice[] = ["plate", "page0", "page1", "own", "own-srgb"];

export interface TestResidency {
  readonly pages: GPUTexture;
  readonly pagesView: GPUTextureView;
  /** The content record for a choice. */
  content(choice: ContentChoice): FrameContent;
  dispose(): void;
}

export function testResidency(device: GPUDevice, plate: Uint8Array<ArrayBuffer>): TestResidency {
  const N = TEST_PLATE.size;
  const P = TEST_PLATE.pages;
  const pages = createPages(device, P.size, P.layers, "content/test pages");
  const uv0 = writeLayer(device, pages, 0, P.at[0][0], P.at[0][1], N, N, plate);
  const uv1 = writeLayer(device, pages, 1, P.at[1][0], P.at[1][1], N, N, plate);
  const own = createOwn(device, N, N, plate, false, "content/test own");
  const ownSrgb = createOwn(device, N, N, plate, true, "content/test own srgb");
  const pagesView = pages.createView({ dimension: "2d-array" });
  const ownView = own.createView();
  const ownSrgbView = ownSrgb.createView();
  const table: Record<ContentChoice, FrameContent> = {
    plate: PLATE,
    page0: { mode: "page", layer: 0, uv: uv0 },
    page1: { mode: "page", layer: 1, uv: uv1 },
    own: { mode: "own", texture: ownView, srgb: false, uv: FULL_UV },
    "own-srgb": { mode: "own", texture: ownSrgbView, srgb: true, uv: FULL_UV },
  };
  return { pages, pagesView, content: (choice) => table[choice], dispose() { pages.destroy(); own.destroy(); ownSrgb.destroy(); } };
}
