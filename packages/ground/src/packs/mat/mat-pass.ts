// The cutting mat — the third grid. Two pipelines: the WIND pass (the plate's
// silhouette animated by three sines, into a 512² r8 target) and the MAT pass
// (one fullscreen triangle: lines, grain, the gobo projected onto the desk,
// the reference's grade). `prepare()` uploads the uniforms and records the
// wind pass when the gobo time moved; `draw()` records the mat into the render
// pass the ground opened, where the frames follow.
//
// One MatPass is one SLOT: its own uniforms, wind target and bind groups. The
// pipelines, the samplers, the plates and the blue noise are shared by every
// slot spawned from the first (`spawn()` — a nav flight's outgoing slot): a
// plate uploaded through any slot is the plate every slot samples.
//
// Until a host uploads a plate the gobo reads a 1×1 white plate — a lit mat,
// never a blank — and the blue noise is a 1×1 mid-grey (one blur angle).

import { BLEND_OVER, bindGroup, bindLayout, renderPipeline, uniformBuffer } from "../../engine/pipeline";
import { compile, compose } from "../../engine/shader";
import { beginPass, Target } from "../../engine/target";
import type { FadeIn, View } from "../../lattice/lod";
import type { Presentation } from "../../nav/portal";
import { MAT_GRID } from "./theme";
import { type MatConfig, type MatFrame, MatUniforms, matUniformValues, NOISE_SIZE, PLATE_SIZE, type PlateName } from "./layout";
import { DAY_LIGHT, type MatLight } from "./night";
import type { MatShaders } from "./shaders";

const PLATE_NAMES: readonly PlateName[] = ["c", "b"];

/** What every slot shares: the pipelines, the samplers, and the assets (versioned, so a slot rebinds when a plate lands). */
interface MatShared {
  readonly windLayout: GPUBindGroupLayout;
  readonly matLayout: GPUBindGroupLayout;
  readonly windPipeline: GPURenderPipeline;
  readonly matPipeline: GPURenderPipeline;
  readonly clampSampler: GPUSampler;
  readonly repeatSampler: GPUSampler;
  readonly plates: Record<PlateName, GPUTexture>;
  noise: GPUTexture;
  readonly loaded: { c: boolean; b: boolean; noise: boolean };
  version: number;
  slots: number;
}

export class MatPass {
  readonly name = "field/mat";
  private readonly uniforms = MatUniforms.alloc(1);
  private readonly uniformBuf: GPUBuffer;
  private readonly wind: Target;
  private windGroups!: Record<PlateName, GPUBindGroup>;
  private matGroup!: GPUBindGroup;
  private bound = -1;
  private windKey = Number.NaN;
  private windRuns = 0;
  private readonly device: GPUDevice;
  private readonly shared: MatShared;

  private constructor(device: GPUDevice, shared: MatShared) {
    this.device = device; this.shared = shared;
    shared.slots += 1;
    this.uniformBuf = uniformBuffer(device, MatUniforms.size, "mat/uniforms");
    this.wind = new Target(device, { format: "r8unorm", label: "mat/wind" }, PLATE_SIZE, PLATE_SIZE);
    this.rebind();
  }

  static async create(device: GPUDevice, format: GPUTextureFormat, src: MatShaders): Promise<MatPass> {
    const windLayout = bindLayout(device, [
      { binding: 0, stages: ["fragment"], buffer: "uniform" },
      { binding: 1, stages: ["fragment"], texture: "float" },
    ], "mat/wind");
    const matLayout = bindLayout(device, [
      { binding: 0, stages: ["fragment"], buffer: "uniform" },
      { binding: 1, stages: ["fragment"], texture: "float" },
      { binding: 2, stages: ["fragment"], sampler: "filtering" },
      { binding: 3, stages: ["fragment"], texture: "float" },
      { binding: 4, stages: ["fragment"], sampler: "filtering" },
    ], "mat/mat");
    const structs = [MatUniforms];
    const [windModule, matModule] = await Promise.all([
      compile(device, compose({ structs, modules: src.modules, entry: src.wind })),
      compile(device, compose({ structs, modules: src.modules, entry: src.entry })),
    ]);
    const [windPipeline, matPipeline] = await Promise.all([
      renderPipeline(device, { label: "mat/wind", layout: device.createPipelineLayout({ bindGroupLayouts: [windLayout] }), module: windModule, format: "r8unorm" }),
      // Straight-alpha "over": alpha is 1 at rest (a plain write), less through a flight's fade and its portal clip.
      renderPipeline(device, { label: "mat/mat", layout: device.createPipelineLayout({ bindGroupLayouts: [matLayout] }), module: matModule, format, blend: BLEND_OVER }),
    ]);
    const pixel = (label: string, rgba: readonly [number, number, number, number]): GPUTexture => {
      const t = device.createTexture({ label, size: [1, 1], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      device.queue.writeTexture({ texture: t }, new Uint8Array(rgba), { bytesPerRow: 4 }, [1, 1]);
      return t;
    };
    const shared: MatShared = {
      windLayout, matLayout, windPipeline, matPipeline,
      clampSampler: device.createSampler({ label: "mat/clamp", magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" }),
      repeatSampler: device.createSampler({ label: "mat/repeat", magFilter: "linear", minFilter: "linear", addressModeU: "repeat", addressModeV: "repeat" }),
      plates: { c: pixel("mat/plate c", [255, 255, 255, 255]), b: pixel("mat/plate b", [255, 255, 255, 255]) },
      noise: pixel("mat/noise", [128, 128, 128, 255]),
      loaded: { c: false, b: false, noise: false },
      version: 0, slots: 0,
    };
    return new MatPass(device, shared);
  }

  /** A second slot on the same pipelines and plates — a nav flight's OUTGOING mat. */
  spawn(): MatPass { return new MatPass(this.device, this.shared); }

  /** Which assets a host has uploaded — stats, and the lab's boot line. Shared by every slot. */
  get loaded(): { readonly c: boolean; readonly b: boolean; readonly noise: boolean } { return this.shared.loaded; }

  private upload(label: string, bytes: Uint8Array<ArrayBuffer>, size: number): GPUTexture {
    if (bytes.byteLength !== size * size * 4) throw new Error(`${label}: expected ${size}×${size} rgba8 (${size * size * 4} bytes), got ${bytes.byteLength}`);
    const t = this.device.createTexture({ label, size: [size, size], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    this.device.queue.writeTexture({ texture: t }, bytes, { bytesPerRow: size * 4 }, [size, size]);
    return t;
  }

  /** (Re)build this slot's bind groups against the shared assets' current version. */
  private rebind(): void {
    const s = this.shared;
    if (this.bound === s.version) return;
    const windGroup = (name: PlateName) => bindGroup(this.device, s.windLayout, [this.uniformBuf, s.plates[name].createView()], `mat/wind ${name}`);
    this.windGroups = { c: windGroup("c"), b: windGroup("b") };
    this.matGroup = bindGroup(this.device, s.matLayout, [this.uniformBuf, this.wind.view, s.clampSampler, s.noise.createView(), s.repeatSampler], "mat/mat");
    this.bound = s.version;
  }

  /** A 512×512 rgba8 plate: R silhouette, G wind amp 1, B phase, A amps 2+3 (assets/gobo-*.rgba). Every slot samples it. */
  setPlate(name: PlateName, bytes: Uint8Array<ArrayBuffer>): void {
    const s = this.shared;
    s.plates[name].destroy();
    s.plates[name] = this.upload(`mat/plate ${name}`, bytes, PLATE_SIZE);
    s.loaded[name] = true;
    s.version += 1;   // every slot rebinds on its next prepare, and its wind key (which carries the version) misses
    this.rebind();
  }

  /** The 128×128 rgba8 blue-noise tile (assets/blue-noise.rgba). Every slot samples it. */
  setNoise(bytes: Uint8Array<ArrayBuffer>): void {
    const s = this.shared;
    s.noise.destroy();
    s.noise = this.upload("mat/noise", bytes, NOISE_SIZE);
    s.loaded.noise = true;
    s.version += 1;
    this.rebind();
  }

  get windPasses(): number { return this.windRuns; }

  /** Upload the uniforms (under `light` — the theme's Sun or Moon, mat/night.ts); run the wind pass if the silhouette it holds is stale. Returns whether it ran. */
  prepare(encoder: GPUCommandEncoder, view: View & { readonly dpr: number }, fadeIn: FadeIn, cfg: MatConfig, frame: MatFrame, present?: Presentation, light: MatLight = DAY_LIGHT): boolean {
    this.rebind();
    const plate = PLATE_NAMES.includes(cfg.gobo.plate) ? cfg.gobo.plate : "c";
    const strength = MAT_GRID.gobo.plates[plate].strength;
    this.uniforms.set(matUniformValues(view, fadeIn, { ...cfg, gobo: { ...cfg.gobo, plate } }, frame, strength, present, light));
    this.device.queue.writeBuffer(this.uniformBuf, 0, this.uniforms.view());
    if (cfg.gobo.opacity <= 0) return false;
    const key = frame.goboTime * 1.000001 + strength * 7.3 + PLATE_NAMES.indexOf(plate) * 1e3 + this.shared.version * 1e5;
    if (key === this.windKey) return false;
    const pass = beginPass(encoder, this.wind.view, [1, 0, 0, 1], "mat/wind");
    pass.setPipeline(this.shared.windPipeline);
    pass.setBindGroup(0, this.windGroups[plate]);
    pass.draw(3);
    pass.end();
    this.windKey = key;
    this.windRuns += 1;
    return true;
  }

  draw(pass: GPURenderPassEncoder): void {
    pass.setPipeline(this.shared.matPipeline);
    pass.setBindGroup(0, this.matGroup);
    pass.draw(3);
  }

  /** This slot's buffers; the shared plates go with the last slot standing. */
  dispose(): void {
    this.uniformBuf.destroy(); this.wind.dispose();
    const s = this.shared;
    s.slots -= 1;
    if (s.slots === 0) {
      for (const n of PLATE_NAMES) s.plates[n].destroy();
      s.noise.destroy();
    }
  }
}
