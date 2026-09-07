/**
 * GLViews — the P2 root (design-004 §1/§3). Mount ONE inside an R3F
 * `<Canvas frameloop="never">` that the app positions as the GL-views plane
 * (absolute inset-0, `pointer-events: none` — the router owns GL hit
 * testing; the canvas element never sees pointers).
 *
 * `frameloop="never"` is the contract (design-004 §3 amendment, 2026-07-20):
 * frames are driven by the ENGINE's reflect phase — the bridge's `r3fAdvance`
 * reflector calls R3F `advance()` synchronously in the same task the DOM
 * reflectors write their transforms, so card chrome and GL content present
 * the same camera every frame. A self-scheduling loop ("demand"/"always")
 * renders on its own rAF, out of phase with the DOM planes — field-measured
 * as a permanent one-frame smear under fast pans.
 *
 * Mount with `gl={{ alpha: true, antialias: false }}`: the composite pass
 * draws only textured quads whose corners are shader-rounded ALPHA, not
 * geometry, so backbuffer MSAA buys nothing — and at fullscreen dpr 2 it
 * costs ~21 % of the GPU frame (2026-07-14 A/B). Island edges keep their own
 * MSAA 4 inside the FBOs (pool.ts), which is where the 3D geometry lives.
 *
 * Owns everything whose lifetime IS the GL context's: the FBO pool, the
 * shared unit-quad geometry, the per-widget composite quads, the composite
 * camera, and the priority-1 `useFrame` that runs `runCompositorPass` (which
 * suppresses R3F's default render — the pass owns the whole frame). Island
 * membership mirrors `WidgetRoot`: the same widget mount store, filtered to
 * `surface: "gl"`, hidden (culled) entries unmounted — their FBOs stay
 * pooled, that's the retention decoupling.
 *
 * StrictMode/HMR: pool + quads are lazy-init'd and re-created if a previous
 * instance was disposed (v1 lesson — cleanup-then-remount reuses the
 * component instance, so refs may point at disposed objects).
 */
import { useFrame, useThree } from "@react-three/fiber";
import {
  createElement,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactElement,
} from "react";
import {
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  type Texture,
  type WebGLRenderTarget,
} from "three";
import { selectBand } from "@ice/kernel";
import {
  Camera,
  Culled,
  PrefabId,
  RUNTIME_BUDGETS,
  Visible,
  defineQuery,
  widgets,
  type Engine,
  type Entity,
  type GpuAllocatorHandle,
  type WidgetMountStore,
} from "@ice/core";
import { useSurfaceContent } from "@ice/react";
import type { GLBridge } from "./bridge";
import { CompositeMaterial } from "./composite-material";
import {
  runCompositorPass,
  type GlLike,
  type QuadLike,
  type QuadsLike,
  type TargetLike,
} from "./compositor-pass";
import { GL_PLANE_ADAPTER } from "./gl-plane";
import { createIslandRender, type IslandRender } from "./island-render";
import { Island } from "./island";
import { RenderTargetPool } from "./pool";
import { selfSustainPlan } from "./self-sustain";
import { hasWebGpuBackend, type WebGpuRendererLike } from "./webgpu-backend";

export interface GLViewsProps {
  readonly engine: Engine;
  readonly bridge: GLBridge;
  readonly store: WidgetMountStore;
  /** FBO byte budget (default `RUNTIME_BUDGETS.fboBytes`, 256 MB). */
  readonly maxFboBytes?: number;
  /** Repaint stagger per composited frame (v1 default 4). */
  readonly maxRepaintsPerFrame?: number;
  /**
   * Ambient-animation rate cap (default 60; `Infinity` = uncapped). Applies
   * ONLY to self-sustained frames — Hot islands and stagger backlogs park the
   * loop between paints instead of spinning at native refresh (5 Hot islands
   * at 120 Hz dpr-2 measured 96 % GPU duty at idle, 2026-07-14). Lift eases
   * and externally invalidated frames (camera, drags, props dirt) still run
   * at display rate. Approximate: frames land on the vsync grid.
   */
  readonly maxAnimationFps?: number;
  /**
   * Idle paint-DPR ceiling (default 1.5; `Infinity` = uncapped): island FBOs
   * allocate at `min(pixelRatio, maxPaintDpr) × band`. On dpr-2 displays the
   * composite's bilinear upscale from 1.5× is visually indistinguishable
   * (2026-07-14 A/B) and cuts Hot repaint cost ~22 %.
   */
  readonly maxPaintDpr?: number;
  /**
   * Shared IBL: stamped as `scene.environment` on EVERY island's private
   * scene (arrival/change repaints all islands). Load it app-side (e.g.
   * drei's useEnvironment in a Suspense boundary) — undefined until then is
   * fine; islands paint unlit-by-IBL and repaint when it lands.
   */
  readonly environment?: Texture | null;
  /**
   * GL frame profiling (2026-07-13): fires once per composited frame with the
   * pass's real costs. CPU/counts/pass-shape are engine-measured every
   * profiled frame; GPU ms rides stats-gl's headless `StatsProfiler`
   * (EXT_disjoint_timer_query / WebGPU timestamps — 0 where unsupported, e.g.
   * Safari without its flag), DYNAMICALLY imported on first use so the
   * dependency costs nothing when profiling is off. Feed the numbers to the
   * devtools profiler HUD as lanes (`devtools.lane("gpu", s.gpuMs)`).
   */
  readonly onFrameStats?: (stats: GlFrameStats) => void;
  /**
   * COMPOSITED-NEXT ONLY (design-013 §8 B5). Handed the IslandRender this mount installed
   * into the ground's `renders.island` slot, and `null` on teardown — the instruments
   * (`stats()`, `targetOf()`) a rig grades the leg with. There is no equivalent for the old
   * profiles: their island targets belong to a pool this component owns.
   */
  readonly onIslandRender?: (render: IslandRender | null) => void;
}

/**
 * One profiled composite frame — see {@link GLViewsProps.onFrameStats}.
 * MIRRORED structurally as `GlPanelStats` in @ice/devtools (which cannot
 * import r3f under the walls) — keep the shapes aligned.
 */
export interface GlFrameStats {
  /** Whole-pass main-thread ms (reconcile + island paints + composite). */
  readonly cpuMs: number;
  /** GPU ms summed across the pass's render calls (0 until queries resolve / unsupported). */
  readonly gpuMs: number;
  /** stats-gl smoothed fps (0 until the profiler is live). */
  readonly fps: number;
  /** `renderer.info` aggregated across ALL of this pass's render calls. */
  readonly drawCalls: number;
  readonly triangles: number;
  readonly points: number;
  readonly lines: number;
  /** Live compiled shader programs (renderer-lifetime, not per-frame). */
  readonly programs: number;
  readonly geometries: number;
  readonly textures: number;
  /** Virtual texturing: live island render targets + their summed resolution. */
  readonly renderTargets: number;
  readonly renderMegaPixels: number;
  readonly fboBytes: number;
  readonly fboBudgetBytes: number;
  /** Island phase census (the demand/retention state machine, design-004 §3/§7). */
  readonly islands: {
    readonly total: number;
    readonly hot: number;
    readonly warm: number;
    readonly waking: number;
    readonly cold: number;
    readonly dormant: number;
  };
  /** Live targets per painted zoom band ("×1", "×0.5", …) — the LOD downgrade census. */
  readonly bandHistogram: Readonly<Record<string, number>>;
  /** This pass's shape (PassStats). */
  readonly repainted: number;
  readonly pendingPaints: number;
  readonly evicted: number;
  /** LOD context: camera zoom → hysteresis band → the DPR new paints get. */
  readonly zoom: number;
  readonly band: number;
  readonly effectiveDpr: number;
  /** Scene population: Visible vs Culled widgets (all surfaces). */
  readonly visibleWidgets: number;
  readonly culledWidgets: number;
}

/** The slice of stats-gl's StatsProfiler we drive (structural — the import is dynamic). */
interface GpuProfilerLike {
  update(): void;
  getData(): { fps: number; cpu: number; gpu: number };
  dispose(): void;
}

// Scene-population census (profiling only — never queried when the seam is off).
const visibleWidgetsQ = defineQuery([Visible]);
const culledWidgetsQ = defineQuery([Culled]);
let allocatorSequence = 0;

export function GLViews({
  engine,
  bridge,
  store,
  maxFboBytes = RUNTIME_BUDGETS.fboBytes,
  maxRepaintsPerFrame = 4,
  maxAnimationFps = 60,
  maxPaintDpr = 1.5,
  environment,
  onFrameStats,
  onIslandRender,
}: GLViewsProps): ReactElement {
  const world = engine.world;
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const set = useThree((s) => s.set);
  const advance = useThree((s) => s.advance);
  const frameloop = useThree((s) => s.frameloop);
  const clock = useThree((s) => s.clock);

  // THE COMPOSITED PROFILE (design-013 §8 B5). The ground's content seam, published by
  // <InfiniteCanvas> when the mounted layer is `groundCompose(…)`. Present ⇒ this GLViews
  // renders islands into the PRIVATE targets Residency named and installs itself in the
  // roster's island slot; there is no pool, no quad, no source binder and no frame pass here,
  // because the ground's GpuCompose owns the one present.
  //
  // Latched at the FIRST render: an app cannot legitimately switch profiles at runtime,
  // and half-switching mid-frame would strand a pool against a slot. The
  // context is published in the same batch as `onReady`, which is where the wall makes an app
  // mount its GL root — a mount that beats it gets the loud refusal below rather than a
  // plausible board drawn twice.
  const contentFromContext = useSurfaceContent();
  const contentRef = useRef(contentFromContext);
  const content = contentRef.current;
  const nextProfile = content !== undefined;

  // --- context-lifetime resources (lazy + disposed-aware, v1 pattern) ------
  // The renderer arrives asynchronously (R3F awaits three's `init()` before it
  // commits), so the WebGPU pool reads it through a getter rather than
  // capturing it — a value read at construction would be undefined forever.
  const glRef = useRef(gl);
  glRef.current = gl;
  const poolRef = useRef<RenderTargetPool | null>(null);
  if (!nextProfile && (poolRef.current === null || poolRef.current.isDisposed())) {
    poolRef.current = new RenderTargetPool();
  }
  // `null` under the composited profile: an island target there is keyed by the Residency
  // HANDLE the world names, so there is nothing for a pool to key, evict or pin
  // (design-013 §4).
  const pool = poolRef.current;

  // The silent-stratified trap, one layer in (§11 Q2): a WebGL renderer under
  // this profile renders islands into targets nothing can sample, and an empty
  // ground draws a perfectly plausible blank. Say so loudly.
  useEffect(() => {
    if (!nextProfile) return;
    if (!hasWebGpuBackend(gl)) {
      console.error(
        "[ice/r3f] GLViews is under the composited profile but the Canvas renderer has no WebGPU " +
          "backend — an island target will never resolve a GPUTexture and the ground will draw " +
          "nothing. Build the Canvas with islandRendererFactory({ device: engine.compositorDevice.device }) " +
          "from @ice/r3f/webgpu.",
      );
    }
  }, [nextProfile, gl]);

  // The mirror trap: a GL root that mounted BEFORE the ground published its content seam
  // would run the legacy path forever under a profile that has no compositor to draw it —
  // invisible in a screenshot, which is the class §7 of design-013 names. Say so.
  useEffect(() => {
    if (contentFromContext !== undefined && !nextProfile) {
      console.error(
        "[ice/r3f] GLViews mounted before <InfiniteCanvas> published the ground's content " +
          "residency, so it is running the stratified path under the composited profile. " +
          "Mount the <Canvas>/<GLViews> tree from InfiniteCanvas's onReady callback.",
      );
    }
  }, [contentFromContext, nextProfile]);
  const incomingOpacityRef = useRef(1);
  const allocatorHandleRef = useRef<GpuAllocatorHandle | null>(null);
  const allocatorId = useMemo(() => `@ice/r3f/pool:${++allocatorSequence}`, []);

  const quadGeometry = useMemo(() => new PlaneGeometry(1, 1), []);
  const compCamera = useMemo(() => new OrthographicCamera(0, 1, 0, -1, 0.1, 10000), []);

  // Make the composite camera the Canvas default so R3F utilities that read
  // `state.camera` (raycaster defaults etc.) have a sensible reference.
  useEffect(() => {
    set({ camera: compCamera as unknown as never });
  }, [set, compCamera]);

  // Composite quads: engine-neutral meshes in the default scene ({opacity}
  // is the whole per-widget composite fact; app looks are app hooks).
  const quadsRef = useRef(new Map<number, Mesh>());
  const quads: QuadsLike = useMemo(
    () => ({
      ensure(key: number): QuadLike {
        let mesh = quadsRef.current.get(key);
        if (mesh === undefined) {
          mesh = new Mesh(quadGeometry, new CompositeMaterial());
          mesh.frustumCulled = false;
          mesh.visible = false; // hidden until the island has painted once
          scene.add(mesh);
          quadsRef.current.set(key, mesh);
        }
        const m = mesh;
        return {
          setTransform: (x, y, sx, sy) => {
            m.position.set(x, y, 0);
            m.scale.set(sx, sy, 1);
          },
          setTexture: (t) => (m.material as CompositeMaterial).setMap(t as WebGLRenderTarget["texture"]),
          setVisible: (v) => {
            m.visible = v;
          },
          setRenderOrder: (n) => {
            m.renderOrder = n;
          },
          setOpacity: (o) => (m.material as CompositeMaterial).setOpacity(o),
          setDragClip: (minX, minY, maxX, maxY, exempt) => {
            const mat = m.material as CompositeMaterial;
            mat.setDraggedRect(minX, minY, maxX, maxY);
            mat.setIsDragged(exempt);
          },
        };
      },
      remove(key: number) {
        const mesh = quadsRef.current.get(key);
        if (mesh !== undefined) {
          scene.remove(mesh);
          (mesh.material as CompositeMaterial).dispose();
          quadsRef.current.delete(key);
        }
      },
      keys: () => [...quadsRef.current.keys()],
    }),
    [scene, quadGeometry],
  );

  useEffect(() => {
    const ledger = bridge.gpu;
    if (ledger === undefined || pool === null) return;
    const handle = ledger.registerAllocator({
      id: allocatorId,
      usedBytes: () => pool.bytesUsed(),
      reclaim(bytesNeeded) {
        let reclaimed = 0;
        const candidates = pool
          .entryInfos()
          .filter((info) => {
            if (info.pinned) return false;
            return (bridge.state.get(info.key)?.phase ?? "Dormant") === "Dormant";
          })
          .sort((a, b) => a.lastUsedMs - b.lastUsedMs || a.key - b.key);
        for (const candidate of candidates) {
          if (reclaimed >= bytesNeeded) break;
          if (!pool.release(candidate.key)) continue;
          bridge.state.markEvicted(candidate.key);
          reclaimed += candidate.bytes;
        }
        if (reclaimed > 0) bridge.requestFrame();
        return reclaimed;
      },
    });
    allocatorHandleRef.current = handle;
    return () => {
      allocatorHandleRef.current = null;
      handle.unregister();
    };
  }, [allocatorId, bridge, pool]);

  // THE RETAINED-QUAD TRANSITION ADAPTER IS GONE (B8, design-013 §8). It built
  // the outgoing frame of a nav flight out of retained composite MESHES in this
  // component's scene — a second presentation, only ever visible on the
  // stratified profile, and the thing design-013 §6/§7 replaced. On the
  // composited profile the departed frame is the ground's own second slot,
  // prepared from the world every frame (B7); the stratified profile has no
  // outgoing-quad transition: the stratified islands' outgoing quads stay OWED (design-013 D-C2.5).

  // Renderer adapter (explicit clear color: transparent black, v1 contract).
  const glLike: GlLike = useMemo(
    () => ({
      setRenderTarget: (t) => gl.setRenderTarget(t as WebGLRenderTarget | null),
      clear: () => {
        gl.setClearColor(0x000000, 0);
        gl.clear(true, true, false);
      },
      render: (s, c) => gl.render(s as never, c as never),
      setPixelRatio: (n) => gl.setPixelRatio(n),
      getPixelRatio: () => gl.getPixelRatio(),
    }),
    [gl],
  );

  // Wire the reflect-phase renderer for the life of this Canvas: the bridge's
  // r3fAdvance reflector calls this synchronously inside the engine flush.
  //
  // R3F's `frameloop="never"` clock contract (their loop.ts): the advance
  // timestamp IS the clock, in SECONDS — `delta = timestamp − clock.elapsedTime`
  // feeds useFrame directly. Passing milliseconds ran every island animation
  // ~1000× fast (field report 2026-07-20, minutes after the advance seam
  // landed). And `setFrameloop('never')` zeroes elapsedTime with the clock
  // stopped, so the FIRST advance would deliver the page's whole uptime as
  // one delta — seed elapsedTime to "now" so the first frame steps from ≈0.
  useEffect(() => {
    clock.elapsedTime = performance.now() / 1000;
    bridge.setRenderNow((nowMs) => advance(nowMs / 1000, true));
    return () => bridge.setRenderNow(null);
  }, [bridge, advance, clock]);

  // The frameloop contract is a prop on the app's <Canvas> — unenforceable
  // from here, so misconfiguration gets a loud DEV hint instead of a silent
  // return of the one-frame pan smear this seam exists to prevent.
  useEffect(() => {
    if (frameloop !== "never") {
      console.warn(
        `[ice/r3f] GLViews: <Canvas frameloop="${frameloop}"> — use frameloop="never". The engine drives frames (reflect-phase advance); a self-scheduling loop renders out of phase with the DOM planes.`,
      );
    }
  }, [frameloop]);

  // --- GL profiling (opt-in via onFrameStats) --------------------------------
  // The callback rides a ref (no useFrame re-subscribe); the GPU profiler is
  // dynamic-imported on first profiled frame. stats-gl's three-renderer init
  // PATCHES gl.render to bracket every call, so the pass's N island paints +
  // composite sum into one per-frame gpu figure.
  const statsCbRef = useRef(onFrameStats);
  statsCbRef.current = onFrameStats;
  /** Work the last pass left owed — the freeze settle's GL reporter reads it. */
  const paintsOwedRef = useRef(false);
  const gpuProfilerRef = useRef<GpuProfilerLike | null>(null);
  const gpuProfilerState = useRef<"idle" | "loading" | "ready" | "failed">("idle");
  useEffect(
    () => () => {
      gpuProfilerRef.current?.dispose();
      gpuProfilerRef.current = null;
      gpuProfilerState.current = "idle";
    },
    [],
  );

  // Teardown: quads + pool die with the context (island state survives in
  // the bridge — a remounted Canvas re-wakes islands from Waking).
  useEffect(() => {
    const quadMap = quadsRef.current;
    return () => {
      for (const mesh of quadMap.values()) {
        scene.remove(mesh);
        (mesh.material as CompositeMaterial).dispose();
      }
      quadMap.clear();
      pool?.dispose();
      for (const [key] of bridge.state.all()) bridge.state.markEvicted(key);
    };
  }, [scene, pool, bridge]);

  // The `gl` presentation plane (design-006 §9): owned by this component on BOTH profiles, prepared the
  // moment it is asked. The facade requires the plane for every mounted GL widget, so without an owner a
  // cross-type enter with any island is gated to a SNAP — which is what B8 left when it deleted the
  // retained-quad adapter that used to own it (B9 review blocker 5). Composited: the ground's departed
  // slot draws the islands from the residency. Stratified: the islands cut (their outgoing-quad
  // transition is owed, see the plan) — a flight with a cut is honest, a snap for a plane nobody draws is not.
  useEffect(() => bridge.transitions?.register(GL_PLANE_ADAPTER), [bridge]);

  // --- composited: the island render, in the roster's island slot ------
  // Installed as a REFLECTOR rather than driven from this component's frame loop
  // (design-013 §6, B5 R1): the profile forwards `renders.island` between DomRender and
  // VideoIngest, so three's submits land after the ECS has settled and before GpuCompose
  // samples them. Cleared on unmount, which also disposes every target it minted.
  const onIslandRenderRef = useRef(onIslandRender);
  onIslandRenderRef.current = onIslandRender;
  useEffect(() => {
    if (content === undefined) return;
    const render = createIslandRender({
      gl: {
        setRenderTarget: (t) => gl.setRenderTarget(t as WebGLRenderTarget | null),
        clear: () => {
          gl.setClearColor(0x000000, 0);
          gl.clear(true, true, false);
        },
        render: (sc, cam) => gl.render(sc as never, cam as never),
      },
      renderer: () => glRef.current as unknown as WebGpuRendererLike,
      bridge,
      world,
      content,
    });
    onIslandRenderRef.current?.(render);
    return () => {
      onIslandRenderRef.current?.(null);
      render.dispose();
    };
  }, [content, gl, bridge, world]);

  // The pass. Priority 1 suppresses R3F's default render — we own the frame.
  useFrame((_, delta) => {
    // COMPOSITED-NEXT: nothing to do here, and PRIORITY 1 is the point — it suppresses R3F's
    // default render, so the <Canvas> presents nothing of its own. The islands are rendered by
    // the reflector below, in the roster slot, before GpuCompose's submit.
    if (pool === null) return;
    const profiling = statsCbRef.current !== undefined;
    if (profiling) {
      if (gpuProfilerState.current === "idle") {
        gpuProfilerState.current = "loading";
        void import("stats-gl")
          .then(async ({ StatsProfiler }) => {
            const p = new StatsProfiler({ trackGPU: true }) as unknown as GpuProfilerLike & {
              init(renderer: unknown): Promise<void>;
            };
            await p.init(gl); // three-renderer init: patches gl.render to bracket every call
            gpuProfilerRef.current = p;
            gpuProfilerState.current = "ready";
          })
          .catch(() => {
            gpuProfilerState.current = "failed"; // headless / no WebGL2 — CPU + counts still report
          });
      }
      // Aggregate renderer.info across ALL of this pass's render calls (three's
      // default autoReset clears after EACH call — only the composite would count).
      gl.info.autoReset = false;
      gl.info.reset();
    } else if (!gl.info.autoReset) {
      gl.info.autoReset = true; // profiling stopped — restore vanilla three behavior
    }
    const passStart = performance.now(); // profiling cpuMs + the rate cap's schedule anchor
    bridge.renderAssert.begin();
    let stats: ReturnType<typeof runCompositorPass>;
    try {
      stats = runCompositorPass({
        world,
        bridge,
        pool,
        // The stratified present: reconcile composite meshes and render them to
        // the backbuffer. Under the composited profile this pass never runs —
        // IslandRender is installed in the roster's island slot instead.
        quads,
        gl: glLike,
        compCamera: {
          raw: compCamera, // the REAL camera — gl.render instanceof-checks it
          setFrustum: (f) => {
            compCamera.left = f.left;
            compCamera.right = f.right;
            compCamera.top = f.top;
            compCamera.bottom = f.bottom;
            compCamera.position.set(f.x, f.y, 1000);
            compCamera.updateProjectionMatrix();
          },
        },
        islandCamera: (entity) => {
          const handle = bridge.islandFor(entity);
          if (handle === undefined) return undefined;
          return {
            setFrustum: (halfW, halfH) => {
              handle.camera.left = -halfW;
              handle.camera.right = halfW;
              handle.camera.top = halfH;
              handle.camera.bottom = -halfH;
              handle.camera.updateProjectionMatrix();
            },
          };
        },
        compositeScene: scene,
        maxFboBytes: Math.min(
          maxFboBytes,
          allocatorHandleRef.current?.limitBytes() ?? maxFboBytes,
        ),
        maxRepaintsPerFrame,
        maxPaintDpr,
        dtMs: delta * 1000,
        incomingOpacity: incomingOpacityRef.current,
      });
    } finally {
      bridge.renderAssert.end();
    }
    const cb = statsCbRef.current;
    if (cb !== undefined) {
      const gpu = gpuProfilerRef.current;
      gpu?.update();
      const d = gpu?.getData();
      const info = gl.info;

      // Island / virtual-texture census: phases + live-target resolutions come
      // straight from the bridge state the pass just stamped (paintedAt holds
      // each FBO's real pixel dims + the zoom band it was painted at).
      let total = 0;
      let hot = 0;
      let warm = 0;
      let waking = 0;
      let cold = 0;
      let dormant = 0;
      let pixels = 0;
      const bandHistogram: Record<string, number> = {};
      for (const [e, s] of bridge.state.all()) {
        total++;
        if (s.phase === "Hot") hot++;
        else if (s.phase === "Warm") warm++;
        else if (s.phase === "Waking") waking++;
        else if (s.phase === "Dormant") dormant++;
        else cold++;
        if (s.fboGeneration >= 0 && pool.get(e) !== null) {
          pixels += s.paintedAt.w * s.paintedAt.h;
          const key = `×${s.paintedAt.band}`;
          bandHistogram[key] = (bandHistogram[key] ?? 0) + 1;
        }
      }
      let visibleWidgets = 0;
      let culledWidgets = 0;
      world.query(visibleWidgetsQ).each((b) => {
        visibleWidgets += b.count;
      });
      world.query(culledWidgetsQ).each((b) => {
        culledWidgets += b.count;
      });
      const zoom = world.getResource(Camera)?.zoom ?? 1;
      const band = selectBand(zoom);

      cb({
        cpuMs: performance.now() - passStart,
        gpuMs: d?.gpu ?? 0,
        fps: d?.fps ?? 0,
        drawCalls: info.render.calls,
        triangles: info.render.triangles,
        points: info.render.points,
        lines: info.render.lines,
        programs: info.programs?.length ?? 0,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        renderTargets: pool.size(),
        renderMegaPixels: pixels / 1e6,
        fboBytes: pool.bytesUsed(),
        fboBudgetBytes: maxFboBytes,
        islands: { total, hot, warm, waking, cold, dormant },
        bandHistogram,
        repainted: stats.repainted,
        pendingPaints: stats.pendingPaints,
        evicted: stats.evicted,
        zoom,
        band,
        effectiveDpr: Math.min(gl.getPixelRatio(), maxPaintDpr) * band,
        visibleWidgets,
        culledWidgets,
      });
    }
    // Self-sustain: lift eases latch the immediate next engine frame (native
    // refresh); Hot islands and stagger backlogs arm the rate-capped due-time;
    // otherwise the seam parks until the next requestFrame latch. The bridge's
    // r3fAdvance reflector consumes this on the engine's own loop — no timer.
    bridge.schedulePass(selfSustainPlan(stats, performance.now() - passStart, maxAnimationFps));
    // Freeze settle (2026-08-04): a freeze must not park on a half-drawn
    // board, so report the work this pass left OWED — islands still waiting
    // for a first paint, a lift ease mid-flight. Both self-schedule a
    // follow-up pass, which is what lets this ref drain to false instead of
    // latching. Hot islands are deliberately not counted: an animated island
    // is never "done", and stopping the clock on one is exactly what a freeze
    // is for.
    paintsOwedRef.current = stats.pendingPaints > 0 || stats.liftAnimating;
  }, 1);

  // The reporter reads the ref, so a parked seam keeps its last answer — false,
  // because the settle only ends on a pass that owed nothing.
  useEffect(
    () => engine.frame.settleWhile("gl-paints", () => paintsOwedRef.current),
    [engine],
  );

  // --- island membership (mount store → gl-surface islands) -----------------
  const entries = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const islands: ReactElement[] = [];
  for (const entry of entries) {
    if (entry.hidden || entry.frozen === true) continue; // culled/T2-frozen: FBO stays pooled
    if (!world.isAlive(entry.entity)) continue;
    const type = world.get(entry.entity, PrefabId)?.id;
    const widget = typeof type === "string" ? widgets.get(type) : undefined;
    if (widget === undefined || widget.surface !== "gl") continue;
    islands.push(
      createElement(Island, {
        key: String(entry.entity),
        bridge,
        world,
        entity: entry.entity as Entity,
        widget,
        ...(environment !== undefined ? { environment } : {}),
      }),
    );
  }
  return createElement("group", null, islands);
}
