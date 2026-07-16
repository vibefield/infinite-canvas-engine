/**
 * `<InfiniteCanvas>` — the one-line canvas mount (design-005 §5): planes +
 * adapters + reflectors + portal root, wired in node-board's PROVEN boot order
 * (apps/nodeboard/src/app.tsx). The app supplies a constructed {@link
 * CanvasEngine} (via `createCanvasEngine`); this component owns only the DOM
 * host, the reflector registrations, the pointer/keymap adapters, the rAF loop,
 * and the viewport sync — everything that must live next to a real container.
 *
 * Boot order (registration order = reflector flush order, mirrored exactly):
 *   host → planes → reflectors[ planeTransform · ground(P0, app-injected) ·
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
 *  - The GROUND layer (P0: dot grid, wires, snap guides — @ice/ground, three's
 *    WebGPURenderer) rides the same wall: pass its factory through the OPAQUE
 *    {@link InfiniteCanvasProps.ground} prop (`ground={ground({...})}`); this
 *    component types it structurally and never imports the package. No factory
 *    ⇒ no ground layer (headless/test boots).
 *  - Devtools: the import wall forbids `@ice/react` importing `@ice/devtools`.
 *    Wire the panel app-side against `engine.engine` (also via {@link onReady}).
 *  - Measurement: auto-sized widgets need a `MeasureQueue` passed to BOTH
 *    `createCanvasEngine({ measureQueue })` (ingest side) and this component's
 *    `measureQueue` prop (ResizeObserver side). Absent ⇒ measurement is skipped.
 */
import {
  Viewport,
  writeRuntimeResource,
  type CanvasEngine,
  type GridConfig,
  type MeasureQueue,
  type ReflectorDef,
  type WirePreviewBuffer,
  type World,
} from "@ice/core";
import {
  attachPointerAdapter,
  createCanvasHost,
  createChromeReflector,
  createCursorReflector,
  createDomWidgetsReflector,
  createPlaneTransformReflector,
  createPlanes,
  createRemoteCursorsReflector,
  startRafLoop,
  wireMeasurement,
  type CanvasHost,
  type DomWidgetsReflector,
  type GLRoute,
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

/**
 * STRUCTURAL mirror of `@ice/ground`'s GroundLayer/GroundFactory (the
 * `WidgetDef.component`-style opaque seam: react never imports the package —
 * the wall forbids three here). `@ice/ground.ground(...)` returns a function
 * assignable to this type.
 */
export interface GroundLayerHandle {
  readonly reflector: ReflectorDef & { available(): boolean };
  configureGrid(cfg: Partial<GridConfig>): void;
  dispose(): void;
}

export type GroundLayerFactory = (ctx: {
  readonly host: { readonly container: HTMLElement; readonly contentPlane: HTMLElement };
  readonly world: World;
  readonly readWirePreview: () => WirePreviewBuffer;
}) => GroundLayerHandle;

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
  /**
   * The P0 ground layer (dot grid, wires, snap guides — one WebGPU canvas).
   * Pass `ground(opts)` from `@ice/ground`; received opaquely (see
   * {@link GroundLayerFactory}). Memoize in the caller — a new identity
   * re-boots the canvas mount effect. Absent ⇒ no ground layer renders.
   */
  readonly ground?: GroundLayerFactory;
  /**
   * Dot-grid tuning (theme dot color, spacing, fades). Applied live via the
   * ground layer's `configureGrid` — changing it never re-boots the canvas
   * (memoize in the caller to avoid redundant same-value redraws). No-op
   * when {@link ground} is absent.
   */
  readonly grid?: Partial<GridConfig>;
  /**
   * GL pointer routing (event-time island pick — @ice/r3f's
   * createGLPointerRouter). Provide from the FIRST render (a stub delegating
   * to a ref is fine — the real router usually arrives in onReady); the prop
   * is read through a ref, so later identity changes take effect without
   * re-attaching the adapter.
   */
  readonly glRoute?: GLRoute;
  readonly className?: string;
  readonly style?: CSSProperties;
  /** Overlays inside the viewport (toolbars, HUD) — rendered under the EngineProvider. */
  readonly children?: ReactNode;
}

export function InfiniteCanvas({
  engine,
  measureQueue,
  onReady,
  ground,
  grid: gridConfig,
  glRoute,
  className,
  style,
  children,
}: InfiniteCanvasProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hosts, setHosts] = useState<DomWidgetsReflector | undefined>(undefined);
  // Keep onReady out of the effect deps (identity churn must not re-boot).
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  // The live ground handle (set by the mount effect); the grid-config effect
  // below re-tunes it without re-booting the canvas.
  const groundRef = useRef<GroundLayerHandle | null>(null);
  const gridConfigRef = useRef(gridConfig);
  gridConfigRef.current = gridConfig;
  // glRoute reads through a ref: the adapter captures ONE function at attach,
  // and the app's real router typically arrives post-mount (onReady).
  const glRouteRef = useRef(glRoute);
  glRouteRef.current = glRoute;

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const { world, engine: core, stack, runtime } = engine;

    const host = createCanvasHost(container);
    const planes = createPlanes(host);
    const planeArgs = { contentPlane: planes.content, liftedPlane: planes.lifted };
    const domWidgets = createDomWidgetsReflector(planeArgs, world, runtime.store);
    const remoteCursors = createRemoteCursorsReflector(host, world);

    // Handles kept for teardown: unregistering only stops flushes — the DOM
    // these factories inserted (ground canvas, chrome plane) must be disposed
    // too, or a StrictMode remount stacks duplicates (the double-grid field
    // report, 2026-07-11).
    const groundLayer =
      ground?.({ host, world, readWirePreview: () => stack.wirePreview }) ?? null;
    groundRef.current = groundLayer;
    if (groundLayer !== null && gridConfigRef.current !== undefined) {
      groundLayer.configureGrid(gridConfigRef.current);
    }
    const chrome = createChromeReflector(host, world, stack.marqueeBuffer);

    // Registration order = flush order — node-board's proven sequence.
    const unregister = [
      core.registerReflector(createPlaneTransformReflector(planeArgs)),
      ...(groundLayer !== null ? [core.registerReflector(groundLayer.reflector)] : []),
      core.registerReflector(domWidgets),
      core.registerReflector(chrome),
      core.registerReflector(createCursorReflector(host, stack.readCursor)),
      core.registerReflector(remoteCursors.reflector),
    ];

    const detachPointer = attachPointerAdapter(
      host,
      stack.queue,
      glRouteRef.current !== undefined
        ? { glRoute: (kind, x, y, e) => glRouteRef.current?.(kind, x, y, e) === true }
        : {},
    );
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
      groundLayer?.dispose();
      groundRef.current = null;
      domWidgets.dispose();
      chrome.dispose();
      planes.dispose();
      host.dispose();
      setHosts(undefined);
    };
  }, [engine, measureQueue, ground]);

  // Live grid re-tune — never re-boots the canvas (the mount effect above
  // deliberately omits `gridConfig` from its deps; initial config rides the
  // ref at creation).
  useEffect(() => {
    if (gridConfig !== undefined) groundRef.current?.configureGrid(gridConfig);
  }, [gridConfig]);

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
