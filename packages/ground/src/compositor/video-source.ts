/**
 * The `video` leg of the widget quad pass (design-012 §4 "video (live
 * surface)", §6.4, plan §5 S7).
 *
 * A live surface is STATE, not an event: the compositor samples the latest
 * frame every composite, and a composite that arrives between frames shows the
 * last good one rather than blinking out. That sentence is the entire contract,
 * and everything below follows from it.
 *
 * ── RETENTION BELONGS TO THE SOURCE, NOT TO THE COMPOSITOR ────────────────
 * The registry hands over a `frame()` getter, and this asks it once per
 * composite. WHICH frame comes back — the newest decoded, one held from three
 * frames ago, or none at all — is the source's business, and the compositor
 * neither caches, retains, nor closes anything.
 *
 * That split is not tidiness; it is what lets the real consumer arrive later
 * without reopening this file. The ICE fixture below the seam may hold a
 * `VideoFrame` forever, because nothing else wants it. The downstream
 * consumer (VibeField's live surfaces) runs under a PRODUCER LEASE PROTOCOL
 * where a retained frame starves a two-transfer budget, so it must copy once
 * into a stable texture per new frame and close the frame immediately — and it
 * can, because retention was never the compositor's to do. design-012 §6.4
 * says exactly this: the LESSON (a surface is state; the compositor samples a
 * retained latest) is the contract, and the retention MECHANISM is the
 * consumer's.
 *
 * A consumer that copies into its own texture simply registers a `gl`-shaped
 * source instead of a `video` one, and this leg is not involved at all.
 *
 * ── A SURFACE IS STATE, AND THE MEASUREMENT SHOWS IT ──────────────────────
 * Measured by `composited-app.mjs`: the fixture produced 8 frames while the
 * compositor composited 24 in the same window — composites outrunning
 * productions 3:1, which is the exact condition that produced the spike's
 * 15 %-defect — and the surface appeared on 24 of 24, because every composite
 * samples the retained latest rather than waiting for an arrival. A
 * frame-as-event design would have shown gaps on the two composites in three
 * that fall between productions. With no source registered the same grade
 * reads 0 of 8 at rgba(0,0,0,0), so the check can fail.
 *
 * ── THE IMPORT NEVER CROSSES AN AWAIT ─────────────────────────────────────
 * `importExternalTexture` yields a handle valid only for the task that
 * imported it, so the import happens inside the quad pass's `encode` — inside
 * the reflector's synchronous flush — and neither the texture nor its bind
 * group is ever cached. This module therefore hands the pass the FRAME, not a
 * texture: the one place that can legally import is the one place that does.
 */
import type { CompositorSourceVideo } from "@ice/core";
import type { QuadTexture } from "./widget-quad-pass";

/** Structural read of a `VideoFrame`'s display size — core may not name one. */
interface FrameLike {
  readonly displayWidth?: number;
  readonly displayHeight?: number;
  readonly codedWidth?: number;
  readonly codedHeight?: number;
}

export interface VideoSourceOptions {
  /**
   * Do this producer's frames run bottom-up relative to the compositor?
   *
   * Default FALSE, and MEASURED rather than assumed — the same discipline the
   * island leg's orientation went through, where the inherited answer turned
   * out to be backwards. `composited-app.mjs` drives BOTH orientations against
   * a fixture that draws a bright band above and a dark one below, and grades
   * the signed luminance difference between a top tap and a bottom one:
   *
   *   as-is    bright band on top    +201.1   ← SHIPPED
   *   flipped  bright band below     −201.1
   *   window capture, same taps      +200.9
   *
   * THE VERDICT: a `VideoFrame` imported through `importExternalTexture`
   * arrives Y-DOWN — top-down, the compositor's own row order — so the pass's
   * flip capability is NOT engaged for video and `flipY` ships false. The two
   * arms disagree in sign, so this is a measurement and not a restatement of
   * the default; and the window capture agrees with the readback to 0.2/255 at
   * the same coordinates, so it is not one witness agreeing with itself. This
   * contradicts the folklore that video is always y-up: an external texture
   * lands the same way up as an island target.
   *
   * It is an option rather than a constant because it is a fact about the
   * PRODUCER, not about the kind: a camera, a decoder and a canvas need not
   * agree, and a consumer that knows its own producer should say so. The flip
   * is kept as a tested capability (a negative-height UV rect, no fragment
   * branch — exactly the gl leg's mechanism), exercised on every rig run as
   * the control arm rather than left as dead code.
   */
  readonly flipY?: boolean;
}

/**
 * Resolve a registered live surface into something the pass can sample, or
 * `undefined` when the source has no frame to offer right now.
 *
 * `undefined` is a normal state, not an error: before the first frame, and
 * whenever a paused source declines to hand one over. The quad pass skips it,
 * exactly as it skips an atlas slot with no resident pixels.
 */
export function resolveVideoSource(
  source: CompositorSourceVideo,
  options: VideoSourceOptions = {},
): QuadTexture | undefined {
  const frame = source.frame();
  if (frame === undefined) return undefined;
  const f = frame as FrameLike;
  // An external texture samples in NORMALIZED coordinates over the whole
  // frame, so the rect is the full image; the sizes below exist only to make
  // that rect normalize to 0..1 and to keep the crop arithmetic uniform with
  // the atlas leg.
  const width = f.displayWidth ?? f.codedWidth ?? 1;
  const height = f.displayHeight ?? f.codedHeight ?? 1;
  return {
    external: frame,
    rect: { x: 0, y: 0, width, height },
    textureWidth: width,
    textureHeight: height,
    // An imported external texture is delivered in the destination colour
    // space, so there is no `-srgb` decode to undo — the same passthrough a
    // dom atlas page gets.
    srgb: false,
    premultiplied: true,
    flipY: options.flipY === true,
  };
}
