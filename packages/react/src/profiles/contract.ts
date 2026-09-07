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
 * A profile contributes exactly three things (the third added 2026-09-06,
 * design-013 Q6 — an ERRATUM to this header's former "exactly two"):
 *
 *  1. A BOOT CHECK. One profile ships per packaged app (§11 Q2), so a
 *     composited build that finds no device has nothing honest to render and
 *     must refuse loudly rather than degrade into the stratified path. The
 *     check returns the reason; the mount turns it into a throw.
 *  2. The reflectors it adds to the roster, flushed immediately after the
 *     ground layer's own (plan §4.3).
 *  3. The SYSTEMS it installs — {@link PresentationProfile.install}. A profile
 *     IS the system-set it installs (design-013 Q6, first use): the fix wave's
 *     "copied wiring" class is an app being handed a boot sequence to
 *     reproduce, and the answer is that there is nothing left for an app to
 *     reproduce.
 *
 * The profiles never import each other — dependency-cruiser enforces it.
 */
import type { CanvasEngine, ReflectorDef } from "@ice/core";
import type { GroundLayerHandle } from "../infinite-canvas";

export type PresentationProfileName = "stratified" | "composited" | "composited";

export interface ProfileBootContext {
  readonly engine: CanvasEngine;
  /** The mounted ground layer, or null when the app wired no `ground` prop. */
  readonly ground: GroundLayerHandle | null;
}

export interface PresentationProfile {
  readonly name: PresentationProfileName;
  /**
   * Who draws a card's CHROME under this profile (design-014, B3b): `dom` —
   * the app's card shell paints its plate, shadow, ring and lift in CSS (the
   * stratified and the old composited profiles); `ground` — the ground draws
   * all of it and the DOM host is content only, clipped by the same
   * `resolve()`. Reaches widgets as `useChromeOwner()`; an app's shell renders
   * bare under `ground`. Absent = `dom`.
   */
  readonly chromeOwner?: "dom" | "ground";
  /**
   * Does the DOM host reflector (`domWidgets`) run BEFORE this profile's roster
   * (design-013 §6, B4)? It MOUNTS hosts and REPARENTS them by `SurfaceTarget`,
   * and a render that copies a promoted host needs that reparent to have
   * already happened this flush — otherwise the card's first frame on the GPU
   * finds its host still on the content plane, copies nothing, and shows its
   * plate for a frame on every grab. Absent = false: the stratified and old
   * composited profiles keep today's order, where `domWriteback` sits inside
   * the roster and must follow the reparent, not precede it.
   */
  readonly hostsBeforeRoster?: boolean;
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
  /**
   * Systems this profile installs into the engine, as ONE call returning ONE
   * remover (design-013 Q6). Called by the mount AFTER the reflector roster is
   * registered — a reflector arms reactivity, and the systems installed here
   * write components those reflectors observe, so the observers must exist
   * before the first frame that could stamp them.
   *
   * Optional: a profile with no systems of its own says so by omitting it,
   * which is what the stratified profile does.
   */
  install?(ctx: ProfileBootContext): () => void;
}
