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
import type { GLBridge } from "./bridge";
import { CompositeMaterial } from "./composite-material";
import {
  runCompositorPass,
  type GlLike,
  type QuadLike,
  type QuadsLike,
  type TargetLike,
} from "./compositor-pass";
import { Island } from "./island";
import { RenderTargetPool } from "./pool";
import { createRetainedQuadTransitionAdapter } from "./retained-quads";
import { selfSustainPlan } from "./self-sustain";

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
  /** Outgoing transition quads; each owns one ref-counted FBO pin. */
  readonly retainedQuads: number;
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
}: GLViewsProps): ReactElement {
  const world = engine.world;
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const set = useThree((s) => s.set);
  const advance = useThree((s) => s.advance);
  const frameloop = useThree((s) => s.frameloop);
  const clock = useThree((s) => s.clock);

  // --- context-lifetime resources (lazy + disposed-aware, v1 pattern) ------
  const poolRef = useRef<RenderTargetPool | null>(null);
  if (poolRef.current === null || poolRef.current.isDisposed()) {
    poolRef.current = new RenderTargetPool();
  }
  const pool = poolRef.current;
  const incomingOpacityRef = useRef(1);
  const retainedQuadsRef = useRef(0);
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
    if (ledger === undefined) return;
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

  useEffect(() => {
    const transitions = bridge.transitions;
    if (transitions === undefined) return;
    return transitions.register(
      createRetainedQuadTransitionAdapter({
        scene,
        geometry: quadGeometry,
        sources: quadsRef.current,
        pool,
        store,
        requestFrame: bridge.requestFrame,
        setIncomingOpacity: (opacity) => {
          incomingOpacityRef.current = opacity;
        },
        onRetainedCountChange: (count) => {
          retainedQuadsRef.current = count;
        },
      }),
    );
  }, [bridge, pool, quadGeometry, scene, store]);

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
      pool.dispose();
      for (const [key] of bridge.state.all()) bridge.state.markEvicted(key);
    };
  }, [scene, pool, bridge]);

  // The pass. Priority 1 suppresses R3F's default render — we own the frame.
  useFrame((_, delta) => {
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
        retainedQuads: retainedQuadsRef.current,
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
