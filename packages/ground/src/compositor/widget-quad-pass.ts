/**
 * `WidgetQuadPass` — the widget half of the unified compositor (design-012 §4,
 * plan §1). SKELETON at S1, by the ladder: it owns the seam, the ordering and
 * the arm-on-demand gate, and it draws nothing, because no source kind exists
 * to draw yet. dom sources arrive at S2 (atlas slots), gl at S5, video at S7.
 *
 * What is REAL here and load-bearing now:
 *
 *  - It consumes the `CompositorSourceRegistry` from core, so producers reach
 *    the compositor without anyone importing `ground` (which nothing may).
 *  - Paint order is the frame-parent SIBLING SEQUENCE (petition 8), supplied as
 *    a seam rather than read here — registration order is emphatically NOT
 *    paint order, and the skeleton must not accidentally establish that it is.
 *  - It is LAZY: with an empty registry it creates no pipeline, no buffer and
 *    no bind group. An "empty compositor" that still allocated a pipeline at
 *    boot would put GPU cost on the stratified-equivalent path and quietly
 *    make the S1 pixel-compare a comparison of two different renderers.
 *
 * What is deliberately NOT here yet: the WGSL. Rounded-rect analytic AA, the
 * sRGB re-encode guarded by the target's ACTUAL format, and premultiplied
 * blending are all specified (§4) and all proven in the spike — but a shader
 * that no source exercises cannot be validated, and shipping unvalidated WGSL
 * as "landed" is the kind of claim this project's exits exist to prevent. It
 * lands with the first real source, against a pixel oracle.
 */
import type { CompositorSourceRegistry } from "@ice/core";
import type { Entity } from "@vibecook/strata-ecs";

/** Per-composite frame facts, in DEVICE pixels (the swap chain's own space). */
export interface CompositeFrame {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  /** Engine camera: world top-left + zoom (the GroundFrame contract). */
  readonly camera: { readonly x: number; readonly y: number; readonly zoom: number };
}

export interface WidgetQuadPassDeps {
  readonly device: GPUDevice;
  /** The compositor target's format — the sRGB guard reads this, never assumes. */
  readonly format: GPUTextureFormat;
  readonly registry: CompositorSourceRegistry;
  /**
   * Paint order: the entities to draw, back to front, in frame-parent sibling
   * sequence (petition 8). Omitted ⇒ registry order, which is correct ONLY
   * while the registry is empty and is why this is a required seam from S2 on.
   */
  readonly order?: () => readonly Entity[];
}

export interface WidgetQuadPass {
  readonly name: string;
  /** Quads encoded by the most recent `encode` (0 on an empty registry). */
  drawn(): number;
  /** True once GPU resources have actually been built — never, while empty. */
  armed(): boolean;
  /**
   * Encode this frame's widget quads into an ALREADY-OPEN render pass. One
   * encoder, one pass, one submit per composite is the compositor's contract
   * (§4), so this pass never opens or submits anything of its own.
   * Returns the number of quads encoded.
   */
  encode(pass: GPURenderPassEncoder, frame: CompositeFrame): number;
  dispose(): void;
}

export function createWidgetQuadPass(deps: WidgetQuadPassDeps): WidgetQuadPass {
  let drawn = 0;
  let armed = false;

  const paintOrder = (): readonly Entity[] => {
    if (deps.order !== undefined) return deps.order();
    const out: Entity[] = [];
    for (const [entity] of deps.registry.entries()) out.push(entity);
    return out;
  };

  return {
    name: "widget-quads",
    drawn: () => drawn,
    armed: () => armed,
    encode(_pass, _frame) {
      drawn = 0;
      // Empty registry ⇒ draws nothing, allocates nothing, touches no GPU
      // object. This is the S1 exit condition in one branch.
      if (deps.registry.size() === 0) return 0;

      // From S2: arm (pipeline + uniform buffer + sampler) on first use, then
      // walk `paintOrder()` and encode one quad per registered source. Until a
      // source kind exists, reaching here means a producer registered ahead of
      // the compositor leg that can sample it — say so rather than drawing a
      // wrong frame or silently skipping.
      const pending = paintOrder().length;
      if (pending > 0) {
        console.warn(
          `[ice] compositor: ${pending} source(s) registered, but no source kind composites yet (S1 skeleton) — nothing drawn`,
        );
      }
      return 0;
    },
    dispose() {
      armed = false;
      drawn = 0;
    },
  };
}
