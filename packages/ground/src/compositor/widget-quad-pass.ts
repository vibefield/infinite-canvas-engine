/**
 * `WidgetQuadPass` — the widget half of the unified compositor (design-012 §4,
 * plan §1). S2 makes it REAL for `dom` sources: the WGSL lands here, against a
 * pixel oracle, now that there is a source kind to exercise it.
 *
 * What is load-bearing, and why it is shaped this way:
 *
 *  - It consumes the `CompositorSourceRegistry` from core, so producers reach
 *    the compositor without anyone importing `ground` (which nothing may).
 *  - Paint order is the frame-parent SIBLING SEQUENCE (petition 8), supplied as
 *    a seam. Registration order is emphatically NOT paint order.
 *  - It is LAZY: with an empty registry it creates no pipeline, no buffer and
 *    no bind group. An "empty compositor" that allocated at boot would put GPU
 *    cost on the stratified-equivalent path.
 *  - It never opens or submits anything: one encoder, one pass, one submit per
 *    composite belongs to the reflector (§4).
 *
 * THE SHADER, decision by decision:
 *
 *  - **Analytic rounded-rect AA**, because the compositor target carries no
 *    MSAA (§4 — MSAA lives inside island render targets only). A signed
 *    distance to the rounded rect, with a `fwidth`-wide transition.
 *  - **A zero radius takes an exact branch, not the SDF.** On a straight edge
 *    `fwidth(d)` is 1 and the SDF is already pixel-exact, but at a square
 *    CORNER both derivatives contribute and `fwidth` reaches ~1.41, which
 *    would leave the corner pixel at ~85 % coverage. That is invisible to the
 *    eye and fatal to a pixel-compare against a square DOM card, which is the
 *    S2 exit. Radius 0 ⇒ coverage 1; the quad's own geometry is the clip.
 *  - **The sRGB re-encode is guarded by the ACTUAL formats**, never assumed
 *    (§4's sRGB law). What matters is whether SOURCE and TARGET disagree:
 *    sampling an `-srgb` texture auto-decodes to linear, writing to one
 *    auto-encodes. dom atlas pages are `rgba8unorm` and the swap chain is not
 *    `-srgb`, so dom quads are a pure passthrough — the conversion path exists
 *    for the island sources arriving at S5, whose targets ARE `-srgb`.
 *  - **Conversion is defined on unpremultiplied colour**, so the shader undoes
 *    and redoes the alpha around it. Skipping that is invisible on the opaque
 *    cards S2 composites and wrong on everything else.
 *  - **Premultiplication is a declared fact, not a guess.** `premultiplied`
 *    says whether the source's bytes already carry alpha; the rig measures it
 *    rather than the shader assuming it.
 */
import type { CompositorSourceRegistry } from "@ice/core";
import type { Entity } from "@vibecook/strata-ecs";
import { BufferUsage, ShaderStage } from "./gpu-flags";

/** Per-composite frame facts, in DEVICE pixels (the swap chain's own space). */
export interface CompositeFrame {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  /** Engine camera: world top-left + zoom (the GroundFrame contract). */
  readonly camera: { readonly x: number; readonly y: number; readonly zoom: number };
}

/**
 * The per-entity composite facts the registry deliberately does not carry
 * (plan §1: "the registry + the sibling-order index + per-entity composite
 * facts"). Geometry is in WORLD units — the pass applies the camera, exactly
 * as the content plane's single CSS transform does for live-dom hosts.
 */
export interface QuadFacts {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** 1 when absent. The GPU twin of the host's `style.opacity`. */
  readonly opacity?: number;
  /** Corner radius in CSS px; scaled by zoom×dpr like a CSS radius would be. */
  readonly radius?: number;
}

/** Where a quad samples from. Resolved per kind; the shader sees only this. */
export interface QuadTexture {
  /** A sampled texture (dom atlas page, gl island target, ground's target). */
  readonly texture?: GPUTexture;
  /** Source sub-rect in TEXELS. The full texture for gl/video; a slot for dom. */
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly textureWidth: number;
  readonly textureHeight: number;
  /** The texture's ACTUAL format is `-srgb` (so sampling auto-decodes). */
  readonly srgb?: boolean;
  /** The stored bytes already carry alpha. Default true. */
  readonly premultiplied?: boolean;
  /**
   * A `video` source's frame, imported as a `GPUExternalTexture` INSIDE this
   * composite (design-012 §4). Mutually exclusive with `texture`.
   *
   * The import happens in `encode` and nowhere else, because an imported
   * external texture is valid only for the task that imported it — carrying
   * one across an `await` is the same class of mistake as holding a
   * swap-chain texture across one. The source's own retention policy decides
   * WHICH frame this is; the compositor only samples what it is handed.
   */
  readonly external?: object;
  /**
   * The source's rows run BOTTOM-UP relative to the compositor. three renders
   * y-up while the compositor is top-down, so island targets set this; HiC
   * atlas slots do not.
   *
   * Expressed in the UV RECT rather than in the shader: the packing emits the
   * rect's bottom edge as the origin and a NEGATIVE height, so the existing
   * `uv.xy + corner * uv.zw` interpolation walks the source upward. No branch
   * in the fragment shader, no extra instance lane, and it stays exact — at a
   * 1:1 mapping the flipped tap still lands on a texel centre.
   */
  readonly flipY?: boolean;
}

export interface WidgetQuadPassDeps {
  readonly device: GPUDevice;
  /** The compositor target's format — the sRGB guard reads this, never assumes. */
  readonly format: GPUTextureFormat;
  readonly registry: CompositorSourceRegistry;
  /**
   * Paint order: the entities to draw, back to front, in frame-parent sibling
   * sequence (petition 8). Omitted ⇒ registry order, which is correct ONLY
   * while the registry is empty.
   */
  readonly order?: () => readonly Entity[];
  /** Per-entity geometry/opacity/radius. A quad without facts is not drawn. */
  readonly facts?: (entity: Entity) => QuadFacts | undefined;
  /**
   * Resolve an entity's sampling source. A source that resolves to `undefined`
   * is SKIPPED — that is how an atlas slot whose pixels are not resident yet
   * (fresh, re-slotted, or just repacked) declines to composite rather than
   * sampling whatever used to live at its rect.
   */
  readonly resolve?: (entity: Entity, source: unknown) => QuadTexture | undefined;
  /**
   * GROUND, as the pass's FIRST quad (design-012 §4: "ground pipeline(s)
   * first, then widget quads"; S6b).
   *
   * Ground renders its own programs — design-011's GroundHost, the magnet
   * grid's TSL, the whole pass registry — into an offscreen target, and the
   * compositor draws that target full-viewport before any widget. That is what
   * collapses two presents into one: ground stops owning a swap chain, and the
   * compositor reflector becomes the only `getCurrentTexture` caller.
   *
   * It is NOT a registry source, deliberately. Ground is not a widget: it has
   * no entity, no sibling ordinal, no lift and no demand, and giving it a fake
   * entity to ride the ordinal sort would put it one bad comparator away from
   * painting over the board.
   *
   * Returning `undefined` (ground not ready, or a stratified build) simply
   * draws no background — the widgets still composite.
   */
  readonly background?: () => QuadTexture | undefined;
}

export interface WidgetQuadPass {
  readonly name: string;
  /** Quads encoded by the most recent `encode` (0 on an empty registry). */
  drawn(): number;
  /** True when the most recent `encode` drew ground's target first. */
  drewBackground(): boolean;
  /** Draw calls issued by the most recent `encode` (one per texture run). */
  batches(): number;
  /** Quads skipped because their source had no resident pixels yet. */
  skipped(): number;
  /** True once GPU resources have actually been built — never, while empty. */
  armed(): boolean;
  /**
   * Encode this frame's widget quads into an ALREADY-OPEN render pass.
   * Returns the number of quads encoded.
   */
  encode(pass: GPURenderPassEncoder, frame: CompositeFrame): number;
  dispose(): void;
}

/** floats per quad in the storage buffer: dst(4) + uv(4) + params(4). */
const FLOATS_PER_QUAD = 12;
const BYTES_PER_QUAD = FLOATS_PER_QUAD * 4;

/** How the shader must convert between source and target encodings. */
const ENCODE_PASSTHROUGH = 0;
const ENCODE_LINEAR_TO_SRGB = 1;
const ENCODE_SRGB_TO_LINEAR = 2;

const isSrgbFormat = (format: GPUTextureFormat): boolean => format.endsWith("-srgb");

/**
 * The conversion the shader owes, given what the sample yields and what the
 * target expects. Both halves are read from ACTUAL formats.
 *
 * | source texture | sample yields | target        | target wants | ⇒ |
 * |---|---|---|---|---|
 * | `-srgb`     | linear    | `-srgb`     | linear    | passthrough |
 * | `-srgb`     | linear    | plain       | sRGB      | encode |
 * | plain       | sRGB      | plain       | sRGB      | passthrough |
 * | plain       | sRGB      | `-srgb`     | linear    | decode |
 */
function encodeMode(sourceSrgb: boolean, targetSrgb: boolean): number {
  if (sourceSrgb === targetSrgb) return ENCODE_PASSTHROUGH;
  return sourceSrgb ? ENCODE_LINEAR_TO_SRGB : ENCODE_SRGB_TO_LINEAR;
}

/**
 * ONE shader, two source bindings.
 *
 * A `video` source arrives as a `GPUExternalTexture`, which is a different
 * WGSL type from a sampled texture (`texture_external`, sampled with
 * `textureSampleBaseClampToEdge`) and needs its own bind-group layout entry
 * and pipeline. Everything else about a video quad — the rect, the rounded
 * corners, the sRGB lane, the premultiplied blend — is identical to a dom or
 * gl one, so the two variants are GENERATED from one template rather than
 * maintained as two files. A divergence between them would be a video quad
 * that fades or rounds differently from the card beside it.
 */
const shaderSource = (external: boolean): string => /* wgsl */ `
struct Frame {
  resolution : vec2f,
  _pad       : vec2f,
};

struct Quad {
  dst    : vec4f,  // x, y, w, h — device px, y down
  uv     : vec4f,  // x, y, w, h — normalized within the source texture
  params : vec4f,  // radius(px), opacity, encodeMode, premultiplied
};

@group(0) @binding(0) var<uniform> frame : Frame;
@group(0) @binding(1) var<storage, read> quads : array<Quad>;
@group(0) @binding(2) var src : ${external ? "texture_external" : "texture_2d<f32>"};
@group(0) @binding(3) var srcSampler : sampler;

struct VsOut {
  @builtin(position) pos   : vec4f,
  @location(0)       local : vec2f,
  @location(1)       uv    : vec2f,
  @location(2) @interpolate(flat) inst : u32,
};

@vertex
fn vs(@builtin(vertex_index) vi : u32, @builtin(instance_index) ii : u32) -> VsOut {
  var corners = array<vec2f, 6>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
    vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),
  );
  let c = corners[vi];
  let q = quads[ii];

  let px  = q.dst.xy + c * q.dst.zw;
  // Device px (y down) -> clip space (y up).
  let ndc = vec2f(px.x / frame.resolution.x * 2.0 - 1.0,
                  1.0 - px.y / frame.resolution.y * 2.0);

  var out : VsOut;
  out.pos   = vec4f(ndc, 0.0, 1.0);
  out.local = c * q.dst.zw;
  out.uv    = q.uv.xy + c * q.uv.zw;
  out.inst  = ii;
  return out;
}

/** Signed distance to a rounded rect centred at the origin. */
fn sdRoundRect(p : vec2f, halfSize : vec2f, r : f32) -> f32 {
  let q = abs(p) - halfSize + vec2f(r, r);
  return length(max(q, vec2f(0.0, 0.0))) + min(max(q.x, q.y), 0.0) - r;
}

fn srgbToLinear(c : vec3f) -> vec3f {
  let lo = c / 12.92;
  let hi = pow((c + vec3f(0.055)) / 1.055, vec3f(2.4));
  return select(hi, lo, c <= vec3f(0.04045));
}

fn linearToSrgb(c : vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(c, vec3f(1.0 / 2.4)) - vec3f(0.055);
  return select(hi, lo, c <= vec3f(0.0031308));
}

@fragment
fn fs(in : VsOut) -> @location(0) vec4f {
  let q = quads[in.inst];
  var color = ${external
    ? "textureSampleBaseClampToEdge(src, srcSampler, in.uv)"
    : "textureSample(src, srcSampler, in.uv)"};

  // Straight alpha in, premultiplied out — the blend state expects the latter.
  if (q.params.w < 0.5) {
    color = vec4f(color.rgb * color.a, color.a);
  }

  // Encoding conversion, on UNPREMULTIPLIED colour.
  let mode = u32(q.params.z + 0.5);
  if (mode != 0u && color.a > 0.0) {
    let straight = color.rgb / color.a;
    var converted = straight;
    if (mode == 1u) {
      converted = linearToSrgb(straight);
    } else {
      converted = srgbToLinear(straight);
    }
    color = vec4f(converted * color.a, color.a);
  }

  // Coverage. A square card must be pixel-exact (see the header): only a real
  // radius goes through the SDF.
  //
  // The SDF and its derivative are evaluated UNCONDITIONALLY and selected
  // afterwards, never inside a branch. radius is per-instance, so branching on
  // it is non-uniform control flow, and a derivative built there is a COMPILE
  // ERROR, not a subtle artefact:
  //   "error: 'fwidth' must only be called from uniform control flow"
  let radius    = q.params.x;
  let halfSize  = q.dst.zw * 0.5;
  let d         = sdRoundRect(in.local - halfSize, halfSize, max(radius, 0.0));
  let aa        = max(fwidth(d), 1.0e-5);
  let softened  = clamp(0.5 - d / aa, 0.0, 1.0);
  let coverage  = select(1.0, softened, radius > 0.0);

  return color * coverage * q.params.y;
}
`;


export function createWidgetQuadPass(deps: WidgetQuadPassDeps): WidgetQuadPass {
  const { device, format, registry } = deps;
  const targetSrgb = isSrgbFormat(format);

  let drawn = 0;
  let batches = 0;
  let skipped = 0;
  let drewBackground = false;

  // Built on first use and never while the registry is empty (the S1 law).
  let pipeline: GPURenderPipeline | undefined;
  let layout: GPUBindGroupLayout | undefined;
  /** The `texture_external` variant — built only if a video source appears. */
  let externalPipeline: GPURenderPipeline | undefined;
  let externalLayout: GPUBindGroupLayout | undefined;
  let sampler: GPUSampler | undefined;
  let uniformBuffer: GPUBuffer | undefined;
  let storageBuffer: GPUBuffer | undefined;
  let storageCapacity = 0;
  let scratch = new Float32Array(0);
  /** Keyed by source texture; dropped whenever a bound buffer is replaced. */
  const bindGroups = new Map<GPUTexture, GPUBindGroup>();

  /**
   * Build the pipeline for one source binding. Two variants exist because a
   * `GPUExternalTexture` is a different WGSL type; everything else is shared,
   * including the blend state, so a video quad composites by exactly the same
   * rules as the card next to it.
   */
  function armVariant(external: boolean): void {
    if ((external ? externalPipeline : pipeline) !== undefined) return;
    const label = external ? "widget-quads-external" : "widget-quads";
    const module = device.createShaderModule({ label, code: shaderSource(external) });
    const bindLayout = device.createBindGroupLayout({
      label,
      entries: [
        { binding: 0, visibility: ShaderStage.VERTEX, buffer: { type: "uniform" } },
        {
          binding: 1,
          visibility: ShaderStage.VERTEX | ShaderStage.FRAGMENT,
          buffer: { type: "read-only-storage" },
        },
        external
          ? { binding: 2, visibility: ShaderStage.FRAGMENT, externalTexture: {} }
          : { binding: 2, visibility: ShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 3, visibility: ShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      ],
    });
    const built = device.createRenderPipeline({
      label,
      layout: device.createPipelineLayout({ bindGroupLayouts: [bindLayout] }),
      vertex: { module, entryPoint: "vs" },
      fragment: {
        module,
        entryPoint: "fs",
        targets: [
          {
            format,
            // Premultiplied source-over. The shader emits premultiplied colour.
            blend: {
              color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
              alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
            },
          },
        ],
      },
      primitive: { topology: "triangle-list" },
      // No depth buffer, no MSAA on the compositor target (§4).
    });
    if (external) {
      externalPipeline = built;
      externalLayout = bindLayout;
    } else {
      pipeline = built;
      layout = bindLayout;
    }
  }

  function arm(): void {
    armVariant(false);
    if (sampler !== undefined) return;
    // Clamp-to-edge + linear: the atlas's 1–2 px gutters exist precisely so a
    // linear tap at a slot edge cannot reach a neighbour's pixels.
    sampler = device.createSampler({
      label: "widget-quads",
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    uniformBuffer = device.createBuffer({
      label: "widget-quads-frame",
      size: 16,
      usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST,
    });
  }

  function ensureStorage(quadCount: number): void {
    if (storageBuffer !== undefined && storageCapacity >= quadCount) return;
    const capacity = Math.max(16, 1 << Math.ceil(Math.log2(Math.max(1, quadCount))));
    storageBuffer?.destroy();
    storageBuffer = device.createBuffer({
      label: "widget-quads-instances",
      size: capacity * BYTES_PER_QUAD,
      usage: BufferUsage.STORAGE | BufferUsage.COPY_DST,
    });
    storageCapacity = capacity;
    scratch = new Float32Array(capacity * FLOATS_PER_QUAD);
    // Every bind group named the old buffer.
    bindGroups.clear();
  }

  function bindGroupFor(texture: GPUTexture): GPUBindGroup {
    const existing = bindGroups.get(texture);
    if (existing !== undefined) return existing;
    const group = device.createBindGroup({
      label: "widget-quads",
      layout: layout as GPUBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer as GPUBuffer } },
        { binding: 1, resource: { buffer: storageBuffer as GPUBuffer } },
        { binding: 2, resource: texture.createView() },
        { binding: 3, resource: sampler as GPUSampler },
      ],
    });
    bindGroups.set(texture, group);
    return group;
  }

  /**
   * Import a video frame and bind it, FOR THIS COMPOSITE ONLY.
   *
   * `importExternalTexture` returns a handle that expires at the end of the
   * task that imported it, so neither the texture nor its bind group is ever
   * cached — the same rule that governs a swap-chain texture. This runs inside
   * `encode`, which is inside the reflector's synchronous flush, so the import
   * never crosses an await (design-012 §4, plan §5 S7.1).
   */
  function externalBindGroup(source: object): GPUBindGroup {
    const external = device.importExternalTexture({ source: source as HTMLVideoElement });
    return device.createBindGroup({
      label: "widget-quads-external",
      layout: externalLayout as GPUBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer as GPUBuffer } },
        { binding: 1, resource: { buffer: storageBuffer as GPUBuffer } },
        { binding: 2, resource: external },
        { binding: 3, resource: sampler as GPUSampler },
      ],
    });
  }

  const paintOrder = (): readonly Entity[] => {
    if (deps.order !== undefined) return deps.order();
    const out: Entity[] = [];
    for (const [entity] of registry.entries()) out.push(entity);
    return out;
  };

  return {
    name: "widget-quads",
    drawn: () => drawn,
    batches: () => batches,
    skipped: () => skipped,
    drewBackground: () => drewBackground,
    armed: () => pipeline !== undefined,

    encode(pass, frame) {
      drawn = 0;
      batches = 0;
      skipped = 0;
      drewBackground = false;

      // Ground first — it is the background, and painter's order is the whole
      // ordering contract here.
      const ground = deps.background?.();
      const order = registry.size() === 0 ? [] : paintOrder();
      // Empty registry AND no ground ⇒ draws nothing, allocates nothing,
      // touches no GPU object. The S1 exit condition, kept.
      if (ground === undefined && order.length === 0) return 0;

      const resolve = deps.resolve;
      const facts = deps.facts;
      if (order.length > 0 && (resolve === undefined || facts === undefined)) {
        // A producer registered ahead of the wiring that can sample it. Say so
        // rather than drawing a wrong frame or silently skipping.
        console.warn(
          `[ice] compositor: ${order.length} source(s) registered without a resolve/facts seam — nothing drawn`,
        );
        return 0;
      }

      // --- gather, in paint order ------------------------------------------
      const scale = frame.camera.zoom * frame.dpr;
      const runs: Array<{
        texture?: GPUTexture;
        /** A video frame, imported below in this same task. */
        external?: object;
        first: number;
        count: number;
      }> = [];
      let quadCount = 0;
      // Sized before the walk so `scratch` is stable while it is filled.
      // +1 for ground's own quad, which is not in the registry.
      ensureStorage(order.length + 1);

      // GROUND, at instance 0. Full viewport, no camera: the camera is already
      // inside the pixels — ground's passes drew the grid at this camera when
      // they rendered into the target. Applying it again here would move the
      // grid twice.
      if (ground !== undefined) {
        const base = quadCount * FLOATS_PER_QUAD;
        scratch[base + 0] = 0;
        scratch[base + 1] = 0;
        scratch[base + 2] = frame.width;
        scratch[base + 3] = frame.height;
        scratch[base + 4] = ground.rect.x / ground.textureWidth;
        scratch[base + 5] = ground.flipY === true
          ? (ground.rect.y + ground.rect.height) / ground.textureHeight
          : ground.rect.y / ground.textureHeight;
        scratch[base + 6] = ground.rect.width / ground.textureWidth;
        scratch[base + 7] = ground.flipY === true
          ? -ground.rect.height / ground.textureHeight
          : ground.rect.height / ground.textureHeight;
        scratch[base + 8] = 0; // no radius — ground is the whole viewport
        scratch[base + 9] = 1;
        scratch[base + 10] = encodeMode(ground.srgb === true, targetSrgb);
        scratch[base + 11] = ground.premultiplied === false ? 0 : 1;
        runs.push({ texture: ground.texture as GPUTexture, first: quadCount, count: 1 });
        quadCount++;
        drewBackground = true;
      }

      for (const entity of order) {
        if (resolve === undefined || facts === undefined) break;
        const source = registry.get(entity);
        if (source === undefined) continue;
        const geom = facts(entity);
        if (geom === undefined) continue;

        const dx = (geom.x - frame.camera.x) * scale;
        const dy = (geom.y - frame.camera.y) * scale;
        const dw = geom.w * scale;
        const dh = geom.h * scale;
        if (dw <= 0 || dh <= 0) continue;
        // Cheap viewport cull — an off-screen quad costs nothing to skip and a
        // full quad of fill-rate to keep (pan is the expensive mode, §4).
        if (dx + dw <= 0 || dy + dh <= 0 || dx >= frame.width || dy >= frame.height) continue;

        const tex = resolve(entity, source);
        if (tex === undefined) {
          // No resident pixels yet — decline rather than sample a stale rect.
          skipped++;
          continue;
        }

        const base = quadCount * FLOATS_PER_QUAD;
        scratch[base + 0] = dx;
        scratch[base + 1] = dy;
        scratch[base + 2] = dw;
        scratch[base + 3] = dh;
        // The y-flip is a negative-height UV rect — see QuadTexture.flipY.
        const flip = tex.flipY === true;
        scratch[base + 4] = tex.rect.x / tex.textureWidth;
        scratch[base + 5] = flip
          ? (tex.rect.y + tex.rect.height) / tex.textureHeight
          : tex.rect.y / tex.textureHeight;
        scratch[base + 6] = tex.rect.width / tex.textureWidth;
        scratch[base + 7] = flip
          ? -tex.rect.height / tex.textureHeight
          : tex.rect.height / tex.textureHeight;
        scratch[base + 8] = (geom.radius ?? 0) * scale;
        scratch[base + 9] = geom.opacity ?? 1;
        scratch[base + 10] = encodeMode(tex.srgb === true, targetSrgb);
        scratch[base + 11] = tex.premultiplied === false ? 0 : 1;

        // Runs keep paint order: a new draw call starts only when the source
        // changes, so interleaved pages stay correctly ordered. A VIDEO source
        // never merges — every frame is its own import and its own bind group,
        // and two video quads are never the same external texture.
        const last = runs[runs.length - 1];
        if (tex.external !== undefined) {
          runs.push({ external: tex.external, first: quadCount, count: 1 });
        } else if (last !== undefined && last.external === undefined && last.texture === tex.texture) {
          last.count++;
        } else {
          runs.push({ texture: tex.texture as GPUTexture, first: quadCount, count: 1 });
        }
        quadCount++;
      }

      if (quadCount === 0) return 0;

      arm();
      device.queue.writeBuffer(
        uniformBuffer as GPUBuffer,
        0,
        new Float32Array([frame.width, frame.height, 0, 0]),
      );
      device.queue.writeBuffer(
        storageBuffer as GPUBuffer,
        0,
        scratch.buffer,
        scratch.byteOffset,
        quadCount * BYTES_PER_QUAD,
      );

      let boundExternal: boolean | undefined;
      for (const run of runs) {
        const isExternal = run.external !== undefined;
        if (isExternal) armVariant(true);
        // Set the pipeline only when the variant changes — a board of dom
        // cards with one video card costs two switches, not one per quad.
        if (boundExternal !== isExternal) {
          pass.setPipeline((isExternal ? externalPipeline : pipeline) as GPURenderPipeline);
          boundExternal = isExternal;
        }
        pass.setBindGroup(
          0,
          isExternal
            ? externalBindGroup(run.external as object)
            : bindGroupFor(run.texture as GPUTexture),
        );
        // `instance_index` starts at `firstInstance`, so each run indexes its
        // own slice of the shared instance buffer.
        pass.draw(6, run.count, 0, run.first);
        batches++;
      }
      drawn = quadCount;
      return quadCount;
    },

    dispose() {
      bindGroups.clear();
      storageBuffer?.destroy();
      storageBuffer = undefined;
      uniformBuffer?.destroy();
      uniformBuffer = undefined;
      storageCapacity = 0;
      scratch = new Float32Array(0);
      pipeline = undefined;
      layout = undefined;
      externalPipeline = undefined;
      externalLayout = undefined;
      sampler = undefined;
      drawn = 0;
      batches = 0;
      skipped = 0;
    },
  };
}
