/**
 * THE COMPOSITED PROFILE'S WIRING, in one place (design-012 §4).
 *
 * Two factories in this package build a ground layer — `ground()` for apps
 * that wire one, `groundHost()` for typed CanvasTypes — and both accept the
 * same `device` switch, because which profile an app runs must not depend on
 * which factory it happened to wire. That promise was made in prose and kept
 * in only one of them: `groundHost` built a quad pass with no facts, no
 * resolve, no order and no background, and no dom binder at all, so a
 * registered source warned once per composite and nothing was ever drawn. The
 * shipping app takes that path; the rigs hand-wire the seams and so never saw
 * it. Prose cannot hold two implementations in step — this module can.
 *
 * What lives here is exactly what both factories need and neither should own:
 * the two facts functions and why they are two, the source-kind dispatch, the
 * binder's wake, and the prepare that keeps owed work and live eases moving.
 * What stays outside is what genuinely differs — the renderer, the passes, the
 * layer.
 */
import type {
  CompositorSource,
  CompositorSourceRegistry,
  Entity,
  World,
} from "@ice/core";
import {
  createCompositorReflector,
  type CompositeTarget,
  type CompositorReflector,
} from "./compositor-reflector";
import {
  createDomSourceBinder,
  type DomSourceBinder,
  type DomSourceBinderOptions,
} from "./dom-source-binder";
import { resolveGlSource } from "./gl-source";
import type { LiftDriver } from "./lift";
import { createWorldQuadFacts } from "./quad-facts";
import { resolveVideoSource, type VideoSourceOptions } from "./video-source";
import { createWidgetQuadPass, type QuadTexture } from "./widget-quad-pass";

export interface CompositorWiringOptions {
  readonly world: World;
  /** The app-owned device — its presence IS the composited profile. */
  readonly device: GPUDevice;
  /** The registry producers register into; the compositor consumes it. */
  readonly registry: CompositorSourceRegistry;
  /** The swap-chain target. Absent ⇒ the reflector tracks dirt and draws nothing. */
  readonly target?: CompositeTarget;
  /** Paint order, back to front, in frame-parent sibling sequence (petition 8). */
  readonly order?: () => readonly Entity[];
  /** Tuning for the dom source atlas (page sizes, gutter, copy budget, demand). */
  readonly atlas?: DomSourceBinderOptions;
  /** The lift/fade driver (design-012 §7's "one lift"). */
  readonly lift?: LiftDriver;
  /** Live-surface options — notably whether this producer's frames are flipped. */
  readonly video?: VideoSourceOptions;
  /**
   * Ground's own offscreen colour target, drawn as the compositor's FIRST quad
   * (S6b). Absent ⇒ ground still presents itself and the compositor draws only
   * widgets — which is every S1–S6 build and both factories without a target.
   */
  readonly groundTexture?: () => GPUTexture | undefined;
}

export interface CompositorWiring {
  readonly compositor: CompositorReflector;
  readonly domSources: DomSourceBinder;
}

export function createCompositorWiring(opts: CompositorWiringOptions): CompositorWiring {
  const { device, registry, world } = opts;
  // The binder wakes the reflector and the reflector's `prepare` drives the
  // binder, so both closures reach the compositor through this holder rather
  // than through a value captured before it exists.
  const held: { compositor?: CompositorReflector } = {};

  // Facts and slot sizes come from the SAME read of the world, so a quad and
  // its atlas slot can never disagree about how big a card is.
  // TWO facts functions over one world, deliberately. The binder sizes atlas
  // slots and must see the card's REAL size; the quad pass draws and must see
  // the lifted one. Feeding the lifted geometry to the binder re-slots the
  // card on every frame of the ease — see quad-facts.ts.
  const facts = createWorldQuadFacts(world);
  const displayFacts =
    opts.lift === undefined ? facts : createWorldQuadFacts(world, { lift: opts.lift });

  const domSources = createDomSourceBinder(device, registry, (entity) => facts(entity), {
    ...(opts.atlas ?? {}),
    // Paint events are a compositor dirty source (§4). Without this wake the
    // slot goes dirty and nothing ever composites it.
    onDirt: () => held.compositor?.mark("dom"),
  });

  const background = (): QuadTexture | undefined => {
    const texture = opts.groundTexture?.();
    if (texture === undefined) return undefined;
    return {
      texture,
      rect: { x: 0, y: 0, width: texture.width, height: texture.height },
      textureWidth: texture.width,
      textureHeight: texture.height,
      // Ground's target is created by three like an island's, so it carries
      // the same actual-format sRGB question and the same premultiplied answer.
      srgb: texture.format.endsWith("-srgb"),
      premultiplied: true,
    };
  };

  const compositor = createCompositorReflector({
    world,
    registry,
    quadPass: createWidgetQuadPass({
      device,
      // The target's ACTUAL format when there is one; the preferred canvas
      // format otherwise. Never assumed — it guards the sRGB re-encode.
      format: opts.target?.format ?? navigator.gpu.getPreferredCanvasFormat(),
      registry,
      facts: displayFacts,
      background,
      // ONE dispatch, by kind. dom sources go through the atlas (a slot, a
      // copy, per-slot dirt); gl sources are already pixels in a texture three
      // owns, so they need none of that; video imports its latest frame.
      resolve: (entity, source) => {
        const s = source as CompositorSource;
        if (s.kind === "gl") return resolveGlSource(s);
        if (s.kind === "video") return resolveVideoSource(s, opts.video ?? {});
        return domSources.resolve(entity, s);
      },
      ...(opts.order !== undefined ? { order: opts.order } : {}),
    }),
    device,
    // Slot copies are issued here — before the pass, after the dirt check.
    //
    // STAYING AWAKE IS PART OF THE BUDGET. `maxCopiesPerComposite` is what
    // makes a bulk arrival stagger instead of stalling for 111 ms, but a
    // budget without this is worse than no budget: the leftover copies would
    // sit owed until something unrelated woke the compositor, and a board that
    // went quiet mid-boot would stay half-drawn. Re-marking on `pending()`
    // closes exactly that hole.
    //
    // ERRATA 2026-08-31: this note used to end "and it cannot spin, because a
    // frame that owes nothing marks nothing". True of copies and false as
    // stated — a paint event on a PAUSED card parked a mark no clock could
    // ever make due, `pending()` counted it, and this line re-dirtied the
    // compositor on every rAF frame for as long as the card animated out of
    // sight. The claim holds again only because parked dirt now sits OUTSIDE
    // `pending()`: the invariant is "everything pending has a due date", and
    // it is enforced in the binder, not here.
    prepare: (frame) => {
      // A LIFT IS DIRT WITH NO ECS STAMP BEHIND IT. `Grab` is written once at
      // pickup and the 180 ms of ease that follows changes no cell at all, so
      // nothing in the world would ever wake the compositor for it. Advancing
      // the driver here and re-marking on "still animating" is what makes the
      // ease move: without the advance the retarget/query logic never runs and
      // the seam is inert, and without the re-mark it renders one frame and
      // freezes at its first eased value.
      if (opts.lift?.advance() === true) held.compositor?.mark("promotion");
      domSources.sync(frame);
      if (domSources.pending() > 0) held.compositor?.mark("dom");
    },
    ...(opts.target !== undefined ? { target: opts.target } : {}),
  });
  held.compositor = compositor;

  return { compositor, domSources };
}
