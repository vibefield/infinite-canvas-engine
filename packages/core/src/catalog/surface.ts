/**
 * `Retained` — the nav crossfade's pin (design-013 §4, §5), kept at design-015 D5b when the rest
 * of the presentation vocabulary this file held — the six surface facts (`SurfaceKind`,
 * `SurfaceTarget`, `RequestedDemand`, `SurfaceDemand`, `SurfaceBand`, `TextureRef`),
 * `NO_TEXTURE` and `effectiveTarget` — left with the DOM/GPU presentation choice it described.
 * Nothing presents anywhere but the desk (design-015 §1).
 *
 * The desk renderer's working set is `Visible`/`Culled` (camera-derived.ts); `Retained` is the
 * one tag that outlives a cull: a departed frame's objects wear it for the length of a nav flight
 * (`systems/nav-flight.ts` tags on departure and releases on arrival — B9 review blocker 4), so a
 * renderer that keeps per-object GPU state — a raster, a texture — knows not to forget it
 * mid-crossfade. Written by the nav flight and by nothing else.
 */
import { defineTag } from "../schema/meta";

export const Retained = defineTag("Retained");
