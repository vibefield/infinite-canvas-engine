/**
 * @ice/ground — the P0 ground stratum as ONE WebGPU canvas (design-004 §1
 * as-built amendment, 2026-07-16). three's WebGPURenderer + TSL, WebGL2
 * fallback automatic. Off the react chain: react receives the layer as an
 * OPAQUE factory (`<InfiniteCanvas ground={ground(...)}>`); imperative apps
 * register `layer.reflector` themselves. Passes: dot grid, wires, snap
 * guides — future ground shaders/effects join the same pass registry.
 * (Selection chrome moved OFF the ground 2026-07-17: rings live with the
 * cards, the multi-select union box is P4 dom chrome — always on top.)
 */
import type {
  CanvasSessionValue,
  CanvasType,
  CompositorSource,
  CompositorSourceRegistry,
  Entity,
  GpuAllocationLedger,
  GridConfig,
  SnapGuidesConfig,
  WirePreviewBuffer,
  WiresConfig,
  World,
  PresentationTransitionCoordinator,
} from "@ice/core";
import { createCompositorSourceRegistry } from "@ice/core";
import {
  createCompositorReflector,
  type CompositeTarget,
  type CompositorReflector,
} from "./compositor/compositor-reflector";
import { createWidgetQuadPass } from "./compositor/widget-quad-pass";
import {
  createDomSourceBinder,
  type DomSourceBinder,
  type DomSourceBinderOptions,
} from "./compositor/dom-source-binder";
import { createWorldQuadFacts } from "./compositor/quad-facts";
import { createLayer, type GroundLayerHost, type GroundReflector } from "./layer";
import type { GroundPass } from "./pass";
import { createGridPass } from "./passes/grid";
import { createGuidesPass } from "./passes/guides";
import type { ReadSpatial } from "./passes/magnet-collect";
import { createWiresPass } from "./passes/wires";
import type { PoleSource } from "./poles";
import { createGroundRenderer, type GroundRendererLike } from "./renderer";

export type { GroundFrame, GroundPass } from "./pass";
export type { GroundReflector } from "./layer";
export {
  readGroundRendererStatus,
  type GroundRendererBackend,
  type GroundRendererFailure,
  type GroundRendererFailureKind,
  type GroundRendererFrameProfile,
  type GroundRendererLike,
  type GroundRendererProfile,
  type GroundRendererStatus,
} from "./renderer";
export {
  groundHost,
  type GroundHostLayer,
  type GroundHostOptions,
  type GroundProgramControl,
} from "./program-host";
export type {
  FrozenGroundPresentation,
  GroundActivationContext,
  GroundFrameChildRow,
  GroundFrameChildrenSnapshot,
  GroundFrameChildrenSource,
  GroundHostStats,
  GroundPrepareContext,
  GroundPresentation,
  GroundProgramCacheOptions,
  GroundProgramDefinition,
  GroundProgramInput,
  GroundProgramInstance,
  GroundProgramStatus,
  GroundProgramStatusState,
  GroundProgramTransition,
  GroundSourceDeclaration,
} from "./program";
export {
  frameChildrenSource,
  GROUND_FRAME_CHILDREN_DEFAULT_LIMIT,
  GROUND_FRAME_CHILDREN_MAX_LIMIT,
} from "./program";
// The unified compositor (design-012 §4). `createWidgetQuadPass` and
// `createCompositorReflector` are exported for tests and for imperative apps
// that assemble their own roster; `ground({ device })` wires them for everyone
// else. `instrumentSubmits` is the idle-zero instrument — install it right
// after acquiring the device, before any consumer.
export {
  createCompositorReflector,
  type CompositeTarget,
  type CompositorDirtSource,
  type CompositorReflector,
  type CompositorReflectorOpts,
} from "./compositor/compositor-reflector";
export {
  createWidgetQuadPass,
  type CompositeFrame,
  type QuadFacts,
  type QuadTexture,
  type WidgetQuadPass,
  type WidgetQuadPassDeps,
} from "./compositor/widget-quad-pass";
export { instrumentSubmits, type SubmitInstrument } from "./compositor/submit-instrument";
// The dom source atlas (design-012 §11 Q3): the pure allocator bound to a real
// device and to HiC's direct element copy.
export {
  createDomAtlas,
  type AtlasPlacement,
  type DomAtlas,
  type DomAtlasOptions,
} from "./compositor/dom-atlas";
export {
  createDomSourceBinder,
  type DomSourceBinder,
  type DomSourceBinderOptions,
  type DomSourceGeometry,
} from "./compositor/dom-source-binder";
export { createWorldQuadFacts, type WorldQuadFactsOptions } from "./compositor/quad-facts";
// The HiC seam (design-012 §8 gate 1): the adapter module is the ONLY place a
// HiC symbol is named, and its probe is what a composited build refuses on.
// (`GroundRendererLike` rides main's renderer export block above — re-exporting
// it here too would be a duplicate.)
export {
  changedElements,
  copyElementToTexture,
  describeHicProbe,
  drawElementImage,
  getElementTransform,
  markAsSourceCanvas,
  onPaint,
  probeHic,
  requestPaint,
  type HicCapabilities,
  type HicProbeResult,
} from "./hic-adapter";
export { SoupBuilder, parseCssColor, type Rgba, type TriSoup } from "./passes/soup-collect";
export { collectGuides } from "./passes/guides-collect";
export { collectWires } from "./passes/wires-collect";
// The magnet pole seam (design-010 §3.3) + canned wirings (D5: the grid
// implementation imports neither helper — cursor vocabulary lives in the
// helper the app chose).
export { cursorVisualPoles, localPointerPoles, type Pole, type PoleSource } from "./poles";
export {
  collectMagnetLevels,
  collectMagnetSources,
  magnetFieldScale,
  resolveMagnet,
  MAX_MAGNET_SOURCES,
  type MagnetLevel,
  type ReadSpatial,
} from "./passes/magnet-collect";
// Config vocabulary re-exported for app ergonomics (canonical home: @ice/core).
export {
  DEFAULT_GRID_CONFIG,
  DEFAULT_GRID_MAGNET_CONFIG,
  DEFAULT_SNAP_GUIDES_CONFIG,
  DEFAULT_WIRES_CONFIG,
  type GridConfig,
  type GridMagnetConfig,
  type SnapGuidesConfig,
  type WiresConfig,
} from "@ice/core";
// The atlas-slot allocator for dom sources (design-012 §11 Q3). Pure logic
// over kernel shelf math with every effect injected — wave-2 binds it to the
// device; it names no GPU, HiC or DOM symbol.
export {
  createAtlasAllocator,
  type AtlasAllocator,
  type AtlasAllocatorOptions,
  type AtlasEffects,
  type AtlasMove,
  type AtlasPageView,
  type AtlasRepackPlan,
  type AtlasSlot,
  type AtlasWasteReport,
  type SlotResidency,
} from "./atlas-allocator";

export interface GroundContext {
  readonly host: GroundLayerHost;
  readonly world: World;
  /** Connect-drag preview reader (graph boards); omit on boards without wires. */
  readonly readWirePreview?: () => WirePreviewBuffer;
  /**
   * Broad-phase reader over the ONE spatial index (design-010 §3.2, the
   * readWirePreview precedent) — the magnet grid's widget sources. Facades
   * wire `stack.index.search`; omit ⇒ magnet renders a pole-only field.
   */
  readonly readSpatial?: ReadSpatial;
  /** Headless current-CanvasType seam; GroundHost subscribes once to it. */
  readonly canvas?: {
    type(): CanvasType;
    current?(): CanvasSessionValue;
    subscribe(onChange: () => void): () => void;
  };
  /** Trusted T2 registration; absent in legacy/headless ground mounts. */
  readonly transitions?: PresentationTransitionCoordinator;
  /** Shared GPU accounting with R3F transition/island allocations. */
  readonly gpu?: GpuAllocationLedger;
}

export interface GroundLayer {
  readonly reflector: GroundReflector;
  /**
   * The unified compositor's reflector — present ONLY when a `device` was
   * injected (the composited profile). It registers immediately after
   * `reflector` in the roster (plan §4.3), and its absence is exactly how the
   * stratified profile stays byte-for-byte the code it always was.
   */
  readonly compositorReflector?: CompositorReflector;
  /** The source registry the compositor consumes; producers register into it. */
  readonly sources?: CompositorSourceRegistry;
  /**
   * The dom source binder — the atlas behind the `dom` kind. Present with the
   * compositor. The L1 layer routes paint events into `markDirtyHosts`, and
   * the waste instrument reads from its atlas.
   */
  readonly domSources?: DomSourceBinder;
  /**
   * The device three actually settled on, once init resolves — undefined
   * before ready and on the WebGL2 fallback. A DIAGNOSTIC seam: it is the
   * difference between "the `device` option was accepted" and "three adopted
   * this exact device", and the composited profile's whole premise is the
   * latter. Rigs assert `layer.device() === engine.compositorDevice.device`.
   */
  device(): GPUDevice | undefined;
  /** Live grid re-tune (the react `grid` prop forwards here). */
  configureGrid(cfg: Partial<GridConfig>): void;
  dispose(): void;
}

export interface GroundOptions {
  readonly grid?: Partial<GridConfig>;
  readonly wires?: Partial<WiresConfig>;
  readonly guides?: Partial<SnapGuidesConfig>;
  /**
   * Magnet pole sources (design-010 §3.3) — live app-authored objects, so they
   * live HERE, not in the plain-data GridConfig. Nothing wired ⇒ the magnet
   * field is widget-only. The classic implementation accepts this same
   * GroundOptions contract and ignores the sources.
   */
  readonly poles?: PoleSource | readonly PoleSource[];
  /** Extra app passes, rendered after the built-ins (renderOrder ≥ 3 is yours). */
  readonly passes?: readonly GroundPass[];
  /** Force the WebGL2 backend (debug / e2e A-B runs). */
  readonly forceWebGL?: boolean;
  /** Query-gated timestamp/CPU evidence; off by default (zero timer/query cost). */
  readonly profile?: boolean;
  /** TEST seam: inject a fake renderer (headless orchestration tests). */
  readonly rendererOverride?: GroundRendererLike;
  /**
   * THE COMPOSITED PROFILE SWITCH (design-012 §4). The app-owned GPUDevice
   * (`engine.compositorDevice.device`): three adopts it rather than making its own, and
   * the layer additionally builds the compositor — `compositorReflector` and
   * `sources` appear on the returned layer.
   *
   * Absent ⇒ the stratified profile, unchanged: three makes its own device and
   * no compositor exists. There is no runtime toggle between the two — which
   * factory an app wires is a build-time fact (the design-010 idiom).
   */
  readonly device?: GPUDevice;
  /**
   * The compositor's source registry. Pass the SAME registry the producers
   * (the L1 dom layer, r3f islands, the app's video sources) register into;
   * omitted ⇒ the layer makes a private one and reaches it through
   * `layer.sources`. Ignored without `device`.
   */
  readonly sources?: CompositorSourceRegistry;
  /**
   * The compositor's swap-chain target. Absent at S1 by design: ground still
   * presents itself onto its own canvas, so the compositor tracks dirt and
   * draws nothing (see compositor-reflector's header).
   */
  readonly target?: CompositeTarget;
  /**
   * Paint order for the widget quads: the entities to composite, back to
   * front, in frame-parent sibling sequence (petition 8). The composited
   * profile wires the L1 layer's `compositedEntities()`, which reads the
   * canvas's own child sequence and is therefore sibling order by
   * construction. Omitted ⇒ registry order, correct only while empty.
   */
  readonly order?: () => readonly Entity[];
  /** Tuning for the dom source atlas (page sizes, gutter, copy budget). */
  readonly atlas?: DomSourceBinderOptions;
}

export type GroundFactory = (ctx: GroundContext) => GroundLayer;

/**
 * Build the ground layer factory. Usage:
 *   react apps:      <InfiniteCanvas ground={ground({ grid: {...} })} …>
 *   imperative apps: const layer = ground()( { host, world, readWirePreview } );
 *                    engine.registerReflector(layer.reflector);
 */
export function ground(opts: GroundOptions = {}): GroundFactory {
  return (ctx) => {
    const doc = ctx.host.container.ownerDocument;
    const renderer = opts.rendererOverride ?? createGroundRenderer(doc, {
      forceWebGL: opts.forceWebGL === true,
      profile: opts.profile === true,
      ...(opts.device !== undefined ? { device: opts.device } : {}),
    });
    const poles = opts.poles === undefined ? [] : Array.isArray(opts.poles) ? opts.poles : [opts.poles];
    const grid = createGridPass(opts.grid ?? {}, { poles, ...(ctx.readSpatial !== undefined ? { readSpatial: ctx.readSpatial } : {}) });
    const wires = createWiresPass(opts.wires ?? {}, ctx.readWirePreview);
    const guides = createGuidesPass(opts.guides ?? {});
    const passes: GroundPass[] = [grid, wires, guides, ...(opts.passes ?? [])];
    const layer = createLayer(ctx.host, ctx.world, renderer, passes);

    // The compositor exists only on the composited profile — no device, no
    // compositor, and the stratified path below is the code it always was.
    let compositor: CompositorReflector | undefined;
    let sources: CompositorSourceRegistry | undefined;
    let domSources: DomSourceBinder | undefined;
    if (opts.device !== undefined) {
      const device = opts.device;
      sources = opts.sources ?? createCompositorSourceRegistry();
      // Facts and slot sizes come from the SAME read of the world, so a quad
      // and its atlas slot can never disagree about how big a card is.
      const facts = createWorldQuadFacts(ctx.world);
      // The binder wakes the reflector and the reflector's `prepare` drives
      // the binder, so both closures read the enclosing `compositor` binding
      // rather than a value captured before it exists.
      domSources = createDomSourceBinder(
        device,
        sources,
        (entity) => facts(entity),
        {
          ...(opts.atlas ?? {}),
          // Paint events are a compositor dirty source (§4). Without this wake
          // the slot goes dirty and nothing ever composites it.
          onDirt: () => compositor?.mark("dom"),
        },
      );
      const binder = domSources;
      compositor = createCompositorReflector({
        world: ctx.world,
        registry: sources,
        quadPass: createWidgetQuadPass({
          device,
          // The target's ACTUAL format when there is one; the preferred canvas
          // format otherwise. Never assumed — it guards the sRGB re-encode.
          format: opts.target?.format ?? navigator.gpu.getPreferredCanvasFormat(),
          registry: sources,
          facts,
          // dom sources resolve through the atlas; gl/video resolve to
          // `undefined` here and join at S5/S7 with their own kinds.
          resolve: (entity, source) => binder.resolve(entity, source as CompositorSource),
          ...(opts.order !== undefined ? { order: opts.order } : {}),
        }),
        device,
        // Slot copies are issued here — before the pass, after the dirt check.
        //
        // STAYING AWAKE IS PART OF THE BUDGET. `maxCopiesPerComposite` is what
        // makes a bulk arrival stagger instead of stalling for 111 ms, but a
        // budget without this is worse than no budget: the leftover copies
        // would sit owed until something unrelated woke the compositor, and a
        // board that went quiet mid-boot would stay half-drawn. Re-marking on
        // `pending()` closes exactly that hole — and it cannot spin, because a
        // frame that owes nothing marks nothing.
        prepare: (frame) => {
          binder.sync(frame);
          if (binder.pending() > 0) compositor?.mark("dom");
        },
        ...(opts.target !== undefined ? { target: opts.target } : {}),
      });
    }

    return {
      reflector: layer.reflector,
      ...(compositor !== undefined ? { compositorReflector: compositor } : {}),
      ...(sources !== undefined ? { sources } : {}),
      ...(domSources !== undefined ? { domSources } : {}),
      device: () => renderer.device?.(),
      configureGrid(cfg) {
        grid.configure(cfg);
        layer.invalidateAll();
      },
      dispose() {
        compositor?.dispose();
        domSources?.dispose();
        layer.dispose();
      },
    };
  };
}
