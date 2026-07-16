/**
 * @ice/ground — the P0 ground stratum as ONE WebGPU canvas (design-004 §1
 * as-built amendment, 2026-07-16). three's WebGPURenderer + TSL, WebGL2
 * fallback automatic. Off the react chain: react receives the layer as an
 * OPAQUE factory (`<InfiniteCanvas ground={ground(...)}>`); imperative apps
 * register `layer.reflector` themselves. Passes: dot grid, wires, selection
 * rings, snap guides — future ground shaders/effects join the same registry.
 */
import type { GridConfig, SelectionChromeConfig, SnapGuidesConfig, WirePreviewBuffer, WiresConfig, World } from "@ice/core";
import { createLayer, type GroundLayerHost, type GroundReflector } from "./layer";
import type { GroundPass } from "./pass";
import { createGridPass } from "./passes/grid";
import { createGuidesPass } from "./passes/guides";
import { createSelectionPass } from "./passes/selection";
import { createWiresPass } from "./passes/wires";
import { createGroundRenderer, type GroundRendererLike } from "./renderer";

export type { GroundFrame, GroundPass } from "./pass";
export type { GroundReflector } from "./layer";
export type { GroundRendererLike } from "./renderer";
export { SoupBuilder, parseCssColor, type Rgba, type TriSoup } from "./passes/soup-collect";
export { collectGuides } from "./passes/guides-collect";
export { collectWires } from "./passes/wires-collect";
export { collectSelection, type RingSoup } from "./passes/selection-collect";
// Config vocabulary re-exported for app ergonomics (canonical home: @ice/core).
export {
  DEFAULT_GRID_CONFIG,
  DEFAULT_SELECTION_CHROME_CONFIG,
  DEFAULT_SNAP_GUIDES_CONFIG,
  DEFAULT_WIRES_CONFIG,
  type GridConfig,
  type SelectionChromeConfig,
  type SnapGuidesConfig,
  type WiresConfig,
} from "@ice/core";

export interface GroundContext {
  readonly host: GroundLayerHost;
  readonly world: World;
  /** Connect-drag preview reader (graph boards); omit on boards without wires. */
  readonly readWirePreview?: () => WirePreviewBuffer;
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
  /** Per-widget SDF selection rings; `false` disables the pass. */
  readonly selection?: Partial<SelectionChromeConfig> | false;
  /** Extra app passes, rendered after the built-ins (renderOrder ≥ 3 is yours). */
  readonly passes?: readonly GroundPass[];
  /** Force the WebGL2 backend (debug / e2e A-B runs). */
  readonly forceWebGL?: boolean;
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
    const renderer = opts.rendererOverride ?? createGroundRenderer(doc, { forceWebGL: opts.forceWebGL === true });
    const grid = createGridPass(opts.grid ?? {});
    const wires = createWiresPass(opts.wires ?? {}, ctx.readWirePreview);
    const guides = createGuidesPass(opts.guides ?? {});
    const passes: GroundPass[] = [grid, wires, guides, ...(opts.passes ?? [])];
    if (opts.selection !== false) passes.push(createSelectionPass(opts.selection ?? {}));
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
