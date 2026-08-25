/**
 * The MAGNET grid renderer — TSL port of vibe-field draft/magnet-grid's
 * `magnet.wgsl` (design-010 §5). Three instanced-quad meshes (one per lattice
 * level) whose vertex stage reconstructs sites from `instanceIndex`, evaluates
 * the field (superposition of rounded-box SDF sources; poles are DEGENERATE
 * boxes with half = 0, r = 0 — D3), and shapes the glyph (needle orients
 * along the field; dot swells with |field|).
 *
 * Deltas from the WGSL, per design-010:
 *  - ONE source buffer (storage, read-only, `setPBO` for the WebGL fallback —
 *    D4); the mouse uniform / `mouseOn` branch are deleted.
 *  - fade ladder, level weight and dotAlpha are CPU-baked into ONE per-level
 *    alpha (they are per-level constants per frame — magnet-collect owns them).
 *  - dot rest radius comes from `GridConfig.dotRadius[0]` (config continuity
 *    with the classic grid), not the WGSL's hardcoded `halfLen·0.16`.
 *  - coincidence skip (§5.4): sites shared with a visible coarser level drop
 *    out (integer spacing ratios), replicating the classic max-composite look.
 *  - NDC is computed from CSS-px directly (the WGSL path) — glyph sizes are
 *    CSS px, DPR rides the viewport; the layer's ortho camera is bypassed.
 */
import type { GridConfig, GridMagnetConfig } from "@ice/core";
import {
  Fn,
  If,
  Loop,
  abs,
  clamp,
  float,
  instanceIndex,
  int,
  length,
  max,
  min,
  mix,
  mod,
  positionGeometry,
  select,
  sign,
  smoothstep,
  sqrt,
  storage,
  uniform,
  varying,
  vec2,
  vec4,
  Continue,
  Discard,
} from "three/tsl";
import {
  BufferAttribute,
  Group,
  InstancedBufferGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  StorageBufferAttribute,
  Vector2,
  Vector3,
  type Node,
} from "three/webgpu";
import type { GroundFrame } from "../pass";
import { MAGNET_SOURCE_FLOATS, MAX_MAGNET_SOURCES, type MagnetLevel } from "./magnet-collect";

/** Unit quad corners, 2 triangles (xy in [-1,1]; z unused — vec3 for positionGeometry). */
const CORNERS = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0]);

const LEVELS = 3;

export interface MagnetGridRenderer {
  readonly group: Group;
  /** Rewrite every uniform + the source buffer from this frame's collect. */
  update(
    frame: GroundFrame,
    cfg: GridConfig,
    magnet: GridMagnetConfig,
    levels: readonly MagnetLevel[],
    sources: Float32Array,
    sourceCount: number,
  ): void;
  dispose(): void;
}

export function createMagnetGrid(): MagnetGridRenderer {
  // --- shared state (one copy across the three level materials) --------------
  const sourceArray = new Float32Array(MAX_MAGNET_SOURCES * MAGNET_SOURCE_FLOATS);
  const sourceAttr = new StorageBufferAttribute(sourceArray, 4);
  // Read-only storage; PBO keeps the WebGL2 fallback functional (D4).
  const sourceBuf = storage(sourceAttr, "vec4", MAX_MAGNET_SOURCES * 2)
    .setPBO(true)
    .toReadOnly();

  const uCam = uniform(new Vector2(0, 0));
  const uZoom = uniform(1);
  const uView = uniform(new Vector2(1, 1));
  const uDotMode = uniform(0);
  const uHalfLen = uniform(5);
  const uHalfWidth = uniform(0.55);
  const uRestRadius = uniform(0.75);
  const uK = uniform(0);
  const uPad = uniform(0); // √(k/0.02) — the shader-side AABB reject cutoff
  const uPolarity = uniform(1);
  const uAlwaysAlign = uniform(0);
  const uCount = uniform(0, "int");
  const uColor = uniform(new Vector3(0.75, 0.77, 0.8));

  const EPS = float(25); // magnet.wgsl uniform slot 21 — fixed there too
  const REST = vec2(0, 1); // rest direction: hang "down" in y-down screen space

  // IQ rounded box; p local (site − center), b half-size, r corner radius.
  const sdRoundBox = Fn(([p, b, r]: [Node<"vec2">, Node<"vec2">, Node<"float">]) => {
    const q = abs(p).sub(b).add(vec2(r, r));
    return length(max(q, vec2(0, 0)))
      .add(min(max(q.x, q.y), 0))
      .sub(r);
  });

  // Outward unit normal of the same box (analytic — magnet.wgsl:64-80).
  const roundBoxNormal = Fn(([p, b, r]: [Node<"vec2">, Node<"vec2">, Node<"float">]) => {
    const s = sign(p);
    const q = abs(p);
    const inner = max(b.sub(vec2(r, r)), vec2(0, 0));
    const d = q.sub(inner);
    const n = vec2(0, 0).toVar();
    If(d.x.greaterThan(0).and(d.y.greaterThan(0)), () => {
      const len = length(d);
      If(len.greaterThan(0.0001), () => {
        n.assign(s.mul(d.div(len)));
      }).Else(() => {
        n.assign(vec2(s.x, 0));
      });
    })
      .ElseIf(d.x.greaterThan(d.y), () => {
        n.assign(vec2(s.x, 0));
      })
      .Else(() => {
        n.assign(vec2(0, s.y));
      });
    return n;
  });

  const safeNormalize = Fn(([v, fallback]: [Node<"vec2">, Node<"vec2">]) => {
    const n = length(v);
    return select(n.greaterThan(0.0001), v.div(max(n, 0.0001)), fallback);
  });

  const group = new Group();
  const geometries: InstancedBufferGeometry[] = [];
  const materials: MeshBasicNodeMaterial[] = [];
  const meshes: Mesh[] = [];
  const levelUniforms = Array.from({ length: LEVELS }, () => ({
    origin: uniform(new Vector2(0, 0)),
    dims: uniform(new Vector2(1, 1)),
    spacing: uniform(20),
    alpha: uniform(0),
    skipMod: uniform(0),
  }));

  for (let level = 0; level < LEVELS; level++) {
    const lu = levelUniforms[level] as (typeof levelUniforms)[number];

    const vUv = varying(vec2(0, 0), `vMagnetUv${level}`);
    const vAlpha = varying(float(0), `vMagnetAlpha${level}`);

    const vertexNode = Fn(() => {
      const iid = float(instanceIndex);
      const cols = lu.dims.x;
      // .toVar() pins site reconstruction to the stack BEFORE the source loop:
      // the builder emits expressions at first USE — inside the loop body — so
      // a zero-source frame (fadeZoom valve, no poles, widgets off) would
      // otherwise leave every position at the default-initialized origin and
      // blank the rest lattice (design-010 §10.9).
      const col = mod(iid, cols).floor().toVar();
      const row = iid.div(cols).floor().toVar();
      const world = lu.origin.add(vec2(col, row)).mul(lu.spacing);
      const screen = world.sub(uCam).mul(uZoom).toVar();

      // Field superposition over the source buffer (magnet.wgsl field_at).
      const field = vec2(0, 0).toVar();
      const minD = float(1e9).toVar();
      Loop({ start: int(0), end: uCount, type: "int", condition: "<" }, ({ i }) => {
        const a = sourceBuf.element(i.mul(2)); // cx, cy, hx, hy
        const b = sourceBuf.element(i.mul(2).add(1)); // r, strength, 0, 0
        const center = a.xy;
        const half = a.zw;
        const rad = b.x;
        const strength = b.y;
        const rel = screen.sub(center);
        const reach = uPad.mul(sqrt(max(strength, 0.0001)));
        If(
          abs(rel.x)
            .greaterThan(half.x.add(reach))
            .or(abs(rel.y).greaterThan(half.y.add(reach))),
          () => {
            Continue();
          },
        );
        const d = sdRoundBox(rel, half, rad);
        minD.assign(min(minD, d));
        const dist = max(d, 0);
        const r2 = dist.mul(dist).add(EPS);
        const outward = roundBoxNormal(rel, half, rad);
        // Attract toward the body = against the outward normal.
        field.subAssign(outward.mul(uK.mul(strength).mul(uPolarity).div(r2)));
      });

      const fieldDir = safeNormalize(field, REST);
      const mag = length(field);
      // Needles want a hard 0–1 blend; dots want the softer 1/r² size curve
      // (saturate plateaus at ~100px and every nearby site looks identical).
      const influence = select(uDotMode.greaterThan(0.5), mag.div(mag.add(1)), clamp(mag, 0, 1));

      const corner = positionGeometry.xy;
      // Dot: size encodes |field| — far sites rest at the classic dot radius.
      const dotRadius = mix(uRestRadius, uHalfLen.mul(1.05), influence);
      const dotLocal = corner.mul(dotRadius);
      // Needle: orient along the field (or rest-blended), length/width as cues.
      const dir = select(
        uAlwaysAlign.greaterThan(0.5),
        fieldDir,
        safeNormalize(mix(REST, fieldDir, influence), REST),
      );
      const nrm = vec2(dir.y.negate(), dir.x);
      const nLen = mix(uHalfLen.mul(0.55), uHalfLen.mul(1.35), influence);
      const nWid = mix(uHalfWidth.mul(0.85), uHalfWidth.mul(1.15), influence);
      const needleLocal = nrm.mul(corner.x).mul(nWid).add(dir.mul(corner.y).mul(nLen));
      const local = select(uDotMode.greaterThan(0.5), dotLocal, needleLocal);
      const pos = screen.add(local);

      // Needles use alpha as a second cue; dots keep alpha steadier so size reads first.
      const restAlpha = select(uDotMode.greaterThan(0.5), float(0.72), float(0.35));
      const fieldAlpha = mix(restAlpha, float(1), influence);
      const alpha = clamp(lu.alpha.mul(fieldAlpha), 0, 1).toVar();
      // Hide glyphs under a source body — the widget already covers them.
      If(minD.lessThan(-0.5), () => {
        alpha.assign(0);
      });
      // Coincidence skip (§5.4): absolute lattice index ≡ 0 (mod ratio) on both
      // axes belongs to the visible coarser level (mod() is non-negative).
      const absI = lu.origin.x.add(col);
      const absJ = lu.origin.y.add(row);
      If(
        lu.skipMod
          .greaterThan(0.5)
          .and(mod(absI, lu.skipMod).lessThan(0.5))
          .and(mod(absJ, lu.skipMod).lessThan(0.5)),
        () => {
          alpha.assign(0);
        },
      );

      vUv.assign(corner);
      vAlpha.assign(alpha);

      const ndc = vec2(
        pos.x.div(uView.x).mul(2).sub(1),
        float(1).sub(pos.y.div(uView.y).mul(2)),
      );
      return vec4(ndc, 0, 1);
    })();

    const fragmentNode = Fn(() => {
      const dotEdge = float(1).sub(smoothstep(0.62, 1.0, length(vUv)));
      const ax = float(1).sub(smoothstep(0.55, 1.0, abs(vUv.x)));
      const ay = float(1).sub(smoothstep(0.82, 1.0, abs(vUv.y)));
      const edge = select(uDotMode.greaterThan(0.5), dotEdge, ax.mul(ay));
      const a = vAlpha.mul(edge);
      Discard(a.lessThan(0.01));
      return vec4(uColor, a);
    })();

    const material = new MeshBasicNodeMaterial();
    material.vertexNode = vertexNode;
    material.fragmentNode = fragmentNode;
    material.transparent = true;
    material.depthTest = false;
    material.depthWrite = false;

    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(CORNERS, 3));
    geometry.instanceCount = 0;

    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 0;
    mesh.visible = false;

    geometries.push(geometry);
    materials.push(material);
    meshes.push(mesh);
    group.add(mesh);
  }

  return {
    group,
    update(frame, cfg, magnet, levels, sources, sourceCount) {
      uCam.value.set(frame.camera.x, frame.camera.y);
      uZoom.value = frame.camera.zoom;
      uView.value.set(Math.max(1, frame.width), Math.max(1, frame.height));
      uDotMode.value = magnet.glyph === "dot" ? 1 : 0;
      uHalfLen.value = magnet.needleLength;
      uHalfWidth.value = magnet.needleWidth;
      uRestRadius.value = cfg.dotRadius[0];
      const k = 0.5 * magnet.reach * magnet.reach;
      uK.value = k;
      uPad.value = Math.sqrt(Math.max(k, 1) / 0.02);
      uPolarity.value = magnet.polarity;
      uAlwaysAlign.value = magnet.alwaysAlign ? 1 : 0;
      uCount.value = sourceCount;
      uColor.value.set(...cfg.dotColor);

      if (sourceCount > 0) {
        sourceArray.set(sources.subarray(0, sourceCount * MAGNET_SOURCE_FLOATS));
        sourceAttr.needsUpdate = true;
      }

      for (let level = 0; level < LEVELS; level++) {
        const win = levels[level];
        const lu = levelUniforms[level] as (typeof levelUniforms)[number];
        const geometry = geometries[level] as InstancedBufferGeometry;
        const mesh = meshes[level] as Mesh;
        if (win === undefined || win.count <= 0) {
          geometry.instanceCount = 0;
          mesh.visible = false;
          continue;
        }
        lu.origin.value.set(win.i0, win.j0);
        lu.dims.value.set(win.cols, win.rows);
        lu.spacing.value = cfg.spacings[level] as number;
        lu.alpha.value = win.alpha;
        lu.skipMod.value = win.skipModulo;
        geometry.instanceCount = win.count;
        mesh.visible = true;
      }
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
