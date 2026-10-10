// THE LIVE FACE (design-019 §3, §9 — PORTALS' seam; M24 LT1): a kind's face may show a surface that lives OUTSIDE the world — a web
// page, a captured window, a simulator's screen, later a terminal — as a texture on the desk's device that the HOST fills and the
// kind samples. Nothing about a source enters the desk: the host LENDS a `LiveSources` under the `LIVE` key (`deskLayer({ services })`,
// as it lends its text raster and its byte store); a kind's world half opens a FACE on it per object, by the object's durable key
// (`KindHost.keyOf`), takes what arrived in its tick and draws the face's `LiveTexture` — a view, never a frame (VibeField's PA-22:
// a plugin never touches a frame). THIS MODULE IS THE KIND'S HALF (petition I51) — what a kind reads and is lent:
//  - `LiveTexture` — the READER of a face's texture: its size, the counters that say when to rebind or make its mips again, `view()`,
//    `prepare(encoder, upTo)` (its mips, only as deep as they are read, into the frame's encoder) — and `liveDepth`;
//  - the contract a host lends (`LIVE`, `LiveSources`, `LiveFace` and its words: `LiveState`, `LiveInfo`, `LiveDemand`, `LiveInput`);
//  - `createSight` — where a kind's faces were drawn, folded into one fact per entity per frame (seen, the largest device px, held):
//    what the kind's demand law reads.
// The HOST's half — `createLiveTexture` (the writer that takes frames) and `stillLive` (a still host's source of committed bytes) — is
// host/live-texture.ts, on `@vibecook/ice/desk` beside `deskLayer` and off this kit: a kind never makes a face's texture, and the kit's
// module graph cannot reach the writer (`desk-dom-free`: nothing outside host/ imports host/).
// THE WAKE (§3.3): `arrived` → the kind's `KindHost.wake()` → its tick `take()`s each woken face → a face that answers true asks
// `KindHost.redraw()` and the tick answers FALSE: the frame is drawn again and no record is remade. A quiet source sends nothing, so a
// desk of live faces at rest submits nothing.

import type { Entity } from "@ice/core";
import type { SlotContext } from "../kind";
import type { ObjectRect } from "../kinds/world";
import { boxOf } from "../lattice/lod";
import { type ServiceKey, serviceKey } from "./services";

// ---------------------------------------------------------------- the texture

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
 *
 * WHAT MEETS THE SLOT'S BOX (petition I50): a slot's records are prepared within their kind's REACH — beyond the view, for a shadow or
 * a glow — so a pass may tell every record it PREPARED: `saw` itself believes only a face whose rect meets the slot's box (`view.box`
 * — a mini mat's face for its inside — or the whole view), under the slot's camera. One wholly outside reads `seen: false` (its
 * source may rest); one straddling the edge is seen at its FULL px — a face half on screen is still asked at its size.
 */
export interface Sight {
  /**
   * In `prepare`, per slot, per record: the face's rect (the slot's world units, axis-aligned — a turned face passes the rect that
   * covers it) → device px through the slot's view, when it meets the slot's box (I50); its `w`, `h` are the px folded, whole.
   */
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

/** Does `face` (world units, under the slot's camera) meet the slot's box (CSS px of the attachment — petition I50)? Touching is not meeting. */
function meetsBox(view: SlotContext["view"], face: ObjectRect): boolean {
  const b = boxOf(view);
  const x0 = (face.cx - face.w / 2 - view.camX) * view.zoom;
  const y0 = (face.cy - face.h / 2 - view.camY) * view.zoom;
  return x0 + face.w * view.zoom > b.x && x0 < b.x + b.w && y0 + face.h * view.zoom > b.y && y0 < b.y + b.h;
}

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
      if (!meetsBox(slot.view, face)) return;   // prepared within the kind's reach, drawn nowhere the eye sees (I50)
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
