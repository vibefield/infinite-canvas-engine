/**
 * `<InfiniteCanvas>` — the one-line canvas mount (design-005 §5): planes +
 * adapters + reflectors + portal root, wired in node-board's PROVEN boot order
 * (apps/nodeboard/src/app.tsx). The app supplies a constructed {@link
 * CanvasEngine} (via `createCanvasEngine`); this component owns only the DOM
 * host, the reflector registrations, the pointer/keymap adapters, the rAF loop,
 * and the viewport sync — everything that must live next to a real container.
 *
 * Boot order (registration order = reflector flush order, mirrored exactly):
 *   host → planes → ground → PROFILE GATE (everything before it is local and
 *   disposable; everything after it is undone by the cleanup) →
 *   reflectors[ planeTransform · ground(P0, app-injected) ·
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
  type Entity,
  type GridConfig,
  type MeasureQueue,
  type ReflectorDef,
  type WirePreviewBuffer,
  type World,
} from "@ice/core";
import {
  attachPointerAdapter,
  attachWidgetFocus,
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
  type WidgetFocusHandle,
} from "@ice/dom";
import { useEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { EngineProvider } from "./engine-context";
import { attachKeymap, type KeymapEntry } from "./keymap";
import type { PresentationProfile } from "./profiles/contract";
import { stratifiedProfile } from "./profiles/stratified";
import { WidgetRoot } from "./widget-root";

/** Handed to {@link InfiniteCanvasProps.onReady} for app-side GL/devtools wiring. */
export interface InfiniteCanvasHandle {
  readonly engine: CanvasEngine;
  readonly host: CanvasHost;
  readonly planes: Planes;
  /**
   * Programmatic widget focus (design-007 §2.3): `focusWidget(entity)` /
   * `blurFocus()` for `keyboard: "exclusive"` widgets. Focus is VIEW state
   * (design-007 §2.6) — it rides this handle, not `engine.ops` (a headless
   * engine correctly has no focus concept).
   */
  readonly focus: WidgetFocusHandle;
}

/**
 * STRUCTURAL mirror of `@ice/ground`'s GroundLayer/GroundFactory (the
 * `WidgetDef.component`-style opaque seam: react never imports the package —
 * the wall forbids three here). `@ice/ground.ground(...)` returns a function
 * assignable to this type.
 */
export interface GroundLayerHandle {
  readonly reflector: ReflectorDef & { available(): boolean };
  /**
   * The unified compositor's reflector (design-012 §4), present only when the
   * ground factory was built with the app-owned device. Opaque here, like the
   * layer itself — this component registers it and never looks inside.
   */
  readonly compositorReflector?: ReflectorDef;
  configureGrid(cfg: Partial<GridConfig>): void;
  dispose(): void;
}

export type GroundLayerFactory = (ctx: {
  readonly host: { readonly container: HTMLElement; readonly contentPlane: HTMLElement };
  readonly world: World;
  readonly readWirePreview: () => WirePreviewBuffer;
  /**
   * Broad-phase rect query over the interaction stack's spatial index (the
   * magnet grid's widget sources, design-010 §3.2). Structural mirror of
   * `@ice/ground`'s ReadSpatial — kernel AABB/SpatialEntry shapes inlined.
   */
  readonly readSpatial: (bounds: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  }) => ReadonlyArray<{ minX: number; minY: number; maxX: number; maxY: number; id: Entity }>;
  readonly canvas: {
    type(): ReturnType<CanvasEngine["canvas"]["type"]>;
    current(): ReturnType<CanvasEngine["canvas"]["current"]>;
    subscribe(onChange: () => void): () => void;
  };
  readonly transitions: CanvasEngine["transitions"];
  readonly gpu: CanvasEngine["gpu"];
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
  /**
   * Keymap overrides plumbed to {@link attachKeymap} (design-007 §5 M-d — the
   * declared alternative to capture-phase `stopPropagation` folklore; retires
   * the widgetlab C-key hack). An entry replaces a default by its
   * `key|mod|shift` signature; conditional behavior belongs INSIDE `run`
   * (read engine state there — e.g. selection → comment, else the default's
   * action). BOUND ONCE at mount, like the adapter: entries should read live
   * state from the engine at run time, never close over render-time values.
   */
  readonly keymapOverrides?: readonly KeymapEntry[];
  /**
   * The PRESENTATION PROFILE (design-012 §3). Absent ⇒ `stratifiedProfile` —
   * the six-plane model this component has always mounted, so every existing
   * app is untouched. A composited build imports `compositedProfile` and
   * passes it here; the unimported profile tree-shakes out of that app's
   * bundle, which is what makes this a build-time selection rather than a
   * runtime mode (the design-010 idiom).
   *
   * Bound ONCE at mount, like the adapters: changing it is a rebuild, not a
   * re-render, and it is deliberately absent from the mount effect's deps.
   */
  readonly profile?: PresentationProfile;
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
  keymapOverrides,
  profile,
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
  // Overrides are bound once at mount (attachKeymap builds its map at attach);
  // the ref keeps identity churn from re-booting the canvas.
  const keymapOverridesRef = useRef(keymapOverrides);
  keymapOverridesRef.current = keymapOverrides;
  // The profile is bound once at mount (it decides the roster, which is built
  // there); identity churn must not re-boot the canvas.
  const profileRef = useRef(profile);
  profileRef.current = profile;

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
      ground?.({
        host,
        world,
        readWirePreview: () => stack.wirePreview,
        readSpatial: (bounds) => stack.index.search(bounds),
        canvas: engine.canvas,
        transitions: engine.transitions,
        gpu: engine.gpu,
      }) ?? null;
    groundRef.current = groundLayer;
    if (groundLayer !== null && gridConfigRef.current !== undefined) {
      groundLayer.configureGrid(gridConfigRef.current);
    }
    const chrome = createChromeReflector(host, world, stack.marqueeBuffer);

    // The presentation profile's boot gate (design-012 §11 Q2). ONE profile
    // ships per app, so there is nothing to fall back to: refuse loudly.
    //
    // The gate runs before ANY engine-wide registration and before any
    // listener attach, because a throwing effect returns no cleanup — React
    // never runs one for a render that did not complete. Whatever this path
    // has already claimed on the ENGINE (which outlives the mount) is claimed
    // for good. Registering the dom transition adapter above the gate meant a
    // refused mount kept the "dom" transition plane forever, and the NEXT
    // mount died with `plane "dom" is already owned` instead of the real
    // refusal reason — each cycle also pinning the dead engine through a
    // window-lifetime matchMedia listener (2026-08-31 review finding).
    // Everything constructed above is LOCAL and disposed right here, so a
    // refused mount still leaves no half-wired canvas behind.
    const activeProfile = profileRef.current ?? stratifiedProfile;
    const profileCtx = { engine, ground: groundLayer };
    const refusal = activeProfile.check(profileCtx);
    if (refusal !== null) {
      groundLayer?.dispose();
      groundRef.current = null;
      chrome.dispose();
      domWidgets.dispose();
      remoteCursors.destroy();
      planes.dispose();
      host.dispose();
      throw new Error(`ice: the ${activeProfile.name} profile cannot mount — ${refusal}`);
    }

    // Past the gate: everything from here is undone by the cleanup below.
    const detachDomTransition = engine.transitions.register(domWidgets.transitionAdapter());
    const motionQuery = container.ownerDocument.defaultView?.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    const syncReducedMotion = (): void => {
      engine.transitions.setReducedMotion(motionQuery?.matches === true);
    };
    syncReducedMotion();
    motionQuery?.addEventListener("change", syncReducedMotion);

    // Registration order = flush order — node-board's proven sequence, with
    // the profile's own reflectors spliced in right after ground (plan §4.3).
    const unregister = [
      core.registerReflector(createPlaneTransformReflector(planeArgs)),
      ...(groundLayer !== null ? [core.registerReflector(groundLayer.reflector)] : []),
      ...activeProfile.reflectorsAfterGround(profileCtx).map((r) => core.registerReflector(r)),
      core.registerReflector(domWidgets),
      core.registerReflector(chrome),
      core.registerReflector(createCursorReflector(host, stack.readCursor)),
      core.registerReflector(remoteCursors.reflector),
    ];

    const detachPointer = attachPointerAdapter(
      host,
      stack.queue,
      glRouteRef.current !== undefined
        ? // Pass the verdict through UNCOERCED: a rich GLRouteVerdict return
          // (hover-time overInteractive, 2026-07-18) must survive this seam.
          { glRoute: (kind, x, y, e) => glRouteRef.current?.(kind, x, y, e) ?? false }
        : {},
    );
    const detachMeasure =
      measureQueue !== undefined ? wireMeasurement(runtime.store, domWidgets, measureQueue) : undefined;
    const detachKeymap = attachKeymap(engine, undefined, keymapOverridesRef.current ?? []);
    // Click-to-focus acquisition for keyboard-claiming widgets + the
    // programmatic focus handle (design-007 §2.3; the reflector's hostFor
    // resolves entity → content, the driver walks to the marked host).
    const focus = attachWidgetFocus(host, domWidgets);

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
    onReadyRef.current?.({ engine, host, planes, focus });

    return () => {
      stopLoop();
      focus.detach();
      detachKeymap();
      detachMeasure?.();
      detachPointer();
      resizeObserver?.disconnect();
      for (const unreg of unregister) unreg();
      remoteCursors.destroy();
      groundLayer?.dispose();
      groundRef.current = null;
      motionQuery?.removeEventListener("change", syncReducedMotion);
      engine.transitions.setReducedMotion(false);
      detachDomTransition();
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
