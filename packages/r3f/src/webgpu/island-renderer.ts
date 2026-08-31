/**
 * THE INCANTATION (design-012 §4 "Device"; plan §5 S5.1) — three on the
 * app-owned device.
 *
 * This is the ONLY file in `@ice/r3f` that imports `three/webgpu`, and it is
 * reached through the `@ice/r3f/webgpu` subpath rather than the package barrel.
 * That is not tidiness: three declares `sideEffects: ["./src/nodes/**\/*"]`, so
 * a `three/webgpu` edge anywhere in the graph survives tree-shaking and drags
 * the node material system into the bundle. A stratified app must not pay for a
 * profile it does not build, so the edge exists only where an app opts in by
 * importing this path.
 *
 * Verified against three 0.185.1 in this worktree — every claim below is a line
 * that was read, not a note carried from the spike:
 *
 *  1. ADOPTION. `WebGPUBackend.init()` branches on `parameters.device`: absent
 *     ⇒ it requests its own adapter and device; present ⇒ `device =
 *     parameters.device` and nothing is requested (`WebGPUBackend.js:207-252`).
 *  2. NEVER DESTROYED. `dispose()` destroys the device only when it made it:
 *     `if (this.parameters.device === undefined && this.device !== null)`
 *     (`:2902-2906`). So the app's device outlives any renderer teardown, which
 *     is the ownership direction design-012 §4 wants.
 *  3. COMPATIBILITY IS THE MSAA TRAP. `:254-258` reads
 *     `compatibilityMode = !device.features.has('core-features-and-limits')` and
 *     force-sets `renderer._samples = 0`. three's OWN adapter request asks for
 *     `featureLevel: 'compatibility'` (`:213`) — so a device we hand over is
 *     what KEEPS island MSAA, and `acquireCompositorDevice`'s rule 1 is the
 *     other half of this. Reported here as a fact rather than assumed: a caller
 *     gets `compatibilityMode` back and can refuse.
 *  4. `trackTimestamp` IS CONSTRUCTOR-ONLY. `Backend.js:76` reads it from
 *     `parameters` once; assigning `renderer.trackTimestamp = true` afterwards
 *     is silently inert.
 *
 * THE SCRATCH CANVAS. A canvas has exactly one context for its lifetime, and
 * the compositor needs `getContext('webgpu')` on the REAL canvas. Handing three
 * a detached 4×4 canvas it never presents is what keeps the two from racing for
 * that one context — whichever asked second would get null.
 *
 * NOT DONE HERE, deliberately: draining three's timestamp query pool. That
 * belongs to whoever turns profiling on, and on this base the ground layer
 * already does it (plan §6, S1 rebase: verified at `renderer.ts:291` against
 * the pool's own `resolveQueriesAsync`, which self-dedupes concurrent resolves).
 * Re-fixing it here would be a second owner for one pool.
 */
import { WebGPURenderer } from "three/webgpu";
import { backendDevice } from "../webgpu-backend";

export interface IslandRendererOpts {
  /** The app-owned device (`engine.compositorDevice.device`). */
  readonly device: GPUDevice;
  /**
   * Turn on three's GPU timestamps. MUST be decided here — see note 4. Whoever
   * sets this owns draining the query pool (`resolveTimestampsAsync`), or three
   * logs "Maximum number of queries exceeded" and silently stops reporting.
   */
  readonly trackTimestamp?: boolean;
  /**
   * The canvas three is given. Defaults to a fresh detached 4×4 scratch canvas,
   * which is what you want; injectable only so headless tests can pass a stub.
   */
  readonly canvas?: HTMLCanvasElement;
}

export interface IslandRenderer {
  readonly renderer: WebGPURenderer;
  /** `backend.device === device` — adoption proven by reference, not by behaviour. */
  readonly sharesDevice: boolean;
  /**
   * three's own verdict on the device it ended up with. TRUE means island MSAA
   * has been force-set to 0 and the composited profile is quietly rendering
   * aliased islands — see note 3.
   */
  readonly compatibilityMode: boolean;
  /** The scratch canvas, so a caller can keep it out of layout / dispose it. */
  readonly canvas: HTMLCanvasElement;
}

/** A detached canvas three can own without touching the compositor's. */
function scratchCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 4;
  return canvas;
}

/**
 * Build and initialise a `WebGPURenderer` on an existing device.
 *
 * Rejects if the device was not adopted, rather than returning a renderer that
 * works perfectly and shares nothing: a second device renders every island into
 * textures the compositor cannot bind, and the failure mode is an empty board
 * with no error — the exact silent-stratified trap §11 Q2 refuses at boot.
 */
export async function createIslandRenderer(opts: IslandRendererOpts): Promise<IslandRenderer> {
  const canvas = opts.canvas ?? scratchCanvas();
  const renderer = new WebGPURenderer({
    device: opts.device,
    canvas,
    // Island edges are geometry, so they get real MSAA (inside the targets —
    // the compositor target itself stays MSAA-free, design-012 §4).
    antialias: true,
    // Islands clear to transparent; the compositor paints the card fill behind
    // them, so an opaque island target would hide the rounded corners.
    alpha: true,
    ...(opts.trackTimestamp === true ? { trackTimestamp: true } : {}),
  });
  await renderer.init();

  const adopted = backendDevice(renderer);
  const sharesDevice = adopted === opts.device;
  if (!sharesDevice) {
    renderer.dispose();
    throw new Error(
      "[ice/r3f] WebGPURenderer did not adopt the injected device — islands would render into " +
        "textures the compositor cannot bind. three adopts via WebGPUBackend.init()'s " +
        "`parameters.device` branch; check that a real GPUDevice was passed.",
    );
  }

  const compatibilityMode = Boolean(
    (renderer as unknown as { backend?: { compatibilityMode?: boolean } }).backend?.compatibilityMode,
  );
  if (compatibilityMode) {
    // Loud, but not fatal: the frame is correct, just aliased. Refusing would
    // be worse than saying so — and `acquireCompositorDevice` already declines
    // to ask for a compatibility adapter, so reaching here means the HOST only
    // offers one, which is a fact about the machine and not a bug to throw at.
    console.warn(
      "[ice/r3f] the compositor device lacks `core-features-and-limits`, so three is in " +
        "compatibilityMode and has force-set renderer._samples = 0 — island MSAA is OFF " +
        "(three/WebGPUBackend.js:254-258).",
    );
  }

  return { renderer, sharesDevice, compatibilityMode, canvas };
}

/**
 * The same incantation shaped as an R3F `<Canvas gl={…}>` factory.
 *
 * R3F 9.6.1 accepts an async renderer factory
 * (`GLProps = … | ((defaultProps) => Promise<Renderer>) | …`, `renderer.d.ts`),
 * which is what lets `renderer.init()` be awaited before React commits — so
 * the very first `advance()` already has a live backend.
 *
 * R3F's own canvas element is IGNORED on purpose: three paints only into render
 * targets here and never presents, so the element R3F mounted stays blank. In
 * the composited profile it is the compositor's canvas that shows, and the app
 * should keep R3F's out of the way (`display:none` or a zero-size box) rather
 * than stacking an empty second canvas over the visible one.
 */
export function islandRendererFactory(opts: IslandRendererOpts) {
  return async (): Promise<WebGPURenderer> => (await createIslandRenderer(opts)).renderer;
}
