/**
 * The COMPOSITED presentation profile (design-012 §2 — L0 + L1 + overlay).
 *
 * It requires three things of its host, and refuses at boot if any is absent
 * (§11 Q2: one profile per packaged app, so a failure is a loud refusal and
 * never a silent swap):
 *
 *  1. `engine.compositorDevice` — the app-owned device. The compositor's premise is
 *     that ground programs, islands and live surfaces write into one pass, and
 *     textures are not shareable across devices. Absent means the app skipped
 *     `acquireCompositorDevice()` and passed no `gpu` to `createCanvasEngine`.
 *  2. A ground layer. This profile's compositor lives inside it.
 *  3. That layer's `compositorReflector` — present only when the ground factory
 *     was given the device. Its absence means the app built the layer as
 *     `ground(...)` rather than `ground({ device: …compositorDevice.device })`, which
 *     would otherwise boot a "composited" app whose compositor does not exist.
 *
 * Refusing on (3) specifically is the one that earns its keep: (1) and (2) fail
 * visibly, while a device-less ground layer under a composited profile renders
 * a perfectly plausible screen that is quietly the stratified one.
 *
 * ROSTER (plan §4.3): the compositor reflector registers immediately after the
 * ground layer, so ground has published its frame before the compositor
 * presents. `domWriteback` (S3) and the L1 hosts (S2) join this list as their
 * slices land; the reflector's own dirty union is already live.
 *
 * SYSTEMS (design-013 Q6, first use — 2026-09-06): this profile also INSTALLS
 * the surface infra set, and that is the whole of its `install`. A profile IS
 * the system-set it installs. The alternative — publishing a list of systems an
 * app registers itself — is the "copied wiring" class the fix wave named: the
 * blank `groundHost` came from a boot sequence an app was expected to
 * reproduce, and a partial reproduction renders a plausible screen that is
 * quietly the wrong one. There is one call, and forgetting it is not something
 * an app can do.
 *
 * The infra set writes `SurfaceBand` and `SurfaceDemand` in `present:infra`; it
 * does NOT decide when a card promotes. That decision is the kind behaviour's,
 * through the behaviours door, and it is A1b's (nothing reads these facts yet —
 * the old composited leg still runs on the registry).
 *
 * MUST NOT import the stratified profile — dependency-cruiser enforces it.
 */
import { installSurfaceInfra, type ReflectorDef } from "@ice/core";
import type { PresentationProfile, ProfileBootContext } from "./contract";

/** Structural read of the opaque ground handle's compositor slot. */
function compositorOf(ctx: ProfileBootContext): ReflectorDef | undefined {
  return ctx.ground?.compositorReflector;
}

export const compositedProfile: PresentationProfile = {
  name: "composited",
  check(ctx) {
    if (ctx.engine.compositorDevice === undefined) {
      return (
        "the composited profile needs an app-owned GPUDevice — call acquireCompositorDevice() " +
        "and pass it as createCanvasEngine({ compositorDevice })"
      );
    }
    if (ctx.ground === null) {
      return "the composited profile needs a ground layer — pass the `ground` prop";
    }
    if (compositorOf(ctx) === undefined) {
      return (
        "the ground layer was built WITHOUT the device, so it has no compositor — " +
        "wire ground({ device: engine.compositorDevice.device }), not ground()"
      );
    }
    return null;
  },
  reflectorsAfterGround(ctx) {
    const compositor = compositorOf(ctx);
    return compositor === undefined ? [] : [compositor];
  },
  install(ctx) {
    // `ctx.engine` is the FACADE; the phase-group registry lives on the raw
    // engine it wraps.
    // Residency too (design-013 A2, plan §2 A2.4): the facts in the world are
    // complete only with `TextureRef`, and the system's budget is the
    // placeholder default until B3 measures one. Nothing reads `TextureRef`
    // before B3; installing it here is what makes the S6 witness and the real
    // app run the allocator under live frames rather than only under vitest.
    return installSurfaceInfra(ctx.engine.engine, { residency: {} });
  },
};
