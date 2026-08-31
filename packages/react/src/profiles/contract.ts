/**
 * Presentation profiles (design-012 §3, §11 Q7 — "presentation profile", never
 * "renderer profile", which collides with three/ground vocabulary).
 *
 * TWO profiles implement ONE contract, and which one an app runs is a
 * BUILD-TIME fact, exactly as design-010 settled for grid implementations: an
 * app imports one profile factory, the unimported one tree-shakes out of its
 * bundle, and `<InfiniteCanvas>` never learns a mode. There is deliberately no
 * runtime toggle — a boolean here would mean two live architectures forever,
 * which decision 1 rejected on maintenance grounds.
 *
 * A profile contributes exactly two things at this stage:
 *
 *  1. A BOOT CHECK. One profile ships per packaged app (§11 Q2), so a
 *     composited build that finds no device has nothing honest to render and
 *     must refuse loudly rather than degrade into the stratified path. The
 *     check returns the reason; the mount turns it into a throw.
 *  2. The reflectors it adds to the roster, flushed immediately after the
 *     ground layer's own (plan §4.3).
 *
 * The profiles never import each other — dependency-cruiser enforces it.
 */
import type { CanvasEngine, ReflectorDef } from "@ice/core";
import type { GroundLayerHandle } from "../infinite-canvas";

export type PresentationProfileName = "stratified" | "composited";

export interface ProfileBootContext {
  readonly engine: CanvasEngine;
  /** The mounted ground layer, or null when the app wired no `ground` prop. */
  readonly ground: GroundLayerHandle | null;
}

export interface PresentationProfile {
  readonly name: PresentationProfileName;
  /**
   * Boot-time gate. Return a human-readable reason to REFUSE, or null to
   * proceed. The reason reaches the developer as a thrown error from the mount
   * — the same posture as the app's own capability refusal, one layer in.
   */
  check(ctx: ProfileBootContext): string | null;
  /**
   * Reflectors this profile contributes, registered (and therefore flushed)
   * immediately after the ground layer's reflector.
   */
  reflectorsAfterGround(ctx: ProfileBootContext): readonly ReflectorDef[];
}
