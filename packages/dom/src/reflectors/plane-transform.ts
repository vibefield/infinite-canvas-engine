/**
 * The plane-transform reflector (design-002 §5 `planeTransform`; M3 exit gate,
 * widened for the M6 lifted plane).
 *
 * Observes the `Camera` RESOURCE and nothing else. Each flush reads the camera,
 * derives the ONE per-plane CSS transform via kernel `planeCssTransform` (the
 * sole owner of that math — Law 13), and writes it to EVERY camera-transformed
 * DOM plane in a SINGLE `style.transform` assignment each. Panning the whole
 * canvas is therefore O(1) in the DOM: one transform write per plane per moving
 * frame, independent of node count — the property that makes an infinite canvas
 * of 10k gray boxes pan at frame rate.
 *
 * The input is widened to `{ contentPlane; liftedPlane? }` (design-004 §1: P1 +
 * P3 share the one camera). A `CanvasHost` still satisfies it structurally, so
 * M3 callers are unchanged; M6 passes both planes and the lifted plane (P3)
 * tracks the content plane (P1) exactly, so a promoted widget keeps its world
 * position across the content→lifted re-parent.
 *
 * `transformWrites()` is the M3 instrument: because the reflector is dirty-
 * driven on the Camera resource (equality-suppressed — design-002 §5), a static
 * camera flushes zero times and the counter stays flat; every distinct camera
 * value bumps it exactly once. The frame-contract tests assert both halves.
 *
 * Law 10: reflectors run post-notify, write output only, and NEVER read layout
 * or write ECS — this flush touches only `host.contentPlane.style`.
 */
import { Camera, type ReflectorDef, type World } from "@ice/core";
import { planeCssTransform } from "@ice/kernel";

/**
 * The camera-transformed DOM plane(s). A `CanvasHost` satisfies this
 * structurally (M3 backward compat); M6 passes `liftedPlane` too so P3 tracks P1.
 */
export interface CameraPlanes {
  readonly contentPlane: HTMLElement;
  readonly liftedPlane?: HTMLElement;
}

export function createPlaneTransformReflector(
  host: CameraPlanes,
): ReflectorDef & { transformWrites(): number } {
  let writes = 0;
  return {
    name: "plane-transform",
    observe: { resources: [Camera] },
    flush(world: World) {
      const camera = world.getResource(Camera);
      if (camera === undefined) return;
      const { tx, ty, scale } = planeCssTransform(camera);
      const transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
      host.contentPlane.style.transform = transform;
      if (host.liftedPlane !== undefined) host.liftedPlane.style.transform = transform;
      writes++; // one flush per distinct camera value, regardless of plane count
    },
    transformWrites: () => writes,
  };
}
