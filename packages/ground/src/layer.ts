/**
 * The ground LAYER — one reflector, one canvas, one render (design-004 §1
 * as-built 2026-07-16: P0 consolidated from three stacked canvases into a
 * single WebGPU canvas; grid, wires and snap-guides are now PASSES of this
 * layer, and future ground effects join the same registry).
 *
 * Coordinate model: the layer renders in SCREEN CSS-px space — an ortho
 * camera maps [0..w]×[0..h] (y-down) to clip, and passes build their geometry
 * through the kernel `worldToScreen` seam per collect (the proven 2D-canvas
 * semantics: geometry rebuilds on the same dirt that re-stroked the old
 * canvases; the grid stays a per-pixel screen-space shader). The Y-flip
 * question never arises here — `worldToScreen` IS the one conversion (L13).
 *
 * Reflector contract (design-002 §5): post-notify, output-only, never reads
 * layout in flush (the ResizeObserver owns sizing), never writes ECS.
 * `always: true` with a private dirty union — an idle scene renders zero
 * frames; ANY dirty pass re-renders the whole canvas (one draw, same cost
 * class as a pan frame under the old grid). WebGPU init is async: flushes
 * before ready are deferred (flags stay armed), the first ready flush paints.
 */
import { Camera, type ReflectorDef, type World } from "@ice/core";
import { OrthographicCamera, Scene } from "three/webgpu";
import type { GroundFrame, GroundPass } from "./pass";
import {
  readGroundRendererStatus,
  type GroundRendererLike,
  type GroundRendererProfile,
  type GroundRendererStatus,
} from "./renderer";

export interface GroundLayerHost {
  readonly container: HTMLElement;
  readonly contentPlane: HTMLElement;
}

export interface GroundReflector extends ReflectorDef {
  /** False while init is pending or after a device/context failure. */
  available(): boolean;
  /** Whole-canvas renders so far (the churn instrument — 0 on an idle scene). */
  redraws(): number;
  /** Backend identity plus initialization/device-loss diagnostics. */
  rendererStatus(): GroundRendererStatus;
  /** Empty/disabled unless the factory explicitly enabled evidence profiling. */
  rendererProfile(): GroundRendererProfile;
}

export interface GroundLayerInternals {
  reflector: GroundReflector;
  /** Wake every pass + render (config changes, external invalidation). */
  invalidateAll(): void;
  dispose(): void;
}

export interface GroundLayerOptions {
  /**
   * Called after ground actually redraws (S6b).
   *
   * Ground repainting IS compositor dirt: in the composited profile its pixels
   * are the compositor's first quad, so a frame where ground drew and the
   * compositor did not is a frame showing the PREVIOUS grid. Measured before
   * this existed: the compositor composited exactly once — its registry never
   * changes on a widget-free board — and the canvas stayed blank while ground
   * happily rendered into the target behind it.
   *
   * It fires only on a REAL redraw, so idle-zero is untouched: no ground
   * repaint, no mark, no composite.
   */
  readonly onRedraw?: () => void;
}

export function createLayer(
  host: GroundLayerHost,
  world: World,
  renderer: GroundRendererLike,
  passes: readonly GroundPass[],
  options: GroundLayerOptions = {},
): GroundLayerInternals {
  const doc = host.container.ownerDocument;
  const canvas = renderer.canvas;
  canvas.style.position = "absolute";
  canvas.style.left = "0";
  canvas.style.top = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  // P0 is never a DOM hit target (the router owns picking, design-004 §4).
  canvas.style.pointerEvents = "none";
  // The whole ground stratum is this ONE canvas, immediately before content.
  host.container.insertBefore(canvas, host.contentPlane);

  const scene = new Scene();
  // Screen-px ortho, y-down: (0,0) = top-left, (w,h) = bottom-right.
  const camera = new OrthographicCamera(0, 1, 0, 1, -1000, 1000);
  for (const pass of passes) scene.add(pass.object);

  // --- dirt ------------------------------------------------------------------
  const dirty = new Map<GroundPass, boolean>();
  for (const pass of passes) dirty.set(pass, true);
  let anyDirty = true;
  const wakeAll = (): void => {
    for (const pass of passes) dirty.set(pass, true);
    anyDirty = true;
  };
  const unsubs: Array<() => void> = [
    // Camera moves re-map every pass's screen-space geometry (2D-canvas parity).
    world.reactive.observeResource(Camera, wakeAll),
  ];
  for (const pass of passes) {
    unsubs.push(
      ...pass.arm(world, () => {
        dirty.set(pass, true);
        anyDirty = true;
      }),
    );
  }
  renderer.onReady(wakeAll); // the deferred pre-ready flushes are owed one paint

  // --- sizing (RO owns layout reads — never the flush) -----------------------
  let cssW = 0;
  let cssH = 0;
  let dpr = 1;
  const applySize = (w: number, h: number): void => {
    dpr = doc.defaultView?.devicePixelRatio ?? 1;
    cssW = w;
    cssH = h;
    renderer.setSize(w, h, dpr);
    camera.left = 0;
    camera.right = Math.max(1, w);
    camera.top = 0;
    camera.bottom = Math.max(1, h);
    camera.updateProjectionMatrix();
    wakeAll();
  };
  const initialRect = host.container.getBoundingClientRect();
  applySize(initialRect.width, initialRect.height);
  let ro: ResizeObserver | null = null;
  try {
    ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      applySize(entry.contentRect.width, entry.contentRect.height);
    });
    ro.observe(host.container);
  } catch {
    ro = null;
  }

  let redraws = 0;
  let renderFailed = false;

  const reflector: GroundReflector = {
    name: "ground",
    // Self-gated on the dirty union (wires/chrome precedent) — the every-frame
    // cost is one boolean check.
    always: true,
    flush(w: World) {
      if (!anyDirty || renderer.failed() || renderFailed) return;
      if (!renderer.ready()) return; // init pending — flags stay armed, retry next frame
      const cam = w.getResource(Camera);
      if (cam === undefined) return;
      anyDirty = false;
      const frame: GroundFrame = { width: cssW, height: cssH, dpr, camera: cam };
      for (const pass of passes) {
        if (dirty.get(pass) === true) {
          dirty.set(pass, false);
          pass.collect(w, frame);
        }
      }
      try {
        renderer.render(scene, camera);
        redraws++;
        // Ground drew — the compositor owes a frame (see GroundLayerOptions).
        options.onRedraw?.();
      } catch {
        // Legacy static ground has no program boundary to quarantine. Stop
        // this layer only; the engine and content planes remain live.
        renderFailed = true;
      }
    },
    available: () => renderer.ready() && !renderer.failed() && !renderFailed,
    redraws: () => redraws,
    rendererStatus: () => readGroundRendererStatus(renderer),
    rendererProfile: () => renderer.profile?.() ?? Object.freeze({ enabled: false, samples: [] }),
  };

  return {
    reflector,
    invalidateAll: wakeAll,
    dispose() {
      for (const u of unsubs) u();
      unsubs.length = 0;
      ro?.disconnect();
      ro = null;
      for (const pass of passes) pass.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
