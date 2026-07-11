/**
 * `useTool` + `useToolState` — the active-tool subscription (design-005 §5).
 *
 * The active tool is the `ActiveTool` runtime resource (design-005 §4). Reads go
 * through strata's Tier-3 `observeResource` (fires only when the id actually
 * changes, at notify()); the setter is `ops.setTool`, which cancels active
 * gestures before the switch (the strata-example lesson, design-003 §8) — never
 * a raw resource write. The snapshot is a primitive string, so identity is
 * inherently stable.
 */
import { ActiveTool } from "@ice/core";
import { useCallback, useSyncExternalStore } from "react";
import { useCanvasEngine } from "./engine-context";

/** `[activeToolId, setTool]`. `setTool` routes through `ops.setTool`. */
export function useTool(): [string, (id: string) => void] {
  const engine = useCanvasEngine();
  const subscribe = useCallback(
    (onChange: () => void) => engine.world.reactive.observeResource(ActiveTool, onChange),
    [engine],
  );
  const getSnapshot = useCallback(() => engine.world.getResource(ActiveTool)?.id ?? "select", [engine]);
  const active = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const setTool = useCallback((id: string) => engine.ops.setTool(id), [engine]);
  return [active, setTool];
}

/** Sugar: is tool `id` the active one? (toolbar button pressed-state). */
export function useToolState(id: string): boolean {
  const [active] = useTool();
  return active === id;
}
