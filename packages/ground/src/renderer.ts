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
 * false. Synchronous render faults are deliberately rethrown to the layer:
 * the static layer quarantines itself, while GroundHost can quarantine only
 * the active program and retry its fallback. Treating every shader fault as
 * permanent device loss would make one extension take down the renderer.
 *
 * DEVICE INJECTION (design-012 §4 / plan §5 S1.2). Passing `device` makes three
 * ADOPT the app-owned device instead of creating its own. Two consequences,
 * both verified against three r185 in this tree:
 *
 *  - three takes the device as-is (WebGPUBackend.js:250) and skips the adapter
 *    request that would otherwise ask for `featureLevel: 'compatibility'`
 *    (:213) — which is what preserves island MSAA, since a compatibility
 *    device lacks `core-features-and-limits` and three force-sets
 *    `renderer._samples = 0` when it is missing (:254-258).
 *  - three never destroys a device it did not create (:2903-2905), so the
 *    device outlives this layer and every rebuild of it.
 *
 * UNCAPTURED-ERROR POSTURE. three ASSIGNS `device.onuncapturederror` during
 * init (:277), clobbering whatever was on that property. So this module never
 * touches the property — it subscribes with `addEventListener`, which coexists
 * with three's handler. For an INJECTED device the owner already armed its own
 * listener before handing it over (`acquireCompositorDevice`), so this one is
 * skipped; for a device three creates itself, arming it here is the only way
 * the layer sees its own GPU errors at all.
 */
import { backendTexture } from "@ice/core";
import {
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  RenderTarget,
  SRGBColorSpace,
  Scene,
  WebGPURenderer,
  type Camera,
  type Object3D,
} from "three/webgpu";

export interface GroundGpuSnapshot {
  readonly object: Object3D;
  readonly bytes: number;
  /** Screen-CSS-pixel rectangle in the host's y-down projection. */
  update(rect: { x: number; y: number; width: number; height: number }, opacity: number): void;
  dispose(): void;
}

export interface GroundSnapshotCaptureOptions {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
}

export type GroundRendererBackend = "pending" | "webgpu" | "webgl2" | "unknown" | "unavailable";

export type GroundRendererFailureKind = "initialization" | "device-lost" | "backend";

/** Stable, serializable failure evidence. Never exposes Three/backend objects. */
export interface GroundRendererFailure {
  readonly kind: GroundRendererFailureKind;
  readonly backend: GroundRendererBackend;
  readonly message: string;
  readonly api?: "WebGPU" | "WebGL";
  readonly reason?: string;
}

/** Read-only renderer health used by release probes and devtools. */
export interface GroundRendererStatus {
  readonly backend: GroundRendererBackend;
  readonly ready: boolean;
  readonly failed: boolean;
  readonly failure?: GroundRendererFailure;
}

export interface GroundRendererFrameProfile {
  readonly sequence: number;
  readonly cpuMs: number;
  readonly gpuMs?: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly points: number;
  readonly lines: number;
}

export interface GroundRendererProfile {
  readonly enabled: boolean;
  readonly timestampSupported?: boolean;
  readonly samples: readonly GroundRendererFrameProfile[];
}

/** The layer's renderer seam — tests inject a fake (compositor `GlLike` precedent). */
export interface GroundRendererLike {
  readonly canvas: HTMLCanvasElement;
  ready(): boolean;
  failed(): boolean;
  /** Optional so existing test/third-party renderer seams remain structural. */
  status?(): GroundRendererStatus;
  /** Query-gated render/GPU timestamp samples; absent on old injected seams. */
  profile?(): GroundRendererProfile;
  /** Register a one-shot "became ready" callback (fires immediately if already ready). */
  onReady(cb: () => void): void;
  setSize(cssW: number, cssH: number, dpr: number): void;
  render(scene: Scene, camera: Camera): void;
  /**
   * The offscreen target's raw `GPUTexture`, in the composited profile.
   *
   * A GETTER, never a captured handle: a viewport or DPR change reallocates
   * the target, and a stale handle is a frame of the wrong pixels with nothing
   * to catch it. `undefined` before the first render, and on every renderer
   * that is not offscreen.
   */
  targetTexture?(): GPUTexture | undefined;
  /** GPU-only capture; no readPixels/canvas/ImageBitmap path is permitted. */
  capture?(
    object: Object3D,
    camera: Camera,
    opts: GroundSnapshotCaptureOptions,
  ): GroundGpuSnapshot;
  /**
   * The device three ended up on, once init resolves — the injected one on the
   * composited profile, three's own otherwise, `undefined` before ready and on
   * the WebGL2 fallback. Optional, like `status`/`profile`, so existing test
   * and third-party renderer seams stay structural.
   *
   * The seam that lets a rig assert adoption actually HAPPENED rather than
   * trusting that the option was accepted.
   */
  device?(): GPUDevice | undefined;
  dispose(): void;
}

export interface GroundRendererOptions {
  /** Force the WebGL2 backend (debug / e2e A-B runs). */
  readonly forceWebGL?: boolean;
  /** Arm render/GPU-timestamp sampling (`trackTimestamp` is constructor-only). */
  readonly profile?: boolean;
  /**
   * The app-owned device three should adopt (composited profile). Its
   * `uncapturederror` listener must already be armed by the owner.
   */
  readonly device?: GPUDevice;
  /**
   * COMPOSITED PROFILE (design-012 §4, S6b): render ground's passes into an
   * OFFSCREEN target instead of presenting them to this renderer's canvas, so
   * the unified compositor can draw them as its first quad.
   *
   * The point of the render-target route is that everything above it is
   * untouched: design-011's GroundHost programs, the magnet grid's TSL, the
   * pass registry and this file's own scene/camera all run exactly as they do
   * in the stratified profile. The alternative — reimplementing those programs
   * as raw WGSL inside the compositor's pass — would have discarded a ratified
   * implementation to save a blit.
   *
   * Requires `device`: the target's texture has to live on the device the
   * compositor samples from.
   */
  readonly offscreen?: boolean;
}

/** Normalize old/injected renderer seams into the public diagnostic shape. */
export function readGroundRendererStatus(renderer: GroundRendererLike): GroundRendererStatus {
  const reported = renderer.status?.();
  if (reported !== undefined) return reported;
  const ready = renderer.ready();
  const failed = renderer.failed();
  return Object.freeze({
    backend: ready ? "unknown" : failed ? "unavailable" : "pending",
    ready,
    failed,
  });
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

export function createGroundRenderer(
  doc: Document,
  opts: GroundRendererOptions = {},
): GroundRendererLike {
  const canvas = doc.createElement("canvas");
  const injected = opts.device;

  // A device and a forced WebGL2 backend are contradictory: the backend cannot
  // use a GPUDevice, so honouring both would silently run the composited
  // profile on a renderer that can share nothing — the silent swap design-012
  // §11 Q2 forbids. The device wins, out loud.
  const forceWebGL = opts.forceWebGL === true && injected === undefined;
  if (opts.forceWebGL === true && injected !== undefined) {
    console.warn("[ice] ground: forceWebGL ignored — an app-owned GPUDevice was injected");
  }
  let renderer: WebGPURenderer | null = null;
  let isReady = false;
  let isFailed = false;
  let disposed = false;
  let backend: GroundRendererBackend = "pending";
  let failure: GroundRendererFailure | undefined;
  let timestampSupported: boolean | undefined;
  let timestampResolvePending = false;
  let renderSequence = 0;
  const profileSamples: Array<{
    sequence: number;
    cpuMs: number;
    gpuMs?: number;
    drawCalls: number;
    triangles: number;
    points: number;
    lines: number;
  }> = [];
  const readyCbs: Array<() => void> = [];

  const markFailure = (
    kind: GroundRendererFailureKind,
    message: string,
    details: { api?: "WebGPU" | "WebGL"; reason?: string } = {},
  ): void => {
    isReady = false;
    isFailed = true;
    failure = Object.freeze({
      kind,
      backend,
      message,
      ...(details.api !== undefined ? { api: details.api } : {}),
      ...(details.reason !== undefined ? { reason: details.reason } : {}),
    });
    // A failed renderer can never become ready again. Do not retain callbacks
    // from a disposed StrictMode mount or an unavailable backend indefinitely.
    readyCbs.length = 0;
  };

  // Probe BEFORE constructing: with neither WebGPU nor WebGL2 (happy-dom,
  // ancient browsers), three's WebGL2 fallback dies inside an internal
  // un-awaited promise — an unhandled rejection our init().catch never sees
  // (widgetlab app-mount test, 2026-07-16). The WebGL2 probe uses a SCRATCH
  // canvas: getContext('webgl2') on the real one would lock it out of a
  // 'webgpu' context (contexts are exclusive per canvas). An injected device is
  // itself proof of WebGPU, so it skips the probe entirely.
  const gpu = (globalThis.navigator as { gpu?: unknown } | undefined)?.gpu;
  if (injected === undefined && (gpu == null || forceWebGL)) {
    let gl2: unknown = null;
    try {
      gl2 = doc.createElement("canvas").getContext("webgl2");
    } catch {
      gl2 = null;
    }
    if (gl2 === null) {
      backend = "unavailable";
      markFailure("initialization", "Neither WebGPU nor WebGL2 is available.");
    } else {
      backend = "webgl2";
    }
  }

  if (!isFailed) {
    try {
      renderer = new WebGPURenderer({
        canvas: canvas as unknown as HTMLCanvasElement,
        alpha: true, // transparent clear — the page background shows through P0
        antialias: true,
        ...(opts.profile === true ? { trackTimestamp: true } : {}),
        ...(forceWebGL ? { forceWebGL: true } : {}),
        ...(injected !== undefined ? { device: injected } : {}),
      });
      const currentRenderer = renderer;
      const defaultOnDeviceLost = currentRenderer.onDeviceLost;
      currentRenderer.onDeviceLost = (info) => {
        backend = info.api === "WebGPU" ? "webgpu" : "webgl2";
        markFailure("device-lost", info.message || `${info.api} device/context lost.`, {
          api: info.api,
          ...(info.reason !== null ? { reason: info.reason } : {}),
        });
        // Preserve Three's own device-lost posture and diagnostic output.
        defaultOnDeviceLost.call(currentRenderer, info);
      };
      renderer
        .init()
        .then(() => {
          if (disposed || isFailed || renderer !== currentRenderer) return;
          const initializedBackend = currentRenderer.backend as {
            readonly isWebGPUBackend?: boolean;
            readonly isWebGLBackend?: boolean;
          };
          backend = initializedBackend.isWebGPUBackend === true
            ? "webgpu"
            : initializedBackend.isWebGLBackend === true
              ? "webgl2"
              : "unknown";
          timestampSupported = opts.profile === true
            ? (currentRenderer.backend as { readonly trackTimestamp?: boolean }).trackTimestamp === true
            : undefined;
          // Own device only: for an injected one the owner armed its listener
          // before three could assign over the property, and a second listener
          // would just double-report.
          if (injected === undefined) armErrorListener();
          isReady = true;
          for (const cb of readyCbs.splice(0)) cb();
        })
        .catch((error: unknown) => {
          if (disposed || renderer !== currentRenderer || isFailed) return;
          markFailure("initialization", messageOf(error, "Ground renderer initialization failed."));
        });
    } catch (error) {
      markFailure("initialization", messageOf(error, "Ground renderer construction failed."));
    }
  }

  /** The device three settled on; undefined pre-init or on the WebGL2 backend. */
  const backendDevice = (): GPUDevice | undefined => {
    const backendRef = (renderer as unknown as { backend?: { device?: GPUDevice } } | null)?.backend;
    return backendRef?.device ?? undefined;
  };

  /**
   * addEventListener, NEVER `device.onuncapturederror = …` — three owns that
   * property (:277) and an assignment here would either lose our handler or
   * silently take three's away.
   */
  function armErrorListener(): void {
    const device = backendDevice();
    if (device === undefined) return;
    try {
      device.addEventListener("uncapturederror", (event) => {
        const err = (event as GPUUncapturedErrorEvent).error as { message?: string } | undefined;
        console.error("[ice] ground: uncaptured GPU error", err?.message ?? "unknown");
      });
    } catch {
      /* a backend without an EventTarget device (WebGL2) — nothing to arm */
    }
  }

  let lastW = 0;
  let lastH = 0;
  let lastDpr = 0;

  /**
   * The offscreen colour target (composited profile). Sized in DEVICE pixels
   * and reallocated on every viewport/DPR change, which is why consumers hold
   * `targetTexture()` rather than its result.
   */
  const offscreen = opts.offscreen === true && opts.device !== undefined;
  let target: RenderTarget | null = null;
  const sizeTarget = (cssW: number, cssH: number, dpr: number): void => {
    if (!offscreen) return;
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (target === null) {
      // No depth, no stencil, no MSAA: ground draws flat 2D passes into a
      // colour buffer the compositor samples. MSAA on this target would cost
      // the fill rate design-012 §4 already names as the expensive mode and
      // buy nothing — ground's own geometry is analytically antialiased.
      target = new RenderTarget(w, h, { depthBuffer: false, stencilBuffer: false, samples: 0 });
      // THE COLOUR SPACE IS NOT A DETAIL. Rendering to the canvas, three
      // applies its output transform and writes sRGB-ENCODED values; rendering
      // to a target it does not, and the target keeps LINEAR ones. Blitting
      // those linear values to a non-sRGB swap chain darkens everything —
      // measured at up to 74/255 on the grid's dots, with the geometry
      // pixel-perfect, which reads as "the blit works, the colours are wrong".
      //
      // Asking three for an SRGB target makes it create an `-srgb` format, so
      // the pixels ARE what the canvas had AND the compositor's sRGB guard
      // reads `true` from the ACTUAL format for the right reason rather than
      // being told to re-encode by hand.
      target.texture.colorSpace = SRGBColorSpace;
      return;
    }
    if (target.width !== w || target.height !== h) target.setSize(w, h);
  };

  return {
    canvas,
    ready: () => isReady,
    failed: () => isFailed,
    device: () => backendDevice(),
    status: () => Object.freeze({
      backend,
      ready: isReady,
      failed: isFailed,
      ...(failure !== undefined ? { failure } : {}),
    }),
    profile: () => Object.freeze({
      enabled: opts.profile === true,
      ...(timestampSupported !== undefined ? { timestampSupported } : {}),
      samples: Object.freeze(profileSamples.map((sample) => Object.freeze({ ...sample }))),
    }),
    onReady(cb) {
      if (isReady) cb();
      else if (!isFailed && !disposed) readyCbs.push(cb);
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
        sizeTarget(cssW, cssH, dpr);
      } catch (error) {
        markFailure("backend", messageOf(error, "Ground renderer resize failed."));
      }
    },
    render(scene, camera) {
      if (renderer === null || !isReady || isFailed) return;
      if (offscreen) {
        // Set EVERY render, and never restore to null: the canvas must never
        // become a present target again by accident. This is what makes the
        // compositor reflector the only `getCurrentTexture` caller.
        sizeTarget(lastW, lastH, lastDpr);
        renderer.setRenderTarget(target);
      }
      if (opts.profile !== true) {
        renderer.render(scene, camera);
        return;
      }
      const currentRenderer = renderer;
      const started = performance.now();
      currentRenderer.render(scene, camera);
      const info = currentRenderer.info.render;
      const sample = {
        sequence: ++renderSequence,
        cpuMs: performance.now() - started,
        drawCalls: info.drawCalls,
        triangles: info.triangles,
        points: info.points,
        lines: info.lines,
      };
      profileSamples.push(sample);
      if (profileSamples.length > 2_048) profileSamples.shift();
      if (timestampSupported === true && !timestampResolvePending) {
        timestampResolvePending = true;
        void currentRenderer.resolveTimestampsAsync().then((gpuMs) => {
          if (renderer === currentRenderer && typeof gpuMs === "number" && Number.isFinite(gpuMs)) {
            const latest = profileSamples.at(-1);
            if (latest !== undefined) latest.gpuMs = gpuMs;
          }
        }).catch(() => {
          // Profiling must never alter renderer availability or program fault
          // attribution. The CPU sample remains valid if timestamp readback fails.
        }).finally(() => {
          timestampResolvePending = false;
        });
      }
    },
    targetTexture() {
      if (!offscreen || target === null || renderer === null) return undefined;
      return backendTexture(renderer, target.texture);
    },
    capture(object, camera, captureOpts) {
      if (renderer === null || !isReady || isFailed) {
        throw new Error("ice: ground renderer is unavailable for GPU capture.");
      }
      const pixelWidth = Math.max(1, Math.floor(captureOpts.pixelWidth));
      const pixelHeight = Math.max(1, Math.floor(captureOpts.pixelHeight));
      const target = new RenderTarget(pixelWidth, pixelHeight, {
        depthBuffer: false,
        stencilBuffer: false,
        samples: 0,
      });
      const captureScene = new Scene();
      const parent = object.parent;
      const priorTarget = renderer.getRenderTarget();
      try {
        captureScene.add(object);
        renderer.setRenderTarget(target);
        renderer.setClearColor(0x000000, 0);
        renderer.clear(true, false, false);
        renderer.render(captureScene, camera);
      } catch (error) {
        target.dispose();
        throw error;
      } finally {
        renderer.setRenderTarget(priorTarget);
        captureScene.remove(object);
        parent?.add(object);
      }
      const geometry = new PlaneGeometry(1, 1);
      const material = new MeshBasicNodeMaterial({
        map: target.texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 10;
      let disposed = false;
      return {
        object: mesh,
        bytes: pixelWidth * pixelHeight * 4,
        update(rect, opacity) {
          mesh.position.set(rect.x + rect.width / 2, rect.y + rect.height / 2, 0);
          mesh.scale.set(rect.width, rect.height, 1);
          material.opacity = opacity;
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          geometry.dispose();
          material.dispose();
          target.dispose();
        },
      };
    },
    dispose() {
      disposed = true;
      isReady = false;
      readyCbs.length = 0;
      try {
        // Disposes three's own resources. An INJECTED device survives this by
        // construction (:2903-2905) — the app owns its end of life.
        renderer?.dispose();
      } catch {
        /* already lost */
      }
      renderer = null;
      profileSamples.length = 0;
    },
  };
}
