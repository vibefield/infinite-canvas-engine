/**
 * GLViews — the P2 root (design-004 §1/§3). Mount ONE inside an R3F
 * `<Canvas frameloop="demand">` that the app positions as the GL-views plane
 * (absolute inset-0, `pointer-events: none` — the router owns GL hit
 * testing; the canvas element never sees pointers).
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
import { Mesh, OrthographicCamera, PlaneGeometry, type WebGLRenderTarget } from "three";
import {
  PrefabId,
  RUNTIME_BUDGETS,
  widgets,
  type Engine,
  type Entity,
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

export interface GLViewsProps {
  readonly engine: Engine;
  readonly bridge: GLBridge;
  readonly store: WidgetMountStore;
  /** FBO byte budget (default `RUNTIME_BUDGETS.fboBytes`, 256 MB). */
  readonly maxFboBytes?: number;
  /** Repaint stagger per composited frame (v1 default 4). */
  readonly maxRepaintsPerFrame?: number;
}

export function GLViews({
  engine,
  bridge,
  store,
  maxFboBytes = RUNTIME_BUDGETS.fboBytes,
  maxRepaintsPerFrame = 4,
}: GLViewsProps): ReactElement {
  const world = engine.world;
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const set = useThree((s) => s.set);
  const invalidate = useThree((s) => s.invalidate);

  // --- context-lifetime resources (lazy + disposed-aware, v1 pattern) ------
  const poolRef = useRef<RenderTargetPool | null>(null);
  if (poolRef.current === null || poolRef.current.isDisposed()) {
    poolRef.current = new RenderTargetPool();
  }
  const pool = poolRef.current;

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

  // Wire the bridge's demand-loop hook for the life of this Canvas.
  useEffect(() => {
    bridge.setInvalidate(() => invalidate());
    return () => bridge.setInvalidate(null);
  }, [bridge, invalidate]);

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
        maxFboBytes,
        maxRepaintsPerFrame,
        dtMs: delta * 1000,
      });
    } finally {
      bridge.renderAssert.end();
    }
    // Self-sustain: Hot islands and stagger-deferred paints keep the demand
    // loop spinning; otherwise it parks until the next invalidation.
    if (stats.anyHot || stats.pendingPaints > 0) invalidate();
  }, 1);

  // --- island membership (mount store → gl-surface islands) -----------------
  const entries = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const islands: ReactElement[] = [];
  for (const entry of entries) {
    if (entry.hidden) continue; // culled: island unmounts, FBO stays pooled
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
      }),
    );
  }
  return createElement("group", null, islands);
}
