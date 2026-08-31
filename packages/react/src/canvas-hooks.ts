/** Stable React projections over the headless Canvas SDK facade. */
import type {
  CanvasCatalogSection,
  CanvasDiagnostic,
  CanvasSessionValue,
  Entity,
  FramePreviewSnapshot,
  Tool,
} from "@ice/core";
import { useCallback, useSyncExternalStore } from "react";
import { useCanvasEngine } from "./engine-context";

export function useCurrentCanvas(): CanvasSessionValue {
  const engine = useCanvasEngine();
  const subscribe = useCallback(
    (onChange: () => void) => engine.canvas.subscribe(onChange),
    [engine],
  );
  return useSyncExternalStore(subscribe, engine.canvas.current, engine.canvas.current);
}

export function useCanvasCatalog(): readonly CanvasCatalogSection[] {
  const engine = useCanvasEngine();
  const subscribe = useCallback(
    (onChange: () => void) => engine.canvas.subscribe(onChange),
    [engine],
  );
  return useSyncExternalStore(subscribe, engine.canvas.catalog, engine.canvas.catalog);
}

export function useCanvasTools(): readonly Tool[] {
  const engine = useCanvasEngine();
  const subscribe = useCallback(
    (onChange: () => void) => engine.canvas.subscribe(onChange),
    [engine],
  );
  return useSyncExternalStore(subscribe, engine.canvas.tools, engine.canvas.tools);
}

export function useCanvasDiagnostics(): readonly CanvasDiagnostic[] {
  const engine = useCanvasEngine();
  const subscribe = useCallback(
    (onChange: () => void) => engine.canvas.subscribe(onChange),
    [engine],
  );
  return useSyncExternalStore(
    subscribe,
    engine.canvas.diagnostics,
    engine.canvas.diagnostics,
  );
}

/**
 * Demand-driven semantic frame preview. Merely reading the hook does not scan
 * the frame: useSyncExternalStore activates the core projection on subscribe
 * and removes every observer on unmount.
 */
export function useFramePreview(frame: Entity): FramePreviewSnapshot {
  const engine = useCanvasEngine();
  const subscribe = useCallback(
    (onChange: () => void) => engine.previews.subscribe(frame, onChange),
    [engine, frame],
  );
  const getSnapshot = useCallback(() => engine.previews.snapshot(frame), [engine, frame]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
