// OVERLAYS — the ground's other draw layers (design-013 §8 C1, D-C1.1).
//
// The field and the frames are the slot's two fixed passes: the ground under
// the cards, the cards themselves. Everything else an app draws IN the ground —
// the wires between its widgets, the snap guides that appear while one moves —
// is an OVERLAY: a pass with a name, a STAGE and the same lifecycle a grid
// program's surface pass has (`field/program.ts` `SurfacePass`). Two stages,
// because in the composited profile the ground draws the cards and so "under
// the cards" and "over the cards" are the ground's to place:
//
//   under   after the field, before the frames   — wires
//   over    after the frames                     — guides, an app's own
//
// (The old leg drew grid → wires → guides → app by `renderOrder` 0/1/2/≥3
// under a DOM plane that was above all of it; the two stages are that order,
// with the cards now between them.)
//
// A slot's overlay DATA rides `SlotInputs.overlays` by name — the `ext`
// convention a grid program's config uses. No entry for a name = that overlay
// prepares nothing and draws nothing this frame, which is what makes an empty
// overlay list byte-identical across the oracle's scenes: with none registered
// the ground allocates nothing and `drawSlot` calls nothing extra.
//
// The soup overlay below is the one the engine ships: a triangle list in the
// slot's screen CSS px with a colour per vertex (`compose/soup.ts`), the
// vocabulary both collectors already emit.

// `renderPipeline` is the engine's one-liner for a pipeline with no vertex
// buffers; the soup has two, so this reaches for the device call directly and
// keeps the same blend, topology and label conventions by hand.
import { BLEND_OVER, bindGroup, bindLayout, uniformBuffer } from "../engine/pipeline";
import { compile, compose, type ShaderPart } from "../engine/shader";
import { defineStruct } from "../engine/struct";
import type { FieldFrame } from "../field/layout";
import { PORTAL_CHAIN_TYPE, portalValues } from "../nav/portal";
import { WGSL, type WgslFile } from "../shaders.gen";
import type { GroundTheme } from "../theme";
import type { TriSoup } from "./soup";

/** Where in a slot's draw an overlay lands: between the field and the frames, or after them. */
export type OverlayStage = "under" | "over";

/** One SLOT's instance of an overlay: its own uniforms and buffers; the pipeline is the program's, shared by every slot. */
export interface OverlayPass {
  /**
   * Upload this slot's overlay for the frame. `data` is whatever the host put
   * under this overlay's name in `SlotInputs.overlays` — the pass owns its
   * shape. Returns whether it has anything to draw; false = the ground skips it.
   */
  prepare(encoder: GPUCommandEncoder, frame: FieldFrame, data: unknown, theme: GroundTheme): boolean;
  /** Record the overlay into an open render pass, at its stage. */
  draw(pass: GPURenderPassEncoder): void;
  /** A second instance on the same pipeline (a live portal's slot, the flight's departed slot). */
  spawn(): OverlayPass;
  dispose(): void;
}

/** An overlay as a host registers it: `groundCompose({ overlays })` / `Ground.create({ overlays })`. */
export interface OverlayProgram {
  /** The key its data rides under in `SlotInputs.overlays`. */
  readonly name: string;
  readonly stage: OverlayStage;
  /** Compile the program's pipeline once. An overlay owns its whole shader set (the portal module included) — unlike a grid program, it is not composed against the field's. */
  create(device: GPUDevice, format: GPUTextureFormat): Promise<OverlayPass>;
}

/** A slot's overlay data, by overlay name. A name with no entry draws nothing. */
export type OverlayInputs = Readonly<Record<string, unknown>>;

// ---------------------------------------------------------------- the soup overlay

export const SoupUniforms = defineStruct("SoupUniforms", [
  ["view", "vec4f"],              // cssW, cssH, dpr, presentation opacity
  ["portals", PORTAL_CHAIN_TYPE], // the portal CHAIN (nav/portal.ts): each face's centre xy, half extents xy (CSS px)
  ["clips", PORTAL_CHAIN_TYPE],   // each face's corner radius, on (0/1 — a 0 ends the chain), unused ×2
] as const);

export interface SoupShaders {
  readonly modules: readonly ShaderPart[];   // portal.wgsl
  readonly entry: ShaderPart;                // overlay/soup.wgsl
}

export interface SoupShaderText {
  readonly portal: string;
  readonly soup: string;
}

export const SOUP_SHADER_FILES: Record<keyof SoupShaderText, string> = {
  portal: "portal.wgsl",
  soup: "overlay/soup.wgsl",
};

export function soupShaders(t: SoupShaderText): SoupShaders {
  const part = (label: string, text: string): ShaderPart => ({ label, text });
  return { modules: [part("portal.wgsl", t.portal)], entry: part("overlay/soup.wgsl", t.soup) };
}

/** The soup set from the generated text — what `soupOverlay` uses when a host names no shaders. */
export function soupShadersFromGen(): SoupShaders {
  const t = Object.fromEntries(Object.entries(SOUP_SHADER_FILES).map(([k, f]) => [k, WGSL[f as WgslFile]])) as unknown as SoupShaderText;
  return soupShaders(t);
}

/** The floor a growing vertex buffer starts at, and the policy: double, never shrink (the old `soup-mesh.ts`'s — guide and wire counts oscillate per frame). */
const SOUP_FLOOR = 256;

/**
 * The soup pass, one instance per slot: a growable pair of vertex buffers
 * (position xyz, colour rgba — the `TriSoup` arrays as they are) uploaded in
 * `prepare` and drawn in `draw`. The slot's scissor and its portal chain apply
 * as they do to the field: a portal-clipped slot clips its overlays.
 */
class SoupPass implements OverlayPass {
  private readonly device: GPUDevice;
  private readonly pipeline: GPURenderPipeline;
  private readonly layout: GPUBindGroupLayout;
  private readonly uniforms = SoupUniforms.alloc(1);
  private readonly uniformBuf: GPUBuffer;
  private readonly group: GPUBindGroup;
  private positions: GPUBuffer | null = null;
  private colors: GPUBuffer | null = null;
  private capacity = 0;
  private count = 0;
  /** The soup the vertex buffers already hold — a still frame re-uploads the uniform only. */
  private uploaded: TriSoup | null = null;
  /** Vertex uploads so far, and frames that skipped one — the churn instrument. */
  private uploads = 0;
  private skipped = 0;

  constructor(device: GPUDevice, pipeline: GPURenderPipeline, layout: GPUBindGroupLayout) {
    this.device = device;
    this.pipeline = pipeline;
    this.layout = layout;
    this.uniformBuf = uniformBuffer(device, SoupUniforms.size, "overlay/soup");
    this.group = bindGroup(device, layout, [this.uniformBuf], "overlay/soup");
  }

  /** Vertices the buffers hold room for — the churn instrument (it only ever grows). */
  get vertexCapacity(): number { return this.capacity; }
  /** Vertices the last `prepare` bound. */
  get vertexCount(): number { return this.count; }
  /** Vertex uploads, and prepares that reused the buffers (the same soup by reference). */
  get uploadStats(): { readonly uploads: number; readonly skipped: number } { return { uploads: this.uploads, skipped: this.skipped }; }

  private grow(vertices: number): void {
    const next = Math.max(vertices, this.capacity * 2, SOUP_FLOOR);
    this.positions?.destroy();
    this.colors?.destroy();
    const usage = GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST;
    this.positions = this.device.createBuffer({ label: "overlay/soup.pos", size: next * 3 * 4, usage });
    this.colors = this.device.createBuffer({ label: "overlay/soup.col", size: next * 4 * 4, usage });
    this.capacity = next;
  }

  prepare(_encoder: GPUCommandEncoder, frame: FieldFrame, data: unknown, _theme: GroundTheme): boolean {
    const soup = data as TriSoup | undefined;
    this.count = soup === undefined ? 0 : Math.min(soup.vertexCount, Math.floor(soup.positions.length / 3), Math.floor(soup.colors.length / 4));
    if (this.count === 0 || soup === undefined) return false;
    if (this.count > this.capacity) { this.grow(this.count); this.uploaded = null; }
    // The collectors build a FRESH soup per collection, so identity is the honest test:
    // a painted frame whose overlays did not re-collect re-uploads the uniform (the
    // presentation opacity and the chain still move) and leaves the vertices alone.
    if (this.uploaded !== soup) {
      const pos = this.positions as GPUBuffer;
      const col = this.colors as GPUBuffer;
      this.device.queue.writeBuffer(pos, 0, soup.positions, 0, this.count * 3);
      this.device.queue.writeBuffer(col, 0, soup.colors, 0, this.count * 4);
      this.uploaded = soup;
      this.uploads += 1;
    } else this.skipped += 1;
    const view = frame.view;
    this.uniforms.set({ view: [view.width, view.height, view.dpr, frame.present?.opacity ?? 1], ...portalValues(frame.present) });
    this.device.queue.writeBuffer(this.uniformBuf, 0, this.uniforms.view());
    return true;
  }

  draw(pass: GPURenderPassEncoder): void {
    if (this.count === 0 || this.positions === null || this.colors === null) return;
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.group);
    pass.setVertexBuffer(0, this.positions);
    pass.setVertexBuffer(1, this.colors);
    pass.draw(this.count);
  }

  spawn(): OverlayPass { return new SoupPass(this.device, this.pipeline, this.layout); }

  dispose(): void {
    this.uniformBuf.destroy();
    this.positions?.destroy();
    this.colors?.destroy();
    this.positions = null;
    this.colors = null;
    this.capacity = 0;
    this.count = 0;
    this.uploaded = null;
  }
}

/**
 * An overlay that draws a `TriSoup` — the wires (`under`) and the guides
 * (`over`) are two registrations of this one program, each with its own name so
 * each carries its own soup in `SlotInputs.overlays`.
 */
export function soupOverlay(name: string, stage: OverlayStage, shaders: SoupShaders = soupShadersFromGen()): OverlayProgram {
  return {
    name,
    stage,
    async create(device, format) {
      const layout = bindLayout(device, [{ binding: 0, stages: ["vertex", "fragment"], buffer: "uniform" }], `overlay/${name}`);
      const module = await compile(device, compose({ structs: [SoupUniforms], modules: shaders.modules, entry: shaders.entry }));
      const pipeline = await device.createRenderPipelineAsync({
        label: `overlay/${name}`,
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        vertex: {
          module,
          entryPoint: "vs",
          buffers: [
            { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] },
            { arrayStride: 16, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x4" }] },
          ],
        },
        fragment: { module, entryPoint: "fs", targets: [{ format, blend: BLEND_OVER }] },
        // The collectors emit y-down screen px, which lands CLOCKWISE through the
        // vertex mapping. WebGPU's default culls nothing, so both windings draw —
        // the three-side `DoubleSide` of 2026-07-16 has no counterpart here. Stated
        // rather than assumed: `renderPipeline` would default the same way, and the
        // oracle's soup scene asserts a clockwise triangle really lands.
        primitive: { topology: "triangle-list", cullMode: "none" },
      });
      return new SoupPass(device, pipeline, layout);
    },
  };
}

/** The wires overlay's name — `under` the cards, as the old leg drew them (renderOrder 1, beneath the DOM). */
export const WIRES_OVERLAY = "wires";
/** The guides overlay's name — `over` the cards (renderOrder 2). */
export const GUIDES_OVERLAY = "guides";

/** The two overlays the compose host registers when a canvas type asks for them (D-C1.3). */
export const wiresOverlay = (shaders?: SoupShaders): OverlayProgram => soupOverlay(WIRES_OVERLAY, "under", shaders);
export const guidesOverlay = (shaders?: SoupShaders): OverlayProgram => soupOverlay(GUIDES_OVERLAY, "over", shaders);
