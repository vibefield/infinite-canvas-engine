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
 * the device only when it made it (`WebGPUBackend.js:2902-2906`), the ownership
 * direction design-012 §4 wants. The disposal is deferred by a task so StrictMode's
 * cleanup-then-remount re-retains the lease instead of killing a live renderer, and a
 * build that resolves after the last release is disposed on arrival — the "renderer
 * whose Canvas is gone" case. `islandRendererCensus()` is the process-wide count the
 * `app` rig grades, and a mutation probe (dropping the `dispose()` in `sweep`) turns
 * that rig red.
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
import { PMREMGenerator as WebGLPMREMGenerator, type Texture } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { PMREMGenerator as WebGPUPMREMGenerator, type Renderer, type WebGPURenderer } from "three/webgpu";

/** The stratified arm's `gl` props — a module constant so its identity is stable. */
const STRATIFIED_GL = { alpha: true, antialias: false } as const;

// --- the island renderer census (D-C0.4's witness) --------------------------

let renderersCreated = 0;
let renderersDisposed = 0;

export interface IslandRendererCensus {
  /** `WebGPURenderer`s this process built for a board canvas. */
  readonly created: number;
  /** …and disposed, when their Canvas went away. */
  readonly disposed: number;
  /** The difference — the leak, if there is one. */
  readonly live: number;
}

/** Renderers built vs disposed since load. A StrictMode double mount must not move `live`. */
export function islandRendererCensus(): IslandRendererCensus {
  return { created: renderersCreated, disposed: renderersDisposed, live: renderersCreated - renderersDisposed };
}

interface IslandGlLease {
  /** The R3F `gl` factory — ONE renderer per lease, however often R3F asks. */
  readonly gl: () => Promise<WebGPURenderer>;
  retain(): void;
  release(): void;
}

function createIslandGlLease(device: GPUDevice): IslandGlLease {
  const build = islandRendererFactory({ device });
  let pending: Promise<WebGPURenderer> | null = null;
  let renderer: WebGPURenderer | null = null;
  let retained = 0;
  /** Until the first mount retains, `retained === 0` means "not mounted yet", not "gone". */
  let everRetained = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const drop = (r: WebGPURenderer): void => {
    r.dispose();
    renderersDisposed += 1;
  };

  const sweep = (): void => {
    timer = undefined;
    if (retained > 0) return; // re-retained inside the deferral: StrictMode's remount
    pending = null; // a later mount builds a fresh one
    const r = renderer;
    renderer = null;
    if (r !== null) drop(r);
  };

  return {
    gl: () => {
      if (pending === null) {
        pending = build().then((r) => {
          renderersCreated += 1;
          if (everRetained && retained === 0) {
            // Resolved after the Canvas went away. R3F's root is unmounted and will
            // never render with this; keeping it would park a renderer on the shared
            // device forever.
            pending = null;
            drop(r);
            return r;
          }
          renderer = r;
          return r;
        });
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
  };
}

// --- the environment --------------------------------------------------------

/** Which generator the last `EnvLoader` memo took — the rig's witness for D-C0.1. */
let envBackendTaken: "webgpu" | "webgl" | null = null;

/** `"webgpu"` once the composited arm's PMREM has run; `null` before any island canvas mounts. */
export function envGeneratorBackend(): "webgpu" | "webgl" | null {
  return envBackendTaken;
}

/**
 * v1's `r3fRoot={<Environment preset="apartment"/>}` equivalent — but
 * DETERMINISTIC: three's built-in RoomEnvironment through PMREM instead of
 * drei's CDN HDR (a slow/blocked fetch left the metallic cards silhouetted —
 * field-verified 2026-07-12). Near-identical neutral studio look, zero
 * network. `<GLViews environment>` stamps it on every island scene.
 */
function EnvLoader({ onTex }: { onTex: (t: Texture | null) => void }): null {
  const gl = useThree((s) => s.gl);
  const tex = useMemo(() => {
    const room = new RoomEnvironment();
    if (hasWebGpuBackend(gl)) {
      envBackendTaken = "webgpu";
      const pmrem = new WebGPUPMREMGenerator(gl as unknown as Renderer);
      const t = pmrem.fromScene(room, 0.04).texture;
      pmrem.dispose();
      return t;
    }
    envBackendTaken = "webgl";
    const pmrem = new WebGLPMREMGenerator(gl);
    const t = pmrem.fromScene(room, 0.04).texture;
    pmrem.dispose();
    return t;
  }, [gl]);
  useEffect(() => {
    onTex(tex);
    return () => onTex(null);
  }, [tex, onTex]);
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
}

export function BoardGLCanvas({
  engine,
  bridge,
  store,
  plane,
  gpu,
  onFrameStats,
  onIslandRender,
}: BoardGLCanvasProps): ReactElement {
  const [envTex, setEnvTex] = useState<Texture | null>(null);
  // The lease is born in render because the `gl` prop needs it before any effect
  // runs; `everRetained` is what keeps that gap from looking like a teardown.
  const leaseRef = useRef<IslandGlLease | null>(null);
  if (gpu !== undefined && leaseRef.current === null) leaseRef.current = createIslandGlLease(gpu.device);
  const lease = leaseRef.current;
  useEffect(() => {
    if (lease === null) return;
    lease.retain();
    return () => lease.release();
  }, [lease]);

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
      <EnvLoader onTex={setEnvTex} />
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
