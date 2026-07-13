/**
 * The app shell: one `<InfiniteCanvas>` (which owns the host, planes, adapters,
 * reflectors, rAF loop, keymap, AND provides the EngineProvider to its children)
 * with the `<Toolbar>` overlaid as a child. Devtools are wired app-side in
 * `onReady` against the engine FACADE (`@ice/react` cannot import
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
  // InfiniteCanvas's mount effect) detaches the prior panels before attaching
  // new ones, instead of stacking them.
  const devtoolsRef = useRef<DevtoolsHandle | null>(null);
  const onReady = useCallback(({ engine: handle }: InfiniteCanvasHandle) => {
    devtoolsRef.current?.detach();
    // The FACADE goes in: the strata observer's durable tab tracks
    // docs.current() live only through it.
    devtoolsRef.current = attachDevtools(handle);
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
