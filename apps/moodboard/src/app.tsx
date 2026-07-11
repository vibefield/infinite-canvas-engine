/**
 * The app shell: one `<InfiniteCanvas>` (which owns the host, planes, adapters,
 * reflectors, rAF loop, keymap, AND provides the EngineProvider to its children)
 * with the `<Toolbar>` overlaid as a child. Devtools are wired app-side in
 * `onReady` against the core engine handle (`@ice/react` cannot import
 * `@ice/devtools`, so a consumer attaches it here) — exactly as InfiniteCanvas's
 * own docs prescribe.
 */
import type { CanvasEngine } from "@ice/core";
import { InfiniteCanvas } from "@ice/react";
import { attachDevtools } from "@ice/devtools";
import type { CSSProperties, ReactElement } from "react";
import { Toolbar } from "./toolbar";

const CANVAS_STYLE: CSSProperties = { position: "absolute", inset: 0 };

export function App({ engine }: { engine: CanvasEngine }): ReactElement {
  return (
    <InfiniteCanvas
      engine={engine}
      style={CANVAS_STYLE}
      onReady={({ engine: handle }) => {
        // handle is the CanvasEngine facade; devtools reads the core Engine.
        attachDevtools(handle.engine, { intervalMs: 500 });
      }}
    >
      <Toolbar />
    </InfiniteCanvas>
  );
}
