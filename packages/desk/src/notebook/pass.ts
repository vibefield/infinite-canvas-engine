// The NOTEBOOK pass — real 3D books drawn after the ground (NOTEBOOK.md §6). A second pass,
// like the photo's: the ground renders the mat, the cards and the notes; this draws the books
// above them, in three steps each frame there is a book to draw:
//
//   1. each book's SHADOW MAP — its depth from its lamp, into its layer of a depth array;
//   2. the LAYER — a 4× multisampled colour + depth target: every book (depth-tested, opaque,
//      its page corners rounded by the sample mask), then the mat under each book (its
//      shadow and contact, its ring) wherever the book does not cover it; resolved;
//   3. the COMPOSITE — the resolved layer, premultiplied, over the canvas.
//
// The layer is why the books can be meshes: their silhouettes get real antialiasing and their
// parts real occlusion, and the mat's shadow is a premultiplied darkening the ground never
// has to know about. Meshes live in per-book buffers, uploaded only when the book's pose
// changed; a book carried across the desk moves by its matrix.
//
// Two hosts (design-015 D3r-b): the prototype's lab drew the books after the ground in a command
// buffer of their own (`render`: steps 1–3); the desk's registry records steps 1–2 into the
// frame's own encoder (`layer`) and lays step 3 inside the frame's pass as the things' last run
// (`composite`, kinds/notebook.ts) — the same commands, the same bytes.

import { bindGroup, bindLayout, storageBuffer, uniformBuffer } from "../engine/pipeline";
import { compile, compose } from "../engine/shader";
import type { FadeIn, View } from "../lattice/lod";
import { type MatConfig, type MatFrame, MatUniforms, matUniformValues, NO_GLYPHS, STILL_MAT_FRAME } from "../mat/layout";
import type { MatPass } from "../mat/mat-pass";
import { DAY_LIGHT, type MatLight } from "../mat/night";
import { MAT_GRID, type RGB, type RGBA } from "../theme";
import { type DeskEye, eyeValues, project } from "./eye";
import type { NotebookLaw } from "./law";
import { designCode, MAX_NOTEBOOKS, MAX_SHADOWED, NbBook, NbUniforms, nbUniformValues, type NotebookLook, type Ruling, rulingCode, SHADOW_RES } from "./layout";
import type { BuiltMesh } from "./mesh";
import { VERTEX_BYTES } from "./mesh";
import { inverseOf, lightFrame, matrixOf, type Rigid, worldBounds } from "./place";
import type { Frame } from "./shape";
import type { NotebookShaders } from "./shaders";
import { INK_H, INK_LAYERS, INK_TABLE, INK_W } from "./ink";
import { PAPER_TEX, paperTexture } from "./paper-tex";
import { generateMips, mipCount } from "../photo/mips";

const SAMPLES = 4;
const BLEND_PREMUL: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};

/** One book as the pass draws it this frame. */
export interface NotebookDraw {
  /** A stable id: the book's GPU buffers are kept under it. */
  readonly id: number;
  readonly mesh: BuiltMesh;
  /** Bumped whenever the mesh was rebuilt — the upload's key. */
  readonly version: number;
  readonly frame: Frame;
  readonly rigid: Rigid;
  /** The unit direction toward the lamp. */
  readonly lamp: readonly [number, number, number];
  readonly theta: number;
  readonly gamma: number;
  readonly look: NotebookLook;
  readonly ruling: Ruling;
  readonly seed: number;
  /** The selection ring's presence, 0..1. */
  readonly ring: number;
  /** Something of the book rises over the rest (a sheet in the air, the cover swinging): its surfaces read the shadow map. */
  readonly selfShadow: boolean;
  /** The pages whose ink is on the device, and the layer each is in (at most `INK_TABLE`). */
  readonly ink: { readonly pages: readonly number[]; readonly layers: readonly number[] };
}

interface BookBuffers { vb: GPUBuffer; ib: GPUBuffer; vcap: number; icap: number; version: number; icount: number; seen: number }

export interface NotebookStats { readonly books: number; readonly triangles: number; readonly shadowed: number }

export class NotebookPass {
  readonly name = "notebook/books";
  private readonly device: GPUDevice;
  private readonly format: GPUTextureFormat;
  private readonly mat: MatPass;
  private readonly matU = MatUniforms.alloc(1);
  private readonly knobs = NbUniforms.alloc(1);
  private readonly records = NbBook.alloc(MAX_NOTEBOOKS);
  private readonly matBuf: GPUBuffer;
  private readonly knobBuf: GPUBuffer;
  private readonly recordBuf: GPUBuffer;
  private readonly layoutMain: GPUBindGroupLayout;
  private readonly layoutShadow: GPUBindGroupLayout;
  private readonly layoutComp: GPUBindGroupLayout;
  private readonly bookPipe: GPURenderPipeline;
  private readonly recvPipe: GPURenderPipeline;
  private readonly shadowPipe: GPURenderPipeline;
  private readonly compPipe: GPURenderPipeline;
  private readonly goboSampler: GPUSampler;
  private readonly noiseSampler: GPUSampler;
  private readonly cmpSampler: GPUSampler;
  private readonly shadowTex: GPUTexture;
  private readonly shadowLayers: GPUTextureView[] = [];
  private readonly shadowGroup: GPUBindGroup;
  private readonly inkSampler: GPUSampler;
  private readonly paperTex: GPUTexture;
  private readonly paperSampler: GPUSampler;
  /** The pages' ink rasters: a placeholder until the first stroke, then `INK_LAYERS` full pages. */
  private inkTex: GPUTexture;
  private inkReady = false;
  private mainGroup!: GPUBindGroup;
  private boundAssets = -1;
  private boundInk = false;
  private msaa: GPUTexture | null = null;
  private depth: GPUTexture | null = null;
  private resolve: GPUTexture | null = null;
  private compGroup: GPUBindGroup | null = null;
  private size = { w: 0, h: 0 };
  private readonly buffers = new Map<number, BookBuffers>();
  private list: NotebookDraw[] = [];
  private frameNo = 0;
  private screen: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private stats: NotebookStats = { books: 0, triangles: 0, shadowed: 0 };
  /** Profiling switches (a harness's): 1 no PCSS · 2 no material detail · 4 no gobo · 8 no shadow maps · 16 no composite · 32 no book draw · 64 no mat draw. */
  debug = 0;

  private constructor(device: GPUDevice, format: GPUTextureFormat, mat: MatPass, pipes: { layoutMain: GPUBindGroupLayout; layoutShadow: GPUBindGroupLayout; layoutComp: GPUBindGroupLayout; book: GPURenderPipeline; recv: GPURenderPipeline; shadow: GPURenderPipeline; comp: GPURenderPipeline }) {
    this.device = device; this.format = format; this.mat = mat;
    this.layoutMain = pipes.layoutMain; this.layoutShadow = pipes.layoutShadow; this.layoutComp = pipes.layoutComp;
    this.bookPipe = pipes.book; this.recvPipe = pipes.recv; this.shadowPipe = pipes.shadow; this.compPipe = pipes.comp;
    this.matBuf = uniformBuffer(device, MatUniforms.size, "notebook/mat uniforms");
    this.knobBuf = uniformBuffer(device, NbUniforms.size, "notebook/knobs");
    this.recordBuf = storageBuffer(device, NbBook.size * MAX_NOTEBOOKS, "notebook/books");
    this.goboSampler = device.createSampler({ label: "notebook/gobo", magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
    this.noiseSampler = device.createSampler({ label: "notebook/noise", magFilter: "linear", minFilter: "linear", addressModeU: "repeat", addressModeV: "repeat" });
    this.cmpSampler = device.createSampler({ label: "notebook/shadow", compare: "less", magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
    this.shadowTex = device.createTexture({ label: "notebook/shadow maps", size: [SHADOW_RES, SHADOW_RES, MAX_SHADOWED], format: "depth32float", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    for (let i = 0; i < MAX_SHADOWED; i++) this.shadowLayers.push(this.shadowTex.createView({ dimension: "2d", baseArrayLayer: i, arrayLayerCount: 1 }));
    this.shadowGroup = device.createBindGroup({ label: "notebook/shadow", layout: this.layoutShadow, entries: [{ binding: 2, resource: { buffer: this.recordBuf } }] });
    this.inkSampler = device.createSampler({ label: "notebook/ink", magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
    this.inkTex = device.createTexture({ label: "notebook/ink (none yet)", size: [1, 1, 2], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    // the paper, baked once: its bytes, then its mips
    this.paperTex = device.createTexture({ label: "notebook/paper", size: [PAPER_TEX, PAPER_TEX], format: "rgba8unorm", mipLevelCount: mipCount(PAPER_TEX, PAPER_TEX), usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    device.queue.writeTexture({ texture: this.paperTex }, paperTexture(), { bytesPerRow: PAPER_TEX * 4 }, [PAPER_TEX, PAPER_TEX, 1]);
    generateMips(device, this.paperTex);
    this.paperSampler = device.createSampler({ label: "notebook/paper", magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", addressModeU: "repeat", addressModeV: "repeat", maxAnisotropy: 8 });
    this.rebind();
  }

  static async create(device: GPUDevice, format: GPUTextureFormat, src: NotebookShaders, mat: MatPass): Promise<NotebookPass> {
    const layoutMain = bindLayout(device, [
      { binding: 0, stages: ["vertex", "fragment"], buffer: "uniform" },
      { binding: 1, stages: ["vertex", "fragment"], buffer: "uniform" },
      { binding: 2, stages: ["vertex", "fragment"], buffer: "read-only-storage" },
      { binding: 3, stages: ["fragment"], texture: "float" },
      { binding: 4, stages: ["fragment"], sampler: "filtering" },
      { binding: 5, stages: ["fragment"], texture: "float" },
      { binding: 6, stages: ["fragment"], sampler: "filtering" },
      { binding: 7, stages: ["fragment"], texture: "depth", dimension: "2d-array" },
      { binding: 8, stages: ["fragment"], sampler: "comparison" },
      { binding: 9, stages: ["fragment"], texture: "float", dimension: "2d-array" },
      { binding: 10, stages: ["fragment"], sampler: "filtering" },
      { binding: 11, stages: ["fragment"], texture: "float" },
      { binding: 12, stages: ["fragment"], sampler: "filtering" },
    ], "notebook/main");
    // the shadow pass draws INTO the depth array, so its group must not bind it
    const layoutShadow = device.createBindGroupLayout({ label: "notebook/shadow", entries: [{ binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } }] });
    const layoutComp = bindLayout(device, [{ binding: 0, stages: ["fragment"], texture: "float" }], "notebook/composite");
    const module = await compile(device, compose({ structs: [MatUniforms, NbUniforms, NbBook], modules: src.modules, entry: src.entry }));
    const compModule = await compile(device, compose({ entry: src.composite }));
    const vertexLayout: GPUVertexBufferLayout = {
      arrayStride: VERTEX_BYTES,
      attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x3" },
        { shaderLocation: 1, offset: 12, format: "float32x3" },
        { shaderLocation: 2, offset: 24, format: "float32x2" },
        { shaderLocation: 3, offset: 32, format: "float32x4" },
        { shaderLocation: 4, offset: 48, format: "float32x2" },
        { shaderLocation: 5, offset: 56, format: "float32x2" },
      ],
    };
    const mainLayout = device.createPipelineLayout({ bindGroupLayouts: [layoutMain] });
    const [book, recv, shadow, comp] = await Promise.all([
      device.createRenderPipelineAsync({
        label: "notebook/book", layout: mainLayout,
        vertex: { module, entryPoint: "vs_book", buffers: [vertexLayout] },
        fragment: { module, entryPoint: "fs_book", targets: [{ format: "rgba8unorm" }] },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
        multisample: { count: SAMPLES },
      }),
      device.createRenderPipelineAsync({
        label: "notebook/mat", layout: mainLayout,
        vertex: { module, entryPoint: "vs_recv" },
        fragment: { module, entryPoint: "fs_recv", targets: [{ format: "rgba8unorm", blend: BLEND_PREMUL }] },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare: "less" },
        multisample: { count: SAMPLES },
      }),
      device.createRenderPipelineAsync({
        label: "notebook/shadow", layout: device.createPipelineLayout({ bindGroupLayouts: [layoutShadow] }),
        vertex: { module, entryPoint: "vs_shadow", buffers: [{ arrayStride: VERTEX_BYTES, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] }] },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less", depthBias: 2, depthBiasSlopeScale: 1.5 },
      }),
      device.createRenderPipelineAsync({
        label: "notebook/composite", layout: device.createPipelineLayout({ bindGroupLayouts: [layoutComp] }),
        vertex: { module: compModule, entryPoint: "vs" },
        fragment: { module: compModule, entryPoint: "fs", targets: [{ format, blend: BLEND_PREMUL }] },
        primitive: { topology: "triangle-list" },
      }),
    ]);
    return new NotebookPass(device, format, mat, { layoutMain, layoutShadow, layoutComp, book, recv, shadow, comp });
  }

  private rebind(): void {
    if (this.boundAssets === this.mat.assetVersion && this.boundInk === this.inkReady) return;
    this.mainGroup = bindGroup(this.device, this.layoutMain, [
      this.matBuf, this.knobBuf, this.recordBuf, this.mat.silhouette, this.goboSampler, this.mat.noiseTexture.createView(), this.noiseSampler,
      this.shadowTex.createView({ dimension: "2d-array" }), this.cmpSampler, this.inkTex.createView({ dimension: "2d-array" }), this.inkSampler,
      this.paperTex.createView(), this.paperSampler,
    ], "notebook/main");
    this.boundAssets = this.mat.assetVersion;
    this.boundInk = this.inkReady;
  }

  /**
   * Copy part of a page's raster (its bytes — notebook/raster.ts: RGBA8, straight alpha, `INK_W` texels a row) into its layer:
   * only the rectangle the pen touched goes (D3t-b — the bytes, not a canvas: the Node oracle writes the same layers). The first
   * call makes the layers — a book with no ink costs the device nothing.
   */
  uploadInk(layer: number, bytes: Uint8Array<ArrayBuffer>, x = 0, y = 0, w = INK_W, h = INK_H): void {
    if (!this.inkReady) {
      this.inkTex.destroy();
      this.inkTex = this.device.createTexture({ label: "notebook/ink", size: [INK_W, INK_H, INK_LAYERS], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
      this.inkReady = true;
      this.rebind();
    }
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(INK_W, Math.ceil(x + w));
    const y1 = Math.min(INK_H, Math.ceil(y + h));
    if (x1 <= x0 || y1 <= y0) return;
    this.device.queue.writeTexture({ texture: this.inkTex, origin: { x: x0, y: y0, z: layer } }, bytes, { offset: (y0 * INK_W + x0) * 4, bytesPerRow: INK_W * 4, rowsPerImage: INK_H }, [x1 - x0, y1 - y0, 1]);
  }

  /** The layer's targets at the canvas's device size. */
  private fit(w: number, h: number): void {
    if (this.size.w === w && this.size.h === h && this.msaa) return;
    this.msaa?.destroy(); this.depth?.destroy(); this.resolve?.destroy();
    this.msaa = this.device.createTexture({ label: "notebook/layer ×4", size: [w, h], format: "rgba8unorm", sampleCount: SAMPLES, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    this.depth = this.device.createTexture({ label: "notebook/depth ×4", size: [w, h], format: "depth24plus", sampleCount: SAMPLES, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    this.resolve = this.device.createTexture({ label: "notebook/layer", size: [w, h], format: "rgba8unorm", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.compGroup = bindGroup(this.device, this.layoutComp, [this.resolve.createView()], "notebook/composite");
    this.size = { w, h };
  }

  /** A book's mesh on the device — uploaded when its version moved, the buffers grown when too small. */
  private upload(d: NotebookDraw): BookBuffers {
    let b = this.buffers.get(d.id);
    const vbytes = d.mesh.vcount * VERTEX_BYTES;
    const ibytes = d.mesh.icount * 4;
    if (!b || b.vcap < vbytes || b.icap < ibytes) {
      b?.vb.destroy(); b?.ib.destroy();
      const vcap = Math.max(vbytes * 1.5, 65536) | 0;
      const icap = Math.max(ibytes * 1.5, 65536) | 0;
      b = {
        vb: this.device.createBuffer({ label: `notebook/${d.id} vertices`, size: (vcap + 3) & ~3, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }),
        ib: this.device.createBuffer({ label: `notebook/${d.id} indices`, size: (icap + 3) & ~3, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST }),
        vcap, icap, version: -1, icount: 0, seen: 0,
      };
      this.buffers.set(d.id, b);
    }
    if (b.version !== d.version) {
      this.device.queue.writeBuffer(b.vb, 0, d.mesh.vertices.buffer, d.mesh.vertices.byteOffset, vbytes);
      this.device.queue.writeBuffer(b.ib, 0, d.mesh.indices.buffer, d.mesh.indices.byteOffset, ibytes);
      b.version = d.version; b.icount = d.mesh.icount;
    }
    b.seen = this.frameNo;
    return b;
  }

  /**
   * This frame's books, the mat's block for the camera and the light, the pass's knobs, the
   * eye. Records every book's placement, lamp, shadow frame, pose and palette; uploads what
   * moved. Returns the count that will draw.
   */
  // biome-ignore lint/style/useDefaultParameterLast: the prototype's signature, moved verbatim — dropping the default would change what an explicit `undefined` means (design-015 D1)
  prepare(view: View & { readonly dpr: number }, fadeIn: FadeIn, cfg: MatConfig, frame: MatFrame | undefined, light: MatLight = DAY_LIGHT, eye: DeskEye, law: NotebookLaw, colours: { readonly cast: RGB; readonly select: RGB; readonly ruleInk: RGBA }, books: readonly NotebookDraw[]): number {
    this.rebind();
    this.frameNo += 1;
    // a book wholly off the screen (its box and its shadow) is not drawn, nor mapped
    const onScreen = (d: NotebookDraw): boolean => {
      const wb = worldBounds(d.rigid, d.mesh.min, d.mesh.max);
      const pad = 3 * (law.shadow.sigma0 + law.shadow.perUnit * Math.max(wb.hi[2], 1)) + 2.2 * Math.max(wb.hi[2], 1);
      let x0 = Number.POSITIVE_INFINITY;
      let y0 = Number.POSITIVE_INFINITY;
      let x1 = Number.NEGATIVE_INFINITY;
      let y1 = Number.NEGATIVE_INFINITY;
      for (let c = 0; c < 8; c++) { const [qx, qy] = project(eye, c & 1 ? wb.hi[0] + pad : wb.lo[0] - pad, c & 2 ? wb.hi[1] + pad : wb.lo[1] - pad, c & 4 ? wb.hi[2] : wb.lo[2]); x0 = Math.min(x0, qx); y0 = Math.min(y0, qy); x1 = Math.max(x1, qx); y1 = Math.max(y1, qy); }
      return x1 >= 0 && y1 >= 0 && x0 <= eye.vw && y0 <= eye.vh;
    };
    this.list = books.filter(onScreen).slice(0, MAX_NOTEBOOKS) as NotebookDraw[];
    const n = this.list.length;
    const strength = MAT_GRID.gobo.plates[cfg.gobo.plate === "b" ? "b" : "c"].strength;
    this.matU.set(matUniformValues(view, fadeIn, cfg, frame ?? STILL_MAT_FRAME, strength, undefined, light, NO_GLYPHS));
    this.device.queue.writeBuffer(this.matBuf, 0, this.matU.view());
    // the near plane above the tallest thing a book reaches: a book risen toward the eye in the hand (D4b) climbs past the 900 the law
    // assumed at rest, and the plane follows it (the at-rest numbers are the same bytes: no book reaches past 900 lying down)
    let top = 0;
    for (const d of this.list) top = Math.max(top, worldBounds(d.rigid, d.mesh.min, d.mesh.max).hi[2]);
    this.knobs.set({ ...nbUniformValues(law, eyeValues(eye, Math.max(900, top + 200)), view.dpr, colours.cast, colours.select, colours.ruleInk), ring: [law.ring.offset, this.debug, 0, 0] });
    this.device.queue.writeBuffer(this.knobBuf, 0, this.knobs.view());
    let tris = 0;
    let shadowed = 0;
    let sx0 = Number.POSITIVE_INFINITY;
    let sy0 = Number.POSITIVE_INFINITY;
    let sx1 = Number.NEGATIVE_INFINITY;
    let sy1 = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      const d = this.list[i] as NotebookDraw;
      this.upload(d);
      tris += d.mesh.icount / 3;
      const F = d.frame;
      const L = d.lamp;
      const wb = worldBounds(d.rigid, d.mesh.min, d.mesh.max);
      const mapped = i < MAX_SHADOWED;
      if (mapped) shadowed += 1;
      const tallest = Math.max(wb.hi[2], 1);
      // the mat this book darkens: its box cast along the light onto the desk, grown by the widest penumbra and the ring
      const sigma = law.shadow.sigma0 + law.shadow.perUnit * tallest;
      const grow = 3 * sigma + (law.ring.offset + law.ring.width * 2 + 2) / Math.max(eye.zoom, 1e-6);
      let rx0 = wb.lo[0];
      let ry0 = wb.lo[1];
      let rx1 = wb.hi[0];
      let ry1 = wb.hi[1];
      for (let c = 0; c < 8; c++) {
        const px = c & 1 ? wb.hi[0] : wb.lo[0];
        const py = c & 2 ? wb.hi[1] : wb.lo[1];
        const pz = c & 4 ? wb.hi[2] : wb.lo[2];
        const gx = px - (L[0] * pz) / Math.max(L[2], 1e-3);
        const gy = py - (L[1] * pz) / Math.max(L[2], 1e-3);
        rx0 = Math.min(rx0, gx); ry0 = Math.min(ry0, gy); rx1 = Math.max(rx1, gx); ry1 = Math.max(ry1, gy);
      }
      rx0 -= grow; ry0 -= grow; rx1 += grow; ry1 += grow;
      const lf = lightFrame(L, wb.lo, wb.hi, SHADOW_RES, 6, [[rx0, ry0, 0], [rx1, ry0, 0], [rx0, ry1, 0], [rx1, ry1, 0]]);
      // its footprint on the screen (the layer's scissor)
      for (let c = 0; c < 8; c++) {
        const [qx, qy] = project(eye, c & 1 ? wb.hi[0] : wb.lo[0], c & 2 ? wb.hi[1] : wb.lo[1], c & 4 ? wb.hi[2] : wb.lo[2]);
        sx0 = Math.min(sx0, qx); sy0 = Math.min(sy0, qy); sx1 = Math.max(sx1, qx); sy1 = Math.max(sy1, qy);
      }
      for (const [qx, qy] of [[rx0, ry0], [rx1, ry1]] as const) { const [a, b] = project(eye, qx, qy, 0); sx0 = Math.min(sx0, a); sy0 = Math.min(sy0, b); sx1 = Math.max(sx1, a); sy1 = Math.max(sy1, b); }
      const sw = Math.abs(d.theta) > 0.95 * Math.PI ? 1 : 0;
      const lk = d.look;
      this.records.set({
        model: matrixOf(d.rigid), inv: matrixOf(inverseOf(d.rigid)), light: lf.matrix,
        lamp: [L[0], L[1], L[2], i], sh: [lf.texel, lf.depth, mapped ? 1 : 0, tallest],
        size: [F.W, F.H, F.b, F.spec.coverRadius], page: [F.Wo, F.Hp, F.spec.pageRadius, F.spec.band],
        open: [d.theta, d.gamma, F.sw, F.spec.square],
        look: [designCode(lk.design), rulingCode(d.ruling), d.ring, d.seed],
        foot: [sw, lk.paperCover ? 1 : 0, F.spec.sheet, d.selfShadow && mapped ? 1 : 0],
        recv: [rx0, ry0, rx1, ry1],
        col0: [...lk.cloth, 1], col1: [...lk.band, 1], col2: [...lk.accents[0], 1], col3: [...lk.accents[1], 1], col4: [...lk.accents[2], 1],
        col5: [...lk.endpaper, 1], col6: [...lk.paper, 1], col7: [...lk.ink, 1],
        inkPage: Array.from({ length: INK_TABLE }, (_, k) => (this.inkReady ? d.ink.pages[k] ?? -1 : -1)),
        inkLayer: Array.from({ length: INK_TABLE }, (_, k) => d.ink.layers[k] ?? 0),
      }, i);
    }
    if (n > 0) this.device.queue.writeBuffer(this.recordBuf, 0, this.records.view(n));
    // a book gone from the list gives its buffers back
    for (const [id, b] of this.buffers) if (b.seen !== this.frameNo) { b.vb.destroy(); b.ib.destroy(); this.buffers.delete(id); }
    this.screen = n > 0 ? { x0: sx0, y0: sy0, x1: sx1, y1: sy1 } : null;
    this.stats = { books: n, triangles: tris, shadowed };
    return n;
  }

  get drawn(): NotebookStats { return this.stats; }

  /** The books' screen box on an attachment of `size` device px, clamped to it — the layer's scissor and the composite's; null when none shows. */
  private boxOf(size: { readonly w: number; readonly h: number }, dpr: number): readonly [number, number, number, number] | null {
    if (this.list.length === 0 || !this.screen) return null;
    const W = Math.max(1, size.w);
    const H = Math.max(1, size.h);
    const x0 = Math.max(0, Math.floor(this.screen.x0 * dpr) - 2);
    const y0 = Math.max(0, Math.floor(this.screen.y0 * dpr) - 2);
    const x1 = Math.min(W, Math.ceil(this.screen.x1 * dpr) + 2);
    const y1 = Math.min(H, Math.ceil(this.screen.y1 * dpr) + 2);
    return x1 <= x0 || y1 <= y0 ? null : [x0, y0, x1, y1];
  }

  /** The books' screen box of the last `layer`, device px [x, y, w, h] — what the composite paints at most; null: no layer to lay. */
  get screenBox(): readonly [number, number, number, number] | null { return this.box; }
  private box: readonly [number, number, number, number] | null = null;

  /** Draw the prepared books onto `target` (the canvas, holding what the ground drew). Its own command buffer: the layer, then the composite. */
  render(target: GPUTextureView, size: { readonly w: number; readonly h: number }, dpr: number): void {
    if (!this.boxOf(size, dpr)) { this.box = null; return; }
    this.fit(Math.max(1, size.w), Math.max(1, size.h));
    // the first frames are watched: a validation error names itself on the console instead of hiding behind the submit's
    const watch = this.frameNo < 4;
    if (watch) this.device.pushErrorScope("validation");
    const enc = this.device.createCommandEncoder({ label: "notebook" });
    this.layer(enc, size, dpr);
    // 3. the composite, in a pass of its own over what the canvas holds
    if (!(this.debug & 16)) {
      const comp = enc.beginRenderPass({ label: "notebook/composite", colorAttachments: [{ view: target, loadOp: "load", storeOp: "store" }] });
      this.composite(comp);
      comp.end();
    }
    this.device.queue.submit([enc.finish()]);
    if (watch) void this.device.popErrorScope().then((e) => { if (e) console.error(`notebook pass: ${e.message}`); });
  }

  /**
   * Record this frame's books into their LAYER, into `encoder` — ahead of the pass the layer is laid in (the host's own, `render`;
   * or the desk's frame, the notebook a kind of its registry — kinds/notebook.ts): (1) each book's shadow map, (2) the 4× layer —
   * the books, then the mat under them — resolved. `size`: the attachment's device px. Returns whether there is a layer to lay
   * (its box: `screenBox`).
   */
  layer(encoder: GPUCommandEncoder, size: { readonly w: number; readonly h: number }, dpr: number): boolean {
    const at = this.boxOf(size, dpr);
    this.box = null;
    if (!at) return false;
    const [x0, y0, x1, y1] = at;
    this.fit(Math.max(1, size.w), Math.max(1, size.h));
    // 1. the shadow maps
    this.list.forEach((d, i) => {
      if (i >= MAX_SHADOWED || (this.debug & 8)) return;
      const b = this.buffers.get(d.id);
      if (!b) return;
      const p = encoder.beginRenderPass({ label: `notebook/shadow ${i}`, colorAttachments: [], depthStencilAttachment: { view: this.shadowLayers[i] as GPUTextureView, depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" } });
      p.setPipeline(this.shadowPipe);
      p.setBindGroup(0, this.shadowGroup);
      p.setVertexBuffer(0, b.vb);
      p.setIndexBuffer(b.ib, "uint32");
      p.drawIndexed(b.icount, 1, 0, 0, i);
      p.end();
    });
    // 2. the layer: the books, then the mat under them
    const pass = encoder.beginRenderPass({
      label: "notebook/layer",
      colorAttachments: [{ view: (this.msaa as GPUTexture).createView(), resolveTarget: (this.resolve as GPUTexture).createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "discard" }],
      depthStencilAttachment: { view: (this.depth as GPUTexture).createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "discard" },
    });
    pass.setScissorRect(x0, y0, x1 - x0, y1 - y0);
    pass.setBindGroup(0, this.mainGroup);
    pass.setPipeline(this.bookPipe);
    this.list.forEach((d, i) => {
      const b = this.buffers.get(d.id);
      if (!b || (this.debug & 32)) return;
      pass.setVertexBuffer(0, b.vb);
      pass.setIndexBuffer(b.ib, "uint32");
      pass.drawIndexed(b.icount, 1, 0, 0, i);
    });
    pass.setPipeline(this.recvPipe);
    if (!(this.debug & 64)) for (let i = 0; i < this.list.length; i++) pass.draw(6, 1, 0, i);
    pass.end();
    this.box = [x0, y0, x1 - x0, y1 - y0];
    return true;
  }

  /**
   * (3) Lay the last `layer` over what `pass` holds — premultiplied, one fullscreen triangle — scissored to `scissor` (the books'
   * box, or a part of it a host narrows it to). Nothing without a layer, or with the debug bit 16 (no composite).
   */
  composite(pass: GPURenderPassEncoder, scissor: readonly [number, number, number, number] | null = this.box): void {
    if (!this.box || !scissor || !this.compGroup || (this.debug & 16)) return;
    pass.setScissorRect(scissor[0], scissor[1], scissor[2], scissor[3]);
    pass.setPipeline(this.compPipe);
    pass.setBindGroup(0, this.compGroup);
    pass.draw(3);
  }

  dispose(): void {
    for (const b of this.buffers.values()) { b.vb.destroy(); b.ib.destroy(); }
    this.buffers.clear();
    this.msaa?.destroy(); this.depth?.destroy(); this.resolve?.destroy();
    this.shadowTex.destroy(); this.inkTex.destroy(); this.paperTex.destroy(); this.matBuf.destroy(); this.knobBuf.destroy(); this.recordBuf.destroy();
    void this.format;
  }
}
