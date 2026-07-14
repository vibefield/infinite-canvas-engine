import { ShaderMaterial } from "three";
import type { Texture } from "three";

/**
 * Neutral composite material for the island compositor (design-004 §3). One
 * instance per island quad: it samples the island's FBO texture and writes it to
 * the canvas backbuffer at `uOpacity`, with no look of its own.
 *
 * Ported from v1 `CompositionMaterial`
 * (../infinite-canvas .../r3f/compositor/CompositionMaterial.ts) STRIPPED to the
 * engine-neutral core per design-004 §3 rev 2: the v1 app-specific uniforms and
 * shader branches — the `uHotPoint`/`uHotStrength`/`uIsOverlapTarget` overlap
 * glow, the rim band, and the module-level `sharedGlowUniforms` — are DELETED.
 * Userland looks belong in userland materials (and, as of the chrome sandwich,
 * in DOM CSS).
 *
 * `uDraggedRect`/`uIsDragged` are RESTORED (2026-07-13 amendment): with
 * `defineWidget.chrome` an ENGINE feature, a dragged GL card's DOM chrome
 * lives in P1 under every other quad — neighbor fragments inside the dragged
 * card's rect must discard so the chrome+content pair floats whole (v1's
 * RFC-003 clip, re-cut from screen-space gl_FragCoord to composite-space
 * `vWorld`, so it is DPR/Y-flip-free by construction). This is compositing
 * CORRECTNESS for an engine feature, not an app look. Rect (0,0,0,0) = off.
 *
 * What is KEPT verbatim is the colour-management contract: the FBO already holds
 * sRGB-encoded, display-ready values (RenderTargetPool sets
 * `texture.colorSpace = SRGBColorSpace`), so this pass must sample-and-write
 * WITHOUT tone mapping. See the fragment-shader note below for the sRGB
 * double-encode trap and why the `<colorspace_fragment>` chunk is still required.
 */

const VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
varying vec2 vWorld;
void main() {
  vUv = uv;
  vWorld = (modelMatrix * vec4(position, 1.0)).xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Fragment shader. There is deliberately NO <tonemapping_fragment> chunk — the
// FBO holds sRGB values already, so tone mapping would double-process them.
//
// The trailing <colorspace_fragment> chunk IS required, and this is the subtle
// part (the sRGB double-encode trap): Three's texture sampler auto-DECODES the
// sRGB FBO to linear during texture2D (because RenderTargetPool declares the
// target's colorSpace = SRGBColorSpace). Without re-encoding to the renderer's
// outputColorSpace (also sRGB) via <colorspace_fragment>, those linear values
// would land in the backbuffer and read as washed-out / desaturated. So: no tone
// map, but DO re-encode — a straight round-trip that leaves the island's pixels
// exactly as painted.
const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D map;
uniform float uOpacity;
uniform vec4 uDraggedRect;
uniform float uIsDragged;
varying vec2 vUv;
varying vec2 vWorld;

void main() {
  // Drag clip (v1 RFC-003, composite-space): while a chrome-carrying GL card
  // is dragged, every OTHER quad discards fragments inside its rect so the
  // card's P1 DOM chrome shows through. (0,0,0,0) rect ⇒ measure-zero, off.
  if (uIsDragged < 0.5 &&
      vWorld.x >= uDraggedRect.x && vWorld.x <= uDraggedRect.z &&
      vWorld.y >= uDraggedRect.y && vWorld.y <= uDraggedRect.w) {
    discard;
  }
  vec4 c = texture2D(map, vUv);
  if (c.a < 0.001) discard;
  c.a *= uOpacity;
  gl_FragColor = c;
  #include <colorspace_fragment>
}
`;

/**
 * Per-island composite material. Each island quad gets its own instance so the
 * per-quad `map` uniform is independent; Three compiles the shader once and
 * reuses the program across instances since they share source (verify in dev via
 * `renderer.info.programs.length === 1` for the composite shader).
 */
export class CompositeMaterial extends ShaderMaterial {
  // Direct handles onto our two uniform cells. ShaderMaterial types `uniforms`
  // as an index signature, so `this.uniforms.map` reads as possibly-undefined
  // under strict indexing; holding the cells we created sidesteps that and keeps
  // the setters allocation-free.
  private readonly mapUniform: { value: Texture | null };
  private readonly opacityUniform: { value: number };
  private readonly draggedRectUniform: { value: [number, number, number, number] };
  private readonly isDraggedUniform: { value: number };

  constructor() {
    const uniforms = {
      map: { value: null as Texture | null },
      uOpacity: { value: 1 },
      // three uploads number[] as vec4 — no Vector4 allocation needed.
      uDraggedRect: { value: [0, 0, 0, 0] as [number, number, number, number] },
      uIsDragged: { value: 0 },
    };
    super({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms,
      transparent: true,
      depthWrite: false,
      // Explicit: this pass must never tone-map (the FBO is already display-
      // ready). v1 left toneMapped at the ShaderMaterial default and relied on
      // the absent tonemapping chunk alone (CompositionMaterial.ts:140-142); we
      // set it false so the no-tone-map contract holds even if the shader ever
      // gains chunks. Behaviour is identical for the current shader.
      toneMapped: false,
    });
    // ShaderMaterial keeps the passed `uniforms` object by reference, so these
    // handles stay in sync with `this.uniforms`.
    this.mapUniform = uniforms.map;
    this.opacityUniform = uniforms.uOpacity;
    this.draggedRectUniform = uniforms.uDraggedRect;
    this.isDraggedUniform = uniforms.uIsDragged;
  }

  /** Bind the island's FBO texture (null clears). */
  setMap(map: Texture | null): void {
    this.mapUniform.value = map;
  }

  /** Composite opacity. Pass-through — no clamping; callers pass valid 0..1. */
  setOpacity(opacity: number): void {
    this.opacityUniform.value = opacity;
  }

  /**
   * Drag clip, composite-space min/max (v1's uDraggedRect re-cut from screen
   * space). (0,0,0,0) = inactive. Mutates the vec4 in place — no allocation.
   */
  setDraggedRect(minX: number, minY: number, maxX: number, maxY: number): void {
    const r = this.draggedRectUniform.value;
    r[0] = minX;
    r[1] = minY;
    r[2] = maxX;
    r[3] = maxY;
  }

  /** True on the dragged card's own quad — exempt from the clip. */
  setIsDragged(isDragged: boolean): void {
    this.isDraggedUniform.value = isDragged ? 1 : 0;
  }

  // dispose() is inherited from ShaderMaterial — it fires the dispose event that
  // frees the compiled program; no override needed.
}
