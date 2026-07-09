/**
 * The plane-transform reflector (design-002 §5 `planeTransform`; M3 exit gate).
 *
 * Observes the `Camera` RESOURCE and nothing else. Each flush reads the camera,
 * derives the ONE per-plane CSS transform via kernel `planeCssTransform` (the
 * sole owner of that math — Law 13), and writes it to the content plane in a
 * SINGLE `style.transform` assignment. Panning the whole canvas is therefore
 * O(1) in the DOM: one transform write per plane per moving frame, independent
 * of node count — the property that makes an infinite canvas of 10k gray boxes
 * pan at frame rate.
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
import type { CanvasHost } from "../host";

export function createPlaneTransformReflector(
  host: CanvasHost,
): ReflectorDef & { transformWrites(): number } {
  let writes = 0;
  return {
    name: "plane-transform",
    observe: { resources: [Camera] },
    flush(world: World) {
      const camera = world.getResource(Camera);
      if (camera === undefined) return;
      const { tx, ty, scale } = planeCssTransform(camera);
      host.contentPlane.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
      writes++;
    },
    transformWrites: () => writes,
  };
}
