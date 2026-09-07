/**
 * The NEW composited profile (design-013 §8 B2 — beside the old one until B8
 * deletes it and this one takes the name `composited`).
 *
 * It requires of its host what the old profile does — the app-owned device —
 * and one thing more: the ground layer must be the ground's OWN
 * (`groundCompose({ device, theme })` from `@ice/ground/compose`), which this
 * profile recognises by the handle's `compose` field. `groundField()` — the
 * stratified profile's ground — is refused: it has no GpuCompose to register,
 * and a device-less or stratified ground under this profile would render a
 * plausible screen that is quietly the wrong one (the class §7 of design-013
 * names).
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
import { createResidencyStore, installSurfaceInfra, type ReflectorDef, type TextureTable, type World } from "@ice/core";
import type { RasterStrategy } from "@ice/kernel";
import type { PresentationProfile, ProfileBootContext } from "./contract";

/** Structural read of the opaque ground handle's `compose` field (`GroundCompose` in `@ice/ground/compose`, mirrored — react may not import ground). */
interface Compose {
  readonly gpuCompose: ReflectorDef;
  readonly domCompose?: ReflectorDef;
  /** The content residency (B4a): the profile's texture table is attached here at install, so the renders can realise its handles. */
  readonly residency?: { attach(table: TextureTable): void };
  /** The render slots (B4a): filled after the mount by each source's owner; forwarded here in §6's order. */
  readonly renders?: { readonly [k in "dom" | "island" | "video"]: { current: { flush(world: World): void } | null } };
  /**
   * The raster strategy the ground was built with (B4, §9 Q1). It is declared ONCE — on
   * `groundCompose({ raster })` — because two readers need it and they must never disagree:
   * Residency sizes the slot with it, and DomRender sizes the L1 host with it. This profile
   * carries it from the one to the other; absent ⇒ Residency's own `band` default.
   */
  readonly raster?: (kind: "dom" | "gl" | "video") => RasterStrategy;
}
interface ComposeSlot {
  readonly compose?: Compose;
}
function composeOf(ctx: ProfileBootContext): Compose | undefined {
  return (ctx.ground as ComposeSlot | null)?.compose;
}

/** A reflector that holds a place in the roster and does nothing — B3–B6 replace it. */
const stub = (name: string): ReflectorDef => ({ name, always: false, flush() {} });
/** A reflector that holds a place in the roster for a render installed after the mount (B4a's slots). */
const forward = (name: string, slot: { current: { flush(world: World): void } | null } | undefined): ReflectorDef =>
  slot === undefined ? stub(name) : { name, always: true, flush(w) { slot.current?.flush(w); } };

export const compositedProfile: PresentationProfile = {
  name: "composited",
  // design-014, B3b: the ground draws every card's chrome; the DOM host is content only.
  chromeOwner: "ground",
  // B4: the dom reflector MOUNTS and REPARENTS hosts by target, and DomRender copies from a
  // host that must already be an immediate child of the L1 canvas. Registered after this
  // profile's roster, a promotion would reach the copy one flush late and the card would show
  // its plate for a frame on every grab. Only this profile asks for the swap: the old leg's
  // `domWriteback` sits INSIDE its roster and wants today's order.
  hostsBeforeRoster: true,
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
    if (composeOf(ctx) === undefined) {
      return (
        "the ground layer is not the ground's own — wire groundCompose({ device: engine.compositorDevice.device, theme }) " +
        "from @ice/ground/compose, not groundField()"
      );
    }
    return null;
  },
  reflectorsAfterGround(ctx) {
    const c = composeOf(ctx);
    if (c === undefined) return [];
    // DomCompose is the ground's when the handle carries it (B3b): it runs the frame's build and writes the
    // hosts' clip, lift and opacity BEFORE GpuCompose draws the same geometry (§6's order, kept).
    const roster: ReflectorDef[] = [];
    // 5 — DomRender (B4): HiC copies into the page layers Residency named.
    roster.push(forward("dom-render", c.renders?.dom));
    // 6 — IslandRender (B5): three renders into the pooled own targets.
    roster.push(forward("island-render", c.renders?.island));
    // 7 — VideoIngest (B6): a frame's arrival into the registered stable texture.
    roster.push(forward("video-ingest", c.renders?.video));
    // 8 — DomCompose (B3b), 9 — GpuCompose: the ground's.
    roster.push(c.domCompose ?? stub("dom-compose"));
    roster.push(c.gpuCompose);
    return roster;
  },
  install(ctx) {
    // The texture table is the PROFILE's (design-013 §5): Residency writes handles into it, the
    // ground's residency realises them, and both outlive a system swap — so the profile builds
    // the store, hands the table to the ground (B4a) and to the infra, and disposes it last.
    const c = composeOf(ctx);
    const store = createResidencyStore({});
    c?.residency?.attach(store.table);
    const limit = ctx.engine.compositorDevice?.device.limits.maxTextureDimension2D;
    // `ctx.engine` is the FACADE; the phase-group registry lives on the raw engine it wraps.
    const remove = installSurfaceInfra(ctx.engine.engine, {
      residency: {
        table: store.table,
        allocator: store.allocator,
        ...(limit !== undefined ? { maxTextureSize: limit } : {}),
        // ONE raster strategy, carried from the ground's own declaration to the system that
        // sizes the slot — the other reader, DomRender, calls `geometry()` with the same
        // function, which is what makes the copy and the slot the same number (B4, §9 Q1).
        ...(c?.raster !== undefined ? { raster: c.raster } : {}),
      },
    });
    return () => { remove(); store.table.dispose(); };
  },
};
