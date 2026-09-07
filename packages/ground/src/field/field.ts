// The magnet field: one uniform block, one source buffer, PASS 1 and PASS 2,
// and the dirty logic that decides which of them a frame pays for.
//
//   camera / sources / reach changed  →  bake (PASS 1) + draw
//   pointer / glyph / theme changed   →  draw only (PASS 2)
//   glyph = mat                       →  no bake at all: the wind pass when its
//                                        clock moved, then one fullscreen draw
//
// The cursor is analytic inside PASS 2, so pointer motion never re-bakes.
// `prepare()` uploads and bakes; `draw()` records the glyphs into a render
// pass the ground opened — so the frames can follow in the same pass.
//
// A Field is one SLOT. `spawn()` makes a second on the same pipelines — its
// own buffers, atlas, wind target and bind groups — which is how a nav flight
// draws the departed frame's ground live beside the arriving one (ground.ts).

import { storageBuffer, uniformBuffer } from "../engine/pipeline.ts";
import type { ShaderPart } from "../engine/shader.ts";
import { atlasGeom, fineAlpha, fineSchedule, lod, rungCounts, type Lod, type RungCount } from "../lattice/lod.ts";
import { BakePass } from "./bake-pass.ts";
import { GlyphPass, type GlyphSources } from "./glyph-pass.ts";
import { Card, DEFAULT_FIELD_CONFIG, dressConfig, MAX_SOURCES, Uniforms, packSources, uniformValues, type FieldConfig, type FieldFrame, type FieldSource, glyphReachPx } from "./layout.ts";
import { STILL_MAT_FRAME } from "../mat/layout.ts";
import { MatPass } from "../mat/mat-pass.ts";
import type { MatShaders } from "../mat/shaders.ts";
import type { MatLight } from "../mat/night.ts";

export interface FieldShaders extends GlyphSources {
  readonly bake: ShaderPart;
  readonly mat: MatShaders;
}

export interface FieldStats {
  readonly baked: boolean;
  readonly bakes: number;
  readonly instances: number;
  readonly fine: "off" | "instanced" | "fullscreen";
  readonly atlasW: number;
  readonly atlasH: number;
  readonly sources: number;
  readonly k0: number;
  readonly fade: number;
  /** The mat drew this frame (glyph "mat"); `wind` = its wind pass ran too. */
  readonly mat: boolean;
  readonly wind: boolean;
}

export class Field {
  config: FieldConfig = DEFAULT_FIELD_CONFIG;
  private readonly uniforms = Uniforms.alloc(1);
  private readonly sources = Card.alloc(MAX_SOURCES);
  private readonly uniformBuf: GPUBuffer;
  private readonly sourceBuf: GPUBuffer;
  private bakeKey = Number.NaN;
  private bakes = 0;
  private forceBake = true;
  private pending: { l: Lod; counts: readonly [RungCount, RungCount, RungCount]; baked: boolean; n: number; w: number; h: number; fineLive: number; mat: boolean; wind: boolean } | null = null;
  private last: FieldStats = { baked: false, bakes: 0, instances: 0, fine: "off", atlasW: 0, atlasH: 0, sources: 0, k0: 0, fade: 0, mat: false, wind: false };

  private readonly device: GPUDevice;
  readonly bake: BakePass;
  readonly glyphs: GlyphPass;
  readonly mat: MatPass;

  private constructor(device: GPUDevice, bake: BakePass, glyphs: GlyphPass, mat: MatPass) {
    this.device = device; this.bake = bake; this.glyphs = glyphs; this.mat = mat;
    this.uniformBuf = uniformBuffer(device, Uniforms.size, "field/uniforms");
    this.sourceBuf = storageBuffer(device, Card.size * MAX_SOURCES, "field/sources");
    bake.bind(this.uniformBuf, this.sourceBuf);
    glyphs.bind(this.uniformBuf, bake.atlas.view);
  }

  static async create(device: GPUDevice, format: GPUTextureFormat, shaders: FieldShaders, opts: { readableAtlas?: boolean } = {}): Promise<Field> {
    const [bake, glyphs, mat] = await Promise.all([
      BakePass.create(device, shaders.modules, shaders.bake, { readable: opts.readableAtlas ?? false }),
      GlyphPass.create(device, format, shaders),
      MatPass.create(device, format, shaders.mat),
    ]);
    return new Field(device, bake, glyphs, mat);
  }

  /** A second slot on the same pipelines (no compile): its own buffers, atlas, wind target and bind groups; the plates are shared. */
  spawn(): Field {
    const f = new Field(this.device, this.bake.spawn(), this.glyphs.spawn(), this.mat.spawn());
    f.config = this.config;
    return f;
  }

  /** External invalidation (a source moved without changing its numbers, etc.). */
  invalidate(): void { this.forceBake = true; }

  get stats(): FieldStats { return this.last; }

  /** Upload this frame's uniforms and sources; re-bake the atlas if anything it depends on changed. `light` is the mat's (the theme's Sun or Moon); absent = the day. */
  prepare(encoder: GPUCommandEncoder, frame: FieldFrame, sources: readonly FieldSource[], light?: MatLight): void {
    // the grid dressed for the slot's LOD zoom (a portal's arrival, a flight's landing or cut) — the identity for the root at rest
    const cfg = dressConfig(this.config, frame.view.zoom, frame.lodZoom);
    const l = lod(frame.view);
    const fineLive = fineAlpha(l, frame.view.zoom, cfg.fadeIn);
    const geom = atlasGeom(frame.view, l, glyphReachPx(cfg), fineLive);
    const counts = rungCounts(frame.view, l);

    if (cfg.glyph === "mat") {
      // The mat reads no atlas: nothing is packed, nothing is baked. The next
      // glyph frame re-bakes whatever it finds.
      const wind = this.mat.prepare(encoder, frame.view, cfg.fadeIn, cfg.mat, frame.mat ?? STILL_MAT_FRAME, frame.present, light);
      this.forceBake = true;
      this.pending = { l, counts, baked: false, n: 0, w: this.bake.atlas.width, h: this.bake.atlas.height, fineLive, mat: true, wind };
      return;
    }

    const n = packSources(sources, frame.view, cfg.reach, this.sources);
    this.uniforms.set(uniformValues(frame, cfg, n));
    this.device.queue.writeBuffer(this.uniformBuf, 0, this.uniforms.view());
    if (n > 0) this.device.queue.writeBuffer(this.sourceBuf, 0, this.sources.view(n));

    // The bake key is everything the atlas depends on: camera, atlas geometry,
    // field reach/polarity, and the packed sources themselves.
    let key = frame.view.camX * 1.000001 + frame.view.camY * 0.999983 + frame.view.zoom * 7.31 + geom.w * 1e3 + geom.h * 1e6 + geom.originI * 0.37 + geom.originJ * 0.53 + cfg.reach * 13.7 + cfg.polarity * 101 + n * 1e-3;
    const f32 = new Float32Array(this.sources.bytes, 0, n * (Card.size / 4));
    for (let i = 0; i < f32.length; i++) key = key * 1.0000019 + (f32[i] as number) * (1 + (i % 7) * 0.0137);

    const resized = this.bake.resize(geom.w, geom.h);
    if (resized) this.glyphs.bind(this.uniformBuf, this.bake.atlas.view);
    const mustBake = this.forceBake || resized || key !== this.bakeKey;
    if (mustBake) {
      this.bake.record(encoder, n);
      this.bakeKey = key;
      this.forceBake = false;
      this.bakes += 1;
    }
    this.pending = { l, counts, baked: mustBake, n, w: geom.w, h: geom.h, fineLive, mat: false, wind: false };
  }

  /** Record the glyphs into an open render pass. */
  draw(pass: GPURenderPassEncoder): FieldStats {
    const p = this.pending;
    if (!p) throw new Error("Field: prepare() before draw()");
    if (p.mat) {
      this.mat.draw(pass);
      this.last = { baked: false, bakes: this.bakes, instances: 0, fine: "off", atlasW: p.w, atlasH: p.h, sources: 0, k0: p.l.k0, fade: p.l.fade, mat: true, wind: p.wind };
      return this.last;
    }
    const glyph = this.config.glyph === "needle" ? "needle" : "dot";
    const fine = fineSchedule(p.l, p.counts, this.config.fineSchedule, p.fineLive);
    // (the dressed fade-in already decided `fineLive` in prepare; the schedule and the glyph are the config's)
    this.glyphs.record(pass, { glyph, fine, counts: p.counts });
    this.last = {
      baked: p.baked, bakes: this.bakes, instances: this.glyphs.instances, fine,
      atlasW: p.w, atlasH: p.h, sources: p.n, k0: p.l.k0, fade: p.l.fade, mat: false, wind: false,
    };
    return this.last;
  }

  dispose(): void {
    this.bake.dispose(); this.glyphs.dispose(); this.mat.dispose();
    this.uniformBuf.destroy(); this.sourceBuf.destroy();
  }
}
