// THE LIVE FACE (design-019 §3, §9 — PORTALS' seam; M24 LT1): a kind's face may show a surface that lives OUTSIDE the world — a web
// page, a captured window, a simulator's screen, later a terminal — as a texture on the desk's device that the HOST fills and the
// kind samples. Nothing about a source enters the desk: the host LENDS a `LiveSources` under the `LIVE` key (`deskLayer({ services })`,
// as it lends its text raster and its byte store); a kind's world half opens a FACE on it per object, by the object's durable key
// (`KindHost.keyOf`), takes what arrived in its tick and draws the face's `LiveTexture` — a view, never a frame (VibeField's PA-22:
// a plugin never touches a frame). Four pieces, each a door a host or a kind uses alone:
//  - `createLiveTexture` — the HOST's writer: one stable texture, ONE copy to level 0 per present (a `VideoFrame` closed by the writer
//    once its copy is made — a retained frame starves its producer, design-013 B6's law), its mips made only as deep as they are read,
//    into the frame's encoder (`LiveTexture.prepare`); `revision` moves per present, `epoch` per new GPU texture;
//  - the contract a host lends (`LIVE`, `LiveSources`, `LiveFace` and its words: `LiveState`, `LiveInfo`, `LiveDemand`, `LiveInput`);
//  - `createSight` — where a kind's faces were drawn, folded into one fact per entity per frame (seen, the largest device px, held):
//    what the kind's demand law reads;
//  - `stillLive` — a `LiveSources` of committed bytes: a still (`createStill`) and the oracle draw a live kind with no producer.
// THE WAKE (§3.3): `arrived` → the kind's `KindHost.wake()` → its tick `take()`s each woken face → a face that answers true asks
// `KindHost.redraw()` and the tick answers FALSE: the frame is drawn again and no record is remade. A quiet source sends nothing, so a
// desk of live faces at rest submits nothing.

import type { Entity } from "@ice/core";
import type { SlotContext } from "../kind";
import type { ObjectRect } from "../kinds/world";
import { chainBytes } from "./arrays";
import { mipCount, mipsInto } from "./mips";
import { type ServiceKey, serviceKey } from "./services";

// ---------------------------------------------------------------- the texture

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

/** The formats a live texture is made in: `rgba8unorm-srgb` (the default — filtered in linear light, as the photo's chain is) or `rgba8unorm`. */
export type LiveFormat = "rgba8unorm-srgb" | "rgba8unorm";

/** What a kind reads (design-019 §3.1): a stable texture, its size, and the counters that say when to rebind or make its mips again. */
export interface LiveTexture {
  /** Texels of level 0 — the source's size as last presented (or as made, before the first). */
  readonly width: number;
  readonly height: number;
  readonly format: LiveFormat;
  /** Moves on every present: the content changed, so the mips are owed again (0 — nothing presented yet). */
  readonly revision: number;
  /** Moves when the GPU texture itself is replaced (a resize): a kind rebinds every group that holds `view()`. */
  readonly epoch: number;
  /**
   * The whole chain's view — sampled through a trilinear sampler. Levels past `prepare`'s reach hold the mips last made there (a
   * texture of a new epoch: nothing until they are made).
   */
  view(): GPUTextureView;
  /**
   * Make the mips down to level `upTo` into `encoder` — the frame's, from the kind's `prepare`: never a submit of its own. Once per
   * revision: a second call at the same revision and depth records nothing, a deeper one only the levels still missing. `upTo` is
   * clamped to the chain's last level; nothing is made before the first present, nor for a texture made without mips.
   */
  prepare(encoder: GPUCommandEncoder, upTo: number): void;
  /** Bytes held on the device, every level counted (the kit's `chainBytes`) — what a kind charges its budget. */
  readonly bytes: number;
  /**
   * The LOGICAL size of the frame last presented (design-019 §5, M24 LT2 — a page's CSS viewport, as its host said with the present):
   * `[width, height]`, the texel size when the present gave none (and after a resize, before the next). Texels are not a source's
   * coordinates: a kind maps the hand's point into the frame it DISPLAYED through this, and the host stamps that frame's geometry.
   */
  readonly logical: readonly [number, number];
}

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

/**
 * How deep a face is READ (design-019 §3.1 — "a mip chain made only as deep as it is read"): drawn at `px` device px, a texture of
 * `face`'s size is minified by its larger ratio, and a trilinear sampler reads the two levels about log2 of it — so the levels down
 * to ⌈log2 ratio⌉ are what `prepare` must make; 0 when the face is drawn at its size or larger. A kind passes it to `prepare`.
 */
export function liveDepth(face: Pick<LiveTexture, "width" | "height">, px: readonly [number, number]): number {
  const ratio = Math.max(face.width / Math.max(px[0], 1e-6), face.height / Math.max(px[1], 1e-6));
  return ratio <= 1 ? 0 : Math.ceil(Math.log2(ratio) - 1e-9);
}

// ---------------------------------------------------------------- the source a host lends

/**
 * The source's state (design-019 §3.2): `starting` (no frame yet — the kind draws its still or its film), `live`, `paused` (the last
 * frame holds), `closed`; `failed` with its reason in words and, when the host can, a way to try again.
 */
export type LiveState =
  | { readonly is: "starting" | "live" | "paused" | "closed" }
  | { readonly is: "failed"; readonly reason: string; readonly retry?: () => void };

/** The source's words for the face — all optional; `extra` carries a host's own (the kind knows its host's contract). */
export interface LiveInfo {
  readonly title?: string;
  readonly address?: string;
  /** 0 … 1 while loading; undefined when not. */
  readonly loading?: number;
  readonly back?: boolean;
  readonly forward?: boolean;
  /** The CSS cursor the source shows at the last point it was told of. */
  readonly cursor?: string;
  /** The source runs degraded — `"cpu-bitmap"` (LSF's fallback): the kind may badge it. */
  readonly degraded?: string;
  readonly extra?: Readonly<Record<string, unknown>>;
}

/**
 * What the desk asks of a face, in the KIND's law over what it is seen (design-019 §4) — handed to `LiveFace.demand` change-only; the
 * host maps it to its producer and folds several holders of one key. `mode`: live or paused (a face unseen, behind the hand, evicted);
 * `fps`: the rate it wants (the host buckets it — VibeField's 0/2/5/10/15/30/60); `raster`: the device px it wants delivered (a rung,
 * held through a wobbling zoom); `viewport`: the source's logical layout size (a page's CSS viewport — absent: unchanged);
 * `interactive`: in use, at the native rate and urgent.
 */
export interface LiveDemand {
  readonly mode: "live" | "paused";
  readonly fps: number;
  readonly raster: readonly [number, number];
  readonly viewport?: readonly [number, number];
  readonly interactive: boolean;
}

/**
 * Input to a face, in the coordinates of the frame it DISPLAYED — its LOGICAL size (`LiveTexture.logical`, design-019 §5; M24 LT2): a
 * pointer (`button` the one pressed or released — −1 on a move, `buttons` the mask held, `count` the click count the hand told the kind:
 * 1, 2, 3… — `HeldEvent`'s), a wheel (CSS px of the hand), a key (`mods` Chrome DevTools' modifier mask — Alt 1, Ctrl 2, Meta 4,
 * Shift 8), committed text, an IME composition (its text and its caret within it — `EditorLease.compose`). A kind maps what the hand
 * told it (`KindLocal.held`, the editor's lease) and sends it; it carries no geometry revision: the host stamps the frame it displayed.
 */
export type LiveInput =
  | { readonly kind: "pointer"; readonly x: number; readonly y: number; readonly button: number; readonly buttons: number; readonly count: number; readonly phase: "down" | "move" | "up" }
  | { readonly kind: "wheel"; readonly x: number; readonly y: number; readonly dx: number; readonly dy: number }
  | { readonly kind: "key"; readonly key: string; readonly code: string; readonly phase: "down" | "up"; readonly mods: number; readonly repeat: boolean }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "compose"; readonly text: string; readonly caret: number };

/**
 * ONE FACE a host opened for an object (design-019 §3.2). The kind holds it — a view and words, never a frame. A kind TAKES once right
 * after it opens a face (what the host already holds — a page re-attached, a still's committed frame — lands in the frame that opens
 * it), and then whenever `arrived` woke it.
 */
export interface LiveFace {
  readonly key: string;
  /** The face's texture, or undefined before the first frame and after an eviction — the kind draws its still or its film. */
  texture(): LiveTexture | undefined;
  /**
   * In the kind's tick (and once at its open): the host copies the NEWEST arrival once into the texture and closes it — older ones
   * were closed on arrival. True when the look changed: a frame landed, the state or the info moved.
   */
  take(): boolean;
  state(): LiveState;
  info(): LiveInfo;
  /** What the desk sees of the face, in the kind's law — change-only; the host maps it to its producer. */
  demand(d: LiveDemand): void;
  /** Input in the displayed frame's logical coordinates (§5 — a kind sends what the hand told it, M24 LT2). Absent: a view-only source (a captured window, a simulator without a control lane). */
  readonly input?: ((e: LiveInput) => void) | undefined;
  close(): void;
}

/** What a HOST lends (design-019 §3.2) under `LIVE`: its sources, as faces by key. */
export interface LiveSources {
  /**
   * Open a face for `key` — the object's DURABLE key (`KindHost.keyOf`) — on a source the HOST understands: `spec` is the host's
   * contract (a page's address, a window's id), the desk never reads it. `arrived` is called — outside a frame, any number of times —
   * when something new is ready: a frame, a state, an info change. One face per key per desk: a key opened twice is a host error.
   * Open on the kind's first `record` of the object; `close` on its `forget`, the kind's `dispose`, or its eviction.
   */
  open(key: string, spec: Readonly<Record<string, unknown>>, arrived: () => void): LiveFace;
}

/** The host's live sources as a desk SERVICE (design-019 §3.2 — `deskLayer({ services: [service(LIVE, sources)] })`): `host.use?.(LIVE)`. */
export const LIVE: ServiceKey<LiveSources> = serviceKey<LiveSources>("live");

// ---------------------------------------------------------------- the sight

/**
 * What a kind is told of one face (design-019 §3.4): `seen` — drawn in the last frame, in any slot but the desk copy behind the hand;
 * `px` — the LARGEST device-px extent it was drawn at there (`[0, 0]` unseen); `held` — drawn in the hand.
 */
export interface Seen {
  readonly seen: boolean;
  readonly px: readonly [number, number];
  readonly held: boolean;
}

/** A face not drawn in the last frame. */
const UNSEEN: Seen = { seen: false, px: [0, 0], held: false };

/**
 * THE SIGHT (design-019 §3.4): where a kind's faces are drawn, folded into one fact per entity per frame. The kind's pass tells it what
 * each slot drew (`saw`, in `prepare`); its tick asks what moved (`step`) and hands its demand law the facts.
 *
 * WHICH RENDERS COUNT: the frame's (`target` absent or `frame`) and the hand's (`held`). Not the desk COPY behind a carried object —
 * prepared once per stamp, it is what the eye sees out of focus: a face behind the hand reads `seen: false` and rests on its last
 * frame (§6, a policy) — and not a CAPTURE, which draws the last frame's inputs once more, outside any frame. So the photo's
 * `keepSlotted` re-ask (K9 R4 — the hand's prepare the only prepare of a carried frame) is not needed here: under a carry the hand's
 * prepare tells the held face, and every other face reads unseen BY THE POLICY, not by the gap.
 *
 * THE FRAME BOUNDARY: a kind with no records in a slot is never prepared, so "not asked" means "not drawn" only when a frame WAS drawn —
 * and a kind is ticked on steps that draw nothing (any input step: a pointer moving over the bare mat ticks every kind and draws no
 * frame). `frames` — the desk's count of frames drawn (`KindHost.frames`) — is that boundary: a step after no new frame says nothing
 * moved; one after a frame folds what THAT frame's prepares saw, and an entity they did not see reads `seen: false`; prepares made
 * outside the count (an instrument's render — the cost rig's batches, the profiler's ablation) are no frame's, dropped at the next
 * step. Absent (a bare host, a still): every step is taken as a frame.
 */
export interface Sight {
  /** In `prepare`, per slot, per record: the face's rect (world units — its `w`, `h` read) → device px through the slot's view. */
  saw(e: Entity, slot: SlotContext, face: ObjectRect): void;
  /** In the tick: the entities whose fact moved since the last step, each with its fact now. Empty when no frame was drawn since. */
  step(): ReadonlyMap<Entity, Seen>;
  /** `e`'s fact as of the last step; undefined before its first. */
  of(e: Entity): Seen | undefined;
  /** A frame was drawn since the last step — the kind is due NOW (its `KindLocal.due`), or a face culled by it reads seen until a later tick. */
  owed(): boolean;
  /** The entity left the desk: nothing of it is kept. */
  forget(e: Entity): void;
}

/** A face's extent in one render — device px — and whether that render was the hand. */
interface Glimpse { w: number; h: number; held: boolean }

const sameSeen = (a: Seen, b: Seen): boolean => a.seen === b.seen && a.held === b.held && a.px[0] === b.px[0] && a.px[1] === b.px[1];

/** A kind's SIGHT over its faces (design-019 §3.4) — `frames` the desk's count of frames drawn (`KindHost.frames`); see `Sight`. */
export function createSight(frames?: () => number): Sight {
  const facts = new Map<Entity, Seen>();
  /** What the frame being drawn (or the last drawn) saw — stamped with the count its prepares read. */
  const fold = new Map<Entity, Glimpse>();
  let foldAt = -1;
  /** The count the last step read (−1 before the first: never read at creation — a host's count may not exist yet). */
  let stepped = -1;
  return {
    saw(e, slot, face) {
      if (slot.target === "copy" || slot.target === "capture") return;
      if (frames !== undefined) {
        const n = frames();
        if (n !== foldAt) { fold.clear(); foldAt = n; }   // a new frame's first prepare: what the last frame saw is gone
      }
      const k = slot.view.zoom * slot.view.dpr;
      const glimpse: Glimpse = { w: Math.round(face.w * k), h: Math.round(face.h * k), held: slot.target === "hand" };
      const had = fold.get(e);
      if (had === undefined) { fold.set(e, glimpse); return; }
      // drawn in more than one slot this frame (a departed desk and the arriving one, an inside): the largest extent, held if any was
      if (glimpse.w * glimpse.h > had.w * had.h) { had.w = glimpse.w; had.h = glimpse.h; }
      had.held ||= glimpse.held;
    },
    step() {
      const moved = new Map<Entity, Seen>();
      if (frames !== undefined) {
        const n = frames();
        // prepares made while the count already reads n came after the last frame counted — no frame's (an instrument's render: the
        // cost rig's batches, the profiler's ablation, which prepare the passes and count nothing): dropped, so the next frame's
        // fold starts clean
        if (foldAt === n) { fold.clear(); foldAt = -1; }
        if (n === stepped) return moved;
        stepped = n;
        // the last frame drawn — the n-th — was prepared while the count read n − 1: what it saw is the fold, or (never asked) nothing
        if (foldAt !== n - 1) fold.clear();
      }
      for (const [e, g] of fold) {
        const now: Seen = { seen: true, px: [g.w, g.h], held: g.held };
        const was = facts.get(e);
        if (was === undefined || !sameSeen(was, now)) { facts.set(e, now); moved.set(e, now); }
      }
      for (const [e, was] of facts) {
        if (fold.has(e) || !was.seen) continue;
        facts.set(e, UNSEEN);
        moved.set(e, UNSEEN);
      }
      if (frames === undefined) fold.clear();
      return moved;
    },
    of: (e) => facts.get(e),
    owed: () => frames !== undefined && frames() !== stepped,
    forget(e) { facts.delete(e); fold.delete(e); },
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
