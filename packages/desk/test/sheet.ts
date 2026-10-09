// A TINY LIVE KIND of the desk's own tests (M24 LT1 — design-019 §9's witness): a flat sheet that shows its face — opened on the
// `LIVE` source its desk lends by the object's DURABLE key (`KindHost.keyOf`), taken once at its open (what the source already holds
// lands in the frame that opens it: a still's committed bytes), sampled through a trilinear sampler with its mips made as deep as it is
// read (`liveDepth` → `LiveTexture.prepare`, into the frame's encoder). No light, no shadow: a still of it shows the face's own pixels,
// sRGB in and sRGB out, and a face with no frame its film (a dark grey). Never a public kind.

import type { Entity, WidgetType } from "@ice/core";
import { bindGroup, bindLayout, renderPipeline } from "../src/engine/pipeline";
import { compile, compose } from "../src/engine/shader";
import type { KindPass, SlotContext } from "../src/kind";
import type { KindHost, KindLocal, ObjectKind, ObjectRect } from "../src/kinds/world";
import { LIVE, type LiveFace, liveDepth } from "../src/kit/live";
import type { MatPass } from "../src/kit/view";
import { kitWgsl } from "../src/kit/wgsl";
import { defineObject } from "../src/object";

export const SHEET_TYPE = "test.sheet";
export const SHEET_KIND = "sheet";
/** The film a sheet shows before its face has a frame (sRGB). */
export const SHEET_FILM = [24, 24, 24] as const;

/** A sheet as its pass draws it: the object, its rect (world units, centred) and its face. */
export interface SheetRecord {
  readonly e: Entity;
  readonly rect: ObjectRect;
  readonly face: LiveFace | undefined;
}

export interface SheetLocal extends KindLocal {
  /** The object's face — opened (and taken once) the first time it is asked; undefined with no source or no durable key. */
  face(e: Entity): LiveFace | undefined;
}

const SHEET_WGSL = /* wgsl */ `
@group(0) @binding(0) var<uniform> u: MatUniforms;
@group(1) @binding(0) var face: texture_2d<f32>;
@group(1) @binding(1) var face_samp: sampler;
@group(1) @binding(2) var<uniform> sheet: vec4f;   // its centre and half extents, world units

struct VSOut { @builtin(position) clip: vec4f, @location(0) uv: vec2f }

const CORNERS = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

@vertex fn vs(@builtin(vertex_index) vid: u32) -> VSOut {
  let c = CORNERS[vid];
  let pos = (sheet.xy + c * sheet.zw - u.cam.xy) * mat_zoom(u);   // CSS px
  var out: VSOut;
  out.clip = vec4f(pos.x / u.view.x * 2.0 - 1.0, 1.0 - pos.y / u.view.y * 2.0, 0.0, 1.0);
  out.uv = c * 0.5 + 0.5;
  return out;
}

@fragment fn fs(in: VSOut) -> @location(0) vec4f {
  let c = textureSample(face, face_samp, in.uv);   // an -srgb face reads LINEAR
  let dpr = mat_dpr(u);
  return vec4f(night_encode(c.rgb), 1.0) * (u.view.w * portal_cover(in.clip.xy / dpr, u.portals, u.clips, dpr));
}
`;

interface SheetShared {
  readonly device: GPUDevice;
  readonly l0: GPUBindGroupLayout;
  readonly l1: GPUBindGroupLayout;
  readonly pipeline: GPURenderPipeline;
  readonly sampler: GPUSampler;
  readonly film: GPUTexture;
  readonly filmView: GPUTextureView;
  slots: number;
}

class SheetPass implements KindPass<SheetRecord> {
  private readonly shared: SheetShared;
  private readonly mat: MatPass;
  private readonly rects: GPUBuffer[] = [];
  private draws: GPUBindGroup[] = [];
  private group0: GPUBindGroup | null = null;

  constructor(shared: SheetShared, mat: MatPass) { this.shared = shared; this.mat = mat; shared.slots += 1; }

  static async create(device: GPUDevice, format: GPUTextureFormat, mat: MatPass): Promise<SheetPass> {
    const l0 = bindLayout(device, [{ binding: 0, stages: ["vertex", "fragment"], buffer: "uniform" }], "sheet/view");
    const l1 = bindLayout(device, [
      { binding: 0, stages: ["fragment"], texture: "float" },
      { binding: 1, stages: ["fragment"], sampler: "filtering" },
      { binding: 2, stages: ["vertex"], buffer: "uniform" },
    ], "sheet/face");
    const module = await compile(device, compose(kitWgsl(["view", "portal", "mat"], { entry: { label: "sheet/sheet.wgsl", text: SHEET_WGSL } })));
    const pipeline = await renderPipeline(device, {
      label: "sheet", layout: device.createPipelineLayout({ bindGroupLayouts: [l0, l1] }), module, format,
      blend: { color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" } },
    });
    const sampler = device.createSampler({ label: "sheet/trilinear", magFilter: "linear", minFilter: "linear", mipmapFilter: "linear" });
    const film = device.createTexture({ label: "sheet/film", size: [1, 1], format: "rgba8unorm-srgb", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: film }, new Uint8Array([...SHEET_FILM, 255]), { bytesPerRow: 4 }, [1, 1]);
    return new SheetPass({ device, l0, l1, pipeline, sampler, film, filmView: film.createView(), slots: 0 }, mat);
  }

  spawn(mat: MatPass): SheetPass { return new SheetPass(this.shared, mat); }

  prepare(encoder: GPUCommandEncoder, slot: SlotContext, records: readonly SheetRecord[]): number {
    const { device } = this.shared;
    this.group0 = bindGroup(device, this.shared.l0, [this.mat.view], "sheet/view");
    this.draws = records.map((r, i) => {
      let rect = this.rects[i];
      if (rect === undefined) { rect = device.createBuffer({ label: "sheet/rect", size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); this.rects[i] = rect; }
      device.queue.writeBuffer(rect, 0, new Float32Array([r.rect.cx, r.rect.cy, r.rect.w / 2, r.rect.h / 2]));
      const live = r.face?.texture();
      // the mips as deep as this slot reads them, into the frame's encoder (once per revision: a second slot asks nothing more)
      if (live !== undefined) live.prepare(encoder, liveDepth(live, [r.rect.w * slot.view.zoom * slot.view.dpr, r.rect.h * slot.view.zoom * slot.view.dpr]));
      return bindGroup(device, this.shared.l1, [live?.view() ?? this.shared.filmView, this.shared.sampler, rect], "sheet/face");
    });
    return records.length;
  }

  drawRange(pass: GPURenderPassEncoder, first: number, end: number): void {
    if (this.group0 === null) return;
    pass.setPipeline(this.shared.pipeline);
    pass.setBindGroup(0, this.group0);
    for (let i = first; i < Math.min(end, this.draws.length); i++) {
      pass.setBindGroup(1, this.draws[i] as GPUBindGroup);
      pass.draw(6);
    }
  }

  dispose(): void {
    for (const b of this.rects) b.destroy();
    this.rects.length = 0;
    this.shared.slots -= 1;
    if (this.shared.slots === 0) this.shared.film.destroy();   // the film goes with the last slot standing
  }
}

function sheetLocal(host: KindHost): SheetLocal {
  const live = host.use?.(LIVE);
  const faces = new Map<Entity, LiveFace>();
  return {
    face(e) {
      const had = faces.get(e);
      if (had !== undefined) return had;
      const key = host.keyOf?.(e);
      if (live === undefined || key === undefined) return undefined;
      const face = live.open(key, { sheet: true }, () => host.wake?.());
      faces.set(e, face);
      face.take();   // what the source already holds lands in the frame that opens it
      return face;
    },
    forget(e) { faces.get(e)?.close(); faces.delete(e); },
    dispose() { for (const f of faces.values()) f.close(); faces.clear(); },
  };
}

export const sheetKind: ObjectKind<ObjectRect, SheetRecord> = {
  name: SHEET_KIND, stratum: "things", reach: 0,
  create: (device, format, mat) => SheetPass.create(device, format, mat),
  resolve: (ctx) => ctx.rect,
  record: (G, ctx) => ({ e: ctx.entity, rect: G, face: (ctx.local as SheetLocal | undefined)?.face(ctx.entity) }),
  hit: (G, wx, wy) => (Math.abs(wx - G.cx) <= G.w / 2 && Math.abs(wy - G.cy) <= G.h / 2 ? "content" : null),
  local: sheetLocal,
};

export const Sheet: WidgetType = defineObject({ type: SHEET_TYPE, version: 1, props: {}, size: { w: 64, h: 40 }, kind: sheetKind, interaction: { selectable: true, movable: true } });
