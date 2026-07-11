/**
 * `<InfiniteCanvas>` — the one-line canvas mount (design-005 §5): planes +
 * adapters + reflectors + portal root, wired in node-board's PROVEN boot order
 * (apps/nodeboard/src/app.tsx). The app supplies a constructed {@link
 * CanvasEngine} (via `createCanvasEngine`); this component owns only the DOM
 * host, the reflector registrations, the pointer/keymap adapters, the rAF loop,
 * and the viewport sync — everything that must live next to a real container.
 *
 * Boot order (registration order = reflector flush order, mirrored exactly):
 *   host → planes → reflectors[ planeTransform · grid(P0) · wires(P0) ·
 *   domWidgets(P1/P3) · chrome(P4) · cursor · remoteCursors(P5) ] →
 *   pointer adapter → measurement (optional) → keymap → rAF loop → viewport RO.
 *
 * The dom-widgets reflector is BOTH a reflector and the host lookup WidgetRoot
 * portals into; it is created before mount and stored in state so WidgetRoot
 * renders once the hosts exist.
 *
 * Lifecycle: this component does NOT own the engine — it never calls
 * `engine.dispose()` (the engine outlives the mount; the app owns it). Unmount
 * detaches every adapter, unregisters every reflector, stops the loop, and
 * disposes the host.
 *
 * Not handled here (by design):
 *  - GL / R3F: the `@ice/r3f` wall forbids `@ice/react` importing three, so a
 *    GL layer (GLViews) mounts APP-SIDE. Use {@link onReady} to receive the host
 *    + planes and mount it yourself (like apps/glboard).
 *  - Devtools: the import wall forbids `@ice/react` importing `@ice/devtools`.
 *    Wire the panel app-side against `engine.engine` (also via {@link onReady}).
 *  - Measurement: auto-sized widgets need a `MeasureQueue` passed to BOTH
 *    `createCanvasEngine({ measureQueue })` (ingest side) and this component's
 *    `measureQueue` prop (ResizeObserver side). Absent ⇒ measurement is skipped.
 */
import { Viewport, writeRuntimeResource, type CanvasEngine, type MeasureQueue } from "@ice/core";
import {
  attachPointerAdapter,
  createCanvasHost,
  createChromeReflector,
  createCursorReflector,
  createDomWidgetsReflector,
  createGridReflector,
  createPlaneTransformReflector,
  createPlanes,
  createRemoteCursorsReflector,
  createWiresReflector,
  startRafLoop,
  wireMeasurement,
  type CanvasHost,
  type DomWidgetsReflector,
  type Planes,
} from "@ice/dom";
import { useEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { EngineProvider } from "./engine-context";
import { attachKeymap } from "./keymap";
import { WidgetRoot } from "./widget-root";

/** Handed to {@link InfiniteCanvasProps.onReady} for app-side GL/devtools wiring. */
export interface InfiniteCanvasHandle {
  readonly engine: CanvasEngine;
  readonly host: CanvasHost;
  readonly planes: Planes;
}

export interface InfiniteCanvasProps {
  /** A constructed engine (`createCanvasEngine(...)`); NOT disposed on unmount. */
  readonly engine: CanvasEngine;
  /**
   * The ResizeObserver side of widget measurement. Pass the SAME queue given to
   * `createCanvasEngine({ measureQueue })`. Absent ⇒ measurement skipped.
   */
  readonly measureQueue?: MeasureQueue;
  /** Called once after the host/reflectors/loop are live (app-side GL/devtools). */
  readonly onReady?: (handle: InfiniteCanvasHandle) => void;
  readonly className?: string;
  readonly style?: CSSProperties;
  /** Overlays inside the viewport (toolbars, HUD) — rendered under the EngineProvider. */
  readonly children?: ReactNode;
}

export function InfiniteCanvas({
  engine,
  measureQueue,
  onReady,
  className,
  style,
  children,
}: InfiniteCanvasProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hosts, setHosts] = useState<DomWidgetsReflector | undefined>(undefined);
  // Keep onReady out of the effect deps (identity churn must not re-boot).
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const { world, engine: core, stack, runtime } = engine;

    const host = createCanvasHost(container);
    const planes = createPlanes(host);
    const planeArgs = { contentPlane: planes.content, liftedPlane: planes.lifted };
    const domWidgets = createDomWidgetsReflector(planeArgs, world, runtime.store);
    const remoteCursors = createRemoteCursorsReflector(host, world);

    // Registration order = flush order — node-board's proven sequence.
    const unregister = [
      core.registerReflector(createPlaneTransformReflector(planeArgs)),
      core.registerReflector(createGridReflector(host)),
      core.registerReflector(createWiresReflector(host, world, { readPreview: () => stack.wirePreview })),
      core.registerReflector(domWidgets),
      core.registerReflector(createChromeReflector(host, world, stack.marqueeBuffer)),
      core.registerReflector(createCursorReflector(host, stack.readCursor)),
      core.registerReflector(remoteCursors.reflector),
    ];

    const detachPointer = attachPointerAdapter(host, stack.queue);
    const detachMeasure =
      measureQueue !== undefined ? wireMeasurement(runtime.store, domWidgets, measureQueue) : undefined;
    const detachKeymap = attachKeymap(engine);

    const syncViewport = (): void => {
      const rect = container.getBoundingClientRect();
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio : 1;
      writeRuntimeResource(world, Viewport, { w: rect.width, h: rect.height, dpr });
    };
    syncViewport();
    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(syncViewport);
      resizeObserver.observe(container);
    }

    const stopLoop = startRafLoop(core);
    setHosts(domWidgets);
    onReadyRef.current?.({ engine, host, planes });

    return () => {
      stopLoop();
      detachKeymap();
      detachMeasure?.();
      detachPointer();
      resizeObserver?.disconnect();
      for (const unreg of unregister) unreg();
      remoteCursors.destroy();
      host.dispose();
      setHosts(undefined);
    };
  }, [engine, measureQueue]);

  return (
    <EngineProvider engine={engine}>
      <div ref={containerRef} className={className} style={{ width: "100%", height: "100%", ...style }} data-ice-canvas="">
        {hosts !== undefined ? (
          <WidgetRoot world={engine.world} store={engine.runtime.store} hosts={hosts} />
        ) : null}
        {children}
      </div>
    </EngineProvider>
  );
}
