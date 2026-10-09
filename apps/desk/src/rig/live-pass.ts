// THE RIG LIVE KIND'S PASS (M24 LT1 — `rig.html?live` alone, never a public kind): a LIT SHEET showing its object's live face. Its
// records live in a persistent store (a sheet keeps its slot and is written only when its record changed — an arrival writes nothing);
// at each prepare the pass tells the kind's SIGHT what this slot drew (`Sight.saw`, the face's rect in world units → device px through
// the slot's view), makes the face's mips as deep as this slot reads them INTO the frame's encoder (`liveDepth` → `LiveTexture.prepare`,
// once per revision whatever the slots), and binds the face's view (rebound when its EPOCH moves) — or its film before the first frame.
// The sheet is lit as the mat is: the lamp's dapple through the slot's gobo (a mini mat's inside by its host's lamp — `LIT_ELSEWHERE`),
// the day's chain on the face's sRGB, the night's on its linear. Its WGSL asks the kit for `mat` — the light piece by the mat's name.

import { createRecordStore, type KindExtra, type KindPass, type RecordStore, type SlotContext } from "@ice/desk";
import { bindGroup, bindLayout, compile, compose, defineStruct, renderPipeline } from "@ice/desk/engine";
import { kitWgsl, type LiveFace, type LiveTexture, liveDepth, litByOwn, type MatPass, type Sight } from "@ice/desk/kit";
import type { Entity } from "@ice/core";

/** A sheet's GPU record: its centre and half extents as drawn (world units) and its presence (a delete ghost fades). */
export const RigSheet = defineStruct("RigSheet", [
  ["centre", "vec2f"],
  ["half", "vec2f"],
  ["alpha", "f32"],
] as const);

/** The most sheets one slot's pass draws. */
const MAX_SHEETS = 256;

/** One sheet for the pass: its object, its rect as drawn, its face (stable for the object's life: its texture is read at each prepare), the sight it tells. */
export interface RigSheetRecord {
  readonly e: Entity;
  readonly cx: number;
  readonly cy: number;
  readonly w: number;
  readonly h: number;
  readonly alpha: number;
  readonly face: LiveFace | undefined;
  readonly sight: Sight | undefined;
}

/** The film a sheet shows before its face has a frame (sRGB): a dark grey. */
export const RIG_FILM = [34, 36, 40] as const;

const SHEET_WGSL = /* wgsl */ `
override LIT_ELSEWHERE: bool = false;

@group(0) @binding(0) var<uniform> u: MatUniforms;
@group(0) @binding(1) var<storage, read> sheets: array<RigSheet>;
@group(0) @binding(2) var gobo_tex: texture_2d<f32>;
@group(0) @binding(3) var gobo_samp: sampler;
@group(0) @binding(4) var noise_tex: texture_2d<f32>;
@group(0) @binding(5) var noise_samp: sampler;
@group(0) @binding(6) var<storage, read> order: array<u32>;
@group(1) @binding(0) var face_tex: texture_2d<f32>;
@group(1) @binding(1) var face_samp: sampler;

struct VSOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) idx: u32,
}

const CORNERS = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

@vertex fn vs(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VSOut {
  var out: VSOut;
  out.clip = vec4f(2.0, 2.0, 2.0, 1.0);   // degenerate: a culled sheet collapses
  let slot = order[iid];
  out.idx = slot;
  let S = sheets[slot];
  let zoom = mat_zoom(u);
  let lo = (S.centre - S.half - u.cam.xy) * zoom;   // CSS px
  let hi = (S.centre + S.half - u.cam.xy) * zoom;
  if (hi.x < u.box.x || hi.y < u.box.y || lo.x > u.box.x + u.box.z || lo.y > u.box.y + u.box.w) { return out; }
  let c = CORNERS[vid] * 0.5 + 0.5;
  let pos = mix(lo, hi, c);
  out.clip = vec4f(pos.x / u.view.x * 2.0 - 1.0, 1.0 - pos.y / u.view.y * 2.0, 0.0, 1.0);
  out.uv = c;
  return out;
}

@fragment fn fs(in: VSOut) -> @location(0) vec4f {
  let face = textureSample(face_tex, face_samp, in.uv);   // first, in uniform flow: the face's -srgb texels read LINEAR
  let S = sheets[in.idx];
  let dpr = mat_dpr(u);
  let p = in.clip.xy / (mat_zoom(u) * dpr) + u.cam.xy;   // device px → world
  let bn = textureSampleLevel(noise_tex, noise_samp, in.clip.xy * u.noise.z + u.noise.xy, 0.0).rgb;
  var gobo = sample_gobo(u, gobo_tex, gobo_samp, desk_of(u, p), bn.z);
  if (LIT_ELSEWHERE) { gobo = lit_gobo(u, gobo_tex, gobo_samp, p, 0.0, desk_of(u, p), bn.z); }
  var colour = shade_mat(u, night_encode(face.rgb), gobo);
  if (u.night.x > 0.0) { colour = mix(colour, night_mat(u, face.rgb, gobo, bn.y), u.night.x); }
  let a = S.alpha;
  return vec4f(clamp(colour, vec3f(0.0), vec3f(1.0)) * a, a) * (u.view.w * portal_cover(in.clip.xy / dpr, u.portals, u.clips, dpr));
}
`;

const BLEND_PREMUL: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};

interface Shared {
  readonly device: GPUDevice;
  readonly layout: GPUBindGroupLayout;
  readonly faceLayout: GPUBindGroupLayout;
  readonly pipeline: GPURenderPipeline;
  readonly litPipeline: GPURenderPipeline;
  readonly goboSampler: GPUSampler;
  readonly noiseSampler: GPUSampler;
  readonly faceSampler: GPUSampler;
  readonly film: GPUTexture;
  readonly filmGroup: GPUBindGroup;
  /** Each face texture's group, made again when its epoch moves (a new texture). */
  readonly groups: WeakMap<LiveTexture, { readonly epoch: number; readonly group: GPUBindGroup }>;
  slots: number;
}

export class RigLivePass implements KindPass<RigSheetRecord> {
  private readonly shared: Shared;
  private readonly mat: MatPass;
  private readonly store: RecordStore<RigSheetRecord>;
  private group!: GPUBindGroup;
  private boundAssets = -1;
  private boundStore = -1;
  private count = 0;
  private litElsewhere = false;
  /** The face group of each paint index this frame. */
  private faces: GPUBindGroup[] = [];

  private constructor(shared: Shared, mat: MatPass) {
    this.shared = shared;
    this.mat = mat;
    shared.slots += 1;
    this.store = createRecordStore<RigSheetRecord, keyof typeof RigSheet.slots>({
      device: shared.device, def: RigSheet, capacity: 8, max: MAX_SHEETS, label: "rig-live/sheets",
      pack: (r, _aux, into, slot) => { into.set({ centre: [r.cx, r.cy], half: [r.w / 2, r.h / 2], alpha: r.alpha }, slot); return 0; },
    });
    this.rebind();
  }

  static async create(device: GPUDevice, format: GPUTextureFormat, mat: MatPass): Promise<RigLivePass> {
    const layout = bindLayout(device, [
      { binding: 0, stages: ["vertex", "fragment"], buffer: "uniform" },
      { binding: 1, stages: ["vertex", "fragment"], buffer: "read-only-storage" },
      { binding: 2, stages: ["fragment"], texture: "float" },
      { binding: 3, stages: ["fragment"], sampler: "filtering" },
      { binding: 4, stages: ["fragment"], texture: "float" },
      { binding: 5, stages: ["fragment"], sampler: "filtering" },
      { binding: 6, stages: ["vertex"], buffer: "read-only-storage" },
    ], "rig-live/sheets");
    const faceLayout = bindLayout(device, [
      { binding: 0, stages: ["fragment"], texture: "float" },
      { binding: 1, stages: ["fragment"], sampler: "filtering" },
    ], "rig-live/face");
    const module = await compile(device, compose(kitWgsl(["view", "portal", "mat"], { structs: [RigSheet], entry: { label: "rig-live/sheet.wgsl", text: SHEET_WGSL } })));
    const pl = device.createPipelineLayout({ bindGroupLayouts: [layout, faceLayout] });
    const [pipeline, litPipeline] = await Promise.all([
      renderPipeline(device, { label: "rig-live/sheets", layout: pl, module, format, blend: BLEND_PREMUL }),
      renderPipeline(device, { label: "rig-live/sheets, lit from elsewhere", layout: pl, module, format, blend: BLEND_PREMUL, constants: { LIT_ELSEWHERE: 1 } }),
    ]);
    const faceSampler = device.createSampler({ label: "rig-live/face", magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
    const film = device.createTexture({ label: "rig-live/film", size: [1, 1], format: "rgba8unorm-srgb", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: film }, new Uint8Array([...RIG_FILM, 255]), { bytesPerRow: 4 }, [1, 1]);
    const shared: Shared = {
      device, layout, faceLayout, pipeline, litPipeline, faceSampler, film,
      goboSampler: device.createSampler({ label: "rig-live/gobo", magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" }),
      noiseSampler: device.createSampler({ label: "rig-live/noise", magFilter: "linear", minFilter: "linear", addressModeU: "repeat", addressModeV: "repeat" }),
      filmGroup: bindGroup(device, faceLayout, [film.createView(), faceSampler], "rig-live/film"),
      groups: new WeakMap(), slots: 0,
    };
    return new RigLivePass(shared, mat);
  }

  spawn(mat: MatPass): RigLivePass { return new RigLivePass(this.shared, mat); }

  private rebind(): void {
    if (this.boundAssets === this.mat.assetVersion && this.boundStore === this.store.version) return;
    const s = this.shared;
    this.group = bindGroup(s.device, s.layout, [this.mat.view, this.store.records, this.mat.silhouette, s.goboSampler, this.mat.noiseTexture.createView(), s.noiseSampler, this.store.order], "rig-live/sheets");
    this.boundAssets = this.mat.assetVersion;
    this.boundStore = this.store.version;
  }

  /** A face texture's group — made once per epoch (a resize makes a new texture: the old group would bind a destroyed one). */
  private faceGroup(t: LiveTexture): GPUBindGroup {
    const had = this.shared.groups.get(t);
    if (had !== undefined && had.epoch === t.epoch) return had.group;
    const group = bindGroup(this.shared.device, this.shared.faceLayout, [t.view(), this.shared.faceSampler], "rig-live/face");
    this.shared.groups.set(t, { epoch: t.epoch, group });
    return group;
  }

  prepare(encoder: GPUCommandEncoder, slot: SlotContext, records: readonly RigSheetRecord[], extra?: KindExtra): number {
    const list = records.length > MAX_SHEETS ? records.slice(0, MAX_SHEETS) : records;
    const keys = extra?.keys;
    this.count = this.store.prepare(list, keys !== undefined && keys.length > MAX_SHEETS ? keys.slice(0, MAX_SHEETS) : keys);
    this.rebind();
    this.litElsewhere = !litByOwn(slot.view, slot.lit);
    const k = slot.view.zoom * slot.view.dpr;
    this.faces = list.map((r) => {
      r.sight?.saw(r.e, slot, { cx: r.cx, cy: r.cy, w: r.w, h: r.h });
      const t = r.face?.texture();
      if (t === undefined) return this.shared.filmGroup;
      t.prepare(encoder, liveDepth(t, [r.w * k, r.h * k]));
      return this.faceGroup(t);
    });
    return this.count;
  }

  records() { return this.store.stats(); }

  drawRange(pass: GPURenderPassEncoder, first: number, end: number): void {
    const hi = Math.min(end, this.count);
    if (first >= hi) return;
    pass.setPipeline(this.litElsewhere ? this.shared.litPipeline : this.shared.pipeline);
    pass.setBindGroup(0, this.group);
    for (let i = first; i < hi; i++) {
      pass.setBindGroup(1, this.faces[i] as GPUBindGroup);
      pass.draw(6, 1, 0, i);
    }
  }

  dispose(): void {
    this.store.dispose();
    this.shared.slots -= 1;
    if (this.shared.slots === 0) this.shared.film.destroy();   // the film goes with the last slot standing
  }
}
