/**
 * The NEW composited profile (design-013 §8 B2 — beside the old one until B8
 * deletes it and this one takes the name `composited`).
 *
 * It requires of its host what the old profile does — the app-owned device —
 * and one thing more: the ground layer must be the ground's OWN
 * (`groundCompose({ device, theme })` from `@ice/ground/compose`), which this
 * profile recognises by the handle's `compose` field. `ground()` — the old
 * leg's layer — is refused: it has no GpuCompose to register, and a device-
 * less or old-leg ground under this profile would render a plausible screen
 * that is quietly the wrong one (the class §7 of design-013 names).
 *
 * ROSTER (design-013 §6, reflectors 5–9, by registration order — the queue-op-
 * before-submit law): DomRender · IslandRender · VideoIngest · DomCompose ·
 * GpuCompose. At B2 the first four are inert stubs holding their PLACE; B3–B6
 * fill them. GpuCompose is the ground's, handed through the handle and
 * registered LAST, after the renders that fill the textures it samples. The
 * facade registers the ground layer's own `reflector` first — the handle keeps
 * that slot inert for the same reason.
 *
 * SYSTEMS: the surface infra set (Band · Demand · Residency), the same call
 * the old profile makes — shared vocabulary from core, never an import of the
 * old profile (dependency-cruiser holds the wall).
 */
import { installSurfaceInfra, type ReflectorDef } from "@ice/core";
import type { PresentationProfile, ProfileBootContext } from "./contract";

/** Structural read of the opaque ground handle's `compose` field. */
interface ComposeSlot {
  readonly compose?: { readonly gpuCompose: ReflectorDef };
}
function composeOf(ctx: ProfileBootContext): { readonly gpuCompose: ReflectorDef } | undefined {
  return (ctx.ground as ComposeSlot | null)?.compose;
}

/** A reflector that holds a place in the roster and does nothing — B3–B6 replace it. */
const stub = (name: string): ReflectorDef => ({ name, always: false, flush() {} });

export const compositedNextProfile: PresentationProfile = {
  name: "composited-next",
  check(ctx) {
    if (ctx.engine.compositorDevice === undefined) {
      return (
        "the composited-next profile needs an app-owned GPUDevice — call acquireCompositorDevice() " +
        "and pass it as createCanvasEngine({ compositorDevice })"
      );
    }
    if (ctx.ground === null) {
      return "the composited-next profile needs a ground layer — pass the `ground` prop";
    }
    if (composeOf(ctx) === undefined) {
      return (
        "the ground layer is not the ground's own — wire groundCompose({ device: engine.compositorDevice.device, theme }) " +
        "from @ice/ground/compose, not ground()"
      );
    }
    return null;
  },
  reflectorsAfterGround(ctx) {
    const c = composeOf(ctx);
    if (c === undefined) return [];
    return [stub("dom-render"), stub("island-render"), stub("video-ingest"), stub("dom-compose"), c.gpuCompose];
  },
  install(ctx) {
    // `ctx.engine` is the FACADE; the phase-group registry lives on the raw engine it wraps.
    return installSurfaceInfra(ctx.engine.engine, { residency: {} });
  },
};
