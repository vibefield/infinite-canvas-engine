// VIDEO INGEST — the video kind's render (design-013 §6 reflector 7, §8 B6;
// §9 Q5 RULED "a registered stable-texture handle"). A live surface's pixels
// belong to a PRODUCER outside ICE — a camera, a decoder, a terminal mirror,
// VibeField's LSF store — so the engine allocates nothing for it: the producer
// states a size once (`register`), hands over each frame as it arrives
// (`arrive`), and this module copies that frame ONCE into the stable texture
// the table's handle names and closes it immediately.
//
// That copy-once is the whole ruling. The old leg's video path RETAINS the
// latest `VideoFrame` and re-imports it (`device.importExternalTexture`) on
// every composite, which is legal for a fixture that owns its own frames and
// illegal for a consumer under a producer lease: the frames are a small pool
// and a held one starves the producer. So the retain-and-import path stays the
// RIG's mechanism (`compositor/video-source.ts` until B8), the ground
// deliberately has no `texture_external` variant, and a frame that reaches
// `arrive` is closed before the next one can be asked for.
//
// ── Where it runs ───────────────────────────────────────────────────────────
// `arrive` is the PRODUCER's call and happens between ticks; it only queues
// (and closes what it supersedes). The copy is a queue op, so it must be
// enqueued before the submit that samples it — that is `flush`, running in the
// host's `renders.video` slot (§6's reflector 7, before DomCompose and
// GpuCompose). Nothing here writes the ECS or reads layout: the destination
// comes from `TextureRef`, which Residency alone writes, and the size from the
// producer's own registration.
//
// ── The demand clamp (design-013 §6 step 3) ─────────────────────────────────
// `SurfaceDemand` is what the card GETS after the fold: culled ⇒ paused, and a
// bucket is a ceiling. A paused card's arrival is DROPPED and closed — no
// copy, no wake, no upload — which is what makes an off-screen live surface
// genuinely free rather than merely cheap, and a bucket allows at most one
// copy per `demandIntervalMs`. Everything dropped is still closed exactly once.
//
// ── The debt, and why this module re-asserts it ─────────────────────────────
// `ContentResidency.wrote(e)` says the card's CURRENT destination holds
// pixels, keyed by the ref's own values, and `collect()` sweeps a card whose
// ref went away. For an atlas slot that sweep is right — the slot was given to
// someone else and a re-copy really is owed. For a REGISTERED stable texture it
// is not: the texture is the producer's, it is not re-slotted, and the pixels
// that were in it are still in it. A culled card therefore comes back with the
// SAME handle and whole uv — the same key — and owes nothing. So `flush`
// re-asserts the write for any registered card that has been copied into and
// whose destination reads unwritten (one `wrote`, one wake, then quiet; while
// the card has no destination at all `wrote` is a no-op and cannot churn).
// Without it a PAUSED live surface — the picture mode — that scrolls off and
// back would draw the plate forever, because no further frame will arrive to
// pay the debt again.
import {
  demandIntervalMs,
  type Entity,
  NO_TEXTURE,
  SurfaceDemand,
  type SurfaceDemandValue,
  type SurfaceFpsBucket,
  SurfaceKind,
  type TextureHandle,
  type World,
} from "@ice/core";
import type { ContentResidency } from "./residency";

/** What a producer may hand to {@link VideoIngest.arrive} — the copy's own source set. */
export type VideoIngestSource = GPUCopyExternalImageSource;

export interface VideoIngestOptions {
  /** The ground's device — the texture is created and copied into on it. */
  readonly device: GPUDevice;
  /** The world the demand clamp is read from (never written). */
  readonly world: World;
  /** The content residency: the handle is realised there, and the write is said there. */
  readonly residency: ContentResidency;
  /**
   * The producer's clock, for the bucket's interval. An arrival is not a tick
   * event, so this is a wall clock and not `FrameInfo` — the tests inject one.
   */
  readonly now?: () => number;
}

/** What a producer states once about its surface (the table's `StableTextureSpec`, `srgb` defaulted). */
export interface VideoRegistration {
  readonly width: number;
  readonly height: number;
  /**
   * The producer's frames are sRGB-ENCODED and want decoding on the sample
   * (`rgba8unorm-srgb`). Default `false`: a canvas, a camera and a decoder all
   * hand over bytes that are already the colour the screen wants, and the
   * compose pass re-encodes only when the texture's ACTUAL format says to
   * (design-012 §4).
   */
  readonly srgb?: boolean;
}

export interface VideoIngestStats {
  /** Producers holding a registration right now. */
  readonly registered: number;
  /** Frames handed to `arrive`, ever. `arrivals === copies + dropped`. */
  readonly arrivals: number;
  /** Frames copied into a stable texture. */
  readonly copies: number;
  /** Arrivals that never became a copy — paused, throttled, superseded, unregistered. Every one was closed. */
  readonly dropped: number;
  /** The subset of `dropped` the demand clamp refused because the card is paused (culled or picture-mode). */
  readonly paused: number;
}

export interface VideoIngest {
  /** The render the host installs in `renders.video` (§6 reflector 7). */
  readonly reflector: { readonly name: string; flush(world: World): void };
  /**
   * Claim a stable texture for `entity`: the table mints the handle Residency will
   * name in its `TextureRef` (whole uv), and the texture is created here and realised
   * against it. Registering twice replaces the first — its texture dies at the
   * `collect` after Residency stops naming it. `0` when the profile has attached no
   * table (nothing is registered).
   */
  register(entity: Entity, spec: VideoRegistration): TextureHandle;
  /**
   * A frame has arrived. It is QUEUED for this tick's copy and closed by whoever
   * consumes it — the copy, a later arrival that supersedes it, the demand clamp
   * that refuses it, or `dispose`. Returns whether it was queued.
   */
  arrive(entity: Entity, source: VideoIngestSource): boolean;
  /** Drop a registration (the producer stopped): the queued frame is closed and the handle released. */
  unregister(entity: Entity): boolean;
  stats(): VideoIngestStats;
  /** The handle registered for an entity, or `0` — the producer's witness that it holds one. */
  handleOf(entity: Entity): TextureHandle;
  /** Close every queued frame and forget every registration. The textures are the residency's to destroy. */
  dispose(): void;
}

interface Registered {
  readonly handle: TextureHandle;
  readonly texture: GPUTexture;
  readonly width: number;
  readonly height: number;
  /** Something has been copied into this texture: its pixels survive a cull (the re-assert above). */
  copied: boolean;
  /** The producer clock at the last copy — the bucket's ceiling is measured from it. */
  lastCopyMs: number;
}

/** A source that owns a system resource closes; a canvas or a video element does not. */
function closeSource(source: VideoIngestSource): void {
  const c = (source as { close?: unknown }).close;
  if (typeof c === "function") (c as () => void).call(source);
}

/**
 * The source's own pixel size. `VideoFrame` reports `displayWidth` (the coded
 * frame may be padded), an `HTMLVideoElement` `videoWidth` (its `width` is a
 * CSS attribute and lies), everything else `width`.
 */
export function videoSourceSize(source: VideoIngestSource): { readonly w: number; readonly h: number } {
  const s = source as {
    displayWidth?: number; displayHeight?: number;
    videoWidth?: number; videoHeight?: number;
    width?: number; height?: number;
  };
  return {
    w: Math.floor(s.displayWidth ?? s.videoWidth ?? s.width ?? 0),
    h: Math.floor(s.displayHeight ?? s.videoHeight ?? s.height ?? 0),
  };
}

export function createVideoIngest(opts: VideoIngestOptions): VideoIngest {
  const { device, residency } = opts;
  const world = opts.world;
  const now = opts.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const records = new Map<Entity, Registered>();
  /** The LATEST frame per entity, waiting for this tick's copy — flux, outside the world. */
  const queued = new Map<Entity, VideoIngestSource>();
  let arrivals = 0;
  let copies = 0;
  let dropped = 0;
  let pausedDrops = 0;

  const drop = (source: VideoIngestSource): void => { dropped += 1; closeSource(source); };

  /** The card's effective demand, or the live default when it carries no facts (a bare rig entity). */
  const demandOf = (e: Entity): SurfaceDemandValue => {
    const d = world.get(e, SurfaceDemand);
    if (d === undefined) return { mode: "live", fpsBucket: 60, interactive: false };
    return { mode: d.mode as "live" | "paused", fpsBucket: d.fpsBucket as SurfaceFpsBucket, interactive: d.interactive };
  };

  const detach = (e: Entity): void => {
    const pending = queued.get(e);
    if (pending !== undefined) { queued.delete(e); drop(pending); }
    records.delete(e);
  };

  /**
   * The tick's copies, in the `video` render slot (§6 reflector 7): every queued frame into its
   * stable texture, closed, said written — all of it BEFORE GpuCompose's submit samples it.
   */
  const flushQueue = (): void => {
    for (const [e, source] of queued) {
      const rec = records.get(e);
      if (rec === undefined) { drop(source); continue; }
      const { w, h } = videoSourceSize(source);
      const width = Math.min(w, rec.width);
      const height = Math.min(h, rec.height);
      if (width <= 0 || height <= 0) { drop(source); continue; }
      // ONE copy per arrival, enqueued before GpuCompose's submit (§6's order).
      // `premultipliedAlpha` because the compose pass blends premultiplied
      // (`BLEND_PREMUL`); no `flipY` because the copy's origin is the source's
      // top-left and the card's uv origin is its content rect's top-left — the
      // measured orientation, re-witnessed by the `next-video` rig.
      device.queue.copyExternalImageToTexture(
        { source, origin: { x: 0, y: 0 } },
        { texture: rec.texture, origin: { x: 0, y: 0 }, premultipliedAlpha: true },
        { width, height },
      );
      closeSource(source);
      copies += 1;
      rec.copied = true;
      rec.lastCopyMs = now();
      // the dirt latch outside the world: these pixels are new (`WakeReason "content"`)
      residency.wrote(e);
    }
    queued.clear();
    // The debt re-asserted for a destination that came back (module header).
    for (const [e, rec] of records) {
      if (!rec.copied || residency.isWritten(e)) continue;
      residency.wrote(e);
    }
  };

  return {
    reflector: { name: "video-ingest", flush: flushQueue },

    register(entity, spec) {
      const table = residency.table;
      if (table === null) {
        console.warn("[ice] ground/compose: video register before the profile attached its texture table — nothing is registered");
        return NO_TEXTURE;
      }
      const kind = world.get(entity, SurfaceKind)?.kind;
      if (kind !== undefined && kind !== "video") {
        // Residency reads `stableOf` only on the video branch (§6 step 4), so a
        // registration against another kind would sit in the table naming nothing.
        console.warn(`[ice] ground/compose: video registered for a "${String(kind)}" surface — only a video kind's TextureRef names a registered handle`);
      }
      detach(entity);
      const limit = device.limits.maxTextureDimension2D;
      const width = Math.max(1, Math.min(Math.floor(spec.width), limit));
      const height = Math.max(1, Math.min(Math.floor(spec.height), limit));
      const srgb = spec.srgb === true;
      const handle = table.register(entity, { width, height, srgb });
      const texture = device.createTexture({
        label: `content/video:${String(entity)}`,
        size: { width, height },
        format: srgb ? "rgba8unorm-srgb" : "rgba8unorm",
        // RENDER_ATTACHMENT is required OF THE DESTINATION by
        // `copyExternalImageToTexture` (the copy is a draw on some backends).
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      // Realised through the residency, never `table.realize`: the table reports only
      // REALISED handles in `drain()`, so a texture it never heard of would leak.
      if (!residency.realize(handle, texture)) return NO_TEXTURE;   // the texture was destroyed there
      records.set(entity, { handle, texture, width, height, copied: false, lastCopyMs: Number.NEGATIVE_INFINITY });
      return handle;
    },

    arrive(entity, source) {
      arrivals += 1;
      const rec = records.get(entity);
      if (rec === undefined) { drop(source); return false; }
      const demand = demandOf(entity);
      if (demand.mode === "paused") { pausedDrops += 1; drop(source); return false; }
      // Infinity here is a LIVE card at bucket 0 — "no rate at all" (paused left above).
      const interval = demandIntervalMs(demand);
      if (!Number.isFinite(interval)) { drop(source); return false; }
      if (now() - rec.lastCopyMs < interval) { drop(source); return false; }
      const superseded = queued.get(entity);
      if (superseded !== undefined) drop(superseded);
      queued.set(entity, source);
      return true;
    },

    unregister(entity) {
      detach(entity);
      // The registration IS the table's reference: dropping it lets the handle drain
      // once Residency stops naming it, and `collect` destroys the texture then.
      return residency.table?.unregister(entity) ?? false;
    },

    stats: () => ({ registered: records.size, arrivals, copies, dropped, paused: pausedDrops }),
    handleOf: (entity) => records.get(entity)?.handle ?? NO_TEXTURE,

    dispose() {
      // `drop`, not a bare close: a frame that never became a copy is a DROP, and the
      // counters have to keep `arrivals === copies + dropped` true through a teardown too.
      for (const source of queued.values()) drop(source);
      queued.clear();
      records.clear();
    },
  };
}
