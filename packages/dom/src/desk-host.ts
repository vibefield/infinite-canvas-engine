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
 * `@ice/desk`'s `deskLayer(opts)` (its src/host/) returns a function assignable to {@link LayerFactory}.
 * The context carries the interaction stack's seams the renderer fills (the frame pick, the nav
 * geometry, the held pose — design-014 B3b, design-015 §8–§9) and the marquee buffer it draws.
 *
 * Boot order (registration order = reflector flush order): host → layer → reflectors [ layer ·
 * cursor · remoteCursors ] → pointer adapter → focus → viewport (one layout read, then a
 * ResizeObserver, and the device's ratio read before every step) → rAF loop. `dispose` undoes it in reverse. The engine is NOT owned here — it
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
 * handle (`@ice/desk`'s `DeskLayerHandle`) carries far more; an app keeps that through its
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
  /** The tray pose slot (design-017 §4, K3): where the pegboard drawer is on screen, as drawn. */
  readonly trayPose: InteractionStack["trayPose"];
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
  /**
   * The frame gate's sleep (K7a, `@ice/core` frame-control.ts): the layer registers when it is next due (`wakeWhen`), wakes a
   * sleeping loop for what it hears outside a step (`wake` — an asset landing, a theme, a pin), and asks whether the step in
   * progress is a registered time's alone (`settled` — then it ticks only what is due).
   */
  readonly frame?: Pick<CanvasEngine["engine"]["frame"], "wake" | "wakeWhen" | "settled">;
}

export type LayerFactory<H extends LayerHandle = LayerHandle> = (ctx: LayerContext) => H;

export interface DeskHostOptions<H extends LayerHandle = LayerHandle> {
  /** The viewport element; styled, not created, by the host. */
  readonly container: HTMLElement;
  /** A constructed engine (`createCanvasEngine(...)`); NOT disposed by the host. */
  readonly engine: CanvasEngine;
  /** The desk — `deskLayer({ … })` from `@vibecook/ice/desk` (`@ice/desk`'s src/host/), received opaquely. */
  readonly layer: LayerFactory<H>;
  /**
   * The loop SLEEPS when the engine is quiet (K7a — design-015 §11.4: a desk at rest costs the main thread nothing): no frame
   * until an input, a write, an arrival or a registered time wakes it. Default true; false steps every frame, as before K7a.
   */
  readonly sleep?: boolean;
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
      trayPose: stack.trayPose,
      transitions: engine.transitions,
      catalog: engine.catalog,
      readMarquee: () => stack.marqueeBuffer,
      spatial: stack.index,
      ...(engine.compositorDevice !== undefined ? { gpu: engine.compositorDevice } : {}),
      frame: core.frame,
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

  const ratio = (): number => (typeof window !== "undefined" ? window.devicePixelRatio : 1);
  let synced = 0;
  const syncViewport = (): void => {
    const rect = container.getBoundingClientRect();
    synced = ratio();
    writeRuntimeResource(world, Viewport, { w: rect.width, h: rect.height, dpr: synced });
  };
  syncViewport();
  let resizeObserver: ResizeObserver | undefined;
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(syncViewport);
    resizeObserver.observe(container);
  }

  // THE RATIO (ICE M21 K1): a change of the device's ratio alone — another display, the browser's zoom, an emulated ratio — resizes
  // nothing, so the observer never hears it and the desk kept drawing at the old ratio; an emulated one (DevTools' device mode, CDP)
  // fires not even the `(resolution)` media query (measured: `.matches` flips, no `change` over three rendered frames, no
  // device-pixel box moves). So the ratio is READ before every step — a property read — and the viewport re-synced when it moved.
  const stopLoop = startRafLoop(
    core,
    () => {
      if (ratio() !== synced) syncViewport();
    },
    { sleep: opts.sleep !== false },
  );
  // …and while the loop SLEEPS (K7a) no step reads it: the ratio is read twice a second instead — a property read, and the
  // viewport write wakes the loop through the world's doors when it moved
  const ratioPoll = opts.sleep !== false ? setInterval(() => { if (ratio() !== synced) syncViewport(); }, 500) : undefined;

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
      if (ratioPoll !== undefined) clearInterval(ratioPoll);
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
