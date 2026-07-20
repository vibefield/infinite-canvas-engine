/**
 * The GL preview capture pipeline (design-005 §2 preview contract, P2 —
 * 2026-07-19). Renders each gl-surface widget's REAL island content once,
 * offscreen, and lands the capture in @ice/react's preview-snapshot store —
 * `<WidgetPreview>` re-renders any open palette the moment it arrives.
 *
 * The capture stage is a HEADLESS ISLAND: the exact contract island.tsx
 * gives live content — center-origin Y-up ortho at (0,0,500) with the
 * ±defaultSize/2 frustum, `scene.environment` stamped, and an IslandContext
 * whose bridge accepts the island hooks (frame callbacks fire per settle
 * frame; lift/opacity/paint-bumps are inert here). Widget components run
 * UNCHANGED — `useIslandFrame` animations tick, so the capture catches a
 * live pose, not frame zero.
 *
 * Deliberately LAZY: call this from idle time or first palette need — never
 * from the boot path (the design decision: "cached after first capture",
 * not "ready at load"). One R3F root + one canvas are reused across types
 * (WebGL contexts are a capped resource); already-captured types are
 * skipped, and concurrent calls coalesce onto one run.
 */
import {
  createCanvasEngine,
  widgets,
  type CanvasEngine,
  type Entity,
  type WidgetType,
} from "@ice/core";
import {
  EngineProvider,
  hasPreviewSnapshot,
  setPreviewSnapshot,
  type WidgetComponentProps,
} from "@ice/react";
import { advance, createRoot } from "@react-three/fiber";
import { createElement, type ComponentType } from "react";
import type { Texture, WebGLRenderer } from "three";
import type { GLBridge, IslandFrameCallback } from "./bridge";
import { IslandContext } from "./use-island-frame";

export interface CapturePreviewOpts {
  /** Types to capture (default: every registered gl-surface widget). */
  readonly types?: readonly string[];
  /**
   * Shared IBL. Prefer the FACTORY form: PMREM textures live on the GPU of
   * the renderer that generated them (no CPU image), so the app's main-canvas
   * env is EMPTY on the capture renderer (field bug 2026-07-19 — black
   * metals). The factory receives the capture renderer and builds the env
   * there (e.g. `(gl) => new PMREMGenerator(gl).fromScene(new RoomEnvironment(), 0.04).texture`).
   * A plain Texture is accepted for same-renderer/CPU-backed cases.
   */
  readonly environment?: Texture | ((gl: WebGLRenderer) => Texture | null) | null;
  /** Pixel density of the capture (default: fit 512px on the long side, ≤2). */
  readonly scale?: number;
  /** Frames advanced before the capture (animations reach a live pose). */
  readonly settleFrames?: number;
}

// --- the capture sandbox (r3f-local; mirrors @ice/react's — deliberately
// separate: cross-package private state would couple the walls) -------------
let sandbox: { ce: CanvasEngine; entities: Map<string, Entity> } | null = null;

function ensureEntity(def: WidgetType): Entity | undefined {
  if (sandbox === null) {
    const ce = createCanvasEngine();
    ce.docs.create();
    ce.world.sync();
    ce.step(16);
    sandbox = { ce, entities: new Map() };
  }
  const hit = sandbox.entities.get(def.type);
  if (hit !== undefined) return hit;
  try {
    const e = sandbox.ce.ops.spawnWidget(def.type, {
      x: 0,
      y: 0,
      undoable: false,
      ...(def.previewProps !== undefined ? { props: def.previewProps } : {}),
    });
    sandbox.ce.world.sync();
    sandbox.ce.step(32);
    sandbox.entities.set(def.type, e);
    return e;
  } catch (err) {
    console.warn(`ice: preview capture — sandbox spawn failed for "${def.type}".`, err);
    return undefined;
  }
}

/** The island hooks' surface, inert: frames collect, chrome signals no-op. */
function stubBridge(callbacks: Set<IslandFrameCallback>): GLBridge {
  const stub = {
    addFrameCallback: (_e: Entity, cb: IslandFrameCallback) => {
      callbacks.add(cb);
      return () => callbacks.delete(cb);
    },
    bumpPaint: () => {},
    setCompositeScale: () => {},
    setCompositeOpacity: () => {},
  };
  return stub as unknown as GLBridge;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let inFlight: Promise<string[]> | null = null;

export function captureWidgetPreviews(opts: CapturePreviewOpts = {}): Promise<string[]> {
  // Coalesce: a StrictMode double-fire or an eager second caller rides the
  // first run (skip-if-captured makes a follow-up run cheap anyway).
  if (inFlight !== null) return inFlight;
  const run = doCapture(opts).finally(() => {
    inFlight = null;
  });
  inFlight = run;
  return run;
}

async function doCapture(opts: CapturePreviewOpts): Promise<string[]> {
  const wanted =
    opts.types ??
    widgets
      .all()
      .filter((d) => d.surface === "gl")
      .map((d) => d.type);
  const defs = wanted
    .map((t) => widgets.get(t))
    .filter((d): d is WidgetType => d !== undefined && d.surface === "gl" && d.component !== null && d.component !== undefined)
    .filter((d) => !hasPreviewSnapshot(d.type));
  if (defs.length === 0) return [];

  const canvas = document.createElement("canvas");
  const root = createRoot(canvas);
  const captured: string[] = [];
  let resolvedEnv: Texture | null | undefined; // lazily built ON the capture renderer
  try {
    for (const def of defs) {
      // Per-type containment: one widget's render throw skips ITS capture —
      // the fallback silhouette covers it — never the whole run (field bug
      // 2026-07-19: one provider-hungry widget aborted every later type).
      try {
        const entity = ensureEntity(def);
        if (entity === undefined || sandbox === null) continue;
        const { w, h } = def.defaultSize;
        const scale = opts.scale ?? Math.min(2, 512 / Math.max(w, h));
        const callbacks = new Set<IslandFrameCallback>();

        root.configure({
          frameloop: "never",
          gl: { alpha: true, antialias: true, preserveDrawingBuffer: true },
          orthographic: true,
          // The island frustum verbatim (island.tsx / the paint pass): center
          // origin, Y-up, camera on +Z looking at the content plane; `manual`
          // pins it against R3F's resize auto-frustum.
          camera: {
            left: -w / 2,
            right: w / 2,
            top: h / 2,
            bottom: -h / 2,
            near: 0.1,
            far: 2000,
            position: [0, 0, 500],
            manual: true,
          },
          size: { width: w, height: h, top: 0, left: 0 },
          dpr: scale,
        });

        // EngineProvider wraps the tree: LIVE island content inherits it
        // through the app's portal chain, so widgets legitimately reach
        // useOps/useCommit — the capture stage must offer the same contract
        // (the sandbox engine), or provider-hungry widgets throw (field bug
        // 2026-07-19, shapes-card).
        const View = def.component as ComponentType<WidgetComponentProps>;
        const store = root.render(
          createElement(
            EngineProvider,
            { engine: sandbox.ce },
            createElement(
              IslandContext.Provider,
              { value: { bridge: stubBridge(callbacks), entity } },
              createElement(View, { entity, world: sandbox.ce.world }),
            ),
          ),
        );
        if (resolvedEnv === undefined) {
          resolvedEnv =
            typeof opts.environment === "function"
              ? opts.environment(store.getState().gl)
              : (opts.environment ?? null);
        }
        store.getState().scene.environment = resolvedEnv;
        // Commit the frustum IMPERATIVELY: `manual` pins R3F's auto-frustum,
        // but camera PROPS alone don't guarantee an updateProjectionMatrix —
        // the compositor pass learned this same lesson ("write the frustum
        // from the live Size and refresh matrices here"). Without it the
        // default ±1 window renders the hollow middle of a 60-unit knot.
        const cam = store.getState().camera as import("three").OrthographicCamera;
        cam.left = -w / 2;
        cam.right = w / 2;
        cam.top = h / 2;
        cam.bottom = -h / 2;
        cam.near = 0.1;
        cam.far = 2000;
        cam.position.set(0, 0, 500);
        cam.lookAt(0, 0, 0);
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld(true);

        // Settle: a beat for suspense/microtasks, then advance real frames so
        // useIslandFrame content reaches a live pose. runGlobalEffects FALSE:
        // the capture must never tick the app's own roots/effects (isolation
        // — the stage may be backgrounded while this runs).
        await sleep(30);
        const frames = opts.settleFrames ?? 12;
        // advance() timestamps are SECONDS in frameloop="never" (R3F clock
        // contract — same unit trap as gl-root's reflect-phase advance): the
        // capture's frame callbacks get their dt via `cb(16.7)` ms directly,
        // but any plain-useFrame content reads the clock, so keep it honest.
        for (let i = 0; i < frames; i++) {
          for (const cb of callbacks) cb(16.7);
          advance((i * 16.7) / 1000, false, store.getState());
          await sleep(16);
        }
        // Final frame + readback in the SAME task, via 2D-canvas drawImage:
        // a WebGL drawing buffer is only guaranteed readable before the task
        // yields, and createImageBitmap can route through a (possibly
        // stalled) compositor — the synchronous copy depends on neither
        // (field bug 2026-07-19 — full-alpha-zero bitmaps).
        for (const cb of callbacks) cb(16.7);
        advance((frames * 16.7) / 1000, false, store.getState());
        const snap = document.createElement("canvas");
        snap.width = canvas.width;
        snap.height = canvas.height;
        snap.getContext("2d")?.drawImage(canvas, 0, 0);
        setPreviewSnapshot(def.type, snap);
        captured.push(def.type);
      } catch (err) {
        console.warn(`ice: preview capture failed for "${def.type}" — its tile keeps the fallback.`, err);
      }
      // Yield BETWEEN types: each capture is a ~250ms burst, and the app —
      // possibly mid-gesture — must breathe between them (lazy also means
      // polite; a starved main loop can cancel a live drag).
      await new Promise<void>((r) => {
        const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
        if (w.requestIdleCallback !== undefined) w.requestIdleCallback(() => r(), { timeout: 500 });
        else setTimeout(r, 50);
      });
    }
  } finally {
    root.unmount();
  }
  return captured;
}
