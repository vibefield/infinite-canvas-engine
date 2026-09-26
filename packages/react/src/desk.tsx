/**
 * `<Desk>` — the one-line desk mount (design-015 §3, D5b): `@ice/dom`'s `createDeskHost` under
 * React. This component owns the container element and the keymap; the host owns the layer, the
 * adapters, the reflectors, the loop and the viewport sync. `<InfiniteCanvas>` became this BY
 * DELETION (plan D-D0.6): no planes, no profile gate, no DOM widget portals, no chrome plane (the
 * desk draws its own marks, design-015 §7), no measurement, no GL route, no `grid` prop (the
 * desk's handle has `configureFadeIn`/`configureMat`).
 *
 * The desk arrives as an OPAQUE layer factory — `layer={deskLayer({ … })}` from `@ice/desk/host`
 * — typed structurally by `@ice/dom`; this package imports neither `@ice/desk` nor its handle.
 * Memoize the factory in the caller: a new identity re-boots the mount.
 *
 * Lifecycle: the engine is NOT owned here (the app disposes it). Unmount disposes the host.
 * Children render inside the container, above the canvas: the screen-space chrome (the selection
 * menu, a dev panel) and nothing that moves with the camera (design-015 §2 law 2).
 */
import type { CanvasEngine } from "@ice/core";
import {
  createDeskHost,
  type CanvasHost,
  type LayerFactory,
  type LayerHandle,
  type WidgetFocusHandle,
} from "@ice/dom";
import { useEffect, useRef, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { EngineProvider } from "./engine-context";
import { attachKeymap, type KeymapEntry } from "./keymap";

/** Handed to {@link DeskProps.onReady} once the host is live (app-side devtools, the desk's handle). */
export interface DeskHandle {
  readonly engine: CanvasEngine;
  readonly host: CanvasHost;
  /** The mounted layer's handle, as the factory returned it (the desk's `DeskLayerHandle` under `deskLayer`). */
  readonly layer: LayerHandle;
  /**
   * Programmatic focus release (design-007 §2.3): `blurFocus()`. Focus is VIEW state
   * (design-007 §2.6) — it rides this handle, not `engine.ops` (a headless engine has none).
   */
  readonly focus: WidgetFocusHandle;
}

export interface DeskProps {
  /** A constructed engine (`createCanvasEngine(...)`); NOT disposed on unmount. */
  readonly engine: CanvasEngine;
  /** The desk's layer factory (`deskLayer({ … })`), received opaquely. Memoize in the caller. */
  readonly layer: LayerFactory;
  /** Called once after the host, the reflectors and the loop are live. */
  readonly onReady?: (handle: DeskHandle) => void;
  /**
   * Keymap overrides plumbed to {@link attachKeymap} (design-007 §5 M-d). An entry replaces a
   * default by its `key|mod|shift` signature; conditional behaviour belongs INSIDE `run`. BOUND
   * ONCE at mount, like the adapters: entries read live engine state at run time, never
   * render-time values.
   */
  readonly keymapOverrides?: readonly KeymapEntry[];
  readonly className?: string;
  readonly style?: CSSProperties;
  /** Screen-space chrome inside the viewport (the selection menu, a HUD) — rendered under the EngineProvider. */
  readonly children?: ReactNode;
}

export function Desk({ engine, layer, onReady, keymapOverrides, className, style, children }: DeskProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  // Identity churn on these must not re-boot the mount: they ride refs.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const keymapOverridesRef = useRef(keymapOverrides);
  keymapOverridesRef.current = keymapOverrides;

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const mount = createDeskHost({ container, engine, layer });
    const detachKeymap = attachKeymap(engine, undefined, keymapOverridesRef.current ?? []);
    onReadyRef.current?.({ engine, host: mount.host, layer: mount.layer, focus: mount.focus });
    return () => {
      detachKeymap();
      mount.dispose();
    };
  }, [engine, layer]);

  return (
    <EngineProvider engine={engine}>
      <div ref={containerRef} className={className} style={{ width: "100%", height: "100%", ...style }} data-ice-canvas="">
        {children}
      </div>
    </EngineProvider>
  );
}
