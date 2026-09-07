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
  type World, type InteractionStack } from "@ice/core";
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
  createSourceCanvas,
  startRafLoop,
  wireMeasurement,
  type CanvasHost,
  type DomWidgetsReflector,
  type GLRoute,
  type Planes,
  type SourceCanvas,
  type SourceCanvasEffects,
  type WidgetFocusHandle,
} from "@ice/dom";
import { useEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { EngineProvider } from "./engine-context";
import { attachKeymap, type KeymapEntry } from "./keymap";
import type { PresentationProfile } from "./profiles/contract";
import { stratifiedProfile } from "./profiles/stratified";
import { ChromeOwnerContext } from "./hooks";
import { SurfaceContentContext, surfaceContentOf, type SurfaceContent } from "./surface-content";
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
/**
 * STRUCTURAL mirror of `@ice/ground/compose`'s `SourceCanvasSlot` (B4). The L1
 * `<canvas layoutsubtree>` is THIS component's to build — it owns the container
 * and the viewport the bitmap must track — while the two things only the HiC
 * adapter can supply come from the ground: the injected effects, and the dirt
 * latch a paint event feeds. `@ice/react` may import neither `@ice/ground` nor
 * its adapter, so the seam is read structurally, exactly as `compose` is.
 */
interface GroundSourceCanvasSlot {
  readonly effects: SourceCanvasEffects;
  onDirty(hosts: readonly Element[]): void;
}
interface GroundComposeMirror {
  readonly sourceCanvas?: GroundSourceCanvasSlot | null;
}

export interface GroundLayerHandle {
  readonly reflector: ReflectorDef & { available(): boolean };
  /**
   * The ground's COMPOSE handle (design-013, `groundCompose(…)`), present only on the new
   * leg. Opaque here as well: the composited profile reads its reflectors off it, and
   * this component reads its content seam through {@link surfaceContentOf} — never by
   * importing the package.
   */
  readonly compose?: unknown;
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
  /** The preview store (`engine.previews`): a container's inside for the ground's live portals (design-013 §8 B3). */
  readonly previews: CanvasEngine["previews"];
  /**
   * The DOM hosts by entity: `contentOf` is the inner `data-ice-content` node a DomCompose clips
   * and lifts (design-014, B3b); `hostOf` is the OUTER host — the node that reparents onto L1 and
   * the one an element copy addresses (design-013 B4). Both are lazy: the dom reflector is built
   * AFTER the ground, because the ground is what says whether there is an L1 canvas to build.
   */
  readonly hosts: {
    contentOf(entity: Entity): HTMLElement | undefined;
    hostOf(entity: Entity): HTMLElement | undefined;
  };
  /** The interaction stack's frame pick slot: the ground sets its hit test here at mount, clears it at dispose (design-014, B3b). */
  readonly framePick: InteractionStack["framePick"];
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
  // The mounted ground's CONTENT seam (design-013 §5, B5): its residency and the three
  // render slots, published to the tree so a render mounted app-side (the R3F island root —
  // the wall keeps three out of this package) can reach them. Set beside `hosts`, in the same
  // batch as `onReady`, so a GL root mounted from that callback sees it on its first render.
  const [content, setContent] = useState<SurfaceContent | undefined>(undefined);
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
    const remoteCursors = createRemoteCursorsReflector(host, world);

    // ORDER (B4): the ground is built BEFORE the dom reflector, because the
    // ground is what says whether this host has HTML-in-Canvas and therefore
    // whether there is an L1 source canvas for `gpu`-target hosts to live
    // under — and `createDomWidgetsReflector` binds its planes once, at
    // construction. The two `hosts` lookups the ground takes are thunks and
    // stay thunks; nothing calls them before the mount finishes.
    let domWidgets: DomWidgetsReflector | undefined;

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
        previews: engine.previews,
        hosts: { contentOf: (e) => domWidgets?.hostFor(e), hostOf: (e) => domWidgets?.hostElementFor(e) },
        framePick: stack.framePick,
      }) ?? null;
    groundRef.current = groundLayer;

    // L1 (design-012 §5, wired in production at B4): one `<canvas layoutsubtree>`
    // whose IMMEDIATE children are the promoted hosts — laid out, hit-tested,
    // never painted by the browser, and copyable by the element copy. It exists
    // only when the ground's layer offers the adapter's effects, so a host
    // without the origin trial simply has no L1 and every card draws its plate.
    const sourceSlot = (groundLayer as (GroundLayerHandle & { readonly compose?: GroundComposeMirror }) | null)?.compose?.sourceCanvas;
    const sourceCanvas: SourceCanvas | undefined =
      sourceSlot == null
        ? undefined
        : createSourceCanvas(host.container, sourceSlot.effects, {
            // The canvas paints nothing of its own and, unlike the old leg's
            // all-composited board, it now sits above a content plane that
            // still holds every `dom`-target card. It must not swallow their
            // hits, so the box is transparent to the pointer and each host it
            // adopts turns pointer events back on (`dom-widgets`).
            pointerEvents: "none",
            onDirty: (hosts) => sourceSlot.onDirty(hosts),
          });
    const planeArgs = {
      contentPlane: planes.content,
      liftedPlane: planes.lifted,
      ...(sourceCanvas !== undefined ? { sourceCanvas: sourceCanvas.canvas } : {}),
    };
    domWidgets = createDomWidgetsReflector(planeArgs, world, runtime.store);
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
      sourceCanvas?.dispose();
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
    // `domWidgets` MOUNTS and REPARENTS hosts. A profile whose roster reads
    // those hosts — design-013's DomRender copies from one that must already be
    // an immediate child of L1 — asks for it first (`hostsBeforeRoster`), or a
    // promotion reaches the copy one flush late and the card shows its plate
    // for a frame. Everyone else keeps today's order, where the old leg's
    // `domWriteback` sits inside the roster and must FOLLOW the reparent.
    const hostsFirst = activeProfile.hostsBeforeRoster === true;
    const unregister = [
      core.registerReflector(createPlaneTransformReflector(planeArgs)),
      ...(groundLayer !== null ? [core.registerReflector(groundLayer.reflector)] : []),
      ...(hostsFirst ? [core.registerReflector(domWidgets)] : []),
      ...activeProfile.reflectorsAfterGround(profileCtx).map((r) => core.registerReflector(r)),
      ...(hostsFirst ? [] : [core.registerReflector(domWidgets)]),
      core.registerReflector(chrome),
      core.registerReflector(createCursorReflector(host, stack.readCursor)),
      core.registerReflector(remoteCursors.reflector),
    ];

    // The profile's SYSTEMS, after its reflectors (design-013 Q6). Order
    // matters in one direction only: a reflector arms reactivity for the
    // world's life, and these systems write components those reflectors
    // observe, so the observers exist before the first frame that could stamp
    // them. Undone below, with everything else past the gate.
    const uninstallProfile = activeProfile.install?.(profileCtx);

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
      // THE BACKING STORE IS LOAD-BEARING (`source-canvas.ts`): the bitmap is
      // what element paint records are recorded against, and an undersized one
      // degrades every copy silently. One layout read, here, never in a flush.
      sourceCanvas?.resize(rect.width, rect.height, dpr);
    };
    syncViewport();
    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(syncViewport);
      resizeObserver.observe(container);
    }

    const stopLoop = startRafLoop(core);
    setHosts(domWidgets);
    setContent(surfaceContentOf(groundLayer));
    onReadyRef.current?.({ engine, host, planes, focus });

    return () => {
      stopLoop();
      focus.detach();
      detachKeymap();
      detachMeasure?.();
      detachPointer();
      resizeObserver?.disconnect();
      uninstallProfile?.();
      for (const unreg of unregister) unreg();
      remoteCursors.destroy();
      groundLayer?.dispose();
      groundRef.current = null;
      motionQuery?.removeEventListener("change", syncReducedMotion);
      engine.transitions.setReducedMotion(false);
      detachDomTransition();
      domWidgets.dispose();
      sourceCanvas?.dispose();
      chrome.dispose();
      planes.dispose();
      host.dispose();
      setHosts(undefined);
      setContent(undefined);
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
      <ChromeOwnerContext.Provider value={profile?.chromeOwner ?? "dom"}>
        <SurfaceContentContext.Provider value={content}>
          <div ref={containerRef} className={className} style={{ width: "100%", height: "100%", ...style }} data-ice-canvas="">
            {hosts !== undefined ? (
              <WidgetRoot world={engine.world} store={engine.runtime.store} hosts={hosts} />
            ) : null}
            {children}
          </div>
        </SurfaceContentContext.Provider>
      </ChromeOwnerContext.Provider>
    </EngineProvider>
  );
}
