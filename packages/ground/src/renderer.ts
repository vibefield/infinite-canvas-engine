/**
 * WebGPU renderer bootstrap for the ground layer.
 *
 * WebGPU-first (James, 2026-07-16): three's `WebGPURenderer` picks the WebGPU
 * backend when `navigator.gpu` exists and falls back to WebGL2 otherwise —
 * one code path, TSL compiles to WGSL or GLSL per backend. Init is ASYNC
 * (`renderer.init()`), but the reflector flush is synchronous: `ready()`
 * gates drawing, the layer keeps its dirty flags armed, and the first flush
 * after resolution paints (the rAF loop retries every frame — no extra wake
 * plumbing). Any construction/init failure (happy-dom, device loss, no
 * WebGL2 either) degrades to `failed()` — the layer reports available() =
 * false and never throws (grid.ts fault-isolation contract, design-002 §5).
 */
import { WebGPURenderer } from "three/webgpu";
import type { Camera, Scene } from "three/webgpu";

/** The layer's renderer seam — tests inject a fake (compositor `GlLike` precedent). */
export interface GroundRendererLike {
  readonly canvas: HTMLCanvasElement;
  ready(): boolean;
  failed(): boolean;
  /** Register a one-shot "became ready" callback (fires immediately if already ready). */
  onReady(cb: () => void): void;
  setSize(cssW: number, cssH: number, dpr: number): void;
  render(scene: Scene, camera: Camera): void;
  dispose(): void;
}

export function createGroundRenderer(
  doc: Document,
  opts: { forceWebGL?: boolean } = {},
): GroundRendererLike {
  const canvas = doc.createElement("canvas");
  let renderer: WebGPURenderer | null = null;
  let isReady = false;
  let isFailed = false;
  const readyCbs: Array<() => void> = [];

  // Probe BEFORE constructing: with neither WebGPU nor WebGL2 (happy-dom,
  // ancient browsers), three's WebGL2 fallback dies inside an internal
  // un-awaited promise — an unhandled rejection our init().catch never sees
  // (widgetlab app-mount test, 2026-07-16). The WebGL2 probe uses a SCRATCH
  // canvas: getContext('webgl2') on the real one would lock it out of a
  // 'webgpu' context (contexts are exclusive per canvas).
  const gpu = (globalThis.navigator as { gpu?: unknown } | undefined)?.gpu;
  if (gpu == null || opts.forceWebGL === true) {
    let gl2: unknown = null;
    try {
      gl2 = doc.createElement("canvas").getContext("webgl2");
    } catch {
      gl2 = null;
    }
    if (gl2 === null) isFailed = true;
  }

  if (!isFailed) {
    try {
      renderer = new WebGPURenderer({
        canvas: canvas as unknown as HTMLCanvasElement,
        alpha: true, // transparent clear — the page background shows through P0
        antialias: true,
        ...(opts.forceWebGL === true ? { forceWebGL: true } : {}),
      });
      renderer
        .init()
        .then(() => {
          isReady = true;
          for (const cb of readyCbs.splice(0)) cb();
        })
        .catch(() => {
          isFailed = true; // device loss mid-init
        });
    } catch {
      isFailed = true; // constructor threw
    }
  }

  let lastW = 0;
  let lastH = 0;
  let lastDpr = 0;

  return {
    canvas,
    ready: () => isReady,
    failed: () => isFailed,
    onReady(cb) {
      if (isReady) cb();
      else readyCbs.push(cb);
    },
    setSize(cssW, cssH, dpr) {
      if (renderer === null || (cssW === lastW && cssH === lastH && dpr === lastDpr)) return;
      lastW = cssW;
      lastH = cssH;
      lastDpr = dpr;
      try {
        renderer.setPixelRatio(dpr);
        // false: the layer owns the canvas CSS size (100% inset-0)
        renderer.setSize(Math.max(1, cssW), Math.max(1, cssH), false);
      } catch {
        isFailed = true;
      }
    },
    render(scene, camera) {
      if (renderer === null || !isReady || isFailed) return;
      try {
        renderer.render(scene, camera);
      } catch {
        isFailed = true; // device loss ⇒ silent no-op forever, never a throwing reflector
      }
    },
    dispose() {
      try {
        renderer?.dispose();
      } catch {
        /* already lost */
      }
      renderer = null;
    },
  };
}
