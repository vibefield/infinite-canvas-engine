// THE FOCUS BEHIND THE HAND (design-015 §8; D4b) — the desk goes out of focus while something is held:
// "a half-size copy of the desk frame, dual-Kawase blur 14 px (10 on a phone) + 8 % dim, scaled by the
// carry amount — rendered ONCE when the pick-up settles and reused while the desk stands still (the held
// object redraws alone)". This pass owns the targets and the fullscreen draws; ground.ts decides WHEN the
// copy is remade (its `stamp`) and draws the desk and the hand into the targets with the kinds' own passes.
//
// The pipeline, per held frame: [the desk copy, only when its stamp moved: the frame without the held
// object → `desk` (half the surface, half the dpr) → `blur(...)`: two Kawase down passes (÷2, ÷4 of the
// copy) and two up passes back into `blurred`] · the hand: the one object under the pose's camera →
// `hand` (the surface's size, cleared to 0 — premultiplied by the kinds' source-over) · the frame:
// `composite(...)` = the desk as mix(sharp, blurred, e) · (1 − dim), then the hand over it through the
// reading light. Blur once per settled desk; per held frame a full-size clear + the one object + two
// fullscreen draws.
//
// THE MIX (a ruling, D-D4b): the focus at a carry `e` is the SHARP copy cross-faded into the FULLY blurred
// one by `e`, not a re-blur at radius 14·e per e-step — the brief's cheaper honest option: one blur per
// settled desk, zero per held frame. Visually a cross-fade toward soft reads as going soft over 560 ms; the
// phone's 10 px and the desk's 14 px are the radius the ONE blur is made at.
//
// THE RADIUS: a dual-Kawase chain's spread is set by its offset and its levels, not by a σ; with two levels
// the impulse response's σ is close to 4 × the offset in the copy's texels (each level doubles the taps'
// reach), so `offset = radiusTexels / 4` — the design's "blur(14px)" read as a Gaussian of σ 14 CSS px.
// The oracle's stills pin the bytes; the number is documented, not measured to the pixel (D-D4b).

import { bindGroup, bindLayout, renderPipeline, uniformBuffer } from "../engine/pipeline";
import { compile, compose } from "../engine/shader";
import { defineStruct } from "../engine/struct";
import { beginPass, Target } from "../engine/target";
import type { HoldShaders } from "./shaders";

/** The pass's knobs: `texel` = (1/w, 1/h of the SOURCE, the Kawase offset in half-texels, 0); `mix` = (the carry e, the dim, the saturate, the brightness). */
export const HoldUniformsStruct = defineStruct("HoldUniforms", [
  ["texel", "vec4f"],
  ["mix", "vec4f"],
]);

/** The dual-Kawase chain's shape: two levels below the half-size copy; the offset per texel of radius. */
export const KAWASE = { levels: 2, offsetPerTexel: 0.25 } as const;

/** The blend that lays a premultiplied target over the frame. */
const BLEND_PREMUL: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};

export interface CompositeKnobs {
  /** The carry amount: how far toward the blurred copy the background goes. */
  readonly e: number;
  /** The dim of the desk behind (already scaled by the carry). */
  readonly dim: number;
  /** The reading light on the hand (1, 1 by day; toward .62, .82 by night as the carry rises). */
  readonly saturate: number;
  readonly brightness: number;
}

export class HoldPass {
  private readonly device: GPUDevice;
  private readonly layout: GPUBindGroupLayout;
  private readonly sampler: GPUSampler;
  private readonly down: GPURenderPipeline;
  private readonly up: GPURenderPipeline;
  private readonly deskPipe: GPURenderPipeline;
  private readonly handPipe: GPURenderPipeline;
  /** The desk's half-size copy, the Kawase levels below it, the blurred copy back at half size, the hand at full size. */
  readonly desk: Target;
  readonly blurred: Target;
  readonly hand: Target;
  private readonly levels: Target[] = [];
  /** One uniform buffer per draw the chain records (each holds its own texel size and offset). */
  private readonly knobs: GPUBuffer[] = [];
  private readonly values = HoldUniformsStruct.alloc();
  private groups: GPUBindGroup[] = [];
  /** The size the groups were built for — rebuilt when a target resized. */
  private built = "";

  private constructor(device: GPUDevice, format: GPUTextureFormat, layout: GPUBindGroupLayout, pipes: readonly [GPURenderPipeline, GPURenderPipeline, GPURenderPipeline, GPURenderPipeline]) {
    this.device = device;
    this.layout = layout;
    [this.down, this.up, this.deskPipe, this.handPipe] = pipes;
    this.sampler = device.createSampler({ label: "hold/sampler", magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
    this.desk = new Target(device, { format, label: "hold/desk" });
    this.blurred = new Target(device, { format, label: "hold/blurred" });
    this.hand = new Target(device, { format, label: "hold/hand" });
    for (let i = 0; i < KAWASE.levels; i++) this.levels.push(new Target(device, { format, label: `hold/level-${i + 1}` }));
    // the chain's draws: `levels` down, `levels` up, the desk composite, the hand composite
    for (let i = 0; i < KAWASE.levels * 2 + 2; i++) this.knobs.push(uniformBuffer(device, HoldUniformsStruct.size, `hold/knobs-${i}`));
  }

  /** The four pipelines on `format` (the surface's — every target here is that format too, so one layout serves all). */
  static async create(device: GPUDevice, format: GPUTextureFormat, src: HoldShaders): Promise<HoldPass> {
    const module = await compile(device, compose({ structs: [HoldUniformsStruct], entry: src.entry }));
    const layout = bindLayout(device, [
      { binding: 0, stages: ["fragment"], buffer: "uniform" },
      { binding: 1, stages: ["fragment"], texture: "float" },
      { binding: 2, stages: ["fragment"], texture: "float" },
      { binding: 3, stages: ["fragment"], sampler: "filtering" },
    ], "hold");
    const pl = device.createPipelineLayout({ label: "hold", bindGroupLayouts: [layout] });
    const pipes = await Promise.all([
      renderPipeline(device, { label: "hold/down", layout: pl, module, fragment: "fs_down", format }),
      renderPipeline(device, { label: "hold/up", layout: pl, module, fragment: "fs_up", format }),
      renderPipeline(device, { label: "hold/desk", layout: pl, module, fragment: "fs_desk", format }),
      renderPipeline(device, { label: "hold/hand", layout: pl, module, fragment: "fs_hand", format, blend: BLEND_PREMUL }),
    ] as const);
    return new HoldPass(device, format, layout, pipes);
  }

  /** Size the targets to the surface (device px): the copies at half, the hand at full. True when any target was remade (its contents gone). */
  fit(w: number, h: number): boolean {
    const hw = Math.max(1, Math.ceil(w / 2));
    const hh = Math.max(1, Math.ceil(h / 2));
    let changed = this.desk.resize(hw, hh);
    changed = this.blurred.resize(hw, hh) || changed;
    changed = this.hand.resize(Math.max(1, w), Math.max(1, h)) || changed;
    let lw = hw;
    let lh = hh;
    for (const l of this.levels) { lw = Math.max(1, Math.ceil(lw / 2)); lh = Math.max(1, Math.ceil(lh / 2)); changed = l.resize(lw, lh) || changed; }
    return changed;
  }

  private rebind(): void {
    const key = `${this.desk.width}x${this.desk.height}|${this.hand.width}x${this.hand.height}`;
    if (key === this.built) return;
    this.built = key;
    const g = (i: number, a: GPUTextureView, b: GPUTextureView, label: string): GPUBindGroup => bindGroup(this.device, this.layout, [this.knobs[i] as GPUBuffer, a, b, this.sampler], label);
    const groups: GPUBindGroup[] = [];
    // down: desk → level 1 → level 2 …
    let src = this.desk.view;
    for (let i = 0; i < this.levels.length; i++) { groups.push(g(i, src, src, `hold/down-${i + 1}`)); src = (this.levels[i] as Target).view; }
    // up: level N → level N−1 … → blurred
    for (let i = this.levels.length - 1; i >= 0; i--) { const from = (this.levels[i] as Target).view; groups.push(g(this.levels.length + (this.levels.length - 1 - i), from, from, `hold/up-${i + 1}`)); }
    groups.push(g(this.levels.length * 2, this.desk.view, this.blurred.view, "hold/desk"));
    groups.push(g(this.levels.length * 2 + 1, this.hand.view, this.hand.view, "hold/hand"));
    this.groups = groups;
  }

  private knob(i: number, texel: readonly [number, number, number, number], mix: readonly [number, number, number, number]): void {
    this.values.set({ texel, mix });
    this.device.queue.writeBuffer(this.knobs[i] as GPUBuffer, 0, this.values.view());
  }

  /**
   * The blur: from the desk copy through the levels and back into `blurred`, at `radiusTexels` (the radius in the copy's
   * texels: the CSS radius × dpr / 2). Recorded into `encoder` after the copy was drawn; one chain per settled desk.
   */
  blur(encoder: GPUCommandEncoder, radiusTexels: number): void {
    this.rebind();
    const offset = Math.max(0, radiusTexels) * KAWASE.offsetPerTexel;
    const draw = (i: number, into: Target, from: Target, pipe: GPURenderPipeline, label: string): void => {
      this.knob(i, [1 / from.width, 1 / from.height, offset, 0], [0, 0, 0, 0]);
      const pass = beginPass(encoder, into.view, [0, 0, 0, 0], label);
      pass.setPipeline(pipe);
      pass.setBindGroup(0, this.groups[i] as GPUBindGroup);
      pass.draw(3);
      pass.end();
    };
    let from = this.desk;
    for (let i = 0; i < this.levels.length; i++) { const into = this.levels[i] as Target; draw(i, into, from, this.down, `hold/down-${i + 1}`); from = into; }
    for (let i = this.levels.length - 1; i >= 0; i--) {
      const into = i === 0 ? this.blurred : (this.levels[i - 1] as Target);
      draw(this.levels.length + (this.levels.length - 1 - i), into, this.levels[i] as Target, this.up, `hold/up-${i + 1}`);
    }
  }

  /** The frame: the desk out of focus, then the hand over it in its light — two fullscreen draws into the open pass. */
  composite(pass: GPURenderPassEncoder, k: CompositeKnobs): void {
    this.rebind();
    const n = this.levels.length * 2;
    this.knob(n, [1 / this.desk.width, 1 / this.desk.height, 0, 0], [k.e, k.dim, 1, 1]);
    pass.setPipeline(this.deskPipe);
    pass.setBindGroup(0, this.groups[n] as GPUBindGroup);
    pass.draw(3);
    this.knob(n + 1, [1 / this.hand.width, 1 / this.hand.height, 0, 0], [k.e, k.dim, k.saturate, k.brightness]);
    pass.setPipeline(this.handPipe);
    pass.setBindGroup(0, this.groups[n + 1] as GPUBindGroup);
    pass.draw(3);
  }

  dispose(): void {
    this.desk.dispose();
    this.blurred.dispose();
    this.hand.dispose();
    for (const l of this.levels) l.dispose();
    for (const b of this.knobs) b.destroy();
  }
}
