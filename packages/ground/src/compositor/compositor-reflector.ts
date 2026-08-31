/**
 * The compositor reflector (design-012 §4 "Scheduling", plan §4.3).
 *
 * ONE reflector, `always: true`, consuming a latched DIRTY UNION — the shape
 * the r3f advance machinery had, minus the second presentation loop. With one
 * canvas there is one present, driven from the reflect phase by construction.
 *
 * IDLE-ZERO IS THE LAW HERE. A quiet frame returns BEFORE
 * `getCurrentTexture()`: acquiring the swap-chain texture is itself work and
 * commits the frame to a present, so "check dirt, then acquire" and "acquire,
 * then check dirt" are not the same program even though they draw the same
 * pixels. The spike measured 0 submits across 4000 ms / 480 rAF ticks with
 * this ordering, instrumented at `queue.submit` so three could not hide work.
 *
 * THE DIRTY UNION has two classes of input, and they are not interchangeable:
 *
 *  - WORLD dirt (camera, viewport) is observed through strata, exactly as the
 *    ground layer observes it.
 *  - PRESENTATION dirt (dom paint events, island paint dirt, video frame
 *    arrival, promotion, sibling-order staleness) is latched from OUTSIDE the
 *    world via `mark()`. Per plan §4.2 this is presentation dirt, NOT world
 *    state: it is the same legality class as the r3f bridge's `requestFrame`
 *    latch, so it writes no ECS and the adapters-only-enqueue law is untouched.
 *
 * Reflector contract (design-002 §5): post-notify, output-only, never writes
 * ECS, never reads layout in flush.
 *
 * S1 SCOPE. The composited profile does not yet own a canvas — ground still
 * presents itself onto its own (device-injected) canvas — so `target` is
 * absent and this reflector composites nothing. Its dirty union, its
 * idle-zero ordering and its instrumentation are live and tested now, which is
 * what S2/S5 need to be able to hand it a target and a source and have the
 * scheduling already be correct.
 */
import { Camera, Viewport, type ReflectorDef, type World } from "@ice/core";
import type { CompositorSourceRegistry } from "@ice/core";
import type { CompositeFrame, WidgetQuadPass } from "./widget-quad-pass";

/**
 * Where a wake came from. Named rather than boolean so a stuck-awake
 * compositor is diagnosable — "which source keeps marking?" is the first
 * question when idle-zero regresses.
 */
export type CompositorDirtSource =
  | "camera"
  | "viewport"
  | "sibling-order"
  | "dom"
  | "island"
  | "video"
  | "promotion";

/** The swap-chain seam. Kept narrow so tests can count acquisitions. */
export interface CompositeTarget {
  readonly format: GPUTextureFormat;
  /**
   * MUST NOT be called on a quiet frame — that ordering IS the idle-zero law.
   */
  getCurrentTexture(): GPUTexture;
  /** Current backbuffer size in DEVICE pixels. */
  size(): { readonly width: number; readonly height: number; readonly dpr: number };
}

export interface CompositorReflector extends ReflectorDef {
  /** Latch presentation dirt from outside the world (plan §4.2). */
  mark(source: CompositorDirtSource): void;
  /** True while a wake is pending. */
  isDirty(): boolean;
  /** Wake reasons since the last composite, in mark order (diagnostics). */
  pendingReasons(): readonly CompositorDirtSource[];
  /** Flushes that found dirt and did the work. */
  composites(): number;
  /** Flushes that found nothing and returned before touching the target. */
  quiet(): number;
  /** Times the target was acquired — must equal `composites()` exactly. */
  acquisitions(): number;
  dispose(): void;
}

export interface CompositorReflectorOpts {
  readonly world: World;
  readonly registry: CompositorSourceRegistry;
  readonly quadPass: WidgetQuadPass;
  /** Required to encode; absent ⇒ the reflector tracks dirt and draws nothing. */
  readonly device?: GPUDevice;
  /** Absent at S1 — ground still presents itself; see the header. */
  readonly target?: CompositeTarget;
  /** Clear colour for the composite pass. Transparent by default. */
  readonly clearValue?: GPUColor;
  /**
   * Run just before the pass is encoded, on compositing frames only: where
   * sources bring their pixels up to date (dom slot copies, island renders).
   *
   * It must be BEFORE `beginRenderPass`, not inside it, because these are
   * QUEUE operations — the queue runs them in issue order relative to the
   * submit that follows, which is what makes the pass sample this frame's
   * pixels rather than last frame's.
   *
   * A quiet frame never reaches here: idle-zero is upstream of it.
   */
  readonly prepare?: (frame: CompositeFrame) => void;
}

export function createCompositorReflector(opts: CompositorReflectorOpts): CompositorReflector {
  const { world, registry, quadPass, device, target } = opts;

  let dirty = true; // first flush composites unconditionally (the reflector-registry rule)
  let reasons: CompositorDirtSource[] = [];
  let composites = 0;
  let quiet = 0;
  let acquisitions = 0;
  let disposed = false;

  const mark = (source: CompositorDirtSource): void => {
    if (disposed) return;
    dirty = true;
    // Bounded: a pan marks "camera" every frame, and the reason list is a
    // diagnostic, not a log.
    if (!reasons.includes(source)) reasons.push(source);
  };

  const unsubs: Array<() => void> = [
    world.reactive.observeResource(Camera, () => mark("camera")),
    world.reactive.observeResource(Viewport, () => mark("viewport")),
    // Membership and promotion both surface as registry changes: a promotion
    // registers or unregisters a source through the ONE `setPresentation` door.
    registry.onChange(() => mark("promotion")),
  ];

  const reflector: CompositorReflector = {
    name: "compositor",
    // Self-gated on the private dirty union — the every-frame cost is one
    // boolean check (the ground layer's precedent).
    always: true,
    flush(_w: World) {
      if (!dirty) {
        // THE LAW: return before the target is touched.
        quiet++;
        return;
      }
      dirty = false;
      reasons = [];
      composites++;

      if (device === undefined || target === undefined) return; // S1: nothing to present onto

      const { width, height, dpr } = target.size();
      const cam = world.getResource(Camera) ?? { x: 0, y: 0, zoom: 1 };
      const frame: CompositeFrame = {
        width,
        height,
        dpr,
        camera: { x: cam.x, y: cam.y, zoom: cam.zoom },
      };

      // Sources refresh their pixels first (queue operations, ordered ahead of
      // the submit below).
      opts.prepare?.(frame);

      acquisitions++;
      const view = target.getCurrentTexture().createView();
      const encoder = device.createCommandEncoder({ label: "compositor" });
      const pass = encoder.beginRenderPass({
        label: "compositor-pass",
        colorAttachments: [
          {
            view,
            clearValue: opts.clearValue ?? { r: 0, g: 0, b: 0, a: 0 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      // Ground programs slot in ahead of the widget quads from S5; until then
      // ground presents itself and this pass carries only the quads.
      quadPass.encode(pass, frame);
      pass.end();
      // ONE encoder, ONE pass, ONE submit per composite (§4).
      device.queue.submit([encoder.finish()]);
    },
    mark,
    isDirty: () => dirty,
    pendingReasons: () => reasons,
    composites: () => composites,
    quiet: () => quiet,
    acquisitions: () => acquisitions,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const u of unsubs) u();
      unsubs.length = 0;
      quadPass.dispose();
    },
  };
  return reflector;
}
