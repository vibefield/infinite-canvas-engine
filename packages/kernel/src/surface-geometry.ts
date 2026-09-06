/**
 * Surface geometry — ONE call that answers every size question about a card's
 * pixels (design-013 §5, §7 row one; the D9 statement in
 * `design-013-implementation-plan.md` §1).
 *
 * The fix-wave class this retires is "two writers of one number". The zoom
 * drift (M18 open item (a), CONFIRMED 2026-09-06) was exactly that: the dom
 * source binder sized its atlas slot at `world × BAND × dpr` while the
 * write-back sized the host's CSS box at `world × LIVE ZOOM`, and the two
 * numbers were computed in different modules from the same cells. A card banded
 * at 1 whose live zoom had drifted to 1.9 rasterised 304×183 device px into a
 * 160×96 slot and wrote 40,272 px past it — into the gutter ring and the
 * neighbour's slot — raising no validation error and no copy refusal.
 *
 * So: the copy size AND the uv AND the on-screen extent come out of ONE
 * function, from one set of inputs, and a caller that wants any of them takes
 * all of them. There is no second place to disagree with.
 *
 * ── The two raster strategies ──────────────────────────────────────────────
 *
 * **`band`** (the default — design-013 §9 Q1). The host's CSS box is sized in
 * BAND space, not at the live zoom, and the placement matrix carries the
 * residue `zoom / band`, which the band ladder's hysteresis holds inside
 * `[0.5, 2]`. Sizing the host at the band is what makes the drift ZERO rather
 * than merely bounded: the element rasterises at its own CSS box × the backing
 * scale, which is exactly `rasterSize`, so nothing can be written past the
 * slot. A continuous zoom then costs at most one re-raster per band edge
 * crossed, and in between the compose pass samples the same texture at a
 * different scale — which is what a linear filter and the 2 px gutters were
 * always for.
 *
 * **`crisp`**. The host is sized at the live zoom and re-rastered on every zoom
 * step the kind accepted, so `placement` and `written` agree to within the
 * ceil. A kind picks this when texel-exactness beats re-raster cost (a code
 * editor at rest); it pays a new slot per accepted step.
 *
 * Under BOTH strategies `SurfaceBand` is still the residency retention key
 * (design-013 §6.2) — the strategy changes what is rastered, never how the slot
 * is keyed.
 *
 * ── backingScale = dpr ─────────────────────────────────────────────────────
 * MEASURED, not assumed. The zoom-drift rig
 * (`apps/widgetlab-desktop/scripts/zoom-drift.mjs`) found an L1 host rasterises
 * at its CSS box × the L1 canvas's BACKING-STORE SCALE — a flat 2.000× at dpr 2
 * across every live zoom tested, and 1.000× against a deliberately 1× bitmap.
 * The live zoom does not enter it. That flatness is the whole reason `band` can
 * size the host and know what comes back.
 *
 * ── Why ceil, everywhere ───────────────────────────────────────────────────
 * `copyElementImageToTexture` writes the element's own rasterised size with no
 * extent argument, so a destination one pixel short of what the platform
 * rasterises writes past its rect. The rig's 91.2 CSS px came back as 183
 * device px, not 182 — the platform rounds UP, so we allocate up. Rounding down
 * (or `Math.round`) would re-open the overflow it took a rig to find. The
 * island formula `fboPixelSize` rounds instead of ceils; it is retired when B5
 * adopts this function, and nothing changes for islands before then.
 *
 * ── Units ──────────────────────────────────────────────────────────────────
 * `cssSize` is CSS px. `rasterSize`, `slotSize`, `written` and `placement` are
 * DEVICE px. `placement` is the camera transform's own product `size × zoom`
 * carried into device space by the backing scale, so it is directly comparable
 * to `written`: under `crisp` the two agree to within the ceil, and under
 * `band` their ratio IS the `zoom / band` the placement matrix carries. (D9
 * states the placement formula in CSS space, `size × zoom`, and its worked
 * fixture in device space, 304×182.4 for an 80×48 card at zoom 1.9 / dpr 2.
 * The fixture is the binding one: a placement that could not be held beside
 * `written` in the same units would answer no question anyone has.)
 *
 * ── band 0 throws, unconditionally ─────────────────────────────────────────
 * `SurfaceBand.band = 0` means "never banded" (design-013 D2's safe default),
 * and a never-banded card has no destination — the residency system's own
 * predicate is `band > 0`, so a 0 can only arrive here through a caller that
 * skipped it. This module is in `kernel`, whose import wall forbids reaching
 * ICE's `devGuardsEnabled` flag, so there is no dev/prod switch to consult; the
 * choice is between throwing always and coercing always. It throws. A coerced
 * band 1 would hand back a complete, plausible geometry for a card that has no
 * pixels anywhere — a confident number about nothing, which is the class this
 * module exists to close.
 */

/** How a kind wants its pixels rastered (design-013 D9). */
export type RasterStrategy = "band" | "crisp";

/** A 2D extent. World units, CSS px or device px depending on the field. */
export interface SurfaceExtent {
  readonly w: number;
  readonly h: number;
}

export interface SurfaceGeometry {
  /** The host's CSS box. CSS px. */
  readonly cssSize: SurfaceExtent;
  /** What the platform multiplies the CSS box by when it rasters. Measured flat at dpr. */
  readonly backingScale: number;
  /** The raster the source will produce. Device px, ceiled, min 1. */
  readonly rasterSize: SurfaceExtent;
  /** The destination residency must hold. Device px; equals `rasterSize`. */
  readonly slotSize: SurfaceExtent;
  /** What the copy actually writes — the uv numerator. Device px; equals `rasterSize`. */
  readonly written: SurfaceExtent;
  /** The card's on-screen extent at the live zoom. Device px, exact (no ceil). */
  readonly placement: SurfaceExtent;
}

/** Ceil to whole device px, never below one — a zero-px destination is not a destination. */
function pixels(w: number, h: number): SurfaceExtent {
  return { w: Math.max(1, Math.ceil(w)), h: Math.max(1, Math.ceil(h)) };
}

/**
 * Every size a card's pixels have, from one set of inputs.
 *
 * @param size  the card's WORLD size (`Size`), in world units
 * @param band  its held `SurfaceBand` — a power of two from `ZOOM_BANDS`; 0 throws
 * @param dpr   `Viewport.dpr`
 * @param zoom  `Camera.zoom`
 * @param raster the kind's strategy
 */
export function geometry(
  size: SurfaceExtent,
  band: number,
  dpr: number,
  zoom: number,
  raster: RasterStrategy,
): SurfaceGeometry {
  if (!(band > 0)) {
    throw new Error(
      `ice: geometry() got band ${band} — band 0 means "never banded", so this card has no destination and its caller should not have asked. Gate on \`SurfaceBand.band > 0\` (design-013 §6.4).`,
    );
  }
  // The host's CSS box: band space under `band`, live-zoom space under `crisp`.
  const cssW = raster === "band" ? size.w * band : size.w * zoom;
  const cssH = raster === "band" ? size.h * band : size.h * zoom;
  // What the platform rasters that box into — its own CSS size × the backing
  // scale, which the rig measured flat at dpr and independent of the zoom.
  const rasterSize = pixels(cssW * dpr, cssH * dpr);
  return {
    cssSize: { w: cssW, h: cssH },
    backingScale: dpr,
    rasterSize,
    // The slot IS the raster: sizing a destination to anything else is the
    // drift, restated. `written` is the same number under a name that says what
    // the uv divides — a copy writes its whole raster, never a sub-rect.
    slotSize: rasterSize,
    written: rasterSize,
    placement: { w: size.w * zoom * dpr, h: size.h * zoom * dpr },
  };
}
