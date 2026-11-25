// THE PEN ON THE GPU (petition I59 — the desk's pen): what a kind binds to call `hand_ink` (shaders/kit/hand.wgsl) —
//  - the face's ATLAS, once a desk: `rg8unorm` with its mip chain (kit/hand-run.ts `handMips` — made on the CPU, the same bytes on
//    every host), CACHED PER DEVICE AND ATLAS, so every kind that writes in a face binds the one texture (`handAtlasGpu`);
//  - the atlas's SAMPLER (`handSampler`: linear, linear, linear between the levels, clamped), once a device;
//  - a kind's RUN STORE (`createHandRuns`): its objects' runs (kit/hand-run.ts `handRun`) in one `rgba32float` texture, 1,024
//    texels a row, written per object and grown by copy, an object's BASE (a texel index) handed back for its record — shared by
//    the kind's slots as the note's ink pages are;
//  - the three bindings under the kind's own names (`handBindings`), for its pass's layout and its card material.
// The runs are a TEXTURE, not a storage buffer, because `hand_ink` takes them as a parameter (the piece is pure — engine/shader.ts —
// and composed once in the flat card, card/card.ts, beside every other kind's bindings) and core WGSL passes no storage buffer to a
// function. DOM-free: the GPU's flags are read at call time.

import type { BindKind } from "../engine/pipeline";
import type { CardBinding } from "../kind";
import type { HandAtlas } from "./hand-atlas";
import { HAND_RUN, type HandRun, handMips } from "./hand-run";
import type { PenKey } from "./pen-clock";

/** A face's atlas on one device: its texture (every level), the view to bind, and its size. */
export interface HandAtlasGpu {
  readonly texture: GPUTexture;
  /** A `texture_2d<f32>` view of every level — the kind's atlas binding. */
  readonly view: GPUTextureView;
  readonly levels: number;
  /** Level 0's texels: the atlas padded to a multiple of 2^(levels − 1) (the twin's `handMips` is the same). */
  readonly width: number;
  readonly height: number;
  /** What it weighs on the device, every level. */
  readonly bytes: number;
}

const atlases = new WeakMap<GPUDevice, WeakMap<HandAtlas, HandAtlasGpu>>();
const samplers = new WeakMap<GPUDevice, GPUSampler>();

/**
 * The face's atlas on `device` — made the first time any kind asks, every level written from `handMips`, and the SAME texture for
 * every later ask on that device (every kind, every slot). It lives as long as the device: a desk lends a face for its whole life.
 */
export function handAtlasGpu(device: GPUDevice, atlas: HandAtlas): HandAtlasGpu {
  let byAtlas = atlases.get(device);
  if (byAtlas === undefined) { byAtlas = new WeakMap(); atlases.set(device, byAtlas); }
  const had = byAtlas.get(atlas);
  if (had !== undefined) return had;
  const chain = handMips(atlas);
  const top = chain[0] as (typeof chain)[number];
  const texture = device.createTexture({
    label: `hand/${atlas.family} ${atlas.weight}`, size: [top.w, top.h], format: "rg8unorm", mipLevelCount: chain.length,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  let bytes = 0;
  chain.forEach((m, level) => {
    device.queue.writeTexture({ texture, mipLevel: level }, m.bytes as Uint8Array<ArrayBuffer>, { bytesPerRow: m.w * 2, rowsPerImage: m.h }, [m.w, m.h]);
    bytes += m.bytes.byteLength;
  });
  const made: HandAtlasGpu = { texture, view: texture.createView({ dimension: "2d" }), levels: chain.length, width: top.w, height: top.h, bytes };
  byAtlas.set(atlas, made);
  return made;
}

/** The atlas's sampler on `device`: linear, linear, linear between the levels, clamped to the edge — one a device. */
export function handSampler(device: GPUDevice): GPUSampler {
  let s = samplers.get(device);
  if (s === undefined) {
    s = device.createSampler({ label: "hand/atlas", magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
    samplers.set(device, s);
  }
  return s;
}

/** The three bindings `hand_ink` reads, as a layout states them: the run store, the atlas, the sampler (fragment stage). */
export const HAND_BINDINGS: { readonly runs: BindKind; readonly atlas: BindKind; readonly sampler: BindKind } = {
  runs: { stages: ["fragment"], texture: "unfilterable-float" },
  atlas: { stages: ["fragment"], texture: "float" },
  sampler: { stages: ["fragment"], sampler: "filtering" },
};

/**
 * The pen's three bindings under a kind's OWN names — `<prefix>_hand_runs`, `<prefix>_hand_atlas`, `<prefix>_hand_samp` — for its
 * card material's `bindings` (in this order: the store's `view`, `handAtlasGpu(…).view`, `handSampler(…)`) or, through each
 * `entry`, its own pass's layout. Its fragment then calls `hand_ink(<prefix>_hand_runs, <prefix>_hand_atlas, <prefix>_hand_samp, …)`.
 */
export function handBindings(prefix: string): readonly [CardBinding, CardBinding, CardBinding] {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(prefix)) throw new Error(`handBindings: "${prefix}" is no WGSL name's start`);
  return [
    { wgsl: `var ${prefix}_hand_runs: texture_2d<f32>`, entry: HAND_BINDINGS.runs },
    { wgsl: `var ${prefix}_hand_atlas: texture_2d<f32>`, entry: HAND_BINDINGS.atlas },
    { wgsl: `var ${prefix}_hand_samp: sampler`, entry: HAND_BINDINGS.sampler },
  ];
}

// ---------------------------------------------------------------- the run store

export interface HandRunsOptions {
  /** The texture's label (`paper/hand runs`) — the memory ledger's row. */
  readonly label?: string;
  /** Rows at the start (16: 16,384 texels, 256 KB), doubled as the runs need. */
  readonly rows?: number;
}

export interface HandRunsStats {
  /** Objects holding a run. */
  readonly runs: number;
  /** Texels their runs are given (each with its room to grow) and the texels they use. */
  readonly given: number;
  readonly used: number;
  /** Texels the texture holds; how many times it grew. */
  readonly capacity: number;
  readonly grown: number;
  /** Writes to the texture and the bytes they carried. */
  readonly writes: number;
  readonly bytes: number;
}

export interface HandRuns {
  /** The store: `rgba32float`, `HAND_RUN.row` texels a row — remade when it grows (`version` moves). */
  readonly texture: GPUTexture;
  /** A `texture_2d<f32>` view of it — the kind's runs binding (`HAND_BINDINGS.runs`). */
  readonly view: GPUTextureView;
  /** Moves whenever the texture is remade: a bind group holding the view is made again. */
  readonly version: number;
  /**
   * Object `key`'s run written: in its own room while it fits (the base it had), else in new room (its old given back). Returns its
   * BASE — the texel index its record hands `hand_ink` — or −1 when the device holds no more (the sheet keeps its raster road).
   * Write in the world half, before the frame's prepares: a growth remakes the texture.
   */
  write(key: PenKey, run: HandRun): number;
  /** Object `key`'s base, or −1. */
  baseOf(key: PenKey): number;
  /** Object `key`'s room given back (it left the desk, or went back to its raster). */
  free(key: PenKey): void;
  stats(): HandRunsStats;
  dispose(): void;
}

interface Room {
  readonly at: number;
  readonly len: number;
  used: number;
}

/** A run's room: its length and a quarter more (at least 16), in 16s — so a sheet being typed rewrites in place most keystrokes. */
const roomFor = (n: number): number => Math.ceil((n + Math.max(16, Math.ceil(n / 4))) / 16) * 16;

/** A kind's run store on `device` (one for the kind, its slots sharing it). */
export function createHandRuns(device: GPUDevice, opts: HandRunsOptions = {}): HandRuns {
  const label = opts.label ?? "hand/runs";
  const W = HAND_RUN.row;
  const maxRows = (device as { limits?: { maxTextureDimension2D?: number } }).limits?.maxTextureDimension2D ?? 8192;
  let rows = Math.max(1, Math.min(opts.rows ?? 16, maxRows));
  const make = (r: number): GPUTexture => device.createTexture({
    label, size: [W, r], format: "rgba32float",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
  });
  let texture = make(rows);
  let view = texture.createView({ dimension: "2d" });
  let version = 0;
  let grown = 0;
  let writes = 0;
  let bytes = 0;
  /** Free texel ranges, sorted by `at`, never touching (merged on a free). */
  let free: { at: number; len: number }[] = [{ at: 0, len: W * rows }];
  const rooms = new Map<PenKey, Room>();

  const giveBack = (at: number, len: number): void => {
    let i = 0;
    while (i < free.length && (free[i] as { at: number }).at < at) i += 1;
    free.splice(i, 0, { at, len });
    const merged: { at: number; len: number }[] = [];
    for (const r of free) {
      const last = merged[merged.length - 1];
      if (last !== undefined && last.at + last.len === r.at) last.len += r.len;
      else merged.push({ ...r });
    }
    free = merged;
  };

  /** The texture remade `next` rows tall, its texels copied (an encoder of its own, submitted before any later write), the old destroyed — the version moves. */
  const grow = (next: number): void => {
    const was = rows;
    const tex = make(next);
    const enc = device.createCommandEncoder({ label: `${label} grow` });
    enc.copyTextureToTexture({ texture }, { texture: tex }, [W, was, 1]);
    device.queue.submit([enc.finish()]);
    texture.destroy();
    texture = tex;
    view = texture.createView({ dimension: "2d" });
    rows = next;
    giveBack(W * was, W * (next - was));
    version += 1;
    grown += 1;
  };

  /** `len` texels of room, the texture grown when none is free; null when the device holds no more. */
  const take = (len: number): number | null => {
    for (;;) {
      const i = free.findIndex((r) => r.len >= len);
      if (i >= 0) {
        const r = free[i] as { at: number; len: number };
        const at = r.at;
        if (r.len === len) free.splice(i, 1);
        else { r.at += len; r.len -= len; }
        return at;
      }
      if (rows >= maxRows) return null;
      grow(Math.min(maxRows, rows * 2));
    }
  };

  /** `run`'s vec4s at texel `at`: a part row, the whole rows, a part row — one write each. */
  const upload = (at: number, data: Float32Array, n: number): void => {
    const put = (texel: number, from: number, w: number, h: number): void => {
      // (the offset counts from the view's own first byte: a run's `data` is a view of its own buffer)
      device.queue.writeTexture({ texture, origin: { x: texel % W, y: Math.floor(texel / W) } }, data as Float32Array<ArrayBuffer>, { offset: from * 16, bytesPerRow: w * 16, rowsPerImage: h }, [w, h]);
      writes += 1;
      bytes += w * h * 16;
    };
    let done = 0;
    const head = Math.min(n, (W - (at % W)) % W);
    if (head > 0) { put(at, 0, head, 1); done = head; }
    const whole = Math.floor((n - done) / W);
    if (whole > 0) { put(at + done, done, W, whole); done += whole * W; }
    if (done < n) put(at + done, done, n - done, 1);
  };

  return {
    get texture() { return texture; },
    get view() { return view; },
    get version() { return version; },
    write(key, run) {
      const n = run.length;
      let room = rooms.get(key);
      if (room === undefined || room.len < n) {
        if (room !== undefined) { rooms.delete(key); giveBack(room.at, room.len); }
        const len = roomFor(n);
        const at = take(len);
        if (at === null) return -1;
        room = { at, len, used: 0 };
        rooms.set(key, room);
      }
      room.used = n;
      if (n > 0) upload(room.at, run.data, n);
      return room.at;
    },
    baseOf: (key) => rooms.get(key)?.at ?? -1,
    free(key) {
      const room = rooms.get(key);
      if (room === undefined) return;
      rooms.delete(key);
      giveBack(room.at, room.len);
    },
    stats() {
      let given = 0;
      let used = 0;
      for (const r of rooms.values()) { given += r.len; used += r.used; }
      return { runs: rooms.size, given, used, capacity: W * rows, grown, writes, bytes };
    },
    dispose() { texture.destroy(); rooms.clear(); free = []; },
  };
}
