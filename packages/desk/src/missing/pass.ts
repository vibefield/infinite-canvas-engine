// The MISSING FACE's pass (petition I24): the faces of one slot, instanced — one quad per object, the slot's ONE view block bound
// (K-L3: read, never written), its records in a persistent store (a face keeps its slot and is written only when its record
// changed — a pan writes nothing). NOTHING of it exists until a desk needs it: the pipeline is made at the first face a desk asks
// for (`missingFaces` — synchronously, so a kind quarantined mid-frame is drawn as missing in the next; WebGPU compiles it before the
// first draw that uses it), and a slot's store at its first face. A desk where nothing is missing — every desk the golden draws —
// holds no pipeline, no buffer of it, and the memory ledger shows none. Every slot's faces are spawned on the one pipeline, as a
// kind's passes are; the ground spawns them into a kind's entry when that kind goes missing (ground.ts `Ground.quarantine`).

import { bindGroup, bindLayout } from "../engine/pipeline";
import { createRecordStore, type RecordStore, type RecordStoreStats } from "../engine/records";
import { compose } from "../engine/shader";
import type { KindExtra, KindPass, SlotContext } from "../kind";
import type { MatPass } from "../kit/view";
import type { ShaderText } from "../shaders";
import { MissingFace, missingValues } from "./layout";
import { missingShaders } from "./shaders";

/** Premultiplied "source over" — every desk object's blend. */
const BLEND_PREMUL: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};

/** The faces a slot holds at most (the record store's ceiling — a desk of 64k missing objects is a desk of 64k missing objects). */
const MAX_FACES = 65_536;

const NO_RECORDS: RecordStoreStats = { written: 0, bytes: 0, orderWrites: 0, slots: 0, capacity: 0, grown: 0 };

interface MissingShared {
  readonly layout: GPUBindGroupLayout;
  readonly pipeline: GPURenderPipeline;
}

export class MissingPass implements KindPass<unknown> {
  readonly name = "desk/missing";
  private store: RecordStore<unknown> | null = null;
  private group: GPUBindGroup | null = null;
  private boundStore = -1;
  private boundAssets = -1;
  private count = 0;
  private readonly device: GPUDevice;
  private readonly shared: MissingShared;
  private readonly mat: MatPass;

  private constructor(device: GPUDevice, shared: MissingShared, mat: MatPass) {
    this.device = device; this.shared = shared; this.mat = mat;
  }

  /**
   * The root's pass on `mat`, made NOW (no await — a quarantine asks for it mid-frame): its layout and its one pipeline (it is lit by
   * nothing — the same in every slot). The desk's own WGSL, composed from the host's text; WebGPU compiles it before its first draw.
   */
  static make(device: GPUDevice, format: GPUTextureFormat, mat: MatPass, text?: ShaderText): MissingPass {
    const layout = bindLayout(device, [
      { binding: 0, stages: ["vertex", "fragment"], buffer: "uniform" },
      { binding: 1, stages: ["vertex", "fragment"], buffer: "read-only-storage" },
      { binding: 2, stages: ["vertex"], buffer: "read-only-storage" },
    ], "desk/missing");
    const shader = compose(missingShaders(text));
    const module = device.createShaderModule({ code: shader.code, label: shader.label });
    const pipeline = device.createRenderPipeline({
      label: "desk/missing",
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format, blend: BLEND_PREMUL }] },
      primitive: { topology: "triangle-list" },
    });
    return new MissingPass(device, { layout, pipeline }, mat);
  }

  /** A slot's own faces on the shared pipeline, through `mat`'s view block. */
  spawn(mat: MatPass): MissingPass { return new MissingPass(this.device, this.shared, mat); }

  prepare(_encoder: GPUCommandEncoder, _slot: SlotContext, records: readonly unknown[], extra?: KindExtra): number {
    if (records.length === 0 && this.store === null) { this.count = 0; return 0; }
    this.store ??= createRecordStore<unknown, keyof typeof MissingFace.slots>({
      device: this.device, def: MissingFace, capacity: 16, max: MAX_FACES, label: "desk/missing",
      pack: (r, _aux, into, slot) => { into.set(missingValues(r), slot); return 0; },
    });
    this.count = this.store.prepare(records.length > MAX_FACES ? records.slice(0, MAX_FACES) : records, extra?.keys !== undefined && extra.keys.length > MAX_FACES ? extra.keys.slice(0, MAX_FACES) : extra?.keys);
    this.rebind();   // after: the store's buffers may have grown
    return this.count;
  }

  private rebind(): void {
    const store = this.store;
    if (store === null || (this.group !== null && this.boundStore === store.version && this.boundAssets === this.mat.assetVersion)) return;
    this.group = bindGroup(this.device, this.shared.layout, [this.mat.view, store.records, store.order], "desk/missing");
    this.boundStore = store.version;
    this.boundAssets = this.mat.assetVersion;
  }

  drawRange(pass: GPURenderPassEncoder, first: number, end: number): void {
    const hi = Math.min(end, this.count);
    if (first >= hi || this.group === null) return;
    pass.setPipeline(this.shared.pipeline);
    pass.setBindGroup(0, this.group);
    pass.draw(6, hi - first, 0, first);
  }

  /** The store's counters (a rig's witness) — nothing until the slot's first face. */
  records(): RecordStoreStats { return this.store?.stats() ?? NO_RECORDS; }

  dispose(): void { this.store?.dispose(); this.store = null; this.group = null; }
}

/** A desk's missing faces (petition I24): a slot's own on its mat, at its first ask — the pipeline made at the desk's first. */
export interface MissingFaces {
  /** A slot's faces on `mat` (the desk's pipeline made now if this is the first). */
  spawn(mat: MatPass): KindPass;
  /** Has the desk made its pipeline (a face was ever asked for)? */
  readonly made: boolean;
  dispose(): void;
}

/** The missing faces of a desk on `device` — nothing made until the first `spawn` (then the pipeline, on the root's `mat`). */
export function missingFaces(device: GPUDevice, format: GPUTextureFormat, mat: MatPass, text?: ShaderText): MissingFaces {
  let root: MissingPass | null = null;
  return {
    spawn: (m) => { root ??= MissingPass.make(device, format, mat, text); return root.spawn(m); },
    get made() { return root !== null; },
    dispose: () => { root?.dispose(); root = null; },
  };
}
