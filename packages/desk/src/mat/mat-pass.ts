// The cutting mat — the ground's one grid (the dot and the needle retired on
// 2026-09-25). Two pipelines: the WIND pass (the plate's silhouette animated by
// three sines, into a 512² r8 target) and the MAT pass (one fullscreen
// triangle: lines, grain, the gobo projected onto the desk, the reference's
// grade). `prepare()` uploads the uniforms and records the wind pass when the
// gobo time moved; `draw()` records the mat into the render pass the ground
// opened. The ground uses `drawSurface()` before objects and `drawRulers()`
// after them; both share the same pipeline and shade disjoint regions.
//
// One CuttingMat is one SLOT: its own uniforms and bind groups. The pipelines,
// the samplers, the plates, the blue noise and the WIND TARGETS are shared by
// every slot spawned from the first (`spawn()` — a flight's departed slot, a mini
// mat's inside): a plate uploaded through any slot is the plate every slot
// samples. Since K4a (design-016 K-L3) the slot's uniforms are its ONE VIEW BLOCK
// (`view`): every kind drawn in the slot binds that buffer, and none writes a
// copy; and one wind target per plate serves every slot — the wind reads only
// the clock, the plate's strength and the plate, so a slot whose key another
// slot drew this frame samples that silhouette and draws none (a second key on
// the same plate in one frame — a host clocking two slots apart — draws into the
// slot's own target instead, so no slot ever samples another's clock).
//
// Until a host uploads a plate the gobo reads a 1×1 white plate — a lit mat,
// never a blank — and the blue noise is a 1×1 mid-grey (one blur angle).
//
// SOFT LIGHT (petition I56; mat/soft.ts): a wind target is a texture of FOUR levels (512 … 64). The wind pass draws level
// 0, as it always did. Under the cone that is all a slot reads and all it is handed: `silhouette` is a view of level 0
// alone, so nothing can sample a level nobody drew. Under `gobo.model: "soft"` the slot's `silhouette` is the whole chain,
// and levels 1–3 are drawn after the wind pass whenever the silhouette is newer than them — three small passes, only
// while the wind blows. Soft light is drawn only by the SOFT LIGHT'S TEXT (shaders.ts `setLightText`): a mat compiled
// from the cone's text draws the cone whatever its config asks, and says so once.

import { BLEND_OVER, bindGroup, bindLayout, renderPipeline, uniformBuffer } from "../engine/pipeline";
import { compile, compose } from "../engine/shader";
import { beginPass } from "../engine/target";
import { mipsInto } from "../kit/mips";
import type { FadeIn, View } from "../lattice/lod";
import type { Presentation } from "../nav/portal";
import { MAT_GRID } from "../theme";
import { type GlyphAtlasMeta, GLYPHS, type MatConfig, type MatFrame, MatUniforms, matUniformValues, NO_GLYPHS, NOISE_SIZE, PLATE_SIZE, type PlateName, RULER_GLYPHS, type SlotLight } from "./layout";
import { DAY_LIGHT, type MatLight } from "./night";
import type { MatPass } from "../kit/view";
import type { MatShaders } from "./shaders";
import { type MatRegion, type RulerRegions, rulerRegions } from "./ruler-regions";

const PLATE_NAMES: readonly PlateName[] = ["c", "b"];
/** A wind target's levels: the silhouette, and the three under it that soft light's disc reads (mat.wgsl `soft_layer`). */
const WIND_LEVELS = 4;

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
  /** The rulers' glyph atlas (RULER.md) and what the pass knows about it; a 1×1 empty cell until a host uploads one. */
  glyphs: GPUTexture;
  glyphMeta: GlyphAtlasMeta;
  readonly loaded: { c: boolean; b: boolean; noise: boolean; glyphs: boolean };
  version: number;
  slots: number;
  /** The wind targets, one per plate, made on first use: every slot at a plate's key samples the one silhouette (K4a). */
  readonly winds: Partial<Record<PlateName, Wind>>;
  /** The frame `newFrame` counts (the ground's `prepareFrame`, once a frame) — what tells a key drawn THIS frame from a stale one. */
  frame: number;
  /** Was the mat compiled from the soft light's text (it defines `soft_gobo`)? Only then can a slot draw `model: "soft"`. */
  readonly softText: boolean;
  /** Said once each: a config asked for soft light, a light for a contrast or `fromDay`, of a mat on the cone's text. */
  warned: { model: boolean; night: boolean };
}

/**
 * A wind target and what it holds: the key its silhouette (level 0) was drawn at (NaN: never), the frame that drew it, and the
 * key its chain (levels 1–3) was drawn from (NaN: never) — the chain is made only for a slot under soft light.
 */
interface Wind { readonly texture: GPUTexture; readonly level0: GPUTextureView; readonly chain: GPUTextureView; key: number; frame: number; mips: number }

function makeWind(device: GPUDevice, label: string): Wind {
  const texture = device.createTexture({ label, size: [PLATE_SIZE, PLATE_SIZE], mipLevelCount: WIND_LEVELS, format: "r8unorm", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
  return { texture, level0: texture.createView({ label: `${label} level 0`, baseMipLevel: 0, mipLevelCount: 1 }), chain: texture.createView({ label: `${label} chain` }), key: Number.NaN, frame: -1, mips: Number.NaN };
}

export class CuttingMat implements MatPass {
  readonly name = "mat/mat";
  private readonly uniforms = MatUniforms.alloc(1);
  private readonly uniformBuf: GPUBuffer;
  /** The wind target this slot samples: its plate's shared one, or its own (`own`) after a clash in one frame. */
  private wind: Wind;
  /** This slot's own wind target, made only when two keys meet on one plate in one frame. */
  private own: Wind | null = null;
  private windGroups!: Record<PlateName, GPUBindGroup>;
  private matGroup!: GPUBindGroup;
  private bound = -1;
  private boundWind: Wind | null = null;
  /** Is this slot under soft light (`gobo.model`)? What `silhouette` hands: the chain, or level 0 alone. */
  private soft = false;
  private boundSoft = false;
  private chainRuns = 0;
  /** Turns over whenever this slot's bind groups are made again — a shared asset landed, or the slot samples another silhouette. */
  private assets = 0;
  private windRuns = 0;
  /** The view block as last uploaded (K7a: uploaded only when its bytes moved; a layered kind compares a layer's view by it). */
  private readonly sentView = new Uint8Array(MatUniforms.size);
  private viewSent = false;
  private ruler: RulerRegions | null = null;
  private readonly device: GPUDevice;
  private readonly shared: MatShared;

  private constructor(device: GPUDevice, shared: MatShared) {
    this.device = device; this.shared = shared;
    shared.slots += 1;
    this.uniformBuf = uniformBuffer(device, MatUniforms.size, "mat/uniforms");
    this.wind = this.windOf("c");
    this.rebind();
  }

  static async create(device: GPUDevice, format: GPUTextureFormat, src: MatShaders): Promise<CuttingMat> {
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
      { binding: 5, stages: ["fragment"], texture: "float" },
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
    const empty = (label: string): GPUTexture => {
      const t = device.createTexture({ label, size: [1, 1], format: "r8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      device.queue.writeTexture({ texture: t }, new Uint8Array([0]), { bytesPerRow: 1 }, [1, 1]);
      return t;
    };
    const shared: MatShared = {
      windLayout, matLayout, windPipeline, matPipeline,
      clampSampler: device.createSampler({ label: "mat/clamp", magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" }),
      repeatSampler: device.createSampler({ label: "mat/repeat", magFilter: "linear", minFilter: "linear", addressModeU: "repeat", addressModeV: "repeat" }),
      plates: { c: pixel("mat/plate c", [255, 255, 255, 255]), b: pixel("mat/plate b", [255, 255, 255, 255]) },
      noise: pixel("mat/noise", [128, 128, 128, 255]),
      glyphs: empty("mat/glyphs"), glyphMeta: NO_GLYPHS,
      loaded: { c: false, b: false, noise: false, glyphs: false },
      version: 0, slots: 0, winds: {}, frame: 0,
      softText: src.modules.some((m) => m.text.includes("\nfn soft_gobo(")), warned: { model: false, night: false },
    };
    return new CuttingMat(device, shared);
  }

  /** A second slot on the same pipelines and plates — a flight's departed mat, a mini mat's inside. */
  spawn(): CuttingMat { return new CuttingMat(this.device, this.shared); }

  /** Which assets a host has uploaded — stats, and the lab's boot line. Shared by every slot. */
  get loaded(): { readonly c: boolean; readonly b: boolean; readonly noise: boolean; readonly glyphs: boolean } { return this.shared.loaded; }
  /** What the pass knows about the glyph atlas it samples (RULER.md). */
  get glyphs(): GlyphAtlasMeta { return this.shared.glyphMeta; }
  /**
   * This slot's animated silhouette — the wind target the mat samples; the paper pass (STICKY.md) samples the same, so a note takes
   * the mat's dapple. A view of level 0 alone under the cone; under soft light the whole chain, its lower levels drawn (I56).
   */
  get silhouette(): GPUTextureView { return this.soft ? this.wind.chain : this.wind.level0; }
  /** The slot's ONE VIEW BLOCK (K4a, design-016 K-L3): the uniforms this mat writes once a frame, which every kind in the slot binds. */
  get view(): GPUBuffer { return this.uniformBuf; }
  /** The glyph atlas as uploaded (a 1×1 empty cell until a host uploads one) — the mini mat pass prints with it. */
  get glyphTexture(): GPUTexture { return this.shared.glyphs; }
  /** The shared blue noise, as uploaded (a 1×1 grey until a host uploads the tile). */
  get noiseTexture(): GPUTexture { return this.shared.noise; }
  /** Bumped whenever a shared asset lands or the slot samples another silhouette — a pass that binds them rebinds on a change. */
  get assetVersion(): number { return this.assets; }
  get viewBytes(): Uint8Array { return this.sentView; }
  get silhouetteKey(): number { return this.wind.key; }

  /** A new frame (the ground's `prepareFrame`, before its slots prepare): a wind key drawn before it may be drawn over. */
  newFrame(): void { this.shared.frame += 1; }

  /** A plate's shared wind target, made on first use. */
  private windOf(plate: PlateName): Wind {
    const s = this.shared;
    const made = s.winds[plate];
    if (made) return made;
    const w = makeWind(this.device, `mat/wind ${plate}`);
    s.winds[plate] = w;
    return w;
  }

  private upload(label: string, bytes: Uint8Array<ArrayBuffer>, size: number): GPUTexture {
    if (bytes.byteLength !== size * size * 4) throw new Error(`${label}: expected ${size}×${size} rgba8 (${size * size * 4} bytes), got ${bytes.byteLength}`);
    const t = this.device.createTexture({ label, size: [size, size], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    this.device.queue.writeTexture({ texture: t }, bytes, { bytesPerRow: size * 4 }, [size, size]);
    return t;
  }

  /** (Re)build this slot's bind groups against the shared assets' current version. */
  private rebind(): void {
    const s = this.shared;
    if (this.bound === s.version && this.boundWind === this.wind && this.boundSoft === this.soft) return;
    if (this.bound !== s.version) {
      const windGroup = (name: PlateName) => bindGroup(this.device, s.windLayout, [this.uniformBuf, s.plates[name].createView()], `mat/wind ${name}`);
      this.windGroups = { c: windGroup("c"), b: windGroup("b") };
    }
    this.matGroup = bindGroup(this.device, s.matLayout, [this.uniformBuf, this.silhouette, s.clampSampler, s.noise.createView(), s.repeatSampler, s.glyphs.createView()], "mat/mat");
    this.bound = s.version;
    this.boundWind = this.wind;
    this.boundSoft = this.soft;
    this.assets += 1;
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

  /**
   * The glyph atlas (RULER.md): r8 coverage, `meta.width × meta.height` texels, the
   * first `meta.count` glyphs of `GLYPHS` in a row of `meta.cellW` cells — at least the
   * rulers' twelve; the capitals after them print a mini mat's name (MINIMAT.md §2).
   * Every slot samples it (the mini mat pass too); a host re-uploads when the device's
   * ratio or the text size changes.
   */
  setGlyphs(bytes: Uint8Array<ArrayBuffer>, meta: GlyphAtlasMeta): void {
    if (bytes.byteLength !== meta.width * meta.height) throw new Error(`mat/glyphs: expected ${meta.width}×${meta.height} r8 (${meta.width * meta.height} bytes), got ${bytes.byteLength}`);
    if (meta.count < RULER_GLYPHS || meta.count > GLYPHS.length || meta.cellW * meta.count > meta.width || meta.cellH > meta.height) throw new Error(`mat/glyphs: ${meta.count} cells of ${meta.cellW}×${meta.cellH} do not fit ${meta.width}×${meta.height} (${RULER_GLYPHS}–${GLYPHS.length} glyphs expected)`);
    const s = this.shared;
    s.glyphs.destroy();
    const t = this.device.createTexture({ label: "mat/glyphs", size: [meta.width, meta.height], format: "r8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    this.device.queue.writeTexture({ texture: t }, bytes, { bytesPerRow: meta.width }, [meta.width, meta.height]);
    s.glyphs = t; s.glyphMeta = meta; s.loaded.glyphs = true;
    s.version += 1;
    this.rebind();
  }

  get windPasses(): number { return this.windRuns; }
  /** How many times this slot drew a silhouette's chain (levels 1–3) — never under the cone. */
  get chainPasses(): number { return this.chainRuns; }

  /**
   * Upload the uniforms (under `light` — the theme's Sun or Moon, mat/night.ts — through the lamp `lit`
   * says: the slot's own when absent, the host desk's for a mini mat's inside, MINIMAT.md §4); run the
   * wind pass if the silhouette it holds is stale. Returns whether it ran.
   */
  prepare(encoder: GPUCommandEncoder, view: View & { readonly dpr: number }, fadeIn: FadeIn, cfg: MatConfig, frame: MatFrame, present?: Presentation, light: MatLight = DAY_LIGHT, lit?: SlotLight): boolean {
    this.ruler = cfg.ruler.on ? rulerRegions(view, cfg.ruler, this.ruler) : null;
    const plate = PLATE_NAMES.includes(cfg.gobo.plate) ? cfg.gobo.plate : "c";
    // the wind's strength: the slot's own when its config states one (I56), else the theme's for its plate
    const strength = cfg.gobo.strength ?? MAT_GRID.gobo.plates[plate].strength;
    // soft light reads the silhouette's chain; the cone, level 0 alone (the slot rebinds when its model changes). The cone's
    // text can draw neither soft light nor the night's two numbers: the block then says the cone, so the mat and every kind
    // agree, and the host is told once of each
    const asked = cfg.gobo.model === "soft";
    this.soft = asked && this.shared.softText;
    if (!this.shared.softText) {
      const said = this.shared.warned;
      const fix = `needs the soft light's text: call setLightText("soft") before the first desk mounts (shaders.ts)`;
      if (asked && !said.model) { said.model = true; console.warn(`[ice] desk: gobo.model "soft" ${fix}. The cone is drawn`); }
      if (!said.night && ((light.contrast ?? 1) !== 1 || (light.fromDay ?? 0) !== 0)) { said.night = true; console.warn(`[ice] desk: a night's contrast or fromDay ${fix}. The night is drawn without them`); }
    }
    this.uniforms.set(matUniformValues(view, fadeIn, { ...cfg, gobo: { ...cfg.gobo, plate, model: this.soft ? "soft" : "cone" } }, frame, strength, present, light, this.shared.glyphMeta, lit));
    const bytes = this.uniforms.view();
    let same = this.viewSent;
    for (let i = 0; same && i < bytes.byteLength; i++) same = bytes[i] === this.sentView[i];
    if (!same) {
      this.device.queue.writeBuffer(this.uniformBuf, 0, bytes);
      this.sentView.set(bytes);
      this.viewSent = true;
    }
    // a gobo at opacity 0 never consults its silhouette (mat.wgsl `sample_gobo`): the slot keeps the target it has, drawing none
    if (cfg.gobo.opacity <= 0) { this.rebind(); return false; }
    const key = frame.goboTime * 1.000001 + strength * 7.3 + PLATE_NAMES.indexOf(plate) * 1e3 + this.shared.version * 1e5;
    // the plate's shared target when it holds this key, or is free to take it (drawn in an earlier frame); else — another slot drew
    // another key on this plate THIS frame — the slot's own
    const common = this.windOf(plate);
    let w = common;
    if (common.key !== key && common.frame === this.shared.frame) {
      this.own ??= makeWind(this.device, "mat/wind own");
      w = this.own;
    }
    this.wind = w;
    this.rebind();
    let ran = false;
    if (w.key !== key) {
      const pass = beginPass(encoder, w.level0, [1, 0, 0, 1], "mat/wind");
      pass.setPipeline(this.shared.windPipeline);
      pass.setBindGroup(0, this.windGroups[plate]);
      pass.draw(3);
      pass.end();
      w.key = key;
      w.frame = this.shared.frame;
      this.windRuns += 1;
      ran = true;
    }
    // soft light's disc reads the levels under the silhouette: drawn when it is newer than they are — after a wind pass, or
    // the first time a slot under soft light meets a silhouette the cone drew
    if (this.soft && w.mips !== w.key) {
      mipsInto(this.device, encoder, w.texture, 1, WIND_LEVELS - 1);
      w.mips = w.key;
      this.chainRuns += 1;
    }
    return ran;
  }

  draw(pass: GPURenderPassEncoder): void {
    pass.setPipeline(this.shared.matPipeline);
    pass.setBindGroup(0, this.matGroup);
    pass.draw(3);
  }

  /** The mat beneath objects; enabled ruler strips are reserved for the foreground. */
  drawSurface(pass: GPURenderPassEncoder, clip: MatRegion): void {
    if (!this.ruler) { this.draw(pass); return; }
    this.drawRegions(pass, this.ruler.surface, clip);
  }

  /** The edge bands and frame above every object in this slot, within its portal. */
  drawRulers(pass: GPURenderPassEncoder, clip: MatRegion): void {
    if (this.ruler) this.drawRegions(pass, this.ruler.edges, clip);
  }

  private drawRegions(pass: GPURenderPassEncoder, regions: readonly MatRegion[], clip: MatRegion): void {
    const [cx, cy, cw, ch] = clip;
    let bound = false;
    for (const [rx, ry, rw, rh] of regions) {
      const x = Math.max(cx, rx);
      const y = Math.max(cy, ry);
      const right = Math.min(cx + cw, rx + rw);
      const bottom = Math.min(cy + ch, ry + rh);
      if (right <= x || bottom <= y) continue;
      if (!bound) {
        pass.setPipeline(this.shared.matPipeline);
        pass.setBindGroup(0, this.matGroup);
        bound = true;
      }
      pass.setScissorRect(x, y, right - x, bottom - y);
      pass.draw(3);
    }
    if (bound) pass.setScissorRect(cx, cy, cw, ch);
  }

  /** This slot's buffers; the shared plates go with the last slot standing. */
  dispose(): void {
    this.uniformBuf.destroy(); this.own?.texture.destroy();
    const s = this.shared;
    s.slots -= 1;
    if (s.slots === 0) {
      for (const n of PLATE_NAMES) { s.plates[n].destroy(); s.winds[n]?.texture.destroy(); }
      s.noise.destroy(); s.glyphs.destroy();
    }
  }
}
