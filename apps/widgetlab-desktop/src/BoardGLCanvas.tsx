/**
 * `BoardGLCanvas` — the board's R3F root, and the ONE GL wiring the product and
 * the `app` rig both mount (design-013 §8 C0).
 *
 * It exists as a component rather than as JSX inside `App` for the reason
 * `docs/UI_SYSTEM.md` gives about catalogs: a harness that mounts a COPY of the
 * shipping markup grades the copy. The `composited-app` rig seeds the real board
 * and mounts THIS, so what it measures — the lit node materials, the PMREM
 * environment, the StrictMode renderer census — is what the product runs.
 *
 * ── The two arms (D-C0.1 / D-C0.2) ─────────────────────────────────────────
 *
 * With a device (`gpu`), the Canvas is built on `islandRendererFactory({ device })`
 * — three adopts the app-owned device, `IslandRender` renders into the private
 * target Residency named, and the ground samples it. Without one, the Canvas keeps
 * the plain WebGL props the stratified profile has always used. Both arms are
 * live: this package's headless tests mount `<App/>` with no device at all.
 *
 * The branch that decides the environment generator is the BACKEND, not the
 * profile: `three`'s `PMREMGenerator` reads `renderer.state.buffers` in
 * `fromScene`, and a `WebGPURenderer` has no `.state` — which is precisely how
 * B8's attempt died ("Cannot read properties of undefined (reading 'buffers')").
 * `three/webgpu` ships its own `PMREMGenerator` with the same
 * `constructor(renderer)` / `fromScene(scene, sigma, near, far, options)` surface,
 * and it throws a NAMED error if it is called before `await renderer.init()`.
 * Ordering is already safe: `islandRendererFactory` awaits `init()` before it
 * returns, and R3F 9.6.1 awaits an async `gl` factory before committing children,
 * so `EnvLoader`'s memo cannot run early. `RoomEnvironment` is a legal scene for
 * either generator — it is built only from `MeshStandardMaterial`,
 * `MeshLambertMaterial` and `PointLight`, and `three` and `three/webgpu` share
 * `three.core.js`, so those classes are the same objects on both sides.
 *
 * ── The renderer lease (D-C0.4) ────────────────────────────────────────────
 *
 * `main.tsx` mounts in `<StrictMode>`, and R3F never disposes a renderer at all:
 * `unmountComponentAtNode` touches only `renderLists` and `forceContextLoss`, and a
 * WebGPU renderer has neither. So an unmounted board canvas would leave a
 * `WebGPURenderer` parked on the app-owned device for the life of the process.
 *
 * The factory is therefore LEASED. It is released when the component unmounts and
 * the renderer is disposed then, which is safe on an INJECTED device: three destroys
 * the device only when it made it (`WebGPUBackend.js:2903-2907` in three 0.185.1 —
 * `if (this.parameters.device === undefined && this.device !== null)`), the ownership
 * direction design-012 §4 wants. The disposal is deferred by a task so StrictMode's
 * cleanup-then-remount re-retains the lease instead of killing a live renderer, and a
 * build that resolves after the last release is disposed on arrival — the "renderer
 * whose Canvas is gone" case. `lease.census()` is the count the `app` rig grades, and
 * a mutation probe (dropping the `dispose()` in `sweep`) turns that rig red.
 *
 * Three corrections at C4c, from the Phase C review:
 *
 *  · the RESOLVE GUARD was `everRetained && retained === 0`, which a remount defeats:
 *    a real unmount sweeps (nulling `pending`) while build A is in flight, the remount
 *    retains and builds B, and A then resolves with `retained === 1` and is KEPT —
 *    until B overwrites it, unreferenced and never disposed. Every build now carries a
 *    GENERATION and the sweep count it started under: a build that is not the latest,
 *    or that spans a sweep, is dropped on arrival whatever `retained` says.
 *  · the lease is keyed on the DEVICE and rebuilt when it changes (D-C0.2's "stable
 *    factory" read the device once), with `dispose()` ending it.
 *  · the census counters were MODULE GLOBALS, so a second mount stomped the first's
 *    numbers. They live on the lease (and the env slot), and the rigs read them
 *    through the `onInstruments` hook — per mount, un-stompable.
 *
 * The pending promise is ALSO memoised, and that half is a guard this host does not
 * exercise — said plainly rather than claimed. R3F's Canvas re-runs `configure()` on
 * every render with no dependency array and its "set up renderer (one time only!)"
 * check is `if (!state.gl)`, which an async factory cannot satisfy while it is still
 * in flight; two overlapping `configure()` calls would build two renderers. On this
 * machine they never overlap, because `configure()` is gated on
 * `containerRect.width > 0` (`react-three-fiber.esm.js:64`) and `useMeasure` reports
 * zero until its ResizeObserver fires — after StrictMode's double invoke is over.
 * Verified: removing the memo leaves the rig GREEN (mutation probe P3, 2026-09-07).
 * The memo stays because the race is in R3F's code, not because a witness caught it.
 */
import type { Engine, EngineGpu, WidgetMountStore } from "@ice/core";
import {
  GLViews,
  hasWebGpuBackend,
  type GLBridge,
  type GlFrameStats,
  type IslandRender,
} from "@ice/r3f";
import { islandRendererFactory } from "@ice/r3f/webgpu";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { PMREMGenerator as WebGLPMREMGenerator, type Texture, type WebGLRenderer } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { PMREMGenerator as WebGPUPMREMGenerator, type Renderer, type WebGPURenderer } from "three/webgpu";

/** The stratified arm's `gl` props — a module constant so its identity is stable. */
const STRATIFIED_GL = { alpha: true, antialias: false } as const;

// --- the island renderer census (D-C0.4's witness) --------------------------

export interface IslandRendererCensus {
  /** `WebGPURenderer`s this lease built for its board canvas. */
  readonly created: number;
  /** …and disposed, when their Canvas went away or a newer build replaced them. */
  readonly disposed: number;
  /** The difference — the leak, if there is one. */
  readonly live: number;
}

const NO_RENDERERS: IslandRendererCensus = { created: 0, disposed: 0, live: 0 };

export interface IslandGlLease {
  /** The R3F `gl` factory — ONE renderer per lease, however often R3F asks. */
  readonly gl: () => Promise<WebGPURenderer>;
  /** The device its renderers are built on: the key the component rebuilds the lease against. */
  readonly device: GPUDevice;
  retain(): void;
  release(): void;
  /** End the lease: the renderer disposed now, an in-flight build disposed on arrival. */
  dispose(): void;
  /** This lease's renderers, built vs disposed. A StrictMode double mount must not move `live`. */
  census(): IslandRendererCensus;
}

/**
 * `build` is injectable for the unit tests (`test/island-gl-lease.test.ts`), which
 * drive the retain/release/resolve orderings a physical rig can only observe the
 * outcome of. The default is the real one, built ONCE per lease.
 */
export function createIslandGlLease(
  device: GPUDevice,
  build: () => Promise<WebGPURenderer> = islandRendererFactory({ device }),
): IslandGlLease {
  let pending: Promise<WebGPURenderer> | null = null;
  let renderer: WebGPURenderer | null = null;
  let retained = 0;
  /** Until the first mount retains, `retained === 0` means "not mounted yet", not "gone". */
  let everRetained = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let created = 0;
  let disposed = 0;
  /** Every build's number. Only the LATEST may install its renderer (the remount leak). */
  let builds = 0;
  /** Bumped by every sweep and by `dispose` — a build that spans one is stale. */
  let sweeps = 0;
  let ended = false;

  const drop = (r: WebGPURenderer): void => {
    r.dispose();
    disposed += 1;
  };

  const clear = (): void => {
    pending = null; // a later mount builds a fresh one
    const r = renderer;
    renderer = null;
    if (r !== null) drop(r);
  };

  const sweep = (): void => {
    timer = undefined;
    if (retained > 0) return; // re-retained inside the deferral: StrictMode's remount
    sweeps += 1;
    clear();
  };

  return {
    device,
    gl: () => {
      if (pending === null) {
        const gen = ++builds;
        const sweptAt = sweeps;
        const p: Promise<WebGPURenderer> = build().then((r) => {
          created += 1;
          // Keep it only if it is still THE build: nothing newer started, no sweep (a
          // real unmount) since it began, the lease alive, and a Canvas still holding
          // it. `retained` alone is not enough — a remount re-retains, and the review's
          // leak is exactly a stale build passing that test and then being overwritten.
          const stale = gen !== builds || sweeps !== sweptAt || ended || (everRetained && retained === 0);
          if (stale) {
            if (pending === p) pending = null;
            drop(r);
            return r;
          }
          renderer = r;
          return r;
        });
        pending = p;
      }
      return pending;
    },
    retain: () => {
      everRetained = true;
      retained += 1;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
    release: () => {
      retained -= 1;
      if (retained <= 0 && timer === undefined) timer = setTimeout(sweep, 0);
    },
    dispose: () => {
      ended = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      sweeps += 1;
      clear();
    },
    census: () => ({ created, disposed, live: created - disposed }),
  };
}

// --- the environment --------------------------------------------------------

/**
 * What a PMREM generator hands back: the render TARGET, which the CALLER owns.
 * three 0.185.1's `PMREMGenerator.fromScene` allocates a `cubeUVRenderTarget`
 * (`PMREMGenerator.js:157,173`) and its own `dispose()` frees the generator's
 * internals only (`:333-346`), so taking `.texture` and dropping the reference —
 * what this file did until C4c — leaks a render target per Canvas mount, on the
 * APP-OWNED device since C0, where it lives for the process.
 */
export interface EnvTarget {
  readonly texture: Texture;
  dispose(): void;
}

/** Build the environment on whatever backend this renderer is: the branch is D-C0.1's. */
export type EnvGenerator = (gl: unknown) => { readonly backend: "webgpu" | "webgl"; readonly target: EnvTarget };

/**
 * v1's `r3fRoot={<Environment preset="apartment"/>}` equivalent — but
 * DETERMINISTIC: three's built-in RoomEnvironment through PMREM instead of
 * drei's CDN HDR (a slow/blocked fetch left the metallic cards silhouetted —
 * field-verified 2026-07-12). Near-identical neutral studio look, zero
 * network. `<GLViews environment>` stamps it on every island scene.
 */
export const roomEnvGenerator: EnvGenerator = (gl) => {
  const room = new RoomEnvironment();
  if (hasWebGpuBackend(gl)) {
    const pmrem = new WebGPUPMREMGenerator(gl as unknown as Renderer);
    const target = pmrem.fromScene(room, 0.04);
    pmrem.dispose();
    return { backend: "webgpu", target };
  }
  const pmrem = new WebGLPMREMGenerator(gl as WebGLRenderer);
  const target = pmrem.fromScene(room, 0.04);
  pmrem.dispose();
  return { backend: "webgl", target };
};

export interface EnvTargetCensus {
  readonly created: number;
  readonly disposed: number;
}

/** One Canvas's environment: at most one live target, disposed when the renderer changes or the Canvas goes. */
export interface EnvSlot {
  /** Build for this renderer, disposing whatever the slot held. Returns the texture `<GLViews environment>` takes. */
  acquire(gl: unknown): Texture;
  /** Dispose the target behind `texture` — a no-op once a newer `acquire` has replaced it. */
  release(texture: Texture): void;
  /** Which generator the slot took (D-C0.1's witness); `null` before the first acquire. */
  backend(): "webgpu" | "webgl" | null;
  census(): EnvTargetCensus;
}

/** `make` is injectable for the unit test, which needs a target whose `dispose` it can see. */
export function createEnvSlot(make: EnvGenerator = roomEnvGenerator): EnvSlot {
  let current: EnvTarget | null = null;
  let backend: "webgpu" | "webgl" | null = null;
  let created = 0;
  let disposed = 0;
  const dropCurrent = (): void => {
    if (current === null) return;
    current.dispose();
    current = null;
    disposed += 1;
  };
  return {
    acquire: (gl) => {
      dropCurrent(); // a renderer change, or StrictMode's second render-phase call
      const built = make(gl);
      backend = built.backend;
      current = built.target;
      created += 1;
      return built.target.texture;
    },
    release: (texture) => {
      // The effect cleanup for a SUPERSEDED texture must not free the live one: on a
      // `gl` change React runs the new render (a fresh acquire) BEFORE the old
      // effect's cleanup.
      if (current === null || current.texture !== texture) return;
      dropCurrent();
    },
    backend: () => backend,
    census: () => ({ created, disposed }),
  };
}

/** Exported for `test/board-gl-canvas.test.tsx`: the cleanup that frees the target is the fix, and it lives here. */
export function EnvLoader({ slot, onTex }: { slot: EnvSlot; onTex: (t: Texture | null) => void }): null {
  const gl = useThree((s) => s.gl);
  const tex = useMemo(() => slot.acquire(gl), [gl, slot]);
  useEffect(() => {
    onTex(tex);
    return () => {
      onTex(null);
      slot.release(tex); // the TARGET, not just the reference (C4c)
    };
  }, [tex, onTex, slot]);
  return null;
}

// --- the component ----------------------------------------------------------

export interface BoardGLCanvasProps {
  /** The runtime engine `<GLViews>` reads islands from (`ce.engine`, never the facade). */
  readonly engine: Engine;
  readonly bridge: GLBridge;
  readonly store: WidgetMountStore;
  /**
   * The P2 plane the canvas portals into. Must be a descendant of
   * `<InfiniteCanvas>`'s container AND rendered as its child, so `GLViews` reads
   * the ground's content seam off the React context rather than running the
   * stratified path under a composited profile.
   */
  readonly plane: HTMLElement;
  /** The app-owned device (design-012 §4). Present ⇒ the composited arm. */
  readonly gpu?: EngineGpu;
  readonly onFrameStats?: (stats: GlFrameStats) => void;
  /** Composited only: the `IslandRender` this mount installed — the rig's instruments. */
  readonly onIslandRender?: (render: IslandRender | null) => void;
  /** This MOUNT's GPU-object census — the rigs' witness (C4c: never module globals). `null` on unmount. */
  readonly onInstruments?: (instruments: BoardGlInstruments | null) => void;
}

/** What one board Canvas mount built and freed, per object class the review found leaking. */
export interface BoardGlInstruments {
  /** The lease's renderers. Two mounts have two of these; neither stomps the other. */
  census(): IslandRendererCensus;
  /** The device the current lease is on — the key it is rebuilt against; `undefined` on the stratified arm. */
  device(): GPUDevice | undefined;
  /** Which PMREM generator this mount took (D-C0.1) — `null` until the Canvas commits. */
  envBackend(): "webgpu" | "webgl" | null;
  /** PMREM render targets built vs disposed by this mount. */
  envTargets(): EnvTargetCensus;
}

export function BoardGLCanvas({
  engine,
  bridge,
  store,
  plane,
  gpu,
  onFrameStats,
  onIslandRender,
  onInstruments,
}: BoardGLCanvasProps): ReactElement {
  const [envTex, setEnvTex] = useState<Texture | null>(null);
  // The lease is born in render because the `gl` prop needs it before any effect
  // runs; `everRetained` is what keeps that gap from looking like a teardown. It is
  // keyed on the DEVICE (C4c): a device change ends the old lease — disposing its
  // renderer — rather than leaving it parked on a device nothing draws to.
  const leaseRef = useRef<IslandGlLease | null>(null);
  if (gpu === undefined) {
    if (leaseRef.current !== null) {
      leaseRef.current.dispose();
      leaseRef.current = null;
    }
  } else if (leaseRef.current === null || leaseRef.current.device !== gpu.device) {
    leaseRef.current?.dispose();
    leaseRef.current = createIslandGlLease(gpu.device);
  }
  const lease = leaseRef.current;
  useEffect(() => {
    if (lease === null) return;
    lease.retain();
    return () => lease.release();
  }, [lease]);

  // One environment slot per mount, so its target census cannot be stomped either.
  const envSlot = useMemo(() => createEnvSlot(), []);
  const instruments = useMemo<BoardGlInstruments>(
    () => ({
      // Through the ref, not the render-time `lease`: the rig reads the census AFTER
      // the deferred sweep, and (on a device change) off whichever lease is current.
      census: () => leaseRef.current?.census() ?? NO_RENDERERS,
      device: () => leaseRef.current?.device,
      envBackend: () => envSlot.backend(),
      envTargets: () => envSlot.census(),
    }),
    [envSlot],
  );
  useEffect(() => {
    if (onInstruments === undefined) return;
    onInstruments(instruments);
    return () => onInstruments(null);
  }, [instruments, onInstruments]);

  return createPortal(
    /* Canvas pointerEvents none is LOAD-BEARING (glboard precedent): without it
       the R3F canvas swallows every pointer event over the whole viewport — DOM
       widgets lose hover/click while the engine keeps working via container
       bubbling (field report 2026-07-12). Under the composited arm this canvas
       also never PRESENTS: three paints into render targets only, and the
       compositor's own canvas is what shows. */
    <Canvas
      orthographic
      frameloop="never"
      gl={lease !== null ? lease.gl : STRATIFIED_GL}
      style={{ pointerEvents: "none", position: "absolute", inset: 0 }}
    >
      <EnvLoader slot={envSlot} onTex={setEnvTex} />
      <GLViews
        engine={engine}
        bridge={bridge}
        store={store}
        environment={envTex}
        {...(onFrameStats !== undefined ? { onFrameStats } : {})}
        {...(onIslandRender !== undefined ? { onIslandRender } : {})}
      />
    </Canvas>,
    plane,
  );
}
