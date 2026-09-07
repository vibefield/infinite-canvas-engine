/**
 * The CONTENT seam a render reflector reaches (design-013 §5, §6 reflectors
 * 5–7 — B5's plumbing).
 *
 * Core's Residency system decides where a card's pixels live and writes
 * `TextureRef`; the ground's compose layer decides what a handle IS on the
 * device (`ContentResidency`, B4a) and holds the three render slots the
 * profile forwards. The renders themselves live OUTSIDE both packages — the
 * ground's own DomRender (B4), the r3f island root (B5), a video producer
 * (B6) — so they need a way to reach those two objects.
 *
 * This module is that way, and it is deliberately STRUCTURAL: `@ice/react`
 * may not import `@ice/ground` (`nobody-imports-ground`), so what follows
 * MIRRORS `GroundCompose.residency` / `GroundCompose.renders` the same way
 * `GroundLayerHandle` mirrors the layer itself and `profiles/composited`
 * mirrors the handle's `compose` field. `@ice/r3f` sits above react and
 * imports these types rather than restating them: one mirror, checked where
 * the app wires the real object into `<InfiniteCanvas ground={…}>`.
 *
 * WHY A CONTEXT rather than a prop. The app does not own the ground handle —
 * it passes a FACTORY (`ground={groundCompose({…})}`) and `<InfiniteCanvas>`
 * calls it at mount. Threading the handle back out to the app so it could
 * hand it to `<GLViews>` would make every app re-implement the rig's
 * factory-wrapping trick. The context is published by the same effect that
 * builds the layer, so a GL root mounted from `onReady` (the documented
 * order — the wall keeps R3F app-side) sees it on its first render.
 */
import type { Entity, TextureHandle, World } from "@ice/core";
import { createContext, useContext } from "react";

/**
 * What a render needs to know about a handle's table entry: its kind, and —
 * for a private (`own`) or registered (`stable`) texture — the size Residency
 * sized it to, in DEVICE px. Structural mirror of core's `TextureEntry`
 * union; `pages` carries neither width nor height, which is why both are
 * optional here rather than absent from the type.
 */
export interface TextureDescription {
  readonly kind: "pages" | "own" | "stable";
  readonly width?: number;
  readonly height?: number;
}

/**
 * The half of the ground's `ContentResidency` a RENDER uses (B4a). Every
 * realisation goes through `realize` — never `TextureTable.realize` — because
 * the table's forget rule reports only realised handles in `drain()`, so a
 * texture the table never heard of would leak.
 */
export interface ContentSink {
  /** The profile's texture table, attached at install; `null` before it. */
  readonly table: { describe(handle: TextureHandle): TextureDescription | undefined } | null;
  /**
   * Give a handle its `GPUTexture`. `owned: false` for a producer's own object
   * (an island's render target): the residency then only FORGETS it, and the
   * producer disposes on {@link ContentSink.onForget}.
   */
  realize(handle: TextureHandle, texture: GPUTexture, opts?: { readonly owned?: boolean }): boolean;
  /** The realised texture for a handle, if any. */
  textureOf(handle: TextureHandle): GPUTexture | undefined;
  /** This render wrote the card's CURRENT destination: from this frame it draws from it. Touches the dirt latch. */
  wrote(entity: Entity): boolean;
  /** Is the card's current destination written? A new destination is a new debt (§10.2). */
  isWritten(entity: Entity): boolean;
  /** Arm a callback for a handle the residency forgets (its table entry drained); returns the disarm. */
  onForget(cb: (handle: TextureHandle) => void): () => void;
}

/**
 * A render's place in the roster, filled AFTER the mount by whoever owns the
 * source. `flush` obeys the reflector contract: post-notify, never writes the
 * ECS, never reads layout.
 */
export interface ContentRenderSlot {
  current: { readonly name: string; flush(world: World): void } | null;
}

export interface ContentRenderSlots {
  readonly dom: ContentRenderSlot;
  readonly island: ContentRenderSlot;
  readonly video: ContentRenderSlot;
}

/** The compose layer's content seam, as a render reflector sees it. */
export interface SurfaceContent {
  readonly residency: ContentSink;
  readonly renders: ContentRenderSlots;
}

/**
 * Published by `<InfiniteCanvas>` when the ground layer it mounted carries a
 * compose handle (the composited profile). `undefined` under every other
 * profile — which is exactly how a GL root selects its arm.
 */
export const SurfaceContentContext = createContext<SurfaceContent | undefined>(undefined);

/** The mounted ground's content seam, or `undefined` when the profile has none. */
export function useSurfaceContent(): SurfaceContent | undefined {
  return useContext(SurfaceContentContext);
}

/** The shape {@link surfaceContentOf} looks for on an opaque ground handle. */
interface ComposeSlot {
  readonly compose?: {
    readonly residency?: ContentSink;
    readonly renders?: ContentRenderSlots;
  };
}

/**
 * Read the content seam off an opaque ground layer handle. `undefined` for the
 * stratified `groundField()` (no compose field) and for no ground at all — the same
 * structural read the composited profile makes of the same object.
 */
export function surfaceContentOf(handle: unknown): SurfaceContent | undefined {
  const compose = (handle as ComposeSlot | null | undefined)?.compose;
  const residency = compose?.residency;
  const renders = compose?.renders;
  if (residency === undefined || renders === undefined) return undefined;
  return { residency, renders };
}
