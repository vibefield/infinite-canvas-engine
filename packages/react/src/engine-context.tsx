/**
 * `<EngineProvider>` + engine access hooks (design-005 §5; the M6 field
 * amendment 2026-07-10 gap — grep "useCommit" in design-005).
 *
 * The whole React surface reaches the running canvas through ONE context
 * carrying the {@link CanvasEngine} facade (world + engine + stack + runtime +
 * ops + docs). Widgets never hand-roll store plumbing again: {@link useOps}
 * gives the engine-owned write paths, {@link useCommit} (its own module) the
 * sanctioned durable commit seam, and {@link useWorld} the read/observe escape
 * hatch. `<InfiniteCanvas>` provides this automatically; apps that mount
 * WidgetRoot themselves wrap it in `<EngineProvider>`.
 */
import { devGuardsEnabled, type CanvasEngine, type CanvasOps, type World } from "@ice/core";
import { createContext, useContext, useEffect, type ReactElement, type ReactNode } from "react";

const EngineContext = createContext<CanvasEngine | null>(null);

export interface EngineProviderProps {
  readonly engine: CanvasEngine;
  readonly children?: ReactNode;
}

/** Publish the canvas engine to the React subtree (WidgetRoot + userland hooks). */
export function EngineProvider({ engine, children }: EngineProviderProps): ReactElement {
  return <EngineContext.Provider value={engine}>{children}</EngineContext.Provider>;
}

/** The canvas engine for this subtree; throws with guidance outside a provider. */
export function useCanvasEngine(): CanvasEngine {
  const engine = useContext(EngineContext);
  if (engine === null) {
    throw new Error(
      "ice: useCanvasEngine — no <EngineProvider>. Render widgets inside <InfiniteCanvas> (which provides it) or wrap your tree in <EngineProvider engine={...}>.",
    );
  }
  return engine;
}

/** The engine-owned write paths (design-005 §4): setTool, deleteSelection, etc. */
export function useOps(): CanvasOps {
  return useCanvasEngine().ops;
}

/**
 * Take a stage background hold while `active` (ce.stage, 2026-07-19): the
 * overlay-lifecycle sugar — the disposer releases on deactivate AND unmount,
 * so a crashed/unmounted overlay can never wedge the canvas backgrounded.
 * `engine` is an explicit param (not context): overlays typically render as
 * SIBLINGS of <InfiniteCanvas>, outside the provider.
 */
export function useStageHold(engine: CanvasEngine, active: boolean, name: string): void {
  useEffect(() => {
    if (!active) return undefined;
    return engine.stage.background(name);
  }, [engine, active, name]);
}

let warnedUseWorld = false;

/**
 * Escape hatch — the raw {@link World} for READS and Tier-3 OBSERVATION only.
 * Mutation goes through {@link useOps}/{@link useCommit} (a gesture-claimed,
 * one-tx-per-gesture durable write; direct world writes bypass sovereignty and
 * the guards). DEV-warns once on first use.
 */
export function useWorld(): World {
  const engine = useCanvasEngine();
  if (devGuardsEnabled() && !warnedUseWorld) {
    warnedUseWorld = true;
    console.warn(
      "ice: useWorld() is a READ/OBSERVE escape hatch — never write to the world directly. Use useOps()/useCommit() for mutation (design-005 §5).",
    );
  }
  return engine.world;
}
