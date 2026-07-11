/**
 * The grid reflector (design-004 §1 P0 ground plane; M6).
 *
 * Ports v1's dot-grid shader VERBATIM from
 * `../../../infinite-canvas/packages/infinite-canvas/src/webgl/renderers/GridRenderer.ts`:
 * the fragment shader body (world reconstruction from `gl_FragCoord`, three
 * fade-staged spacing levels, max-composited anti-aliased dots) is copied
 * unchanged from GridRenderer.ts:45-115, and `DEFAULT_GRID_CONFIG` from
 * GridRenderer.ts:27-35. v1 drove this through three.js (`ShaderMaterial` +
 * `WebGLRenderer`), but `@ice/dom` may not import three (the `dom-only-core-
 * kernel` cruiser rule: core + kernel only) — so this reflector talks to a raw
 * WebGL2/WebGL1 context directly. Same GLSL, same uniforms, same math; only the
 * plumbing that fed them (three's abstractions) is gone. The vertex shader is
 * simplified from a vec3 attribute (three's default) to vec2 — geometry only,
 * no shading logic, so "verbatim" is unaffected.
 *
 * P0 is a WebGL `<canvas>` mounted as the FIRST child of the host container
 * (design-004 §1: "ground" sits under P1's content-DOM). It is sized to the
 * container's CSS box × devicePixelRatio via a ResizeObserver — its own,
 * independent hit-path; the reflector's `flush` never reads layout (Law 10),
 * only the RO callback does, and only in response to the browser's own resize
 * notification. Camera uniforms (world top-left + zoom) come from the `Camera`
 * RESOURCE, mirroring plane-transform.ts's `observe` pattern; unlike P1's
 * single CSS transform, this plane recomputes per-pixel in the shader — the
 * world is regenerated from `gl_FragCoord` every draw, so there are no seams
 * at any zoom/pan.
 *
 * Fault isolation, locally too: `getContext` returns `null` in headless/happy-
 * dom (jsdom/happy-dom implement `<canvas>` but not WebGL) — `available()`
 * reports that, and `flush()` is a permanent, silent no-op. GL setup and every
 * draw call are wrapped so a driver/context-loss failure degrades to
 * `available() === false` rather than a throwing reflector (the registry has
 * its own fault isolation — a skipped frame on throw — but a reflector that
 * throws every single frame is still noise, design-002 §5).
 */
import { Camera, type ReflectorDef, type World } from "@ice/core";

// === Public config (mirrors v1 `GridConfig` — GridRenderer.ts:5-20 — field for field) ===

export interface GridConfig {
  /** World-unit spacings for up to 3 grid levels [fine, medium, coarse]. */
  spacings: [number, number, number];
  /** Dot RGB color as [r, g, b] in 0-1 range. */
  dotColor: [number, number, number];
  /** Base dot opacity multiplier (0-1). */
  dotAlpha: number;
  /** CSS-pixel range where a grid level fades in: [start, end]. */
  fadeIn: [number, number];
  /** CSS-pixel range where a grid level fades out: [start, end]. */
  fadeOut: [number, number];
  /** Dot radius range in CSS pixels [min, max]. Scaled by DPR internally. */
  dotRadius: [number, number];
  /** Per-level opacity weight: level i gets (base + i * step). */
  levelWeight: [number, number];
}

/** Verbatim from GridRenderer.ts:27-35 (tuned to match Apple Freeform / FigJam). */
export const DEFAULT_GRID_CONFIG: GridConfig = {
  spacings: [20, 100, 500],
  dotColor: [0.75, 0.77, 0.8],
  dotAlpha: 1.0,
  fadeIn: [8, 16],
  fadeOut: [120, 200],
  dotRadius: [0.75, 0.75],
  levelWeight: [1.0, 0.0],
};

interface GridHost {
  readonly container: HTMLElement;
}

// === Shader source (fragment body verbatim from GridRenderer.ts:45-115) ===

const VERTEX_SHADER = /* glsl */ `
attribute vec2 position;
void main() {
	gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform vec2 u_resolution;    // device pixels
uniform vec2 u_camera;        // world-space top-left
uniform float u_zoom;         // CSS zoom
uniform float u_dpr;          // device pixel ratio
uniform vec3 u_spacings;      // world-unit grid spacings
uniform vec3 u_dotColor;      // dot RGB
uniform float u_dotAlpha;     // dot base alpha
uniform vec2 u_fadeIn;        // CSS-px [start, end]
uniform vec2 u_fadeOut;       // CSS-px [start, end]
uniform vec2 u_dotRadius;     // CSS-px [min, max]
uniform vec2 u_levelWeight;   // [base, step]

void main() {
	vec2 devicePos = gl_FragCoord.xy;
	devicePos.y = u_resolution.y - devicePos.y;

	float effectiveZoom = u_zoom * u_dpr;
	vec2 worldPos = devicePos / effectiveZoom + u_camera;

	float totalAlpha = 0.0;

	for (int i = 0; i < 3; i++) {
		float spacing;
		if (i == 0) spacing = u_spacings.x;
		else if (i == 1) spacing = u_spacings.y;
		else spacing = u_spacings.z;

		// Screen spacing in CSS pixels (DPR-independent for consistent fading)
		float cssSpacing = spacing * u_zoom;

		// Fade curve
		float opacity = 0.0;
		if (cssSpacing >= u_fadeIn.x && cssSpacing < u_fadeIn.y) {
			opacity = (cssSpacing - u_fadeIn.x) / (u_fadeIn.y - u_fadeIn.x);
		} else if (cssSpacing >= u_fadeIn.y && cssSpacing < u_fadeOut.x) {
			opacity = 1.0;
		} else if (cssSpacing >= u_fadeOut.x && cssSpacing < u_fadeOut.y) {
			opacity = 1.0 - (cssSpacing - u_fadeOut.x) / (u_fadeOut.y - u_fadeOut.x);
		}
		if (opacity <= 0.001) continue;

		// Distance to nearest grid intersection in device pixels
		vec2 f = fract(worldPos / spacing + 0.5) - 0.5;
		float dist = length(f) * spacing * effectiveZoom;

		// Dot radius in device pixels — optionally grows for sparser levels
		// (set u_dotRadius.x == u_dotRadius.y for Freeform/FigJam-style
		// constant-size dots)
		float t = clamp((cssSpacing - u_fadeIn.x) / 40.0, 0.0, 1.0);
		float radius = mix(u_dotRadius.x, u_dotRadius.y, t) * u_dpr;

		// Anti-aliased dot (0.5 device pixel smoothstep)
		float dot = 1.0 - smoothstep(radius - 0.5, radius + 0.5, dist);

		// Per-level weight: base + i * step. Step=0 keeps all levels at equal
		// intensity; positive step emphasizes coarser levels (CAD feel).
		float weight = u_levelWeight.x + float(i) * u_levelWeight.y;

		// Composite with max, not sum. Additive compositing causes anti-
		// aliased dot rims to stack at joint intersections (every N-th dot
		// visibly fatter — a CAD tell). max() guarantees a joint intersection
		// looks identical to a single-level dot, matching Freeform / FigJam.
		totalAlpha = max(totalAlpha, dot * opacity * weight);
	}

	gl_FragColor = vec4(u_dotColor, clamp(totalAlpha * u_dotAlpha, 0.0, 1.0));
}
`;

const FULLSCREEN_TRIANGLE = new Float32Array([-1, -1, 3, -1, -1, 3]);

const UNIFORM_NAMES = [
  "u_resolution",
  "u_camera",
  "u_zoom",
  "u_dpr",
  "u_spacings",
  "u_dotColor",
  "u_dotAlpha",
  "u_fadeIn",
  "u_fadeOut",
  "u_dotRadius",
  "u_levelWeight",
] as const;

type UniformName = (typeof UNIFORM_NAMES)[number];
type GLContext = WebGLRenderingContext | WebGL2RenderingContext;

function compileShader(gl: GLContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (shader === null) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function linkProgram(gl: GLContext): WebGLProgram | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (vs === null || fs === null) return null;
  const program = gl.createProgram();
  if (program === null) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  const linked = gl.getProgramParameter(program, gl.LINK_STATUS) === true;
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!linked) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

/** Fullscreen-triangle vertex buffer, bound to the `position` attribute. Returns false on any setup failure. */
function setupGeometry(gl: GLContext, program: WebGLProgram): boolean {
  const buffer = gl.createBuffer();
  if (buffer === null) return false;
  const loc = gl.getAttribLocation(program, "position");
  if (loc < 0) return false;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, FULLSCREEN_TRIANGLE, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  return true;
}

function collectUniforms(gl: GLContext, program: WebGLProgram): Record<UniformName, WebGLUniformLocation | null> {
  const out = {} as Record<UniformName, WebGLUniformLocation | null>;
  for (const name of UNIFORM_NAMES) out[name] = gl.getUniformLocation(program, name);
  return out;
}

export function createGridReflector(
  host: GridHost,
  opts: Partial<GridConfig> = {},
): ReflectorDef & { available(): boolean; dispose(): void; configure(next: Partial<GridConfig>): void } {
  const config: GridConfig = { ...DEFAULT_GRID_CONFIG, ...opts };
  const doc = host.container.ownerDocument;

  const canvas = doc.createElement("canvas");
  canvas.style.position = "absolute";
  canvas.style.left = "0";
  canvas.style.top = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  // P0 is never a DOM hit target — the router does its own spatial-index pick
  // (design-004 §4); this plane must not shadow the L0 adapter's listeners.
  canvas.style.pointerEvents = "none";
  host.container.insertBefore(canvas, host.container.firstChild);

  let gl: GLContext | null = null;
  let program: WebGLProgram | null = null;
  let uniforms: Record<UniformName, WebGLUniformLocation | null> | null = null;
  let dpr = 1;
  let lastCamera = { x: 0, y: 0, zoom: 1 };

  try {
    const attrs: WebGLContextAttributes = { alpha: true, antialias: false, premultipliedAlpha: false };
    gl =
      (canvas.getContext("webgl2", attrs) as WebGL2RenderingContext | null) ??
      (canvas.getContext("webgl", attrs) as WebGLRenderingContext | null);
    if (gl !== null) {
      const prog = linkProgram(gl);
      if (prog !== null && setupGeometry(gl, prog)) {
        program = prog;
        uniforms = collectUniforms(gl, prog);
      } else {
        gl = null;
      }
    }
  } catch {
    gl = null;
    program = null;
    uniforms = null;
  }

  function draw(camera: { x: number; y: number; zoom: number }): void {
    if (gl === null || program === null || uniforms === null) return;
    lastCamera = camera;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.uniform2f(uniforms.u_resolution, canvas.width, canvas.height);
    gl.uniform2f(uniforms.u_camera, camera.x, camera.y);
    gl.uniform1f(uniforms.u_zoom, camera.zoom);
    gl.uniform1f(uniforms.u_dpr, dpr);
    gl.uniform3f(uniforms.u_spacings, ...config.spacings);
    gl.uniform3f(uniforms.u_dotColor, ...config.dotColor);
    gl.uniform1f(uniforms.u_dotAlpha, config.dotAlpha);
    gl.uniform2f(uniforms.u_fadeIn, ...config.fadeIn);
    gl.uniform2f(uniforms.u_fadeOut, ...config.fadeOut);
    gl.uniform2f(uniforms.u_dotRadius, ...config.dotRadius);
    gl.uniform2f(uniforms.u_levelWeight, ...config.levelWeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Resize the backing buffer to `cssWidth/cssHeight × dpr` and repaint from the last known camera. */
  function applySize(cssWidth: number, cssHeight: number): void {
    dpr = doc.defaultView?.devicePixelRatio ?? 1;
    const bufW = Math.max(1, Math.round(cssWidth * dpr));
    const bufH = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width !== bufW) canvas.width = bufW;
    if (canvas.height !== bufH) canvas.height = bufH;
    try {
      draw(lastCamera);
    } catch {
      gl = null;
      program = null;
      uniforms = null;
    }
  }

  // Best-effort initial size (real browsers have a laid-out box synchronously
  // on creation; headless DOMs without a layout engine report 0×0 here, which
  // is harmless — the canvas just waits for the observer's first real tick).
  const initialRect = host.container.getBoundingClientRect();
  applySize(initialRect.width, initialRect.height);

  let ro: ResizeObserver | undefined;
  try {
    ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      applySize(entry.contentRect.width, entry.contentRect.height);
    });
    ro.observe(host.container);
  } catch {
    // No ResizeObserver in this environment — the canvas keeps its initial
    // (possibly 0×0) size. Never fatal: `available()` is orthogonal to sizing.
  }

  return {
    name: "grid",
    observe: { resources: [Camera] },
    flush(world: World) {
      if (gl === null) return;
      const camera = world.getResource(Camera);
      if (camera === undefined) return;
      try {
        draw(camera);
      } catch {
        gl = null;
        program = null;
        uniforms = null;
      }
    },
    available: () => gl !== null,
    // Live re-tune (theme switches, settings panels): draw() uploads every
    // config uniform per call, so a merge + one redraw at the last camera is
    // the whole story. Outside the frame contract by design — config is host
    // input, not world state (same class as the RO resize path).
    configure(next: Partial<GridConfig>) {
      Object.assign(config, next);
      if (gl !== null) {
        try {
          draw(lastCamera);
        } catch {
          gl = null;
          program = null;
          uniforms = null;
        }
      }
    },
    // Unregistering a reflector only stops its flushes — the canvas this
    // factory inserted (and its ResizeObserver) must be torn down explicitly,
    // or a React StrictMode remount stacks a second frozen grid under the
    // live one (field report 2026-07-11).
    dispose() {
      ro?.disconnect();
      gl = null;
      program = null;
      uniforms = null;
      canvas.remove();
    },
  };
}
