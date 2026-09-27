// THE MEMORY LEDGER (design-016 §4.2, K2): live GPU bytes by label, kept through `createTexture` / `createBuffer` and each
// resource's `destroy` — the desk names every resource `<kind>/<what>`, so the kinds' memory falls out of the names, as their
// uploads do (submit-instrument.ts). A resource the garbage collector takes without a `destroy()` leaves the ledger then
// (`collected`); the ledger holds no resource alive. What it cannot see: the swap chain (the canvas's, not made through
// `createTexture`) and anything made before it was installed — WebGPU has no enumeration, so a ledger armed late would
// lie. It is therefore the ONE instrument installed with the device, and only where the host asks (`deskLayer({
// gpuLedger: true })`, D-K2.2): its cost is a map entry and a closure per resource MADE — at boot, a resize, a raster's
// birth — and nothing per frame.
//
// What a texture's texels weigh (design-016 §4, K2) — the byte rule the profiler states, shared by the upload count
// (`copyExternalImageToTexture` carries no byte length: its bytes are the copy's texels in the destination's format) and
// the memory ledger. THE FORMULA: Σ over mips l of ⌈w_l / bw⌉ × ⌈h_l / bh⌉ × blockBytes × layers_l, × sampleCount — w_l =
// max(1, w >> l) and h_l likewise (1 for a 1d texture), layers_l = the array layers (a 3d texture's depth halves per mip
// like its width), and (bw × bh, blockBytes) the format's block: 1 × 1 and the texel's size for every uncompressed format,
// 4 × 4 for BC/ETC2/EAC, the named footprint for ASTC. It is the LOGICAL size — what the texels need, never what the driver
// allocates: tiling, row alignment, lossless compression, a depth24plus stored as 32 bits, a tiler's memoryless MSAA
// attachment all differ from it, both ways.

import { prefixOf, swapMethod } from "./gpu-wrap";

/** A format's block: its footprint in texels and its bytes. `guessed` — a format this table does not know, weighed as 4 bytes a texel. */
export interface FormatBlock { readonly w: number; readonly h: number; readonly bytes: number; readonly guessed?: boolean }

/** The formats no channel-and-width pattern reads. The depth-stencil pairs are their logical bits (24 + 8, 32 + 8). */
const SPECIAL: Readonly<Record<string, number>> = {
  "rgb10a2uint": 4, "rgb10a2unorm": 4, "rg11b10ufloat": 4, "rgb9e5ufloat": 4,
  "stencil8": 1, "depth16unorm": 2, "depth24plus": 4, "depth24plus-stencil8": 4, "depth32float": 4, "depth32float-stencil8": 5,
};

export function formatBlock(format: string): FormatBlock {
  const special = SPECIAL[format];
  if (special !== undefined) return { w: 1, h: 1, bytes: special };
  const plain = /^(r|rg|rgba|bgra)(8|16|32)(unorm|snorm|uint|sint|float)(-srgb)?$/.exec(format);
  if (plain !== null) return { w: 1, h: 1, bytes: ((plain[1] as string).length * Number(plain[2])) / 8 };
  const astc = /^astc-(\d+)x(\d+)-/.exec(format);
  if (astc !== null) return { w: Number(astc[1]), h: Number(astc[2]), bytes: 16 };
  if (/^(bc1-|bc4-|etc2-rgb8unorm|etc2-rgb8a1unorm|eac-r11)/.test(format)) return { w: 4, h: 4, bytes: 8 };
  if (/^(bc[2356]-|bc6h-|bc7-|etc2-rgba8unorm|eac-rg11)/.test(format)) return { w: 4, h: 4, bytes: 16 };
  return { w: 1, h: 1, bytes: 4, guessed: true };
}

/** An extent's width, height and depth-or-layers — the list form (`[w, h?, d?]`) or the dictionary form. */
export function extentOf(size: GPUExtent3DStrict): [number, number, number] {
  if (Symbol.iterator in Object(size)) {
    const [w = 1, h = 1, d = 1] = [...(size as Iterable<number>)];
    return [w, h, d];
  }
  const s = size as GPUExtent3DDictStrict;
  return [s.width, s.height ?? 1, s.depthOrArrayLayers ?? 1];
}

/** The bytes of `size` texels of `format` in one mip (a copy's weight): ⌈w / bw⌉ × ⌈h / bh⌉ × blockBytes × depth. */
export function regionBytes(format: string, size: GPUExtent3DStrict): number {
  const [w, h, d] = extentOf(size);
  const b = formatBlock(format);
  return Math.ceil(w / b.w) * Math.ceil(h / b.h) * b.bytes * d;
}

/** A texture's logical bytes by the formula above. */
export function textureBytes(d: { readonly size: GPUExtent3DStrict; readonly format: string; readonly mipLevelCount?: number; readonly sampleCount?: number; readonly dimension?: GPUTextureDimension }): number {
  const [w, h, layers] = extentOf(d.size);
  const b = formatBlock(d.format);
  let total = 0;
  for (let l = 0; l < (d.mipLevelCount ?? 1); l++) {
    const lw = Math.max(1, w >> l);
    const lh = d.dimension === "1d" ? 1 : Math.max(1, h >> l);
    const ld = d.dimension === "3d" ? Math.max(1, layers >> l) : layers;
    total += Math.ceil(lw / b.w) * Math.ceil(lh / b.h) * b.bytes * ld;
  }
  return total * (d.sampleCount ?? 1);
}

/** One ledger row: the live bytes, and how many textures and buffers make them. */
export interface GpuMemoryRow { readonly bytes: number; readonly textures: number; readonly buffers: number }

/** The ledger's reading: live bytes by label prefix (the kind), textures and buffers apart, the total; and its turnover. */
export interface GpuMemory {
  /** Live bytes by the resource's label prefix — `paper`, `board`, `photo` …; `?` for an unlabelled one. */
  readonly byLabel: Readonly<Record<string, GpuMemoryRow>>;
  readonly textures: number;
  readonly buffers: number;
  readonly total: number;
  /** Resources made since the install (a make every frame is a finding), destroyed, and taken by the collector undestroyed. */
  readonly made: number;
  readonly destroyed: number;
  readonly collected: number;
  /** Textures whose format the byte table does not know (weighed as 4 bytes a texel). */
  readonly guessed: number;
}

export interface MemoryLedger {
  /** The ledger as of now (a fresh copy). */
  read(): GpuMemory;
  /** The `n` heaviest live labels, full label (`board/ink 12` — every board's raster its own row), heaviest first. */
  top(n?: number): readonly { readonly label: string; readonly bytes: number; readonly count: number }[];
  /** Restore the device's own `createTexture` / `createBuffer`. What it made meanwhile still reports its `destroy` to nobody. Idempotent. */
  detach(): void;
}

interface Entry { readonly label: string; readonly prefix: string; readonly bytes: number; readonly texture: boolean; live: boolean }
interface Row { bytes: number; textures: number; buffers: number }

const ledgers = new WeakMap<GPUDevice, MemoryLedger>();

/** Keep a ledger of `device`'s live textures and buffers from now on. One per device: asking twice returns the one. */
export function instrumentMemory(device: GPUDevice): MemoryLedger {
  const existing = ledgers.get(device);
  if (existing !== undefined) return existing;
  const byPrefix = new Map<string, Row>();
  const byLabel = new Map<string, { bytes: number; count: number }>();
  let textures = 0;
  let buffers = 0;
  let made = 0;
  let destroyed = 0;
  let collected = 0;
  let guessed = 0;
  let attached = true;

  const add = (e: Entry, sign: 1 | -1): void => {
    const row = byPrefix.get(e.prefix) ?? { bytes: 0, textures: 0, buffers: 0 };
    row.bytes += sign * e.bytes;
    if (e.texture) row.textures += sign; else row.buffers += sign;
    if (row.textures === 0 && row.buffers === 0) byPrefix.delete(e.prefix); else byPrefix.set(e.prefix, row);
    const l = byLabel.get(e.label) ?? { bytes: 0, count: 0 };
    l.bytes += sign * e.bytes;
    l.count += sign;
    if (l.count === 0) byLabel.delete(e.label); else byLabel.set(e.label, l);
    if (e.texture) textures += sign * e.bytes; else buffers += sign * e.bytes;
  };
  // the collector's word on a resource dropped without `destroy()` — its memory went with it
  const gone = new FinalizationRegistry<Entry>((e) => { if (e.live) { e.live = false; add(e, -1); collected += 1; } });
  const keep = <R extends GPUTexture | GPUBuffer>(resource: R, label: string | undefined, bytes: number, texture: boolean): R => {
    const name = label ?? "";
    const entry: Entry = { label: name.length > 0 ? name : "?", prefix: prefixOf(name), bytes, texture, live: true };
    made += 1;
    add(entry, 1);
    gone.register(resource, entry, entry);
    const destroy = resource.destroy;
    resource.destroy = () => {
      if (entry.live) { entry.live = false; add(entry, -1); destroyed += 1; gone.unregister(entry); }
      return destroy.call(resource);
    };
    return resource;
  };

  const originalTexture = device.createTexture;
  const originalBuffer = device.createBuffer;
  const undo = [
    swapMethod(device, "createTexture", ((d: GPUTextureDescriptor) => {
      const t = originalTexture.call(device, d);
      if (formatBlock(d.format).guessed === true) guessed += 1;
      return attached ? keep(t, d.label, textureBytes(d), true) : t;
    }) as GPUDevice["createTexture"]),
    swapMethod(device, "createBuffer", ((d: GPUBufferDescriptor) => {
      const b = originalBuffer.call(device, d);
      return attached ? keep(b, d.label, d.size, false) : b;
    }) as GPUDevice["createBuffer"]),
  ];

  const ledger: MemoryLedger = {
    read() {
      const rows: Record<string, GpuMemoryRow> = {};
      for (const [k, r] of byPrefix) rows[k] = { bytes: r.bytes, textures: r.textures, buffers: r.buffers };
      return { byLabel: rows, textures, buffers, total: textures + buffers, made, destroyed, collected, guessed };
    },
    top(n = 8) {
      return [...byLabel].map(([label, l]) => ({ label, bytes: l.bytes, count: l.count })).sort((a, b) => b.bytes - a.bytes).slice(0, n);
    },
    detach() {
      if (!attached) return;
      attached = false;
      for (const u of undo) u();
      ledgers.delete(device);
    },
  };
  ledgers.set(device, ledger);
  return ledger;
}
