// PASS 3 — the card frames, and (design-013 §10) the COMPOSITOR: every card's
// chrome and its content in one fragment, one instanced draw per z-run. Owns
// the uniform block, the per-card record buffer and its bind groups; the
// pipelines (one per sRGB variant), the sampler, the page array binding and
// the own-texture bind groups are shared with every slot spawned from the
// first (`spawn()` — a nav flight's departed frames). `prepare()` uploads
// this frame's records and splits them into runs; `draw()` records the runs
// into an open render pass.

import { bindGroup, bindLayout, renderPipeline, storageBuffer, uniformBuffer } from "../engine/pipeline.ts";
import { compile, compose, type ShaderPart } from "../engine/shader.ts";
import type { Geometry } from "./choreography.ts";
import type { Presentation } from "../nav/portal.ts";
import { HEAT, LINES, type GroundTheme, type Heat, type RGB } from "../theme.ts";
import { type FrameContent, type FrameRun, runsOf } from "./content.ts";
import { Frame, FrameUniforms, MAX_FRAMES, frameUniformValues, frameValues } from "./layout.ts";

/** Premultiplied "source over". */
const BLEND_PREMUL: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};

export interface FrameShaders {
  readonly modules: readonly ShaderPart[];   // portal, primitives, frame
  readonly entry: ShaderPart;                // frame-pass
}

export interface FrameInstance {
  readonly geometry: Geometry;
  /** The card's committed surface (§2.2) — its own colour in either theme; the PLATE under any content. */
  readonly surface: RGB;
  /** What the interior shows (content.ts); absent = the plate. */
  readonly content?: FrameContent | undefined;
}

/** What every slot shares: the pipelines, the sampler, the page array (versioned — a slot rebinds when it changes), the own-texture groups. */
interface FrameShared {
  readonly layout0: GPUBindGroupLayout;
  readonly layout1: GPUBindGroupLayout;
  readonly pipeline: { readonly plain: GPURenderPipeline; readonly srgb: GPURenderPipeline };
  readonly sampler: GPUSampler;
  readonly dummyPages: GPUTextureView;
  readonly dummyOwn: GPUTextureView;
  pages: GPUTextureView;
  version: number;
  /** Bind groups keyed by the own texture's view — collected with the view, never swept. */
  readonly ownGroups: WeakMap<GPUTextureView, GPUBindGroup>;
}

export class FramePass {
  readonly name = "card/frames";
  private readonly uniforms = FrameUniforms.alloc(1);
  private readonly records = Frame.alloc(MAX_FRAMES);
  private readonly uniformBuf: GPUBuffer;
  private readonly recordBuf: GPUBuffer;
  private group0!: GPUBindGroup;
  private bound = -1;
  private runs: FrameRun[] = [];
  private count = 0;
  exact = false;
  /** §2.3 / §7 line weights, card units — theme.ts's unless a host tweaks them. */
  lines: { readonly hairline: number; readonly ring: number } = LINES;
  /** §7 the overlap heat's knobs (GLOW.md) — theme.ts's unless a host tweaks them. */
  heat: Heat = HEAT;
  private readonly device: GPUDevice;
  private readonly shared: FrameShared;

  private constructor(device: GPUDevice, shared: FrameShared) {
    this.device = device; this.shared = shared;
    this.uniformBuf = uniformBuffer(device, FrameUniforms.size, "card/uniforms");
    this.recordBuf = storageBuffer(device, Frame.size * MAX_FRAMES, "card/frames");
    this.rebind();
  }

  static async create(device: GPUDevice, format: GPUTextureFormat, src: FrameShaders): Promise<FramePass> {
    const layout0 = bindLayout(device, [
      { binding: 0, stages: ["vertex", "fragment"], buffer: "uniform" },
      { binding: 1, stages: ["vertex", "fragment"], buffer: "read-only-storage" },
      { binding: 2, stages: ["fragment"], texture: "float", dimension: "2d-array" },
      { binding: 3, stages: ["fragment"], sampler: "filtering" },
    ], "card/frames");
    const layout1 = bindLayout(device, [{ binding: 0, stages: ["fragment"], texture: "float" }], "card/own");
    const module = await compile(device, compose({ structs: [Frame, FrameUniforms], modules: src.modules, entry: src.entry }));
    const layout = device.createPipelineLayout({ bindGroupLayouts: [layout0, layout1] });
    const [plain, srgb] = await Promise.all([
      renderPipeline(device, { label: "card/frames", layout, module, format, blend: BLEND_PREMUL, constants: { ENCODE_SRGB: 0 } }),
      renderPipeline(device, { label: "card/frames srgb", layout, module, format, blend: BLEND_PREMUL, constants: { ENCODE_SRGB: 1 } }),
    ]);
    const clear = new Uint8Array([0, 0, 0, 0]);
    const dummyPagesTex = device.createTexture({ label: "card/pages dummy", size: [1, 1, 1], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: dummyPagesTex }, clear, { bytesPerRow: 4 }, [1, 1, 1]);
    const dummyOwnTex = device.createTexture({ label: "card/own dummy", size: [1, 1], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: dummyOwnTex }, clear, { bytesPerRow: 4 }, [1, 1]);
    const dummyPages = dummyPagesTex.createView({ dimension: "2d-array" });
    const shared: FrameShared = {
      layout0, layout1, pipeline: { plain, srgb },
      sampler: device.createSampler({ label: "card/content", magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" }),
      dummyPages, dummyOwn: dummyOwnTex.createView(), pages: dummyPages, version: 0, ownGroups: new WeakMap(),
    };
    return new FramePass(device, shared);
  }

  /** A second record buffer on the same pipelines — a nav flight's DEPARTED frames. Copies the tuning; shares the pages. */
  spawn(): FramePass {
    const p = new FramePass(this.device, this.shared);
    p.exact = this.exact; p.lines = this.lines; p.heat = this.heat;
    return p;
  }

  /** The page ARRAY every `page` card samples (a `2d-array` view); `null` = none. Shared by every slot. */
  setPages(view: GPUTextureView | null): void {
    this.shared.pages = view ?? this.shared.dummyPages;
    this.shared.version += 1;
    this.rebind();
  }

  private rebind(): void {
    const s = this.shared;
    if (this.bound === s.version) return;
    this.group0 = bindGroup(this.device, s.layout0, [this.uniformBuf, this.recordBuf, s.pages, s.sampler], "card/frames");
    this.bound = s.version;
  }

  private ownGroup(view: GPUTextureView | null): GPUBindGroup {
    const s = this.shared;
    const v = view ?? s.dummyOwn;
    let g = s.ownGroups.get(v);
    if (g === undefined) { g = bindGroup(this.device, s.layout1, [v], "card/own"); s.ownGroups.set(v, g); }
    return g;
  }

  /** Upload this frame's records (in PAINT order) and split them into z-runs. Returns the count that will draw. */
  prepare(view: { camX: number; camY: number; zoom: number; dpr: number; width: number; height: number }, theme: GroundTheme, instances: readonly FrameInstance[], present?: Presentation): number {
    this.rebind();
    const n = Math.min(instances.length, MAX_FRAMES);
    for (let i = 0; i < n; i++) { const f = instances[i] as FrameInstance; this.records.set(frameValues(f.geometry, f.surface, f.content), i); }
    this.uniforms.set(frameUniformValues(view, theme, this.exact, this.lines, present, this.heat));
    this.device.queue.writeBuffer(this.uniformBuf, 0, this.uniforms.view());
    if (n > 0) this.device.queue.writeBuffer(this.recordBuf, 0, this.records.view(n));
    this.count = n;
    this.runs = n > 0 ? runsOf(instances.slice(0, n).map((f) => f.content)) : [];
    return n;
  }

  /** The runs the last `prepare` made — the churn instrument (a board of dom cards is ONE). */
  get runCount(): number { return this.runs.length; }

  draw(pass: GPURenderPassEncoder): void { this.drawRange(pass, 0, this.count); }

  /**
   * Draw the records in `[first, end)` of paint order — the runs clipped to
   * the range. A parent slot draws its frames in pieces around its nested
   * slots (PORTAL.md §2.2: the container's inside sits over the cards under
   * it and under the cards over it), so every call rebinds.
   */
  drawRange(pass: GPURenderPassEncoder, first: number, end: number): void {
    const hiEnd = Math.min(end, this.count);
    if (first >= hiEnd) return;
    pass.setBindGroup(0, this.group0);
    for (const r of this.runs) {
      const lo = Math.max(r.first, first);
      const hi = Math.min(r.first + r.count, hiEnd);
      if (hi <= lo) continue;
      pass.setPipeline(r.srgb ? this.shared.pipeline.srgb : this.shared.pipeline.plain);
      pass.setBindGroup(1, this.ownGroup(r.own));
      pass.draw(6, hi - lo, 0, lo);
    }
  }

  dispose(): void { this.uniformBuf.destroy(); this.recordBuf.destroy(); }
}
