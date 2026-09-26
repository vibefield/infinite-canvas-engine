/**
 * `createDeskHost` — the vanilla mount (design-015 §3, D-D15; D5b). What `<InfiniteCanvas>` did
 * for the hybrid, with the hybrid gone: ONE container, the desk's layer in it, and this package's
 * screen-space half around it — the pointer adapter (L0's one producer), the rAF loop, the OS
 * cursor, the room's other people (the remote cursors), the focus driver, the viewport sync.
 * `@ice/react`'s `<Desk>` wraps it; an app without React mounts it directly.
 *
 * THE DESK ARRIVES AS AN OPAQUE LAYER FACTORY. This package never imports `@ice/desk` (the wall
 * `nobody-imports-desk`): the factory's context and its handle are typed STRUCTURALLY here —
 * exactly as `<InfiniteCanvas ground={groundCompose(…)}>` received the ground — and
 * `@ice/desk/host`'s `deskLayer(opts)` returns a function assignable to {@link LayerFactory}.
 * The context carries the interaction stack's seams the renderer fills (the frame pick, the nav
 * geometry, the held pose — design-014 B3b, design-015 §8–§9) and the marquee buffer it draws.
 *
 * Boot order (registration order = reflector flush order): host → layer → reflectors [ layer ·
 * cursor · remoteCursors ] → pointer adapter → focus → viewport (one layout read, then a
 * ResizeObserver) → rAF loop. `dispose` undoes it in reverse. The engine is NOT owned here — it
 * outlives the mount (the app disposes it). A layer factory that throws leaves nothing claimed on
 * the engine: it runs before any registration, and only the local host is undone.
 */
import {
  Viewport,
  writeRuntimeResource,
  type CanvasEngine,
  type EngineGpu,
  type InteractionStack,
  type ReflectorDef,
  type World,
} from "@ice/core";
import { createCanvasHost, type CanvasHost } from "./host";
import { startRafLoop } from "./loop";
import { attachPointerAdapter } from "./pointer-adapter";
import { createCursorReflector } from "./reflectors/cursor";
import { createRemoteCursorsReflector } from "./reflectors/remote-cursors";
import { attachWidgetFocus, type WidgetFocusHandle } from "./widget-focus";

/**
 * What the host needs of a mounted layer: its drawing reflector and its teardown. The desk's own
 * handle (`@ice/desk/host`'s `DeskLayerHandle`) carries far more; an app keeps that through its
 * own factory wrapper, or reads it off {@link DeskHost.layer} typed as the factory returned it.
 */
export interface LayerHandle {
  readonly reflector: ReflectorDef & { available(): boolean };
  dispose(): void;
}

/** The mount context a layer factory receives: the host, the world and the seams the renderer fills. */
export interface LayerContext {
  readonly host: CanvasHost;
  readonly world: World;
  /** The frame pick slot (design-014, B3b): the renderer sets its hit test here at mount, clears it at dispose. */
  readonly framePick: InteractionStack["framePick"];
  /** The nav geometry slot (design-015 §9, D2b): the renderer's word on its containers' drawn faces. */
  readonly navGeometry: InteractionStack["navGeometry"];
  /** The held pose slot (design-015 §8, D4b): where the object in hand is on screen, as drawn. */
  readonly heldPose: InteractionStack["heldPose"];
  /** The presentation transition coordinator: the layer registers the `ground` plane so a nav flight can prepare. */
  readonly transitions: CanvasEngine["transitions"];
  /** The engine's catalog: the object types whose kinds the layer registers. */
  readonly catalog: CanvasEngine["catalog"];
  /** The marquee's preview, out of the ECS (design-003 §5.7): the vellum the marks draw (design-015 D4a). */
  readonly readMarquee: () => InteractionStack["marqueeBuffer"];
  /** The one spatial index (design-015 §2.5; D6): the renderer's cull rides it with a hysteresis margin — no per-entity rect test on a pan. */
  readonly spatial: InteractionStack["index"];
  /** The engine's device (`engine.compositorDevice`), when the app passed one (design-015 D7): the layer draws with it — ONE device per engine. */
  readonly gpu?: EngineGpu;
}

export type LayerFactory<H extends LayerHandle = LayerHandle> = (ctx: LayerContext) => H;

export interface DeskHostOptions<H extends LayerHandle = LayerHandle> {
  /** The viewport element; styled, not created, by the host. */
  readonly container: HTMLElement;
  /** A constructed engine (`createCanvasEngine(...)`); NOT disposed by the host. */
  readonly engine: CanvasEngine;
  /** The desk — `deskLayer({ … })` from `@ice/desk/host`, received opaquely. */
  readonly layer: LayerFactory<H>;
}

export interface DeskHost<H extends LayerHandle = LayerHandle> {
  readonly engine: CanvasEngine;
  readonly host: CanvasHost;
  /** The mounted layer's handle, as the factory returned it. */
  readonly layer: H;
  /**
   * The focus driver (design-007 §2.3): `blurFocus()` releases whatever keyboard claim holds
   * focus. Focus is VIEW state (design-007 §2.6) — it rides the mount, not `engine.ops`.
   */
  readonly focus: WidgetFocusHandle;
  /** Stop the loop, detach every adapter, unregister every reflector, dispose the layer and the host. Idempotent. */
  dispose(): void;
}

export function createDeskHost<H extends LayerHandle>(opts: DeskHostOptions<H>): DeskHost<H> {
  const { container, engine } = opts;
  const { world, engine: core, stack } = engine;
  const host = createCanvasHost(container);

  let layer: H;
  try {
    layer = opts.layer({
      host,
      world,
      framePick: stack.framePick,
      navGeometry: stack.navGeometry,
      heldPose: stack.heldPose,
      transitions: engine.transitions,
      catalog: engine.catalog,
      readMarquee: () => stack.marqueeBuffer,
      spatial: stack.index,
      ...(engine.compositorDevice !== undefined ? { gpu: engine.compositorDevice } : {}),
    });
  } catch (err) {
    host.dispose();
    throw err;
  }

  // Registration order = flush order: the desk draws, then the OS cursor, then
  // the room's other people on top (their plane is the container's last child).
  const remoteCursors = createRemoteCursorsReflector(host, world);
  const unregister = [
    core.registerReflector(layer.reflector),
    core.registerReflector(createCursorReflector(host, stack.readCursor)),
    core.registerReflector(remoteCursors.reflector),
  ];

  // The OS's reduced-motion preference, into the transition coordinator (a nav flight snaps).
  const motionQuery = container.ownerDocument.defaultView?.matchMedia("(prefers-reduced-motion: reduce)");
  const syncReducedMotion = (): void => {
    engine.transitions.setReducedMotion(motionQuery?.matches === true);
  };
  syncReducedMotion();
  motionQuery?.addEventListener("change", syncReducedMotion);

  const detachPointer = attachPointerAdapter(host, stack.queue);
  const focus = attachWidgetFocus(host);

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

  let disposed = false;
  return {
    engine,
    host,
    layer,
    focus,
    dispose() {
      if (disposed) return;
      disposed = true;
      stopLoop();
      resizeObserver?.disconnect();
      focus.detach();
      detachPointer();
      motionQuery?.removeEventListener("change", syncReducedMotion);
      engine.transitions.setReducedMotion(false);
      for (const unreg of unregister) unreg();
      remoteCursors.destroy();
      layer.dispose();
      host.dispose();
    },
  };
}
