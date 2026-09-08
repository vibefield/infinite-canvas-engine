// The CONTENT residency of the compose layer (design-013 §4, §5, §10.2 — B4a,
// the trunk B4, B5 and B6 build on). Core's Residency system decides WHERE a
// card's pixels live and writes `TextureRef`: a u32 handle into the profile's
// texture table, a layer, a written rect. This module is the other half — what
// a handle IS on the ground's device. The render reflectors (DomRender copies a
// host into a page layer; IslandRender renders an island into its own target;
// VideoIngest copies a frame into a registered stable texture) create their
// `GPUTexture`s on the ground's device and REALISE the handle here, then say
// they WROTE the card; the frame builder turns each card's `TextureRef` into
// the record's content term — `page` (the layer and the written rect, through
// the ONE page-array binding) or `own` (the run's texture, the sRGB variant
// chosen by its ACTUAL format, design-012 §4's law) — or `plate` until then.
//
// `empty` is never sampled (§10.2): a card draws from a texture only once a
// reflector has written THIS destination (`wrote`) — a fresh slot, a re-slot
// after an eviction, a promoted card whose copy has not landed, all draw the
// plate. What is written is keyed by the ref's own values, so a new
// destination is a new debt.
//
// Ownership: a texture realised here is destroyed here, when the table drains
// its handle (a card left, a re-slot, a re-size) — `collect()` runs once per
// drawn frame, AFTER the submit, so a texture is never destroyed under a
// command that reads it. A producer's own texture (`owned: false`) is only
// forgotten. Every realisation goes through `realize`, never `table.realize`
// directly: the table's forget rule reports only REALISED handles in
// `drain()`, so a texture the table never heard of would leak.
//
// Dirt: a copy, a render, an arrival or a realisation changes pixels the world
// knows nothing about, so `touch()` is the dirt latch OUTSIDE the world — the
// builder wakes on it (`WakeReason` "content").

import { type Entity, effectiveTarget, NO_TEXTURE, SurfaceKind, SurfaceTarget, type TextureHandle, type TextureTable, TextureRef, type World } from "@ice/core";
import { type FrameContent, PLATE, type UvRect } from "../card/content";

export type SurfaceTargetLabel = "dom" | "gpu";

/** The target a card ACTUALLY presents on (design-013 D5): its kind through `effectiveTarget`; `dom` when it has no surface facts. */
export function targetOf(world: World, e: Entity): SurfaceTargetLabel {
  const kind = world.get(e, SurfaceKind)?.kind;
  const target = world.get(e, SurfaceTarget)?.target;
  if (kind === undefined || kind === null || target === undefined || target === null) return "dom";
  return effectiveTarget(kind as "dom" | "gl" | "video", target as SurfaceTargetLabel);
}

/** A `TextureRef`'s values as one key — the destination a write is owed to. */
export function refKeyOf(ref: { readonly texture: number; readonly layer: number; readonly u0: number; readonly v0: number; readonly u1: number; readonly v1: number }): string {
  return `${ref.texture}|${ref.layer}|${ref.u0}|${ref.v0}|${ref.u1}|${ref.v1}`;
}

export interface RealizeOptions {
  /** Destroy the texture when its handle drains (the default); `false` for a producer's own texture, which is only forgotten. */
  readonly owned?: boolean;
}

export interface ContentResidencyStats {
  /** Handles realised right now. */
  readonly realized: number;
  /** Textures destroyed by `collect` so far. */
  readonly destroyed: number;
  /** `touch`es so far (a realisation or a write counts). */
  readonly touches: number;
  /** Cards with a written destination right now. */
  readonly written: number;
}

export interface ContentResidency {
  /** The profile's texture table (core's `TextureTable`), attached once at install; `null` before. */
  readonly table: TextureTable | null;
  attach(table: TextureTable): void;
  /**
   * Give a handle its `GPUTexture` (created on the ground's device). Replaces an earlier
   * realisation of the same handle — the earlier texture is destroyed at the next `collect`,
   * after this frame's submit (a page array that grew, D-B4.1: copy the layers first, then
   * realise the new array). `false` when the table does not know the handle: the texture is
   * destroyed here (if owned) and nothing is retained.
   */
  realize(handle: TextureHandle, texture: GPUTexture, opts?: RealizeOptions): boolean;
  /** The realised texture, if any. */
  textureOf(handle: TextureHandle): GPUTexture | undefined;
  /**
   * A reflector wrote the card's CURRENT destination (its `TextureRef` now): from this frame
   * the card draws from it. `false` when the card has no destination. Touches.
   */
  wrote(e: Entity): boolean;
  /**
   * The INVERSE of `wrote` (D-C4.7): the card's standing write is dropped, so it draws its PLATE
   * again from this frame. The oversize refusal is the caller — a card that copied once and then
   * grew past its destination inside the same band keeps its `TextureRef`, so the write would stand
   * and the card would draw the stale raster STRETCHED. Touches (the pixels a frame shows change),
   * so the builder wakes and the frame repaints.
   */
  unwrote(e: Entity): void;
  /** Is the card's current destination written? */
  isWritten(e: Entity): boolean;
  /** Pixels changed outside the world (a copy, a render, a frame's arrival): the next frame draws. */
  touch(): void;
  /** Arm a wake on `touch`; returns the disarm. */
  onTouch(cb: () => void): () => void;
  /**
   * Arm a callback for a handle this module FORGETS at `collect` (its table entry drained) —
   * the moment a producer that realised with `owned: false` may dispose its own object (an
   * island's render target). Returns the disarm.
   */
  onForget(cb: (handle: TextureHandle) => void): () => void;
  /** The card's content term this frame: `page` / `own` from its `TextureRef` once realised and written, else the plate. */
  contentOf(e: Entity): FrameContent;
  /** The realised page array's `2d-array` view — a NEW view when the array was re-realised (growth); `null` while none. */
  pagesView(): GPUTextureView | null;
  /**
   * The attached table's `revision()` — bumped by a producer's `register`/`unregister`, which no
   * world journal carries (core's `TextureTable`). A render that was REFUSED a realisation backs
   * off until this number or its handle moves (D-C4.7). `0` before a table is attached.
   */
  revision(): number;
  /** Drain the table's dead handles and destroy the textures this module owns; sweep the written set. Returns the textures destroyed. Call after the frame's submit. */
  collect(): number;
  stats(): ContentResidencyStats;
  /** Destroy every owned texture and forget everything; the table stays the profile's. */
  dispose(): void;
}

interface Realised {
  readonly texture: GPUTexture;
  readonly view: GPUTextureView;
  readonly kind: "pages" | "own" | "stable";
  readonly srgb: boolean;
  readonly owned: boolean;
}

const isSrgb = (t: GPUTexture): boolean => typeof t.format === "string" && t.format.endsWith("-srgb");

export function createContentResidency(world: World): ContentResidency {
  let table: TextureTable | null = null;
  const realised = new Map<TextureHandle, Realised>();
  const written = new Map<Entity, string>();
  const retired: GPUTexture[] = [];
  const listeners = new Set<() => void>();
  const forgetters = new Set<(handle: TextureHandle) => void>();
  let pagesHandle: TextureHandle = NO_TEXTURE;
  let destroyed = 0;
  let touches = 0;

  const touch = (): void => { touches += 1; for (const cb of listeners) cb(); };
  const refOf = (e: Entity) => world.get(e, TextureRef);

  return {
    get table() { return table; },
    attach(t) { table = t; },
    realize(handle, texture, opts) {
      const owned = opts?.owned ?? true;
      const entry = table?.describe(handle);
      if (table === null || entry === undefined || !table.realize(handle, texture)) {
        if (owned) texture.destroy();
        return false;
      }
      const prev = realised.get(handle);
      if (prev !== undefined) {
        if (prev.texture === texture) return true;
        if (prev.owned) retired.push(prev.texture);
      }
      const view = entry.kind === "pages" ? texture.createView({ dimension: "2d-array", label: "content/pages" }) : texture.createView({ label: `content/${entry.kind}` });
      realised.set(handle, { texture, view, kind: entry.kind, srgb: isSrgb(texture), owned });
      if (entry.kind === "pages") pagesHandle = handle;
      touch();
      return true;
    },
    textureOf: (handle) => realised.get(handle)?.texture,
    wrote(e) {
      const ref = refOf(e);
      if (ref === undefined || ref.texture === NO_TEXTURE) return false;
      written.set(e, refKeyOf(ref));
      touch();
      return true;
    },
    unwrote(e) { if (written.delete(e)) touch(); },
    isWritten(e) {
      const ref = refOf(e);
      return ref !== undefined && ref.texture !== NO_TEXTURE && written.get(e) === refKeyOf(ref);
    },
    touch,
    onTouch(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    onForget(cb) { forgetters.add(cb); return () => { forgetters.delete(cb); }; },
    contentOf(e) {
      if (table === null || targetOf(world, e) !== "gpu") return PLATE;
      const ref = refOf(e);
      if (ref === undefined || ref.texture === NO_TEXTURE) return PLATE;
      const r = realised.get(ref.texture);
      if (r === undefined || written.get(e) !== refKeyOf(ref)) return PLATE;
      const uv: UvRect = { u0: ref.u0, v0: ref.v0, u1: ref.u1, v1: ref.v1 };
      return r.kind === "pages" ? { mode: "page", layer: ref.layer, uv } : { mode: "own", texture: r.view, srgb: r.srgb, uv };
    },
    pagesView: () => realised.get(pagesHandle)?.view ?? null,
    revision: () => table?.revision() ?? 0,
    collect() {
      let n = 0;
      for (const t of retired) { t.destroy(); n += 1; }
      retired.length = 0;
      if (table !== null) {
        for (const h of table.drain()) {
          const r = realised.get(h);
          if (r === undefined) continue;
          realised.delete(h);
          if (r.owned) { r.texture.destroy(); n += 1; }
          if (h === pagesHandle) pagesHandle = NO_TEXTURE;
          for (const cb of forgetters) cb(h);
        }
      }
      // The written debt outlives a lost ref only where the pixels do: a PRIVATE texture (`own`, `stable`) is
      // nobody else's, so a culled card that comes back to the same destination owes nothing (a paused live
      // surface scrolled off and back would otherwise draw the plate forever, with no next frame to pay with —
      // B6's finding). A `pages` slot is shared: once the ref is gone the slot may be someone else's, and the
      // same rect returning is a new debt. A key whose handle the table forgot is dropped with it.
      for (const [e, key] of written) {
        const ref = refOf(e);
        const handle = Number(key.slice(0, key.indexOf("|")));
        const r = realised.get(handle);
        if (r === undefined) { written.delete(e); continue; }
        if (ref !== undefined && ref.texture !== NO_TEXTURE) { if (refKeyOf(ref) !== key) written.delete(e); continue; }
        if (r.kind === "pages") written.delete(e);
      }
      destroyed += n;
      return n;
    },
    stats: () => ({ realized: realised.size, destroyed, touches, written: written.size }),
    dispose() {
      for (const t of retired) t.destroy();
      retired.length = 0;
      for (const r of realised.values()) if (r.owned) r.texture.destroy();
      realised.clear();
      written.clear();
      listeners.clear();
      forgetters.clear();
      pagesHandle = NO_TEXTURE;
    },
  };
}
