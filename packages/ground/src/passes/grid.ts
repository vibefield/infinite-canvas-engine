/**
 * The dot-grid pass — TSL port of the raw-WebGL grid (itself verbatim from v1
 * GridRenderer.ts; the fragment math below is that shader re-expressed as a
 * node graph, level loop unrolled in JS). Screen-space: a fullscreen triangle
 * whose vertex stage passes clip coords through; the fragment reconstructs
 * world position from `screenCoordinate` (top-left device px on BOTH backends
 * — three normalizes, so the old manual y-flip is gone) + camera uniforms.
 *
 * One deliberate re-expression: the GLSL if/else fade ladder became the
 * closed form `clamp(min(rise, fall), 0, 1)` — identical piecewise output
 * (rise 0→1 across fadeIn, plateau 1, fall 1→0 across fadeOut) with no
 * branching. Everything else (fract-distance dots, 0.5-device-px AA,
 * max-composited levels) matches term for term.
 */
import { DEFAULT_GRID_CONFIG, type GridConfig } from "@ice/core";
import {
  clamp,
  float,
  fract,
  length,
  max,
  min,
  mix,
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
import type { GroundFrame, GroundPass } from "../pass";

const FULLSCREEN_TRIANGLE = new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]);

export interface GridPass extends GroundPass {
  /** Live re-tune (the react `grid` prop seam) — partial merge over current values. */
  configure(cfg: Partial<GridConfig>): void;
}

export function createGridPass(initial: Partial<GridConfig> = {}): GridPass {
  let cfg: GridConfig = { ...DEFAULT_GRID_CONFIG, ...initial };

  // Camera facts (layer-written each collect).
  const uCamera = uniform(new Vector2(0, 0));
  const uZoom = uniform(1);
  const uDpr = uniform(1);
  // Config (configure-written).
  const uSpacings = uniform(new Vector3(...cfg.spacings));
  const uDotColor = uniform(new Vector3(...cfg.dotColor));
  const uDotAlpha = uniform(cfg.dotAlpha);
  const uFadeIn = uniform(new Vector2(...cfg.fadeIn));
  const uFadeOut = uniform(new Vector2(...cfg.fadeOut));
  const uDotRadius = uniform(new Vector2(...cfg.dotRadius));
  const uLevelWeight = uniform(new Vector2(...cfg.levelWeight));

  const effZoom = uZoom.mul(uDpr);
  const worldPos = screenCoordinate.xy.div(effZoom).add(uCamera);

  let total: Node<"float"> = float(0);
  for (let i = 0; i < 3; i++) {
    const spacing = i === 0 ? uSpacings.x : i === 1 ? uSpacings.y : uSpacings.z;
    const cssSpacing = spacing.mul(uZoom);
    // Fade ladder, closed form (see header).
    const rise = cssSpacing.sub(uFadeIn.x).div(uFadeIn.y.sub(uFadeIn.x));
    const fall = float(1).sub(cssSpacing.sub(uFadeOut.x).div(uFadeOut.y.sub(uFadeOut.x)));
    const opacity = clamp(min(rise, fall), 0, 1);
    // Distance to the nearest grid intersection, in device px.
    const f = fract(worldPos.div(spacing).add(0.5)).sub(0.5);
    const dist = length(f).mul(spacing).mul(effZoom);
    // Radius optionally grows toward sparser levels (min==max ⇒ constant dots).
    const t = clamp(cssSpacing.sub(uFadeIn.x).div(40), 0, 1);
    const radius = mix(uDotRadius.x, uDotRadius.y, t).mul(uDpr);
    // Anti-aliased dot (0.5 device-px smoothstep), max-composited across levels
    // (additive stacking fattens joint intersections — the CAD tell).
    const dot = smoothstep(radius.sub(0.5), radius.add(0.5), dist).oneMinus();
    const weight = uLevelWeight.x.add(float(i).mul(uLevelWeight.y));
    total = max(total, dot.mul(opacity).mul(weight));
  }

  const material = new MeshBasicNodeMaterial();
  material.vertexNode = vec4(positionGeometry.xy, 0, 1); // clip-space passthrough
  material.fragmentNode = vec4(uDotColor, clamp(total.mul(uDotAlpha), 0, 1));
  material.transparent = true;
  material.depthTest = false;
  material.depthWrite = false;

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(FULLSCREEN_TRIANGLE, 3));
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 0;

  return {
    name: "grid",
    object: mesh,
    arm: () => [], // camera/resize dirt is layer-owned; config re-tunes call invalidate
    collect(_world, frame: GroundFrame) {
      uCamera.value.set(frame.camera.x, frame.camera.y);
      uZoom.value = frame.camera.zoom;
      uDpr.value = frame.dpr;
    },
    configure(next) {
      cfg = { ...cfg, ...next };
      uSpacings.value.set(...cfg.spacings);
      uDotColor.value.set(...cfg.dotColor);
      uDotAlpha.value = cfg.dotAlpha;
      uFadeIn.value.set(...cfg.fadeIn);
      uFadeOut.value.set(...cfg.fadeOut);
      uDotRadius.value.set(...cfg.dotRadius);
      uLevelWeight.value.set(...cfg.levelWeight);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
