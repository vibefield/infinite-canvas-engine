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
  GpuAllocationLedger,
  GridConfig,
  SnapGuidesConfig,
  WirePreviewBuffer,
  WiresConfig,
  World,
  PresentationTransitionCoordinator,
} from "@ice/core";
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
    });
    const poles = opts.poles === undefined ? [] : Array.isArray(opts.poles) ? opts.poles : [opts.poles];
    const grid = createGridPass(opts.grid ?? {}, { poles, ...(ctx.readSpatial !== undefined ? { readSpatial: ctx.readSpatial } : {}) });
    const wires = createWiresPass(opts.wires ?? {}, ctx.readWirePreview);
    const guides = createGuidesPass(opts.guides ?? {});
    const passes: GroundPass[] = [grid, wires, guides, ...(opts.passes ?? [])];
    const layer = createLayer(ctx.host, ctx.world, renderer, passes);
    return {
      reflector: layer.reflector,
      configureGrid(cfg) {
        grid.configure(cfg);
        layer.invalidateAll();
      },
      dispose: layer.dispose,
    };
  };
}
