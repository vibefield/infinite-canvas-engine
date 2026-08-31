/** Analytic procedural line grid; no ECS/content sources. */
import type { GridConfig } from "@ice/core";
import {
  abs,
  clamp,
  float,
  fract,
  max,
  min,
  positionGeometry,
  screenCoordinate,
  smoothstep,
  uniform,
  vec4,
} from "three/tsl";
import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  Vector2,
  Vector3,
  type Node,
} from "three/webgpu";
import type { GroundFrame } from "../pass";

const FULLSCREEN_TRIANGLE = new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]);

export interface LineGridRenderer {
  readonly mesh: Mesh;
  setCamera(frame: GroundFrame, opacity?: number): void;
  configure(config: GridConfig): void;
  dispose(): void;
}

export function createLineGrid(config: GridConfig): LineGridRenderer {
  const uCamera = uniform(new Vector2(0, 0));
  const uZoom = uniform(1);
  const uDpr = uniform(1);
  const uPresentationOpacity = uniform(1);
  const uSpacings = uniform(new Vector3(...config.spacings));
  const uColor = uniform(new Vector3(...config.dotColor));
  const uAlpha = uniform(config.dotAlpha);
  const uFadeIn = uniform(new Vector2(...config.fadeIn));
  const uFadeOut = uniform(new Vector2(...config.fadeOut));
  const uWeight = uniform(new Vector2(...config.levelWeight));
  const effectiveZoom = uZoom.mul(uDpr);
  const world = screenCoordinate.xy.div(effectiveZoom).add(uCamera);

  let total: Node<"float"> = float(0);
  for (let index = 0; index < 3; index += 1) {
    const spacing = index === 0 ? uSpacings.x : index === 1 ? uSpacings.y : uSpacings.z;
    const cssSpacing = spacing.mul(uZoom);
    const rise = cssSpacing.sub(uFadeIn.x).div(uFadeIn.y.sub(uFadeIn.x));
    const fall = float(1).sub(cssSpacing.sub(uFadeOut.x).div(uFadeOut.y.sub(uFadeOut.x)));
    const opacity = clamp(min(rise, fall), 0, 1);
    const cell = fract(world.div(spacing).add(0.5)).sub(0.5);
    const distance = min(abs(cell.x), abs(cell.y)).mul(spacing).mul(effectiveZoom);
    const line = smoothstep(float(0.55).mul(uDpr).sub(0.5), float(0.55).mul(uDpr).add(0.5), distance).oneMinus();
    const weight = uWeight.x.add(float(index).mul(uWeight.y));
    total = max(total, line.mul(opacity).mul(weight));
  }

  const material = new MeshBasicNodeMaterial();
  material.vertexNode = vec4(positionGeometry.xy, 0, 1);
  material.fragmentNode = vec4(
    uColor,
    clamp(total.mul(uAlpha).mul(0.42).mul(uPresentationOpacity), 0, 1),
  );
  material.transparent = true;
  material.depthTest = false;
  material.depthWrite = false;

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(FULLSCREEN_TRIANGLE, 3));
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 0;

  return {
    mesh,
    setCamera(frame, opacity = 1) {
      uCamera.value.set(frame.camera.x, frame.camera.y);
      uZoom.value = frame.camera.zoom;
      uDpr.value = frame.dpr;
      uPresentationOpacity.value = opacity;
    },
    configure(next) {
      uSpacings.value.set(...next.spacings);
      uColor.value.set(...next.dotColor);
      uAlpha.value = next.dotAlpha;
      uFadeIn.value.set(...next.fadeIn);
      uFadeOut.value.set(...next.fadeOut);
      uWeight.value.set(...next.levelWeight);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
