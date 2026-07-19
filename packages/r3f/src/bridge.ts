/**
 * The GL bridge — the engine↔R3F seam (design-004 §3, two-level invalidation).
 *
 * Owns everything ENGINE-facing: the module-side island state, the island
 * registry (scene+camera handles the frame pass iterates), per-island dirt
 * observers, the `r3fInvalidator` reflector, `useIslandFrame` callbacks, the
 * render write trap, and entity-death cleanup. Everything GL-facing (FBO
 * pool, quads, the actual passes) lives in `GLViews`, whose lifetime is the
 * Canvas/context's — the bridge outlives Canvas remounts (HMR) and carries
 * the invalidation wiring across them.
 *
 * Two-level invalidation, mechanized:
 * - COMPOSITE dirt (cheap — re-run the frame pass, sample cached textures):
 *   camera/viewport via the reflector; per-island Position Tier-3; the frame
 *   ChildOf reorder wake (petition 8 — quad renderOrder is sibling order);
 *   island enter/exit via register/unregister. All call `requestFrame()`.
 * - ISLAND dirt (expensive — repaint the FBO): per-island props-group and
 *   Size Tier-3 → `bumpPaint()` + `requestFrame()`; the animation signal
 *   (declared `animated` / live `useIslandFrame` refs) and band crossings
 *   are evaluated IN the frame pass (band repaints suppressed while
 *   `Camera.gesturing`; the gesture-end camera write re-fires the reflector,
 *   so the once-at-gesture-end repaint needs no extra machinery).
 *
 * Runtime-three-free (type-only imports): unit tests drive the bridge with a
 * real world and fake scene/camera handles, no GL context.
 */
import type { OrthographicCamera, Scene } from "three";
import {
  Camera,
  Opacity,
  PrefabId,
  Position,
  Size,
  StageMode,
  Viewport,
  createSiblingOrderIndex,
  widgets,
  type Engine,
  type Entity,
  type SiblingOrderIndex,
} from "@ice/core";
import { LIFT_DEFAULT_MS, createIslandStateStore, type IslandStateStore } from "./island-state";
import { createRenderWriteTrap, type RenderWriteTrap } from "./dev-write-trap";

export interface IslandHandle {
  readonly scene: Scene;
  readonly camera: OrthographicCamera;
}

/** `useIslandFrame` callback: dt in ms, fired only on frames its island paints. */
export type IslandFrameCallback = (dtMs: number) => void;

export interface GLBridgeOpts {
  /** Arm the zero-render→ECS-writes trap (DEV builds / traces). Default false. */
  readonly devAssertRenderWrites?: boolean;
}

export interface GLBridge {
  readonly engine: Engine;
  readonly state: IslandStateStore;
  readonly renderAssert: RenderWriteTrap;
  /**
   * The frame ordinal cache (petition 8): the compositor pass reads quad
   * renderOrder from it, and its `ordinals()` read resets the staleness the
   * bridge's reorder wake filters on — bridge and pass MUST share it.
   */
  readonly order: SiblingOrderIndex;
  /**
   * Island mount (the `<Island>` component): registers the scene/camera pair,
   * stamps `animatedDecl` from the widget type, and arms the per-island dirt
   * observers. The returned cleanup removes handle + observers ONLY — state
   * and any pooled FBO survive (retention is decoupled from cull; they die on
   * entity death, reset, or eviction).
   */
  registerIsland(entity: Entity, handle: IslandHandle): () => void;
  islandFor(entity: Entity): IslandHandle | undefined;
  islands(): IterableIterator<[Entity, IslandHandle]>;
  /** Subscribe a paint-time callback; holds an animation ref while live. */
  addFrameCallback(entity: Entity, cb: IslandFrameCallback): () => void;
  frameCallbacksFor(entity: Entity): readonly IslandFrameCallback[];
  /** Composite invalidation — schedule a frame pass (coalesced). */
  requestFrame(): void;
  /** Island invalidation — this island must repaint (props/size/manual dirt). */
  bumpPaint(entity: Entity): void;
  /**
   * Composite-quad lift scale (1 = rest). Scales the CARD on the canvas,
   * corners intact. Sets the TARGET: the compositor pass eases the drawn
   * value there over `durationMs` (default 180 — the DOM card-lift spring;
   * 0 snaps). Mid-flight retargets restart from the current drawn value.
   */
  setCompositeScale(entity: Entity, scale: number, durationMs?: number): void;
  /**
   * Composite-quad opacity (1 = rest) — the lift's fade twin. MULTIPLIES the
   * widget's durable `Opacity` cell in the pass (presentation-transient over
   * the doc fact). Sets the TARGET: the pass eases the drawn value there over
   * `durationMs` (default 180; 0 snaps); mid-flight retargets restart from the
   * current drawn value.
   */
  setCompositeOpacity(entity: Entity, opacity: number, durationMs?: number): void;
  /** GLViews wires R3F's demand-loop `invalidate` here (null on unmount). */
  setInvalidate(fn: (() => void) | null): void;
  /** Tear down reflector + observers + state (doc close / app teardown). */
  uninstall(): void;
}

export function createGLBridge(engine: Engine, opts: GLBridgeOpts = {}): GLBridge {
  const world = engine.world;
  const state = createIslandStateStore();
  const islands = new Map<Entity, IslandHandle>();
  const frameCbs = new Map<Entity, Set<IslandFrameCallback>>();
  const renderAssert = createRenderWriteTrap(world, opts.devAssertRenderWrites === true);

  // --- composite invalidation plumbing --------------------------------------
  let invalidate: (() => void) | null = null;
  let pending = false; // a requestFrame that arrived before GLViews mounted
  const requestFrame = (): void => {
    if (invalidate !== null) invalidate();
    else pending = true;
  };

  // Camera (pan/zoom/gesturing edges) + viewport (resize/dpr) are the global
  // composite dirt sources; everything entity-shaped is observed per island
  // (only GL widgets wake the canvas — a static GL board ignores DOM churn).
  const removeReflector = engine.registerReflector({
    name: "r3fInvalidator",
    // StageMode: a background-hold flip must re-fire the pass — freezing on
    // take, and (critically) REPAINTING Hot islands on release.
    observe: { resources: [Camera, Viewport, StageMode] },
    flush: () => requestFrame(),
  });

  // Composite dirt — a reorder in the current frame moves quad renderOrder
  // (petition 8; replaces the per-island StackZ Tier-3). The wake names
  // ChildOf (pure reorders fire it); the orderStamp staleness check drops
  // other-frame churn, and the pass's `ordinals()` read resets it.
  const order = createSiblingOrderIndex(world);
  const removeOrderObserver = order.observe(() => {
    if (order.stale()) requestFrame();
  });

  // Death/reset: drop state so the frame pass releases the pooled FBO on its
  // next reconcile (the bridge is three-free — it never touches the pool).
  const removeWorldObserver = world.observe({
    onDestroy: (e) => {
      if (state.get(e as Entity) !== undefined) {
        state.drop(e as Entity);
        frameCbs.delete(e as Entity);
        requestFrame();
      }
    },
    onReset: () => {
      state.clear();
      frameCbs.clear();
      requestFrame();
    },
  });

  return {
    engine,
    state,
    renderAssert,
    order,

    registerIsland(entity, handle) {
      islands.set(entity, handle);
      const s = state.ensure(entity);

      // `animated` declaration comes from the widget type (design-004 §3
      // animation contract — explicit opt-in; plain useFrame is unattributable).
      const type = world.get(entity, PrefabId)?.id;
      const widget = typeof type === "string" ? widgets.get(type) : undefined;
      state.setAnimatedDecl(entity, widget?.animated === true);

      // Per-island dirt (Tier-3, equality-suppressed, fired at notify()):
      const unsubs: (() => void)[] = [
        // island dirt — content resolution/props changed, FBO stale:
        world.reactive.observeValue(entity, Size, () => {
          state.bumpPaint(entity);
          requestFrame();
        }),
        // composite dirt — quad transform changed, texture still good (order
        // dirt is bridge-scoped: the ChildOf reorder wake above):
        world.reactive.observeValue(entity, Position, () => requestFrame()),
        // composite dirt — the durable Opacity cell rides the quad's uOpacity,
        // never the island's FBO (a fade must not repaint the content):
        world.reactive.observeValue(entity, Opacity, () => requestFrame()),
      ];
      for (const group of widget?.groups ?? []) {
        unsubs.push(
          world.reactive.observeValue(entity, group.component, () => {
            state.bumpPaint(entity);
            requestFrame();
          }),
        );
      }

      // A re-entering island with a retained FBO composites immediately
      // (Warm); a fresh one is Waking — either way the pass must run.
      if (s.fboGeneration < 0) state.bumpPaint(entity);
      requestFrame();

      return () => {
        for (const u of unsubs) u();
        islands.delete(entity);
        requestFrame(); // exit dirt: the quad may need to hide/recompose
      };
    },

    islandFor: (entity) => islands.get(entity),
    islands: () => islands.entries(),

    addFrameCallback(entity, cb) {
      let set = frameCbs.get(entity);
      if (set === undefined) {
        set = new Set();
        frameCbs.set(entity, set);
      }
      set.add(cb);
      state.addAnimRef(entity);
      requestFrame(); // the island turns Hot next pass
      return () => {
        set.delete(cb);
        state.removeAnimRef(entity);
      };
    },

    frameCallbacksFor(entity) {
      const set = frameCbs.get(entity);
      return set === undefined ? [] : [...set];
    },

    requestFrame,
    bumpPaint(entity) {
      state.bumpPaint(entity);
      requestFrame();
    },

    setCompositeScale(entity, scale, durationMs = LIFT_DEFAULT_MS) {
      const s = state.ensure(entity);
      if (s.liftTarget === scale) return; // change-only — no idle churn
      s.liftTarget = scale;
      if (durationMs <= 0) {
        s.compositeScale = scale; // snap (the pre-ease behavior)
        s.liftMs = 0;
        s.liftElapsedMs = 0;
      } else {
        s.liftFrom = s.compositeScale; // retarget from the DRAWN value — no jump
        s.liftMs = durationMs;
        s.liftElapsedMs = 0;
      }
      requestFrame(); // composite-level only: no island repaint needed
    },

    setCompositeOpacity(entity, opacity, durationMs = LIFT_DEFAULT_MS) {
      const s = state.ensure(entity);
      if (s.opacityTarget === opacity) return; // change-only — no idle churn
      s.opacityTarget = opacity;
      if (durationMs <= 0) {
        s.compositeOpacity = opacity; // snap
        s.opacityMs = 0;
        s.opacityElapsedMs = 0;
      } else {
        s.opacityFrom = s.compositeOpacity; // retarget from the DRAWN value — no jump
        s.opacityMs = durationMs;
        s.opacityElapsedMs = 0;
      }
      requestFrame(); // composite-level only: no island repaint needed
    },

    setInvalidate(fn) {
      invalidate = fn;
      if (fn !== null && pending) {
        pending = false;
        fn();
      }
    },

    uninstall() {
      removeReflector();
      removeOrderObserver();
      removeWorldObserver();
      renderAssert.dispose();
      islands.clear();
      frameCbs.clear();
      state.clear();
      invalidate = null;
    },
  };
}
