// The magnet field: one uniform block, one source buffer, PASS 1 and PASS 2,
// and the dirty logic that decides which of them a frame pays for.
//
//   camera / sources / reach changed  →  bake (PASS 1) + draw
//   pointer / glyph / theme changed   →  draw only (PASS 2)
//   glyph = a SURFACE program         →  no bake at all: the program's own
//   (the mat, packs/mat)                 prepare (its wind pass when its clock
//                                        moved), then its one fullscreen draw
//
// The cursor is analytic inside PASS 2, so pointer motion never re-bakes.
// `prepare()` uploads and bakes; `draw()` records the glyphs into a render
// pass the ground opened — so the frames can follow in the same pass.
//
// A Field is one SLOT. `spawn()` makes a second on the same pipelines — its
// own buffers, atlas, wind target and bind groups — which is how a nav flight
// draws the departed frame's ground live beside the arriving one (ground.ts).

import { storageBuffer, uniformBuffer } from "../engine/pipeline";
import type { ShaderPart } from "../engine/shader";
import { atlasGeom, fineAlpha, fineSchedule, lod, rungCounts, type Lod, type RungCount } from "../lattice/lod";
import type { GroundTheme } from "../theme";
import { BakePass } from "./bake-pass";
import { GlyphPass } from "./glyph-pass";
import { Card, DEFAULT_FIELD_CONFIG, dressConfig, MAX_SOURCES, Uniforms, packSources, uniformValues, type FieldConfig, type FieldFrame, type FieldSource, glyphReachPx } from "./layout";
import type { GlyphProgram, InstancedGlyph, SurfaceGlyph, SurfacePass } from "./program";

/** The field's shader set: the shared modules (the portal chain, the field maths), the bake, and the glyph programs — the engine's dot, plus whatever an app registered. */
export interface FieldShaders {
  readonly modules: readonly ShaderPart[];
  readonly bake: ShaderPart;
  readonly glyphs: readonly GlyphProgram[];
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
  /** A SURFACE program drew this frame (by glyph name; the mat's); `aux` = its auxiliary pass ran too (the wind). */
  readonly surface: string | null;
  readonly aux: boolean;
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
  private pending: { l: Lod; counts: readonly [RungCount, RungCount, RungCount]; baked: boolean; n: number; w: number; h: number; fineLive: number; surface: string | null; aux: boolean } | null = null;
  private last: FieldStats = { baked: false, bakes: 0, instances: 0, fine: "off", atlasW: 0, atlasH: 0, sources: 0, k0: 0, fade: 0, surface: null, aux: false };
  /** Glyph names nothing registered, said ONCE each: a frame draws the dot instead, and never in silence. */
  private readonly unknownGlyphs = new Set<string>();

  private readonly device: GPUDevice;
  readonly bake: BakePass;
  readonly glyphs: GlyphPass;
  /** The registered SURFACE programs' slots, by glyph name (the mat's, `packs/mat` — `matPassOf(field)` reaches its plates). */
  readonly surfaces: ReadonlyMap<string, SurfacePass>;

  private constructor(device: GPUDevice, bake: BakePass, glyphs: GlyphPass, surfaces: ReadonlyMap<string, SurfacePass>) {
    this.device = device; this.bake = bake; this.glyphs = glyphs; this.surfaces = surfaces;
    this.uniformBuf = uniformBuffer(device, Uniforms.size, "field/uniforms");
    this.sourceBuf = storageBuffer(device, Card.size * MAX_SOURCES, "field/sources");
    bake.bind(this.uniformBuf, this.sourceBuf);
    glyphs.bind(this.uniformBuf, bake.atlas.view);
  }

  static async create(device: GPUDevice, format: GPUTextureFormat, shaders: FieldShaders, opts: { readableAtlas?: boolean } = {}): Promise<Field> {
    const instanced = shaders.glyphs.filter((g): g is InstancedGlyph => g.kind === "instanced");
    const surfaces = shaders.glyphs.filter((g): g is SurfaceGlyph => g.kind === "surface");
    const seen = new Set<string>();
    for (const g of shaders.glyphs) { if (seen.has(g.glyph)) throw new Error(`Field: the glyph "${g.glyph}" is registered twice`); seen.add(g.glyph); }
    const [bake, glyphs, ...passes] = await Promise.all([
      BakePass.create(device, shaders.modules, shaders.bake, { readable: opts.readableAtlas ?? false }),
      GlyphPass.create(device, format, { modules: shaders.modules, glyphs: instanced }),
      ...surfaces.map((s) => s.create(device, format, shaders.modules)),
    ]);
    return new Field(device, bake, glyphs, new Map(surfaces.map((s, i) => [s.glyph, passes[i] as SurfacePass])));
  }

  /** A second slot on the same pipelines (no compile): its own buffers, atlas, surface slots and bind groups; the assets are shared. */
  spawn(): Field {
    const f = new Field(this.device, this.bake.spawn(), this.glyphs.spawn(), new Map([...this.surfaces].map(([k, s]) => [k, s.spawn()])));
    f.config = this.config;
    return f;
  }

  /** External invalidation (a source moved without changing its numbers, etc.). */
  invalidate(): void { this.forceBake = true; }

  get stats(): FieldStats { return this.last; }

  /** Upload this frame's uniforms and sources; re-bake the atlas if anything it depends on changed. `theme` reaches a surface program's section (the mat's light). */
  prepare(encoder: GPUCommandEncoder, frame: FieldFrame, sources: readonly FieldSource[], theme: GroundTheme): void {
    // the grid dressed for the slot's LOD zoom (a portal's arrival, a flight's landing or cut) — the identity for the root at rest
    const cfg = dressConfig(this.config, frame.view.zoom, frame.lodZoom);
    const l = lod(frame.view);
    const fineLive = fineAlpha(l, frame.view.zoom, cfg.fadeIn);
    const geom = atlasGeom(frame.view, l, glyphReachPx(cfg), fineLive);
    const counts = rungCounts(frame.view, l);

    const surface = this.surfaces.get(cfg.glyph);
    if (surface !== undefined) {
      // A surface program reads no atlas: nothing is packed, nothing is baked.
      // The next glyph frame re-bakes whatever it finds.
      const aux = surface.prepare(encoder, frame, cfg, theme);
      this.forceBake = true;
      this.pending = { l, counts, baked: false, n: 0, w: this.bake.atlas.width, h: this.bake.atlas.height, fineLive, surface: cfg.glyph, aux };
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
    this.pending = { l, counts, baked: mustBake, n, w: geom.w, h: geom.h, fineLive, surface: null, aux: false };
  }

  /** Record the glyphs into an open render pass. */
  draw(pass: GPURenderPassEncoder): FieldStats {
    const p = this.pending;
    if (!p) throw new Error("Field: prepare() before draw()");
    if (p.surface !== null) {
      const s = this.surfaces.get(p.surface);
      if (s === undefined) throw new Error(`Field: no surface program "${p.surface}"`);
      s.draw(pass);
      this.last = { baked: false, bakes: this.bakes, instances: 0, fine: "off", atlasW: p.w, atlasH: p.h, sources: 0, k0: p.l.k0, fade: p.l.fade, surface: p.surface, aux: p.aux };
      return this.last;
    }
    // An unregistered glyph name draws as the engine's dot — the ground never refuses a frame — and
    // says so once per name: a canvas type naming a glyph its pack did not register used to fall
    // back in silence, and a board in the wrong grid looks like a design decision.
    const named = this.config.glyph;
    let glyph = named;
    if (!this.glyphs.has(named)) {
      if (!this.unknownGlyphs.has(named)) {
        this.unknownGlyphs.add(named);
        console.warn(`[ice] ground/field: no glyph ${JSON.stringify(named)} is registered — drawing the dot`);
      }
      glyph = "dot";
    }
    const fine = fineSchedule(p.l, p.counts, this.config.fineSchedule, p.fineLive);
    // (the dressed fade-in already decided `fineLive` in prepare; the schedule and the glyph are the config's)
    this.glyphs.record(pass, { glyph, fine, counts: p.counts });
    this.last = {
      baked: p.baked, bakes: this.bakes, instances: this.glyphs.instances, fine,
      atlasW: p.w, atlasH: p.h, sources: p.n, k0: p.l.k0, fade: p.l.fade, surface: null, aux: false,
    };
    return this.last;
  }

  dispose(): void {
    this.bake.dispose(); this.glyphs.dispose();
    for (const s of this.surfaces.values()) s.dispose();
    this.uniformBuf.destroy(); this.sourceBuf.destroy();
  }
}
