// THE LIVE FACE'S HOST HALF (design-019 §3.1, §9; petition I51 — moved off the kit at M24 LT4): what only a HOST may use, on
// `@vibecook/ice/desk` beside `deskLayer` (whose `onDevice` hands the device these are made on) and never on `/desk/kit`:
//  - `createLiveTexture` — the HOST's writer: one stable texture, ONE copy to level 0 per present (a `VideoFrame` closed by the writer
//    once its copy is made — a retained frame starves its producer, design-013 B6's law), its mips made only as deep as they are read,
//    into the frame's encoder (the reader's `LiveTexture.prepare`); `revision` moves per present, `epoch` per new GPU texture;
//  - `stillLive` — a `LiveSources` of committed bytes: a still (`createStill`) and the oracle draw a live kind with no producer.
// A KIND reads the face through the kit (kit/live.ts: `LiveTexture`, `LIVE`, `LiveFace`, the sight) and never imports this module:
// VibeField's PA-22 — a plugin never touches a frame — by the entry it is handed, and the kit's module graph cannot reach here
// (`desk-dom-free`: nothing under src/ outside host/ imports host/). No DOM is touched at load or by `stillLive` (Node, Dawn and the
// oracle import this file): a browser source is only ever handed in.

import { chainBytes } from "../kit/arrays";
import type { LiveFormat, LiveInfo, LiveSources, LiveTexture } from "../kit/live";
import { mipCount, mipsInto } from "../kit/mips";

// ---------------------------------------------------------------- the writer

/** A rectangle of a source in its own pixels — a `VideoFrame`'s `visibleRect`: `x`, `y` its top-left. */
export interface LiveRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * What a host presents to a face: a source the device copies from (`copyExternalImageToTexture`'s). A `VideoFrame` is CLOSED by the
 * writer once its copy is made — the host hands it over and never closes it itself; any other source stays the host's.
 */
export type LiveImage = VideoFrame | ImageBitmap | OffscreenCanvas | HTMLCanvasElement | ImageData;

/**
 * What a HOST holds (design-019 §3.1): the face's texture and the doors that fill it. Every present is ONE copy into level 0 and moves
 * `revision`; a source whose size differs from the texture's makes a new texture first (`resize` — `epoch` moves), so the texture is
 * always the source's size. After `destroy` every present is ignored (a `VideoFrame` is still closed).
 */
export interface LiveWriter {
  readonly face: LiveTexture;
  /**
   * One copy from a browser source (`copyExternalImageToTexture`), from `rect` when given; a `VideoFrame` is closed after the copy.
   * `logical`: the frame's LOGICAL size (`LiveTexture.logical` — a page's CSS viewport), each side finite and > 0; absent, its texels.
   */
  present(source: LiveImage, rect?: LiveRect, logical?: readonly [number, number]): void;
  /** Raw RGBA8 rows, row-major, no header, `width` × `height` (`writeTexture`) — Node, Dawn, tests and stills; `logical` as `present`'s. */
  presentBytes(bytes: Uint8Array, width: number, height: number, logical?: readonly [number, number]): void;
  /** A texture already on this device (`copyTextureToTexture`, in a submit of its own), from `rect` when given; its format the face's or its `-srgb` twin; `logical` as `present`'s. */
  presentTexture(texture: GPUTexture, rect?: LiveRect, logical?: readonly [number, number]): void;
  /** A new texture of `width` × `height` — `epoch` moves, the old one is destroyed, the content is gone until the next present. The same size: nothing. */
  resize(width: number, height: number): void;
  destroy(): void;
}

/** What a live texture is made with. */
export interface LiveTextureOptions {
  /** The texture's label — the CALLER's, `<kind>/live <key>` by convention, so the memory ledger (`gpuLedger`) groups it under the kind. */
  readonly label: string;
  readonly width: number;
  readonly height: number;
  /** `rgba8unorm-srgb` (the default) or `rgba8unorm`. */
  readonly format?: LiveFormat;
  /** A mip chain beside level 0 (the default) — made by `prepare` as deep as the kind reads it; `false`, level 0 alone. */
  readonly mips?: boolean;
}

/** A size of a texture: a finite number ≥ 1, whole. */
function extent(what: string, v: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 1) throw new Error(`createLiveTexture: ${what} must be a finite number ≥ 1 (got ${String(v)})`);
  return Math.floor(v);
}

/** A frame's logical size as a present gives it: absent stays absent (the texels); each side finite and > 0, never rounded (CSS px may be fractional). */
function logicalOf(l: readonly [number, number] | undefined): readonly [number, number] | null {
  if (l === undefined) return null;
  const ok = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v) && v > 0;
  if (!Array.isArray(l) || !ok(l[0]) || !ok(l[1])) throw new Error(`LiveWriter: a logical size is [width, height], each finite and > 0 (got ${JSON.stringify(l)})`);
  return [l[0], l[1]];
}

/** A `VideoFrame`, by its shape (Node and a still have no `VideoFrame` class to ask). */
const isVideoFrame = (s: unknown): s is VideoFrame => typeof (s as VideoFrame).close === "function" && typeof (s as VideoFrame).codedWidth === "number";

/** A source's whole size: a frame's display size, any other's own. */
function wholeOf(s: LiveImage): LiveRect {
  if (isVideoFrame(s)) return { x: 0, y: 0, width: s.displayWidth, height: s.displayHeight };
  const c = s as { readonly width: number; readonly height: number };
  return { x: 0, y: 0, width: c.width, height: c.height };
}

/**
 * A LIVE TEXTURE on `device` (design-019 §3.1) — what a host's `LiveSources` makes per face, on the desk's device (`deskLayer({
 * onDevice })`): `rgba8unorm-srgb` with a mip chain by default, usable as a binding, a copy's source and target, and a level's
 * attachment (the mips are drawn).
 */
export function createLiveTexture(device: GPUDevice, o: LiveTextureOptions): LiveWriter {
  const format: LiveFormat = o.format ?? "rgba8unorm-srgb";
  if (format !== "rgba8unorm-srgb" && format !== "rgba8unorm") throw new Error(`createLiveTexture: format must be "rgba8unorm-srgb" or "rgba8unorm" (got ${String(format)})`);
  if (typeof o.label !== "string") throw new Error("createLiveTexture: `label` is required — the caller's, `<kind>/live <key>` by convention");
  const chain = o.mips !== false;
  let width = extent("width", o.width);
  let height = extent("height", o.height);
  // the usage flags are read at call time, never at load: a Node host installs the GPU globals after importing the kit
  const make = (w: number, h: number): GPUTexture => device.createTexture({
    label: o.label, size: [w, h], format, mipLevelCount: chain ? mipCount(w, h) : 1,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  let texture = make(width, height);
  let view: GPUTextureView | null = null;
  let revision = 0;
  let epoch = 0;
  /** The mips made: for which texture and content, and how deep. */
  let mipped = { epoch: -1, revision: -1, depth: 0 };
  /** The logical size the last present gave (null: its texels — none given, or nothing presented since the texture was made). */
  let logical: readonly [number, number] | null = null;
  let gone = false;
  const sized = (w: number, h: number): void => {
    if (w === width && h === height) return;
    logical = null;
    texture.destroy();
    width = w;
    height = h;
    texture = make(w, h);
    view = null;
    epoch += 1;
  };
  const face: LiveTexture = {
    get width() { return width; },
    get height() { return height; },
    format,
    get revision() { return revision; },
    get epoch() { return epoch; },
    view() {
      if (view === null) view = texture.createView();
      return view;
    },
    prepare(encoder, upTo) {
      if (gone || revision === 0) return;
      if (mipped.epoch !== epoch || mipped.revision !== revision) mipped = { epoch, revision, depth: 0 };
      const to = Math.min(Math.floor(upTo), texture.mipLevelCount - 1);
      if (!(to > mipped.depth)) return;
      mipsInto(device, encoder, texture, mipped.depth + 1, to);
      mipped.depth = to;
    },
    get bytes() { return chainBytes(width, height, texture.mipLevelCount); },
    get logical() { return logical ?? [width, height]; },
  };
  return {
    face,
    present(source, rect, size) {
      try {
        if (gone) return;
        const r = rect ?? wholeOf(source);
        const w = extent("the source's width", r.width);
        const h = extent("the source's height", r.height);
        const l = logicalOf(size);
        sized(w, h);
        device.queue.copyExternalImageToTexture({ source, origin: [r.x, r.y] }, { texture, premultipliedAlpha: false }, [w, h]);
        logical = l;
        revision += 1;
      } finally {
        // the frame is the PRODUCER's budget: closed as soon as its copy is asked for, whatever became of it (B6, LSF-D7)
        if (isVideoFrame(source)) source.close();
      }
    },
    presentBytes(bytes, w0, h0, size) {
      if (gone) return;
      const w = extent("width", w0);
      const h = extent("height", h0);
      if (bytes.byteLength < w * h * 4) throw new Error(`LiveWriter.presentBytes: ${bytes.byteLength} bytes for ${w} × ${h} RGBA8 rows (${w * h * 4} wanted)`);
      const l = logicalOf(size);
      sized(w, h);
      device.queue.writeTexture({ texture }, bytes as Uint8Array<ArrayBuffer>, { bytesPerRow: w * 4, rowsPerImage: h }, [w, h]);
      logical = l;
      revision += 1;
    },
    presentTexture(src, rect, size) {
      if (gone) return;
      const r = rect ?? { x: 0, y: 0, width: src.width, height: src.height };
      const w = extent("the source's width", r.width);
      const h = extent("the source's height", r.height);
      const l = logicalOf(size);
      sized(w, h);
      const encoder = device.createCommandEncoder({ label: `${o.label} present` });
      encoder.copyTextureToTexture({ texture: src, origin: [r.x, r.y] }, { texture }, [w, h]);
      device.queue.submit([encoder.finish()]);
      logical = l;
      revision += 1;
    },
    resize(w, h) {
      if (gone) return;
      sized(extent("width", w), extent("height", h));
    },
    destroy() {
      if (gone) return;
      gone = true;
      texture.destroy();
    },
  };
}

// ---------------------------------------------------------------- a still's source

/** A face's committed STILL (`stillLive`): RGBA8 rows, row-major, no header — `presentBytes`' shape — its logical size, and the words the face says. */
export interface LiveStill {
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8Array;
  /** The frame's LOGICAL size (`LiveTexture.logical` — a page's CSS viewport); absent, its texels. */
  readonly logical?: readonly [number, number];
  readonly info?: LiveInfo;
}

/**
 * A `LiveSources` of COMMITTED BYTES (design-019 §9) — lend it to a still (`createStill({ services: [service(LIVE, stillLive(device,
 * …))] })`) or the oracle, and a live kind draws deterministically through the product's own path: the texture, its sampling, its mips,
 * from owned fixtures (never a third party's pixels; a `VideoFrame` never enters Node). Every `open` answers a face whose FIRST `take()`
 * presents its still through `presentBytes` — on `device`, labelled `live/still <key>` — and answers true once; then nothing ever
 * arrives. Its state is `live` (`starting` for a key with no still — the kind draws its film), its info the still's. `frames` is read
 * when a face OPENS — by key, or a function of the key and the host's spec — so a stage may fill a record with the keys its spawns were
 * given (`engine.docs.current()?.store.keyOf(e)`: a still's keys are minted by its own document). A key opened twice while open throws;
 * `close` destroys the face's texture.
 */
export function stillLive(device: GPUDevice, frames: Readonly<Record<string, LiveStill>> | ((key: string, spec: Readonly<Record<string, unknown>>) => LiveStill | undefined)): LiveSources {
  const open = new Set<string>();
  return {
    open(key, spec) {
      if (open.has(key)) throw new Error(`stillLive: the face "${key}" is open twice — one face per key per desk (design-019 §3.2)`);
      open.add(key);
      const still = typeof frames === "function" ? frames(key, spec) : frames[key];
      let writer: LiveWriter | undefined;
      let taken = false;
      let closed = false;
      return {
        key,
        texture: () => writer?.face,
        take() {
          if (taken || closed || still === undefined) return false;
          taken = true;
          writer = createLiveTexture(device, { label: `live/still ${key}`, width: still.width, height: still.height });
          writer.presentBytes(still.bytes, still.width, still.height, still.logical);
          return true;
        },
        state: () => (closed ? { is: "closed" } : still === undefined ? { is: "starting" } : { is: "live" }),
        info: () => still?.info ?? {},
        demand: () => {},
        close() {
          if (closed) return;
          closed = true;
          writer?.destroy();
          writer = undefined;
          open.delete(key);
        },
      };
    },
  };
}
