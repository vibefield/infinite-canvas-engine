// What the two LAYERED kinds share — the notebook (kinds/notebook.ts) and the desk calendar (kinds/calendar.ts):
// a kind whose pass renders every one of its objects into a target of its own (depth, 4× MSAA, the
// notebook's shadow maps) and lays that target over the frame in ONE draw (design-015 §4.2: "a kind whose
// object needs depth, MSAA or shadow maps renders into its own target … its run in the main pass is a
// composite draw"). Both are ROOT-desk objects in this program (D-D18): only the root slot's pass draws.
//
// The layer is recorded in `prepare`, into the frame's command encoder — before the frame's render pass
// begins and after the mat's wind (so it reads this frame's dapple) — and `drawRange` lays it, inside the
// slot's scissor, then gives the slot its scissor back (the objects after it draw in the slot's, as the
// ground restored it after a host's `underlays`).

import { bindLayout } from "../engine/pipeline";
import type { KindPass, RenderTarget, SlotContext } from "../kind";
import type { View } from "../lattice/lod";
import type { MatPass } from "./view";
import { scissorOf } from "../nav/portal";
import type { ComposeOptions } from "../engine/shader";
import type { ShaderText } from "../shaders";
import { kitWgsl } from "./wgsl";

/** The composite's entry: a resolved, premultiplied layer laid over what the ground drew (the layered kinds share it). */
export const LAYER_COMPOSITE_FILE = "kit/composite.wgsl";

/**
 * The program that lays a layer — its entry, from the host's shader text, after the kit's view block and portal chain: the layer is
 * laid through the slot's chain (design-018 §4), so a layered object keeps the kit's contract as one — the tray's feather included.
 */
export function layerComposite(text: ShaderText): ComposeOptions {
  return kitWgsl(["view", "portal"], { entry: { label: LAYER_COMPOSITE_FILE, text: text({ composite: LAYER_COMPOSITE_FILE }).composite } }, text);
}

/** The composite's bindings (every layered kind's): the resolved layer, its box's origin, and the slot's view block (its chain). */
export function layerCompositeLayout(device: GPUDevice, label: string): GPUBindGroupLayout {
  return bindLayout(device, [{ binding: 0, stages: ["fragment"], texture: "float" }, { binding: 1, stages: ["fragment"], buffer: "uniform" }, { binding: 2, stages: ["fragment"], buffer: "uniform" }], label);
}

/** A device-px rect: x, y, width, height. */
export type Rect4 = readonly [number, number, number, number];

/**
 * The attachment a slot's view names, device px: what every host sizes its canvas to — `surface().fit`, the reflector's
 * `attach.resize`, the oracle's target — `max(1, round(css · dpr))`. A layer is made at this size, so its texel is the pixel.
 */
export const attachmentOf = (v: View & { readonly dpr: number }): { readonly w: number; readonly h: number } => ({
  w: Math.max(1, Math.round(v.width * v.dpr)),
  h: Math.max(1, Math.round(v.height * v.dpr)),
});

/** Two device-px rects intersected; a width or height of 0 when they do not meet. */
export function clip(a: Rect4, b: Rect4): Rect4 {
  const x0 = Math.max(a[0], b[0]);
  const y0 = Math.max(a[1], b[1]);
  const x1 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y1 = Math.min(a[1] + a[3], b[1] + b[3]);
  return [x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0)];
}

/** What a layered kind asks of its pass: the layer recorded into an encoder, laid by one draw, its screen box. */
export interface LayerPass {
  layer(encoder: GPUCommandEncoder, size: { readonly w: number; readonly h: number }, dpr: number): boolean;
  composite(pass: GPURenderPassEncoder, scissor?: Rect4 | null): void;
  readonly screenBox: Rect4 | null;
  /** The render target the next prepare is for (D7 — `SlotContext.target`): a pass keeps the held desk copy's state apart. */
  use?(target: RenderTarget): void;
  /** The hold is over: the copy's state given back. */
  endHold?(): void;
  /** The records its last prepare turned away at its cap (D7). */
  readonly dropped?: number;
  /** K6a (D-K6a.3): its frame layer's targets are made (at the first object drawn)… */
  readonly layerMade?: boolean;
  /** …was one of its objects drawn within `ms` (and when last: `performance.now()`'s ms — the release's due, K7a)… */
  drawnWithin?(ms: number): boolean;
  readonly lastDrawn?: number;
  /** …and let them go (made again at the next object drawn). */
  releaseLayer?(): void;
  dispose(): void;
}

/**
 * The part of a layered kind that is the same for both: ROOT ONLY — a spawned slot's pass holds nothing and draws nothing (its
 * `pass` is null; D-D18: a notebook or a pad is never drawn in a mini mat's inside or a flight's departed desk) — the layer recorded
 * after its pass prepared, and laid ONCE over the whole range the ground hands it (a kind registered with `composite: true`: the
 * ground draws it as one run after the rest of its stratum).
 */
export abstract class LayeredKind<R, P extends LayerPass> implements KindPass<R> {
  /** The root slot's pass — the host's door to its own API (the ink, the tiles, the law); null in a spawned slot (root only). */
  readonly pass: P | null;
  /** The slot's scissor this frame, device px — the layer is laid inside it and it is given back after (null: nothing to lay). */
  private within: Rect4 | null = null;
  /** How many records `prepare` was handed: the whole range the layer lays. */
  private handed = 0;
  constructor(pass: P | null) { this.pass = pass; }

  abstract spawn(mat: MatPass): KindPass<R>;

  /** The pass's own prepare for this slot (its records, eye and look); returns the count that will draw. */
  protected abstract prepareOwn(pass: P, s: SlotContext, records: readonly R[]): number;

  prepare(encoder: GPUCommandEncoder, s: SlotContext, records: readonly R[]): number {
    this.within = null;
    this.handed = records.length;
    const p = this.pass;
    if (!p) return 0;
    p.use?.(s.target ?? "frame");
    const n = this.prepareOwn(p, s, records);
    if (n === 0) return 0;
    const size = attachmentOf(s.view);
    if (p.layer(encoder, size, s.view.dpr)) this.within = scissorOf(s.present, s.view.dpr, size);
    return n;
  }

  /** The layer over the frame: once, for the whole range [0, count) — one draw lays every object; a part of it cannot be drawn from one layer. */
  drawRange(pass: GPURenderPassEncoder, first: number, end: number): void {
    const p = this.pass;
    const within = this.within;
    if (!p || !within || first !== 0 || end < this.handed || end === 0) return;
    const box = p.screenBox;
    if (!box) return;
    const r = clip(box, within);
    if (r[2] <= 0 || r[3] <= 0) return;
    p.composite(pass, r);
    pass.setScissorRect(within[0], within[1], within[2], within[3]);
  }

  endHold(): void { this.pass?.endHold?.(); }

  /**
   * Let this slot's layer go when none of its objects was drawn within `ms` (D-K6a.3 for a slot the host keeps beyond the root — the
   * tray's specimen, K5a; the ROOT's layer goes by its kind's own tick). Made again at the next object drawn.
   */
  idle(ms: number): void {
    const p = this.pass;
    if (p !== null && p.layerMade === true && p.drawnWithin?.(ms) === false) p.releaseLayer?.();
  }

  /** When `idle(ms)` next lets the layer go — its last object drawn + `ms` (K7a: the host's registered TIME wake); ∞ with none. */
  idleAt(ms: number): number {
    const p = this.pass;
    return p !== null && p.layerMade === true && p.lastDrawn !== undefined ? p.lastDrawn + ms : Number.POSITIVE_INFINITY;
  }

  dropped(): number { return this.pass?.dropped ?? 0; }

  dispose(): void { this.pass?.dispose(); }
}

/** A box's targets grow and shrink by this many device px a side, so a pan's jitter never makes them again (K7a). */
export const BOX_STEP = 256;
/** The numbers a layer's signature holds at most (`BoxTargets.holds`). */
const SIGNATURE = 8;

/**
 * A layered kind's TARGETS AT ITS SCREEN BOX (K7a — design-016 §6): the 4× colour and depth and their resolve sized to the box
 * its objects cover on the attachment (rounded up to BOX_STEP, at most the attachment), never the canvas — a notebook's layer at
 * 2400 × 1600 was 136 MB for a book a tenth of the screen. The layer is drawn through a viewport shifted by the box's ORIGIN over
 * the whole attachment, so the pixel grid is the attachment's (a fragment lands on the pixel it always did, the target's texel
 * `pixel − origin`); the composite reads the texel at its pixel less the origin (its uniform, binding 1 beside the layer). What a
 * fragment samples BY its position adds `origin` back (the passes carry it in their knobs). The rasteriser is not exactly
 * translation-invariant in floating point: a handful of edge samples and 1-LSB interpolants move against a canvas-sized layer
 * (D-K7a.4 — 13 golden scenes re-blessed).
 */
export class BoxTargets {
  msaa: GPUTexture | null = null;
  depth: GPUTexture | null = null;
  resolve: GPUTexture | null = null;
  compGroup: GPUBindGroup | null = null;
  /** The box's top-left on the attachment, device px (the layer's texel 0, 0). */
  readonly origin: [number, number] = [0, 0];
  /** The targets' size as made, device px (0 × 0: none). */
  readonly size = { w: 0, h: 0 };
  private originBuf: GPUBuffer | null = null;
  private readonly sent = new Float32Array(4).fill(Number.NaN);
  private readonly next = new Float32Array(4);
  /** What the layer the targets hold was drawn from — its pass's signature at the draw (K7a); NaN: nothing drawn since made. */
  private readonly drawnFrom = new Float64Array(SIGNATURE).fill(Number.NaN);
  /** …and the content it read, by value (the knobs, the records, the view block), with each copy's length. */
  private readonly drawnBytes: Uint8Array[] = [];
  private readonly drawnLen: number[] = [];
  /** `view`: the slot's view block (`MatPass.view`) — the composite lays the layer through its portal chain (`layerCompositeLayout`). */
  constructor(private readonly device: GPUDevice, private readonly label: string, private readonly layoutComp: GPUBindGroupLayout, private readonly samples: number, private readonly view: GPUBuffer) {}

  /** The targets are made (a layer holds device memory). */
  get made(): boolean { return this.msaa !== null; }

  /**
   * Fit the targets to `box` [x0, y0, x1, y1] (device px) on an `attach` of its size: made when none are or the box outgrew them,
   * made smaller when they are more than four times its area — never larger than the attachment; the origin written for the
   * composite when it moved.
   */
  fit(box: readonly [number, number, number, number], attach: { readonly w: number; readonly h: number }): void {
    const [x0, y0, x1, y1] = box;
    const w = Math.min(Math.ceil(Math.max(1, x1 - x0) / BOX_STEP) * BOX_STEP, Math.max(1, attach.w));
    const h = Math.min(Math.ceil(Math.max(1, y1 - y0) / BOX_STEP) * BOX_STEP, Math.max(1, attach.h));
    const outgrown = this.size.w < x1 - x0 || this.size.h < y1 - y0;
    const loose = this.size.w * this.size.h > 4 * w * h;
    if (this.msaa === null || outgrown || loose) {
      this.release();
      const d = this.device;
      this.msaa = d.createTexture({ label: `${this.label}/layer ×4`, size: [w, h], format: "rgba8unorm", sampleCount: this.samples, usage: GPUTextureUsage.RENDER_ATTACHMENT });
      this.depth = d.createTexture({ label: `${this.label}/depth ×4`, size: [w, h], format: "depth24plus", sampleCount: this.samples, usage: GPUTextureUsage.RENDER_ATTACHMENT });
      this.resolve = d.createTexture({ label: `${this.label}/layer`, size: [w, h], format: "rgba8unorm", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
      this.originBuf ??= d.createBuffer({ label: `${this.label}/layer origin`, size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.compGroup = d.createBindGroup({ label: `${this.label}/composite`, layout: this.layoutComp, entries: [{ binding: 0, resource: this.resolve.createView() }, { binding: 1, resource: { buffer: this.originBuf } }, { binding: 2, resource: { buffer: this.view } }] });
      this.size.w = w;
      this.size.h = h;
      this.sent.fill(Number.NaN);
      this.drawnFrom.fill(Number.NaN);
    }
    this.origin[0] = x0;
    this.origin[1] = y0;
    const n = this.next;
    n[0] = x0; n[1] = y0; n[2] = 0; n[3] = 0;
    if (n[0] !== this.sent[0] || n[1] !== this.sent[1]) {
      this.device.queue.writeBuffer(this.originBuf as GPUBuffer, 0, n);
      this.sent.set(n);
    }
  }

  /**
   * Begin the layer's pass into the fitted targets: cleared, the viewport the whole `attach` shifted by the origin, the scissor the
   * box — `box` [x0, y0, x1, y1] as fitted.
   */
  begin(encoder: GPUCommandEncoder, label: string, attach: { readonly w: number; readonly h: number }, box: readonly [number, number, number, number]): GPURenderPassEncoder {
    const pass = encoder.beginRenderPass({
      label,
      colorAttachments: [{ view: (this.msaa as GPUTexture).createView(), resolveTarget: (this.resolve as GPUTexture).createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "discard" }],
      depthStencilAttachment: { view: (this.depth as GPUTexture).createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "discard" },
    });
    pass.setViewport(-box[0], -box[1], attach.w, attach.h, 0, 1);
    pass.setScissorRect(0, 0, box[2] - box[0], box[3] - box[1]);
    return pass;
  }

  /**
   * The layer the targets hold was drawn from exactly `sig` and `bytes` (K7a — every input of its draw the same since: the pass's
   * numbers — its resources' generation, what it lists, the box — and the CONTENT the draw read, compared by value: this target's
   * knobs and records as prepared, the slot's view block. By content, not by version: a held frame's desk copy writes the shared
   * buffers between two of the hand's frames, and the hand's layer is still what they held): it may be laid again undrawn.
   */
  holds(sig: ArrayLike<number>, bytes: readonly Uint8Array[]): boolean {
    if (this.msaa === null) return false;
    for (let i = 0; i < SIGNATURE; i++) if (this.drawnFrom[i] !== (i < sig.length ? sig[i] : 0)) return false;
    if (bytes.length !== this.drawnBytes.length) return false;
    for (let i = 0; i < bytes.length; i++) {
      const a = bytes[i] as Uint8Array;
      const b = this.drawnBytes[i] as Uint8Array;
      if (this.drawnLen[i] !== a.byteLength) return false;
      for (let k = 0; k < a.byteLength; k++) if (a[k] !== b[k]) return false;
    }
    return true;
  }

  /** The layer was drawn from `sig` and `bytes` (copied; the copies grow once and are reused). */
  drew(sig: ArrayLike<number>, bytes: readonly Uint8Array[]): void {
    for (let i = 0; i < SIGNATURE; i++) this.drawnFrom[i] = i < sig.length ? (sig[i] as number) : 0;
    this.drawnBytes.length = bytes.length;
    this.drawnLen.length = bytes.length;
    for (let i = 0; i < bytes.length; i++) {
      const a = bytes[i] as Uint8Array;
      let b = this.drawnBytes[i];
      if (b === undefined || b.byteLength < a.byteLength) { b = new Uint8Array(Math.max(a.byteLength, 64)); this.drawnBytes[i] = b; }
      b.set(a);
      this.drawnLen[i] = a.byteLength;
    }
  }

  /** The targets let go, the origin's uniform with them (the next `fit` makes them again). */
  release(): void {
    this.drawnFrom.fill(Number.NaN);
    this.msaa?.destroy(); this.depth?.destroy(); this.resolve?.destroy(); this.originBuf?.destroy();
    this.msaa = null; this.depth = null; this.resolve = null; this.compGroup = null; this.originBuf = null;
    this.size.w = 0;
    this.size.h = 0;
  }

  dispose(): void { this.release(); }
}

/**
 * How long a layered kind's frame targets (its 4× layer, its resolve; the notebook's shadow maps) stand with none of its objects
 * drawn before the kind lets them go (K6a, design-016 §6 — made again at the next one drawn): render targets at the canvas's size,
 * never a cache the raster budget holds (D-K6a.3).
 */
export const LAYER_IDLE_MS = 5000;
