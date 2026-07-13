/**
 * The app shell: one `<InfiniteCanvas>` (which owns the host, planes, adapters,
 * reflectors, rAF loop, keymap, AND provides the EngineProvider to its children)
 * with the `<Toolbar>` overlaid as a child. Devtools are wired app-side in
 * `onReady` against the core engine handle (`@ice/react` cannot import
 * `@ice/devtools`, so a consumer attaches it here) — exactly as InfiniteCanvas's
 * own docs prescribe.
 */
import type { CanvasEngine } from "@ice/core";
import { InfiniteCanvas, type InfiniteCanvasHandle } from "@ice/react";
import { attachDevtools, type DevtoolsHandle } from "@ice/devtools";
import { useCallback, useEffect, useRef, type CSSProperties, type ReactElement } from "react";
import { Toolbar } from "./toolbar";

const CANVAS_STYLE: CSSProperties = { position: "absolute", inset: 0 };

export function App({ engine }: { engine: CanvasEngine }): ReactElement {
  // Keep the devtools handle so a StrictMode remount (onReady fires again from
  // InfiniteCanvas's mount effect) detaches the prior panel + its 500 ms
  // interval before attaching a new one, instead of stacking them.
  const devtoolsRef = useRef<DevtoolsHandle | null>(null);
  const onReady = useCallback(({ engine: handle }: InfiniteCanvasHandle) => {
    devtoolsRef.current?.detach();
    // handle is the CanvasEngine facade; devtools reads the core Engine.
    devtoolsRef.current = attachDevtools(handle.engine, { intervalMs: 500 });
  }, []);
  useEffect(
    () => () => {
      devtoolsRef.current?.detach();
      devtoolsRef.current = null;
    },
    [],
  );
  return (
    <InfiniteCanvas engine={engine} style={CANVAS_STYLE} onReady={onReady}>
      <Toolbar />
    </InfiniteCanvas>
  );
}
